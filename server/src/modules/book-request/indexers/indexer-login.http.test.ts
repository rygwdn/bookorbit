import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Permission } from '@bookorbit/types';
import { IndexerController } from './indexer.controller';
import { IndexerConfigService } from './indexer-config.service';
import { IndexerRegistry } from './indexer-registry';
import { PluginLoaderService } from './plugins/plugin-loader.service';
import { PluginInstallService } from './plugins/plugin-install.service';
import { PluginUpdateService } from './plugins/plugin-update.service';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { PermissionService } from '../../../common/services/permission.service';

const payload = {
  username: 'synthetic@example.test',
  password: 'synthetic-password',
  configuration: {
    name: 'Synthetic',
    adapterType: 'synthetic',
    baseUrl: 'https://provider.example.test',
    enabled: false,
  },
};
let app: NestFastifyApplication;
let permissions: Permission[];
const login = vi.fn(() => Promise.resolve({ id: 9, hasCredential: true, enabled: false }));
beforeEach(async () => {
  permissions = [Permission.ManageAppSettings];
  login.mockClear();
  const module = await Test.createTestingModule({
    controllers: [IndexerController],
    providers: [
      { provide: IndexerConfigService, useValue: { login } },
      { provide: IndexerRegistry, useValue: {} },
      { provide: PluginLoaderService, useValue: {} },
      { provide: PluginInstallService, useValue: {} },
      { provide: PluginUpdateService, useValue: {} },
      PermissionService,
      PermissionGuard,
    ],
  }).compile();
  const adapter = new FastifyAdapter({ logger: false });
  adapter.getInstance().addHook('preHandler', (req, _reply, done) => {
    Object.assign(req, { user: { id: 1, isSuperuser: false, permissions } });
    done();
  });
  app = module.createNestApplication<NestFastifyApplication>(adapter, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalGuards(new PermissionGuard(app.get(Reflector), app.get(PermissionService)));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterEach(async () => app.close());
const url = '/api/v1/admin/request-indexers/login';

describe('admin sign-in HTTP boundary', () => {
  it('accepts ManageAppSettings operators without granting plugin installation privileges', async () => {
    const result = await app.inject({ method: 'POST', url, payload });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ id: 9, hasCredential: true, enabled: false });
    expect(result.body).not.toContain(payload.password);
  });
  it('rejects request moderators without settings permission before a password exchange', async () => {
    permissions = [Permission.ManageBookRequests];
    const result = await app.inject({ method: 'POST', url, payload });
    expect(result.statusCode).toBe(403);
    expect(login).not.toHaveBeenCalled();
  });
  it.each([
    { ...payload, password: '' },
    { ...payload, username: ' ' },
    { ...payload, password: 'x'.repeat(1025) },
    { ...payload, indexerId: 0 },
    { ...payload, configuration: { ...payload.configuration, mystery: 'synthetic-secret' } },
  ])('rejects invalid/extra input without echoing submitted values', async (invalid) => {
    const result = await app.inject({ method: 'POST', url, payload: invalid });
    expect(result.statusCode).toBe(400);
    expect(result.body).not.toContain('synthetic-secret');
    expect(result.body).not.toContain(payload.password);
    expect(login).not.toHaveBeenCalled();
  });
});
