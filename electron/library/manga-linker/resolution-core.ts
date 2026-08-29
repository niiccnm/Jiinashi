import path from "path";
import { getItemById, updateItem } from "../../database/database";
import * as mangaQueries from "../../database/queries/manga";
import { mangabakaMetadataService } from "../../metadata/mangabaka";
import { anilistService } from "../../tracking/anilist";
import { trackingService } from "../../tracking/tracking-service";
import {
  AUTO_ASSIGN_MIN_DELTA,
  AUTO_ASSIGN_MIN_SCORE,
  AUTO_ASSIGN_SCAN_MIN_DELTA,
  AUTO_ASSIGN_SCAN_MIN_SCORE,
  DEFAULT_RATE_LIMIT_RETRY_MS,
  MAX_CANDIDATES,
  MAX_SEARCH_QUERIES,
  MIN_SEARCH_SCORE,
  SCAN_ROOT_TITLE_MIN_SIMILARITY,
  isRetryableMangaLinkError,
  type MangaLinkCandidate,
  type MangaLinkResolveInput,
  type MangaLinkResolveResult,
  type PendingMangaLinkGroup,
  type ResolveMode,
  toPositiveInt,
} from "./contracts";
import {
  buildTitleCandidates,
  cleanDescription,
  extractStaffNames,
  firstMeaningfulTitle,
  getCandidateTitles,
  getDisplayTitle,
  inferMangaLinkTitle,
  isMeaningfulTitleToken,
  mapFormat,
  mapStatus,
  normalizeTitleForCompare,
  scoreToConfidence,
  titleSimilarity,
  uniqueStrings,
} from "./title-utils";
import {
  isPendingGroupHomogeneous,
  normalizePathForKey,
  normalizePendingGroup,
  splitPendingGroupByRootAndAnchor,
} from "./scope-utils";

let anilistSearchCooldownUntilMs = 0;
type CanonicalSourceId = "anilist" | "mangabaka";

function canonicalSourcePriority(sourceId: unknown): number {
  const normalized = String(sourceId || "").trim().toLowerCase();
  if (normalized === "anilist") return 3;
  if (normalized === "mal") return 2;
  if (normalized === "mangabaka") return 1;
  return 0;
}

function pickExistingSeriesByIdentity(payload: {
  source_id: string;
  source_url: string;
  anilist_id?: number;
  mal_id?: number;
  mangabaka_id?: number;
}) {
  const anilistId = toPositiveInt(payload.anilist_id);
  const malId = toPositiveInt(payload.mal_id);
  const mangabakaId = toPositiveInt(payload.mangabaka_id);
  return (
    (anilistId > 0 ? mangaQueries.getMangaSeriesByAnilistId(anilistId) : null) ||
    (malId > 0 ? mangaQueries.getMangaSeriesByMalId(malId) : null) ||
    (mangabakaId > 0
      ? mangaQueries.getMangaSeriesByMangabakaId(mangabakaId)
      : null) ||
    mangaQueries.getMangaSeriesBySource(payload.source_id, payload.source_url)
  );
}

function toDefinedSeriesUpdates(payload: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([_, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      if (typeof value === "string" && value.trim().length === 0) return false;
      return true;
    }),
  );
}

function hasMeaningfulSeriesValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }
  return true;
}

function preferExistingSeriesValue<T>(existing: T, incoming: T): T {
  return hasMeaningfulSeriesValue(existing) ? existing : incoming;
}

function preferReadingFormat(
  existing: unknown,
  incoming: unknown,
): "manga" | "manhwa" | "manhua" {
  const normalizedExisting = String(existing || "")
    .trim()
    .toLowerCase();
  const normalizedIncoming = String(incoming || "")
    .trim()
    .toLowerCase();

  if (
    normalizedExisting === "manga" &&
    (normalizedIncoming === "manhwa" || normalizedIncoming === "manhua")
  ) {
    return normalizedIncoming as "manhwa" | "manhua";
  }
  if (
    normalizedExisting === "manga" ||
    normalizedExisting === "manhwa" ||
    normalizedExisting === "manhua"
  ) {
    return normalizedExisting as "manga" | "manhwa" | "manhua";
  }
  if (normalizedIncoming === "manhwa" || normalizedIncoming === "manhua") {
    return normalizedIncoming as "manhwa" | "manhua";
  }
  return "manga";
}

function preferExistingOriginalTitle(
  existingOriginal: unknown,
  incomingOriginal: unknown,
  existingRomaji: unknown,
  existingEnglish: unknown,
) {
  const existing = String(existingOriginal || "").trim();
  const incoming = String(incomingOriginal || "").trim();
  if (!incoming) return existing;
  if (!existing) return incoming;

  const romaji = String(existingRomaji || "").trim();
  const english = String(existingEnglish || "").trim();
  if (existing === romaji || existing === english) {
    return incoming;
  }
  return existing;
}

function preferExistingId(existing: unknown, incoming: unknown): number | undefined {
  const existingId = toPositiveInt(existing);
  if (existingId > 0) return existingId;
  const incomingId = toPositiveInt(incoming);
  return incomingId > 0 ? incomingId : undefined;
}

