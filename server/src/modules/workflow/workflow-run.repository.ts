import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  authors,
  bookAuthors,
  bookFileHashHistory,
  bookFiles,
  bookMetadata,
  books,
  bookSeries,
  bookSeriesMemberships,
  bookWorkflowOutputs,
  koreaderDeviceProgress,
  koreaderDeviceSettings,
  koreaderDeviceSweeps,
  opdsUsers,
  workflowDeliveryPreferences,
  workflows,
  type BookFile,
  type BookWorkflowOutput,
} from '../../db/schema';
import { BOOK_WORKFLOW_STATUSES, type BookWorkflowRunStatus, type WorkflowDeliveryTarget } from '@bookorbit/types';

type Db = NodePgDatabase<typeof schema>;

export interface PrimaryFileInfo {
  id: number;
  absolutePath: string;
  format: string | null;
  sizeBytes: number | null;
  fileHash: string | null;
  libraryFolderId: number;
}

export interface WorkflowTemplateContextInfo {
  title: string;
  authors: string;
  series: string;
  libraryFolderId: number;
  sourceFile: {
    id: number;
    absolutePath: string;
    format: string | null;
    fileHash: string | null;
  };
}

export interface WorkflowStatusRow {
  workflowId: number;
  workflowName: string;
  status: string;
  bookFileId: number | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  sourceFileHash: string | null;
}

@Injectable()
export class WorkflowRunRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findPrimaryFileForBook(bookId: number): Promise<PrimaryFileInfo | null> {
    const [row] = await this.db
      .select({
        id: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        sizeBytes: bookFiles.sizeBytes,
        fileHash: bookFiles.fileHash,
        libraryFolderId: books.libraryFolderId,
      })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(eq(books.id, bookId))
      .limit(1);

