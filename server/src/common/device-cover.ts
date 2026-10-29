import { BadRequestException, Logger } from '@nestjs/common';
import { sanitizeLogValue } from './utils/log-sanitize.utils';
import sharp from 'sharp';
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { bookCoverDirPath } from './book-cover-storage';

export async function generateDeviceCover(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes, { limitInputPixels: 40000000 })
    .rotate()
    .resize(160, 240, {
      fit: 'contain',
      background: '#ffffff',
    })
    .flatten({ background: '#ffffff' })
    .greyscale()
    .jpeg({ quality: 80, progressive: false })
    .toBuffer();
}

const logger = new Logger('DeviceCover');
function createGate() {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await operation();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
// Separate gates avoid holding source-read slots while waiting for the same renderer slots.
const slot = createGate();
const sourceSlot = createGate();
const sourceCache = new Map<string, Buffer>();

export async function deviceCoverFromPath(appDataPath: string, bookId: number, sourcePath: string): Promise<Buffer> {
  const info = await stat(sourcePath);
  if (info.size > 20 * 1024 * 1024) throw new BadRequestException('Cover source exceeds 20 MiB');
  const key = `${sourcePath}:${info.mtimeMs}:${info.size}`;
  const cached = sourceCache.get(key);
  if (cached) {
    sourceCache.delete(key);
    sourceCache.set(key, cached);
    return cached;
  }
  const cover = await sourceSlot(async () => cacheDeviceCover(appDataPath, bookId, await readFile(sourcePath)));
  sourceCache.set(key, cover);
  while (sourceCache.size > 128) sourceCache.delete(sourceCache.keys().next().value!);
  return cover;
}

const pending = new Map<string, Promise<Buffer>>();

export async function cacheDeviceCover(appDataPath: string, bookId: number, bytes: Buffer): Promise<Buffer> {
  const revision = createHash('sha256').update(bytes).digest('hex');
  const dir = join(bookCoverDirPath(appDataPath, bookId), 'device');
  const path = join(dir, `witchhunt-v1-${revision}.jpg`);
  const existing = pending.get(path);
  if (existing) return existing;
  const operation = (async () => {
    try {
      return await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return slot(async () => {
      const startedAt = Date.now();
      logger.debug(`[cover.device_variant] [start] bookId=${bookId} profile=witchhunt - cover generation started`);
      try {
        const cover = await generateDeviceCover(bytes);
        await mkdir(dir, { recursive: true });
        const temp = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temp, cover);
          await rename(temp, path);
        } finally {
          await rm(temp, { force: true });
        }
        logger.debug(
          `[cover.device_variant] [end] bookId=${bookId} profile=witchhunt durationMs=${Date.now() - startedAt} bytes=${cover.length} - cover generation completed`,
        );
        return cover;
      } catch (error) {
        const errorClass = error instanceof Error ? error.constructor.name : typeof error;
        logger.warn(
          `[cover.device_variant] [fail] bookId=${bookId} profile=witchhunt durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : error)}" - cover generation failed`,
        );
        throw error;
      }
    });
  })();
  pending.set(path, operation);
  try {
    return await operation;
  } finally {
    pending.delete(path);
  }
}