function upsertCanonicalSeries(payload: {
  source_id: CanonicalSourceId;
  source_url: string;
  anilist_id?: number;
  mal_id?: number;
  mangabaka_id?: number;
  title_original: string;
  title_romaji?: string;
  title_english?: string;
  description?: string;
  cover_url?: string;
  banner_url?: string;
  author?: string;
  artist?: string;
  status?: "ongoing" | "completed" | "hiatus" | "cancelled";
  reading_format: "manga" | "manhwa" | "manhua";
  mal_score?: number;
  year?: number;
  genres?: string[];
  last_updated: string;
}) {
  const existing = pickExistingSeriesByIdentity(payload);
  if (!existing?.id) {
    return mangaQueries.addMangaSeries(payload);
  }

  const incomingPriority = canonicalSourcePriority(payload.source_id);
  const existingPriority = canonicalSourcePriority(existing.source_id);
  const preserveExistingSource = existingPriority > incomingPriority;
  const mergedPayload = preserveExistingSource
    ? {
        ...payload,
        anilist_id: preferExistingId(existing.anilist_id, payload.anilist_id),
        mal_id: preferExistingId(existing.mal_id, payload.mal_id),
        mangabaka_id: preferExistingId(existing.mangabaka_id, payload.mangabaka_id),
        title_original: preferExistingOriginalTitle(
          existing.title_original,
          payload.title_original,
          existing.title_romaji,
          existing.title_english,
        ),
        title_romaji: preferExistingSeriesValue(
          existing.title_romaji,
          payload.title_romaji,
        ),
        title_english: preferExistingSeriesValue(
          existing.title_english,
          payload.title_english,
        ),
        description: preferExistingSeriesValue(
          existing.description,
          payload.description,
        ),
        cover_url: preferExistingSeriesValue(existing.cover_url, payload.cover_url),
        banner_url: preferExistingSeriesValue(existing.banner_url, payload.banner_url),
        author: preferExistingSeriesValue(existing.author, payload.author),
        artist: preferExistingSeriesValue(existing.artist, payload.artist),
        status: preferExistingSeriesValue(existing.status, payload.status),
        reading_format: preferReadingFormat(
          existing.reading_format,
          payload.reading_format,
        ),
        mal_score: preferExistingSeriesValue(existing.mal_score, payload.mal_score),
        year: preferExistingSeriesValue(existing.year, payload.year),
        genres: preferExistingSeriesValue(existing.genres, payload.genres),
      }
    : payload;
  const updates = toDefinedSeriesUpdates({
    ...(preserveExistingSource
      ? {}
      : {
          source_id: mergedPayload.source_id,
          source_url: mergedPayload.source_url,
        }),
    anilist_id: mergedPayload.anilist_id,
    mal_id: mergedPayload.mal_id,
    mangabaka_id: mergedPayload.mangabaka_id,
    title_original: mergedPayload.title_original,
    title_romaji: mergedPayload.title_romaji,
    title_english: mergedPayload.title_english,
    description: mergedPayload.description,
    cover_url: mergedPayload.cover_url,
    banner_url: mergedPayload.banner_url,
    author: mergedPayload.author,
    artist: mergedPayload.artist,
    status: mergedPayload.status,
    reading_format: mergedPayload.reading_format,
    mal_score: mergedPayload.mal_score,
    year: mergedPayload.year,
    genres: mergedPayload.genres,
    last_updated: mergedPayload.last_updated,
  });

  if (Object.keys(updates).length > 0) {
    mangaQueries.updateMangaSeries(existing.id, updates);
  }
  return existing.id;
}

function mapMangabakaStatus(
  value: unknown,
): "ongoing" | "completed" | "hiatus" | "cancelled" | undefined {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "completed") return "completed";
  if (normalized === "releasing" || normalized === "ongoing") return "ongoing";
  if (normalized === "hiatus") return "hiatus";
  if (normalized === "cancelled") return "cancelled";
  return undefined;
}

function mapMangabakaFormat(typeValue: unknown) {
  const normalized = String(typeValue || "")
    .trim()
    .toLowerCase();
  if (normalized === "manhwa") return "manhwa" as const;
  if (normalized === "manhua") return "manhua" as const;
  return "manga" as const;
}

function getMangabakaCoverUrl(series: any) {
  return (
    String(series?.cover?.raw?.url || "").trim() ||
    String(series?.cover?.x350?.x2 || "").trim() ||
    String(series?.cover?.x350?.x1 || "").trim() ||
    String(series?.cover?.x250?.x2 || "").trim() ||
    String(series?.cover?.x250?.x1 || "").trim() ||
    undefined
  );
}

function getMangabakaSourceIds(series: any) {
  return {
    anilistId: toPositiveInt(series?.source?.anilist?.id) || null,
    malId: toPositiveInt(series?.source?.my_anime_list?.id) || null,
    mangabakaId: toPositiveInt(series?.id) || null,
  };
}

function mapMangabakaToCandidate(
  series: any,
  score: number,
  matchedTitle: string,
): MangaLinkCandidate | null {
  const ids = getMangabakaSourceIds(series);
  if (!ids.mangabakaId) return null;

  const title = firstMeaningfulTitle([
    String(series?.title || "").trim(),
    String(series?.romanized_title || "").trim(),
    String(series?.native_title || "").trim(),
  ]);
  if (!title) return null;

  return {
    anilistId: ids.anilistId,
    malId: ids.malId,
    mangabakaId: ids.mangabakaId,
    sourceUrl: `https://mangabaka.org/${ids.mangabakaId}`,
    title,
    titleRomaji: String(series?.romanized_title || "").trim() || undefined,
    titleEnglish: String(series?.title || "").trim() || undefined,
    titleNative: String(series?.native_title || "").trim() || undefined,
    coverUrl: getMangabakaCoverUrl(series),
    year: toPositiveInt(series?.year) || null,
    score,
    confidence: scoreToConfidence(score),
    matchedTitle,
  };
}

