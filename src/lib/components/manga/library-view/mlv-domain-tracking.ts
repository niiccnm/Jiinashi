import {
  parseAnilistId,
  parseMalId,
  parsePositiveId,
  type DetailCacheEntry,
  type TrackingServiceId,
  type UserTrackingStatusCard,
} from "./mlv-domain-core";

export type MlvTrackingIds = {
  anilistId: number | null;
  malId: number | null;
};

type CreateTrackingDomainArgs = {
  trackingTotalsCache: Map<string, number>;
  sourceTotalCache: Map<number, number>;
  getChapters: (sourceId: string, sourceUrl: string) => Promise<any[]>;
};

export function createMlvTrackingDomain({
  trackingTotalsCache,
  sourceTotalCache,
  getChapters,
}: CreateTrackingDomainArgs) {
  function isProviderSourceId(sourceId: string) {
    const normalized = String(sourceId || "").trim().toLowerCase();
    return normalized.startsWith("jiinashi.");
  }

  function isCanonicalIdentitySourceUrl(sourceUrl: string) {
    const normalized = String(sourceUrl || "").trim().toLowerCase();
    if (!normalized) return false;
    return (
      normalized.includes("anilist.co/manga/") ||
      normalized.includes("myanimelist.net/manga/") ||
      normalized.includes("mangabaka.org/")
    );
  }

  function getActiveTrackingServices(
    trackingAccounts: any[],
  ): TrackingServiceId[] {
    const services = new Set<TrackingServiceId>();
    const accounts = Array.isArray(trackingAccounts) ? trackingAccounts : [];

    for (const account of accounts) {
      const service = String(account?.service || "").toLowerCase();
      if (service !== "anilist" && service !== "mal") continue;
      if (!account?.is_active) continue;
      if (!String(account?.access_token || "").trim()) continue;
      services.add(service as TrackingServiceId);
    }

    const ordered: TrackingServiceId[] = [];
    if (services.has("anilist")) ordered.push("anilist");
    if (services.has("mal")) ordered.push("mal");
    return ordered;
  }

  function hasTrackingEntryValue(entry: any) {
    if (!entry) return false;
    const statusText = String(entry?.status || "").trim();
    const read = Number(entry?.chapters_read ?? entry?.chaptersRead ?? 0);
    const volumesRead = Number(entry?.volumes_read ?? entry?.volumesRead ?? 0);
    return (
      statusText.length > 0 ||
      (Number.isFinite(read) && read > 0) ||
      (Number.isFinite(volumesRead) && volumesRead > 0)
    );
  }

  function getTrackingTotal(entry: any) {
    const raw = Number(entry?.total_chapters ?? entry?.totalChapters ?? 0);
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }

  function getTrackingVolumeTotal(entry: any) {
    const raw = Number(entry?.total_volumes ?? entry?.totalVolumes ?? 0);
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }

  function readExplicitHasEntryFlag(entry: any): boolean | null {
    if (!entry || typeof entry !== "object") return null;
    if (entry.has_entry === true || entry.hasEntry === true) return true;
    if (entry.has_entry === false || entry.hasEntry === false) return false;
    return null;
  }

  function readStatusUnavailableFlag(entry: any): boolean {
    return Boolean(entry?.status_unavailable ?? entry?.statusUnavailable);
  }

  function toPositiveChapterTotal(value: unknown): number | null {
    const raw = Number(value ?? 0);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
  }

  function getTrackingTotalCacheKey(
    service: TrackingServiceId,
    remoteId: number | null,
  ) {
    const id = Number(remoteId || 0);
    if (!Number.isFinite(id) || id <= 0) return "";
    return `${service}:${Math.floor(id)}`;
  }

  function readTrackingTotalCache(
    service: TrackingServiceId,
    remoteId: number | null,
  ) {
    const key = getTrackingTotalCacheKey(service, remoteId);
    if (!key) return null;
    const cached = Number(trackingTotalsCache.get(key) || 0);
    return Number.isFinite(cached) && cached > 0 ? cached : null;
  }

  function writeTrackingTotalCache(
    service: TrackingServiceId,
    remoteId: number | null,
    total: number | null,
  ) {
    const key = getTrackingTotalCacheKey(service, remoteId);
    const normalized = toPositiveChapterTotal(total);
    if (!key || normalized === null) return;
    trackingTotalsCache.set(key, normalized);
  }

  function isOngoingSeries(seriesItem: any, detailItem?: any) {
    const values = [
      String(seriesItem?.status || "").trim(),
      String(detailItem?.status || "").trim(),
    ]
      .map((value) =>
        value
          .toUpperCase()
          .replace(/[\s_-]+/g, "")
          .trim(),
      )
      .filter(Boolean);
    return values.some((value) =>
      ["ONGOING", "RELEASING", "PUBLISHING"].includes(value),
    );
  }

  function readSourceTotalCache(seriesId: number) {
    const id = Number(seriesId || 0);
    if (!Number.isFinite(id) || id <= 0) return null;
    const cached = Number(sourceTotalCache.get(Math.floor(id)) || 0);
    return Number.isFinite(cached) && cached > 0 ? cached : null;
  }

  async function resolveSourceTotalChapters(seriesItem: any) {
    const seriesId = Number(seriesItem?.id || 0);
    if (!Number.isFinite(seriesId) || seriesId <= 0) return null;

    const cached = readSourceTotalCache(seriesId);
    if (cached !== null) return cached;

    const sourceId = String(seriesItem?.source_id || "").trim();
    const sourceUrl = String(seriesItem?.source_url || "").trim();
    if (!sourceId || !sourceUrl) return null;
    if (!isProviderSourceId(sourceId)) return null;
    if (isCanonicalIdentitySourceUrl(sourceUrl)) return null;

    try {
      const chapters = await getChapters(sourceId, sourceUrl);
      const chapterList = Array.isArray(chapters) ? chapters : [];
      let maxChapterNumber = 0;
      const uniqueChapterUrls = new Set<string>();
      for (const chapter of chapterList) {
        const explicitChapterNumber = Number(
          chapter?.chapter_number ?? chapter?.chapterNumber ?? chapter?.number,
        );
        if (
          Number.isFinite(explicitChapterNumber) &&
          explicitChapterNumber > 0
        ) {
          maxChapterNumber = Math.max(maxChapterNumber, explicitChapterNumber);
        } else {
          const title = String(chapter?.title || "").trim();
          const match = title.match(/(\d+(?:\.\d+)?)/);
          if (match?.[1]) {
            const parsedFromTitle = Number(match[1]);
            if (Number.isFinite(parsedFromTitle) && parsedFromTitle > 0) {
              maxChapterNumber = Math.max(maxChapterNumber, parsedFromTitle);
            }
          }
        }
        const chapterUrl = String(
          chapter?.source_url ?? chapter?.url ?? "",
        ).trim();
        if (chapterUrl) uniqueChapterUrls.add(chapterUrl);
      }
      const fallbackCount =
        uniqueChapterUrls.size > 0
          ? uniqueChapterUrls.size
          : chapterList.length;
      const candidate =
        maxChapterNumber > 0 ? maxChapterNumber : Number(fallbackCount || 0);
      if (!Number.isFinite(candidate) || candidate <= 0) return null;
      const normalized = Math.floor(candidate);
      sourceTotalCache.set(seriesId, normalized);
      return normalized;
    } catch {
      return null;
    }
  }

  function mergeTrackingEntries(localEntries: any[], remoteEntries: any[]) {
    const byService = new Map<TrackingServiceId, any>();
    const toService = (value: any): TrackingServiceId | null => {
      const next = String(value || "").toLowerCase();
      if (next === "anilist" || next === "mal")
        return next as TrackingServiceId;
      return null;
    };

    for (const local of Array.isArray(localEntries) ? localEntries : []) {
      const service = toService(local?.service);
      if (!service) continue;
      byService.set(service, local);
    }

    for (const remote of Array.isArray(remoteEntries) ? remoteEntries : []) {
      const service = toService(remote?.service);
      if (!service) continue;
      const current = byService.get(service);
      const explicitRemoteHasEntry = readExplicitHasEntryFlag(remote);
      const remoteHasEntry =
        explicitRemoteHasEntry ?? hasTrackingEntryValue(remote);
      const remoteStatusUnavailable = readStatusUnavailableFlag(remote);
      const remoteTotal = getTrackingTotal(remote);
      const remoteVolumeTotal = getTrackingVolumeTotal(remote);

      if (!current) {
        byService.set(service, remote);
        continue;
      }

      if (!remoteHasEntry) {
        if (remoteStatusUnavailable) {
          const merged = { ...current, status_unavailable: true };
          if (remoteTotal !== null) {
            merged.total_chapters = remoteTotal;
          }
          if (remoteVolumeTotal !== null) {
            merged.total_volumes = remoteVolumeTotal;
          }
          if (remote?.last_synced_at || remote?.lastSyncedAt) {
            merged.last_synced_at =
              remote?.last_synced_at ?? remote?.lastSyncedAt;
          }
          byService.set(service, merged);
          continue;
        }

        const merged = {
          ...current,
          ...remote,
          has_entry: false,
          hasEntry: false,
          status: "",
          chapters_read: 0,
          chaptersRead: 0,
          volumes_read: 0,
          volumesRead: 0,
          score: null,
        };
        if (remoteTotal !== null) {
          merged.total_chapters = remoteTotal;
        }
        if (remoteTotal === null) {
          const currentTotal = getTrackingTotal(current);
          if (currentTotal !== null) {
            merged.total_chapters = currentTotal;
          }
        }
        if (remoteVolumeTotal !== null) {
          merged.total_volumes = remoteVolumeTotal;
        }
        if (remoteVolumeTotal === null) {
          const currentVolumeTotal = getTrackingVolumeTotal(current);
          if (currentVolumeTotal !== null) {
            merged.total_volumes = currentVolumeTotal;
          }
        }
        const currentRemoteId = Number(
          current?.remote_id ?? current?.remoteId ?? 0,
        );
        const mergedRemoteId = Number(
          merged?.remote_id ?? merged?.remoteId ?? 0,
        );
        if (
          (!Number.isFinite(mergedRemoteId) || mergedRemoteId <= 0) &&
          Number.isFinite(currentRemoteId) &&
          currentRemoteId > 0
        ) {
          merged.remote_id = String(Math.floor(currentRemoteId));
        }
        byService.set(service, merged);
        continue;
      }

      const merged = { ...current, ...remote };
      const currentTotal = getTrackingTotal(current);
      const currentVolumeTotal = getTrackingVolumeTotal(current);
      if (remoteTotal === null && currentTotal !== null) {
        merged.total_chapters = currentTotal;
      }
      if (remoteVolumeTotal === null && currentVolumeTotal !== null) {
        merged.total_volumes = currentVolumeTotal;
      }
      byService.set(service, merged);
    }

    return Array.from(byService.values());
  }

  function buildUserTrackingStatusCards(
    services: TrackingServiceId[],
    statuses: any[],
    ids: MlvTrackingIds,
    fallbackTotalChapters: number | null = null,
  ): UserTrackingStatusCard[] {
    const byService = new Map<TrackingServiceId, any>();

    for (const status of Array.isArray(statuses) ? statuses : []) {
      const service = String(status?.service || "").toLowerCase();
      if (service !== "anilist" && service !== "mal") continue;
      byService.set(service as TrackingServiceId, status);
    }

    return services.map((service) => {
      const source = byService.get(service);
      const hasApiTotalField = Boolean(
        source &&
        (Object.prototype.hasOwnProperty.call(source, "total_chapters") ||
          Object.prototype.hasOwnProperty.call(source, "totalChapters")),
      );
      const hasApiVolumeTotalField = Boolean(
        source &&
        (Object.prototype.hasOwnProperty.call(source, "total_volumes") ||
          Object.prototype.hasOwnProperty.call(source, "totalVolumes")),
      );
      const fallbackRemoteId =
        service === "anilist" ? ids.anilistId : ids.malId;
      const statusText = String(source?.status || "").trim();
      const chaptersRead = Number(
        source?.chapters_read ?? source?.chaptersRead ?? 0,
      );
      const volumesRead = Number(
        source?.volumes_read ?? source?.volumesRead ?? 0,
      );

      const serviceTotal = Number(
        source?.total_chapters ?? source?.totalChapters ?? 0,
      );
      const serviceTotalVolumes = Number(
        source?.total_volumes ?? source?.totalVolumes ?? 0,
      );

      const remoteId = Number(
        source?.remote_id ?? source?.remoteId ?? fallbackRemoteId ?? 0,
      );
      const normalizedRemoteId =
        Number.isFinite(remoteId) && remoteId > 0 ? Math.floor(remoteId) : null;
      const apiTotal = toPositiveChapterTotal(serviceTotal);
      const cachedTotal = readTrackingTotalCache(service, normalizedRemoteId);
      const fallbackTotal = toPositiveChapterTotal(fallbackTotalChapters);
      const resolvedTotal = apiTotal ?? cachedTotal ?? fallbackTotal;
      writeTrackingTotalCache(service, normalizedRemoteId, resolvedTotal);
      const explicitHasEntry = readExplicitHasEntryFlag(source);
      const hasEntry = explicitHasEntry ?? statusText.length > 0;
      const safeRead =
        Number.isFinite(chaptersRead) && chaptersRead >= 0 ? chaptersRead : 0;
      const safeVolumesRead =
        Number.isFinite(volumesRead) && volumesRead >= 0 ? volumesRead : 0;
      const rawScore = Number(source?.score);
      const resolvedScore =
        Number.isFinite(rawScore) && rawScore > 0
          ? Number(rawScore.toFixed(1))
          : null;
      const resolvedDisplayTotal =
        resolvedTotal !== null && resolvedTotal >= safeRead
          ? resolvedTotal
          : null;
      const resolvedVolumeTotal = toPositiveChapterTotal(serviceTotalVolumes);
      const resolvedDisplayVolumeTotal =
        resolvedVolumeTotal !== null && resolvedVolumeTotal >= safeVolumesRead
          ? resolvedVolumeTotal
          : null;

      return {
        service,
        hasEntry,
        status: hasEntry ? statusText : "",
        chaptersRead: safeRead,
        volumesRead: safeVolumesRead,
        score: resolvedScore,
        totalChapters: resolvedDisplayTotal,
        totalVolumes: resolvedDisplayVolumeTotal,
        totalFromApi:
          hasApiTotalField ||
          hasApiVolumeTotalField ||
          cachedTotal !== null ||
          fallbackTotal !== null,
        remoteId: normalizedRemoteId,
        lastSyncedAt:
          String(source?.last_synced_at ?? source?.lastSyncedAt ?? "").trim() ||
          null,
      };
    });
  }

  function hasUnknownTrackingTotal(cards: UserTrackingStatusCard[]) {
    return cards.some((card) => {
      const hasTrackData =
        Boolean(card?.hasEntry) ||
        Number(card?.chaptersRead || 0) > 0 ||
        Number(card?.remoteId || 0) > 0;
      return hasTrackData && Number(card?.totalChapters || 0) <= 0;
    });
  }

  async function buildTrackingCards(
    services: TrackingServiceId[],
    statuses: any[],
    ids: MlvTrackingIds,
    seriesItem: any,
    detailItem: any,
    isStale?: () => boolean,
  ) {
    let cards = buildUserTrackingStatusCards(services, statuses, ids);
    if (!isOngoingSeries(seriesItem, detailItem)) {
      return cards;
    }
    if (!hasUnknownTrackingTotal(cards)) {
      return cards;
    }
    const sourceTotal = await resolveSourceTotalChapters(seriesItem);
    if (typeof isStale === "function" && isStale()) {
      return cards;
    }
    if (sourceTotal === null) {
      return cards;
    }
    cards = buildUserTrackingStatusCards(services, statuses, ids, sourceTotal);
    return cards;
  }

  function filterTrackingCardsForDisplay(cards: UserTrackingStatusCard[]) {
    return (Array.isArray(cards) ? cards : []).filter((card) => {
      if (!card) return false;
      if (card.hasEntry) return true;
      if (Number(card.chaptersRead || 0) > 0) return true;
      if (Number(card.volumesRead || 0) > 0) return true;
      if (Number(card.totalChapters || 0) > 0) return true;
      if (Number(card.totalVolumes || 0) > 0) return true;
      return String(card.status || "").trim().length > 0;
    });
  }

  function formatTrackingListStatus(status: string) {
    const raw = String(status || "")
      .trim()
      .toUpperCase();
    const map: Record<string, string> = {
      CURRENT: "Reading",
      READING: "Reading",
      PLANNING: "Plan to Read",
      PLAN_TO_READ: "Plan to Read",
      COMPLETED: "Completed",
      DROPPED: "Dropped",
      PAUSED: "Paused",
      ON_HOLD: "Paused",
      REPEATING: "Rereading",
      REREADING: "Rereading",
    };
    if (map[raw]) return map[raw];
    const normalized = raw.replace(/_/g, " ").toLowerCase();
    return normalized.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }

  function formatTrackingChapterProgress(status: UserTrackingStatusCard) {
    const read = Number(status?.chaptersRead || 0);
    const total = Number(status?.totalChapters || 0);
    const safeRead = Number.isFinite(read) && read >= 0 ? read : 0;
    const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
    return safeTotal > 0 ? `${safeRead} / ${safeTotal}` : `${safeRead} / ?`;
  }

  return {
    getActiveTrackingServices,
    mergeTrackingEntries,
    buildUserTrackingStatusCards,
    hasUnknownTrackingTotal,
    buildTrackingCards,
    filterTrackingCardsForDisplay,
    formatTrackingListStatus,
    formatTrackingChapterProgress,
  };
}

