import { OPDS_READING_STATS_REL, OPDS_READING_STATS_TYPE, OPDS_READING_STATS_FILE_HINT } from '@bookorbit/types';
import { AUTHENTICATION_HREF } from './opds-http';
import { Injectable } from '@nestjs/common';
import type { OpdsFeed, OpdsLink, OpdsPublication } from '@bookorbit/types';
import type { OpdsBookEntry } from './opds-book.service';
import { fileMimeType } from './opds-xml.helpers';

export const OPDS2_BASE = '/api/v1/opds/v2';
export const OPDS2_TYPE = 'application/opds+json';
export const PROGRESSION_TYPE = 'application/opds-progression+json';
export const PROGRESSION_REL = 'http://opds-spec.org/progression';

@Injectable()
export class Opds2Service {
  link(href: string, title?: string, rel?: string): OpdsLink {
    return { href, type: OPDS2_TYPE, ...(title ? { title } : {}), ...(rel ? { rel } : {}) };
  }

  feed(title: string, self: string): OpdsFeed {
    return {
      metadata: { title },
      links: [
        this.link(self, undefined, 'self'),
        this.link(OPDS2_BASE, undefined, 'start'),
        {
          href: `${OPDS2_BASE}/catalog{?query}`,
          type: OPDS2_TYPE,
          rel: 'search',
          templated: true,
        },
      ],
    };
  }

  navigation() {
    return [
      this.link(`${OPDS2_BASE}/catalog`, 'All Books', 'subsection'),
      this.link(`${OPDS2_BASE}/recent`, 'Recently Added', 'http://opds-spec.org/sort/new'),
      this.link(`${OPDS2_BASE}/series`, 'Series', 'subsection'),
      this.link(`${OPDS2_BASE}/authors`, 'Authors', 'subsection'),
      this.link(`${OPDS2_BASE}/libraries`, 'Libraries', 'subsection'),
      this.link(`${OPDS2_BASE}/collections`, 'Collections', 'subsection'),
      this.link(`${OPDS2_BASE}/smart-scopes`, 'Smart Scopes', 'subsection'),
    ];
  }

  publication(book: OpdsBookEntry, percentage?: number | null): OpdsPublication {
    const metadata: OpdsPublication['metadata'] = {
      '@type': 'http://schema.org/Book',
      title: book.title,
      identifier: `urn:bookorbit:book:${book.id}`,
      modified: book.updatedAt.toISOString(),
    };
    if (book.authors.length)
      metadata.author = book.authors.map((name) => ({ name, links: [this.link(`${OPDS2_BASE}/catalog?author=${encodeURIComponent(name)}`)] }));
    if (percentage != null) metadata['https://bookorbit.app/ns/readingProgress'] = Math.min(1, Math.max(0, percentage / 100));
    if (book.language) metadata.language = book.language;
    if (book.publisher) metadata.publisher = book.publisher;
    if (book.description) metadata.description = book.description;
    if (book.seriesName) {
      const position = Number(book.seriesIndex);
      metadata.belongsTo = {
        series: {
          name: book.seriesName,
          ...(book.seriesIndex != null && Number.isFinite(position) ? { position } : {}),
          links: [
            this.link(
              `${OPDS2_BASE}/catalog?${book.seriesId != null ? `seriesId=${book.seriesId}` : `series=${encodeURIComponent(book.seriesName)}`}`,
            ),
          ],
        },
      };
    }
    const links: OpdsLink[] = [
      { href: `${OPDS2_BASE}/publications/${book.id}`, rel: 'self', type: 'application/opds-publication+json' },
      ...book.files.map((file) => ({
        href: `/api/v1/opds/${book.id}/download?fileId=${file.id}`,
        type: fileMimeType(file.format),
        rel: 'acquisition',
        properties: {
          'https://bookorbit.app/ns/progression': `/api/v1/opds/${book.id}/progression?fileId=${file.id}`,
          [OPDS_READING_STATS_FILE_HINT]: `/api/v1/opds/${book.id}/stats?fileId=${file.id}`,
        },
      })),
      {
        href: `/api/v1/opds/${book.id}/stats`,
        rel: OPDS_READING_STATS_REL,
        type: OPDS_READING_STATS_TYPE,
        properties: { authenticate: { href: AUTHENTICATION_HREF, type: 'application/opds-authentication+json' } },
      },
      {
        href: `/api/v1/opds/${book.id}/progression`,
        rel: PROGRESSION_REL,
        type: PROGRESSION_TYPE,
        properties: { authenticate: { href: AUTHENTICATION_HREF, type: 'application/opds-authentication+json' } },
      },
    ];
    return {
      metadata,
      links,
      ...(book.hasCover
        ? {
            images: [
              {
                href: `/api/v1/opds/${book.id}/device-cover?profile=witchhunt&v=${book.updatedAt.getTime()}`,
                type: 'image/jpeg',
                width: 160,
                height: 240,
              },
              { href: `/api/v1/opds/${book.id}/thumbnail`, type: 'image/jpeg' },
            ],
          }
        : {}),
    };
  }

  page(title: string, self: string, entries: OpdsBookEntry[], total: number, page: number, size: number): OpdsFeed {
    const feed = this.feed(title, self);
    feed.metadata = { title, numberOfItems: total, itemsPerPage: size, currentPage: page };
    feed.publications = entries.map((book) => this.publication(book));
    this.paginate(feed, self, page, page * size < total);
    return feed;
  }

  paginate(feed: OpdsFeed, self: string, page: number, hasNext: boolean) {
    const url = new URL(self, 'http://localhost');
    const at = (value: number) => {
      url.searchParams.set('page', String(value));
      return url.pathname + url.search;
    };
    if (page > 1) feed.links.push(this.link(at(1), undefined, 'first'), this.link(at(page - 1), undefined, 'previous'));
    if (hasNext) feed.links.push(this.link(at(page + 1), undefined, 'next'));
  }
}