function buildGroupKey(
  folderPath: string | null | undefined,
  inferredTitle: string,
  itemIds: number[],
): string {
  const normalizedFolder = normalizeTitleForCompare(String(folderPath || "").trim());
  const normalizedTitle = normalizeTitleForCompare(inferredTitle);
  const normalizedIds = Array.from(new Set(itemIds.filter(Boolean))).sort((a, b) => a - b);
  const idsPart = normalizedIds.length ? normalizedIds.join("-") : "none";
  return `${normalizedFolder || "root"}::${normalizedTitle || "untitled"}::${idsPart}`;
}

async function upsertCanonicalSeriesFromAniList(
  anilistId: number,
  fallbackCandidate?: MangaLinkCandidate | null,
  exactRestore?: {
    detail?: any;
    malId?: number;
    mangabakaId?: number;
  },
): Promise<{ seriesId: number; candidate: MangaLinkCandidate | null }> {
  const normalizedAnilistId = toPositiveInt(anilistId);
  if (normalizedAnilistId <= 0) {
    throw new Error("Invalid AniList ID");
  }

  const existing = mangaQueries.getMangaSeriesByAnilistId(normalizedAnilistId);
  let detail: any = exactRestore?.detail || null;
  if (!detail) {
    try {
      detail = await anilistService.getDetails(normalizedAnilistId);
    } catch (error) {
      if (isRetryableMangaLinkError(error)) throw error;
      detail = null;
    }
  }
  if (!detail && existing?.id) {
    return { seriesId: existing.id, candidate: fallbackCandidate || null };
  }
  if (!detail && !fallbackCandidate) {
    throw new Error("Failed to fetch AniList details");
  }
  const safeDetail = detail || {};
  let malId = toPositiveInt(
    safeDetail?.idMal ||
      exactRestore?.malId ||
      fallbackCandidate?.malId ||
      0,
  );
  if (malId <= 0 && !exactRestore) {
    malId = toPositiveInt(
      await trackingService.searchMalIdByTitle(normalizedAnilistId),
    );
  }
  let mangabakaId = toPositiveInt(
    exactRestore?.mangabakaId || fallbackCandidate?.mangabakaId || 0,
  );
  if (mangabakaId <= 0 && !exactRestore) {
    try {
      const mapped = await mangabakaMetadataService.getSeriesByAniListId(
        normalizedAnilistId,
      );
      mangabakaId = toPositiveInt(mapped?.id);
    } catch {
      mangabakaId = 0;
    }
  }

  const titles = {
    english: String(safeDetail?.title?.english || "").trim() || undefined,
    romaji: String(safeDetail?.title?.romaji || "").trim() || undefined,
    native: String(safeDetail?.title?.native || "").trim() || undefined,
  };
  const fallbackTitle = fallbackCandidate?.title || "Unknown title";
  const canonicalTitle =
    titles.native || titles.romaji || titles.english || fallbackTitle;
  const authorArtist = extractStaffNames(safeDetail);
  const averageScore = Number(safeDetail?.averageScore || 0);
  const year = Number(safeDetail?.startDate?.year || 0);

  const seriesId = upsertCanonicalSeries({
    source_id: "anilist",
    source_url: `https://anilist.co/manga/${normalizedAnilistId}`,
    anilist_id: normalizedAnilistId,
    mal_id: malId > 0 ? malId : undefined,
    mangabaka_id: mangabakaId > 0 ? mangabakaId : undefined,
    title_original: titles.native || "",
    title_romaji: titles.romaji,
    title_english: titles.english,
    description: cleanDescription(safeDetail?.description),
    cover_url:
      String(safeDetail?.coverImage?.extraLarge || "").trim() ||
      String(safeDetail?.coverImage?.large || "").trim() ||
      fallbackCandidate?.coverUrl,
    banner_url: String(safeDetail?.bannerImage || "").trim() || undefined,
    author: authorArtist.author,
    artist: authorArtist.artist,
    status: mapStatus(safeDetail?.status),
    reading_format: mapFormat(safeDetail?.format, safeDetail?.countryOfOrigin),
    mal_score:
      Number.isFinite(averageScore) && averageScore > 0
        ? Math.round((averageScore / 10) * 100) / 100
        : undefined,
    year: Number.isFinite(year) && year > 0 ? year : undefined,
    genres: Array.isArray(safeDetail?.genres) ? safeDetail.genres : undefined,
    last_updated: new Date().toISOString(),
  });

  const candidate: MangaLinkCandidate = {
    anilistId: normalizedAnilistId,
    malId: malId > 0 ? malId : null,
    mangabakaId: mangabakaId > 0 ? mangabakaId : null,
    sourceUrl: `https://anilist.co/manga/${normalizedAnilistId}`,
    title: getDisplayTitle(safeDetail),
    titleRomaji: titles.romaji,
    titleEnglish: titles.english,
    titleNative: titles.native,
    coverUrl:
      String(safeDetail?.coverImage?.large || "").trim() ||
      String(safeDetail?.coverImage?.extraLarge || "").trim() ||
      fallbackCandidate?.coverUrl,
    year: Number.isFinite(year) && year > 0 ? year : null,
    score: fallbackCandidate?.score || (existing ? 1 : 0.99),
    confidence: fallbackCandidate?.confidence || "high",
    matchedTitle: fallbackCandidate?.matchedTitle || canonicalTitle,
  };

  return { seriesId, candidate };
}

