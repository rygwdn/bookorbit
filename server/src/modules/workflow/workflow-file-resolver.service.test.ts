import { describe, beforeEach, it, expect, vi } from 'vitest';
import { WorkflowFileResolverService } from './workflow-file-resolver.service';
import type { WorkflowRunRepository } from './workflow-run.repository';

describe('WorkflowFileResolverService', () => {
  let service: WorkflowFileResolverService;
  let mockRepo: {
    findPreferredOutputFile: ReturnType<typeof vi.fn>;
    findPreferredOutputFilesForBooks: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRepo = {
      findPreferredOutputFile: vi.fn(),
      findPreferredOutputFilesForBooks: vi.fn(),
    };
    service = new WorkflowFileResolverService(mockRepo as unknown as WorkflowRunRepository);
  });
  const target = { type: 'opds' as const, opdsUserId: 20 };

  it('returns null when no preference row exists', async () => {
    mockRepo.findPreferredOutputFile.mockResolvedValue(null);

    const result = await service.resolvePreferredOutputFile(1, 100, target);
    expect(result).toBeNull();
  });

  it('returns null when a preference exists but matching output is pending/failed (repo produces no row)', async () => {
    mockRepo.findPreferredOutputFile.mockResolvedValue(null);

    const result = await service.resolvePreferredOutputFile(1, 100, target);
    expect(result).toBeNull();
  });

  it('returns the file when preference matches a successful workflow output', async () => {
    const matchedRow = {
      id: 55,
      absolutePath: '/appdata/workflow-output/100/10.epub',
      format: 'epub',
      sizeBytes: 12345,
      fileHash: 'abcdef0123456789abcdef0123456789',
    };
    mockRepo.findPreferredOutputFile.mockResolvedValue(matchedRow);

    const result = await service.resolvePreferredOutputFile(1, 100, target);
    expect(result).toEqual({
      id: 55,
      absolutePath: '/appdata/workflow-output/100/10.epub',
      format: 'epub',
      sizeBytes: 12345,
      fileHash: 'abcdef0123456789abcdef0123456789',
    });
  });

  it('resolvePreferredOutputFilesForBooks returns empty map for empty bookIds', async () => {
    const result = await service.resolvePreferredOutputFilesForBooks(1, [], target);
    expect(result.size).toBe(0);
    expect(mockRepo.findPreferredOutputFilesForBooks).not.toHaveBeenCalled();
  });

  it('resolvePreferredOutputFilesForBooks returns map of matched preferred files', async () => {
    const matchedRows = [
      {
        bookId: 101,
        id: 55,
        absolutePath: '/appdata/workflow-output/101/10.epub',
        format: 'epub',
        sizeBytes: 12345,
        fileHash: 'hash1',
      },
      {
        bookId: 102,
        id: 56,
        absolutePath: '/appdata/workflow-output/102/10.epub',
        format: 'epub',
        sizeBytes: 67890,
        fileHash: 'hash2',
      },
    ];
    mockRepo.findPreferredOutputFilesForBooks.mockResolvedValue(matchedRows);

    const result = await service.resolvePreferredOutputFilesForBooks(1, [101, 102, 103], target);
    expect(result.size).toBe(2);
    expect(result.get(101)).toEqual({
      id: 55,
      absolutePath: '/appdata/workflow-output/101/10.epub',
      format: 'epub',
      sizeBytes: 12345,
      fileHash: 'hash1',
    });
    expect(result.get(102)).toEqual({
      id: 56,
      absolutePath: '/appdata/workflow-output/102/10.epub',
      format: 'epub',
      sizeBytes: 67890,
      fileHash: 'hash2',
    });
    expect(result.get(103)).toBeUndefined();
  });
});
