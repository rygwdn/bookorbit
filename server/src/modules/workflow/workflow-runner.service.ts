import { execFile } from 'child_process';
import { copyFile, mkdir, mkdtemp, rename, rm, stat, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, extname, join } from 'path';
import { promisify } from 'util';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { BookWorkflowRunStatus, BookWorkflowStatus, WorkflowDetail, WorkflowTemplateKey } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { BookWorkflowOutput } from '../../db/schema';
import { computeFileHash } from '../scanner/lib/hash';
import { substituteTemplate } from './lib/workflow-template';
import { WorkflowLockService } from './workflow-lock.service';
import { WorkflowRepository } from './workflow.repository';
import { WorkflowRunQueue } from './workflow-run-queue';
import { WorkflowRunRepository } from './workflow-run.repository';

const execFileAsync = promisify(execFile);
const WORKFLOW_RUN_QUEUE_CONCURRENCY = 2;

function resolveFileExtension(filePath: string, format: string | null): string {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase();
  if (ext) return ext;
  if (format) return format.toLowerCase();
  return 'bin';
}

function extractExecErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  if ('stderr' in error && error.stderr) {
    const stderrValue = error.stderr;
    let stderr: string;
    if (Buffer.isBuffer(stderrValue)) {
      stderr = stderrValue.toString('utf8');
    } else if (typeof stderrValue === 'string') {
      stderr = stderrValue;
    } else {
      try {
        stderr = JSON.stringify(stderrValue);
      } catch {
        stderr = '';
      }
    }
    const trimmed = stderr.trim();
    if (trimmed.length > 0) return trimmed;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
}

async function moveFile(sourcePath: string, destinationPath: string): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true });
  try {
    await rename(sourcePath, destinationPath);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EXDEV') {
      await copyFile(sourcePath, destinationPath);
      await unlink(sourcePath);
    } else {
      throw err;
    }
  }
}

@Injectable()
export class WorkflowRunnerService {
  private readonly logger = new Logger(WorkflowRunnerService.name);
  private readonly appDataPath: string;
  private readonly runQueue: WorkflowRunQueue;

  constructor(
    private readonly workflowRepo: WorkflowRepository,
    private readonly runRepo: WorkflowRunRepository,
    private readonly lockService: WorkflowLockService,
    private readonly config: ConfigService,
  ) {
    this.appDataPath = this.config.get<string>('storage.appDataPath') ?? '/data';
    this.runQueue = new WorkflowRunQueue(
      WORKFLOW_RUN_QUEUE_CONCURRENCY,
      (id) => this.processRun(id),
      (id, error) => this.logQueueFailure(id, error),
    );
  }

  async enqueueRun(bookId: number, workflowId: number): Promise<BookWorkflowOutput> {
    const workflow = await this.workflowRepo.findById(workflowId);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    const primaryFile = await this.runRepo.findPrimaryFileForBook(bookId);
    if (!primaryFile) {
      throw new BadRequestException('book has no primary content file');
    }

    this.assertWorkflowSupportsFormat(workflow, primaryFile.format);

    const row = await this.runRepo.upsertRun(bookId, workflowId);
    if (row.status !== 'running') {
      this.runQueue.enqueue(row.id);
    }
    return row;
  }

  async enqueueRunBulk(bookIds: number[], workflowId: number): Promise<{ queued: number[]; skipped: { bookId: number; reason: string }[] }> {
    const workflow = await this.workflowRepo.findById(workflowId);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    const uniqueBookIds = [...new Set(bookIds)];
    const primaryFilesMap = await this.runRepo.findPrimaryFilesForBooks(uniqueBookIds);

    const eligibleBookIds: number[] = [];
    const skipped: { bookId: number; reason: string }[] = [];

    for (const bookId of uniqueBookIds) {
      const primaryFile = primaryFilesMap.get(bookId);
      if (!primaryFile) {
        skipped.push({ bookId, reason: 'book has no primary content file' });
        continue;
      }

      const format = (primaryFile.format ?? '').toLowerCase();
      if (workflow.inputFormats && workflow.inputFormats.length > 0 && !workflow.inputFormats.map((f) => f.toLowerCase()).includes(format)) {
        skipped.push({ bookId, reason: `workflow does not support format: ${format}` });
        continue;
      }

      eligibleBookIds.push(bookId);
    }

    const rows = await this.runRepo.upsertRunsBulk(eligibleBookIds, workflowId);
    const queued: number[] = [];

    for (const row of rows) {
      if (row.status !== 'running') {
        this.runQueue.enqueue(row.id);
      }
      queued.push(row.bookId);
    }

    return { queued, skipped };
  }

