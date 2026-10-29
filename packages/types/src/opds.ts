import type { ReadAloudDeliveryPreference } from "./delivery";

export type OpdsSortOrder = "recent" | "title_asc" | "title_desc" | "author_asc" | "author_desc" | "series_asc" | "series_desc";

export interface OpdsUser {
  id: number;
  userId: number;
  username: string;
  readAloudDelivery?: ReadAloudDeliveryPreference;
  sortOrder: OpdsSortOrder;
  createdAt: string;
}

export interface CreateOpdsUserRequest {
  username: string;
  password: string;
  readAloudDelivery?: ReadAloudDeliveryPreference;
  sortOrder?: OpdsSortOrder;
}

export interface UpdateOpdsUserRequest {
  readAloudDelivery?: ReadAloudDeliveryPreference;
  sortOrder?: OpdsSortOrder;
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