export function shouldDiscardDetailCacheEntry(
  cached: DetailCacheEntry | null | undefined,
) {
  const cards = Array.isArray(cached?.userTrackingStatuses)
    ? cached.userTrackingStatuses
    : [];
  return cards.some(
    (card: any) =>
      Boolean(card?.hasEntry) &&
      (!Boolean(card?.totalFromApi) || Number(card?.totalChapters || 0) <= 0),
  );
}

export function resolveTrackingIdsFromEntries(
  entries: any[],
  seed: MlvTrackingIds,
) {
  let anilistId = Number(seed.anilistId || 0) || null;
  let malId = Number(seed.malId || 0) || null;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const service = String(entry?.service || "").toLowerCase();
    const remoteId = parsePositiveId(entry?.remote_id);
    if (!remoteId) continue;
    if (service === "anilist" && !anilistId) {
      anilistId = remoteId;
    } else if (service === "mal" && !malId) {
      malId = remoteId;
    }
  }
  return { anilistId, malId };
}

export function ensureTrackingIdsFromSeries(
  seriesItem: any,
  seed: MlvTrackingIds,
) {
  const anilistId =
    Number(seed.anilistId || 0) ||
    parsePositiveId(seriesItem?.anilist_id) ||
    parseAnilistId(seriesItem) ||
    null;
  const malId =
    Number(seed.malId || 0) ||
    parsePositiveId(seriesItem?.mal_id) ||
    parseMalId(seriesItem) ||
    null;
  return { anilistId, malId };
}

