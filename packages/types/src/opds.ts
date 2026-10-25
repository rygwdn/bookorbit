export type OpdsSortOrder = "recent" | "title_asc" | "title_desc" | "author_asc" | "author_desc" | "series_asc" | "series_desc";

export interface OpdsUser {
  id: number;
  userId: number;
  username: string;
  sortOrder: OpdsSortOrder;
  createdAt: string;
}

export interface CreateOpdsUserRequest {
  username: string;
  password: string;
  sortOrder?: OpdsSortOrder;
}

export interface UpdateOpdsUserRequest {
  sortOrder: OpdsSortOrder;
}

export interface OpdsProgression {
  title?: string;
  modified: string;
  device: { id: string; name: string };
  progression: number;
  references?: string[];
}

export interface OpdsLink {
  href: string;
  type?: string;
  rel?: string | string[];
  title?: string;
  templated?: boolean;
  width?: number;
  height?: number;
  properties?: Record<string, unknown>;
}

export interface OpdsPublication {
  metadata: Record<string, unknown> & { title: string };
  links: OpdsLink[];
  images?: OpdsLink[];
}

export interface OpdsFeed {
  metadata: { title: string; numberOfItems?: number; itemsPerPage?: number; currentPage?: number };
  links: OpdsLink[];
  navigation?: OpdsLink[];
  publications?: OpdsPublication[];
  groups?: OpdsFeedGroup[];
  facets?: { metadata: { title: string }; links: OpdsLink[] }[];
}

export interface OpdsFeedGroup {
  metadata: { title: string };
  links?: OpdsLink[];
  publications?: OpdsPublication[];
  navigation?: OpdsLink[];
}

export const OPDS_READING_STATS_REL = "https://bookorbit.app/rel/reading-stats";
export const OPDS_READING_STATS_TYPE = "application/vnd.bookorbit.reading-stats+json";
export const OPDS_READING_STATS_FILE_HINT = "https://bookorbit.app/ns/reading-stats";
export const OPDS_READING_STATS_BATCH_MAX = 16;

export interface OpdsReadingStatsDevice {
  id: string;
  name: string;
}
export interface OpdsReadingStatsSession {
  id: string;
  started: string;
  ended: string;
  activeSeconds: number;
  pagesTurned: number;
  startProgression?: number;
  endProgression?: number;
}
export interface OpdsReadingStatsBatch {
  version: 1;
  device: OpdsReadingStatsDevice;
  sessions: OpdsReadingStatsSession[];
}
export interface OpdsReadingStatsReceipt {
  version: 1;
  accepted: string[];
}