export async function resolveMangaSeriesByExactIdentifiers(input: {
  anilistId?: number;
  malId?: number;
  mangabakaId?: number;
}): Promise<number | null> {
  const anilistId = toPositiveInt(input.anilistId);
  const malId = toPositiveInt(input.malId);
  const mangabakaId = toPositiveInt(input.mangabakaId);
  const existing =
    (anilistId > 0 ? mangaQueries.getMangaSeriesByAnilistId(anilistId) : null) ||
    (malId > 0 ? mangaQueries.getMangaSeriesByMalId(malId) : null) ||
    (mangabakaId > 0
      ? mangaQueries.getMangaSeriesByMangabakaId(mangabakaId)
      : null);
  if (existing?.id) return existing.id;

  const attempts: Array<() => Promise<number | null>> = [];
  if (anilistId > 0) {
    attempts.push(async () => {
      const resolved = await upsertCanonicalSeriesFromAniList(anilistId, null, {
        malId,
        mangabakaId,
      });
      return resolved.seriesId;
    });
  }
  if (mangabakaId > 0) {
    attempts.push(async () => {
      const resolved = await upsertCanonicalSeriesFromMangabaka(mangabakaId);
      return resolved.seriesId;
    });
  }
  if (malId > 0) {
    attempts.push(async () => {
      const detail = await anilistService.getByMalId(malId);
      const resolvedAnilistId = toPositiveInt(detail?.id);
      if (resolvedAnilistId <= 0) return null;
      const resolved = await upsertCanonicalSeriesFromAniList(
        resolvedAnilistId,
        null,
        {
          detail,
          malId,
          mangabakaId,
        },
      );
      return resolved.seriesId;
    });
  }

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const seriesId = await attempt();
      if (seriesId) return seriesId;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return null;
}

async function upsertCanonicalSeriesFromMangabaka(
  mangabakaId: number,
  fallbackCandidate?: MangaLinkCandidate | null,
): Promise<{ seriesId: number; candidate: MangaLinkCandidate | null }> {
  const normalizedMangabakaId = toPositiveInt(mangabakaId);
  if (normalizedMangabakaId <= 0) {
    throw new Error("Invalid Mangabaka ID");
  }

  let seriesPayload: any = null;
  try {
    const detail = await mangabakaMetadataService.getSeries(normalizedMangabakaId);
    seriesPayload = detail?.data || detail || null;
  } catch (error) {
    if (isRetryableMangaLinkError(error)) throw error;
    seriesPayload = null;
  }

  if (!seriesPayload && !fallbackCandidate) {
    const existing =
      mangaQueries.getMangaSeriesByMangabakaId(normalizedMangabakaId);
    if (existing?.id) {
      return { seriesId: existing.id, candidate: null };
    }
    throw new Error("Failed to fetch Mangabaka details");
  }

  const ids = getMangabakaSourceIds(seriesPayload || {});
  const resolvedAnilistId =
    toPositiveInt(ids.anilistId || fallbackCandidate?.anilistId || 0) || 0;
  const resolvedMalId =
    toPositiveInt(ids.malId || fallbackCandidate?.malId || 0) || 0;
  const resolvedMangabakaId =
    toPositiveInt(ids.mangabakaId || normalizedMangabakaId) || normalizedMangabakaId;
  const nativeTitle = String(seriesPayload?.native_title || "").trim();
  const romajiTitle = String(seriesPayload?.romanized_title || "").trim();
  const englishTitle = String(seriesPayload?.title || "").trim();
  const canonicalTitle =
    firstMeaningfulTitle([nativeTitle, romajiTitle, englishTitle]) ||
    fallbackCandidate?.title ||
    `Mangabaka #${resolvedMangabakaId}`;
  const rating = Number(seriesPayload?.rating || 0);
  const year = toPositiveInt(seriesPayload?.year || fallbackCandidate?.year || 0);

  const seriesId = upsertCanonicalSeries({
    source_id: "mangabaka",
    source_url: `https://mangabaka.org/${resolvedMangabakaId}`,
    anilist_id: resolvedAnilistId > 0 ? resolvedAnilistId : undefined,
    mal_id: resolvedMalId > 0 ? resolvedMalId : undefined,
    mangabaka_id: resolvedMangabakaId,
    title_original: nativeTitle || fallbackCandidate?.titleNative || "",
    title_romaji: romajiTitle || fallbackCandidate?.titleRomaji,
    title_english: englishTitle || fallbackCandidate?.titleEnglish,
    description: cleanDescription(seriesPayload?.description),
    cover_url: getMangabakaCoverUrl(seriesPayload) || fallbackCandidate?.coverUrl,
    author: Array.isArray(seriesPayload?.authors)
      ? uniqueStrings(seriesPayload.authors).join(", ") || undefined
      : undefined,
    artist: Array.isArray(seriesPayload?.artists)
      ? uniqueStrings(seriesPayload.artists).join(", ") || undefined
      : undefined,
    status: mapMangabakaStatus(seriesPayload?.status),
    reading_format: mapMangabakaFormat(seriesPayload?.type),
    mal_score:
      Number.isFinite(rating) && rating > 0
        ? Math.round((rating / 10) * 100) / 100
        : undefined,
    year: year > 0 ? year : undefined,
    genres: Array.isArray(seriesPayload?.genres)
      ? uniqueStrings(seriesPayload.genres)
      : undefined,
    last_updated: new Date().toISOString(),
  });

  const score = fallbackCandidate?.score || 0.95;
  const candidate: MangaLinkCandidate = {
    anilistId: resolvedAnilistId > 0 ? resolvedAnilistId : null,
    malId: resolvedMalId > 0 ? resolvedMalId : null,
    mangabakaId: resolvedMangabakaId,
    sourceUrl: `https://mangabaka.org/${resolvedMangabakaId}`,
    title: canonicalTitle,
    titleRomaji: romajiTitle || fallbackCandidate?.titleRomaji,
    titleEnglish: englishTitle || fallbackCandidate?.titleEnglish,
    titleNative: nativeTitle || fallbackCandidate?.titleNative,
    coverUrl: getMangabakaCoverUrl(seriesPayload) || fallbackCandidate?.coverUrl,
    year: year > 0 ? year : fallbackCandidate?.year || null,
    score,
    confidence: fallbackCandidate?.confidence || scoreToConfidence(score),
    matchedTitle: fallbackCandidate?.matchedTitle || canonicalTitle,
  };

  return { seriesId, candidate };
}