type ResolveRefreshTrackingIdsArgs = {
  seriesId: number;
  targetSeriesItem: any;
  detail: any;
  trackedAnilistId: number | null;
  trackedMalId: number | null;
  getTrackingEntries: (seriesId: number) => Promise<any[]>;
  findAnilistIdByTitle: (seriesItem: any) => Promise<number | null>;
  anilistDetails: (anilistId: number) => Promise<any>;
  searchMalIdByTitle?: (anilistId: number) => Promise<number | null>;
  isStale?: () => boolean;
};

export async function resolveRefreshTrackingIds({
  seriesId,
  targetSeriesItem,
  detail,
  trackedAnilistId,
  trackedMalId,
  getTrackingEntries,
  findAnilistIdByTitle,
  anilistDetails,
  searchMalIdByTitle,
  isStale,
}: ResolveRefreshTrackingIdsArgs): Promise<MlvTrackingIds> {
  const fallback = ensureTrackingIdsFromSeries(targetSeriesItem, {
    anilistId:
      Number(detail?.id || trackedAnilistId || 0) ||
      parsePositiveId(targetSeriesItem?.anilist_id) ||
      parseAnilistId(targetSeriesItem) ||
      null,
    malId:
      Number(detail?.idMal || trackedMalId || 0) ||
      parsePositiveId(targetSeriesItem?.mal_id) ||
      parseMalId(targetSeriesItem) ||
      null,
  });

  let resolved = { ...fallback };
  if (seriesId > 0 && (!resolved.anilistId || !resolved.malId)) {
    try {
      const trackingEntries = await getTrackingEntries(seriesId);
      if (typeof isStale === "function" && isStale()) return resolved;
      resolved = resolveTrackingIdsFromEntries(trackingEntries, resolved);
    } catch {}
  }

  resolved = ensureTrackingIdsFromSeries(targetSeriesItem, resolved);
  if (!resolved.anilistId && targetSeriesItem) {
    resolved.anilistId = await findAnilistIdByTitle(targetSeriesItem);
    if (typeof isStale === "function" && isStale()) return resolved;
  }
  if (!resolved.malId && resolved.anilistId) {
    try {
      const detailFromAnilist = await anilistDetails(
        Number(resolved.anilistId),
      );
      if (typeof isStale === "function" && isStale()) return resolved;
      const malFromAnilist = parsePositiveId(detailFromAnilist?.idMal);
      if (malFromAnilist) {
        resolved.malId = malFromAnilist;
      }
    } catch {}
  }

  // Fallback: search MAL by title when AniList has no idMal.
  if (!resolved.malId && resolved.anilistId && searchMalIdByTitle) {
    try {
      const foundMalId = await searchMalIdByTitle(Number(resolved.anilistId));
      if (typeof isStale === "function" && isStale()) return resolved;
      if (foundMalId) {
        resolved.malId = foundMalId;
      }
    } catch {}
  }

  return {
    anilistId: Number(resolved.anilistId || 0) || null,
    malId: Number(resolved.malId || 0) || null,
  };
}

