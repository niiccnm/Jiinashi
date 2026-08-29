import {
  normalizeProviderKey,
  resolveOpenSourceProviderSite,
  sourceUrlMatchesProviderSite,
  type ResolvedProviderSite,
} from "./mlv-domain-provider";
import {
  expandSearchQueryVariants,
  normalizeMatchText,
  scoreCandidateTitle,
} from "../series-view/msv-domain-match";

export type MlvControllerActionContext = {
  state: {
    detailLoading: boolean;
    detail: any | null;
    detailSeriesId: number | null;
    friends: any[];
    trackedAnilistId: number | null;
    trackedMalId: number | null;
    activeTrackingServices: any[];
    userTrackingStatuses: any[];
    isTrackingStatusLoading: boolean;
    trackingStatusError: string;
    isDescriptionExpanded: boolean;
    isContinueResolving: boolean;
    detailRequestId: number;
    activeDetailSeriesId: number | null;
    seriesCatalog: any[];
    selectedSeriesId: number | null;
    trackingStatusVisibleBySeries: Record<number, boolean>;
    activeSelectedSeriesId: number | null;
    selectedSeries: any;
    series: any[];
  };
  api: any;
  sessionState: { seriesCatalogCache: any[] | null };
  detailCache: Map<number, any>;
  toasts: { add: (message: string, type?: any, duration?: number) => void };
  resetSeriesDetailState: (includeDetailLoading?: boolean) => void;
  applyCachedSeriesDetailState: (
    seriesId: number,
    cached: any,
    fallbackIds: { anilistId: number | null; malId: number | null },
  ) => void;
  setDetailCache: (seriesId: number, value: any) => void;
  markDetailFetchAttempt: (seriesId: number) => void;
  getTrackingStatusRevision: (seriesId: number) => number;
  bumpTrackingStatusRevision: (seriesId: number) => number;
  findAnilistIdByTitle: (seriesItem: any) => Promise<number | null>;
  parsePositiveId: (value: unknown) => number | null;
  parseAnilistId: (seriesItem: any) => number | null;
  persistSeriesCatalog: (catalog: any[]) => void;
  getActiveTrackingServices: (trackingAccounts: any[]) => any[];
  filterTrackingCardsForDisplay: (cards: any[]) => any[];
  buildUserTrackingStatusCards: (
    services: any[],
    statuses: any[],
    ids: { anilistId: number | null; malId: number | null },
    fallbackTotalChapters?: number | null,
  ) => any[];
  mergeTrackingEntries: (localEntries: any[], remoteEntries: any[]) => any[];
  buildTrackingCards: (
    services: any[],
    statuses: any[],
    ids: { anilistId: number | null; malId: number | null },
    seriesItem: any,
    detailItem: any,
    isStale?: () => boolean,
  ) => Promise<any[]>;
  getTrackingErrorDescriptor: (
    error: unknown,
    variant: "fallback" | "refresh",
  ) => { statusError: string; toastError: string | null };
  shouldDiscardDetailCacheEntry: (cached: any) => boolean;
  resolveInitialDetailTrackingContext: (args: any) => Promise<any>;
  buildSeriesMetadataUpdates: (
    seriesItem: any,
    resolvedAnilistDetail: any,
    resolvedTrackedAnilistId: number | null,
    resolvedTrackedMalId: number | null,
  ) => any;
  mergeSeriesCatalogWithUpdates: (
    seriesCatalog: any[],
    seriesId: number,
    updates: any,
  ) => any[];
  mapFriendsReading: (rawFriends: any[]) => any[];
  resolveRefreshTrackingIds: (args: any) => Promise<{
    anilistId: number | null;
    malId: number | null;
  }>;
  resolveTrackingStatusOpenState: (
    hasInMemory: boolean,
    inMemoryStatuses: any[],
    cachedStatuses: any[],
    hasUnknownTrackingTotal: (cards: any[]) => boolean,
  ) => {
    hasInMemory: boolean;
    hasCached: boolean;
    shouldRefreshUnknownTotals: boolean;
  };
  hasUnknownTrackingTotal: (cards: any[]) => boolean;
  getMostRecentLocalReadChapter: (cards: any[]) => any | null;
  resolveContinueTargetChapter: (
    chapterCards: any[],
    trackingCards: any[],
    activeTrackingServices: any[],
  ) => any | null;
  getAnilistExternalUrl: (anilistId: number, title: string) => string;
  getMalExternalUrl: (
    malId: number,
    sourceUrl: string,
    title: string,
  ) => string;
  getMangabakaExternalUrl: (
    mangabakaId: number,
    sourceUrl: string,
    title: string,
  ) => string;
  providerSiteLookup: Map<string, ResolvedProviderSite>;
  resolvedProviderUrlCache: Map<string, string>;
  getSeriesDisplayTitle: (seriesItem: any) => string;
  setTrackingStatusVisible: (seriesId: number, visible: boolean) => void;
};

