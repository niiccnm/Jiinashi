export const MIN_SEARCH_SCORE = 0.42;
export const AUTO_ASSIGN_MIN_SCORE = 0.9;
export const AUTO_ASSIGN_MIN_DELTA = 0.08;
export const AUTO_ASSIGN_SCAN_MIN_SCORE = 0.92;
export const AUTO_ASSIGN_SCAN_MIN_DELTA = 0.1;
export const MAX_CANDIDATES = 10;
export const MAX_SEARCH_QUERIES = 3;
export const DEFERRED_LINKER_CONCURRENCY = 1;
// A scan group normally makes both an AniList search and detail request.
export const DEFERRED_LINKER_MIN_INTERVAL_MS = 5000;
export const DEFERRED_RATE_LIMIT_JITTER_MS = 4000;
export const DEFERRED_TRANSIENT_RETRY_BASE_MS = 5000;
export const DEFERRED_TRANSIENT_RETRY_MAX_MS = 5 * 60 * 1000;
export const SCAN_ROOT_TITLE_MIN_SIMILARITY = 0.55;
export const DEFAULT_RATE_LIMIT_RETRY_MS = 30000;

export type ResolveStatus = "resolved" | "ambiguous" | "unresolved";
export type ResolveMode = "default" | "scan_deferred";
export type MangaPreference = "auto" | "force_manga" | "force_non_manga";

export interface MangaLinkResolveInput {
  itemIds?: number[];
  itemPaths?: string[];
  folderPath?: string | null;
  preferredTitle?: string | null;
  titleCandidates?: string[];
  preferredAnilistId?: number | null;
  preferredMalId?: number | null;
  preferredMangabakaId?: number | null;
  groupKey?: string | null;
  mode?: ResolveMode;
  scanSessionId?: string | null;
  scanRootPath?: string | null;
  seriesAnchorPath?: string | null;
}

export interface MangaLinkCandidate {
  anilistId: number | null;
  malId: number | null;
  mangabakaId: number | null;
  sourceUrl: string;
  title: string;
  titleRomaji?: string;
  titleEnglish?: string;
  titleNative?: string;
  sourceFormat?: string;
  coverUrl?: string;
  year?: number | null;
  score: number;
  confidence: "high" | "medium" | "low";
  matchedTitle: string;
}

export interface MangaLinkResolveResult {
  status: ResolveStatus;
  groupKey: string;
  inferredTitle: string;
  seriesId: number | null;
  candidate: MangaLinkCandidate | null;
  candidates: MangaLinkCandidate[];
  reason?: string;
}

export interface PendingMangaLinkItem {
  itemId: number;
  itemPath: string;
  rawTitle?: string | null;
  scanSessionId?: string | null;
  scanRootPath?: string | null;
  scanScopeRootPath?: string | null;
}

export interface PendingMangaLinkGroup {
  groupKey: string;
  folderPath: string | null;
  itemIds: number[];
  itemPaths: string[];
  preferredTitle: string | null;
  titleCandidates: string[];
  scanSessionId: string | null;
  scanRootPath: string | null;
  seriesAnchorPath: string | null;
}

export interface DeferredMangaLinkStats {
  queued: number;
  deduped: number;
}

export interface MangaLinkHealResult {
  validatedCandidates: number;
  contaminatedGroups: number;
  clearedItems: number;
  evidenceKeeps: number;
  clearedItemIds: number[];
  pendingItems: PendingMangaLinkItem[];
}

export function toPositiveInt(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function isRetryableMangaLinkError(error: unknown): boolean {
  const status = toPositiveInt(
    (error as any)?.status || (error as any)?.response?.status,
  );
  const code = String((error as any)?.code || "").toUpperCase();
  const message = String((error as any)?.message || "").toLowerCase();
  return (
    Boolean((error as any)?.isAniListRateLimitError) ||
    status === 408 || status === 429 || status >= 500 ||
    ["ECONNABORTED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].includes(code) ||
    /timed out|network error/.test(message)
  );
}

export function normalizeMangaPreference(value: unknown): MangaPreference {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "force_manga") return "force_manga";
  if (normalized === "force_non_manga") return "force_non_manga";
  return "auto";
}
