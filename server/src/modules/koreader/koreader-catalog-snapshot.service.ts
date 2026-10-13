import { createHash, randomUUID } from 'crypto';
import { once } from 'events';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';
import { chmod, mkdir, readdir, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveTimeZone } from '../../common/utils/timezone.utils';

import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, count, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { KoreaderCatalogSnapshotBook, KoreaderCatalogSnapshotPage } from '@bookorbit/types';
import type { GroupRule } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import type { RequestUser } from '../../common/types/request-user';
import { KoreaderCatalogSnapshotQueryDto } from './dto/koreader-catalog-query.dto';

const CACHE_DIR = join(tmpdir(), 'bookorbit-koreader-snapshots');
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_BYTES = 512 * 1024 * 1024;
const BATCH_SIZE = 200;
const DISCOVER_COUNT = 12;
const CONTINUE_COUNT = 5;

type Db = NodePgDatabase<typeof schema>;
type SnapshotFilters = {
  scope: 'all' | 'selected';
  formats: string[];
  libraryIds: number[];
  collectionIds: number[];
  smartScopeIds: number[];
};
type SnapshotMeta = {
  id: string;
  userId: number;
  filterKey: string;
  permissionKey: string;
  size: number;
  filePath: string;
  lineOffsets: number[];
  total: number;
  generation: string;
  etag: string;
  sources: KoreaderCatalogSnapshotPage['sources'];
  shelves: KoreaderCatalogSnapshotPage['shelves'];
  expiresAt: number;
  bytes: number;
};
type SnapshotCursor = { snapshotId: string; offset: number };