async function searchMangabakaCandidates(
  titleCandidates: string[],
  mode: ResolveMode,
): Promise<MangaLinkCandidate[]> {
  const queryLimit = mode === "scan_deferred" ? 1 : MAX_SEARCH_QUERIES;
  const queryList = titleCandidates.slice(0, queryLimit);
  const byId = new Map<number, MangaLinkCandidate>();
  let retryableError: unknown = null;

  for (const query of queryList) {
    let payload: any = null;
    try {
      payload = await mangabakaMetadataService.search(query, 1, MAX_CANDIDATES);
    } catch (error) {
      if (isRetryableMangaLinkError(error)) retryableError = error;
      payload = null;
    }
    const seriesList = Array.isArray(payload?.data) ? payload.data : [];
    for (const series of seriesList) {
      const candidateId = toPositiveInt(series?.id);
      if (candidateId <= 0) continue;

      const candidateTitles = uniqueStrings([
        series?.title,
        series?.romanized_title,
        series?.native_title,
      ]);
      if (candidateTitles.length === 0) continue;

      let bestScore = 0;
      let bestMatchedTitle = query;
      for (const queryTitle of titleCandidates) {
        for (const candidateTitle of candidateTitles) {
          const score = titleSimilarity(queryTitle, candidateTitle);
          if (score > bestScore) {
            bestScore = score;
            bestMatchedTitle = queryTitle;
          }
        }
      }
      if (bestScore < MIN_SEARCH_SCORE) continue;

      const mapped = mapMangabakaToCandidate(series, bestScore, bestMatchedTitle);
      if (!mapped) continue;
      const existing = byId.get(candidateId);
      if (existing && existing.score >= bestScore) continue;
      byId.set(candidateId, mapped);
    }
  }

  if (byId.size === 0 && retryableError) throw retryableError;

  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);
}

