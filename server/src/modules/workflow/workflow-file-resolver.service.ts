import { Injectable, Logger } from '@nestjs/common';

import type { WorkflowDeliveryTarget } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { WorkflowRunRepository } from './workflow-run.repository';

export interface PreferredOutputFile {
  id: number;
  absolutePath: string;
  format: string;
  sizeBytes: number | null;
  fileHash: string | null;
}

@Injectable()
export class WorkflowFileResolverService {
  private readonly logger = new Logger(WorkflowFileResolverService.name);

  constructor(private readonly workflowRunRepo: WorkflowRunRepository) {}

  async resolvePreferredOutputFile(userId: number, bookId: number, target: WorkflowDeliveryTarget): Promise<PreferredOutputFile | null> {
    const startedAt = Date.now();
    this.logger.log(
      `[workflow.resolve_preferred_output] [start] userId=${userId} targetType=${target.type} targetId=${this.targetIdField(target)} requestedBooks=1 - resolve preferred output started`,
    );
    try {
      const row = await this.workflowRunRepo.findPreferredOutputFile(userId, bookId, target);
      await this.logEnd(userId, target, 1, row ? 1 : 0, Date.now() - startedAt, 'resolve preferred output completed');
      if (!row) return null;

      return {
        id: row.id,
        absolutePath: row.absolutePath,
        format: row.format ?? '',
        sizeBytes: row.sizeBytes,
        fileHash: row.fileHash,
      };
    } catch (error) {
      this.logFail(userId, target, Date.now() - startedAt, error, 'resolve preferred output failed');
      throw error;
    }
  }

  async resolvePreferredOutputFilesForBooks(
    userId: number,
    bookIds: number[],
    target: WorkflowDeliveryTarget,
  ): Promise<Map<number, PreferredOutputFile>> {
    const startedAt = Date.now();
    this.logger.log(
      `[workflow.resolve_preferred_output] [start] userId=${userId} targetType=${target.type} targetId=${this.targetIdField(target)} requestedBooks=${bookIds.length} - resolve preferred output files started`,
    );
    try {
      if (bookIds.length === 0) {
        await this.logEnd(userId, target, 0, 0, Date.now() - startedAt, 'resolve preferred output files completed');
        return new Map();
      }

      const rows = await this.workflowRunRepo.findPreferredOutputFilesForBooks(userId, bookIds, target);
      const map = new Map<number, PreferredOutputFile>();
      for (const row of rows) {
        map.set(row.bookId, {
          id: row.id,
          absolutePath: row.absolutePath,
          format: row.format ?? '',
          sizeBytes: row.sizeBytes,
          fileHash: row.fileHash,
        });
      }
      await this.logEnd(userId, target, bookIds.length, map.size, Date.now() - startedAt, 'resolve preferred output files completed');
      return map;
    } catch (error) {
      this.logFail(userId, target, Date.now() - startedAt, error, 'resolve preferred output files failed');
      throw error;
    }
  }

  private async logEnd(
    userId: number,
    target: WorkflowDeliveryTarget,
    requestedBooks: number,
    matchedBooks: number,
    durationMs: number,
    completedMessage: string,
  ): Promise<void> {
    const base = `userId=${userId} targetType=${target.type} targetId=${this.targetIdField(target)} requestedBooks=${requestedBooks} matchedBooks=${matchedBooks} durationMs=${durationMs}`;
    if (requestedBooks === 0) {
      this.logger.log(`[workflow.resolve_preferred_output] [end] ${base} - no books requested`);
      return;
    }
    if (matchedBooks > 0) {
      this.logger.log(`[workflow.resolve_preferred_output] [end] ${base} - ${completedMessage}`);
      return;
    }
    const preferencesConfigured = await this.workflowRunRepo.countDeliveryPreferences(userId, target);
    const missing = preferencesConfigured === 0 ? 'no delivery preference configured for target' : 'no successful workflow output matched';
    this.logger.log(`[workflow.resolve_preferred_output] [end] ${base} preferencesConfigured=${preferencesConfigured} - ${missing}`);
  }

  private logFail(userId: number, target: WorkflowDeliveryTarget, durationMs: number, error: unknown, message: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorClass = error instanceof Error ? error.constructor.name : typeof error;
    this.logger.error(
      `[workflow.resolve_preferred_output] [fail] userId=${userId} targetType=${target.type} targetId=${this.targetIdField(target)} durationMs=${durationMs} errorClass=${errorClass} error="${sanitizeLogValue(errorMessage)}" - ${message}`,
    );
  }

  private targetIdField(target: WorkflowDeliveryTarget): string {
    return target.type === 'opds' ? `${target.opdsUserId}` : `"${sanitizeLogValue(target.deviceId)}"`;
  }
}
