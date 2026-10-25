import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { OpdsProgressionService } from './opds-progression.service';
import { OpdsBookService } from './opds-book.service';
import { BookService } from '../book/book.service';
import { DB } from '../../db';
import type { OpdsRequestUser } from './opds-auth.guard';
import type { OpdsProgression } from '@bookorbit/types';

const user = { userId: 42, isSuperuser: false, contentFilters: {} } as OpdsRequestUser;
const document: OpdsProgression = {
  modified: '2026-01-01T12:00:00.000Z',
  device: { id: 'urn:reader:1', name: 'Reader' },
  progression: 0.4,
  references: ['chapter.xhtml#p3'],
};
function query(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    for: vi.fn(),
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  for (const method of ['from', 'innerJoin', 'where', 'limit', 'for'] as const) chain[method].mockReturnValue(chain);
  return chain;
}

describe('OpdsProgressionService', () => {
  async function setup(previous?: Record<string, unknown>) {
    const returning = vi.fn().mockResolvedValue([{ bookFileId: 12 }]);
    const upsert = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate: upsert });
    const transaction = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValue(query(previous ? [previous] : [])),
      insert: vi.fn().mockReturnValue({ values }),
    };
    const db = {
      select: vi.fn().mockReturnValue(query([{ id: 12, bookId: 7, libraryId: 3, format: 'epub' }])),
      transaction: vi.fn((fn: (tx: typeof transaction) => unknown) => Promise.resolve(fn(transaction))),
    };
    const access = { validateBookAccess: vi.fn() };
    const books = { autoUpdateReadStatusForProgress: vi.fn(), syncKoboReadingStateForExternalProgress: vi.fn() };
    const module = await Test.createTestingModule({
      providers: [
        OpdsProgressionService,
        { provide: DB, useValue: db },
        { provide: OpdsBookService, useValue: access },
        { provide: BookService, useValue: books },
      ],
    }).compile();
    return { service: module.get(OpdsProgressionService), values, upsert, returning, db, transaction, access, books };
  }

  it('checks OPDS scope and atomically updates shared reading progress', async () => {
    const context = await setup();
    expect(await context.service.put(user, 7, document)).toEqual(document);
    expect(context.access.validateBookAccess).toHaveBeenCalledWith(7, 42, false, {});
    expect(context.transaction.execute).toHaveBeenCalledOnce();
    expect(context.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, bookFileId: 12, percentage: 40, opdsProgression: document, lastReadAt: new Date(document.modified) }),
    );
    expect(context.books.autoUpdateReadStatusForProgress).toHaveBeenCalledWith(42, expect.objectContaining({ bookId: 7 }), 40, {});
  });

  it('feeds confirmed completion into Bookorbit reading-status rules', async () => {
    const context = await setup();
    await context.service.put(user, 7, { ...document, progression: 1 });
    expect(context.books.autoUpdateReadStatusForProgress).toHaveBeenCalledWith(42, expect.objectContaining({ bookId: 7 }), 100, {});
    expect(context.books.syncKoboReadingStateForExternalProgress).toHaveBeenCalledWith(42, 12, 100);
  });

  it('rejects stale offline updates without changing progress or status', async () => {
    const context = await setup({ lastReadAt: new Date('2026-02-01'), percentage: 70 });
    await expect(context.service.put(user, 7, document)).rejects.toBeInstanceOf(ConflictException);
    expect(context.values).not.toHaveBeenCalled();
    expect(context.books.autoUpdateReadStatusForProgress).not.toHaveBeenCalled();
  });

  it('accepts idempotent retries independent of JSON object key order', async () => {
    const reordered = {
      progression: 0.4,
      device: { name: 'Reader', id: 'urn:reader:1' },
      references: ['chapter.xhtml#p3'],
      modified: document.modified,
    };
    const context = await setup({ lastReadAt: new Date(document.modified), opdsProgression: reordered });
    expect(await context.service.put(user, 7, document)).toEqual(document);
    expect(context.values).not.toHaveBeenCalled();
    expect(context.books.autoUpdateReadStatusForProgress).not.toHaveBeenCalled();
  });

  it('allows an intentional backward move when its timestamp is newer', async () => {
    const context = await setup({ lastReadAt: new Date('2025-12-31'), percentage: 90 });
    await context.service.put(user, 7, document);
    expect(context.books.autoUpdateReadStatusForProgress).toHaveBeenCalledWith(42, expect.anything(), 40, {
      origin: 'bookorbit',
      strongRereadEvidence: true,
    });
  });

  it('does not access storage for books outside the user scope', async () => {
    const context = await setup();
    context.access.validateBookAccess.mockRejectedValue(new Error('denied'));
    await expect(context.service.put(user, 7, document)).rejects.toThrow('denied');
    expect(context.db.select).not.toHaveBeenCalled();
  });
  it('rejects a newer row inserted by another reader between the read and upsert', async () => {
    const context = await setup();
    context.returning.mockResolvedValue([]);
    await expect(context.service.put(user, 7, document)).rejects.toBeInstanceOf(ConflictException);
    expect(context.upsert).toHaveBeenCalledWith(expect.objectContaining({ setWhere: expect.anything() }));
    expect(context.books.autoUpdateReadStatusForProgress).not.toHaveBeenCalled();
  });
});