export function mergeSeriesCatalogWithUpdates(
  seriesCatalog: any[],
  seriesId: number,
  updates: any,
) {
  return (Array.isArray(seriesCatalog) ? seriesCatalog : []).map((entry) =>
    Number(entry?.id || 0) === Number(seriesId || 0)
      ? { ...entry, ...updates }
      : entry,
  );
}

export function resolveTrackingStatusOpenState(
  hasInMemory: boolean,
  inMemoryStatuses: UserTrackingStatusCard[],
  cachedStatuses: UserTrackingStatusCard[],
  hasUnknownTrackingTotal: (cards: UserTrackingStatusCard[]) => boolean,
) {
  const resolvedHasInMemory = Boolean(hasInMemory);
  const hasCached = Array.isArray(cachedStatuses)
    ? cachedStatuses.length > 0
    : false;
  const shouldRefreshUnknownTotals =
    (inMemoryStatuses.length > 0 &&
      hasUnknownTrackingTotal(inMemoryStatuses)) ||
    (hasCached && hasUnknownTrackingTotal(cachedStatuses));
  return {
    hasInMemory: resolvedHasInMemory,
    hasCached,
    shouldRefreshUnknownTotals,
  };
}

type ResolveInitialDetailTrackingContextArgs = {
  seriesId: number;
  seriesItem: any;
  getTrackingAccounts: () => Promise<any[]>;
  getActiveTrackingServices: (trackingAccounts: any[]) => TrackingServiceId[];
  getTrackingEntries: (seriesId: number) => Promise<any[]>;
  onTrackingAccountsError?: (error: unknown) => void;
  onTrackingEntriesError?: (error: unknown) => void;
};

