import { plainToInstance } from 'class-transformer';
import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { ReadingSessionRepository } from './reading-session.repository';
import type { OpdsReadingStatsBatch } from '@bookorbit/types';
import { OpdsReadingStatsDto } from '../opds/dto/opds-reading-stats.dto';

const file = { id: 12, bookId: 7, libraryId: 3 };
const batch: OpdsReadingStatsBatch = {
  version: 1,
  device: { id: 'urn:test:reader', name: 'Reader' },
  sessions: [
    {
      id: 'c38cbe7a-2051-42be-91e2-8571ba992825',
      started: '2026-01-01T23:59:30Z',
      ended: '2026-01-02T00:00:30Z',
      activeSeconds: 60,
      pagesTurned: 3,
      startProgression: 0.5,
      endProgression: 0.6,
    },
  ],
};
function setup(duplicate = false, conflict = false, storedExternalStats: unknown = { device: batch.device, session }) {
  const session = batch.sessions[0];
  const row = {
    userId: 42,
    bookFileId: 12,
    sessionId: createHash('sha256').update(batch.device.id).update('\0').update(session.id).digest('hex'),
    externalStats: storedExternalStats,
    startedAt: new Date(session.started),
    endedAt: new Date(session.ended),
    durationSeconds: 60,
    progressDelta: 10,
    endProgress: 60,
  };
  const values = vi
    .fn()
    .mockReturnValue({ onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(duplicate ? [] : [row]) }) });
  const where = vi.fn().mockResolvedValue([{ ...row, bookFileId: conflict ? 99 : 12 }]);
  const tx = { insert: vi.fn().mockReturnValue({ values }), select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) };
  const db = { transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => Promise.resolve(callback(tx))) };
  const repo = new ReadingSessionRepository(db as never);
  const lock = vi.spyOn(repo as never, 'lockDailyStats').mockResolvedValue(undefined as never);
  const totals = vi.spyOn(repo as never, 'insertDailyStatsSegments').mockResolvedValue(undefined as never);
  return { repo, tx, values, lock, totals };
}
describe('OPDS reading stats batch repository', () => {
  it('inserts a batch once and splits daily totals across midnight', async () => {
    const context = setup();
    await context.repo.saveOpdsBatch(42, file, batch, 'UTC');
    expect(context.tx.insert).toHaveBeenCalledOnce();
    expect(context.tx.select).toHaveBeenCalledOnce();
    expect(context.values).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 42, source: 'opds', externalStats: { device: batch.device, session: batch.sessions[0] } }),
    ]);
    expect(context.lock).toHaveBeenCalledOnce();
    expect(context.totals).toHaveBeenCalledWith(
      context.tx,
      42,
      3,
      expect.arrayContaining([
        expect.objectContaining({ day: '2026-01-01', readingSeconds: 30 }),
        expect.objectContaining({ day: '2026-01-02', readingSeconds: 30 }),
      ]),
      'increment',
    );
  });
  it('acknowledges identical retries without incrementing daily totals', async () => {
    const context = setup(true);
    expect(await context.repo.saveOpdsBatch(42, file, batch, 'UTC')).toEqual([]);
    expect(context.lock).not.toHaveBeenCalled();
    expect(context.totals).not.toHaveBeenCalled();
  });
  it('acknowledges an identical retry transformed by the validation pipe against the stored plain JSON', async () => {
    // The validation pipe hands the controller class-transformer DTO instances while jsonb
    // returns plain values with reordered keys; the replay check must compare JSON values.
    const context = setup(true, false, JSON.parse(JSON.stringify({ device: batch.device, session: batch.sessions[0] })));
    expect(await context.repo.saveOpdsBatch(42, file, plainToInstance(OpdsReadingStatsDto, batch), 'UTC')).toEqual([]);
    expect(context.lock).not.toHaveBeenCalled();
    expect(context.totals).not.toHaveBeenCalled();
  });

  it('rejects a reused identifier for another file before updating totals', async () => {
    const context = setup(true, true);
    await expect(context.repo.saveOpdsBatch(42, file, batch, 'UTC')).rejects.toBeInstanceOf(ConflictException);
    expect(context.totals).not.toHaveBeenCalled();
  });
});