export async function resolveCandidates(
  input: MangaLinkResolveInput,
): Promise<MangaLinkCandidate[]> {
  const mode: ResolveMode = input.mode || "default";
  const shouldEnrichMal = mode === "default";
  const preferredAnilistId = toPositiveInt(input.preferredAnilistId);
  const preferredMalId = toPositiveInt(input.preferredMalId);
  const preferredMangabakaId = toPositiveInt(input.preferredMangabakaId);
  if (preferredAnilistId > 0) {
    let media: any = null;
    try {
      media = await anilistService.getDetails(preferredAnilistId);
    } catch {
      media = null;
    }
    let mappedMangabaka: any = null;
    try {
      mappedMangabaka = await mangabakaMetadataService.getSeriesByAniListId(
        preferredAnilistId,
      );
    } catch {
      mappedMangabaka = null;
    }

    if (!media) {
      const mappedCandidate = mapMangabakaToCandidate(
        mappedMangabaka,
        1,
        input.preferredTitle || `AniList #${preferredAnilistId}`,
      );
      return mappedCandidate ? [mappedCandidate] : [];
    }
    const malId = toPositiveInt(
      media?.idMal || (await trackingService.searchMalIdByTitle(preferredAnilistId)),
    );
    return [
      {
        anilistId: preferredAnilistId,
        malId: malId > 0 ? malId : null,
        mangabakaId: toPositiveInt(mappedMangabaka?.id) || null,
        sourceUrl: `https://anilist.co/manga/${preferredAnilistId}`,
        title: getDisplayTitle(media),
        titleRomaji: media?.title?.romaji || undefined,
        titleEnglish: media?.title?.english || undefined,
        titleNative: media?.title?.native || undefined,
        coverUrl:
          String(media?.coverImage?.large || "").trim() ||
          String(media?.coverImage?.extraLarge || "").trim() ||
          undefined,
        year: Number(media?.startDate?.year || 0) || null,
        score: 1,
        confidence: "high",
        matchedTitle:
          input.preferredTitle || getDisplayTitle(media) || "AniList direct ID",
      },
    ];
  }
  if (preferredMalId > 0) {
    let media: any = null;
    try {
      media = await anilistService.getByMalId(preferredMalId);
    } catch {
      media = null;
    }
    const anilistId = toPositiveInt(media?.id);
    if (anilistId > 0) {
      let mappedMangabaka: any = null;
      try {
        mappedMangabaka = await mangabakaMetadataService.getSeriesByAniListId(
          anilistId,
        );
      } catch {
        mappedMangabaka = null;
      }
      return [
        {
          anilistId,
          malId: preferredMalId,
          mangabakaId: toPositiveInt(mappedMangabaka?.id) || null,
          sourceUrl: `https://anilist.co/manga/${anilistId}`,
          title: getDisplayTitle(media),
          titleRomaji: media?.title?.romaji || undefined,
          titleEnglish: media?.title?.english || undefined,
          titleNative: media?.title?.native || undefined,
          coverUrl:
            String(media?.coverImage?.large || "").trim() ||
            String(media?.coverImage?.extraLarge || "").trim() ||
            undefined,
          year: Number(media?.startDate?.year || 0) || null,
          score: 1,
          confidence: "high",
          matchedTitle: input.preferredTitle || getDisplayTitle(media) || "MAL direct ID",
        },
      ];
    }

    const mappedByMal = await mangabakaMetadataService
      .getSeriesByMalId(preferredMalId)
      .catch(() => null);
    const mappedCandidate = mapMangabakaToCandidate(
      mappedByMal,
      1,
      input.preferredTitle || `MAL #${preferredMalId}`,
    );
    if (mappedCandidate) return [mappedCandidate];
  }

  if (preferredMangabakaId > 0) {
    const detail = await mangabakaMetadataService
      .getSeries(preferredMangabakaId)
      .catch(() => null);
    const mappedCandidate = mapMangabakaToCandidate(
      detail?.data || detail,
      1,
      input.preferredTitle || `Mangabaka #${preferredMangabakaId}`,
    );
    if (mappedCandidate) return [mappedCandidate];
  }

  const titleCandidates = buildTitleCandidates(input);
  if (titleCandidates.length === 0) return [];

  const now = Date.now();
  if (anilistSearchCooldownUntilMs > now) {
    const retryAfterMs = anilistSearchCooldownUntilMs - now;
    if (mode === "scan_deferred") {
      const retryError: any = new Error(
        `AniList rate limited. Retry after ${Math.ceil(retryAfterMs / 1000)}s`,
      );
      retryError.status = 429;
      retryError.retryAfterMs = retryAfterMs;
      retryError.isAniListRateLimitError = true;
      throw retryError;
    }
    return [];
  }

  const queryLimit = mode === "scan_deferred" ? 1 : MAX_SEARCH_QUERIES;
  const queryList = titleCandidates.slice(0, queryLimit);
  const byId = new Map<number, MangaLinkCandidate>();
  let rateLimitRetryAfterMs = 0;

  for (const query of queryList) {
    let page: any = null;
    try {
      page = await anilistService.search(query, 1, MAX_CANDIDATES);
    } catch (error) {
      const retryAfterMs = toPositiveInt((error as any)?.retryAfterMs);
      const status = toPositiveInt((error as any)?.status);
      const isRateLimit =
        Boolean((error as any)?.isAniListRateLimitError) || status === 429;
      if (isRateLimit) {
        rateLimitRetryAfterMs = Math.max(
          rateLimitRetryAfterMs,
          retryAfterMs > 0 ? retryAfterMs : DEFAULT_RATE_LIMIT_RETRY_MS,
        );
        anilistSearchCooldownUntilMs = Math.max(
          anilistSearchCooldownUntilMs,
          Date.now() + rateLimitRetryAfterMs,
        );
        break;
      }
      if (isRetryableMangaLinkError(error)) throw error;
      const message = String((error as any)?.message || "Unknown AniList search error");
      console.warn(`[MangaLinker] AniList search failed for "${query}": ${message}`);
      continue;
    }

    const mediaList = Array.isArray(page?.media) ? page.media : [];
    for (const media of mediaList) {
      const anilistId = toPositiveInt(media?.id);
      if (anilistId <= 0) continue;

      const candidateTitles = getCandidateTitles(media);
      if (candidateTitles.length === 0) continue;

      let bestScore = 0;
      let bestMatchedTitle = query;
      for (const queryTitle of titleCandidates) {
        for (const candidateTitle of candidateTitles) {
          const score = titleSimilarity(queryTitle, candidateTitle);
          if (score > bestScore) {
            bestScore = score;
            bestMatchedTitle = queryTitle;
          }
        }
      }
      if (bestScore < MIN_SEARCH_SCORE) continue;

      const existing = byId.get(anilistId);
      if (existing && existing.score >= bestScore) continue;

      byId.set(anilistId, {
        anilistId,
        malId: toPositiveInt(media?.idMal) || null,
        mangabakaId: null,
        sourceUrl: `https://anilist.co/manga/${anilistId}`,
        title: getDisplayTitle(media),
        titleRomaji: String(media?.title?.romaji || "").trim() || undefined,
        titleEnglish: String(media?.title?.english || "").trim() || undefined,
        titleNative: String(media?.title?.native || "").trim() || undefined,
        sourceFormat: String(media?.format || "").trim().toUpperCase() || undefined,
        coverUrl:
          String(media?.coverImage?.large || "").trim() ||
          String(media?.coverImage?.extraLarge || "").trim() ||
          undefined,
        year: Number(media?.startDate?.year || 0) || null,
        score: bestScore,
        confidence: scoreToConfidence(bestScore),
        matchedTitle: bestMatchedTitle,
      });
    }
  }

  const sorted = Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  if (shouldEnrichMal) {
    for (const candidate of sorted.slice(0, 3)) {
      if (candidate.anilistId) {
        if (!candidate.malId) {
          try {
            const malId = await trackingService.searchMalIdByTitle(candidate.anilistId);
            const parsedMalId = toPositiveInt(malId);
            if (parsedMalId > 0) {
              candidate.malId = parsedMalId;
            }
          } catch {
            // Non-fatal.
          }
        }
        if (!candidate.mangabakaId) {
          try {
            const mapped = await mangabakaMetadataService.getSeriesByAniListId(
              candidate.anilistId,
            );
            const mappedId = toPositiveInt(mapped?.id);
            if (mappedId > 0) {
              candidate.mangabakaId = mappedId;
            }
          } catch {
            // Non-fatal.
          }
        }
      }
    }
  }

  const shouldTryMangabakaFallback =
    sorted.length === 0 || Number(sorted[0]?.score || 0) < 0.75;
  const mangabakaCandidates = shouldTryMangabakaFallback
    ? await searchMangabakaCandidates(titleCandidates, mode)
    : [];
  if (sorted.length > 0 && mangabakaCandidates.length > 0) {
    return [...sorted, ...mangabakaCandidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CANDIDATES);
  }
  if (sorted.length > 0) return sorted;
  if (mangabakaCandidates.length > 0) return mangabakaCandidates;

  if (rateLimitRetryAfterMs > 0 && mode === "scan_deferred") {
    const retryError: any = new Error(
      `AniList rate limited. Retry after ${Math.ceil(rateLimitRetryAfterMs / 1000)}s`,
    );
    retryError.status = 429;
    retryError.retryAfterMs = rateLimitRetryAfterMs;
    retryError.isAniListRateLimitError = true;
    throw retryError;
  }

  return [];
}