export async function resolveInitialDetailTrackingContext({
  seriesId,
  seriesItem,
  getTrackingAccounts,
  getActiveTrackingServices,
  getTrackingEntries,
  onTrackingAccountsError,
  onTrackingEntriesError,
}: ResolveInitialDetailTrackingContextArgs) {
  let trackingIds = ensureTrackingIdsFromSeries(seriesItem, {
    anilistId: Number(seriesItem?.anilist_id || 0) || null,
    malId: Number(seriesItem?.mal_id || 0) || null,
  });
  let trackingEntries: any[] = [];
  let activeTrackingServices: TrackingServiceId[] = [];

  try {
    const rawTrackingAccounts = await getTrackingAccounts();
    activeTrackingServices = getActiveTrackingServices(rawTrackingAccounts);
  } catch (error) {
    if (typeof onTrackingAccountsError === "function") {
      onTrackingAccountsError(error);
    }
  }

  if (Number(seriesId || 0) > 0) {
    try {
      const entries = await getTrackingEntries(seriesId);
      trackingEntries = Array.isArray(entries) ? entries : [];
      trackingIds = resolveTrackingIdsFromEntries(trackingEntries, trackingIds);
    } catch (error) {
      if (typeof onTrackingEntriesError === "function") {
        onTrackingEntriesError(error);
      }
    }
  }

  trackingIds = ensureTrackingIdsFromSeries(seriesItem, trackingIds);
  return {
    trackingIds,
    trackingEntries,
    activeTrackingServices,
  };
}
