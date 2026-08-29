import { onDestroy, untrack } from "svelte";
import {
  formatMangaStatus,
  normalizeSeriesTitleStyle,
  resolveSeriesTitle,
  TRACKING_IDENTITY_SOURCE_ID,
  type SeriesTitleStyle,
} from "../../../utils/manga";
import {
  createMlvTrackingEditorActions,
  getActiveTrackingEditorForm,
  getTrackingEditorServices,
  normalizeTrackingStatusValue,
  type TrackingEditorState,
} from "../library-view/mlv-controller-tracking-editor";
import {
  createMlvTrackingDomain,
  resolveRefreshTrackingIds,
} from "../library-view/mlv-domain-tracking";
import type {
  TrackingServiceId,
  UserTrackingStatusCard,
} from "../library-view/mlv-domain-core";
import {
  mangaSeriesSessionCache,
  type SeriesSessionCacheEntry,
  type SeriesSessionMatchedSource,
} from "../mangaSeriesSessionCache";
import { toasts } from "../../../stores/toast";
import {
  formatChapterNumber,
  resolveChapterNumberForDownload,
  getChapterDisplayTitle,
  getChapterPosterLabel,
  isChapterDownloadable,
  isChapterDownloaded,
  getChapterUnavailableReason,
  toPositiveInt,
} from "./msv-domain-core";
import { configureSourceDescriptors } from "./msv-domain-match";
import {
  findAnilistIdByTitle as findAnilistIdByTitleInMetadata,
  getTrackingErrorDescriptor,
  parseAnilistId,
  parseMalId,
} from "../library-view/mlv-domain-core";
import { msvApi } from "./msv-runtime";
import { createMsvMetadataSlice } from "./msv-controller-metadata";
import { createMsvChapterSlice } from "./msv-controller-chapters";
import { createMsvSourceSlice } from "./msv-controller-sources";

export type MsvControllerInputs = {
  manga?: any;
  onBack?: () => void;
  onSelectManga?: (manga: any) => void;
  onDownloadQueued?: () => void;
};

const TRACKING_SERVICE_LABELS: Record<TrackingServiceId, string> = {
  anilist: "AniList",
  mal: "MAL",
};