@Injectable()
export class KoreaderCatalogSnapshotService {
  private readonly snapshots = new Map<string, SnapshotMeta>();
  private readonly cursors = new Map<string, SnapshotCursor>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly queryBuilder: BookQueryBuilder,
  ) {}

  async getPage(
    user: RequestUser,
    query: KoreaderCatalogSnapshotQueryDto,
    ifNoneMatch?: string,
  ): Promise<{ page: KoreaderCatalogSnapshotPage | null; notModified: boolean; etag: string }> {
    await this.cleanupCache();
    const size = query.size ?? 200;
    const normalized = this.normalizeQuery(query);
    const filterKey = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    let snapshot: SnapshotMeta;
    let offset = 0;

    if (query.cursor) {
      const cursor = this.cursors.get(query.cursor);
      if (!cursor) throw new BadRequestException('snapshot cursor is invalid or expired');
      const found = this.snapshots.get(cursor.snapshotId);
      if (!found || found.expiresAt <= Date.now()) throw new BadRequestException('snapshot cursor is invalid or expired');
      if (found.userId !== user.id || found.filterKey !== filterKey || found.size !== size) {
        throw new BadRequestException('snapshot cursor does not match this request');
      }
      snapshot = found;
      offset = cursor.offset;
      let currentPermissionKey: string;
      try {
        currentPermissionKey = await this.assertAuthorization(user, normalized);
      } catch (error) {
        if (error instanceof ForbiddenException) throw new BadRequestException('snapshot cursor permissions have changed');
        throw error;
      }
      if (currentPermissionKey !== found.permissionKey) throw new BadRequestException('snapshot cursor permissions have changed');
    } else {
      snapshot = await this.materialize(user, normalized, filterKey, size);
      const requestTags = ifNoneMatch?.split(',').map((tag) => tag.trim()) ?? [];
      if (requestTags.includes('*') || requestTags.includes(snapshot.etag) || requestTags.includes(`W/${snapshot.etag}`)) {
        await this.removeSnapshot(snapshot);
        return { page: null, notModified: true, etag: snapshot.etag };
      }
    }

    const books = await this.readPage(snapshot, offset, size);
    const nextOffset = offset + books.length;
    const nextCursor = nextOffset < snapshot.total ? this.issueCursor(snapshot, nextOffset) : null;
    return {
      page: {
        version: 1,
        generation: snapshot.generation,
        etag: snapshot.etag,
        total: snapshot.total,
        books,
        sources: snapshot.sources,
        shelves: snapshot.shelves,
        nextCursor,
      },
      notModified: false,
      etag: snapshot.etag,
    };
  }

  private normalizeQuery(query: KoreaderCatalogSnapshotQueryDto): SnapshotFilters {
    return {
      scope: query.scope ?? 'all',
      formats: [...new Set((query.formats ?? []).map((format) => format.toLowerCase()))].sort(),
      libraryIds: [...new Set(query.libraryIds ?? [])].sort((a, b) => a - b),
      collectionIds: [...new Set(query.collectionIds ?? [])].sort((a, b) => a - b),
      smartScopeIds: [...new Set(query.smartScopeIds ?? [])].sort((a, b) => a - b),
    };
  }

  private async materialize(user: RequestUser, filters: SnapshotFilters, filterKey: string, size: number): Promise<SnapshotMeta> {
    await mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
    await chmod(CACHE_DIR, 0o700);
    const id = randomUUID();
    const filePath = join(CACHE_DIR, `${id}.jsonl`);
    const output = createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
    const digest = createHash('sha256');
    let total = 0;
    let byteOffset = 0;
    const lineOffsets: number[] = [];
    const continueCandidates: Array<{ id: number; date: string }> = [];
    const discoverCandidates: Array<{ key: string; id: number }> = [];
    let sources: SnapshotMeta['sources'] = { libraries: [], collections: [], smartScopes: [] };
    try {
      const result = await this.db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
        const accessible = await tx
          .select({ id: schema.libraries.id, name: schema.libraries.name })
          .from(schema.libraries)
          .leftJoin(
            schema.userLibraryAccess,
            and(eq(schema.userLibraryAccess.libraryId, schema.libraries.id), eq(schema.userLibraryAccess.userId, user.id)),
          )
          .where(user.isSuperuser ? undefined : isNotNull(schema.userLibraryAccess.userId))
          .orderBy(asc(schema.libraries.name), asc(schema.libraries.id));
        const accessibleIds = accessible.map((row) => row.id);
        const visibleCollections = await tx
          .select({ id: schema.collections.id, name: schema.collections.name })
          .from(schema.collections)
          .where(and(eq(schema.collections.mediaType, 'books'), or(eq(schema.collections.userId, user.id), eq(schema.collections.isPublic, true))))
          .orderBy(asc(schema.collections.name), asc(schema.collections.id));
        const visibleScopes = await tx
          .select()
          .from(schema.smartScopes)
          .where(and(eq(schema.smartScopes.mediaType, 'books'), or(eq(schema.smartScopes.userId, user.id), eq(schema.smartScopes.isPublic, true))))
          .orderBy(asc(schema.smartScopes.name), asc(schema.smartScopes.id));
        this.assertSelectedSources(
          filters,
          accessibleIds,
          visibleCollections.map((row) => row.id),
          visibleScopes.map((row) => row.id),
        );
        const permissionKey = createHash('sha256')
          .update(
            JSON.stringify({
              libraries: [...accessibleIds].sort((a, b) => a - b),
              collections: visibleCollections.map((row) => row.id).sort((a, b) => a - b),
              smartScopes: visibleScopes.map((row) => row.id).sort((a, b) => a - b),
            }),
          )
          .digest('hex');

        const selected = filters.scope === 'selected';
        const selectedLibraryIds = selected ? filters.libraryIds : [];
        const selectedCollectionIds = selected ? filters.collectionIds : [];
        const selectedScopeIds = selected ? filters.smartScopeIds : [];
        const effectiveLibraryIds = selectedLibraryIds.length ? selectedLibraryIds : selected ? [] : accessibleIds;
        const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
        const scopeRules = (selected ? visibleScopes.filter((scope) => selectedScopeIds.includes(scope.id)) : visibleScopes)
          .filter((scope) => scope.filter !== null)
          .map((scope) => ({
            id: scope.id,
            where: this.queryBuilder.buildWhere(scope.filter as GroupRule, {
              accessibleLibraryIds: accessibleIds,
              userId: user.id,
              timeZone,
              contentFilters: user.isSuperuser ? undefined : user.contentFilters,
            })!,
          }));
        const sourceClauses: SQL[] = [];
        if (effectiveLibraryIds.length) sourceClauses.push(inArray(schema.books.libraryId, effectiveLibraryIds));
        if (selectedCollectionIds.length)
          sourceClauses.push(
            sql`${schema.books.id} in (select ${schema.collectionBooks.bookId} from ${schema.collectionBooks} where ${inArray(schema.collectionBooks.collectionId, selectedCollectionIds)})`,
          );
        if (scopeRules.length) sourceClauses.push(or(...scopeRules.map((item) => item.where))!);
        const visibleContentWhere = this.queryBuilder.buildWhere(null, {
          accessibleLibraryIds: accessibleIds,
          userId: user.id,
          timeZone,
          contentFilters: user.isSuperuser ? undefined : user.contentFilters,
        });
        const clauses = [eq(schema.books.status, 'present'), accessibleIds.length ? inArray(schema.books.libraryId, accessibleIds) : sql`false`];
        if (visibleContentWhere) clauses.push(visibleContentWhere);
        if (selected) clauses.push(sourceClauses.length ? or(...sourceClauses)! : sql`false`);
        if (filters.formats.length)
          clauses.push(
            sql`${schema.books.id} in (select ${schema.bookFiles.bookId} from ${schema.bookFiles} where ${eq(schema.bookFiles.role, 'content')} and ${inArray(sql`lower(${schema.bookFiles.format})`, filters.formats)})`,
          );
        const where = and(...clauses)!;
        const [countRow] = await tx
          .select({ total: count() })
          .from(schema.books)
          .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
          .where(where);
        const totalBooks = Number(countRow?.total ?? 0);
        const visibleLibraries = selected ? accessible.filter((library) => selectedLibraryIds.includes(library.id)) : accessible;
        const visibleCollectionsFiltered = selected
          ? visibleCollections.filter((collection) => selectedCollectionIds.includes(collection.id))
          : visibleCollections;
        const visibleScopesFiltered = selected ? visibleScopes.filter((scope) => selectedScopeIds.includes(scope.id)) : visibleScopes;
        const libCounts = new Map<number, number>();
        const collectionCounts = new Map<number, number>();
        const scopeCounts = new Map<number, number>();
        for (const row of await tx
          .select({ id: schema.books.libraryId, n: count() })
          .from(schema.books)
          .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
          .where(where)
          .groupBy(schema.books.libraryId))
          libCounts.set(row.id, Number(row.n));
        const collectionRows = visibleCollectionsFiltered.length
          ? await tx
              .select({ id: schema.collectionBooks.collectionId, n: count(sql`distinct ${schema.collectionBooks.bookId}`) })
              .from(schema.collectionBooks)
              .innerJoin(schema.books, eq(schema.books.id, schema.collectionBooks.bookId))
              .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
              .where(
                and(
                  where,
                  inArray(
                    schema.collectionBooks.collectionId,
                    visibleCollectionsFiltered.map((row) => row.id),
                  ),
                ),
              )
              .groupBy(schema.collectionBooks.collectionId)
          : [];
        for (const row of collectionRows) collectionCounts.set(row.id, Number(row.n));
        sources = {
          libraries: visibleLibraries.map((row) => ({ id: row.id, name: row.name, bookCount: libCounts.get(row.id) ?? 0 })),
          collections: visibleCollectionsFiltered.map((row) => ({ id: row.id, name: row.name, bookCount: collectionCounts.get(row.id) ?? 0 })),
          smartScopes: [],
        };

        let lastId = 0;
        for (;;) {
          const ids = await tx
            .select({ id: schema.books.id })
            .from(schema.books)
            .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
            .where(and(where, gt(schema.books.id, lastId)))
            .orderBy(asc(schema.books.id))
            .limit(BATCH_SIZE);
          if (!ids.length) break;
          lastId = ids[ids.length - 1]!.id;
          const bookIds = ids.map((row) => row.id);
          const [metaRows, authorRows, fileRows, statusRows, progressRows, coverRows, collectionMemberships, genreRows, tagRows, ratingRows] =
            await Promise.all([
              tx
                .select({
                  id: schema.books.id,
                  libraryId: schema.books.libraryId,
                  libraryName: schema.libraries.name,
                  folderPath: schema.books.folderPath,
                  addedAt: schema.books.addedAt,
                  updatedAt: schema.books.updatedAt,
                  title: schema.bookMetadata.title,
                  subtitle: schema.bookMetadata.subtitle,
                  description: schema.bookMetadata.description,
                  seriesName: schema.bookMetadata.seriesName,
                  seriesIndex: schema.bookMetadata.seriesIndex,
                  language: schema.bookMetadata.language,
                  publisher: schema.bookMetadata.publisher,
                  publishedDate: schema.bookMetadata.publishedDate,
                  publishedYear: schema.bookMetadata.publishedYear,
                  isbn10: schema.bookMetadata.isbn10,
                  isbn13: schema.bookMetadata.isbn13,
                  rating: schema.bookMetadata.rating,
                  pageCount: schema.bookMetadata.pageCount,
                  metadataRevision: schema.bookMetadata.updatedAt,
                  coverSource: schema.bookMetadata.coverSource,
                  coverUpdatedAt: schema.bookMetadata.coverUpdatedAt,
                })
                .from(schema.books)
                .innerJoin(schema.libraries, eq(schema.libraries.id, schema.books.libraryId))
                .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
                .where(inArray(schema.books.id, bookIds))
                .orderBy(asc(schema.books.id)),
              tx
                .select({ bookId: schema.bookAuthors.bookId, name: schema.authors.name })
                .from(schema.bookAuthors)
                .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
                .where(inArray(schema.bookAuthors.bookId, bookIds))
                .orderBy(asc(schema.bookAuthors.displayOrder), asc(schema.bookAuthors.authorId)),
              tx
                .select({
                  bookId: schema.bookFiles.bookId,
                  id: schema.bookFiles.id,
                  format: schema.bookFiles.format,
                  sizeBytes: schema.bookFiles.sizeBytes,
                  updatedAt: schema.bookFiles.updatedAt,
                  role: schema.bookFiles.role,
                })
                .from(schema.bookFiles)
                .where(and(inArray(schema.bookFiles.bookId, bookIds), eq(schema.bookFiles.role, 'content')))
                .orderBy(asc(schema.bookFiles.sortOrder), asc(schema.bookFiles.id)),
              tx
                .select({ bookId: schema.userBookStatus.bookId, status: schema.userBookStatus.status })
                .from(schema.userBookStatus)
                .where(and(eq(schema.userBookStatus.userId, user.id), inArray(schema.userBookStatus.bookId, bookIds))),
              tx
                .select({
                  bookId: schema.bookFiles.bookId,
                  fileId: schema.readingProgress.bookFileId,
                  percentage: schema.readingProgress.percentage,
                  koreaderProgress: schema.readingProgress.koreaderProgress,
                  lastReadAt: schema.readingProgress.lastReadAt,
                  updatedAt: schema.readingProgress.updatedAt,
                })
                .from(schema.readingProgress)
                .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.readingProgress.bookFileId))
                .where(and(eq(schema.readingProgress.userId, user.id), inArray(schema.bookFiles.bookId, bookIds))),
              tx
                .select({ bookId: schema.bookCovers.bookId, updatedAt: schema.bookCovers.updatedAt })
                .from(schema.bookCovers)
                .where(and(inArray(schema.bookCovers.bookId, bookIds), eq(schema.bookCovers.medium, 'ebook'))),
              selected || visibleCollectionsFiltered.length
                ? tx
                    .select({ bookId: schema.collectionBooks.bookId, collectionId: schema.collectionBooks.collectionId })
                    .from(schema.collectionBooks)
                    .where(
                      and(
                        inArray(schema.collectionBooks.bookId, bookIds),
                        inArray(
                          schema.collectionBooks.collectionId,
                          visibleCollectionsFiltered.map((row) => row.id),
                        ),
                      ),
                    )
                : Promise.resolve([]),
              tx
                .select({ bookId: schema.bookGenres.bookId, name: schema.genres.name })
                .from(schema.bookGenres)
                .innerJoin(schema.genres, eq(schema.genres.id, schema.bookGenres.genreId))
                .where(inArray(schema.bookGenres.bookId, bookIds))
                .orderBy(asc(schema.genres.name)),
              tx
                .select({ bookId: schema.bookTags.bookId, name: schema.tags.name })
                .from(schema.bookTags)
                .innerJoin(schema.tags, eq(schema.tags.id, schema.bookTags.tagId))
                .where(inArray(schema.bookTags.bookId, bookIds))
                .orderBy(asc(schema.tags.name)),
              tx
                .select({ bookId: schema.userBookRatings.bookId, rating: schema.userBookRatings.rating })
                .from(schema.userBookRatings)
                .where(and(eq(schema.userBookRatings.userId, user.id), inArray(schema.userBookRatings.bookId, bookIds))),
            ]);
          const authorsByBook = groupRows(
            authorRows,
            (row) => row.bookId,
            (row) => row.name,
          );
          const collectionByBook = groupRows(
            collectionMemberships,
            (row) => row.bookId,
            (row) => row.collectionId,
          );
          const filesByBook = groupRows(
            fileRows,
            (row) => row.bookId,
            (row) => ({ id: row.id, format: row.format ?? 'unknown', sizeBytes: row.sizeBytes, contentVersion: row.updatedAt.toISOString() }),
          );
          const statusByBook = new Map(statusRows.map((row) => [row.bookId, row.status]));
          const genreByBook = groupRows(
            genreRows,
            (row) => row.bookId,
            (row) => row.name,
          );
          const tagByBook = groupRows(
            tagRows,
            (row) => row.bookId,
            (row) => row.name,
          );
          const userRatingByBook = new Map(ratingRows.map((row) => [row.bookId, row.rating]));
          const progressByBook = new Map<number, (typeof progressRows)[number]>();
          for (const row of progressRows) {
            const current = progressByBook.get(row.bookId);
            if (
              !current ||
              row.updatedAt > current.updatedAt ||
              (row.updatedAt.getTime() === current.updatedAt.getTime() && row.fileId < current.fileId)
            ) {
              progressByBook.set(row.bookId, row);
            }
          }
          const coverByBook = new Map(coverRows.map((row) => [row.bookId, row.updatedAt.toISOString()]));
          const scopeQueries = scopeRules.map((scope) =>
            tx
              .select({ bookId: schema.books.id, scopeId: sql<number>`${scope.id}::integer` })
              .from(schema.books)
              .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
              .where(and(inArray(schema.books.id, bookIds), scope.where)),
          );
          const scopeMembershipRows =
            scopeQueries.length === 0
              ? []
              : scopeQueries.length === 1
                ? await scopeQueries[0]!
                : await unionAll(scopeQueries[0]!, scopeQueries[1]!, ...scopeQueries.slice(2));
          const scopeMemberships = new Map<number, number[]>();
          for (const membership of scopeMembershipRows) {
            scopeMemberships.set(membership.bookId, [...(scopeMemberships.get(membership.bookId) ?? []), membership.scopeId]);
            scopeCounts.set(membership.scopeId, (scopeCounts.get(membership.scopeId) ?? 0) + 1);
          }
          for (const row of metaRows) {
            const progress = progressByBook.get(row.id);
            const memberships = {
              libraryIds: [row.libraryId],
              collectionIds: (collectionByBook.get(row.id) ?? []).sort((a, b) => a - b),
              smartScopeIds: (scopeMemberships.get(row.id) ?? []).sort((a, b) => a - b),
            };
            const files = (filesByBook.get(row.id) ?? []).filter(
              (file) => !filters.formats.length || filters.formats.includes(file.format.toLowerCase()),
            );
            const book: KoreaderCatalogSnapshotBook = {
              id: row.id,
              title: row.title ?? row.folderPath.split('/').pop() ?? `Book ${row.id}`,
              subtitle: row.subtitle,
              description: row.description,
              authors: authorsByBook.get(row.id) ?? [],
              genres: genreByBook.get(row.id) ?? [],
              tags: tagByBook.get(row.id) ?? [],
              seriesName: row.seriesName,
              seriesIndex: row.seriesIndex,
              language: row.language,
              publisher: row.publisher,
              publishedDate: row.publishedDate,
              publishedYear: row.publishedYear,
              isbn10: row.isbn10,
              isbn13: row.isbn13,
              rating: row.rating,
              pageCount: row.pageCount,
              metadataRevision: row.metadataRevision?.toISOString() ?? null,
              addedAt: row.addedAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
              libraryId: row.libraryId,
              libraryName: row.libraryName,
              files,
              progress: progress
                ? {
                    fileId: progress.fileId,
                    percentage: progress.percentage,
                    koreaderProgress: progress.koreaderProgress,
                    updatedAt: progress.updatedAt.toISOString(),
                  }
                : null,
              progressPercentage: progress?.percentage ?? null,
              lastReadAt: progress?.lastReadAt?.toISOString() ?? null,
              readStatus: statusByBook.get(row.id) ?? null,
              userRating: userRatingByBook.get(row.id) ?? null,
              hasCover: row.coverSource !== null || coverByBook.has(row.id),
              coverRevision: row.coverUpdatedAt?.toISOString() ?? coverByBook.get(row.id) ?? null,
              memberships,
            };
            const json = JSON.stringify(book);
            const line = `${json}\n`;
            if (total % BATCH_SIZE === 0) lineOffsets.push(byteOffset);
            byteOffset += Buffer.byteLength(line);
            if (!output.write(line)) await once(output, 'drain');
            digest.update(line);
            total += 1;
            if (
              progress?.lastReadAt &&
              (statusByBook.get(row.id) === 'reading' || statusByBook.get(row.id) === 'rereading' || statusByBook.get(row.id) === 'on_hold')
            ) {
              keepTop(
                continueCandidates,
                { id: row.id, date: progress.lastReadAt.toISOString() },
                CONTINUE_COUNT,
                (a, b) => b.date.localeCompare(a.date) || a.id - b.id,
              );
            }
            keepTop(
              discoverCandidates,
              { id: row.id, key: createHash('sha256').update(`${filterKey}:${row.id}`).digest('hex') },
              DISCOVER_COUNT,
              (a, b) => a.key.localeCompare(b.key),
            );
          }
        }
        sources.smartScopes = visibleScopesFiltered.map((row) => ({ id: row.id, name: row.name, bookCount: scopeCounts.get(row.id) ?? 0 }));
        return { total: totalBooks, permissionKey };
      });
      output.end();
      await once(output, 'close');
      const shelfContinue = continueCandidates.sort((a, b) => b.date.localeCompare(a.date) || a.id - b.id).map((row) => row.id);
      const shelfDiscover = discoverCandidates.sort((a, b) => a.key.localeCompare(b.key)).map((row) => row.id);
      digest.update(JSON.stringify(sources));
      const generation = digest.digest('hex');
      const etag = `"${createHash('sha256').update(`${generation}:${filterKey}:${result.permissionKey}:${size}`).digest('hex')}"`;
      const bytes = (await stat(filePath)).size;
      const snapshot: SnapshotMeta = {
        id,
        userId: user.id,
        filterKey,
        permissionKey: result.permissionKey,
        size,
        filePath,
        lineOffsets,
        total: result.total,
        generation,
        etag,
        sources,
        shelves: { continueReading: shelfContinue, discover: shelfDiscover },
        expiresAt: Date.now() + CACHE_TTL_MS,
        bytes,
      };
      this.snapshots.set(id, snapshot);
      return snapshot;
    } catch (error) {
      output.destroy();
      await rm(filePath, { force: true });
      throw error;
    }
  }

  private async assertAuthorization(user: RequestUser, filters: SnapshotFilters): Promise<string> {
    const accessibleRows = await this.db
      .select({ id: schema.libraries.id })
      .from(schema.libraries)
      .leftJoin(
        schema.userLibraryAccess,
        and(eq(schema.userLibraryAccess.libraryId, schema.libraries.id), eq(schema.userLibraryAccess.userId, user.id)),
      )
      .where(user.isSuperuser ? undefined : isNotNull(schema.userLibraryAccess.userId));
    const collectionsRows = await this.db
      .select({ id: schema.collections.id })
      .from(schema.collections)
      .where(and(eq(schema.collections.mediaType, 'books'), or(eq(schema.collections.userId, user.id), eq(schema.collections.isPublic, true))));
    const scopeRows = await this.db
      .select({ id: schema.smartScopes.id })
      .from(schema.smartScopes)
      .where(and(eq(schema.smartScopes.mediaType, 'books'), or(eq(schema.smartScopes.userId, user.id), eq(schema.smartScopes.isPublic, true))));
    this.assertSelectedSources(
      filters,
      accessibleRows.map((row) => row.id),
      collectionsRows.map((row) => row.id),
      scopeRows.map((row) => row.id),
    );
    return createHash('sha256')
      .update(
        JSON.stringify({
          libraries: accessibleRows.map((row) => row.id).sort((a, b) => a - b),
          collections: collectionsRows.map((row) => row.id).sort((a, b) => a - b),
          smartScopes: scopeRows.map((row) => row.id).sort((a, b) => a - b),
        }),
      )
      .digest('hex');
  }

  private assertSelectedSources(filters: SnapshotFilters, libraries: number[], collections: number[] = [], scopes: number[] = []) {
    if (filters.scope !== 'selected') return;
    for (const id of filters.libraryIds) if (!libraries.includes(id)) throw new ForbiddenException('No access to selected library');
    for (const id of filters.collectionIds) if (!collections.includes(id)) throw new ForbiddenException('No access to selected collection');
    for (const id of filters.smartScopeIds) if (!scopes.includes(id)) throw new ForbiddenException('No access to selected SmartScope');
  }

  private issueCursor(snapshot: SnapshotMeta, offset: number): string {
    const cursor = randomUUID();
    this.cursors.set(cursor, { snapshotId: snapshot.id, offset });
    return cursor;
  }

  private async readPage(snapshot: SnapshotMeta, offset: number, size: number): Promise<KoreaderCatalogSnapshotBook[]> {
    const baseLine = Math.floor(offset / BATCH_SIZE) * BATCH_SIZE;
    const start = snapshot.lineOffsets[Math.floor(offset / BATCH_SIZE)] ?? 0;
    const books: KoreaderCatalogSnapshotBook[] = [];
    let skipped = 0;
    const lines = createInterface({ input: createReadStream(snapshot.filePath, { start }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (skipped++ < offset - baseLine || line.length === 0) continue;
      books.push(JSON.parse(line) as KoreaderCatalogSnapshotBook);
      if (books.length === size) break;
    }
    lines.close();
    return books;
  }

  private async cleanupCache() {
    const now = Date.now();
    for (const snapshot of this.snapshots.values()) if (snapshot.expiresAt <= now) await this.removeSnapshot(snapshot);
    let totalBytes = [...this.snapshots.values()].reduce((sum, snapshot) => sum + snapshot.bytes, 0);
    const oldest = [...this.snapshots.values()].sort((a, b) => a.expiresAt - b.expiresAt);
    for (const snapshot of oldest) {
      if (totalBytes <= CACHE_MAX_BYTES) break;
      totalBytes -= snapshot.bytes;
      await this.removeSnapshot(snapshot);
    }
    try {
      for (const name of await readdir(CACHE_DIR)) {
        if (!name.endsWith('.jsonl') || this.snapshots.has(name.slice(0, -6))) continue;
        const filePath = join(CACHE_DIR, name);
        const file = await stat(filePath);
        if (now - file.mtimeMs > CACHE_TTL_MS) await rm(filePath, { force: true });
      }
    } catch {
      /* Cache directory may not exist until the first snapshot. */
    }
  }

  private async removeSnapshot(snapshot: SnapshotMeta) {
    this.snapshots.delete(snapshot.id);
    for (const [token, cursor] of this.cursors) if (cursor.snapshotId === snapshot.id) this.cursors.delete(token);
    await rm(snapshot.filePath, { force: true });
  }
}

function groupRows<T, K extends string | number, V>(rows: T[], keyOf: (row: T) => K, valueOf: (row: T) => V): Map<K, V[]> {
  const result = new Map<K, V[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const values = result.get(key);
    if (values) values.push(valueOf(row));
    else result.set(key, [valueOf(row)]);
  }
  return result;
}

function keepTop<T>(items: T[], candidate: T, limit: number, compare: (left: T, right: T) => number) {
  items.push(candidate);
  items.sort(compare);
  if (items.length > limit) items.pop();
}
