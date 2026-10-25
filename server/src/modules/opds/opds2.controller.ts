import { BadRequestException, Controller, Get, Headers, NotFoundException, Param, ParseIntPipe, Query, Res, UseGuards } from '@nestjs/common';
import { createHash } from 'crypto';
import type { FastifyReply } from 'fastify';
import type { BookCard, OpdsFeed, ScrollerType } from '@bookorbit/types';
import { Public } from '../../common/decorators/public.decorator';
import { isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import { DashboardService } from '../dashboard/dashboard.service';
import { UserService } from '../user/user.service';
import { OpdsAuthGuard, type OpdsRequestUser } from './opds-auth.guard';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsUser } from './opds-user.decorator';
import { OpdsBookService, type OpdsBookEntry } from './opds-book.service';
import { Opds2Service, OPDS2_BASE, OPDS2_TYPE } from './opds2.service';
import { Opds2QueryDto } from './dto/opds2-query.dto';

const SHELVES: { type: ScrollerType; title: string }[] = [
  { type: 'continue-reading', title: 'Continue Reading' },
  { type: 'up-next-in-series', title: 'Up Next' },
  { type: 'recently-added', title: 'Recently Added' },
];

@Controller('opds/v2')
@Public()
@UseGuards(OpdsEnabledGuard, OpdsAuthGuard)
export class Opds2Controller {
  constructor(
    private readonly json: Opds2Service,
    private readonly books: OpdsBookService,
    private readonly dashboard: DashboardService,
    private readonly users: UserService,
  ) {}

  @Get()
  async root(@OpdsUser() user: OpdsRequestUser, @Res() reply: FastifyReply, @Headers('if-none-match') etag?: string) {
    const fullUser = user.account ?? (await this.users.findByIdWithPermissions(user.userId));
    if (!fullUser) throw new NotFoundException();
    const batch = await this.dashboard.getScrollers({ items: SHELVES.map((s) => ({ id: s.type, type: s.type, limit: 2 })) }, fullUser);
    const feed = this.json.feed('Bookorbit', OPDS2_BASE);
    feed.groups = batch.items.map((item, index) => ({
      metadata: { title: SHELVES[index]!.title },
      publications: item.books
        .filter((book) => book.files.some((file) => file.role === 'content' || file.role === 'primary'))
        .map((book) => this.json.publication(this.cardEntry(book), book.readingProgress)),
    }));
    feed.groups.push({ metadata: { title: 'Browse' }, navigation: this.json.navigation() });
    this.send(reply, feed, etag);
  }

  @Get('catalog')
  async catalog(
    @OpdsUser() user: OpdsRequestUser,
    @Query() query: Opds2QueryDto,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') etag?: string,
  ) {
    this.window(query);
    const { page, size, query: q, ...filters } = query;
    const result = await this.books.getBooksPage(
      user.userId,
      query.seriesId || query.series ? 'series_asc' : user.sortOrder,
      page,
      size,
      { ...filters, q },
      user.isSuperuser,
      user.contentFilters,
    );
    const self = this.self('catalog', query);
    this.send(reply, this.json.page(q ? `Search: ${q}` : 'Catalog', self, result.entries, result.total, page, size), etag);
  }

  @Get('recent')
  async recent(
    @OpdsUser() user: OpdsRequestUser,
    @Query() query: Opds2QueryDto,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') etag?: string,
  ) {
    this.window(query);
    const result = await this.books.getRecentBooksPage(user.userId, query.page, query.size, user.isSuperuser, user.contentFilters);
    this.send(reply, this.json.page('Recently Added', this.self('recent', query), result.entries, result.total, query.page, query.size), etag);
  }

  @Get('publications/:bookId')
  async publication(@OpdsUser() user: OpdsRequestUser, @Param('bookId', ParseIntPipe) bookId: number, @Res() reply: FastifyReply) {
    const result = await this.books.getBooksPage(user.userId, user.sortOrder, 1, 1, { ids: [bookId] }, user.isSuperuser, user.contentFilters);
    if (!result.entries[0]) throw new NotFoundException();
    reply.header('Cache-Control', 'private, no-cache').type('application/opds-publication+json').send(this.json.publication(result.entries[0]));
  }

  @Get(':section')
  async section(
    @OpdsUser() user: OpdsRequestUser,
    @Param('section') section: string,
    @Query() query: Opds2QueryDto,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') etag?: string,
  ) {
    this.window(query);
    const opts = { q: query.query, limit: query.size, offset: (query.page - 1) * query.size };
    let navigation;
    let hasNext: boolean;
    if (section === 'authors') {
      const result = await this.books.getDistinctAuthorsPage(user.userId, opts, user.isSuperuser, user.contentFilters);
      hasNext = result.hasNext;
      navigation = result.items.map((item) =>
        this.json.link(`${OPDS2_BASE}/catalog?author=${encodeURIComponent(item.name)}`, item.name, 'subsection'),
      );
    } else if (section === 'series') {
      const result = await this.books.getDistinctSeriesPage(user.userId, opts, user.isSuperuser, user.contentFilters);
      hasNext = result.hasNext;
      navigation = result.items.map((item) => this.json.link(`${OPDS2_BASE}/catalog?seriesId=${item.id}`, item.name, 'subsection'));
    } else {
      const rows =
        section === 'libraries'
          ? await this.books.getAccessibleLibraries(user.userId, user.isSuperuser, opts)
          : section === 'collections'
            ? await this.books.getUserCollections(user.userId, opts)
            : section === 'smart-scopes'
              ? await this.books.getUserSmartScopes(user.userId, opts)
              : null;
      if (!rows) throw new NotFoundException();
      hasNext = rows.length > query.size;
      const key = section === 'libraries' ? 'libraryId' : section === 'collections' ? 'collectionId' : 'smartScopeId';
      navigation = rows.slice(0, query.size).map((item) => this.json.link(`${OPDS2_BASE}/catalog?${key}=${item.id}`, item.name, 'subsection'));
    }
    const self = this.self(section, query);
    const feed = { ...this.json.feed(section, self), navigation };
    this.json.paginate(feed, self, query.page, hasNext);
    this.send(reply, feed, etag);
  }

  private self(path: string, query: Opds2QueryDto) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
    return `${OPDS2_BASE}/${path}?${params}`;
  }

  private window(query: Opds2QueryDto) {
    if (!isOffsetWithinLimit((query.page - 1) * query.size)) throw new BadRequestException('Pagination window is too deep');
  }

  private send(reply: FastifyReply, feed: OpdsFeed, previous?: string) {
    const body = JSON.stringify(feed);
    const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
    reply.header('Cache-Control', 'private, no-cache').header('Vary', 'Authorization').header('ETag', etag);
    if (previous === etag) return reply.status(304).send();
    return reply.type(OPDS2_TYPE).send(body);
  }

  private cardEntry(card: BookCard): OpdsBookEntry {
    return {
      id: card.id,
      title: card.title ?? 'Untitled',
      authors: card.authors,
      description: null,
      folderPath: '',
      addedAt: new Date(card.addedAt),
      updatedAt: new Date(card.updatedAt ?? card.addedAt),
      seriesId: card.seriesId ?? null,
      seriesName: card.seriesName,
      seriesIndex: card.seriesIndex,
      language: card.language,
      publisher: card.publisher,
      isbn13: card.isbn13,
      hasCover: card.hasCover,
      files: card.files
        .filter((file) => file.role === 'content' || file.role === 'primary')
        .map((file) => ({ id: file.id, format: file.format ?? 'unknown' })),
    };
  }
}