export function applyMangaIdBinding(
  seriesId: number,
  itemIds: number[],
  options?: { onlyIfUnassigned?: boolean },
): { bound: number } {
  const normalizedSeriesId = toPositiveInt(seriesId);
  if (normalizedSeriesId <= 0) return { bound: 0 };

  const uniqueIds = Array.from(
    new Set(itemIds.map((id) => toPositiveInt(id)).filter((id) => id > 0)),
  );
  let bound = 0;
  for (const itemId of uniqueIds) {
    const item = getItemById(itemId);
    if (!item || item.type === "folder") continue;
    if (
      options?.onlyIfUnassigned &&
      (toPositiveInt(item.manga_series_id) > 0 ||
        String(item.manga_preference || "").toLowerCase() === "force_non_manga")
    ) {
      continue;
    }
    updateItem(item.id, { manga_series_id: normalizedSeriesId });
    bound += 1;
  }
  return { bound };
}

function getAutoAssignThresholds(mode: ResolveMode): {
  minScore: number;
  minDelta: number;
} {
  if (mode === "scan_deferred") {
    return {
      minScore: AUTO_ASSIGN_SCAN_MIN_SCORE,
      minDelta: AUTO_ASSIGN_SCAN_MIN_DELTA,
    };
  }
  return {
    minScore: AUTO_ASSIGN_MIN_SCORE,
    minDelta: AUTO_ASSIGN_MIN_DELTA,
  };
}

function hasExactCandidateTitle(
  candidate: MangaLinkCandidate | undefined,
  expectedTitles: Set<string>,
): boolean {
  if (!candidate) return false;
  return [candidate.title, candidate.titleRomaji, candidate.titleEnglish, candidate.titleNative]
    .some((title) => expectedTitles.has(normalizeTitleForCompare(String(title || ""))));
}

function getCandidateFormatPriority(
  candidate: MangaLinkCandidate | undefined,
): number {
  const format = String(candidate?.sourceFormat || "").toUpperCase();
  if (["MANGA", "MANHWA", "MANHUA"].includes(format)) return 2;
  return ["ONE_SHOT", "NOVEL"].includes(format) ? 1 : 0;
}

function getBestSimilarityAgainstCandidate(
  contextTitle: string,
  candidate: MangaLinkCandidate | null | undefined,
): number {
  if (!candidate) return 0;
  const titles = uniqueStrings([
    candidate.title,
    candidate.titleEnglish,
    candidate.titleRomaji,
    candidate.titleNative,
    candidate.matchedTitle,
  ]);
  let best = 0;
  for (const title of titles) {
    const score = titleSimilarity(contextTitle, title);
    if (score > best) best = score;
  }
  return best;
}

function passesScanContextTitleGuard(
  input: MangaLinkResolveInput,
  candidate: MangaLinkCandidate | null | undefined,
): { pass: boolean; similarity: number; contextTitle: string } {
  const anchorPath = String(input.seriesAnchorPath || "").trim();
  const rootPath = String(input.scanRootPath || "").trim();
  const contextPath = anchorPath || rootPath;
  const contextTitle = inferMangaLinkTitle(path.basename(contextPath));
  if (!isMeaningfulTitleToken(contextTitle)) {
    return { pass: true, similarity: 1, contextTitle };
  }
  const anchorTitle = inferMangaLinkTitle(path.basename(anchorPath));
  const normalizedAnchorPath = normalizePathForKey(anchorPath);
  const normalizedRootPath = normalizePathForKey(rootPath);
  const isSubfolderGroup =
    Boolean(normalizedAnchorPath) &&
    Boolean(normalizedRootPath) &&
    normalizedAnchorPath !== normalizedRootPath;
  const primaryTitle =
    isSubfolderGroup && isMeaningfulTitleToken(anchorTitle)
      ? anchorTitle
      : contextTitle;
  const similarity = getBestSimilarityAgainstCandidate(primaryTitle, candidate);
  return {
    pass: similarity >= SCAN_ROOT_TITLE_MIN_SIMILARITY,
    similarity,
    contextTitle: primaryTitle,
  };
}

