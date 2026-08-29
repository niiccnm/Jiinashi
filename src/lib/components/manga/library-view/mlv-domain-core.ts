import { resolveReadingFormatFromMetadata } from "../../../utils/manga";

export type TrackingServiceId = "mal" | "anilist";

export type UserTrackingStatusCard = {
  service: TrackingServiceId;
  hasEntry: boolean;
  status: string;
  chaptersRead: number;
  volumesRead: number;
  score: number | null;
  totalChapters: number | null;
  totalVolumes: number | null;
  totalFromApi: boolean;
  remoteId: number | null;
  lastSyncedAt: string | null;
};

export type DetailCacheEntry = {
  detail: any | null;
  friends: any[];
  trackedAnilistId: number | null;
  trackedMalId: number | null;
  activeTrackingServices: TrackingServiceId[];
  userTrackingStatuses: UserTrackingStatusCard[];
};

export function parsePositiveId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  const direct = Number(text);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.floor(direct);
  }
  const match = text.match(/(\d+)/);
  if (!match?.[1]) return null;
  const extracted = Number(match[1]);
  return Number.isFinite(extracted) && extracted > 0
    ? Math.floor(extracted)
    : null;
}

export function parseTimestamp(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function parseChapterNumberFromText(value: string) {
  const text = String(value || "").trim();
  if (!text) return null;
  const normalized = text.replace(/[_-]+/g, " ");
  const labeledMatch = normalized.match(
    /(?:chapter|chap|ch|episode|ep|act|part)\s*[:#.\-\s]*([0-9]+(?:\.[0-9]+)?)/i,
  );
  if (labeledMatch?.[1]) {
    const parsed = Number(labeledMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const fallbackMatch = normalized.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!fallbackMatch?.[1]) return null;
  const parsed = Number(fallbackMatch[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseChapterNumberFromItem(item: any) {
  const directValues = [item?.chapter_number, item?.chapterNumber, item?.number];
  for (const value of directValues) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const title = String(item?.title || "").trim();
  const fromTitle = parseChapterNumberFromText(title);
  if (fromTitle !== null) return fromTitle;

  const pathValue = String(item?.path || "").trim();
  const fileName = pathValue.split(/[/\\]/).at(-1) || "";
  return parseChapterNumberFromText(fileName);
}

type SelectedDetailContext = {
  activeSelectedSeriesId: number;
  detailSeriesId: number;
  detail: any;
};

function normalizeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function scoreTitleMatch(candidate: string, query: string) {
  const c = normalizeText(candidate);
  const q = normalizeText(query);
  if (!c || !q) return 0;
  if (c === q) return 600;
  if (c.startsWith(q) || q.startsWith(c)) return 420;
  if (c.includes(q) || q.includes(c)) return 260;
  const qTokens = q.split(" ").filter(Boolean);
  let tokenScore = 0;
  for (const token of qTokens) {
    if (token.length >= 2 && c.includes(token)) tokenScore += 20;
  }
  return tokenScore;
}

export function stripHtml(value: string) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncateText(value: string, max = 180) {
  const text = stripHtml(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}...`;
}

export function parseAnilistId(item: any) {
  const sourceUrl = String(item?.source_url || "");
  const directMatch = sourceUrl.match(/anilist\.co\/manga\/(\d+)/i);
  if (directMatch?.[1]) return Number(directMatch[1]);
  return null;
}

export function parseMalId(item: any) {
  const sourceUrl = String(item?.source_url || "");
  const directMatch = sourceUrl.match(/myanimelist\.net\/manga\/(\d+)/i);
  if (directMatch?.[1]) return Number(directMatch[1]);
  return null;
}

const MANGABAKA_ID_PATTERN = /mangabaka\.org\/(\d+)/i;

function parseMangabakaIdFromUrl(sourceUrl: string): number | null {
  const directMatch = String(sourceUrl || "").match(MANGABAKA_ID_PATTERN);
  if (directMatch?.[1]) return Number(directMatch[1]);
  return null;
}

export function parseMangabakaId(item: any) {
  const fromField = parsePositiveId(item?.mangabaka_id);
  if (fromField) return fromField;

  const sourceUrl = String(item?.sourceUrl || item?.source_url || "");
  return parseMangabakaIdFromUrl(sourceUrl);
}

export function getAnilistSearchCandidates(item: any) {
  const candidates = [
    String(item?.title_english || "").trim(),
    String(item?.title_romaji || "").trim(),
    String(item?.title_original || "").trim(),
    String(item?.title || "").trim(),
  ].filter(Boolean);

  try {
    const sourceUrl = String(item?.source_url || "").trim();
    if (sourceUrl) {
      const parsed = new URL(sourceUrl);
      const slug = (parsed.pathname.split("/").filter(Boolean).at(-1) || "")
        .replace(/[-_]+/g, " ")
        .replace(/\bchapter\b/gi, " ")
        .replace(/\b\d+\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (slug) candidates.push(slug);
    }
  } catch {
  }

  return Array.from(new Set(candidates)).slice(0, 4);
}

export async function findAnilistIdByTitle(
  item: any,
  anilistSearch: (query: string, page: number) => Promise<any>,
) {
  const candidates = getAnilistSearchCandidates(item);
  if (candidates.length === 0) return null;
  try {
    const normalizedQueries = candidates
      .map((entry) => normalizeText(entry))
      .filter(Boolean);
    if (normalizedQueries.length === 0) return null;
    const ranking = new Map<number, { id: number; score: number }>();

    for (const query of candidates) {
      const result = await anilistSearch(query, 1);
      const media = Array.isArray(result?.media) ? result.media : [];

      for (const candidate of media) {
        const candidateId = Number(candidate?.id || 0);
        if (!candidateId) continue;

        const titleScore = Math.max(
          ...normalizedQueries.map((needle) =>
            scoreTitleMatch(
              String(
                candidate?.title?.english ||
                  candidate?.title?.romaji ||
                  candidate?.title?.native ||
                  "",
              ),
              needle,
            ),
          ),
        );
        const synonymValues = Array.isArray(candidate?.synonyms)
          ? candidate.synonyms
          : [];
        const synonymScore = Math.max(
          ...normalizedQueries.map((needle) =>
            Math.max(
              0,
              ...synonymValues.map((synonym: any) =>
                scoreTitleMatch(String(synonym || ""), needle),
              ),
            ),
          ),
        );
        const score = Math.max(titleScore, synonymScore);

        const existing = ranking.get(candidateId);
        if (!existing || score > existing.score) {
          ranking.set(candidateId, { id: candidateId, score });
        }
      }
    }

    const best = [...ranking.values()].sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < 260) return null;
    return best.id;
  } catch {
    return null;
  }
}

export function getDescriptionText(
  item: any,
  context: SelectedDetailContext,
  allowSelectedDetail = true,
) {
  const itemId = Number(item?.id || 0);
  const selectedId = Number(context.activeSelectedSeriesId || 0);
  const selectedDetail =
    selectedId > 0 && context.detailSeriesId === selectedId ? context.detail : null;
  if (
    allowSelectedDetail &&
    itemId > 0 &&
    itemId === selectedId &&
    selectedDetail?.description
  ) {
    return selectedDetail.description;
  }
  return item?.description || "";
}

export function getGenresForSeries(item: any, context: SelectedDetailContext) {
  const selectedId = Number(context.activeSelectedSeriesId || 0);
  const selectedDetail =
    selectedId > 0 && context.detailSeriesId === selectedId ? context.detail : null;
  if (Array.isArray(selectedDetail?.genres) && selectedDetail.genres.length > 0) {
    return selectedDetail.genres.map((genre: any) => String(genre));
  }
  if (Array.isArray(item?.genres) && item.genres.length > 0) {
    return item.genres.map((genre: any) => String(genre));
  }
  return [];
}

export function getSelectedYearForSeries(
  item: any,
  context: SelectedDetailContext,
): number | null {
  const fromSeries = Number(item?.year || 0);
  if (Number.isFinite(fromSeries) && fromSeries > 0) return fromSeries;
  const selectedId = Number(context.activeSelectedSeriesId || 0);
  const itemId = Number(item?.id || 0);
  if (
    selectedId > 0 &&
    selectedId === itemId &&
    context.detailSeriesId === selectedId
  ) {
    const fromDetail = Number(context.detail?.startDate?.year || 0);
    if (Number.isFinite(fromDetail) && fromDetail > 0) return fromDetail;
  }
  return null;
}

export function getMostRecentLocalReadChapter(cards: any[]) {
  const chapterList = Array.isArray(cards) ? cards : [];
  const hasMeaningfulLocalProgress = (item: any) => {
    const currentPage = Number(item?.current_page || 0);
    if (Number.isFinite(currentPage) && currentPage > 0) return true;
    const pageCount = Number(item?.page_count || 0);
    const readingStatus = String(item?.reading_status || "").toLowerCase();
    return (
      readingStatus === "read" && Number.isFinite(pageCount) && pageCount === 1
    );
  };
  const byLastRead = chapterList
    .map((item) => ({
      item,
      lastReadTimestamp: parseTimestamp(item?.last_read_at),
    }))
    .filter(
      (entry) =>
        entry.lastReadTimestamp > 0 && hasMeaningfulLocalProgress(entry.item),
    )
    .sort((left, right) => right.lastReadTimestamp - left.lastReadTimestamp);
  if (byLastRead.length > 0) return byLastRead[0].item;

  const inProgress = chapterList.filter((item) => {
    const currentPage = Number(item?.current_page || 0);
    if (Number.isFinite(currentPage) && currentPage > 0) return true;
    const pageCount = Number(item?.page_count || 0);
    const readingStatus = String(item?.reading_status || "").toLowerCase();
    return readingStatus === "read" && Number.isFinite(pageCount) && pageCount === 1;
  });
  if (inProgress.length === 0) return null;
  return inProgress[0];
}

export function getOldestChapterCard(cards: any[]) {
  const chapterList = Array.isArray(cards) ? cards : [];
  if (chapterList.length === 0) return null;

  const byNumber = chapterList
    .map((item) => ({
      item,
      chapterNumber: parseChapterNumberFromItem(item),
    }))
    .filter((entry) => entry.chapterNumber !== null)
    .sort((left, right) => {
      const chapterDelta = Number(left.chapterNumber) - Number(right.chapterNumber);
      if (chapterDelta !== 0) return chapterDelta;
      return String(left.item?.title || "").localeCompare(
        String(right.item?.title || ""),
        undefined,
        { numeric: true, sensitivity: "base" },
      );
    });
  if (byNumber.length > 0) return byNumber[0].item;

  const byTitle = [...chapterList].sort((left, right) =>
    String(left?.title || "").localeCompare(String(right?.title || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
  return byTitle[0] || null;
}

export function pickTrackingStatusForContinue(
  cards: UserTrackingStatusCard[],
  activeTrackingServices: TrackingServiceId[],
) {
  const usable = (Array.isArray(cards) ? cards : []).filter((card) => {
    if (!card?.hasEntry) return false;
    const chaptersRead = Number(card?.chaptersRead ?? 0);
    return Number.isFinite(chaptersRead) && chaptersRead >= 0;
  });
  if (usable.length === 0) return null;

  const malStatus = usable.find((card) => card.service === "mal") || null;
  const anilistStatus =
    usable.find((card) => card.service === "anilist") || null;
  const hasMal = activeTrackingServices.includes("mal");
  const hasAnilist = activeTrackingServices.includes("anilist");

  if (hasMal && !hasAnilist) return malStatus;
  if (hasAnilist && !hasMal) return anilistStatus;

  const candidates = [anilistStatus, malStatus].filter(
    (entry): entry is UserTrackingStatusCard => Boolean(entry),
  );
  if (candidates.length === 0) return usable[0];
  if (candidates.length === 1) return candidates[0];

  return [...candidates].sort((left, right) => {
    const byRead = Number(right.chaptersRead || 0) - Number(left.chaptersRead || 0);
    if (byRead !== 0) return byRead;
    const bySynced =
      parseTimestamp(right.lastSyncedAt) - parseTimestamp(left.lastSyncedAt);
    if (bySynced !== 0) return bySynced;
    return String(left.service || "").localeCompare(String(right.service || ""));
  })[0];
}

export function findChapterByTrackingTarget(cards: any[], chaptersRead: number) {
  const targetChapter = Math.max(1, Math.floor(Number(chaptersRead || 0)) + 1);
  const candidates = (Array.isArray(cards) ? cards : [])
    .map((item) => ({
      item,
      chapterNumber: parseChapterNumberFromItem(item),
    }))
    .filter((entry) => entry.chapterNumber !== null)
    .filter(
      (entry) => Math.abs(Number(entry.chapterNumber) - targetChapter) < 0.001,
    );

  if (candidates.length === 0) return null;
  return candidates
    .sort((left, right) =>
      String(left.item?.title || "").localeCompare(
        String(right.item?.title || ""),
        undefined,
        { numeric: true, sensitivity: "base" },
      ),
    )
    .at(0)?.item;
}


export type MlvGridSize = "small" | "medium" | "large";

export function normalizeScopedIds(input: unknown): number[] {
  const normalized = Array.isArray(input) ? input : [];
  const ids = normalized
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  return Array.from(new Set(ids));
}

export function getItemSeriesId(item: any) {
  const value = Number(item?.manga_series_id || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function filterScopedChapterItems(
  chapterItems: any[],
  scopedSeriesIdSet: Set<number>,
) {
  const list = Array.isArray(chapterItems) ? chapterItems : [];
  return list.filter((item) => {
    if (String(item?.type || "") === "folder") return false;
    const seriesId = getItemSeriesId(item);
    if (!seriesId) return false;
    if (scopedSeriesIdSet.size > 0 && !scopedSeriesIdSet.has(seriesId)) {
      return false;
    }
    return true;
  });
}

export function countChapterItemsBySeries(items: any[]) {
  const counts: Record<number, number> = {};
  for (const item of Array.isArray(items) ? items : []) {
    const seriesId = getItemSeriesId(item);
    if (seriesId <= 0) continue;
    counts[seriesId] = Number(counts[seriesId] || 0) + 1;
  }
  return counts;
}

export function sortChapterCardsBySelectedSeries(items: any[], selectedId: number) {
  const targetSeriesId = Number(selectedId || 0);
  const filtered = (Array.isArray(items) ? items : []).filter((item) => {
    if (!targetSeriesId) return true;
    return getItemSeriesId(item) === targetSeriesId;
  });
  return [...filtered].sort((a, b) =>
    String(b?.title || "").localeCompare(String(a?.title || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

export function getChapterGridClass(gridSize: MlvGridSize): string {
  switch (gridSize) {
    case "small":
      return "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12";
    case "large":
      return "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";
    default:
      return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8";
  }
}

export function buildSeriesMetadataUpdates(
  seriesItem: any,
  resolvedAnilistDetail: any,
  resolvedTrackedAnilistId: number | null,
  resolvedTrackedMalId: number | null,
) {
  const resolvedReadingFormat = resolveReadingFormatFromMetadata(
    resolvedAnilistDetail?.format,
    resolvedAnilistDetail?.countryOfOrigin,
    seriesItem?.reading_format,
  );
  const updatesRaw: any = {
    title_english:
      String(resolvedAnilistDetail?.title?.english || "").trim() || undefined,
    title_romaji:
      String(resolvedAnilistDetail?.title?.romaji || "").trim() || undefined,
    title_original:
      String(resolvedAnilistDetail?.title?.native || "").trim() ||
      String(seriesItem?.title_original || "").trim() ||
      undefined,
    description:
      String(resolvedAnilistDetail?.description || "").trim() || undefined,
    cover_url:
      String(
        resolvedAnilistDetail?.coverImage?.extraLarge ||
          resolvedAnilistDetail?.coverImage?.large ||
          "",
      ).trim() || undefined,
    banner_url:
      String(resolvedAnilistDetail?.bannerImage || "").trim() || undefined,
    status: String(resolvedAnilistDetail?.status || "").trim() || undefined,
    anilist_id: Number(resolvedTrackedAnilistId || 0) || undefined,
    mal_id: Number(resolvedTrackedMalId || 0) || undefined,
    mal_score:
      Number.isFinite(Number(resolvedAnilistDetail?.averageScore || 0)) &&
      Number(resolvedAnilistDetail?.averageScore || 0) > 0
        ? Number(resolvedAnilistDetail.averageScore) / 10
        : undefined,
      genres: Array.isArray(resolvedAnilistDetail?.genres)
        ? resolvedAnilistDetail.genres.map((genre: any) => String(genre))
        : undefined,
      reading_format: resolvedReadingFormat || undefined,
      year: Number(resolvedAnilistDetail?.startDate?.year || 0) || undefined,
      last_updated: new Date().toISOString(),
    };

  return Object.fromEntries(
    Object.entries(updatesRaw).filter(([_, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }),
  ) as any;
}

export function mapFriendsReading(rawFriends: any[]) {
  return (Array.isArray(rawFriends) ? rawFriends : []).map((friend: any) => ({
    name: String(friend?.username || "Unknown"),
    avatar_url: friend?.avatar_url,
    profile_url: friend?.profile_url,
    chapter: Number(friend?.progress || 0),
    service: friend?.service,
    status: friend?.status,
  }));
}

export function getFriendProfileUrl(friend: any) {
  const username = String(friend?.name || "").trim();
  if (!username) return "";
  return (
    friend?.profile_url ||
    (friend?.service === "mal"
      ? `https://myanimelist.net/profile/${encodeURIComponent(username)}`
      : `https://anilist.co/user/${encodeURIComponent(username)}`)
  );
}

type TrackingErrorVariant = "fallback" | "refresh";

function isRateLimitError(error: unknown) {
  const message = String((error as any)?.message || "").toLowerCase();
  return (
    message.includes("429") ||
    message.includes("too many requests") ||
    message.includes("rate limit")
  );
}

export function getTrackingErrorDescriptor(
  error: unknown,
  variant: TrackingErrorVariant,
) {
  const rateLimited = isRateLimitError(error);
  if (variant === "fallback") {
    return {
      statusError: rateLimited
        ? "AniList rate limited. Showing cached/provider totals."
        : "Tracking API unavailable. Showing cached/provider totals.",
      toastError: null as string | null,
    };
  }
  if (rateLimited) {
    return {
      statusError: "AniList rate limited. Please retry shortly.",
      toastError: "AniList rate limited. Please retry shortly.",
    };
  }
  return {
    statusError: "Unable to fetch tracking status",
    toastError: "Failed to refresh tracking status",
  };
}

export function resolveContinueTargetChapter(
  chapterCards: any[],
  trackingCards: UserTrackingStatusCard[],
  activeTrackingServices: TrackingServiceId[],
) {
  const cards = Array.isArray(chapterCards) ? chapterCards : [];
  if (cards.length === 0) return null;
  const localLastRead = getMostRecentLocalReadChapter(cards);
  if (localLastRead) return localLastRead;

  const preferredTracking = pickTrackingStatusForContinue(
    trackingCards,
    activeTrackingServices,
  );
  if (preferredTracking) {
    const trackedMatch = findChapterByTrackingTarget(
      cards,
      preferredTracking.chaptersRead,
    );
    if (trackedMatch) return trackedMatch;
  }
  return getOldestChapterCard(cards);
}

export function getAnilistExternalUrl(anilistId: number, title: string) {
  const resolvedId = Number(anilistId || 0);
  if (resolvedId > 0) {
    return `https://anilist.co/manga/${resolvedId}`;
  }
  return `https://anilist.co/search/manga?search=${encodeURIComponent(String(title || ""))}`;
}

export function getMalExternalUrl(malId: number, sourceUrl: string, title: string) {
  const resolvedId = Number(malId || 0);
  if (resolvedId > 0) {
    return `https://myanimelist.net/manga/${resolvedId}`;
  }
  const match = String(sourceUrl || "").match(/myanimelist\.net\/manga\/(\d+)/i);
  if (match?.[1]) {
    return `https://myanimelist.net/manga/${match[1]}`;
  }
  return `https://myanimelist.net/manga.php?q=${encodeURIComponent(String(title || ""))}`;
}

export function getMangabakaExternalUrl(
  mangabakaId: number,
  sourceUrl: string,
  title: string,
) {
  const resolvedId = Number(mangabakaId || 0);
  if (resolvedId > 0) {
    return `https://mangabaka.org/${resolvedId}`;
  }
  const parsedId = parseMangabakaIdFromUrl(sourceUrl);
  if (parsedId) {
    return `https://mangabaka.org/${parsedId}`;
  }
  return `https://mangabaka.org/search?q=${encodeURIComponent(String(title || ""))}`;
}
