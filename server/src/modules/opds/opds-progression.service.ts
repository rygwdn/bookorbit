import { isAudioFormat } from '@bookorbit/types';
import { isDeepStrictEqual } from 'util';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { OpdsProgression } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, readingProgress } from '../../db/schema';
import { BookService } from '../book/book.service';
import { OpdsBookService } from './opds-book.service';
import type { OpdsRequestUser } from './opds-auth.guard';

const problem = (code: string, title: string) => ({ type: `https://registry.opds.io/error#${code}`, title });

@Injectable()
export class OpdsProgressionService {
  private readonly logger = new Logger(OpdsProgressionService.name);
  constructor(
    @Inject(DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly access: OpdsBookService,
    private readonly bookService: BookService,
  ) {}

  private async file(user: OpdsRequestUser, bookId: number, fileId?: number) {
    await this.access.validateBookAccess(bookId, user.userId, user.isSuperuser, user.contentFilters);
    const [file] = await this.db
      .select({ id: bookFiles.id, bookId: books.id, libraryId: books.libraryId, format: bookFiles.format })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(
        and(
          eq(books.id, bookId),
          eq(books.status, 'present'),
          eq(bookFiles.role, 'content'),
          fileId ? eq(bookFiles.id, fileId) : eq(bookFiles.id, books.primaryFileId),
        ),
      )
      .limit(1);
    if (!file) throw new NotFoundException('Publication file not found');
    return file;
  }

  async get(user: OpdsRequestUser, bookId: number, fileId?: number): Promise<OpdsProgression | null> {
    const file = await this.file(user, bookId, fileId);
    const [row] = await this.db
      .select()
      .from(readingProgress)
      .where(and(eq(readingProgress.userId, user.userId), eq(readingProgress.bookFileId, file.id)));
    if (!row) return null;
    if (row.opdsProgression && new Date(row.opdsProgression.modified).getTime() >= row.lastReadAt.getTime()) return row.opdsProgression;
    return {
      modified: row.lastReadAt.toISOString(),
      device: { id: 'urn:bookorbit:reader', name: 'Bookorbit' },
      progression: row.percentage / 100,
      ...(row.cfi
        ? { references: [`#${row.cfi}`] }
        : row.pageNumber
          ? { references: [`#page=${row.pageNumber}`] }
          : row.positionSeconds != null
            ? { references: [`#t=${row.positionSeconds}`] }
            : {}),
    };
  }

  async put(user: OpdsRequestUser, bookId: number, document: OpdsProgression, fileId?: number) {
    const startedAt = Date.now();
    this.logger.debug(`[opds.progression] [start] userId=${user.userId} bookId=${bookId} - progression update started`);
    try {
      const file = await this.file(user, bookId, fileId);
      const modified = new Date(document.modified);
      if (modified.getTime() > Date.now() + 300000)
        throw new BadRequestException(problem('progression-invalid-payload', 'Progression timestamp is in the future.'));
      const normalized = { ...document, modified: modified.toISOString() };
      const key = and(eq(readingProgress.userId, user.userId), eq(readingProgress.bookFileId, file.id));
      const result = await this.db.transaction(async (tx) => {
        // Serialize first writes too, when there is no row to lock yet.
        await tx.execute(sql`select pg_advisory_xact_lock(${user.userId}, ${file.id})`);
        const [previous] = await tx.select().from(readingProgress).where(key).for('update');
        if (previous && modified.getTime() <= previous.lastReadAt.getTime()) {
          if (modified.getTime() === previous.lastReadAt.getTime() && isDeepStrictEqual(previous.opdsProgression, normalized))
            return { document: previous.opdsProgression!, previous, replay: true };
          throw new ConflictException(problem('progression-date', 'A more recent progression point is already available.'));
        }
        const cfiReference = document.references?.find((ref) => /^#epubcfi\(/.test(ref))?.slice(1);
        const cfi = cfiReference && cfiReference.length <= 2000 ? cfiReference : null;
        const pageRef = document.references?.find((ref) => /^#page=\d+$/.test(ref));
        const pageNumber = pageRef && Number(pageRef.slice(6)) <= 2147483647 ? Number(pageRef.slice(6)) : null;
        const timeReference = document.references?.find((ref) => /^#t=\d+(?:\.\d+)?$/.test(ref));
        const seconds = timeReference ? Number(timeReference.slice(3)) : NaN;
        const positionSeconds = isAudioFormat(file.format ?? '') && Number.isFinite(seconds) && seconds <= 3.4e38 ? seconds : null;
        const values = {
          userId: user.userId,
          bookFileId: file.id,
          percentage: document.progression * 100,
          opdsProgression: normalized,
          cfi,
          pageNumber,
          updatedAt: modified,
          lastReadAt: modified,
          koboLocationSource: null,
          koboLocationType: null,
          koboLocationValue: null,
          koboContentSourceProgressPercent: null,
          koreaderProgress: null,
          positionSeconds,
        };
        const written = await tx
          .insert(readingProgress)
          .values(values)
          .onConflictDoUpdate({
            target: [readingProgress.bookFileId, readingProgress.userId],
            set: values,
            setWhere: sql`${readingProgress.lastReadAt} < ${modified.toISOString()}::timestamptz`,
          })
          .returning({ bookFileId: readingProgress.bookFileId });
        if (!written.length) throw new ConflictException(problem('progression-date', 'A more recent progression point is already available.'));
        return { document: normalized, previous, replay: false };
      });
      if (!result.replay) {
        await this.bookService.autoUpdateReadStatusForProgress(
          user.userId,
          file,
          document.progression * 100,
          result.previous && result.previous.percentage - document.progression * 100 >= 10 ? { origin: 'bookorbit', strongRereadEvidence: true } : {},
        );
        await this.bookService.syncKoboReadingStateForExternalProgress(user.userId, file.id, document.progression * 100);
      }
      this.logger.debug(
        `[opds.progression] [end] userId=${user.userId} bookId=${bookId} fileId=${file.id} durationMs=${Date.now() - startedAt} replay=${result.replay} - progression updated`,
      );
      return result.document;
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : typeof error;
      this.logger.debug(
        `[opds.progression] [fail] userId=${user.userId} bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : error)}" - progression update failed`,
      );
      throw error;
    }
  }
}
