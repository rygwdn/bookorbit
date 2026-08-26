function createVoidDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type WorkHandler = (id: number) => Promise<void>;
type ErrorHandler = (id: number, error: unknown) => void;
type PendingOrder = 'fifo' | 'lifo';

export interface WorkflowRunQueueOptions {
  pendingOrder?: PendingOrder;
  drainDelayMs?: number;
}

export class WorkflowRunQueue {
  private readonly pending: number[] = [];
  private readonly queued = new Set<number>();
  private readonly running = new Set<number>();
  private readonly idleResolvers: Array<() => void> = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private activeCount = 0;
  private stopped = false;
  private paused = false;

  constructor(
    private readonly concurrency: number,
    private readonly handler: WorkHandler,
    private readonly onError: ErrorHandler,
    private readonly options: WorkflowRunQueueOptions = {},
  ) {}

  enqueue(id: number): boolean {
    if (this.stopped || !Number.isInteger(id) || id < 1) return false;
    if (this.queued.has(id) || this.running.has(id)) return false;

    this.queued.add(id);
    this.pending.push(id);
    this.scheduleDrain({ includeDrainDelay: true });
    return true;
  }

  pause(): void {
    if (this.stopped) return;
    this.paused = true;
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  resume(): void {
    if (this.stopped || !this.paused) return;
    this.paused = false;
    this.scheduleDrain({ includeDrainDelay: true });
  }

  stop(): void {
    this.stopped = true;
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    this.pending.length = 0;
    this.queued.clear();
    this.resolveIdleIfNeeded();
  }

  waitForIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    const { promise, resolve } = createVoidDeferred();
    this.idleResolvers.push(resolve);
    return promise;
  }

  private scheduleDrain({ includeDrainDelay }: { includeDrainDelay: boolean }): void {
    if (this.stopped || this.paused || this.pending.length === 0 || this.activeCount >= this.concurrency) return;

    const drainDelayMs = includeDrainDelay && this.activeCount === 0 ? (this.options.drainDelayMs ?? 0) : 0;
    if (drainDelayMs > 0) {
      if (this.drainTimer) clearTimeout(this.drainTimer);
      this.drainTimer = setTimeout(() => {
        this.drainTimer = null;
        this.drain();
      }, drainDelayMs);
      return;
    }

    this.drain();
  }

  private drain(): void {
    while (!this.stopped && !this.paused && this.activeCount < this.concurrency && this.pending.length > 0) {
      const id = this.takeNextPending();
      this.queued.delete(id);
      this.running.add(id);
      this.activeCount++;

      void this.handler(id)
        .catch((error) => this.onError(id, error))
        .finally(() => {
          this.running.delete(id);
          this.activeCount--;
          this.scheduleDrain({ includeDrainDelay: false });
          this.resolveIdleIfNeeded();
        });
    }

    this.resolveIdleIfNeeded();
  }

  private takeNextPending(): number {
    if (this.options.pendingOrder === 'lifo') {
      return this.pending.pop()!;
    }
    return this.pending.shift()!;
  }

  private isIdle(): boolean {
    return this.pending.length === 0 && this.activeCount === 0;
  }

  private resolveIdleIfNeeded(): void {
    if (!this.isIdle()) return;
    const resolvers = this.idleResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }
}
