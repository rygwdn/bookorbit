import { Injectable } from '@nestjs/common';

import type { WorkflowDeliveryTarget } from '@bookorbit/types';
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

  async resolvePreferredOutputFile(userId: number, bookId: number, target: WorkflowDeliveryTarget): Promise<PreferredOutputFile | null> {
    const row = await this.workflowRunRepo.findPreferredOutputFile(userId, bookId, target);
    if (!row) return null;

    return {
      id: row.id,
      absolutePath: row.absolutePath,
      format: row.format ?? '',
      sizeBytes: row.sizeBytes,
      fileHash: row.fileHash,
    };
  }

  async resolvePreferredOutputFilesForBooks(
    userId: number,
    bookIds: number[],
    target: WorkflowDeliveryTarget,
  ): Promise<Map<number, PreferredOutputFile>> {
    if (bookIds.length === 0) return new Map();

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
    return map;
  }
}