export async function resolveMangaIdForGroup(
  input: MangaLinkResolveInput,
): Promise<MangaLinkResolveResult> {
  const mode: ResolveMode = input.mode || "default";
  const thresholds = getAutoAssignThresholds(mode);
  const itemIds = Array.from(
    new Set((input.itemIds || []).map((id) => toPositiveInt(id)).filter(Boolean)),
  );
  const inferredCandidates = buildTitleCandidates(input);
  const inferredTitle =
    String(input.preferredTitle || "").trim() || inferredCandidates[0] || "";
  const groupKey =
    String(input.groupKey || "").trim() ||
    buildGroupKey(input.folderPath, inferredTitle, itemIds);

  if (
    !inferredTitle &&
    toPositiveInt(input.preferredAnilistId) <= 0 &&
    toPositiveInt(input.preferredMalId) <= 0 &&
    toPositiveInt(input.preferredMangabakaId) <= 0
  ) {
    return {
      status: "unresolved",
      groupKey,
      inferredTitle: "",
      seriesId: null,
      candidate: null,
      candidates: [],
      reason: "No usable title candidate",
    };
  }

  const candidates = await resolveCandidates({
    ...input,
    mode,
    preferredTitle: inferredTitle,
    titleCandidates: inferredCandidates,
  });
  const exactTitles = new Set(inferredCandidates.map(normalizeTitleForCompare));
  if (mode === "scan_deferred") {
    candidates.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const exactDifference = Number(hasExactCandidateTitle(b, exactTitles))
        - Number(hasExactCandidateTitle(a, exactTitles));
      return exactDifference || getCandidateFormatPriority(b) - getCandidateFormatPriority(a);
    });
  }
  const top = candidates[0];
  const second = candidates[1];
  const scoreDelta = top ? top.score - (second?.score || 0) : 0;
  const hasSafeScanTieBreak =
    mode === "scan_deferred" &&
    hasExactCandidateTitle(top, exactTitles) &&
    (!hasExactCandidateTitle(second, exactTitles) ||
      (itemIds.length > 1 &&
        getCandidateFormatPriority(top) === 2 &&
        getCandidateFormatPriority(second) === 1));
  const isDecisive =
    Boolean(top) &&
    (top!.score >= thresholds.minScore &&
      (candidates.length === 1 ||
        scoreDelta >= thresholds.minDelta ||
        hasSafeScanTieBreak));

  if (!top) {
    return {
      status: "unresolved",
      groupKey,
      inferredTitle,
      seriesId: null,
      candidate: null,
      candidates: [],
      reason: "No metadata candidates matched the title",
    };
  }

  if (isDecisive) {
    if (mode === "scan_deferred") {
      const contextGuard = passesScanContextTitleGuard(input, top);
      if (!contextGuard.pass) {
        return {
          status: "unresolved",
          groupKey,
          inferredTitle,
          seriesId: null,
          candidate: top,
          candidates,
          reason: `Context title mismatch (${contextGuard.contextTitle}, similarity=${contextGuard.similarity.toFixed(2)})`,
        };
      }
    }

    let seriesId = 0;
    let candidate: MangaLinkCandidate | null = null;
    if (toPositiveInt(top.anilistId) > 0) {
      const resolved = await upsertCanonicalSeriesFromAniList(
        toPositiveInt(top.anilistId),
        top,
      );
      seriesId = resolved.seriesId;
      candidate = resolved.candidate;
    } else if (toPositiveInt(top.mangabakaId) > 0) {
      const resolved = await upsertCanonicalSeriesFromMangabaka(
        toPositiveInt(top.mangabakaId),
        top,
      );
      seriesId = resolved.seriesId;
      candidate = resolved.candidate;
    } else {
      return {
        status: "unresolved",
        groupKey,
        inferredTitle,
        seriesId: null,
        candidate: top,
        candidates,
        reason: "Top candidate did not include a usable source ID",
      };
    }
    applyMangaIdBinding(seriesId, itemIds, {
      onlyIfUnassigned: mode === "scan_deferred",
    });
    return {
      status: "resolved",
      groupKey,
      inferredTitle,
      seriesId,
      candidate: candidate || top,
      candidates,
    };
  }

  return {
    status: "ambiguous",
    groupKey,
    inferredTitle,
    seriesId: null,
    candidate: top,
    candidates,
    reason: "Multiple close metadata candidates found",
  };
}

export async function resolvePendingMangaLinkGroups(
  groups: PendingMangaLinkGroup[],
  options?: { mode?: ResolveMode },
): Promise<{
  resolvedGroups: number;
  unresolvedGroups: number;
  boundItems: number;
}> {
  const mode: ResolveMode = options?.mode || "default";
  let resolvedGroups = 0;
  let unresolvedGroups = 0;
  let boundItems = 0;

  for (const group of groups) {
    const normalizedGroup = normalizePendingGroup(group);
    if (!normalizedGroup) continue;
    const scopedGroups = isPendingGroupHomogeneous(normalizedGroup)
      ? [normalizedGroup]
      : splitPendingGroupByRootAndAnchor(normalizedGroup);

    for (const scopedGroup of scopedGroups) {
      const result = await resolveMangaIdForGroup({
        mode,
        groupKey: scopedGroup.groupKey,
        folderPath: scopedGroup.folderPath,
        itemIds: scopedGroup.itemIds,
        itemPaths: scopedGroup.itemPaths,
        preferredTitle: scopedGroup.preferredTitle,
        titleCandidates: scopedGroup.titleCandidates,
        scanSessionId: scopedGroup.scanSessionId,
        scanRootPath: scopedGroup.scanRootPath,
        seriesAnchorPath: scopedGroup.seriesAnchorPath,
      });
      if (result.status === "resolved" && result.seriesId) {
        resolvedGroups += 1;
        boundItems += scopedGroup.itemIds.length;
      } else {
        unresolvedGroups += 1;
      }
    }
  }

  return { resolvedGroups, unresolvedGroups, boundItems };
}
