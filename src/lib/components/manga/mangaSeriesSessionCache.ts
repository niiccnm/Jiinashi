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
  provider: "anilist" | "mangabaka";
  pageInfo: {
    hasNextPage: boolean;
    currentPage: number;
  };
}

export interface RecommendationSessionEntry {
  nodes: any[];
  provider?: "anilist" | "mangabaka";
  pageCache: Map<number, RecommendationSessionPageResult>;
  pageRequests: Map<number, Promise<RecommendationSessionPageResult>>;
  nextPage: number;
  hasNextPage: boolean;
  visibleCount: number;
}

// Renderer-session cache, shared across MangaSeriesView mounts.
export const mangaSeriesSessionCache = new Map<
  string,
  SeriesSessionCacheEntry
>();

// Include provider names in cache keys to avoid ID collisions.
export const mangaRecommendationSessionCache = new Map<
  string,
  RecommendationSessionEntry
>();

// Retain visited recommendation grids across component remounts.
export const mangaRecommendationRenderedKeysSession = new Set<string>();

// Reject stale responses after provider or content-filter changes.
export let mangaMetadataRevision = 0;
const metadataInvalidationListeners = new Set<() => void>();

export function onMangaMetadataInvalidated(listener: () => void) {
  metadataInvalidationListeners.add(listener);
  return () => metadataInvalidationListeners.delete(listener);
}

export function invalidateMangaMetadataCache() {
  mangaMetadataRevision += 1;
  mangaSeriesSessionCache.clear();
  mangaRecommendationSessionCache.clear();
  mangaRecommendationRenderedKeysSession.clear();
  for (const listener of metadataInvalidationListeners) listener();
}
