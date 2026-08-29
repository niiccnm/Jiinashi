export interface SeriesSessionMatchedSource {
  source_url?: string;
  title?: string;
  id?: string;
  match_origin?: "auto" | "manual";
  is_manual_match?: boolean;
  [key: string]: unknown;
}

export interface SeriesSessionCacheEntry {
  detail: any | null;
  friends: any[];
  availableSources: any[];
  sourceGroups: any[];
  selectedVariantByGroup: Record<string, string>;
  matchedSources: Record<string, SeriesSessionMatchedSource>;
  chaptersBySource: Record<string, any[]>;
  scannedSources: Record<string, boolean>;
  currentPage: number;
}

export interface RecommendationSessionPageResult {
  nodes: any[];
  pageInfo: {
    hasNextPage: boolean;
  };
}

export interface RecommendationSessionEntry {
  nodes: any[];
  pageCache: Map<number, RecommendationSessionPageResult>;
  pageRequests: Map<number, Promise<RecommendationSessionPageResult>>;
  nextPage: number;
  hasNextPage: boolean;
  visibleCount: number;
}

// Renderer-session cache, shared across MangaSeriesView mounts.
export const mangaSeriesSessionCache = new Map<
  number,
  SeriesSessionCacheEntry
>();

// Renderer-session cache for AniList recommendations, shared across mounts.
export const mangaRecommendationSessionCache = new Map<
  number,
  RecommendationSessionEntry
>();

// Renderer-session list of recommendation media ids whose grids should stay
// retained across MangaRecommendations remounts.
export const mangaRecommendationRenderedMediaIdsSession = new Set<number>();
