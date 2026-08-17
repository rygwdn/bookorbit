import { Injectable } from '@nestjs/common';

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
  constructor(private readonly workflowRunRepo: WorkflowRunRepository) {}

  async resolvePreferredOutputFile(userId: number, bookId: number): Promise<PreferredOutputFile | null> {
    const row = await this.workflowRunRepo.findPreferredOutputFile(userId, bookId);
    if (!row) return null;

    return {
      id: row.id,
      absolutePath: row.absolutePath,
      format: row.format ?? '',
      sizeBytes: row.sizeBytes,
      fileHash: row.fileHash,
    };
  }

  async resolvePreferredOutputFilesForBooks(userId: number, bookIds: number[]): Promise<Map<number, PreferredOutputFile>> {
    if (bookIds.length === 0) return new Map();

    const rows = await this.workflowRunRepo.findPreferredOutputFilesForBooks(userId, bookIds);
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
    return map;
  }
}
