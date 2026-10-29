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

## Reading position (OPDS progression)

Progress sync uses the OPDS progression draft. Every publication carries:

- a feed-level link `rel="http://opds-spec.org/progression"`
  (`application/opds-progression+json`) to `/api/v1/opds/:bookId/progression`;
- one per-file acquisition property `https://bookorbit.app/ns/progression`
  pointing at `/api/v1/opds/:bookId/progression?fileId=<fileId>`, so a device
  always targets the file it is reading.

The routes are served by the OPDS 1.2 controller and guarded by OPDS Basic
credentials exactly like the rest of the catalog:

- `GET /api/v1/opds/:bookId/progression[?fileId=]` returns the stored
  progression document, or an empty 200 when the reader has not started the
  book. Without `fileId` the primary content file is addressed.
- `PUT` accepts a progression document (`modified`, `device`,
  `progression` 0..1, optional `references`) and stores it atomically. An
  older `modified` than the stored point is rejected with 409
  (Problem Details, `https://registry.opds.io/error#progression-date`); an
  identical replay is idempotent.

Writing progress is bridged into the rest of Bookorbit in the same way the
KOReader and audio integrations are: the progression row, the read-status
rules and the Kobo two-way sync run in one serialized write transaction
(an advisory lock serializes writers). The effects commit atomically with the
row they belong to: a failed effect rolls the whole update back, and the
client's identical retry replays the write together with the effects. An
accepted identical replay finds the stored row and returns it unchanged
without re-running the effects. A deliberate backward move (10 or more points
down) reaches the read-status rules as strong re-read evidence. Achievement
notifications fired inside the rules stay best-effort.

Errors follow OPDS Problem Details: 401 answers with the OPDS authentication
document (`GET /api/v1/opds/authentication`,
`application/opds-authentication+json`, HTTP Basic), 400/409 are
`application/problem+json` documents.

## What stage 2 does not cover

Reading-statistics documents (custom session stats), per-device stat
ingestion and their schema are the next stage; acquisition links advertise
progression only. The catalog stays read-only apart from progression: no
checkouts, holds or grouping feeds.
