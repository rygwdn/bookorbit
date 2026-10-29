import sharp from 'sharp';
import { mkdtemp, rm, truncate, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { cacheDeviceCover, deviceCoverFromPath, generateDeviceCover } from './device-cover';

describe('device covers', () => {
  it('generates a baseline grayscale JPEG at the advertised dimensions', async () => {
    const source = await sharp({ create: { width: 300, height: 500, channels: 3, background: '#ff0033' } })
      .png()
      .toBuffer();
    const result = await generateDeviceCover(source);
    const info = await sharp(result).metadata();
    expect(info).toMatchObject({ width: 160, height: 240, format: 'jpeg', isProgressive: false });
    const { data, info: rawInfo } = await sharp(result).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (rawInfo.channels === 3) for (let i = 0; i < data.length; i += 3) expect([data[i], data[i + 1]]).toEqual([data[i + 1], data[i + 2]]);
    else expect(rawInfo.channels).toBe(1);
  });

  it('reuses cached variants and changes the result when cover content changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opds-cover-'));
    try {
      const source = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } })
        .png()
        .toBuffer();
      const [first, second] = await Promise.all([cacheDeviceCover(dir, 7, source), cacheDeviceCover(dir, 7, source)]);
      expect(first.equals(second)).toBe(true);
      const other = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000000' } })
        .png()
        .toBuffer();
      expect((await cacheDeviceCover(dir, 7, other)).equals(first)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('invalidates the warm source cache when the cover changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opds-source-'));
    const path = join(dir, 'cover.png');
    try {
      const source = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } })
        .png()
        .toBuffer();
      await writeFile(path, source);
      const first = await deviceCoverFromPath(dir, 7, path);
      expect((await deviceCoverFromPath(dir, 7, path)).equals(first)).toBe(true);
      const replacement = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000000' } })
        .png()
        .toBuffer();
      await writeFile(path, replacement);
      const changed = new Date(Date.now() + 1000);
      await utimes(path, changed, changed);
      expect((await deviceCoverFromPath(dir, 7, path)).equals(first)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects oversized originals before loading or decoding them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opds-source-'));
    const path = join(dir, 'large.jpg');
    try {
      await writeFile(path, '');
      await truncate(path, 20 * 1024 * 1024 + 1);
      await expect(deviceCoverFromPath(dir, 7, path)).rejects.toThrow('Cover source exceeds 20 MiB');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
