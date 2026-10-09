import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { IndexerConfigService } from './indexer-config.service';
import { IndexerRepository } from './indexer.repository';
import { IndexerManagerRepository } from './indexer-manager.repository';
import { IndexerRegistry } from './indexer-registry';
import { RequestCredentialService } from '../request-credential.service';
import type { RequestIndexerRow } from '../../../db/schema';

const input = {
  username: 'synthetic@example.test',
  password: 'synthetic-password',
  configuration: {
    name: 'Synthetic Z-Library',
    adapterType: 'zlibrary',
    baseUrl: 'https://203.0.113.10',
    enabled: false,
    settings: { ebookFormats: 'epub' },
  },
};
const session = JSON.stringify({ remix_userid: '12345', remix_userkey: 'synthetic-key' });
async function fixture(options: { encryption?: boolean; login?: boolean; managed?: boolean } = {}) {
  const encryption = new RequestCredentialService(
    new ConfigService({ bookRequest: { encryptionKey: options.encryption === false ? '' : '11'.repeat(32) } }),
  );
  let row = {
    id: 9,
    name: 'Original',
    adapterType: 'zlibrary',
    baseUrl: input.configuration.baseUrl,
    credentialsEnc: options.encryption === false ? 'old-encrypted-session' : encryption.encrypt('old-session'),
    enabled: false,
    managerId: options.managed ? 1 : null,
    categories: { ebook: [], audiobook: [], comic: [] },
    settings: { ebookFormats: 'pdf' },
    allowPrivateAddress: false,
    applyTrackerSeedGoals: true,
    seedRatioGoal: null,
    seedTimeMinutes: null,
    disabledMediaKinds: [],
    isbnSearchDisabled: false,
    color: null,
    networkProfile: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastTestedAt: null,
    lastTestOk: null,
    lastErrorMessage: null,
    lastSearchAt: null,
    lastSearchOk: null,
    lastSearchError: null,
    searchFailureStreak: 0,
  } as RequestIndexerRow;
  const repo = {
    findById: vi.fn(() => Promise.resolve(row)),
    findAssignedColors: vi.fn(() => Promise.resolve([])),
    update: vi.fn((_id: number, patch: Partial<RequestIndexerRow>) => {
      row = { ...row, ...patch };
      return Promise.resolve(row);
    }),
    create: vi.fn((data: Partial<RequestIndexerRow>) => {
      row = { ...row, ...data };
      return Promise.resolve(row);
    }),
  };
  const login = vi.fn(() => Promise.resolve(session));
  const adapter = {
    requiresCredential: true,
    label: 'Synthetic',
    settingsFields: [{ key: 'ebookFormats', type: 'string', label: 'Formats', format: 'list', options: ['epub', 'pdf'], minItems: 1 }],
    forget: vi.fn(),
    ...(options.login === false ? {} : { login }),
  };
  const registry = {
    require: () => adapter,
    find: () => adapter,
    seedsBack: () => false,
    defaultCategories: () => ({ ebook: [], audiobook: [], comic: [] }),
  };
  const module = await Test.createTestingModule({
    providers: [
      IndexerConfigService,
      { provide: IndexerRepository, useValue: repo },
      { provide: RequestCredentialService, useValue: encryption },
      { provide: IndexerRegistry, useValue: registry },
      { provide: IndexerManagerRepository, useValue: {} },
    ],
  }).compile();
  return { service: module.get(IndexerConfigService), repo, login, encryption, getRow: () => row, adapter };
}
afterEach(() => vi.restoreAllMocks());

describe('explicit sign-in and store session', () => {
  it('creates only after successful sign-in, encrypting only the session and returning no credentials', async () => {
    const f = await fixture();
    const result = await f.service.login(structuredClone(input), AbortSignal.timeout(1000));
    expect(result).toMatchObject({ hasCredential: true, enabled: false, settings: { ebookFormats: 'epub' } });
    expect(f.encryption.decrypt(f.getRow().credentialsEnc!)).toBe(session);
    expect(JSON.stringify(f.getRow())).not.toContain(input.password);
    expect(JSON.stringify(f.getRow())).not.toContain(input.username);
    expect(JSON.stringify(result)).not.toContain('synthetic-key');
    expect(JSON.stringify(result)).not.toContain('credentialsEnc');
  });
  it('replaces an existing session and submitted config together only on successful sign-in', async () => {
    const f = await fixture();
    await f.service.login({ ...structuredClone(input), indexerId: 9 }, AbortSignal.timeout(1000));
    expect(f.getRow().name).toBe('Synthetic Z-Library');
    expect(f.encryption.decrypt(f.getRow().credentialsEnc!)).toBe(session);
    expect(f.adapter.forget).toHaveBeenCalledWith(9);
    expect(f.repo.create).not.toHaveBeenCalled();
  });
  it('leaves saved session and configuration unchanged on rejection, with no secret-bearing logs/errors', async () => {
    const f = await fixture();
    const previous = structuredClone(f.getRow());
    f.login.mockRejectedValue(new Error(input.password + session));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const failure = await f.service.login({ ...structuredClone(input), indexerId: 9 }, AbortSignal.timeout(1000)).catch((e) => e);
    expect(failure.getResponse()).toMatchObject({ errorCode: 'INDEXER_LOGIN_FAILED', message: 'Indexer sign-in failed.' });
    expect(f.getRow()).toEqual(previous);
    expect(f.repo.update).not.toHaveBeenCalled();
    const logs = JSON.stringify(warn.mock.calls);
    expect(logs).not.toContain(input.password);
    expect(logs).not.toContain(input.username);
    expect(logs).not.toContain('synthetic-key');
  });
  it.each([{ encryption: false }, { login: false }, { managed: true }])(
    'refuses unusable configuration before exchanging a password: %j',
    async (options) => {
      const f = await fixture(options);
      await expect(f.service.login({ ...structuredClone(input), indexerId: 9 }, AbortSignal.timeout(1000))).rejects.toThrow();
      expect(f.login).not.toHaveBeenCalled();
      expect(f.repo.update).not.toHaveBeenCalled();
    },
  );
  it('discards transient DTO password on success and failure', async () => {
    const f = await fixture();
    const success = structuredClone(input);
    await f.service.login(success, AbortSignal.timeout(1000));
    expect(success.password).toBe('');
    f.login.mockRejectedValue(new Error('refused'));
    const failure = structuredClone(input);
    await expect(f.service.login(failure, AbortSignal.timeout(1000))).rejects.toThrow();
    expect(failure.password).toBe('');
  });
  it('honors cancellation before committing a session even if a plugin completes late', async () => {
    const f = await fixture();
    const controller = new AbortController();
    f.login.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(session);
    });
    await expect(f.service.login({ ...structuredClone(input), indexerId: 9 }, controller.signal)).rejects.toThrow();
    expect(f.repo.update).not.toHaveBeenCalled();
  });
});
