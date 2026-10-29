import { Test } from '@nestjs/testing';
import { Opds2Service, OPDS2_BASE } from './opds2.service';
import type { OpdsBookEntry } from './opds-book.service';

const book: OpdsBookEntry = {
  id: 7,
  title: 'Café',
  folderPath: '',
  addedAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  description: '<p>A story</p>',
  seriesId: 9,
  seriesName: 'Saga',
  seriesIndex: '2.5',
  language: 'en',
  publisher: null,
  isbn13: null,
  hasCover: true,
  authors: ['A & B'],
  files: [{ id: 12, format: 'epub' }],
};

describe('Opds2Service', () => {
  let service: Opds2Service;
  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [Opds2Service] }).compile();
    service = module.get(Opds2Service);
  });

  it('exposes acquisition and navigable metadata', () => {
    const result = service.publication(book);
    expect(result.metadata.title).toBe('Café');
    expect(result.metadata.belongsTo).toMatchObject({
      series: { name: 'Saga', position: 2.5, links: [{ href: `${OPDS2_BASE}/catalog?seriesId=9` }] },
    });
    // Descriptions are stored as HTML; the JSON feed carries the same plain-text
    // projection the Atom feed does.
    expect(result.metadata.description).toBe('A story');
    expect(result.links).toContainEqual(
      expect.objectContaining({ href: '/api/v1/opds/7/download?fileId=12', type: 'application/epub+zip', rel: 'acquisition' }),
    );
    expect(result.images?.[0]).toMatchObject({ width: 160, height: 240, type: 'image/jpeg' });
    expect(result.metadata).not.toHaveProperty('publisher');
  });

  it('preserves catalog filters in pagination and supplies RFC6570 search', () => {
    const result = service.page('Saga', `${OPDS2_BASE}/catalog?seriesId=9&page=2&size=5`, [book], 30, 2, 5);
    expect(result.links.find((link) => link.rel === 'next')?.href).toBe(`${OPDS2_BASE}/catalog?seriesId=9&page=3&size=5`);
    expect(result.links.find((link) => link.rel === 'previous')?.href).toBe(`${OPDS2_BASE}/catalog?seriesId=9&page=1&size=5`);
    expect(result.links.find((link) => link.rel === 'search')).toMatchObject({ href: `${OPDS2_BASE}/catalog{?query}`, templated: true });
    expect(result.metadata).toMatchObject({ numberOfItems: 30, itemsPerPage: 5, currentPage: 2 });
  });

  it('keeps nonnumeric series labels out of numeric position', () => {
    expect(service.publication({ ...book, seriesIndex: 'Omnibus' }).metadata.belongsTo).toEqual({
      series: {
        name: 'Saga',
        links: [{ href: `${OPDS2_BASE}/catalog?seriesId=9`, type: 'application/opds+json' }],
      },
    });
  });
});