function getMangabakaUrlFromExternalLinks(externalLinks: any): string {
  if (!Array.isArray(externalLinks)) return "";
  return (
    externalLinks
      .map((entry: any) =>
        String(typeof entry === "string" ? entry : entry?.url || "").trim(),
      )
      .find((url: string) => /mangabaka\.org\//i.test(url)) || ""
  );
}

function getProviderResolutionCacheKeyForSite(
  seriesItem: any,
  providerHint: string | undefined,
  providerSite: ResolvedProviderSite | null | undefined,
) {
  const seriesId = Number(seriesItem?.id || 0);
  const providerKey =
    normalizeProviderKey(providerHint) ||
    normalizeProviderKey(providerSite?.siteName) ||
    normalizeProviderKey(providerSite?.preferredSourceId);
  if (!Number.isFinite(seriesId) || seriesId <= 0 || !providerKey) return "";
  return `${seriesId}:${providerKey}`;
}

function findChapterSourceUrlForProvider(
  chapters: any[],
  providerSite: ResolvedProviderSite | null,
): string {
  return (
    (Array.isArray(chapters) ? chapters : [])
      .map((chapter: any) => String(chapter?.source_url || "").trim())
      .find((url: string) => sourceUrlMatchesProviderSite(url, providerSite)) ||
    ""
  );
}

const MAX_RESOLVED_PROVIDER_URL_CACHE_ENTRIES = 200;

function setResolvedProviderUrlCacheEntry(
  ctx: MlvControllerActionContext,
  cacheKey: string,
  url: string,
) {
  const normalizedKey = String(cacheKey || "").trim();
  const normalizedUrl = String(url || "").trim();
  if (!normalizedKey || !normalizedUrl) return;

  if (ctx.resolvedProviderUrlCache.has(normalizedKey)) {
    ctx.resolvedProviderUrlCache.delete(normalizedKey);
  }
  ctx.resolvedProviderUrlCache.set(normalizedKey, normalizedUrl);

  while (
    ctx.resolvedProviderUrlCache.size > MAX_RESOLVED_PROVIDER_URL_CACHE_ENTRIES
  ) {
    const oldestKey = ctx.resolvedProviderUrlCache.keys().next().value;
    if (oldestKey === undefined) break;
    ctx.resolvedProviderUrlCache.delete(oldestKey);
  }
}

function getProviderSearchTitleCandidates(
  ctx: MlvControllerActionContext,
  seriesItem: any,
) {
  const detailTitle =
    Number(ctx.state.detailSeriesId || 0) === Number(seriesItem?.id || 0)
      ? ctx.state.detail?.title
      : null;
  const values = [
    String(seriesItem?.title_english || "").trim(),
    String(seriesItem?.title_romaji || "").trim(),
    String(seriesItem?.title_original || "").trim(),
    String(detailTitle?.english || "").trim(),
    String(detailTitle?.romaji || "").trim(),
    String(detailTitle?.native || "").trim(),
    String(ctx.getSeriesDisplayTitle(seriesItem) || "").trim(),
  ].filter(Boolean);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeMatchText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(value);
  }
  return deduped;
}

function getProviderSearchQueries(
  ctx: MlvControllerActionContext,
  seriesItem: any,
) {
  const titleCandidates = getProviderSearchTitleCandidates(ctx, seriesItem);
  const variantBuckets = titleCandidates
    .map((value) => expandSearchQueryVariants(value))
    .filter((variants) => variants.length > 0);

  const queries: string[] = [];
  let index = 0;
  while (true) {
    let added = false;
    for (const variants of variantBuckets) {
      const query = variants[index];
      if (!query) continue;
      queries.push(query);
      added = true;
    }
    if (!added) break;
    index += 1;
  }

  return Array.from(new Set(queries));
}

type RankedProviderSearchResult = {
  url: string;
  title: string;
  titleScore: number;
  totalScore: number;
  queryIndex: number;
  resultIndex: number;
};

function isConfidentProviderSearchMatch(
  best: RankedProviderSearchResult | undefined,
  nextBest: RankedProviderSearchResult | undefined,
  providerSite: ResolvedProviderSite,
) {
  if (!best) return false;
  const delta = best.totalScore - Number(nextBest?.totalScore || 0);

  if (best.titleScore >= 260) return true;
  if (best.titleScore >= 180 && delta >= 120) return true;
  if (
    best.queryIndex === 0 &&
    best.resultIndex === 0 &&
    best.titleScore >= 120 &&
    delta >= 80
  ) {
    return true;
  }
  return false;
}

