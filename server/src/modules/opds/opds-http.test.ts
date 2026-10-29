import { OPDS_READING_STATS_TYPE } from '@bookorbit/types';
import { ReadingSessionService } from '../reading-session/reading-session.service';
import { OpdsReadingStatsController } from './opds-reading-stats.controller';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { GlobalExceptionFilter } from '../../common/filters/http-exception.filter';
import { OpdsProgressionController } from './opds-progression.controller';
import { OpdsProgressionService } from './opds-progression.service';
import { OpdsAuthGuard } from './opds-auth.guard';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { Opds2Controller } from './opds2.controller';
import { Opds2Service } from './opds2.service';
import { OpdsBookService } from './opds-book.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { registerOpdsProgressionHttp } from './opds-http';

const document = {
  modified: '2026-01-01T12:00:00Z',
  device: { id: 'urn:test:reader', name: 'Reader' },
  progression: 0.3,
  references: ['chapter.xhtml#p4'],
};

describe('OPDS HTTP contracts', () => {
  let app: NestFastifyApplication;
  let authenticated = true;
  const stats = { saveOpdsBatch: vi.fn() };
  const progression = { get: vi.fn(), put: vi.fn() };
  const books = { getBooksPage: vi.fn(), getDistinctSeriesPage: vi.fn() };
  const dashboard = { getScrollers: vi.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OpdsReadingStatsController, OpdsProgressionController, Opds2Controller],
      providers: [
        Opds2Service,
        { provide: ReadingSessionService, useValue: stats },
        { provide: OpdsProgressionService, useValue: progression },
        { provide: OpdsBookService, useValue: books },
        { provide: DashboardService, useValue: dashboard },
      ],
    })
      .overrideGuard(OpdsEnabledGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OpdsAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp(): { getRequest(): Record<string, unknown> } }) => {
          if (!authenticated) throw new UnauthorizedException();
          context.switchToHttp().getRequest().opdsUser = {
            userId: 42,
            isSuperuser: false,
            sortOrder: 'title_asc',
            contentFilters: {},
            account: { id: 42, active: true },
          };
          return true;
        },
      })
      .compile();
    const adapter = new FastifyAdapter();
    registerOpdsProgressionHttp(adapter.getInstance());
    app = module.createNestApplication<NestFastifyApplication>(adapter, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    vi.clearAllMocks();
    authenticated = true;
    progression.put.mockResolvedValue(document);
    progression.get.mockResolvedValue(null);
    books.getBooksPage.mockResolvedValue({ entries: [], total: 0 });
    books.getDistinctSeriesPage.mockResolvedValue({ items: [{ id: 9, name: 'Saga', bookCount: 2 }], hasNext: true });
    dashboard.getScrollers.mockResolvedValue({
      items: [
        { id: 'continue-reading', books: [] },
        { id: 'up-next-in-series', books: [] },
        { id: 'recently-added', books: [] },
      ],
    });
  });

  const session = {
    id: 'c38cbe7a-2051-42be-91e2-8571ba992825',
    started: '2026-01-01T12:00:00Z',
    ended: '2026-01-01T12:01:00Z',
    activeSeconds: 50,
    pagesTurned: 3,
    endProgression: 1,
  };
  const batch = { version: 1, device: document.device, sessions: [session] };
  it('accepts advertised stats media type and returns an acknowledgement', async () => {
    stats.saveOpdsBatch.mockResolvedValue({ version: 1, accepted: [session.id] });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/opds/7/stats?fileId=12',
      headers: { 'content-type': OPDS_READING_STATS_TYPE },
      payload: batch,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain(OPDS_READING_STATS_TYPE);
    expect(response.json()).toEqual({ version: 1, accepted: [session.id] });
    expect(stats.saveOpdsBatch).toHaveBeenCalledWith(7, 12, batch, expect.objectContaining({ id: 42 }));
  });
  it.each([
    { ...batch, version: 2 },
    { ...batch, sessions: [] },
    { ...batch, sessions: Array(17).fill(session) },
    { ...batch, sessions: [{ ...session, activeSeconds: -1 }] },
    { ...batch, sessions: [{ ...session, pagesTurned: 1.5 }] },
    { ...batch, sessions: [{ ...session, endProgression: 100 }] },
    { ...batch, sessions: [{ ...session, started: '2026-01-01' }] },
    { ...batch, sessions: [{ ...session, id: '../unsafe' }] },
  ])('rejects invalid stats batches before persistence', async (payload) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/opds/7/stats', headers: { 'content-type': OPDS_READING_STATS_TYPE }, payload });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(stats.saveOpdsBatch).not.toHaveBeenCalled();
  });
  it('requires authentication for stats uploads', async () => {
    authenticated = false;
    const response = await app.inject({ method: 'POST', url: '/api/v1/opds/7/stats', payload: batch });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/opds-authentication+json');
    expect(stats.saveOpdsBatch).not.toHaveBeenCalled();
  });
  it('formats stats JSON parser errors as reading-stats Problem Details', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/opds/7/stats',
      headers: { 'content-type': OPDS_READING_STATS_TYPE },
      payload: '{broken',
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json().type).toBe('https://bookorbit.app/errors/reading-stats');
  });

  it('accepts draft media type and validated nested fields on PUT', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/opds/7/progression?fileId=12',
      headers: { 'content-type': 'application/opds-progression+json' },
      payload: document,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/opds-progression+json');
    expect(progression.put).toHaveBeenCalledWith(expect.objectContaining({ userId: 42 }), 7, expect.objectContaining(document), 12);
  });

  it.each([
    { ...document, progression: 30 },
    { ...document, device: { name: 'Reader' } },
    { ...document, unexpected: true },
    { ...document, references: [8] },
    { ...document, modified: '2026-01-01' },
  ])('rejects invalid draft payloads with Problem Details', async (payload) => {
    const response = await app.inject({ method: 'PUT', url: '/api/v1/opds/7/progression', payload });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ type: expect.any(String), title: expect.any(String) });
    expect(progression.put).not.toHaveBeenCalled();
  });

  it('formats JSON parser errors as Problem Details too', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/opds/7/progression',
      headers: { 'content-type': 'application/opds-progression+json' },
      payload: '{broken',
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toHaveProperty('type');
  });

  it('returns an authentication document for unauthorized progression requests', async () => {
    authenticated = false;
    const response = await app.inject({ method: 'GET', url: '/api/v1/opds/7/progression' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/opds-authentication+json');
    expect(response.json().authentication[0].type).toBe('http://opds-spec.org/auth/basic');
  });

  it('returns an empty 200 when no progression exists', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/opds/7/progression' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
  });

  it('loads all dashboard shelves with one batch and supports conditional responses', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/v1/opds/v2' });
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toContain('application/opds+json');
    expect(first.json().groups.map((group: { metadata: { title: string } }) => group.metadata.title)).toEqual([
      'Continue Reading',
      'Up Next',
      'Recently Added',
      'Browse',
    ]);
    expect(dashboard.getScrollers).toHaveBeenCalledOnce();
    const second = await app.inject({ method: 'GET', url: '/api/v1/opds/v2', headers: { 'if-none-match': first.headers.etag! } });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
  });

  it('passes search and series filters together under the authenticated scope', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/opds/v2/catalog?query=moon&seriesId=9&page=2&size=5' });
    expect(response.statusCode).toBe(200);
    expect(books.getBooksPage).toHaveBeenCalledWith(42, 'series_asc', 2, 5, expect.objectContaining({ seriesId: 9, q: 'moon' }), false, {});
  });

  it('paginates series navigation instead of loading all series', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/opds/v2/series?page=2&size=5' });
    expect(response.statusCode).toBe(200);
    expect(books.getDistinctSeriesPage).toHaveBeenCalledWith(42, { q: undefined, limit: 5, offset: 5 }, false, {});
    expect(response.json().links).toContainEqual(expect.objectContaining({ rel: 'next', href: '/api/v1/opds/v2/series?page=3&size=5' }));
  });

  it.each(['size=0', 'page=-1', 'size=101', 'seriesId=abc', 'unexpected=1'])('validates catalog query %s', async (query) => {
    const response = await app.inject({ method: 'GET', url: `/api/v1/opds/v2/catalog?${query}` });
    expect(response.statusCode).toBe(400);
    expect(books.getBooksPage).not.toHaveBeenCalled();
  });
});
