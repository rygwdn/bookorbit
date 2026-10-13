import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { Permission } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createReaderStateIsolationE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  type CreatedLibrary,
  type ReaderStateIsolationE2EContext,
  type TestUserSession,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

const DEVICE_PASSWORD = 'SnapshotDevicePass123';
const PAGE_SIZE = 1;

type SnapshotPage = {
  version: 1;
  generation: string;
  etag: string;
  total: number;
  books: Array<{
    id: number;
    title: string;
    files: Array<{ id: number; format: string; sizeBytes: number | null; contentVersion: string }>;
    progressPercentage: number | null;
    lastReadAt: string | null;
    readStatus: string | null;
    hasCover: boolean;
    coverRevision: string | null;
    memberships: { libraryIds: number[]; collectionIds: number[]; smartScopeIds: number[] };
  }>;
  sources: { libraries: Array<{ id: number }>; collections: Array<{ id: number }>; smartScopes: Array<{ id: number }> };
  shelves: { continueReading: number[]; discover: number[] };
  nextCursor: string | null;
};

describe('KOReader catalog snapshot API (e2e)', { timeout: 120_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let libraryA!: CreatedLibrary;
  let libraryB!: CreatedLibrary;
  let user!: TestUserSession;
  let otherUser!: TestUserSession;
  let credentials!: { username: string; password: string };
  let otherCredentials!: { username: string; password: string };
  let collectionId!: number;
  let foreignCollectionId!: number;
  let smartScopeId!: number;
  let foreignSmartScopeId!: number;
  let primaryBookId!: number;
  let inaccessibleLibraryBookId!: number;
  let pdfOnlyBookId!: number;
  let epubFileId!: number;
  async function addBook(library: CreatedLibrary, title: string, formats: string[]): Promise<{ id: number; fileIds: number[] }> {
    const [book] = await ctx.db
      .insert(schema.books)
      .values({
        libraryId: library.libraryId,
        libraryFolderId: library.libraryFolderId,
        folderPath: `${library.folderPath}/${title.replaceAll(' ', '-')}`,
        status: 'present',
      })
      .returning({ id: schema.books.id });
    await ctx.db.insert(schema.bookMetadata).values({ bookId: book.id, title, publisher: 'Snapshot Publisher' });
    const files = await ctx.db
      .insert(schema.bookFiles)
      .values(
        formats.map((format, index) => ({
          bookId: book.id,
          libraryFolderId: library.libraryFolderId,
          absolutePath: `${library.folderPath}/${title.replaceAll(' ', '-')}/book-${index}.${format}`,
          relPath: `book-${index}.${format}`,
          ino: BigInt(book.id * 10 + index),
          sizeBytes: 1024 + index,
          format,
        })),
      )
      .returning({ id: schema.bookFiles.id });
    return { id: book.id, fileIds: files.map((file) => file.id) };
  }

  async function createCredentials(session: TestUserSession, label: string): Promise<{ username: string; password: string }> {
    const value = { username: `snapshot-${label}-${randomUUID().slice(0, 8)}`, password: DEVICE_PASSWORD };
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/credentials',
      headers: authHeader(session.accessToken),
      payload: value,
    });
    expect([200, 201]).toContain(response.statusCode);
    return value;
  }

  async function fetchSnapshot(auth = credentials, params: Record<string, string> = {}, headers: Record<string, string> = {}) {
    const query = new URLSearchParams(params);
    const encoded = query.toString();
    const suffix = encoded ? `?${encoded}` : '';
    return ctx.app.inject({
      method: 'GET',
      url: `/api/v1/koreader/plugin/catalog/snapshot${suffix}`,
      headers: { 'x-auth-user': auth.username, 'x-auth-key': auth.password, ...headers },
    });
  }

  async function page(params: Record<string, string> = {}, auth = credentials, headers: Record<string, string> = {}): Promise<SnapshotPage> {
    const response = await fetchSnapshot(auth, params, headers);
    expect(response.statusCode).toBe(200);
    return response.json() as SnapshotPage;
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    libraryA = await createLibraryWithFolder(ctx, { name: `snapshot-a-${randomUUID()}` });
    libraryB = await createLibraryWithFolder(ctx, { name: `snapshot-b-${randomUUID()}` });

    const primary = await addBook(libraryA, 'Shared EPUB and PDF', ['epub', 'pdf']);
    primaryBookId = primary.id;
    epubFileId = primary.fileIds[0]!;
    const pdfOnly = await addBook(libraryA, 'PDF-only matching book', ['pdf']);
    pdfOnlyBookId = pdfOnly.id;
    const inaccessible = await addBook(libraryB, 'Inaccessible Library Book', ['epub']);
    inaccessibleLibraryBookId = inaccessible.id;
    await addBook(libraryB, 'Private Unselected Book', ['epub']);
    await addBook(libraryA, 'Format Excluded Book', ['mobi']);
    user = await createUserAndLogin(ctx, { permissions: [Permission.KoreaderSync] });
    otherUser = await createUserAndLogin(ctx, { permissions: [Permission.KoreaderSync] });
    await grantLibraryAccess(ctx, user.userId, libraryA.libraryId);
    // Library B is intentionally inaccessible to this reader and has lower-level private records.

    const [collection] = await ctx.db
      .insert(schema.collections)
      .values({ userId: user.userId, mediaType: 'books', name: `Snapshot collection ${randomUUID()}` })
      .returning({ id: schema.collections.id });
    collectionId = collection.id;
    await ctx.db.insert(schema.collectionBooks).values({ collectionId, bookId: primaryBookId });
    const [foreignCollection] = await ctx.db
      .insert(schema.collections)
      .values({ userId: otherUser.userId, mediaType: 'books', name: `Private collection ${randomUUID()}` })
      .returning({ id: schema.collections.id });
    foreignCollectionId = foreignCollection.id;

    const [scope] = await ctx.db
      .insert(schema.smartScopes)
      .values({
        userId: user.userId,
        mediaType: 'books',
        name: `Snapshot scope ${randomUUID()}`,
        filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'isNotEmpty' }] },
      })
      .returning({ id: schema.smartScopes.id });
    smartScopeId = scope.id;
    const [foreignScope] = await ctx.db
      .insert(schema.smartScopes)
      .values({ userId: otherUser.userId, mediaType: 'books', name: `Private scope ${randomUUID()}`, filter: null })
      .returning({ id: schema.smartScopes.id });
    foreignSmartScopeId = foreignScope.id;

    await ctx.db.insert(schema.userBookStatus).values({ userId: user.userId, bookId: primaryBookId, status: 'reading', source: 'manual' });
    await ctx.db.insert(schema.bookCovers).values({
      bookId: primaryBookId,
      medium: 'ebook',
      source: 'extracted',
      origin: 'embedded',
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    await ctx.db.insert(schema.readingProgress).values({
      userId: user.userId,
      bookFileId: epubFileId,
      percentage: 25,
      koreaderProgress: 'chapter-1',
      lastReadAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    credentials = await createCredentials(user, 'owner');
    otherCredentials = await createCredentials(otherUser, 'other');
  });

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('unions selected source families, applies formats as ANY, deduplicates canonical books, and enforces library access', async () => {
    const result = await page({
      scope: 'selected',
      libraryIds: String(libraryA.libraryId),
      collectionIds: String(collectionId),
      smartScopeIds: String(smartScopeId),
      formats: 'epub,pdf',
      size: '20',
    });

    const included = result.books.map((book) => book.id);
    expect(result.total).toBe(included.length);
    expect(new Set(included).size).toBe(included.length);
    expect(included).toContain(primaryBookId);
    expect(included).toContain(pdfOnlyBookId);
    expect(included).not.toContain(inaccessibleLibraryBookId);
    expect(included).not.toContain(await findBookId('Private Unselected Book'));
    expect(included).not.toContain(await findBookId('Format Excluded Book'));
    expect(result.sources.libraries.map((source) => source.id)).toEqual([libraryA.libraryId]);
    expect(result.sources.collections.map((source) => source.id)).toEqual([collectionId]);
    expect(result.sources.smartScopes.map((source) => source.id)).toEqual([smartScopeId]);

    const primary = result.books.find((book) => book.id === primaryBookId)!;
    expect(primary.memberships).toEqual({
      libraryIds: [libraryA.libraryId],
      collectionIds: [collectionId],
      smartScopeIds: expect.arrayContaining([smartScopeId]),
    });
    expect(primary.title).toBe('Shared EPUB and PDF');
    expect(primary.files.map((file) => file.format)).toEqual(['epub', 'pdf']);
    expect(primary.files.every((file) => file.sizeBytes !== null && file.contentVersion.length > 0)).toBe(true);
    expect(primary.readStatus).toBe('reading');
    expect(primary.progressPercentage).toBe(25);
    expect(primary.lastReadAt).toBe('2026-01-01T00:00:00.000Z');
    expect(primary.hasCover).toBe(true);
    expect(primary.coverRevision).toBe('2026-01-02T00:00:00.000Z');
  });

  it('fails closed for selected private sources and empty selected scope, and rejects malformed filters', async () => {
    const inaccessibleLibrary = await createLibraryWithFolder(ctx, { name: `snapshot-hidden-${randomUUID()}` });
    await addBook(inaccessibleLibrary, 'Hidden selected source', ['epub']);
    const forbiddenLibrary = await fetchSnapshot(credentials, { scope: 'selected', libraryIds: String(inaccessibleLibrary.libraryId) });
    expect(forbiddenLibrary.statusCode).toBe(403);
    const forbiddenCollection = await fetchSnapshot(credentials, { scope: 'selected', collectionIds: String(foreignCollectionId) });
    expect(forbiddenCollection.statusCode).toBe(403);
    const forbiddenSmartScope = await fetchSnapshot(credentials, { scope: 'selected', smartScopeIds: String(foreignSmartScopeId) });
    expect(forbiddenSmartScope.statusCode).toBe(403);
    const allVisible = await page({ scope: 'all', size: '20' });
    expect(allVisible.sources.libraries.map((source) => source.id)).not.toContain(inaccessibleLibrary.libraryId);
    expect(allVisible.sources.collections.map((source) => source.id)).not.toContain(foreignCollectionId);
    expect(allVisible.sources.smartScopes.map((source) => source.id)).not.toContain(foreignSmartScopeId);
    expect(allVisible.books.map((book) => book.id)).not.toContain(await findBookId('Hidden selected source'));

    const empty = await page({ scope: 'selected', size: '20' });
    expect(empty.total).toBe(0);
    expect(empty.books).toEqual([]);
    expect(empty.shelves.continueReading).toEqual([]);
    expect(empty.shelves.discover).toEqual([]);

    for (const params of [
      { scope: 'invalid' },
      { libraryIds: '1,nope' },
      { collectionIds: '0' },
      { formats: 'not-a-real-format' },
      { size: '201' },
    ]) {
      const response = await fetchSnapshot(credentials, params);
      expect(response.statusCode).toBe(400);
    }
  });

  it('binds cursors to identity, normalized filters, and page size; frozen pages ignore later database changes', async () => {
    const initial = await page({ scope: 'all', formats: 'epub,pdf', size: String(PAGE_SIZE) });
    expect(initial.nextCursor).toEqual(expect.any(String));
    const cursor = initial.nextCursor!;
    const startedIds = initial.books.map((book) => book.id);

    const later = await addBook(libraryA, 'Added after snapshot', ['epub']);
    const second = await page({ scope: 'all', formats: 'pdf,epub', size: String(PAGE_SIZE), cursor });
    expect(second.generation).toBe(initial.generation);
    expect(second.books.map((book) => book.id)).not.toContain(later.id);
    expect(second.books.map((book) => book.id)).not.toEqual(expect.arrayContaining(startedIds));

    for (const [auth, params] of [
      [otherCredentials, { scope: 'all', formats: 'pdf,epub', size: String(PAGE_SIZE), cursor }],
      [credentials, { scope: 'all', formats: 'epub,pdf', size: String(PAGE_SIZE + 1), cursor }],
      [credentials, { scope: 'selected', formats: 'pdf,epub', size: String(PAGE_SIZE), cursor }],
    ] as const) {
      const response = await fetchSnapshot(auth, params);
      expect(response.statusCode).toBe(400);
    }
    const malformed = await fetchSnapshot(credentials, { cursor: 'not-a-valid-cursor' });
    expect(malformed.statusCode).toBe(400);
  });

  it('revalidates library access, computes complete stable ETags, supports 304, and bounds shelves to included books', async () => {
    const before = await page({ scope: 'all', size: '20' });
    expect(before.etag).toEqual(expect.any(String));
    const unchanged = await fetchSnapshot(credentials, { scope: 'all', size: '20' }, { 'if-none-match': before.etag });
    expect(unchanged.statusCode).toBe(304);
    const stable = await page({ scope: 'all', size: '20' });
    expect(stable.etag).toBe(before.etag);

    const visibleIds = new Set(before.books.map((book) => book.id));
    for (const id of [...before.shelves.continueReading, ...before.shelves.discover]) expect(visibleIds.has(id)).toBe(true);
    await ctx.db
      .update(schema.bookCovers)
      .set({ updatedAt: new Date('2026-02-02T00:00:00.000Z') })
      .where(eq(schema.bookCovers.bookId, primaryBookId));
    const afterCover = await page({ scope: 'all', size: '20' });
    expect(afterCover.etag).not.toBe(before.etag);

    await ctx.db.update(schema.bookMetadata).set({ publisher: 'Changed Snapshot Publisher' }).where(eq(schema.bookMetadata.bookId, primaryBookId));
    const afterMetadata = await page({ scope: 'all', size: '20' });
    expect(afterMetadata.etag).not.toBe(afterCover.etag);

    await ctx.db
      .update(schema.bookFiles)
      .set({ updatedAt: new Date('2026-02-03T00:00:00.000Z') })
      .where(eq(schema.bookFiles.id, epubFileId));
    const afterFile = await page({ scope: 'all', size: '20' });
    expect(afterFile.etag).not.toBe(afterMetadata.etag);

    await ctx.db
      .update(schema.readingProgress)
      .set({ percentage: 75, koreaderProgress: 'chapter-3' })
      .where(and(eq(schema.readingProgress.userId, user.userId), eq(schema.readingProgress.bookFileId, epubFileId)));
    const afterProgress = await page({ scope: 'all', size: '20' });
    expect(afterProgress.etag).not.toBe(afterFile.etag);

    await ctx.db
      .delete(schema.collectionBooks)
      .where(and(eq(schema.collectionBooks.collectionId, collectionId), eq(schema.collectionBooks.bookId, primaryBookId)));
    const afterMembership = await page({ scope: 'all', size: '20' });
    expect(afterMembership.etag).not.toBe(afterProgress.etag);

    await ctx.db
      .update(schema.userBookStatus)
      .set({ status: 'read' })
      .where(and(eq(schema.userBookStatus.userId, user.userId), eq(schema.userBookStatus.bookId, primaryBookId)));
    const afterStatus = await page({ scope: 'all', size: '20' });
    expect(afterStatus.etag).not.toBe(afterMembership.etag);

    const revokeSnapshot = await page({ scope: 'all', size: String(PAGE_SIZE) });
    expect(revokeSnapshot.nextCursor).toEqual(expect.any(String));
    await ctx.db.delete(schema.userLibraryAccess).where(eq(schema.userLibraryAccess.libraryId, libraryA.libraryId));
    const revoked = await fetchSnapshot(credentials, {
      scope: 'all',
      size: String(PAGE_SIZE),
      cursor: revokeSnapshot.nextCursor!,
    });
    expect(revoked.statusCode).toBe(400);
    const current = await page({ scope: 'all', size: '20' });
    expect(current.books.map((book) => book.id)).not.toContain(primaryBookId);
  });

  async function findBookId(title: string): Promise<number> {
    const [row] = await ctx.db.select({ id: schema.bookMetadata.bookId }).from(schema.bookMetadata).where(eq(schema.bookMetadata.title, title));
    return row!.id;
  }
});