  async listBookWorkflowStatuses(bookId: number): Promise<BookWorkflowStatus[]> {
    const [statusRows, primaryFile] = await Promise.all([this.runRepo.findStatusesForBook(bookId), this.runRepo.findPrimaryFileForBook(bookId)]);

    return statusRows.map((row) => ({
      workflowId: row.workflowId,
      workflowName: row.workflowName,
      status: row.status as BookWorkflowRunStatus,
      bookFileId: row.bookFileId,
      errorMessage: row.errorMessage,
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      stale: Boolean(row.sourceFileHash != null && primaryFile?.fileHash != null && row.sourceFileHash !== primaryFile.fileHash),
    }));
  }

  async getPreference(userId: number, bookId: number): Promise<{ workflowId: number | null }> {
    const workflowId = await this.runRepo.getPreference(userId, bookId);
    return { workflowId };
  }

  async setPreference(userId: number, bookId: number, workflowId: number | null): Promise<void> {
    await this.runRepo.setPreference(userId, bookId, workflowId);
  }

  async processRun(bookWorkflowOutputId: number): Promise<void> {
    const row = await this.runRepo.findRunById(bookWorkflowOutputId);
    if (!row) return;

    const lockKey = `workflow-run:${row.bookId}:${row.workflowId}`;
    await this.lockService.withLock(lockKey, async () => {
      const freshRow = await this.runRepo.findRunById(bookWorkflowOutputId);
      if (!freshRow) return;

      const [workflow, templateContext] = await Promise.all([
        this.workflowRepo.findById(freshRow.workflowId),
        this.runRepo.findTemplateContext(freshRow.bookId),
      ]);

      if (!workflow) {
        await this.runRepo.markFailed(bookWorkflowOutputId, 'Workflow definition not found');
        return;
      }

      if (!templateContext) {
        await this.runRepo.markFailed(bookWorkflowOutputId, 'Book or primary content file not found');
        return;
      }

      const startedAt = Date.now();
      await this.runRepo.markRunning(bookWorkflowOutputId);
      this.logger.log(
        `[workflow.run] [start] bookId=${freshRow.bookId} workflowId=${freshRow.workflowId} runId=${freshRow.id} - workflow run started`,
      );

      const workDir = await mkdtemp(join(tmpdir(), 'bookorbit-workflow-'));
      try {
        const sourceExt = resolveFileExtension(templateContext.sourceFile.absolutePath, templateContext.sourceFile.format);
        let currentInputPath = join(workDir, `step-0.${sourceExt}`);
        await copyFile(templateContext.sourceFile.absolutePath, currentInputPath);
        let currentFormat = sourceExt;

        for (let index = 0; index < workflow.steps.length; index++) {
          const step = workflow.steps[index];
          const outputPath = step.inPlace ? currentInputPath : join(workDir, `step-${index + 1}.${step.outputExtension ?? currentFormat}`);

          const context: Record<WorkflowTemplateKey, string> = {
            input: currentInputPath,
            output: outputPath,
            workDir,
            title: templateContext.title,
            authors: templateContext.authors,
            series: templateContext.series,
            format: currentFormat,
            bookId: String(freshRow.bookId),
          };

          const resolvedArgs = substituteTemplate(step.args, context);
          try {
            await execFileAsync(step.command, resolvedArgs, {
              timeout: step.timeoutSeconds * 1000,
              maxBuffer: 64 * 1024 * 1024,
            });
          } catch (execError: unknown) {
            const errorMessage = extractExecErrorMessage(execError);
            const durationMs = Date.now() - startedAt;
            const errorClass = execError instanceof Error ? execError.constructor.name : 'Unknown';
            this.logger.warn(
              `[workflow.run] [fail] bookId=${freshRow.bookId} workflowId=${freshRow.workflowId} runId=${freshRow.id} durationMs=${durationMs} errorClass=${errorClass} error="${sanitizeLogValue(errorMessage)}" - workflow run failed`,
            );
            await this.runRepo.markFailed(bookWorkflowOutputId, errorMessage);
            return;
          }

          currentInputPath = outputPath;
          currentFormat = step.outputExtension ?? currentFormat;
        }

        const targetPath = join(this.appDataPath, 'workflow-output', String(freshRow.bookId), `${freshRow.workflowId}.${currentFormat}`);

        if (freshRow.bookFileId) {
          const existingFile = await this.runRepo.findBookFileById(freshRow.bookFileId);
          if (existingFile?.fileHash) {
            await this.runRepo.recordOutputHashHistory(existingFile.id, existingFile.fileHash);
          }
        }

        await moveFile(currentInputPath, targetPath);
        const stats = await stat(targetPath, { bigint: true });
        const newFileHash = await computeFileHash(targetPath);

        let committedBookFileId: number;
        if (freshRow.bookFileId) {
          await this.runRepo.updateBookFile(freshRow.bookFileId, {
            absolutePath: targetPath,
            fileHash: newFileHash,
            sizeBytes: Number(stats.size),
            ino: stats.ino,
            mtime: stats.mtime,
            format: currentFormat,
          });
          committedBookFileId = freshRow.bookFileId;
        } else {
          const created = await this.runRepo.createBookFile({
            bookId: freshRow.bookId,
            libraryFolderId: templateContext.libraryFolderId,
            absolutePath: targetPath,
            relPath: null,
            ino: stats.ino,
            sizeBytes: Number(stats.size),
            mtime: stats.mtime,
            fileHash: newFileHash,
            format: currentFormat,
            role: 'workflow_output',
          });
          committedBookFileId = created.id;
        }

        await this.runRepo.markSuccess(bookWorkflowOutputId, {
          bookFileId: committedBookFileId,
          sourceBookFileId: templateContext.sourceFile.id,
          sourceFileHash: templateContext.sourceFile.fileHash,
        });

        const durationMs = Date.now() - startedAt;
        this.logger.log(
          `[workflow.run] [end] bookId=${freshRow.bookId} workflowId=${freshRow.workflowId} runId=${freshRow.id} durationMs=${durationMs} steps=${workflow.steps.length} - workflow run completed`,
        );
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startedAt;
        const errorClass = err instanceof Error ? err.constructor.name : 'Unknown';
        this.logger.warn(
          `[workflow.run] [fail] bookId=${freshRow.bookId} workflowId=${freshRow.workflowId} runId=${freshRow.id} durationMs=${durationMs} errorClass=${errorClass} error="${sanitizeLogValue(errorMessage)}" - workflow run unexpected failure`,
        );
        await this.runRepo.markFailed(bookWorkflowOutputId, errorMessage);
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  }

  private assertWorkflowSupportsFormat(workflow: WorkflowDetail, format: string | null): void {
    if (!workflow.inputFormats || workflow.inputFormats.length === 0) return;
    const normalized = (format ?? '').toLowerCase();
    if (!workflow.inputFormats.map((f) => f.toLowerCase()).includes(normalized)) {
      throw new BadRequestException(`workflow does not support this book's format: ${normalized}`);
    }
  }

  private logQueueFailure(id: number, error: unknown): void {
    const errorClass = error instanceof Error ? error.constructor.name : 'Unknown';
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `[workflow.queue] [fail] runId=${id} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - unhandled runner queue failure`,
    );
  }
}
