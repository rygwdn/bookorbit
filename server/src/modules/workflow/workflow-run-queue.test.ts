import { WorkflowRunQueue } from './workflow-run-queue';

describe('WorkflowRunQueue', () => {
  it('runs queued work within the configured concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const { promise: firstDone, resolve: releaseFirst } = Promise.withResolvers<void>();
    const { promise: firstStart, resolve: firstStarted } = Promise.withResolvers<void>();
    const { promise: secondStart, resolve: secondStarted } = Promise.withResolvers<void>();

    const queue = new WorkflowRunQueue(
      1,
      async (id) => {
        active++;
        maxActive = Math.max(maxActive, active);
        if (id === 1) {
          firstStarted();
          await firstDone;
        }
        if (id === 2) {
          secondStarted();
        }
        active--;
      },
      vi.fn(),
    );

    queue.enqueue(1);
    queue.enqueue(2);

    await firstStart;
    expect(maxActive).toBe(1);

    releaseFirst();
    await secondStart;
    await queue.waitForIdle();

    expect(maxActive).toBe(1);
  });

  it('coalesces duplicate queued or running ids', async () => {
    const handled: number[] = [];
    const { promise: firstDone, resolve: releaseFirst } = Promise.withResolvers<void>();
    const { promise: firstStart, resolve: firstStarted } = Promise.withResolvers<void>();

    const queue = new WorkflowRunQueue(
      1,
      async (id) => {
        handled.push(id);
        if (id === 1) {
          firstStarted();
          await firstDone;
        }
      },
      vi.fn(),
    );

    expect(queue.enqueue(1)).toBe(true);
    await firstStart;

    // Enqueue 1 while running -> false
    expect(queue.enqueue(1)).toBe(false);
    // Enqueue 2 -> true
    expect(queue.enqueue(2)).toBe(true);
    // Enqueue 2 while queued -> false
    expect(queue.enqueue(2)).toBe(false);

    releaseFirst();
    await queue.waitForIdle();

    expect(handled).toEqual([1, 2]);
  });

  it('reports job errors and keeps draining the queue', async () => {
    const handled: number[] = [];
    const onError = vi.fn();
    const queue = new WorkflowRunQueue(
      1,
      async (id) => {
        handled.push(id);
        if (id === 1) {
          await Promise.resolve();
          throw new Error('boom');
        }
      },
      onError,
    );

    queue.enqueue(1);
    queue.enqueue(2);

    await queue.waitForIdle();

    expect(handled).toEqual([1, 2]);
    expect(onError).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it('resolves waitForIdle immediately when the queue is already empty', async () => {
    const queue = new WorkflowRunQueue(1, vi.fn().mockResolvedValue(undefined), vi.fn());
    await expect(queue.waitForIdle()).resolves.toBeUndefined();
  });

  it('ignores enqueue calls with invalid ids', () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const queue = new WorkflowRunQueue(1, handler, vi.fn());

    expect(queue.enqueue(0)).toBe(false);
    expect(queue.enqueue(-1)).toBe(false);
    expect(queue.enqueue(1.5)).toBe(false);
  });

  it('stop clears pending items and prevents new work from starting', async () => {
    const handled: number[] = [];
    const handler = vi.fn().mockImplementation((id: number) => {
      handled.push(id);
      return Promise.resolve();
    });
    const queue = new WorkflowRunQueue(1, handler, vi.fn(), { drainDelayMs: 500 });

    queue.enqueue(1);
    queue.enqueue(2);
    queue.stop();

    await queue.waitForIdle();
    expect(handled).toEqual([]);
    expect(queue.enqueue(3)).toBe(false);
  });

  it('pause keeps pending work queued until resume', async () => {
    const handled: number[] = [];
    const queue = new WorkflowRunQueue(
      1,
      (id) => {
        handled.push(id);
        return Promise.resolve();
      },
      vi.fn(),
    );

    queue.pause();
    expect(queue.enqueue(1)).toBe(true);
    expect(queue.enqueue(2)).toBe(true);
    expect(handled).toEqual([]);

    queue.resume();
    await queue.waitForIdle();
    expect(handled).toEqual([1, 2]);
  });

  it('processes queued items in lifo order when configured', async () => {
    const handled: number[] = [];
    const { promise: blockFirst, resolve: releaseFirst } = Promise.withResolvers<void>();
    const { promise: firstStart, resolve: firstStarted } = Promise.withResolvers<void>();

    const queue = new WorkflowRunQueue(
      1,
      async (id) => {
        if (id === 1) {
          firstStarted();
          await blockFirst;
        }
        handled.push(id);
      },
      vi.fn(),
      { pendingOrder: 'lifo' },
    );

    queue.enqueue(1);
    await firstStart;

    queue.enqueue(2);
    queue.enqueue(3);
    queue.enqueue(4);

    releaseFirst();
    await queue.waitForIdle();

    expect(handled).toEqual([1, 4, 3, 2]);
  });
});
