import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';

import type { ConfigService } from '@nestjs/config';
import type { WorkflowDetail } from '@bookorbit/types';
import type { BookFile, BookWorkflowOutput } from '../../db/schema';
import { WorkflowLockService } from './workflow-lock.service';
import type { WorkflowRepository } from './workflow.repository';
import { WorkflowRunnerService } from './workflow-runner.service';
import type { WorkflowRunRepository, WorkflowTemplateContextInfo } from './workflow-run.repository';

describe('WorkflowRunnerService', () => {
  let appDataPath: string;
  let sourceDir: string;
  let sourceFilePath: string;
  let service: WorkflowRunnerService;
  let lockService: WorkflowLockService;

  // In-memory fake database state
  let bookFilesStore: Map<number, BookFile>;
  let hashHistoryStore: Array<{ bookFileId: number; fileHash: string; reason: string }>;
  let runOutputsStore: Map<number, BookWorkflowOutput>;
  let nextBookFileId: number;

  let mockWorkflowRepo: {
    findById: ReturnType<typeof vi.fn>;
  };
  let mockRunRepo: {
    findPrimaryFileForBook: ReturnType<typeof vi.fn>;
    findPrimaryFilesForBooks: ReturnType<typeof vi.fn>;
    findTemplateContext: ReturnType<typeof vi.fn>;
    findRunById: ReturnType<typeof vi.fn>;
    upsertRun: ReturnType<typeof vi.fn>;
    upsertRunsBulk: ReturnType<typeof vi.fn>;
    markRunning: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
    markSuccess: ReturnType<typeof vi.fn>;
    recordOutputHashHistory: ReturnType<typeof vi.fn>;
    findBookFileById: ReturnType<typeof vi.fn>;
    createBookFile: ReturnType<typeof vi.fn>;
    updateBookFile: ReturnType<typeof vi.fn>;
    findStatusesForBook: ReturnType<typeof vi.fn>;
    getPreference: ReturnType<typeof vi.fn>;
    setPreference: ReturnType<typeof vi.fn>;
  };

  const copyWorkflow: WorkflowDetail = {
    id: 10,
    name: 'Copy Pipeline',
    description: 'Copies file',
    outputFormat: 'epub',
    inputFormats: ['epub'],
    outputFilenameTemplate: null,
    steps: [
      {
        id: 1,
        stepOrder: 1,
        command: 'cp',
        args: ['{{input}}', '{{output}}'],
        outputExtension: null,
        inPlace: false,
        timeoutSeconds: 30,
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const failingWorkflow: WorkflowDetail = {
    id: 11,
    name: 'Failing Pipeline',
    description: 'Runs non-existent binary',
    outputFormat: 'epub',
    inputFormats: ['epub'],
    outputFilenameTemplate: null,
    steps: [
      {
        id: 2,
        stepOrder: 1,
        command: 'definitely-not-a-real-binary-xyz123',
        args: ['{{input}}', '{{output}}'],
        outputExtension: null,
        inPlace: false,
        timeoutSeconds: 30,
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    appDataPath = await mkdtemp(join(tmpdir(), 'bookorbit-wf-appdata-'));
    sourceDir = await mkdtemp(join(tmpdir(), 'bookorbit-wf-source-'));
    sourceFilePath = join(sourceDir, 'original.epub');
    await writeFile(sourceFilePath, 'initial source file content for testing');

    bookFilesStore = new Map();
    hashHistoryStore = [];
    runOutputsStore = new Map();
    nextBookFileId = 100;

    lockService = new WorkflowLockService();

    mockWorkflowRepo = {
      findById: vi.fn(),
    };

    mockRunRepo = {
      findPrimaryFileForBook: vi.fn(),
      findPrimaryFilesForBooks: vi.fn(),
      findTemplateContext: vi.fn(),
      findRunById: vi.fn().mockImplementation((id: number) => Promise.resolve(runOutputsStore.get(id))),
      upsertRun: vi.fn(),
      upsertRunsBulk: vi.fn(),
      markRunning: vi.fn().mockImplementation((id: number) => {
        const row = runOutputsStore.get(id);
        if (row) {
          row.status = 'running';
          row.startedAt = new Date();
          row.errorMessage = null;
        }
        return Promise.resolve(row);
      }),
      markFailed: vi.fn().mockImplementation((id: number, errorMessage: string) => {
        const row = runOutputsStore.get(id);
        if (row) {
          row.status = 'failed';
          row.errorMessage = errorMessage;
          row.finishedAt = new Date();
        }
        return Promise.resolve();
      }),
      markSuccess: vi.fn().mockImplementation((id: number, data: { bookFileId: number; sourceBookFileId: number; sourceFileHash: string | null }) => {
        const row = runOutputsStore.get(id);
        if (row) {
          row.status = 'success';
          row.bookFileId = data.bookFileId;
          row.sourceBookFileId = data.sourceBookFileId;
          row.sourceFileHash = data.sourceFileHash;
          row.finishedAt = new Date();
          row.errorMessage = null;
        }
        return Promise.resolve();
      }),
      recordOutputHashHistory: vi.fn().mockImplementation((bookFileId: number, fileHash: string) => {
        hashHistoryStore.push({ bookFileId, fileHash, reason: 'workflow_regenerate' });
        return Promise.resolve();
      }),
      findBookFileById: vi.fn().mockImplementation((id: number) => Promise.resolve(bookFilesStore.get(id))),
      createBookFile: vi.fn().mockImplementation((data: Partial<BookFile>) => {
        const id = nextBookFileId++;
        const record = { ...data, id, createdAt: new Date(), updatedAt: new Date() } as BookFile;
        bookFilesStore.set(id, record);
        return Promise.resolve(record);
      }),
      updateBookFile: vi.fn().mockImplementation((id: number, data: Partial<BookFile>) => {
        const existing = bookFilesStore.get(id);
        if (!existing) throw new Error(`Book file ${id} not found`);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        bookFilesStore.set(id, updated);
        return Promise.resolve(updated);
      }),
      findStatusesForBook: vi.fn(),
      getPreference: vi.fn(),
      setPreference: vi.fn(),
    };

    const mockConfig = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'storage.appDataPath') return appDataPath;
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new WorkflowRunnerService(
      mockWorkflowRepo as unknown as WorkflowRepository,
      mockRunRepo as unknown as WorkflowRunRepository,
      lockService,
      mockConfig,
    );
  });

  afterEach(async () => {
    await rm(appDataPath, { recursive: true, force: true }).catch(() => {});
    await rm(sourceDir, { recursive: true, force: true }).catch(() => {});
  });

  it('(a) first run creates a new bookFiles row with role workflow_output and status success', async () => {
    const bookId = 1;
    const workflowId = 10;
    const runId = 50;

    mockWorkflowRepo.findById.mockResolvedValue(copyWorkflow);
    const templateContext: WorkflowTemplateContextInfo = {
      title: 'Dune',
      authors: 'Frank Herbert',
      series: 'Dune',
      libraryFolderId: 7,
      sourceFile: {
        id: 10,
        absolutePath: sourceFilePath,
        format: 'epub',
        fileHash: 'initialhash123',
      },
    };
    mockRunRepo.findTemplateContext.mockResolvedValue(templateContext);

    // Seed output row in pending state with no prior bookFileId
    runOutputsStore.set(runId, {
      id: runId,
      bookId,
      workflowId,
      bookFileId: null,
      sourceBookFileId: null,
      sourceFileHash: null,
      status: 'pending',
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.processRun(runId);

    const finishedRun = runOutputsStore.get(runId)!;
    expect(finishedRun.status).toBe('success');
    expect(finishedRun.errorMessage).toBeNull();
    expect(finishedRun.bookFileId).toBeDefined();

    // Verify created bookFiles record
    expect(mockRunRepo.createBookFile).toHaveBeenCalledTimes(1);
    const createdFile = bookFilesStore.get(finishedRun.bookFileId!)!;
    expect(createdFile).toBeDefined();
    expect(createdFile.role).toBe('workflow_output');
    expect(createdFile.bookId).toBe(bookId);
    expect(createdFile.libraryFolderId).toBe(7);
    expect(createdFile.format).toBe('epub');
    expect(createdFile.fileHash).toBeTruthy();

    // Verify filename is resolved from the default naming template, in a workflow-owned subfolder
    expect(basename(createdFile.absolutePath)).toBe('Dune - Copy Pipeline.epub');
    expect(dirname(createdFile.absolutePath)).toBe(join(appDataPath, 'workflow-output', String(bookId), String(workflowId)));

    // Verify on-disk output exists and content matches
    const diskContent = await readFile(createdFile.absolutePath, 'utf8');
    expect(diskContent).toBe('initial source file content for testing');
  });

  it('(b) second run overwrites the same bookFiles.id and records previous hash in hash history with reason workflow_regenerate', async () => {
    const bookId = 1;
    const workflowId = 10;
    const runId = 50;

    mockWorkflowRepo.findById.mockResolvedValue(copyWorkflow);
    const templateContext: WorkflowTemplateContextInfo = {
      title: 'Dune',
      authors: 'Frank Herbert',
      series: 'Dune',
      libraryFolderId: 7,
      sourceFile: {
        id: 10,
        absolutePath: sourceFilePath,
        format: 'epub',
        fileHash: 'initialhash123',
      },
    };
    mockRunRepo.findTemplateContext.mockResolvedValue(templateContext);

    // Run 1: first creation
    runOutputsStore.set(runId, {
      id: runId,
      bookId,
      workflowId,
      bookFileId: null,
      sourceBookFileId: null,
      sourceFileHash: null,
      status: 'pending',
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.processRun(runId);

    const firstRunOutput = runOutputsStore.get(runId)!;
    const firstBookFileId = firstRunOutput.bookFileId!;
    const firstBookFile = bookFilesStore.get(firstBookFileId)!;
    const firstFileHash = firstBookFile.fileHash!;

    expect(hashHistoryStore).toHaveLength(0);

    // Modify the source content so the second run produces a different hash
    await writeFile(sourceFilePath, 'updated source file content for rerun test');
    templateContext.sourceFile.fileHash = 'updatedhash456';

    // Run 2: rerun of the same workflow on the same book
    runOutputsStore.set(runId, {
      ...firstRunOutput,
      status: 'pending',
    });

    await service.processRun(runId);

    const secondRunOutput = runOutputsStore.get(runId)!;
    expect(secondRunOutput.status).toBe('success');
    expect(secondRunOutput.bookFileId).toBe(firstBookFileId);

    // Verify hash history recorded the pre-rerun fileHash with reason 'workflow_regenerate'
    expect(mockRunRepo.recordOutputHashHistory).toHaveBeenCalledWith(firstBookFileId, firstFileHash);
    expect(hashHistoryStore).toContainEqual({
      bookFileId: firstBookFileId,
      fileHash: firstFileHash,
      reason: 'workflow_regenerate',
    });

    // Verify bookFiles row was updated in place with the same id and path
    expect(mockRunRepo.updateBookFile).toHaveBeenCalledTimes(1);
    const updatedBookFile = bookFilesStore.get(firstBookFileId)!;
    expect(updatedBookFile.id).toBe(firstBookFileId);
    expect(updatedBookFile.absolutePath).toBe(firstBookFile.absolutePath);
    expect(updatedBookFile.fileHash).not.toBe(firstFileHash);

    // Verify disk content was updated
    const diskContent = await readFile(updatedBookFile.absolutePath, 'utf8');
    expect(diskContent).toBe('updated source file content for rerun test');
  });

  it('(d) uses a custom outputFilenameTemplate and removes the stale file when the resolved name changes between reruns', async () => {
    const bookId = 1;
    const workflowId = 10;
    const runId = 50;

    const customTemplateWorkflow: WorkflowDetail = {
      ...copyWorkflow,
      outputFilenameTemplate: '{title}',
    };
    mockWorkflowRepo.findById.mockResolvedValue(customTemplateWorkflow);
    const templateContext: WorkflowTemplateContextInfo = {
      title: 'Dune',
      authors: 'Frank Herbert',
      series: 'Dune',
      libraryFolderId: 7,
      sourceFile: {
        id: 10,
        absolutePath: sourceFilePath,
        format: 'epub',
        fileHash: 'initialhash123',
      },
    };
    mockRunRepo.findTemplateContext.mockResolvedValue(templateContext);

    runOutputsStore.set(runId, {
      id: runId,
      bookId,
      workflowId,
      bookFileId: null,
      sourceBookFileId: null,
      sourceFileHash: null,
      status: 'pending',
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.processRun(runId);

    const firstRunOutput = runOutputsStore.get(runId)!;
    const firstBookFile = bookFilesStore.get(firstRunOutput.bookFileId!)!;
    expect(basename(firstBookFile.absolutePath)).toBe('Dune.epub');

    // Book title changes and the workflow reruns: the resolved filename changes too
    templateContext.title = 'Dune Messiah';
    runOutputsStore.set(runId, { ...firstRunOutput, status: 'pending' });

    await service.processRun(runId);

    const secondRunOutput = runOutputsStore.get(runId)!;
    expect(secondRunOutput.status).toBe('success');
    const secondBookFile = bookFilesStore.get(secondRunOutput.bookFileId!)!;
    expect(basename(secondBookFile.absolutePath)).toBe('Dune Messiah.epub');
    expect(dirname(secondBookFile.absolutePath)).toBe(dirname(firstBookFile.absolutePath));

    // The stale, previously named file must not be left behind in the workflow-owned directory
    await expect(readFile(firstBookFile.absolutePath, 'utf8')).rejects.toThrow();
  });

  it('(c) step with non-existent command leaves prior successful output untouched and sets status failed', async () => {
    const bookId = 1;
    const workflowId = 10;
    const runId = 50;

    // First do a successful run with copyWorkflow to establish a prior output
    mockWorkflowRepo.findById.mockResolvedValue(copyWorkflow);
    const templateContext: WorkflowTemplateContextInfo = {
      title: 'Dune',
      authors: 'Frank Herbert',
      series: 'Dune',
      libraryFolderId: 7,
      sourceFile: {
        id: 10,
        absolutePath: sourceFilePath,
        format: 'epub',
        fileHash: 'initialhash123',
      },
    };
    mockRunRepo.findTemplateContext.mockResolvedValue(templateContext);

    runOutputsStore.set(runId, {
      id: runId,
      bookId,
      workflowId,
      bookFileId: null,
      sourceBookFileId: null,
      sourceFileHash: null,
      status: 'pending',
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.processRun(runId);

    const initialSuccessfulRun = runOutputsStore.get(runId)!;
    const priorBookFileId = initialSuccessfulRun.bookFileId!;
    const priorBookFile = { ...bookFilesStore.get(priorBookFileId)! };
    const priorDiskContent = await readFile(priorBookFile.absolutePath, 'utf8');

    // Reset mocks tracking updates/creates
    mockRunRepo.createBookFile.mockClear();
    mockRunRepo.updateBookFile.mockClear();

    // Now run with failingWorkflow
    mockWorkflowRepo.findById.mockResolvedValue(failingWorkflow);
    runOutputsStore.set(runId, {
      ...initialSuccessfulRun,
      workflowId: failingWorkflow.id,
      status: 'pending',
    });

    await service.processRun(runId);

    const failedRun = runOutputsStore.get(runId)!;
    expect(failedRun.status).toBe('failed');
    expect(failedRun.errorMessage).toBeTruthy();
    expect(failedRun.errorMessage).toMatch(/definitely-not-a-real-binary/);

    // Prior bookFileId must remain untouched on the output row
    expect(failedRun.bookFileId).toBe(priorBookFileId);

    // No new create or update to bookFiles table
    expect(mockRunRepo.createBookFile).not.toHaveBeenCalled();
    expect(mockRunRepo.updateBookFile).not.toHaveBeenCalled();

    // On-disk file from prior successful run is untouched
    const currentDiskContent = await readFile(priorBookFile.absolutePath, 'utf8');
    expect(currentDiskContent).toBe(priorDiskContent);
  });
});
