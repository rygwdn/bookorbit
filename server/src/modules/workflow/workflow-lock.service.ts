import { Injectable } from '@nestjs/common';

function createDeferredPromise<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

@Injectable()
export class WorkflowLockService {
  private readonly locks = new Map<string, Promise<void>>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const current = this.locks.get(key) ?? Promise.resolve();
    const { promise: unlock, resolve: release } = createDeferredPromise<void>();
    const chain = current.then(() => unlock);
    this.locks.set(key, chain);

    try {
      await current;
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chain) {
        this.locks.delete(key);
      }
    }
  }
}
