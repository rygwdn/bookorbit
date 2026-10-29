import { Injectable } from '@nestjs/common';

import type { OpdsFeed, OpdsLink, OpdsPublication } from '@bookorbit/types';
import { htmlToPlainText } from '../../common/utils/html-to-text.utils';
import type { OpdsBookEntry } from './opds-book.service';
import { fileMimeType } from './opds-xml.helpers';

export const OPDS2_BASE = '/api/v1/opds/v2';
export const OPDS2_TYPE = 'application/opds+json';

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

  publication(book: OpdsBookEntry): OpdsPublication {
    const metadata: OpdsPublication['metadata'] = {
      '@type': 'http://schema.org/Book',
      title: book.title,
      identifier: `urn:bookorbit:book:${book.id}`,
      modified: book.updatedAt.toISOString(),
    };
    if (book.authors.length)
      metadata.author = book.authors.map((name) => ({ name, links: [this.link(`${OPDS2_BASE}/catalog?author=${encodeURIComponent(name)}`)] }));
    if (book.language) metadata.language = book.language;
    if (book.publisher) metadata.publisher = book.publisher;
    if (book.description) {
      // Descriptions are stored as HTML; the same plain-text projection the Atom feed carries.
      metadata.description = htmlToPlainText(book.description, { preserveLineBreaks: true });
    }
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
      // Acquisition stays on the v1 download route: it applies the reader's read-aloud delivery
      // variant, selection tokens and access checks exactly as the Atom feed does.
      ...book.files.map((file) => ({
        href: `/api/v1/opds/${book.id}/download?fileId=${file.id}`,
        type: fileMimeType(file.format),
        rel: 'acquisition',
      })),
    ];
    return {
      metadata,
      links,
      ...(book.hasCover
        ? {
            images: [
              {
                href: `/api/v1/opds/${book.id}/device-cover`,
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