export function createMsvController(initialInputs: MsvControllerInputs = {}) {
  let manga = $state.raw<any>(initialInputs.manga ?? null);
  let onBack = $state<() => void>(
    typeof initialInputs.onBack === "function" ? initialInputs.onBack : () => {},
  );
  let onSelectManga = $state<((manga: any) => void) | undefined>(
    typeof initialInputs.onSelectManga === "function"
      ? initialInputs.onSelectManga
      : undefined,
  );
  let onDownloadQueued = $state<(() => void) | undefined>(
    typeof initialInputs.onDownloadQueued === "function"
      ? initialInputs.onDownloadQueued
      : undefined,
  );
  const searchContextId = crypto.randomUUID();

  function getSeriesIdFromInput(value: any) {
    const parsed = Number(
      value?.anilist_id || value?.idAnilist || value?.id || 0,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function setInputs(next: MsvControllerInputs = {}) {
    const previousSeriesId = getSeriesIdFromInput(manga);
    const nextManga = next.manga ?? null;
    const nextSeriesId = getSeriesIdFromInput(nextManga);

    manga = nextManga;
    onBack = typeof next.onBack === "function" ? next.onBack : () => {};
    onSelectManga =
      typeof next.onSelectManga === "function" ? next.onSelectManga : undefined;
    onDownloadQueued =
      typeof next.onDownloadQueued === "function"
        ? next.onDownloadQueued
        : undefined;

    if (previousSeriesId === nextSeriesId) return;
    invalidateTrackingContext();

    if (nextSeriesId > 0) {
      const cached = mangaSeriesSessionCache.get(nextSeriesId);
      if (cached) {
        isQuickBookmarkLoading = false;
        clearQuickBookmarkRemovalState();
        applySeriesSessionCache(cached);
        return;
      }
    }

    detail = null;
    friends = [];
    resetTrackingContext();
    isQuickBookmarkLoading = false;
    clearQuickBookmarkRemovalState();
    trackingEditorState.open = false;
    trackingEditorState.saving = false;
    trackingEditorState.removing = false;
    trackingEditorState.hydrating = false;
    trackingEditorState.syncBothSitesEnabled = true;
    trackingEditorState.error = "";
    trackingEditorState.service = null;
    trackingEditorState.dirty = false;
    trackingEditorState.requestId = 0;
    trackingEditorState.forms = {};
    chapters = [];
    availableSources = [];
    sourceGroups = [];
    selectedVariantByGroup = {};
    matchedSources = {};
    selectedSourceId = null;
    selectedSourceGroupId = null;
    scanningByGroup = {};
    scannedSources = {};
    chaptersBySource = {};
    selectedChapters = new Set();
    lastSelectedChapterIndex = null;
    currentPage = 1;
  }

  let detail = $state.raw<any>(null);
  let chapters = $state.raw<any[]>([]);
  let friends = $state.raw<any[]>([]);
  let trackingLocalSeriesId = $state<number | null>(null);
  let trackedAnilistId = $state<number | null>(null);
  let trackedMalId = $state<number | null>(null);
  let activeTrackingServices = $state.raw<TrackingServiceId[]>([]);
  let userTrackingStatuses = $state.raw<UserTrackingStatusCard[]>([]);
  let localTrackingEntries = $state.raw<any[]>([]);
  const trackingTotalsCache = new Map<string, number>();
  const sourceTotalCache = new Map<number, number>();
  const trackingApi = window.electronAPI.manga;
  const trackingDomain = createMlvTrackingDomain({
    trackingTotalsCache,
    sourceTotalCache,
    getChapters: (sourceId: string, sourceUrl: string) =>
      msvApi.manga.getChapters(sourceId, sourceUrl, searchContextId),
  });
  const {
    getActiveTrackingServices,
    buildTrackingCards,
    mergeTrackingEntries,
    formatTrackingListStatus,
  } = trackingDomain;
  let trackingEditorState = $state<TrackingEditorState>({
    open: false,
    saving: false,
    removing: false,
    hydrating: false,
    syncBothSitesEnabled: true,
    error: "",
    service: null,
    dirty: false,
    requestId: 0,
    forms: {},
  });
  let isQuickBookmarkLoading = $state(false);
  let isQuickBookmarkRemoveConfirmOpen = $state(false);
  let quickBookmarkPendingRemovalServices = $state.raw<TrackingServiceId[]>([]);

  function resetTrackingContext() {
    trackingLocalSeriesId = null;
    trackedAnilistId = null;
    trackedMalId = null;
    activeTrackingServices = [];
    userTrackingStatuses = [];
    localTrackingEntries = [];
  }

  function invalidateTrackingContext() {
    trackingContextVersion += 1;
  }

  function isTrackingContextCurrent(
    requestSeriesId: number,
    requestContextVersion: number,
  ) {
    return (
      isMounted &&
      requestContextVersion === trackingContextVersion &&
      getCurrentSeriesId() === requestSeriesId
    );
  }

  function clearQuickBookmarkRemovalState() {
    isQuickBookmarkRemoveConfirmOpen = false;
    quickBookmarkPendingRemovalServices = [];
  }

  function getTrackingServiceLabel(service: TrackingServiceId) {
    return TRACKING_SERVICE_LABELS[service] || service.toUpperCase();
  }

  function formatTrackingServiceLabels(services: TrackingServiceId[]) {
    const labels = services.map((service) => getTrackingServiceLabel(service));
    if (labels.length <= 1) return labels[0] || "tracking service";
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
  }

  function getConnectedTrackingServices(): TrackingServiceId[] {
    return (Array.isArray(activeTrackingServices)
      ? activeTrackingServices
      : []
    ).filter(
      (service): service is TrackingServiceId =>
        service === "anilist" || service === "mal",
    );
  }

  function resolveQuickBookmarkTargetServices(): TrackingServiceId[] {
    const services = getConnectedTrackingServices();
    if (services.length <= 1) return [...services];
    return trackingEditorState.syncBothSitesEnabled
      ? [...services]
      : [services[0]];
  }

  function getTrackingStatusCard(service: TrackingServiceId) {
    return userTrackingStatuses.find((entry) => entry?.service === service) || null;
  }

  function getLocalTrackingEntry(service: TrackingServiceId) {
    return localTrackingEntries.find(
      (entry) => String(entry?.service || "").toLowerCase() === service,
    ) || null;
  }

  function getBookmarkStatusSource(service: TrackingServiceId) {
    const localEntry = getLocalTrackingEntry(service);
    if (String(localEntry?.status || "").trim().length > 0) {
      return localEntry?.status;
    }
    return getTrackingStatusCard(service)?.status;
  }

  function hasTrackedBookmarkEntry(service: TrackingServiceId) {
    const localEntry = getLocalTrackingEntry(service);
    if (localEntry) {
      const localStatus = String(localEntry?.status || "").trim();
      if (localStatus.length > 0) return true;
      if (Number(localEntry?.chapters_read || 0) > 0) return true;
      if (Number(localEntry?.volumes_read || 0) > 0) return true;
    }

    const card = getTrackingStatusCard(service);
    if (!card) return false;
    return Boolean(
      card.hasEntry ||
        String(card.status || "").trim().length > 0 ||
        Number(card.chaptersRead || 0) > 0 ||
        Number(card.volumesRead || 0) > 0,
    );
  }

  function resolveTrackingRemoteId(
    service: TrackingServiceId,
    card?: UserTrackingStatusCard | null,
  ) {
    const directRemoteId = Number(card?.remoteId || 0);
    if (Number.isFinite(directRemoteId) && directRemoteId > 0) {
      return Math.floor(directRemoteId);
    }
    const fallbackRemoteId =
      service === "anilist"
        ? Number(trackedAnilistId || 0)
        : Number(trackedMalId || 0);
    return Number.isFinite(fallbackRemoteId) && fallbackRemoteId > 0
      ? Math.floor(fallbackRemoteId)
      : 0;
  }

  function isPlanningTrackingStatus(
    service: TrackingServiceId,
    rawStatus: unknown,
  ) {
    const normalized = normalizeTrackingStatusValue(service, rawStatus);
    return service === "anilist"
      ? normalized === "PLANNING"
      : normalized === "plan_to_read";
  }

  let availableSources = $state.raw<any[]>([]);
  let sourceGroups = $state.raw<any[]>([]);
  let selectedVariantByGroup = $state<Record<string, string>>({});
  let matchedSources = $state.raw<Record<string, SeriesSessionMatchedSource>>({});
  let selectedSourceId = $state<string | null>(null);
  let selectedSourceGroupId = $state<string | null>(null);
  let scanningByGroup = $state<Record<string, boolean>>({});
  let scannedSources = $state.raw<Record<string, boolean>>({});
  let chaptersBySource = $state.raw<Record<string, any[]>>({});
  let seriesTitleStyle = $state<SeriesTitleStyle>("romaji");
  let loadToken = 0;
  let chapterLoadToken = 0;
  let trackingContextVersion = 0;
  let isMounted = true;
  let unsubscribeMangaProgress: (() => void) | null = null;
  let knownCompletedChapterUrls = new Set<string>();
  const pendingSlugRankedDuplicateRefinement = new Map<string, string>();
  let slugRankedDuplicateRefinementSeq = 0;

  let isLoading = $state(false);
  let selectedChapters = $state<Set<string>>(new Set());
  let isDescriptionExpanded = $state(false);
  let currentPage = $state(1);
  let lastSelectedChapterIndex: number | null = null;
  let descriptionBodyEl = $state<HTMLParagraphElement | null>(null);
  const itemsPerPage = 20;

  const paginatedChapters = $derived(
    chapters.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
  );
  const totalPages = $derived(Math.ceil(chapters.length / itemsPerPage));
  const downloadableChaptersCount = $derived(
    chapters.filter((chapter) => chapter?.is_downloadable !== false).length,
  );
  const downloadedChaptersCount = $derived(
    chapters.filter((chapter) => Boolean(chapter?.is_downloaded)).length,
  );
  const selectedDownloadableChapters = $derived.by(() =>
    chapters.filter(
      (chapter) =>
        selectedChapters.has(String(chapter?.source_url || "")) &&
        chapter?.is_downloadable !== false,
    ),
  );
  const shouldUseRedownloadLabel = $derived.by(() => {
    if (selectedDownloadableChapters.length === 0) return false;
    return selectedDownloadableChapters.every((chapter) => Boolean(chapter?.is_downloaded));
  });
  const selectedActionLabel = $derived.by(() =>
    shouldUseRedownloadLabel ? "Redownload" : "Download",
  );
  const areAllDownloadableChaptersSelected = $derived.by(() => {
    if (downloadableChaptersCount === 0) return false;
    return chapters
      .filter((chapter) => chapter?.is_downloadable !== false)
      .every((chapter) => selectedChapters.has(chapter.source_url));
  });
  const isScanningSources = $derived(Object.values(scanningByGroup).some(Boolean));
  const isSelectedSourceTransitioning = $derived.by(() => {
    const groupId = String(selectedSourceGroupId || "").trim();
    if (!groupId) return false;
    if (chapters.length > 0) return false;
    return Boolean(isLoading || scanningByGroup[groupId]);
  });

  const STRICT_RANKED_MATCH_MAX_CANDIDATES = 20;
  const STRICT_RANKED_MATCH_MAX_QUERIES = 4;
  const STRICT_RANKED_MATCH_INTER_QUERY_DELAY_MS = 150;
  const STRICT_RANKED_LOW_CHAPTER_PROBE_THRESHOLD = 75;

  function getCurrentSeriesId() {
    return getSeriesIdFromInput(manga);
  }

  function resolveTrackingServices(rawTrackingAccounts: any[]): TrackingServiceId[] {
    return getActiveTrackingServices(rawTrackingAccounts).filter(
      (service): service is TrackingServiceId =>
        service === "anilist" || service === "mal",
    );
  }

  function getTrackingSeriesTitle() {
    return resolveSeriesTitle(
      {
        title_original: detail?.title?.native || manga?.title?.native || "",
        title_romaji: detail?.title?.romaji || manga?.title?.romaji || "",
        title_english: detail?.title?.english || manga?.title?.english || "",
      },
      seriesTitleStyle,
      "Unknown Series",
    );
  }

  function getTrackingSeriesSource() {
    const resolvedSourceId = String(selectedSourceId || "").trim();
    const matchedSource = resolvedSourceId ? matchedSources[resolvedSourceId] : null;
    const matchedSourceUrl = String(matchedSource?.source_url || "").trim();
    if (resolvedSourceId && matchedSourceUrl) {
      return {
        sourceId: resolvedSourceId,
        sourceUrl: matchedSourceUrl,
      };
    }

    for (const sourceId of Object.values(selectedVariantByGroup)) {
      const normalizedSourceId = String(sourceId || "").trim();
      if (!normalizedSourceId) continue;
      const candidate = matchedSources[normalizedSourceId];
      const candidateSourceUrl = String(candidate?.source_url || "").trim();
      if (!candidateSourceUrl) continue;
      return {
        sourceId: normalizedSourceId,
        sourceUrl: candidateSourceUrl,
      };
    }

    for (const [sourceId, candidate] of Object.entries(matchedSources)) {
      const normalizedSourceId = String(sourceId || "").trim();
      const candidateSourceUrl = String(candidate?.source_url || "").trim();
      if (!normalizedSourceId || !candidateSourceUrl) continue;
      return {
        sourceId: normalizedSourceId,
        sourceUrl: candidateSourceUrl,
      };
    }

    const fallbackSourceId = String(manga?.source_id || "").trim();
    const fallbackSourceUrl = String(manga?.source_url || "").trim();
    if (fallbackSourceId && fallbackSourceUrl) {
      return {
        sourceId: fallbackSourceId,
        sourceUrl: fallbackSourceUrl,
      };
    }

    return {
      sourceId: "",
      sourceUrl: "",
    };
  }

  function resolveTrackingReadingFormat() {
    const rawFormat = String(detail?.format || manga?.format || "")
      .trim()
      .toUpperCase();
    if (rawFormat === "MANHWA") return "manhwa" as const;
    if (rawFormat === "MANHUA") return "manhua" as const;
    return "manga" as const;
  }

  function resolveTrackingSeriesStatus() {
    const normalized = String(detail?.status || "")
      .trim()
      .toUpperCase();
    if (normalized === "FINISHED") return "completed" as const;
    if (normalized === "RELEASING") return "ongoing" as const;
    if (normalized === "HIATUS") return "hiatus" as const;
    if (normalized === "CANCELLED") return "cancelled" as const;
    return undefined;
  }

  function getSyntheticTrackingIdentity() {
    const anilistId = Number(
      detail?.id || manga?.anilist_id || parseAnilistId(manga) || 0,
    );
    if (Number.isFinite(anilistId) && anilistId > 0) {
      return {
        sourceId: TRACKING_IDENTITY_SOURCE_ID,
        sourceUrl: `anilist:${Math.floor(anilistId)}`,
      };
    }

    const malId = Number(
      detail?.idMal || manga?.mal_id || parseMalId(manga) || 0,
    );
    if (Number.isFinite(malId) && malId > 0) {
      return {
        sourceId: TRACKING_IDENTITY_SOURCE_ID,
        sourceUrl: `mal:${Math.floor(malId)}`,
      };
    }

    const mangabakaId = Number(detail?.idMangabaka || getMangabakaIdFromInput() || 0);
    if (Number.isFinite(mangabakaId) && mangabakaId > 0) {
      return {
        sourceId: TRACKING_IDENTITY_SOURCE_ID,
        sourceUrl: `mangabaka:${Math.floor(mangabakaId)}`,
      };
    }

    return {
      sourceId: "",
      sourceUrl: "",
    };
  }

  function buildTrackingSeriesPayload() {
    const { sourceId, sourceUrl } = getTrackingSeriesSource();
    const resolvedIdentity =
      sourceId && sourceUrl
        ? { sourceId, sourceUrl }
        : getSyntheticTrackingIdentity();
    return {
      source_id: resolvedIdentity.sourceId,
      source_url: resolvedIdentity.sourceUrl,
      title_original:
        String(detail?.title?.native || manga?.title?.native || "").trim() ||
        getTrackingSeriesTitle(),
      title_romaji:
        String(detail?.title?.romaji || manga?.title?.romaji || "").trim() ||
        undefined,
      title_english:
        String(detail?.title?.english || manga?.title?.english || "").trim() ||
        undefined,
      description: String(detail?.description || "").trim() || undefined,
      cover_url:
        String(detail?.coverImage?.extraLarge || detail?.coverImage?.large || "").trim() ||
        undefined,
      banner_url: String(detail?.bannerImage || "").trim() || undefined,
      status: resolveTrackingSeriesStatus(),
      reading_format: resolveTrackingReadingFormat(),
      mal_score:
        Number.isFinite(Number(detail?.averageScore || 0)) &&
        Number(detail?.averageScore || 0) > 0
          ? Number(detail?.averageScore || 0) / 10
          : undefined,
      year:
        Number.isFinite(Number(detail?.startDate?.year || 0)) &&
        Number(detail?.startDate?.year || 0) > 0
          ? Number(detail?.startDate?.year || 0)
          : undefined,
      genres: Array.isArray(detail?.genres)
        ? detail.genres.map((genre: any) => String(genre || "")).filter(Boolean)
        : undefined,
      anilist_id: Number(detail?.id || manga?.anilist_id || parseAnilistId(manga) || 0) || undefined,
      mal_id: Number(detail?.idMal || manga?.mal_id || parseMalId(manga) || 0) || undefined,
      mangabaka_id:
        Number(detail?.idMangabaka || getMangabakaIdFromInput() || 0) || undefined,
      last_updated: new Date().toISOString(),
    };
  }

  async function loadConnectedTrackingServices() {
    try {
      const rawTrackingAccounts = await trackingApi.getTrackingAccounts();
      const services = resolveTrackingServices(rawTrackingAccounts);
      activeTrackingServices = [...services];
      return services;
    } catch (error) {
      console.warn("Failed to load tracking accounts:", error);
      activeTrackingServices = [];
      return [] as TrackingServiceId[];
    }
  }

  async function hydrateTrackingSyncBothSitesSetting() {
    try {
      const raw = await msvApi.settings.get("trackingEditorSyncBothSites");
      trackingEditorState.syncBothSitesEnabled = String(raw || "").trim() !== "false";
    } catch {
      trackingEditorState.syncBothSitesEnabled = true;
    }
  }

  function hydrateTrackingIdentityHints() {
    if (!trackedAnilistId) {
      const hintedAnilistId = Number(
        detail?.id || manga?.anilist_id || parseAnilistId(manga) || 0,
      );
      trackedAnilistId =
        Number.isFinite(hintedAnilistId) && hintedAnilistId > 0
          ? Math.floor(hintedAnilistId)
          : null;
    }

    if (!trackedMalId) {
      const hintedMalId = Number(
        detail?.idMal || manga?.mal_id || parseMalId(manga) || 0,
      );
      trackedMalId =
        Number.isFinite(hintedMalId) && hintedMalId > 0
          ? Math.floor(hintedMalId)
          : null;
    }
  }

  async function refreshLocalTrackingEntries(options?: {
    requestSeriesId?: number;
    requestContextVersion?: number;
  }) {
    const seriesId = Number(trackingLocalSeriesId || 0);
    const requestSeriesId = Number(options?.requestSeriesId || getCurrentSeriesId());
    const requestContextVersion = Number(
      options?.requestContextVersion ?? trackingContextVersion,
    );
    if (!seriesId) {
      if (isTrackingContextCurrent(requestSeriesId, requestContextVersion)) {
        localTrackingEntries = [];
      }
      return [];
    }
    const entries = await trackingApi.getTrackingEntries(seriesId);
    const normalizedEntries = Array.isArray(entries) ? [...entries] : [];
    if (isTrackingContextCurrent(requestSeriesId, requestContextVersion)) {
      localTrackingEntries = normalizedEntries;
    }
    return normalizedEntries;
  }

  function queueTrackingStatusRefresh() {
    void refreshCurrentTrackingStatus().catch((error) => {
      console.warn("Failed to refresh downloader tracking status in background:", error);
    });
  }

  async function prepareQuickBookmarkContext(options?: {
    silent?: boolean;
    refreshRemote?: boolean;
  }) {
    const silent = Boolean(options?.silent);
    const refreshRemote = Boolean(options?.refreshRemote);
    const requestSeriesId = getCurrentSeriesId();
    const requestContextVersion = trackingContextVersion;
    try {
      await hydrateTrackingSyncBothSitesSetting();
      const services = await loadConnectedTrackingServices();
      if (!isTrackingContextCurrent(requestSeriesId, requestContextVersion)) {
        return [] as TrackingServiceId[];
      }
      if (services.length === 0) {
        if (isTrackingContextCurrent(requestSeriesId, requestContextVersion)) {
          userTrackingStatuses = [];
          localTrackingEntries = [];
        }
        return services;
      }
      await ensureLocalTrackingSeries();
      if (!isTrackingContextCurrent(requestSeriesId, requestContextVersion)) {
        return [] as TrackingServiceId[];
      }
      hydrateTrackingIdentityHints();
      await refreshLocalTrackingEntries({
        requestSeriesId,
        requestContextVersion,
      });
      if (refreshRemote) {
        queueTrackingStatusRefresh();
      }
      return services;
    } catch (error) {
      if (!silent) {
        const message =
          String((error as any)?.message || "").trim() ||
          "Could not prepare tracking quick action";
        toasts.add(message, "error");
      } else {
        console.warn("Failed to prime downloader tracking state:", error);
      }
      return [] as TrackingServiceId[];
    }
  }

  function getQuickBookmarkExistingCards(services: TrackingServiceId[]) {
    return services
      .map((service) => ({
        service,
        card: getTrackingStatusCard(service),
      }))
      .filter((entry) => hasTrackedBookmarkEntry(entry.service));
  }

  function hasTrackedEntriesForServices(services: TrackingServiceId[]) {
    return services.some((service) => hasTrackedBookmarkEntry(service));
  }

  function hasPlanningEntriesForServices(services: TrackingServiceId[]) {
    return services.some((service) =>
      Boolean(
        hasTrackedBookmarkEntry(service) &&
          isPlanningTrackingStatus(service, getBookmarkStatusSource(service)),
      ),
    );
  }

  function hasNonPlanningEntriesForServices(services: TrackingServiceId[]) {
    return services.some((service) =>
      Boolean(
        hasTrackedBookmarkEntry(service) &&
          !isPlanningTrackingStatus(service, getBookmarkStatusSource(service)),
      ),
    );
  }

  async function applyQuickBookmarkPlanning(
    services: TrackingServiceId[],
    options?: { successMessage?: string },
  ) {
    const updates = services.map((service) => {
      const card = getTrackingStatusCard(service);
      const remoteId = resolveTrackingRemoteId(service, card);
      if (remoteId <= 0) {
        throw new Error(
          `${getTrackingServiceLabel(service)} entry is not linked for this series.`,
        );
      }
      return {
        service,
        payload: {
          seriesId: Number(trackingLocalSeriesId || 0),
          service,
          remoteId,
          chaptersRead: 0,
          volumesRead: 0,
          score: null,
          status:
            service === "anilist"
              ? normalizeTrackingStatusValue(service, "PLANNING")
              : normalizeTrackingStatusValue(service, "plan_to_read"),
          totalChapters: card?.totalChapters ?? null,
          totalVolumes: card?.totalVolumes ?? null,
        },
      };
    });

    await Promise.all(
      updates.map(({ payload }) => trackingApi.updateTrackingEntry(payload)),
    );
    await refreshLocalTrackingEntries();
    hydrateTrackingIdentityHints();
    queueTrackingStatusRefresh();
    toasts.add(
      options?.successMessage || "Added to Plan to Read",
      "success",
    );
  }

  async function removeQuickBookmarkEntries(
    services: TrackingServiceId[],
    options?: { successMessage?: string },
  ) {
    const removableCards = getQuickBookmarkExistingCards(services);
    if (removableCards.length === 0) return;
    const removalServiceSet = new Set(removableCards.map(({ service }) => service));
    const previousStatusesByService = new Map(
      userTrackingStatuses.map((entry) => [entry.service, entry]),
    );

    // Flip the bookmark state immediately, then reconcile with the real source of truth.
    localTrackingEntries = localTrackingEntries.filter((entry) => {
      const service = String(entry?.service || "").toLowerCase();
      return !removalServiceSet.has(service as TrackingServiceId);
    });
    userTrackingStatuses = userTrackingStatuses.map((entry) =>
      removalServiceSet.has(entry.service)
        ? {
            ...entry,
            hasEntry: false,
            status: "",
            chaptersRead: 0,
            volumesRead: 0,
            score: null,
          }
        : entry,
    );

    const removals = removableCards.map(async ({ service, card }) => {
      try {
        const remoteId = resolveTrackingRemoteId(service, card);
        if (remoteId <= 0) {
          throw new Error(
            `${getTrackingServiceLabel(service)} entry is not linked for this series.`,
          );
        }
        await trackingApi.removeTrackingEntry({
          seriesId: Number(trackingLocalSeriesId || 0),
          service,
          remoteId,
        });
        return { service, ok: true as const };
      } catch (error) {
        return {
          service,
          ok: false as const,
          message:
            String((error as any)?.message || "").trim() ||
            `Failed to remove from ${getTrackingServiceLabel(service)}`,
        };
      }
    });

    const settledRemovals = await Promise.all(removals);
    const failedRemovals = settledRemovals.filter(
      (result): result is {
        service: TrackingServiceId;
        ok: false;
        message: string;
      } => !result.ok,
    );
    const failedServices = new Set(failedRemovals.map((result) => result.service));

    await refreshLocalTrackingEntries();

    if (failedServices.size > 0) {
      userTrackingStatuses = userTrackingStatuses.map((entry) => {
        const previousEntry = previousStatusesByService.get(entry.service);
        return failedServices.has(entry.service) && previousEntry
          ? previousEntry
          : entry;
      });
      queueTrackingStatusRefresh();

      const succeededServices = settledRemovals
        .filter((result) => result.ok)
        .map((result) => result.service);
      const failedLabel = formatTrackingServiceLabels([...failedServices]);
      if (succeededServices.length > 0) {
        const succeededLabel = formatTrackingServiceLabels(succeededServices);
        throw new Error(
          `Removed from ${succeededLabel}, but failed to remove from ${failedLabel}.`,
        );
      }
      throw new Error(
        failedRemovals[0]?.message ||
          `Failed to remove from ${failedLabel}.`,
      );
    }

    queueTrackingStatusRefresh();
    toasts.add(options?.successMessage || "Removed from your list", "success");
  }

  async function ensureLocalTrackingSeries() {
    const payload = buildTrackingSeriesPayload();
    if (!payload.source_id || !payload.source_url) {
      throw new Error("Could not resolve a stable series source for tracking");
    }
    const result = await trackingApi.ensureLocalSeriesForTracking(payload);
    const seriesId = Number(result?.seriesId || 0);
    if (!Number.isFinite(seriesId) || seriesId <= 0) {
      throw new Error("Could not create a local series for tracking");
    }
    trackingLocalSeriesId = seriesId;
    return seriesId;
  }

  async function refreshCurrentTrackingStatus() {
    const seriesId = Number(trackingLocalSeriesId || 0);
    if (!seriesId) return;
    const requestSeriesId = getCurrentSeriesId();
    const requestContextVersion = trackingContextVersion;

    try {
      const services = await loadConnectedTrackingServices();
      if (!isTrackingContextCurrent(requestSeriesId, requestContextVersion)) {
        return;
      }

      if (services.length === 0) {
        userTrackingStatuses = [];
        localTrackingEntries = [];
        return;
      }

      const trackingSeriesItem = {
        id: seriesId,
        ...buildTrackingSeriesPayload(),
      };
      const resolvedIds = await resolveRefreshTrackingIds({
        seriesId,
        targetSeriesItem: trackingSeriesItem,
        detail,
        trackedAnilistId,
        trackedMalId,
        getTrackingEntries: (id: number) => trackingApi.getTrackingEntries(id),
        findAnilistIdByTitle: (item: any) =>
          findAnilistIdByTitleInMetadata(item, (query, page) =>
            window.electronAPI.manga.anilistSearch(query, page),
          ),
        anilistDetails: (id: number) => msvApi.manga.anilistDetails(id),
        searchMalIdByTitle: (id: number) => msvApi.manga.searchMalIdByTitle(id),
      });
      if (!isTrackingContextCurrent(requestSeriesId, requestContextVersion)) {
        return;
      }

      trackedAnilistId = resolvedIds.anilistId || null;
      trackedMalId = resolvedIds.malId || null;

      let rawStatuses: any[] = [];
      let statusFetchError: unknown = null;
      try {
        rawStatuses = await trackingApi.getUserTrackingStatus(
          seriesId,
          resolvedIds.anilistId || undefined,
          resolvedIds.malId || undefined,
        );
      } catch (error) {
        statusFetchError = error;
      }

      const localEntries = await trackingApi.getTrackingEntries(seriesId);
      if (!isTrackingContextCurrent(requestSeriesId, requestContextVersion)) {
        return;
      }
      localTrackingEntries = Array.isArray(localEntries) ? [...localEntries] : [];
      const mergedStatuses = mergeTrackingEntries(
        Array.isArray(localEntries) ? localEntries : [],
        Array.isArray(rawStatuses) ? rawStatuses : [],
      );

      const builtTrackingCards = await buildTrackingCards(
        services,
        mergedStatuses,
        {
          anilistId: resolvedIds.anilistId,
          malId: resolvedIds.malId,
        },
        trackingSeriesItem,
        detail,
      );
      if (!isTrackingContextCurrent(requestSeriesId, requestContextVersion)) {
        return;
      }
      userTrackingStatuses = builtTrackingCards;

      if (statusFetchError) {
        console.warn(
          "Failed to refresh remote downloader tracking status, using local fallback:",
          getTrackingErrorDescriptor(statusFetchError, "fallback").statusError,
        );
      }
    } catch (error) {
      console.error("Failed to refresh downloader tracking status:", error);
    }
  }

  function hasSeriesSessionCache() {
    const seriesId = getCurrentSeriesId();
    return seriesId > 0 && mangaSeriesSessionCache.has(seriesId);
  }

  function hasCachedChaptersForSelectedSource() {
    const sourceId = String(selectedSourceId || "").trim();
    if (!sourceId) return false;
    if (Object.prototype.hasOwnProperty.call(chaptersBySource, sourceId)) {
      return true;
    }
    const seriesId = getCurrentSeriesId();
    if (!seriesId) return false;
    const cached = mangaSeriesSessionCache.get(seriesId);
    if (!cached?.chaptersBySource) return false;
    return Object.prototype.hasOwnProperty.call(cached.chaptersBySource, sourceId);
  }

  function applySeriesSessionCache(cache: SeriesSessionCacheEntry) {
    detail = cache.detail ?? null;
    friends = Array.isArray(cache.friends) ? [...cache.friends] : [];
    availableSources = Array.isArray(cache.availableSources) ? [...cache.availableSources] : [];
    configureSourceDescriptors(availableSources);
    sourceGroups = Array.isArray(cache.sourceGroups) ? [...cache.sourceGroups] : [];
    selectedVariantByGroup = { ...(cache.selectedVariantByGroup || {}) };
    matchedSources = { ...(cache.matchedSources || {}) };
    selectedSourceId = null;
    selectedSourceGroupId = null;
    chaptersBySource = { ...(cache.chaptersBySource || {}) };
    scannedSources = { ...(cache.scannedSources || {}) };
    chapters = [];
    const savedPage = Number(cache.currentPage || 1);
    currentPage = Number.isFinite(savedPage) && savedPage > 0 ? savedPage : 1;
  }

  function persistSeriesSessionCache() {
    const seriesId = getCurrentSeriesId();
    if (!seriesId) return;

    mangaSeriesSessionCache.set(seriesId, {
      detail,
      friends,
      availableSources,
      sourceGroups,
      selectedVariantByGroup,
      matchedSources,
      chaptersBySource,
      scannedSources,
      currentPage: Number(currentPage || 1),
    });
  }

  const ctx: any = {
    STRICT_RANKED_MATCH_MAX_CANDIDATES,
    STRICT_RANKED_MATCH_MAX_QUERIES,
    STRICT_RANKED_MATCH_INTER_QUERY_DELAY_MS,
    STRICT_RANKED_LOW_CHAPTER_PROBE_THRESHOLD,
    searchContextId,
    persistSeriesSessionCache,
    hasCachedChaptersForSelectedSource,
    getCurrentSeriesId,
  };

  const bind = <T>(name: string, getter: () => T, setter?: (value: T) => void) => {
    Object.defineProperty(ctx, name, {
      get: getter,
      set: setter,
      enumerable: true,
      configurable: true,
    });
  };

  bind("manga", () => manga, (value) => (manga = value));
  bind("onDownloadQueued", () => onDownloadQueued, (value) => (onDownloadQueued = value));
  bind("detail", () => detail, (value) => (detail = value));
  bind("chapters", () => chapters, (value) => (chapters = value));
  bind("friends", () => friends, (value) => (friends = value));
  bind("availableSources", () => availableSources, (value) => (availableSources = value));
  bind("sourceGroups", () => sourceGroups, (value) => (sourceGroups = value));
  bind("selectedVariantByGroup", () => selectedVariantByGroup, (value) => (selectedVariantByGroup = value));
  bind("matchedSources", () => matchedSources, (value) => (matchedSources = value));
  bind("selectedSourceId", () => selectedSourceId, (value) => (selectedSourceId = value));
  bind("selectedSourceGroupId", () => selectedSourceGroupId, (value) => (selectedSourceGroupId = value));
  bind("scanningByGroup", () => scanningByGroup, (value) => (scanningByGroup = value));
  bind("scannedSources", () => scannedSources, (value) => (scannedSources = value));
  bind("chaptersBySource", () => chaptersBySource, (value) => (chaptersBySource = value));
  bind("seriesTitleStyle", () => seriesTitleStyle, (value) => (seriesTitleStyle = value));
  bind("loadToken", () => loadToken, (value) => (loadToken = value));
  bind("chapterLoadToken", () => chapterLoadToken, (value) => (chapterLoadToken = value));
  bind("isMounted", () => isMounted, (value) => (isMounted = value));
  bind("knownCompletedChapterUrls", () => knownCompletedChapterUrls, (value) => (knownCompletedChapterUrls = value));
  bind("pendingSlugRankedDuplicateRefinement", () => pendingSlugRankedDuplicateRefinement);
  bind("slugRankedDuplicateRefinementSeq", () => slugRankedDuplicateRefinementSeq, (value) => (slugRankedDuplicateRefinementSeq = value));
  bind("isLoading", () => isLoading, (value) => (isLoading = value));
  bind("selectedChapters", () => selectedChapters, (value) => (selectedChapters = value));
  bind("isDescriptionExpanded", () => isDescriptionExpanded, (value) => (isDescriptionExpanded = value));
  bind("currentPage", () => currentPage, (value) => (currentPage = value));
  bind("lastSelectedChapterIndex", () => lastSelectedChapterIndex, (value) => (lastSelectedChapterIndex = value));
  bind("descriptionBodyEl", () => descriptionBodyEl, (value) => (descriptionBodyEl = value));
  bind("selectedDownloadableChapters", () => selectedDownloadableChapters);
  bind("areAllDownloadableChaptersSelected", () => areAllDownloadableChaptersSelected);

  const metadataSlice = createMsvMetadataSlice(ctx);
  const chapterSlice = createMsvChapterSlice(ctx);
  ctx.mergeLocalChapterStates = chapterSlice.mergeLocalChapterStates;
  ctx.refreshLocalStatesForSource = chapterSlice.refreshLocalStatesForSource;
  const sourceSlice = createMsvSourceSlice(ctx);

  const {
    refreshSeriesTitleStyle,
    getDisplaySeriesTitle,
    getSeriesTypeLabel,
    getDescriptionHtml,
    handleDescriptionClick,
    getSelectedMetadataProvider,
    getMangabakaIdFromInput,
    getAnilistEntryUrl,
    getMalEntryUrl,
    getMangabakaEntryUrl,
    loadFriendsReading,
    openFriendProfile,
  } = metadataSlice;

  const {
    fetchLocalChapterStates,
    mergeLocalChapterStates,
    refreshLocalStatesForSource,
    handleDownloaderProgress,
    resetKnownCompletedChapters,
    clearKnownCompletedChaptersFromQueue,
    handlePageChange,
    toggleChapterSelection,
    clearChapterSelection,
    handleGlobalKeydown,
    selectAll,
    handleDownload,
  } = chapterSlice;

  const {
    buildSourceGroups,
    resolveSourceId,
    scanSources,
    selectSource,
    handleSourceLanguageChange,
    applyManualSourceUrl,
    forgetManualSourceUrl,
    getManualSourceUrl,
    getExpectedHostForGroup,
  } = sourceSlice;

  const trackingEditorActions = createMlvTrackingEditorActions({
    state: trackingEditorState,
    api: {
      getTrackingAccounts: () => trackingApi.getTrackingAccounts(),
      getSyncBothSitesSetting: () =>
        msvApi.settings.get("trackingEditorSyncBothSites"),
      setSyncBothSitesSetting: (enabled: boolean) =>
        msvApi.settings.set(
          "trackingEditorSyncBothSites",
          enabled ? "true" : "false",
        ),
      updateTrackingEntry: (payload) => trackingApi.updateTrackingEntry(payload),
      removeTrackingEntry: (payload) => trackingApi.removeTrackingEntry(payload),
    },
    toasts,
    formatTrackingListStatus,
    getSelectedSeries: () => manga,
    getActiveSelectedSeriesId: () => trackingLocalSeriesId,
    getTrackedAnilistId: () => trackedAnilistId,
    getTrackedMalId: () => trackedMalId,
    getActiveTrackingServices: () => activeTrackingServices,
    setActiveTrackingServices: (services) => {
      activeTrackingServices = [...services];
    },
    getUserTrackingStatuses: () => userTrackingStatuses,
    refreshCurrentTrackingStatus: async () => {
      await refreshCurrentTrackingStatus();
    },
    resolveTrackingServices,
  });
  const trackingEditorServices = $derived(
    getTrackingEditorServices(trackingEditorState),
  );
  const showTrackingEditorSyncBothSitesToggle = $derived.by(() => {
    const services = trackingEditorServices.map((entry) => entry?.service);
    return services.includes("anilist") && services.includes("mal");
  });
  const trackingEditorActiveService = $derived(
    getActiveTrackingEditorForm(trackingEditorState),
  );
  const quickBookmarkTargetServices = $derived.by(() =>
    resolveQuickBookmarkTargetServices(),
  );
  const hasTargetTrackedEntry = $derived.by(() =>
    hasTrackedEntriesForServices(quickBookmarkTargetServices),
  );
  const hasTargetPlanningEntry = $derived.by(() =>
    hasPlanningEntriesForServices(quickBookmarkTargetServices),
  );
  const hasTargetNonPlanningTrackedEntry = $derived.by(() =>
    hasNonPlanningEntriesForServices(quickBookmarkTargetServices),
  );

  onDestroy(() => {
    isMounted = false;
    invalidateTrackingContext();
    if (unsubscribeMangaProgress) {
      unsubscribeMangaProgress();
      unsubscribeMangaProgress = null;
    }
    knownCompletedChapterUrls = new Set();
    pendingSlugRankedDuplicateRefinement.clear();
    msvApi.manga.cancelSearchContext(searchContextId).catch(console.error);
  });

  async function loadAnilistDetail(options?: { force?: boolean }) {
    const forceRefresh = Boolean(options?.force);
    const token = ++loadToken;
    const seriesId = getCurrentSeriesId();
    if (!forceRefresh && seriesId > 0) {
      const cached = mangaSeriesSessionCache.get(seriesId);
      if (cached) {
        applySeriesSessionCache(cached);
        void refreshSeriesTitleStyle();
        scanSources(token);
        void prepareQuickBookmarkContext({ silent: true, refreshRemote: true });
        return;
      }
    }

    isLoading = true;
    await refreshSeriesTitleStyle();

    detail = null;
    friends = [];
    resetTrackingContext();
    isQuickBookmarkLoading = false;
    clearQuickBookmarkRemovalState();
    chapters = [];
    chaptersBySource = {};
    resetKnownCompletedChapters();
    selectedChapters = new Set();
    lastSelectedChapterIndex = null;
    currentPage = 1;
    selectedSourceId = null;
    selectedSourceGroupId = null;
    selectedVariantByGroup = {};
    matchedSources = {};
    scannedSources = {};
    pendingSlugRankedDuplicateRefinement.clear();
    scanningByGroup = {};
    try {
      const provider = getSelectedMetadataProvider();
      const anilistIdFromInput =
        toPositiveInt(manga?.anilist_id) ||
        toPositiveInt(manga?.idAnilist) ||
        (provider === "anilist" ? toPositiveInt(manga?.id) : 0);
      const mangabakaIdFromInput = getMangabakaIdFromInput();
      const metadataPromise =
        provider === "mangabaka"
          ? mangabakaIdFromInput > 0
            ? msvApi.manga.mangabakaDetails(mangabakaIdFromInput)
            : Promise.resolve(null)
          : anilistIdFromInput > 0
            ? msvApi.manga.anilistDetails(anilistIdFromInput)
            : Promise.resolve(null);

      const [metadataDetail, sources] = await Promise.all([
        metadataPromise.catch(() => null),
        msvApi.manga.getEnabledSources(),
      ]);
      if (!isMounted || token !== loadToken) return;
      let resolvedDetail = metadataDetail || null;
      if (!resolvedDetail && provider === "anilist" && mangabakaIdFromInput > 0) {
        resolvedDetail = await msvApi.manga.mangabakaDetails(mangabakaIdFromInput).catch(() => null);
      }
      detail = resolvedDetail || null;
      configureSourceDescriptors(sources);
      availableSources = sources;
      sourceGroups = buildSourceGroups(sources);
      persistSeriesSessionCache();
      loadFriendsReading(detail, token);

      if (!detail?.idMal && detail?.id) {
        msvApi.manga
          .searchMalIdByTitle(detail.id)
          .then((foundMalId) => {
            if (!isMounted || token !== loadToken) return;
            if (foundMalId && !detail?.idMal) {
              detail = { ...detail, idMal: foundMalId };
              persistSeriesSessionCache();
              loadFriendsReading(detail, token);
            }
          })
          .catch(() => {});
      }

      scanSources(token);
      void prepareQuickBookmarkContext({ silent: true, refreshRemote: true });
    } catch (e) {
      console.error("Failed to load manga details:", e);
      toasts.add("Failed to load manga details", "error");
    } finally {
      if (token !== loadToken) return;
      isLoading = false;
    }
  }

  async function reloadCurrentSeries() {
    await loadAnilistDetail({ force: true });
  }

  async function openTrackingEditor() {
    try {
      const services = await loadConnectedTrackingServices();
      if (services.length === 0) {
        toasts.add("Connect AniList or MAL in Settings", "info");
        return;
      }
      await ensureLocalTrackingSeries();
      await trackingEditorActions.openTrackingEditor();
    } catch (error) {
      console.error("Failed to open tracking editor:", error);
      toasts.add(
        String((error as any)?.message || "").trim() ||
          "Could not open tracking editor",
        "error",
      );
    }
  }

  async function handleQuickBookmarkClick() {
    if (
      isQuickBookmarkLoading ||
      trackingEditorState.hydrating ||
      trackingEditorState.saving ||
      trackingEditorState.removing
    ) {
      return;
    }

    isQuickBookmarkLoading = true;
    try {
      const services = await prepareQuickBookmarkContext();
      if (services.length === 0) {
        toasts.add("Connect AniList or MAL in Settings", "info");
        return;
      }

      const targetServices = resolveQuickBookmarkTargetServices();
      if (targetServices.length === 0) {
        toasts.add("Connect AniList or MAL in Settings", "info");
        return;
      }

      const existingCards = getQuickBookmarkExistingCards(targetServices);
      if (existingCards.length === 0) {
        const missingRemoteIds = targetServices.some(
          (service) => resolveTrackingRemoteId(service) <= 0,
        );
        if (missingRemoteIds) {
          await refreshCurrentTrackingStatus();
        }
        await applyQuickBookmarkPlanning(targetServices);
        return;
      }

      const hasAnyNonPlanningEntry = existingCards.some(({ service, card }) =>
        !isPlanningTrackingStatus(service, card?.status),
      );

      if (hasAnyNonPlanningEntry) {
        quickBookmarkPendingRemovalServices = existingCards.map(
          ({ service }) => service,
        );
        isQuickBookmarkRemoveConfirmOpen = true;
        return;
      }

      await removeQuickBookmarkEntries(existingCards.map(({ service }) => service));
    } catch (error) {
      console.error("Failed to toggle downloader quick bookmark:", error);
      toasts.add(
        String((error as any)?.message || "").trim() ||
          "Failed to update tracking status",
        "error",
      );
    } finally {
      isQuickBookmarkLoading = false;
    }
  }

  function cancelQuickBookmarkRemoval() {
    if (isQuickBookmarkLoading) return;
    clearQuickBookmarkRemovalState();
  }

  async function confirmQuickBookmarkRemoval() {
    if (isQuickBookmarkLoading) return;
    const targetServices = [...quickBookmarkPendingRemovalServices];
    if (targetServices.length === 0) {
      clearQuickBookmarkRemovalState();
      return;
    }

    isQuickBookmarkLoading = true;
    try {
      const services = await prepareQuickBookmarkContext();
      if (services.length === 0) return;
      await removeQuickBookmarkEntries(targetServices);
      clearQuickBookmarkRemovalState();
    } catch (error) {
      console.error("Failed to remove downloader tracking entry:", error);
      toasts.add(
        String((error as any)?.message || "").trim() ||
          "Failed to remove series from your list",
        "error",
      );
    } finally {
      isQuickBookmarkLoading = false;
    }
  }

  function closeTrackingEditor() {
    trackingEditorActions.closeTrackingEditor();
  }

  function setTrackingEditorActiveService(service: TrackingServiceId) {
    trackingEditorActions.setTrackingEditorActiveService(service);
  }

  function setTrackingEditorSyncBothSitesEnabled(enabled: boolean) {
    trackingEditorActions.setSyncBothSitesEnabled(enabled);
  }

  function updateTrackingEditorField(
    service: TrackingServiceId,
    field: "status" | "progress" | "volumes" | "score",
    value: string,
  ) {
    trackingEditorActions.updateTrackingEditorField(service, field, value);
  }

  async function saveTrackingEditor() {
    await trackingEditorActions.saveTrackingEditor();
  }

  async function removeTrackingEditorEntry() {
    await trackingEditorActions.removeTrackingEditorEntry();
  }

  $effect(() => {
    const el = descriptionBodyEl;
    if (!el) return;
    const handler = (event: MouseEvent) => handleDescriptionClick(event);
    el.addEventListener("click", handler);
    return () => {
      el.removeEventListener("click", handler);
    };
  });

  $effect(() => {
    if (unsubscribeMangaProgress) return;
    unsubscribeMangaProgress = msvApi.manga.onDownloaderProgress((queue: any[]) => {
      handleDownloaderProgress(queue);
    });
    void msvApi.manga
      .getDownloadQueue()
      .then((queue) => clearKnownCompletedChaptersFromQueue(queue))
      .catch(() => {});
  });

  $effect(() => {
    if (manga?.id || manga?.mangabaka_id) {
      untrack(() => loadAnilistDetail());
    }
  });

  function toggleDescriptionExpanded() {
    isDescriptionExpanded = !isDescriptionExpanded;
  }

  function setDescriptionBodyEl(next: HTMLParagraphElement | null) {
    descriptionBodyEl = next;
  }

  return {
    setInputs,
    reloadCurrentSeries,
    setDescriptionBodyEl,
    toggleDescriptionExpanded,
    openTrackingEditor,
    handleQuickBookmarkClick,
    confirmQuickBookmarkRemoval,
    cancelQuickBookmarkRemoval,
    closeTrackingEditor,
    setTrackingEditorActiveService,
    setTrackingEditorSyncBothSitesEnabled,
    updateTrackingEditorField,
    saveTrackingEditor,
    removeTrackingEditorEntry,
    handleGlobalKeydown,
    selectSource,
    handleSourceLanguageChange,
    applyManualSourceUrl,
    forgetManualSourceUrl,
    getManualSourceUrl,
    getExpectedHostForGroup,
    handlePageChange,
    toggleChapterSelection,
    selectAll,
    handleDownload,
    resolveSourceId,
    hasSeriesSessionCache,
    hasCachedChaptersForSelectedSource,
    getDisplaySeriesTitle,
    getSeriesTypeLabel,
    getDescriptionHtml,
    getAnilistEntryUrl,
    getMalEntryUrl,
    getMangabakaEntryUrl,
    openFriendProfile,
    getChapterDisplayTitle,
    getChapterPosterLabel,
    isChapterDownloadable,
    isChapterDownloaded,
    getChapterUnavailableReason,
    formatChapterNumber,
    resolveChapterNumberForDownload,
    formatMangaStatus,
    get manga() {
      return manga;
    },
    get onBack() {
      return onBack;
    },
    get onSelectManga() {
      return onSelectManga;
    },
    get detail() {
      return detail;
    },
    get chapters() {
      return chapters;
    },
    get friends() {
      return friends;
    },
    get isTrackingEditorOpen() {
      return trackingEditorState.open;
    },
    get isTrackingEditorSaving() {
      return trackingEditorState.saving;
    },
    get isTrackingEditorRemoving() {
      return trackingEditorState.removing;
    },
    get isTrackingEditorHydrating() {
      return trackingEditorState.hydrating;
    },
    get trackingEditorError() {
      return trackingEditorState.error;
    },
    get trackingEditorServices() {
      return trackingEditorServices;
    },
    get showTrackingEditorSyncBothSitesToggle() {
      return showTrackingEditorSyncBothSitesToggle;
    },
    get trackingEditorSyncBothSitesEnabled() {
      return trackingEditorState.syncBothSitesEnabled;
    },
    get trackingEditorActiveService() {
      return trackingEditorActiveService;
    },
    get hasTargetTrackedEntry() {
      return hasTargetTrackedEntry;
    },
    get hasTargetPlanningEntry() {
      return hasTargetPlanningEntry;
    },
    get hasTargetNonPlanningTrackedEntry() {
      return hasTargetNonPlanningTrackedEntry;
    },
    get isQuickBookmarkLoading() {
      return isQuickBookmarkLoading;
    },
    get isQuickBookmarkRemoveConfirmOpen() {
      return isQuickBookmarkRemoveConfirmOpen;
    },
    get sourceGroups() {
      return sourceGroups;
    },
    get matchedSources() {
      return matchedSources;
    },
    get selectedSourceId() {
      return selectedSourceId;
    },
    get selectedSourceGroupId() {
      return selectedSourceGroupId;
    },
    get scanningByGroup() {
      return scanningByGroup;
    },
    get seriesTitleStyle() {
      return seriesTitleStyle;
    },
    get isLoading() {
      return isLoading;
    },
    get selectedChapters() {
      return selectedChapters;
    },
    get isDescriptionExpanded() {
      return isDescriptionExpanded;
    },
    get currentPage() {
      return currentPage;
    },
    get itemsPerPage() {
      return itemsPerPage;
    },
    get paginatedChapters() {
      return paginatedChapters;
    },
    get totalPages() {
      return totalPages;
    },
    get downloadableChaptersCount() {
      return downloadableChaptersCount;
    },
    get downloadedChaptersCount() {
      return downloadedChaptersCount;
    },
    get selectedActionLabel() {
      return selectedActionLabel;
    },
    get areAllDownloadableChaptersSelected() {
      return areAllDownloadableChaptersSelected;
    },
    get isScanningSources() {
      return isScanningSources;
    },
    get isSelectedSourceTransitioning() {
      return isSelectedSourceTransitioning;
    },
  };
}