async function resolveProviderSeriesUrl(
  ctx: MlvControllerActionContext,
  seriesItem: any,
  providerHint: string,
  providerSite: ResolvedProviderSite,
): Promise<string> {
  const cacheKey = getProviderResolutionCacheKeyForSite(
    seriesItem,
    providerHint,
    providerSite,
  );
  const cachedUrl = cacheKey
    ? String(ctx.resolvedProviderUrlCache.get(cacheKey) || "").trim()
    : "";
  if (cachedUrl && sourceUrlMatchesProviderSite(cachedUrl, providerSite)) {
    return cachedUrl;
  }

  const providerSourceId = String(providerSite.preferredSourceId || "").trim();
  if (!providerSourceId) return "";

  const searchQueries = getProviderSearchQueries(ctx, seriesItem).slice(0, 3);
  if (searchQueries.length === 0) return "";

  const normalizedQueries = searchQueries
    .map((query) => normalizeMatchText(query))
    .filter(Boolean);
  const rankedByUrl = new Map<string, RankedProviderSearchResult>();

  for (const [queryIndex, query] of searchQueries.entries()) {
    let results: any = null;
    try {
      results = await ctx.api.searchSource(providerSourceId, query, 1);
    } catch {
      results = null;
    }

    const items = Array.isArray(results?.items) ? results.items.slice(0, 8) : [];
    for (const [resultIndex, item] of items.entries()) {
      const url = String(item?.source_url || "").trim();
      if (!url || !sourceUrlMatchesProviderSite(url, providerSite)) continue;

      const title = String(item?.title || "").trim();
      const titleScore = scoreCandidateTitle(title, normalizedQueries);
      const rankBonus = Math.max(0, 180 - resultIndex * 40);
      const queryBonus = Math.max(0, 40 - queryIndex * 10);
      const totalScore = titleScore + rankBonus + queryBonus;
      const existing = rankedByUrl.get(url);
      if (!existing || totalScore > existing.totalScore) {
        rankedByUrl.set(url, {
          url,
          title,
          titleScore,
          totalScore,
          queryIndex,
          resultIndex,
        });
      }
    }

    const rankedForQuery = Array.from(rankedByUrl.values()).sort((left, right) => {
      if (right.totalScore !== left.totalScore) {
        return right.totalScore - left.totalScore;
      }
      return left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
    if (
      isConfidentProviderSearchMatch(
        rankedForQuery[0],
        rankedForQuery[1],
        providerSite,
      )
    ) {
      if (cacheKey) {
        setResolvedProviderUrlCacheEntry(ctx, cacheKey, rankedForQuery[0].url);
      }
      return rankedForQuery[0].url;
    }
  }

  const ranked = Array.from(rankedByUrl.values()).sort((left, right) => {
    if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
    return left.title.localeCompare(right.title, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
  const best = ranked[0];
  if (!best) return "";
  if (!isConfidentProviderSearchMatch(best, ranked[1], providerSite)) return "";

  if (cacheKey) {
    setResolvedProviderUrlCacheEntry(ctx, cacheKey, best.url);
  }
  return best.url;
}

export async function mlvLoadSeriesDetail(
  ctx: MlvControllerActionContext,
  seriesItem: any,
  options: { force?: boolean; background?: boolean } = {},
) {
  const state = ctx.state;
  const force = Boolean(options.force);
  const background = Boolean(options.background);
  const seriesId = Number(seriesItem?.id || 0);
  if (!seriesId) {
    ctx.resetSeriesDetailState(true);
    return;
  }
  const trackingRevisionAtStart = ctx.getTrackingStatusRevision(seriesId);

  if (!force) {
    const cached = ctx.detailCache.get(seriesId);
    if (cached) {
      if (ctx.shouldDiscardDetailCacheEntry(cached)) {
        ctx.detailCache.delete(seriesId);
      } else {
        ctx.applyCachedSeriesDetailState(seriesId, cached, {
          anilistId: cached.trackedAnilistId,
          malId: cached.trackedMalId,
        });
        state.detailLoading = false;
        state.isDescriptionExpanded = false;
        ctx.markDetailFetchAttempt(seriesId);
        return;
      }
    }
    if (state.activeDetailSeriesId === seriesId) {
      return;
    }
  }

  state.activeDetailSeriesId = seriesId;
  const requestId = ++state.detailRequestId;
  if (!background) {
    state.detailLoading = true;
  }
  if (!background && state.detailSeriesId !== seriesId) {
    ctx.resetSeriesDetailState();
  }
  state.detail = null;
  state.detailSeriesId = seriesId;
  state.friends = [];
  state.isDescriptionExpanded = false;

  try {
    const trackingContext = await ctx.resolveInitialDetailTrackingContext({
      seriesId,
      seriesItem,
      getTrackingAccounts: () => ctx.api.getTrackingAccounts(),
      getActiveTrackingServices: ctx.getActiveTrackingServices,
      getTrackingEntries: (id: number) => ctx.api.getTrackingEntries(id),
      onTrackingAccountsError: (error: unknown) => {
        console.warn("Failed to load tracking accounts:", error);
      },
      onTrackingEntriesError: (error: unknown) => {
        console.warn("Failed to load tracking entries for series:", error);
      },
    });
    let resolvedTrackingIds = trackingContext.trackingIds;
    let seriesTrackingEntries = trackingContext.trackingEntries;
    const nextActiveTrackingServices = trackingContext.activeTrackingServices;

    if (requestId !== state.detailRequestId) return;
    const initialTrackingCards = ctx.filterTrackingCardsForDisplay(
      ctx.buildUserTrackingStatusCards(
        nextActiveTrackingServices,
        seriesTrackingEntries,
        {
          anilistId: Number(resolvedTrackingIds.anilistId || 0) || null,
          malId: Number(resolvedTrackingIds.malId || 0) || null,
        },
      ),
    );
    state.activeTrackingServices = [...nextActiveTrackingServices];
    if (ctx.getTrackingStatusRevision(seriesId) === trackingRevisionAtStart) {
      state.userTrackingStatuses = [...initialTrackingCards];
      state.trackingStatusError = "";
      state.isTrackingStatusLoading = false;
    }

    let anilistId =
      Number(resolvedTrackingIds.anilistId || 0) ||
      ctx.parseAnilistId(seriesItem) ||
      null;
    if ((!anilistId || anilistId <= 0) && force) {
      anilistId = await ctx.findAnilistIdByTitle(seriesItem);
    }

    let resolvedAnilistDetail: any = null;
    if (anilistId && anilistId > 0) {
      try {
        resolvedAnilistDetail = await ctx.api.anilistDetails(anilistId);
      } catch (error) {
        console.warn("Failed to load AniList details:", error);
      }
    }

    if (requestId !== state.detailRequestId) return;
    const resolvedTrackedAnilistId =
      Number(
        resolvedAnilistDetail?.id ||
          resolvedTrackingIds.anilistId ||
          anilistId ||
          0,
      ) || null;
    const resolvedTrackedMalId =
      Number(resolvedAnilistDetail?.idMal || resolvedTrackingIds.malId || 0) ||
      null;

    try {
      const freshestTrackingEntries =
        await ctx.api.getTrackingEntries(seriesId);
      if (requestId !== state.detailRequestId) return;
      if (
        Array.isArray(freshestTrackingEntries) &&
        freshestTrackingEntries.length > 0
      ) {
        seriesTrackingEntries = ctx.mergeTrackingEntries(
          seriesTrackingEntries,
          freshestTrackingEntries,
        );
      }
    } catch {}

    state.trackedAnilistId = resolvedTrackedAnilistId;
    state.trackedMalId = resolvedTrackedMalId;
    state.detail = resolvedAnilistDetail || null;
    state.detailSeriesId = seriesId;
    state.activeTrackingServices = [...nextActiveTrackingServices];
    const cards = ctx.filterTrackingCardsForDisplay(
      await ctx.buildTrackingCards(
        nextActiveTrackingServices,
        seriesTrackingEntries,
        {
          anilistId: resolvedTrackedAnilistId,
          malId: resolvedTrackedMalId,
        },
        seriesItem,
        resolvedAnilistDetail,
        () => requestId !== state.detailRequestId,
      ),
    );
    if (requestId !== state.detailRequestId) return;
    const canApplyTrackingCards =
      ctx.getTrackingStatusRevision(seriesId) === trackingRevisionAtStart;
    if (canApplyTrackingCards) {
      state.userTrackingStatuses = [...cards];
      state.trackingStatusError = "";
      state.isTrackingStatusLoading = false;
    }

    if (seriesId > 0 && resolvedAnilistDetail) {
      const updates = ctx.buildSeriesMetadataUpdates(
        seriesItem,
        resolvedAnilistDetail,
        resolvedTrackedAnilistId,
        resolvedTrackedMalId,
      );

      if (Object.keys(updates).length > 0) {
        try {
          await ctx.api.updateSeries(seriesId, updates);
        } catch (error) {
          console.warn("Failed to cache AniList metadata for series:", error);
        }

        state.seriesCatalog = ctx.mergeSeriesCatalogWithUpdates(
          state.seriesCatalog,
          seriesId,
          updates,
        );
        ctx.sessionState.seriesCatalogCache = [...state.seriesCatalog];
        ctx.persistSeriesCatalog(state.seriesCatalog);
      }
    }

    const anilistIdForFriends = Number(resolvedTrackedAnilistId || 0);
    const malIdForFriends = Number(resolvedTrackedMalId || 0);

    if (!anilistIdForFriends && !malIdForFriends) {
      state.friends = [];
      ctx.setDetailCache(seriesId, {
        detail: resolvedAnilistDetail,
        friends: [],
        trackedAnilistId: resolvedTrackedAnilistId,
        trackedMalId: resolvedTrackedMalId,
        activeTrackingServices: [...state.activeTrackingServices],
        userTrackingStatuses: [...state.userTrackingStatuses],
      });
      return;
    }

    const rawFriends = await ctx.api.getFriendsReading(
      anilistIdForFriends || undefined,
      malIdForFriends || undefined,
    );
    if (requestId !== state.detailRequestId) return;
    state.friends = ctx.mapFriendsReading(rawFriends);
    ctx.setDetailCache(seriesId, {
      detail: resolvedAnilistDetail,
      friends: [...state.friends],
      trackedAnilistId: resolvedTrackedAnilistId,
      trackedMalId: resolvedTrackedMalId,
      activeTrackingServices: [...state.activeTrackingServices],
      userTrackingStatuses: [...state.userTrackingStatuses],
    });
  } catch (error) {
    console.error("Failed to load manga detail from AniList:", error);
  } finally {
    if (requestId !== state.detailRequestId) return;
    ctx.markDetailFetchAttempt(seriesId);
    if (!background) {
      state.detailLoading = false;
    }
    if (state.activeDetailSeriesId === seriesId) {
      state.activeDetailSeriesId = null;
    }
  }
}

export async function mlvRefreshCurrentTrackingStatus(
  ctx: MlvControllerActionContext,
  seriesItem?: any,
) {
  const state = ctx.state;
  const seriesId = Number(seriesItem?.id || state.activeSelectedSeriesId || 0);
  if (!seriesId) return;
  const refreshRevision = ctx.bumpTrackingStatusRevision(seriesId);
  const isCurrentRefresh = () =>
    ctx.getTrackingStatusRevision(seriesId) === refreshRevision;

  state.isTrackingStatusLoading = true;
  state.trackingStatusError = "";

  try {
    const rawTrackingAccounts = await ctx.api.getTrackingAccounts();
    if (!isCurrentRefresh()) return;
    const services = ctx.getActiveTrackingServices(rawTrackingAccounts);
    state.activeTrackingServices = [...services];

    if (services.length === 0) {
      if (!isCurrentRefresh()) return;
      state.userTrackingStatuses = [];
      state.trackingStatusError = "Connect AniList or MAL in Settings";
      return;
    }

    const targetSeriesItem =
      seriesItem ||
      state.series.find((item: any) => Number(item?.id || 0) === seriesId) ||
      state.selectedSeries;
    const staleCheck = () =>
      Number(state.activeSelectedSeriesId || 0) !== seriesId ||
      !isCurrentRefresh();
    const resolvedIds = await ctx.resolveRefreshTrackingIds({
      seriesId,
      targetSeriesItem,
      detail: state.detail,
      trackedAnilistId: state.trackedAnilistId,
      trackedMalId: state.trackedMalId,
      getTrackingEntries: (id: number) => ctx.api.getTrackingEntries(id),
      findAnilistIdByTitle: ctx.findAnilistIdByTitle,
      anilistDetails: (id: number) => ctx.api.anilistDetails(id),
      searchMalIdByTitle: (id: number) => ctx.api.searchMalIdByTitle(id),
      isStale: staleCheck,
    });
    if (staleCheck()) return;
    const resolvedAnilistId = resolvedIds.anilistId;
    const resolvedMalId = resolvedIds.malId;

    if (
      Number(state.activeSelectedSeriesId || 0) !== seriesId ||
      !isCurrentRefresh()
    ) {
      return;
    }
    state.trackedAnilistId = resolvedAnilistId || null;
    state.trackedMalId = resolvedMalId || null;

    let rawStatuses: any[] = [];
    let trackingFetchError: unknown = null;
    try {
      const fetched = await ctx.api.getUserTrackingStatus(
        seriesId,
        resolvedAnilistId || undefined,
        resolvedMalId || undefined,
      );
      if (!isCurrentRefresh()) return;
      rawStatuses = Array.isArray(fetched) ? fetched : [];
    } catch (error) {
      trackingFetchError = error;
    }

    if (
      Number(state.activeSelectedSeriesId || 0) !== seriesId ||
      !isCurrentRefresh()
    ) {
      return;
    }
    const localTrackingEntries = await ctx.api.getTrackingEntries(seriesId);
    if (!isCurrentRefresh()) return;
    const mergedStatuses = ctx.mergeTrackingEntries(
      Array.isArray(localTrackingEntries) ? localTrackingEntries : [],
      Array.isArray(rawStatuses) ? rawStatuses : [],
    );

    const cards = await ctx.buildTrackingCards(
      services,
      mergedStatuses,
      {
        anilistId: resolvedAnilistId,
        malId: resolvedMalId,
      },
      targetSeriesItem,
      state.detail,
      () =>
        Number(state.activeSelectedSeriesId || 0) !== seriesId ||
        !isCurrentRefresh(),
    );
    if (
      Number(state.activeSelectedSeriesId || 0) !== seriesId ||
      !isCurrentRefresh()
    ) {
      return;
    }
    state.userTrackingStatuses = [...cards];
    if (trackingFetchError) {
      const descriptor = ctx.getTrackingErrorDescriptor(
        trackingFetchError,
        "fallback",
      );
      state.trackingStatusError = descriptor.statusError;
    } else {
      state.trackingStatusError = "";
    }

    const cached = ctx.detailCache.get(seriesId);
    if (cached) {
      ctx.setDetailCache(seriesId, {
        ...cached,
        activeTrackingServices: [...services],
        userTrackingStatuses: [...cards],
      });
    } else {
      ctx.setDetailCache(seriesId, {
        detail: state.detailSeriesId === seriesId ? state.detail : null,
        friends: [...state.friends],
        trackedAnilistId: state.trackedAnilistId,
        trackedMalId: state.trackedMalId,
        activeTrackingServices: [...services],
        userTrackingStatuses: [...cards],
      });
    }
  } catch (error) {
    console.error("Failed to refresh tracking status:", error);
    if (isCurrentRefresh()) {
      const descriptor = ctx.getTrackingErrorDescriptor(error, "refresh");
      state.trackingStatusError = descriptor.statusError;
      if (descriptor.toastError) {
        ctx.toasts.add(descriptor.toastError, "error");
      }
    }
  } finally {
    if (
      Number(state.activeSelectedSeriesId || 0) === seriesId &&
      isCurrentRefresh()
    ) {
      state.isTrackingStatusLoading = false;
    }
  }
}

export function mlvSelectSeries(
  ctx: MlvControllerActionContext,
  seriesItem: any,
) {
  const state = ctx.state;
  const nextSeriesId = Number(seriesItem?.id || 0) || null;
  if (nextSeriesId === state.selectedSeriesId) return;
  const nextAnilistId =
    ctx.parsePositiveId(seriesItem?.anilist_id) ||
    ctx.parseAnilistId(seriesItem);
  const nextMalId = ctx.parsePositiveId(seriesItem?.mal_id);

  if (!nextSeriesId) {
    ctx.resetSeriesDetailState();
    state.selectedSeriesId = null;
    return;
  }

  const cached = ctx.detailCache.get(nextSeriesId);
  if (cached) {
    ctx.applyCachedSeriesDetailState(nextSeriesId, cached, {
      anilistId: nextAnilistId || null,
      malId: nextMalId || null,
    });
  } else {
    ctx.resetSeriesDetailState();
    state.trackedAnilistId = nextAnilistId || null;
    state.trackedMalId = nextMalId || null;
  }

  state.selectedSeriesId = nextSeriesId;
  if (nextSeriesId) {
    ctx.setTrackingStatusVisible(nextSeriesId, false);
  }
}

export async function mlvRefreshSeriesDetail(
  ctx: MlvControllerActionContext,
  seriesItem: any,
  loadSeriesDetail: (
    seriesItem: any,
    options?: { force?: boolean; background?: boolean },
  ) => Promise<void>,
) {
  const seriesId = Number(seriesItem?.id || 0);
  if (seriesId > 0) {
    ctx.detailCache.delete(seriesId);
  }
  await loadSeriesDetail(seriesItem, { force: true });
}

export async function mlvHandleTrackingStatusClick(
  ctx: MlvControllerActionContext,
  seriesItem: any,
  refreshCurrentTrackingStatus: (seriesItem?: any) => Promise<void>,
) {
  const state = ctx.state;
  const seriesId = Number(seriesItem?.id || state.activeSelectedSeriesId || 0);
  if (!seriesId) return;
  const wasVisible = Boolean(state.trackingStatusVisibleBySeries[seriesId]);
  ctx.setTrackingStatusVisible(seriesId, true);
  if (wasVisible) {
    await refreshCurrentTrackingStatus(seriesItem);
    return;
  }

  const hasInMemory =
    Array.isArray(state.userTrackingStatuses) &&
    state.userTrackingStatuses.length > 0;
  const inMemoryStatuses = hasInMemory
    ? ctx.filterTrackingCardsForDisplay(state.userTrackingStatuses)
    : [];
  const cached = ctx.detailCache.get(seriesId);
  const cachedStatuses = Array.isArray(cached?.userTrackingStatuses)
    ? ctx.filterTrackingCardsForDisplay(cached.userTrackingStatuses)
    : [];
  const openState = ctx.resolveTrackingStatusOpenState(
    hasInMemory,
    inMemoryStatuses,
    cachedStatuses,
    ctx.hasUnknownTrackingTotal,
  );

  if (!openState.hasInMemory && openState.hasCached) {
    state.userTrackingStatuses = [...cachedStatuses];
  }

  if (!openState.hasInMemory && !openState.hasCached) {
    await refreshCurrentTrackingStatus(seriesItem);
    return;
  }

  if (openState.shouldRefreshUnknownTotals) {
    await refreshCurrentTrackingStatus(seriesItem);
  }
}

export function mlvGetTrackingCardsForContinue(
  ctx: MlvControllerActionContext,
  seriesId: number,
) {
  const state = ctx.state;
  const selectedId = Number(state.activeSelectedSeriesId || 0);
  if (
    seriesId > 0 &&
    seriesId === selectedId &&
    Array.isArray(state.userTrackingStatuses) &&
    state.userTrackingStatuses.length > 0
  ) {
    return ctx.filterTrackingCardsForDisplay(state.userTrackingStatuses);
  }
  const cached = ctx.detailCache.get(seriesId);
  return Array.isArray(cached?.userTrackingStatuses)
    ? ctx.filterTrackingCardsForDisplay(cached.userTrackingStatuses)
    : [];
}

export async function mlvHandleContinueClick(
  ctx: MlvControllerActionContext,
  chapterCards: any[],
  refreshCurrentTrackingStatus: (seriesItem?: any) => Promise<void>,
  openChapter: (item: any) => void,
) {
  const state = ctx.state;
  if (state.isContinueResolving) return;
  const cards = Array.isArray(chapterCards) ? chapterCards : [];
  if (cards.length === 0) return;

  const localLastRead = ctx.getMostRecentLocalReadChapter(cards);
  if (localLastRead) {
    openChapter(localLastRead);
    return;
  }

  const seriesId = Number(state.activeSelectedSeriesId || 0);
  state.isContinueResolving = true;
  try {
    if (
      seriesId > 0 &&
      state.selectedSeries &&
      !state.isTrackingStatusLoading
    ) {
      await refreshCurrentTrackingStatus(state.selectedSeries);
    }

    const trackingCards =
      seriesId > 0 ? mlvGetTrackingCardsForContinue(ctx, seriesId) : [];
    const targetChapter = ctx.resolveContinueTargetChapter(
      cards,
      trackingCards,
      state.activeTrackingServices,
    );
    if (targetChapter) {
      openChapter(targetChapter);
    }
  } finally {
    state.isContinueResolving = false;
  }
}

export async function mlvOpenSource(
  ctx: MlvControllerActionContext,
  seriesItem: any,
  providerHint?: string,
) {
  const targetSeries = seriesItem || ctx.state.selectedSeries;
  const sourceUrl = String(targetSeries?.source_url || "").trim();
  const normalizedProviderHint = String(providerHint || "").trim();
  const providerSite = resolveOpenSourceProviderSite(
    targetSeries,
    normalizedProviderHint,
    ctx.providerSiteLookup,
  );

  if (!normalizedProviderHint && sourceUrl && !providerSite) {
    ctx.api.openExternal(sourceUrl);
    return;
  }

  if (!providerSite) {
    ctx.toasts.add(
      normalizedProviderHint
        ? "No source link available for this provider."
        : "No source link available for this series.",
      "info",
    );
    return;
  }

  if (sourceUrl && sourceUrlMatchesProviderSite(sourceUrl, providerSite)) {
    const cacheKey = getProviderResolutionCacheKeyForSite(
      targetSeries,
      normalizedProviderHint,
      providerSite,
    );
    if (cacheKey) {
      setResolvedProviderUrlCacheEntry(ctx, cacheKey, sourceUrl);
    }
    ctx.api.openExternal(sourceUrl);
    return;
  }

  const resolvedProviderUrl = await resolveProviderSeriesUrl(
    ctx,
    targetSeries,
    normalizedProviderHint,
    providerSite,
  );
  if (resolvedProviderUrl) {
    ctx.api.openExternal(resolvedProviderUrl);
    return;
  }

  const seriesId = Number(
    targetSeries?.id || ctx.state.activeSelectedSeriesId || 0,
  );
  if (seriesId > 0) {
    try {
      const chapters = await ctx.api.getSeriesChapters(seriesId);
      const chapterSourceUrl = findChapterSourceUrlForProvider(
        chapters,
        providerSite,
      );
      if (chapterSourceUrl) {
        ctx.api.openExternal(chapterSourceUrl);
        return;
      }
    } catch {}
  }

  ctx.toasts.add(
    normalizedProviderHint
      ? "No source link available for this provider."
      : "No source link available for this series.",
    "info",
  );
}

export async function mlvOpenInDownloader(
  ctx: MlvControllerActionContext,
  seriesItem: any,
  getSeriesTitle: (item: any) => string,
) {
  const state = ctx.state;
  const targetSeries = seriesItem || state.selectedSeries;
  if (!targetSeries) return;

  const sourceId = String(targetSeries?.source_id || "").trim();
  const sourceUrl = String(targetSeries?.source_url || "").trim();
  const titleRomaji = String(
    state.detail?.title?.romaji || targetSeries?.title_romaji || "",
  ).trim();
  const titleEnglish = String(
    state.detail?.title?.english || targetSeries?.title_english || "",
  ).trim();
  const titleNative = String(
    state.detail?.title?.native || targetSeries?.title_original || "",
  ).trim();
  const displayTitle = String(getSeriesTitle(targetSeries) || "").trim();

  let anilistId =
    Number(
      state.detail?.id ||
        state.trackedAnilistId ||
        targetSeries?.anilist_id ||
        ctx.parseAnilistId(targetSeries) ||
        0,
    ) || null;
  if (!anilistId) {
    anilistId = await ctx.findAnilistIdByTitle(targetSeries);
  }

  ctx.api.openDownloaderToMangaSeries({
    id: anilistId,
    sourceId: sourceId || undefined,
    sourceUrl: sourceUrl || undefined,
    title: {
      romaji: titleRomaji || undefined,
      english: titleEnglish || undefined,
      native: titleNative || undefined,
    },
    displayTitle: displayTitle || undefined,
  });

  if (!anilistId) {
    ctx.toasts.add(
      "Opened downloader manga tab. Could not auto-open this series yet.",
      "info",
    );
  }
}

export function mlvGetAnilistUrl(
  ctx: MlvControllerActionContext,
  seriesItem: any,
  getSeriesTitle: (item: any) => string,
) {
  const state = ctx.state;
  return ctx.getAnilistExternalUrl(
    Number(
      state.detail?.id ||
        state.trackedAnilistId ||
        ctx.parseAnilistId(seriesItem) ||
        0,
    ),
    getSeriesTitle(seriesItem || state.selectedSeries),
  );
}

export function mlvGetMalUrl(
  ctx: MlvControllerActionContext,
  seriesItem: any,
  getSeriesTitle: (item: any) => string,
) {
  const state = ctx.state;
  return ctx.getMalExternalUrl(
    Number(state.detail?.idMal || state.trackedMalId || 0),
    String(seriesItem?.source_url || "").trim(),
    getSeriesTitle(seriesItem || state.selectedSeries),
  );
}

export function mlvGetMangabakaUrl(
  ctx: MlvControllerActionContext,
  seriesItem: any,
  getSeriesTitle: (item: any) => string,
) {
  const state = ctx.state;
  const mangabakaUrlFromDetailLinks = getMangabakaUrlFromExternalLinks(
    state.detail?.externalLinks,
  );

  return ctx.getMangabakaExternalUrl(
    Number(
      state.detail?.idMangabaka ||
        seriesItem?.mangabaka_id ||
        state.selectedSeries?.mangabaka_id ||
        0,
    ),
    String(
      state.detail?.sourceUrl ||
        mangabakaUrlFromDetailLinks ||
        seriesItem?.source_url ||
        state.selectedSeries?.source_url ||
        "",
    ).trim(),
    getSeriesTitle(seriesItem || state.selectedSeries),
  );
}
