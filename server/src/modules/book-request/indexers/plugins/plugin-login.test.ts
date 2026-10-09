import { Logger } from '@nestjs/common';
import type { IndexerPlugin } from '@bookorbit/plugin-api';
import { PluginIndexerAdapter } from './plugin-host';
import type { ResolvedIndexerConfig } from '../indexer-adapter';
import { IndexerRegistry } from '../indexer-registry';

vi.mock('../../../../common/utils/safe-fetch', () => ({ safeFetch: vi.fn() }));
import { safeFetch } from '../../../../common/utils/safe-fetch';

const configuration = {
  id: 9,
  name: 'Synthetic',
  adapterType: 'synthetic',
  baseUrl: 'https://provider.example.test',
  credential: 'old-session',
  allowPrivateAddress: true,
  categories: { ebook: [], audiobook: [], comic: [] },
  settings: null,
  networkProfile: null,
} as unknown as ResolvedIndexerConfig;
const input = { username: 'synthetic@example.test', password: 'synthetic-password' };
const session = JSON.stringify({ remix_userid: '12345', remix_userkey: 'synthetic-key' });
function adapter(login?: unknown) {
  const plugin = {
    apiVersion: 1,
    type: 'synthetic',
    label: 'Synthetic',
    requiresCredential: true,
    credentialKind: 'sessionId',
    mediaKinds: ['ebook'],
    usesCategories: false,
    seedsBack: false,
    search: () => Promise.resolve([]),
    test: () => Promise.resolve({ success: true }),
    ...(login === undefined ? {} : { login }),
  } as unknown as IndexerPlugin;
  const store = { rotate: vi.fn() };
  return { subject: new PluginIndexerAdapter(plugin, store as never), store };
}
function call(subject: PluginIndexerAdapter, config = configuration, signal = AbortSignal.timeout(1000)) {
  return subject.login!(input, config, signal);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('native login boundary', () => {
  it('advertises only callable login capability and preserves legacy adapters', () => {
    const legacy = adapter().subject;
    const capable = adapter(() => Promise.resolve(session)).subject;
    const registry = new IndexerRegistry([], { load: () => Promise.resolve([]) } as never);
    registry.register(legacy);
    expect(registry.describe()[0].supportsLogin).not.toBe(true);
    expect(legacy.login).toBeUndefined();
    registry.register(capable);
    expect(registry.describe()[0].supportsLogin).toBe(true);
  });

  it('returns only a bounded session, with no old credential, logger or persistence capability', async () => {
    const { subject, store } = adapter((_input: unknown, config: Record<string, unknown>, host: Record<string, unknown>) => {
      expect(config.credential).toBeNull();
      expect(host.logger).toBeUndefined();
      expect(host.saveCredential).toBeUndefined();
      return Promise.resolve(session);
    });
    expect(await call(subject)).toBe(session);
    expect(store.rotate).not.toHaveBeenCalled();
  });

  it('pins password traffic to the configured HTTPS origin and disables redirects/private policy', async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response('{"success":1}'));
    const { subject } = adapter(async (_i: unknown, _c: unknown, host: { fetch: typeof fetch }) => {
      await host.fetch(configuration.baseUrl + '/login', { method: 'POST', body: input.password, redirect: 'follow' });
      return session;
    });
    await call(subject);
    expect(safeFetch).toHaveBeenCalledWith(
      configuration.baseUrl + '/login',
      expect.objectContaining({ redirect: 'manual' }),
      expect.objectContaining({ allowPrivate: false, pinResolvedAddress: true }),
    );
  });

  it.each(['http://provider.example.test/login', 'https://other.example.test/login', 'https://user:pass@provider.example.test/login'])(
    'refuses credential egress to %s before transport',
    async (url) => {
      const { subject } = adapter(async (_i: unknown, _c: unknown, host: { fetch: typeof fetch }) => {
        await host.fetch(url, { method: 'POST', body: input.password });
        return session;
      });
      await expect(call(subject)).rejects.toMatchObject({ failure: 'error' });
      expect(safeFetch).not.toHaveBeenCalled();
    },
  );

  it('never forwards or logs secret-bearing plugin/transport exception text', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { subject } = adapter(() => Promise.reject(new Error(input.password + session)));
    await expect(call(subject)).rejects.toMatchObject({ failure: 'error', message: 'Indexer sign-in failed.' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('cancels an uncooperative login and does not return a late session', async () => {
    const { subject } = adapter(() => Promise.withResolvers<string>().promise);
    const controller = new AbortController();
    const pending = call(subject, configuration, controller.signal);
    controller.abort(new DOMException('Cancelled', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ failure: 'timeout' });
  });

  it('aborts remaining password transport when the plugin sign-in operation ends', async () => {
    let transportSignal: AbortSignal | null | undefined;
    vi.mocked(safeFetch).mockImplementation((_url, init) => {
      transportSignal = init?.signal;
      const { promise, reject } = Promise.withResolvers<Response>();
      transportSignal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      return promise;
    });
    const { subject } = adapter((_i: unknown, _c: unknown, host: { fetch: typeof fetch }) => {
      void host.fetch(configuration.baseUrl + '/login', { method: 'POST', body: input.password }).catch(() => undefined);
      return Promise.resolve(session);
    });
    expect(await call(subject)).toBe(session);
    expect(transportSignal?.aborted).toBe(true);
  });

  it('bounds a login response body before it can become an encrypted credential', async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    const { subject } = adapter(async (_i: unknown, _c: unknown, host: { fetch: typeof fetch }) => {
      return (await host.fetch(configuration.baseUrl + '/login')).text();
    });
    await expect(call(subject)).rejects.toMatchObject({ failure: 'error' });
  });
});
