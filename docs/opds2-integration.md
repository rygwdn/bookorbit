# OPDS 2.0 catalog integration

Bookorbit serves a read-only OPDS 2.0 (`application/opds+json`) catalog at
`/api/v1/opds/v2`, next to the existing OPDS 1.2 Atom catalog at `/api/v1/opds`.
Both catalogs are guarded the same way: OPDS must be enabled and requests must
carry either OPDS Basic credentials or, for image URLs only, a signed cover
token.

## Layout

| Endpoint                                                                  | Purpose                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/opds/v2`                                                     | Root feed: dashboard shelves (Continue Reading, Up Next, Recently Added) as groups plus a Browse navigation group.                                                                                                         |
| `GET /api/v1/opds/v2/catalog`                                             | Paginated acquisition feed over every accessible book. Accepts the same filters as the v1 catalog: `query`, `author`, `series`, `seriesId`, `libraryId`, `collectionId`, `smartScopeId`, `readStatus`, plus `page`/`size`. |
| `GET /api/v1/opds/v2/recent`                                              | Paginated feed of recently added books.                                                                                                                                                                                    |
| `GET /api/v1/opds/v2/{authors,series,libraries,collections,smart-scopes}` | Paginated navigation feeds. `authors` links into `catalog?author=…`, `series` into `catalog?seriesId=…`, the rest into their respective `catalog` filters.                                                                 |
| `GET /api/v1/opds/v2/publications/:bookId`                                | Single-book OPDS publication document (`application/opds-publication+json`).                                                                                                                                               |

Pagination defaults to `page=1`, `size=20` (catalog cap 100, window cap 100000
offset rows, identical to the v1 catalog). Every paginated feed advertises
`first`, `previous` and `next` links on `self`, and reports
`numberOfItems`/`itemsPerPage`/`currentPage` in `metadata` when a total is
known. Navigation-only feeds (authors, series, libraries, collections,
smart scopes) paginate by fetching one row past the page and emitting a `next`
link only when it existed.

Feeds carry `ETag` headers hashed from the serialized body with
`Cache-Control: private, no-cache` and `Vary: Authorization`, so clients can
revalidate cheaply without ever serving one account's feed from another's cache.

## Publication shape

Each publication carries:

- `metadata`: `@type`, `title`, `identifier` (`urn:bookorbit:book:<id>`),
  `modified`, `language`, `publisher`, plain-text `description` (stored HTML is
  projected through the same plain-text conversion the Atom feed uses),
  `author` (each with a catalog-search link), and `belongsTo.series` with
  `name`, numeric `position` when the series index is numeric, and a link that
  narrows the catalog to that series.
- `links`: a `self` link to the publication document and one `acquisition` link
  per content/primary file, pointing at the v1 download route
  (`/api/v1/opds/:bookId/download?fileId=…`). Downloads therefore keep every
  delivery behavior of the existing catalog: read-aloud delivery variants,
  selection tokens and access checks.
- `images`: the 160x240 device cover and the existing thumbnail.

## Device-sized covers

`GET /api/v1/opds/:bookId/device-cover` (same OPDS guards) returns a
160x240 JPEG rendered from the book's face cover. The bytes are cached on the
server under the app-data cover directory and regenerated when a cover is
saved or replaced, so device polling costs one ETag comparison when nothing
changed. The response is keyed by a content-hash `ETag` with
`Cache-Control: private, no-cache` and `Vary: Authorization`.

OPDS feeds advertise the device cover on every publication that has cover art;
clients that cannot use it fall back to the plain thumbnail link that follows.

## Settings

The settings page shows both catalog endpoints (OPDS 1.2 and OPDS 2.0) with
independent copy buttons under _Reader → OPDS_.

## What stage 1 does not cover

Reading-position progression, reading-statistics documents and OPDS
authentication documents are not part of this stage; acquisition links remain
on the OPDS 1.2 download route and progress sync continues to flow through the
existing integrations. The catalog stays read-only: no checkouts, holds or
grouping feeds.