    return row ?? null;
  }

  async findPrimaryFilesForBooks(bookIds: number[]): Promise<Map<number, PrimaryFileInfo>> {
    if (bookIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        bookId: books.id,
        id: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        sizeBytes: bookFiles.sizeBytes,
        fileHash: bookFiles.fileHash,
        libraryFolderId: books.libraryFolderId,
      })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(inArray(books.id, bookIds));

    const map = new Map<number, PrimaryFileInfo>();
    for (const row of rows) {
      map.set(row.bookId, {
        id: row.id,
        absolutePath: row.absolutePath,
        format: row.format,
        sizeBytes: row.sizeBytes,
        fileHash: row.fileHash,
        libraryFolderId: row.libraryFolderId,
      });
    }
    return map;
  }

  async findTemplateContext(bookId: number): Promise<WorkflowTemplateContextInfo | null> {
    const [bookRow] = await this.db
      .select({
        bookId: books.id,
        libraryFolderId: books.libraryFolderId,
        primaryFileId: books.primaryFileId,
        title: bookMetadata.title,
      })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(eq(books.id, bookId))
      .limit(1);

    if (!bookRow || !bookRow.primaryFileId) return null;

    const [sourceFile, authorRows, seriesRows] = await Promise.all([
      this.db
        .select({
          id: bookFiles.id,
          absolutePath: bookFiles.absolutePath,
          format: bookFiles.format,
          fileHash: bookFiles.fileHash,
        })
        .from(bookFiles)
        .where(eq(bookFiles.id, bookRow.primaryFileId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      this.db
        .select({ name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(eq(bookAuthors.bookId, bookId))
        .orderBy(asc(bookAuthors.displayOrder)),
      this.db
        .select({ name: bookSeries.name })
        .from(bookSeriesMemberships)
        .innerJoin(bookSeries, eq(bookSeries.id, bookSeriesMemberships.seriesId))
        .where(eq(bookSeriesMemberships.bookId, bookId))
        .orderBy(asc(bookSeriesMemberships.displayOrder), asc(bookSeriesMemberships.seriesId))
        .limit(1),
    ]);

    if (!sourceFile) return null;

    const authorsString = authorRows.map((row) => row.name).join(', ');
    const seriesString = seriesRows[0]?.name ?? '';

    return {
      title: bookRow.title ?? '',
      authors: authorsString,
      series: seriesString,
      libraryFolderId: bookRow.libraryFolderId,
      sourceFile,
    };
  }

  async findRunById(id: number): Promise<BookWorkflowOutput | undefined> {
    const [row] = await this.db.select().from(bookWorkflowOutputs).where(eq(bookWorkflowOutputs.id, id)).limit(1);
    return row;
  }

  async findOutputByBookAndWorkflow(bookId: number, workflowId: number): Promise<BookWorkflowOutput | undefined> {
    const [row] = await this.db
      .select()
      .from(bookWorkflowOutputs)
      .where(and(eq(bookWorkflowOutputs.bookId, bookId), eq(bookWorkflowOutputs.workflowId, workflowId)))
      .limit(1);
    return row;
  }

  async countStatusesByWorkflow(workflowId: number): Promise<Record<BookWorkflowRunStatus, number>> {
    const rows = await this.db
      .select({ status: bookWorkflowOutputs.status, count: sql<number>`count(*)::int` })
      .from(bookWorkflowOutputs)
      .where(eq(bookWorkflowOutputs.workflowId, workflowId))
      .groupBy(bookWorkflowOutputs.status);

    const counts = Object.fromEntries(BOOK_WORKFLOW_STATUSES.map((status) => [status, 0])) as Record<BookWorkflowRunStatus, number>;
    for (const row of rows) {
      counts[row.status as BookWorkflowRunStatus] = Number(row.count);
    }
    return counts;
  }

  async upsertRun(bookId: number, workflowId: number): Promise<BookWorkflowOutput> {
    const [row] = await this.db
      .insert(bookWorkflowOutputs)
      .values({
        bookId,
        workflowId,
        status: 'pending',
      })
      .onConflictDoUpdate({
        target: [bookWorkflowOutputs.bookId, bookWorkflowOutputs.workflowId],
        set: {
          status: sql`CASE WHEN ${bookWorkflowOutputs.status} = 'running' THEN ${bookWorkflowOutputs.status} ELSE 'pending' END`,
          updatedAt: new Date(),
        },
      })
      .returning();

    return row!;
  }

  async upsertRunsBulk(bookIds: number[], workflowId: number): Promise<BookWorkflowOutput[]> {
    if (bookIds.length === 0) return [];

    return this.db
      .insert(bookWorkflowOutputs)
      .values(
        bookIds.map((bookId) => ({
          bookId,
          workflowId,
          status: 'pending',
        })),
      )
      .onConflictDoUpdate({
        target: [bookWorkflowOutputs.bookId, bookWorkflowOutputs.workflowId],
        set: {
          status: sql`CASE WHEN ${bookWorkflowOutputs.status} = 'running' THEN ${bookWorkflowOutputs.status} ELSE 'pending' END`,
          updatedAt: new Date(),
        },
      })
      .returning();
  }

  async markRunning(id: number): Promise<BookWorkflowOutput | undefined> {
    const [row] = await this.db
      .update(bookWorkflowOutputs)
      .set({
        status: 'running',
        startedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(bookWorkflowOutputs.id, id))
      .returning();

    return row;
  }

  async markFailed(id: number, errorMessage: string): Promise<void> {
    await this.db
      .update(bookWorkflowOutputs)
      .set({
        status: 'failed',
        errorMessage,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bookWorkflowOutputs.id, id));
  }

  async markSuccess(
    id: number,
    data: {
      bookFileId: number;
      sourceBookFileId: number;
      sourceFileHash: string | null;
    },
  ): Promise<void> {
    await this.db
      .update(bookWorkflowOutputs)
      .set({
        status: 'success',
        bookFileId: data.bookFileId,
        sourceBookFileId: data.sourceBookFileId,
        sourceFileHash: data.sourceFileHash,
        finishedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(bookWorkflowOutputs.id, id));
  }

  async recordOutputHashHistory(bookFileId: number, fileHash: string): Promise<void> {
    await this.db
      .insert(bookFileHashHistory)
      .values({
        bookFileId,
        fileHash,
        reason: 'workflow_regenerate',
      })
      .onConflictDoNothing();
  }

  async findBookFileById(id: number): Promise<BookFile | undefined> {
    const [row] = await this.db.select().from(bookFiles).where(eq(bookFiles.id, id)).limit(1);
    return row;
  }

  async createBookFile(data: typeof bookFiles.$inferInsert): Promise<BookFile> {
    const rows = await this.db.insert(bookFiles).values(data).returning();
    const created = rows[0];
    if (!created) throw new Error('Failed to create book file');
    return created;
  }

  async updateBookFile(id: number, data: Partial<typeof bookFiles.$inferInsert>): Promise<BookFile> {
    const [updated] = await this.db
      .update(bookFiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(bookFiles.id, id))
      .returning();
    return updated!;
  }

  async findStatusesForBook(bookId: number): Promise<WorkflowStatusRow[]> {
    const rows = await this.db
      .select({
        workflowId: workflows.id,
        workflowName: workflows.name,
        status: bookWorkflowOutputs.status,
        bookFileId: bookWorkflowOutputs.bookFileId,
        errorMessage: bookWorkflowOutputs.errorMessage,
        startedAt: bookWorkflowOutputs.startedAt,
        finishedAt: bookWorkflowOutputs.finishedAt,
        sourceFileHash: bookWorkflowOutputs.sourceFileHash,
      })
      .from(bookWorkflowOutputs)
      .innerJoin(workflows, eq(workflows.id, bookWorkflowOutputs.workflowId))
      .where(eq(bookWorkflowOutputs.bookId, bookId))
      .orderBy(asc(workflows.name));

    return rows;
  }

  async listDeliveryPreferences(userId: number) {
    return this.db
      .select({
        id: workflowDeliveryPreferences.id,
        workflowId: workflowDeliveryPreferences.workflowId,
        workflowName: workflows.name,
        outputFormat: workflows.outputFormat,
        inputFormats: workflows.inputFormats,
        opdsUserId: workflowDeliveryPreferences.opdsUserId,
        koreaderDeviceId: workflowDeliveryPreferences.koreaderDeviceId,
        priority: workflowDeliveryPreferences.priority,
        createdAt: workflowDeliveryPreferences.createdAt,
        updatedAt: workflowDeliveryPreferences.updatedAt,
      })
      .from(workflowDeliveryPreferences)
      .innerJoin(workflows, eq(workflows.id, workflowDeliveryPreferences.workflowId))
      .where(eq(workflowDeliveryPreferences.userId, userId))
      .orderBy(asc(workflowDeliveryPreferences.priority), asc(workflowDeliveryPreferences.id));
  }

  async hasOwnedOpdsUser(userId: number, opdsUserId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: opdsUsers.id })
      .from(opdsUsers)
      .where(and(eq(opdsUsers.id, opdsUserId), eq(opdsUsers.userId, userId)))
      .limit(1);
    return row !== undefined;
  }

  async hasOwnedKoreaderDevice(userId: number, deviceId: string): Promise<boolean> {
    const [settings] = await this.db
      .select({ deviceId: koreaderDeviceSettings.deviceId })
      .from(koreaderDeviceSettings)
      .where(and(eq(koreaderDeviceSettings.userId, userId), eq(koreaderDeviceSettings.deviceId, deviceId)))
      .limit(1);
    if (settings) return true;

    const [progress] = await this.db
      .select({ deviceId: koreaderDeviceProgress.deviceId })
      .from(koreaderDeviceProgress)
      .where(
        and(eq(koreaderDeviceProgress.userId, userId), eq(koreaderDeviceProgress.deviceId, deviceId), eq(koreaderDeviceProgress.orphaned, false)),
      )
      .limit(1);
    if (progress) return true;

    const [sweep] = await this.db
      .select({ deviceId: koreaderDeviceSweeps.deviceId })
      .from(koreaderDeviceSweeps)
      .where(and(eq(koreaderDeviceSweeps.userId, userId), eq(koreaderDeviceSweeps.deviceId, deviceId)))
      .limit(1);
    return sweep !== undefined;
  }

  async createDeliveryPreference(userId: number, workflowId: number, target: WorkflowDeliveryTarget, priority: number): Promise<void> {
    await this.db.insert(workflowDeliveryPreferences).values({
      userId,
      workflowId,
      opdsUserId: target.type === 'opds' ? target.opdsUserId : null,
      koreaderDeviceId: target.type === 'koreader' ? target.deviceId : null,
      priority,
    });
  }
  async deleteDeliveryPreference(userId: number, id: number): Promise<{ id: number } | undefined> {
    const [removed] = await this.db
      .delete(workflowDeliveryPreferences)
      .where(and(eq(workflowDeliveryPreferences.id, id), eq(workflowDeliveryPreferences.userId, userId)))
      .returning({ id: workflowDeliveryPreferences.id });
    return removed;
  }

  async findPreferredOutputFile(userId: number, bookId: number, target: WorkflowDeliveryTarget) {
    const rows = await this.findPreferredOutputFilesForBooks(userId, [bookId], target);
    return rows[0] ?? null;
  }

  async findPreferredOutputFilesForBooks(userId: number, bookIds: number[], target: WorkflowDeliveryTarget) {
    if (bookIds.length === 0) return [];

    const targetClause =
      target.type === 'opds'
        ? and(eq(workflowDeliveryPreferences.opdsUserId, target.opdsUserId), isNull(workflowDeliveryPreferences.koreaderDeviceId))
        : and(eq(workflowDeliveryPreferences.koreaderDeviceId, target.deviceId), isNull(workflowDeliveryPreferences.opdsUserId));
    const sourceFiles = alias(bookFiles, 'workflow_source_files') as typeof bookFiles;
    const rows = await this.db
      .select({
        bookId: bookWorkflowOutputs.bookId,
        id: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        sizeBytes: bookFiles.sizeBytes,
        fileHash: bookFiles.fileHash,
        inputFormats: workflows.inputFormats,
        sourceFormat: sourceFiles.format,
        priority: workflowDeliveryPreferences.priority,
        preferenceId: workflowDeliveryPreferences.id,
      })
      .from(workflowDeliveryPreferences)
      .innerJoin(workflows, eq(workflows.id, workflowDeliveryPreferences.workflowId))
      .innerJoin(
        bookWorkflowOutputs,
        and(
          eq(bookWorkflowOutputs.workflowId, workflowDeliveryPreferences.workflowId),
          eq(bookWorkflowOutputs.status, 'success'),
          isNotNull(bookWorkflowOutputs.bookFileId),
        ),
      )
      .innerJoin(bookFiles, eq(bookFiles.id, bookWorkflowOutputs.bookFileId))
      .innerJoin(sourceFiles, eq(sourceFiles.id, bookWorkflowOutputs.sourceBookFileId))
      .where(and(eq(workflowDeliveryPreferences.userId, userId), targetClause, inArray(bookWorkflowOutputs.bookId, bookIds)));

    const selected = new Map<number, (typeof rows)[number]>();
    for (const row of rows) {
      const inputFormats = row.inputFormats ?? [];
      const sourceFormat = (row.sourceFormat ?? '').toLowerCase();
      if (inputFormats.length > 0 && !inputFormats.some((format) => format.toLowerCase() === sourceFormat)) continue;
      const current = selected.get(row.bookId);
      if (!current || row.priority < current.priority || (row.priority === current.priority && row.preferenceId < current.preferenceId)) {
        selected.set(row.bookId, row);
      }
    }
    return [...selected.values()];
  }
}
