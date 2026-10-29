import { plainToInstance } from 'class-transformer';
import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { OpdsProgressionService } from './opds-progression.service';
import { OpdsBookService } from './opds-book.service';
import { BookService } from '../book/book.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED } from '../achievement/achievement-events.service';
import { DB } from '../../db';
import type { OpdsRequestUser } from './opds-auth.guard';
import type { OpdsProgression } from '@bookorbit/types';
import { OpdsProgressionDto } from './dto/opds-progression.dto';

const user = { userId: 42, isSuperuser: false, contentFilters: {} } as OpdsRequestUser;
const document: OpdsProgression = {
  modified: '2026-01-01T12:00:00.000Z',
  device: { id: 'urn:reader:1', name: 'Reader' },
  progression: 0.4,
  references: ['chapter.xhtml#p3'],
};
const fileRows = [{ id: 12, bookId: 7, libraryId: 3, format: 'epub' }];
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
  // Per put call the service reads twice: the publication file on the shared connection, then
  // the stored progression row inside the write transaction that applies the effects.
  async function setup(previous?: Record<string, unknown>) {
    const returning = vi.fn().mockResolvedValue([{ bookFileId: 12 }]);
    const upsert = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate: upsert });
    const transaction = {
      execute: vi.fn(),
      select: vi.fn().mockImplementation(() => query(txRows.shift() ?? [])),
      insert: vi.fn().mockReturnValue({ values }),
    };
    const dbRows: unknown[][] = [];
    const txRows: unknown[][] = [];
    const db = {
      select: vi.fn().mockImplementation(() => query(dbRows.shift() ?? [])),
      transaction: vi.fn((fn: (tx: typeof transaction) => unknown) => Promise.resolve(fn(transaction))),
    };
    const access = { validateBookAccess: vi.fn() };
    const books = { autoUpdateReadStatusForProgress: vi.fn().mockResolvedValue([]), syncKoboReadingStateForExternalProgress: vi.fn() };
    const achievementEmit = vi.fn();
    const module = await Test.createTestingModule({
      providers: [
        OpdsProgressionService,
        { provide: DB, useValue: db },
        { provide: OpdsBookService, useValue: access },
        { provide: BookService, useValue: books },
        { provide: AchievementEventsService, useValue: { emit: achievementEmit } },
      ],
    }).compile();
    const queue = (rows: unknown[][]) => dbRows.push(...rows);
    const txQueue = (rows: unknown[][]) => txRows.push(...rows);
    // The file lookup happens before the transaction; the stored progression row is read inside it.
    queue([fileRows]);
    txQueue(previous ? [[previous]] : []);
    return {
      service: module.get(OpdsProgressionService),
      values,
      upsert,
      returning,
      db,
      transaction,
      access,
      books,
      achievementEmit,
      queue,
      txQueue,
    };
  }

  it('checks OPDS scope and updates shared reading progress', async () => {
    const context = await setup();
    expect(await context.service.put(user, 7, document)).toEqual(document);
    expect(context.access.validateBookAccess).toHaveBeenCalledWith(7, 42, false, {});
    expect(context.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, bookFileId: 12, percentage: 40, opdsProgression: document, lastReadAt: new Date(document.modified) }),
    );
    expect(context.books.autoUpdateReadStatusForProgress.mock.calls[0]?.slice(0, 4)).toEqual([42, expect.objectContaining({ bookId: 7 }), 40, {}]);
    expect(context.books.syncKoboReadingStateForExternalProgress.mock.calls[0]?.slice(0, 3)).toEqual([42, 12, 40]);
  });

  it('feeds confirmed completion into Bookorbit reading-status rules', async () => {
    const context = await setup();
    await context.service.put(user, 7, { ...document, progression: 1 });
    expect(context.books.autoUpdateReadStatusForProgress.mock.calls[0]?.slice(0, 4)).toEqual([42, expect.objectContaining({ bookId: 7 }), 100, {}]);
    expect(context.books.syncKoboReadingStateForExternalProgress.mock.calls[0]?.slice(0, 3)).toEqual([42, 12, 100]);
  });

  it('rejects stale offline updates without changing progress or status', async () => {
    const context = await setup({ lastReadAt: new Date('2026-02-01'), percentage: 70, opdsProgression: null });
    await expect(context.service.put(user, 7, document)).rejects.toBeInstanceOf(ConflictException);
    expect(context.values).not.toHaveBeenCalled();
    expect(context.books.autoUpdateReadStatusForProgress).not.toHaveBeenCalled();
    expect(context.books.syncKoboReadingStateForExternalProgress).not.toHaveBeenCalled();
  });

  it('returns the stored document without re-running effects on an accepted identical retry', async () => {
    const reordered = {
      progression: 0.4,
      device: { name: 'Reader', id: 'urn:reader:1' },
      references: ['chapter.xhtml#p3'],
      modified: document.modified,
    };
    const context = await setup({ lastReadAt: new Date(document.modified), percentage: 40, opdsProgression: reordered });
    expect(await context.service.put(user, 7, document)).toEqual(document);
    // The effects commit atomically with the row, so a stored identical document means the
    // previous request already applied them; re-running them would re-trigger status changes
    // and best-effort notifications.
    expect(context.values).not.toHaveBeenCalled();
    expect(context.books.autoUpdateReadStatusForProgress).not.toHaveBeenCalled();
    expect(context.books.syncKoboReadingStateForExternalProgress).not.toHaveBeenCalled();
    // An accepted replay applies no effects, so it also raises no achievement notifications.
    expect(context.achievementEmit).not.toHaveBeenCalled();
  });

  it('rejects when an effect fails and a retry redoes the write and effects', async () => {
    const context = await setup();
    context.books.autoUpdateReadStatusForProgress.mockRejectedValueOnce(new Error('status service down'));
    await expect(context.service.put(user, 7, document)).rejects.toThrow('status service down');
    expect(context.books.autoUpdateReadStatusForProgress).toHaveBeenCalledOnce();
    expect(context.books.syncKoboReadingStateForExternalProgress).not.toHaveBeenCalled();

    context.queue([fileRows]);
    context.txQueue([[]]);
    await expect(context.service.put(user, 7, document)).resolves.toEqual(document);
    expect(context.values).toHaveBeenCalledTimes(2);
    expect(context.books.autoUpdateReadStatusForProgress).toHaveBeenCalledTimes(2);
    expect(context.books.syncKoboReadingStateForExternalProgress.mock.calls[0]?.slice(0, 3)).toEqual([42, 12, 40]);
  });

  it('applies strong re-read evidence for an intentional backward move', async () => {
    const context = await setup({ lastReadAt: new Date('2025-12-31'), percentage: 90, opdsProgression: null });
    await context.service.put(user, 7, document);
    expect(context.values).toHaveBeenCalledWith(expect.objectContaining({ percentage: 40 }));
    expect(context.books.autoUpdateReadStatusForProgress.mock.calls[0]?.slice(0, 4)).toEqual([
      42,
      expect.anything(),
      40,
      {
        origin: 'bookorbit',
        strongRereadEvidence: true,
      },
    ]);
  });

  it('returns the stored document for an identical retry transformed by the validation pipe', async () => {
    // The global validation pipe hands the controller a class-transformer DTO (nested device
    // instances carry a class prototype), while jsonb hands back plain JSON with reordered
    // keys; the replay check must compare JSON values, not object identity.
    const stored = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
    const context = await setup({ lastReadAt: new Date(document.modified), percentage: 40, opdsProgression: stored });
    expect(await context.service.put(user, 7, plainToInstance(OpdsProgressionDto, document))).toEqual(document);
    expect(context.values).not.toHaveBeenCalled();
    expect(context.books.autoUpdateReadStatusForProgress).not.toHaveBeenCalled();
    expect(context.books.syncKoboReadingStateForExternalProgress).not.toHaveBeenCalled();
    expect(context.achievementEmit).not.toHaveBeenCalled();
  });

  it('replays an identical retry when optional DTO fields are unset', async () => {
    // Optional fields left undefined by the transform are dropped the way jsonb drops them;
    // the replay check must not depend on their presence.
    const minimal: OpdsProgression = {
      modified: document.modified,
      device: { id: 'urn:reader:1', name: 'Reader' },
      progression: 0.4,
    };
    const stored = JSON.parse(JSON.stringify(minimal)) as Record<string, unknown>;
    const context = await setup({ lastReadAt: new Date(document.modified), percentage: 40, opdsProgression: stored });
    expect(await context.service.put(user, 7, plainToInstance(OpdsProgressionDto, minimal))).toEqual(minimal);
    expect(context.values).not.toHaveBeenCalled();
    expect(context.books.autoUpdateReadStatusForProgress).not.toHaveBeenCalled();
    expect(context.books.syncKoboReadingStateForExternalProgress).not.toHaveBeenCalled();
    expect(context.achievementEmit).not.toHaveBeenCalled();
  });

  it('publishes deferred achievement events after the write commits', async () => {
    const context = await setup();
    const payload = { userId: 42, bookId: 7, newStatus: 'read', previousStatus: null };
    context.books.autoUpdateReadStatusForProgress.mockResolvedValue([payload]);
    await context.service.put(user, 7, document);
    expect(context.achievementEmit).toHaveBeenCalledOnce();
    expect(context.achievementEmit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload);
  });

  it('discards deferred achievement events when an effect fails', async () => {
    const context = await setup();
    context.books.autoUpdateReadStatusForProgress.mockResolvedValue([{ userId: 42, bookId: 7, newStatus: 'read', previousStatus: null }]);
    context.books.syncKoboReadingStateForExternalProgress.mockRejectedValueOnce(new Error('kobo down'));
    await expect(context.service.put(user, 7, document)).rejects.toThrow('kobo down');
    expect(context.achievementEmit).not.toHaveBeenCalled();
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
    expect(context.books.autoUpdateReadStatusForProgress).not.toHaveBeenCalled();
    expect(context.books.syncKoboReadingStateForExternalProgress).not.toHaveBeenCalled();
  });
});
