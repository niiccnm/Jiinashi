import {
  formatMangaStatus,
  getReadingFormatLabel,
  normalizeSeriesTitleStyle,
  resolveSeriesTitle,
  type SeriesTitleStyle,
} from "../../../utils/manga";
import type { LibraryItem } from "../../../stores/app";
import {
  buildSeriesMetadataUpdates,
  countChapterItemsBySeries,
  filterScopedChapterItems,
  findAnilistIdByTitle as findAnilistIdByTitleInMetadata,
  getChapterGridClass as getChapterGridClassForSize,
  getDescriptionText,
  getAnilistExternalUrl,
  getFriendProfileUrl,
  getGenresForSeries,
  getItemSeriesId,
  getMangabakaExternalUrl,
  getMalExternalUrl,
  getMostRecentLocalReadChapter,
  getSelectedYearForSeries,
  getTrackingErrorDescriptor,
  mapFriendsReading,
  normalizeScopedIds,
  parseAnilistId,
  parseMalId,
  parsePositiveId,
  resolveContinueTargetChapter,
  sortChapterCardsBySelectedSeries,
  stripHtml,
  truncateText,
  type DetailCacheEntry,
  type MlvGridSize,
  type TrackingServiceId,
  type UserTrackingStatusCard,
} from "./mlv-domain-core";
import { createMlvImageDomain } from "./mlv-domain-image";
import {
  createMlvTrackingDomain,
  mergeSeriesCatalogWithUpdates,
  resolveInitialDetailTrackingContext,
  resolveRefreshTrackingIds,
  resolveTrackingStatusOpenState,
  shouldDiscardDetailCacheEntry,
} from "./mlv-domain-tracking";
import {
  buildProviderSiteLookup,
  resolveOpenSourceProviderSite,
  sourceUrlMatchesProviderSite,
  type ResolvedProviderSite,
} from "./mlv-domain-provider";
import {
  mlvApi,
  mlvDetailCache,
  mlvFailedImageSources,
  mlvImageCache,
  mlvResolvedProviderUrlCache,
  mlvSessionState,
  mlvSourceTotalCache,
  mlvTrackingTotalsCache,
  SERIES_CATALOG_STORAGE_KEY,
} from "./mlv-runtime";
import { toasts } from "../../../stores/toast";
import {
  mlvGetAnilistUrl,
  mlvGetMangabakaUrl,
  mlvGetMalUrl,
  mlvHandleContinueClick,
  mlvHandleTrackingStatusClick,
  mlvLoadSeriesDetail,
  mlvOpenInDownloader,
  mlvOpenSource,
  mlvRefreshSeriesDetail,
  mlvRefreshCurrentTrackingStatus,
  mlvSelectSeries,
  type MlvControllerActionContext,
} from "./mlv-controller-actions";
import { createMlvControllerActionContext } from "./mlv-controller-context";
import {
  createMlvTrackingEditorActions,
  getActiveTrackingEditorForm,
  getTrackingEditorServices,
  type TrackingEditorState,
} from "./mlv-controller-tracking-editor";

export type MlvControllerInputs = {
  seriesIds?: number[];
  chapterItems?: LibraryItem[];
  gridSize?: "small" | "medium" | "large";
  onBack?: (() => void) | null;
};

type MlvViewMode = "grid" | "list";

function createDisplayState(initialViewMode: MlvViewMode = "grid") {
  let viewMode = $state<MlvViewMode>(initialViewMode);

  function toggleViewMode() {
    viewMode = viewMode === "grid" ? "list" : "grid";
  }

  return {
    get viewMode() {
      return viewMode;
    },
    toggleViewMode,
  };
}

export function createMlvController(initialInputs: MlvControllerInputs = {}) {
  function readPersistedSeriesCatalog(): any[] {
    if (typeof localStorage === "undefined") return [];
    try {
      const raw = localStorage.getItem(SERIES_CATALOG_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function persistSeriesCatalog(catalog: any[]) {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(
        SERIES_CATALOG_STORAGE_KEY,
        JSON.stringify(Array.isArray(catalog) ? catalog : []),
      );
    } catch {}
  }

  let seriesIds = $state<number[]>(
    Array.isArray(initialInputs.seriesIds) ? [...initialInputs.seriesIds] : [],
  );
  let chapterItems = $state<LibraryItem[]>(
    Array.isArray(initialInputs.chapterItems)
      ? [...initialInputs.chapterItems]
      : [],
  );
  let gridSize = $state<"small" | "medium" | "large">(
    initialInputs.gridSize || "medium",
  );
  let onBack = $state<(() => void) | null>(
    typeof initialInputs.onBack === "function" ? initialInputs.onBack : null,
  );

  function setInputs(next: MlvControllerInputs = {}) {
    seriesIds = Array.isArray(next.seriesIds) ? [...next.seriesIds] : [];
    chapterItems = Array.isArray(next.chapterItems)
      ? [...next.chapterItems]
      : [];
    gridSize =
      next.gridSize === "small" ||
      next.gridSize === "medium" ||
      next.gridSize === "large"
        ? next.gridSize
        : "medium";
    onBack = typeof next.onBack === "function" ? next.onBack : null;
  }

  const scopedSeriesIds = $derived.by(() => {
    return normalizeScopedIds(seriesIds);
  });
  const scopedSeriesIdSet = $derived(new Set(scopedSeriesIds));
  const scopedSeriesKey = $derived(scopedSeriesIds.join(","));

  let isLoading = $state(true);
  let isRefreshing = $state(false);
  const displayController = createDisplayState("grid");
  let viewMode = $derived(displayController.viewMode);
  let selectedSeriesId = $state<number | null>(null);
  const initialSeriesCatalog = (
    Array.isArray(mlvSessionState.seriesCatalogCache) &&
    mlvSessionState.seriesCatalogCache.length > 0
      ? mlvSessionState.seriesCatalogCache
      : readPersistedSeriesCatalog()
  ) as any[];
  let seriesCatalog = $state<any[]>(
    Array.isArray(initialSeriesCatalog) ? [...initialSeriesCatalog] : [],
  );
  const series = $derived.by(() => {
    const fullSeries = Array.isArray(seriesCatalog) ? seriesCatalog : [];
    if (scopedSeriesIdSet.size === 0) return [];
    return fullSeries.filter((item) =>
      scopedSeriesIdSet.has(Number(item?.id || 0)),
    );
  });
  const activeSelectedSeriesId = $derived.by(() => {
    const selectedId = Number(selectedSeriesId || 0);
    const hasSelected =
      selectedId > 0 &&
      series.some((entry) => Number(entry?.id || 0) === selectedId);
    if (hasSelected) return selectedId;
    const fallbackId = Number(series[0]?.id || 0);
    return fallbackId > 0 ? fallbackId : null;
  });
  let selectedSeries = $derived(
    series.find((item) => Number(item?.id || 0) === activeSelectedSeriesId) ||
      null,
  );

  let detailLoading = $state(false);
  let detail = $state<any | null>(null);
  let detailSeriesId = $state<number | null>(null);
  let friends = $state<any[]>([]);
  let trackedAnilistId = $state<number | null>(null);
  let trackedMalId = $state<number | null>(null);
  let activeTrackingServices = $state<TrackingServiceId[]>([]);
  let userTrackingStatuses = $state<UserTrackingStatusCard[]>([]);
  let trackingStatusVisibleBySeries = $state<Record<number, boolean>>({});
  let isTrackingStatusLoading = $state(false);
  let trackingStatusError = $state("");
  let isContinueResolving = $state(false);
  let isOpenInDownloaderResolving = $state(false);
  let isDescriptionExpanded = $state(false);
  let detailRequestId = 0;
  let activeDetailSeriesId = $state<number | null>(null);
  let seriesTitleStyle = $state<SeriesTitleStyle>("romaji");
  const MAX_DETAIL_CACHE_ENTRIES = 120;
  let detailFetchAttemptsBySeries = $state<Record<number, boolean>>({});
  let trackingStatusRevisionBySeries = $state<Record<number, number>>({});
  let failedImageSourceVersion = $state(0);
  const detailCache = mlvDetailCache as Map<number, DetailCacheEntry>;
  const trackingTotalsCache = mlvTrackingTotalsCache as Map<string, number>;
  const sourceTotalCache = mlvSourceTotalCache as Map<number, number>;
  const imageDomain = createMlvImageDomain({
    imageCache: mlvImageCache,
    failedImageSources: mlvFailedImageSources,
    maxImageCacheEntries: 800,
    getFailedImageSourceVersion: () => failedImageSourceVersion,
    onFailedImageSourcesChanged: () => {
      failedImageSourceVersion += 1;
    },
    getActiveSelectedSeriesId: () => activeSelectedSeriesId,
    getDetailSeriesId: () => detailSeriesId,
    getDetail: () => detail,
    getActiveDetailSeriesId: () => activeDetailSeriesId,
  });
  const {
    getSeriesCoverCacheKey,
    getSeriesBannerCacheKey,
    getChapterCoverCacheKey,
    cacheImageFromEvent,
    handleSelectedCoverLoad,
    getSeriesCoverSrc,
    getSeriesBannerSrc,
    getChapterCoverSrc,
    handleCoverError,
    handleBannerError,
  } = imageDomain;
  const trackingDomain = createMlvTrackingDomain({
    trackingTotalsCache,
    sourceTotalCache,
    getChapters: (sourceId: string, sourceUrl: string) =>
      mlvApi.getChapters(sourceId, sourceUrl),
  });
  const {
    getActiveTrackingServices,
    mergeTrackingEntries,
    buildUserTrackingStatusCards,
    hasUnknownTrackingTotal,
    buildTrackingCards,
    filterTrackingCardsForDisplay,
    formatTrackingListStatus,
    formatTrackingChapterProgress,
  } = trackingDomain;
  const providerSiteLookup = new Map<string, ResolvedProviderSite>();
  let providerSiteLookupVersion = $state(0);
  let providerSiteLookupRequested = $state(false);

  function setDetailCache(seriesId: number, value: DetailCacheEntry) {
    if (!seriesId) return;
    if (detailCache.has(seriesId)) {
      detailCache.delete(seriesId);
    }
    detailCache.set(seriesId, value);
    while (detailCache.size > MAX_DETAIL_CACHE_ENTRIES) {
      const oldest = detailCache.keys().next().value;
      if (oldest === undefined) break;
      detailCache.delete(oldest);
    }
  }

  function markDetailFetchAttempt(seriesId: number) {
    if (!seriesId) return;
    if (detailFetchAttemptsBySeries[seriesId]) return;
    detailFetchAttemptsBySeries = {
      ...detailFetchAttemptsBySeries,
      [seriesId]: true,
    };
  }

  function getTrackingStatusRevision(seriesId: number) {
    const id = Number(seriesId || 0);
    if (!Number.isFinite(id) || id <= 0) return 0;
    return Number(trackingStatusRevisionBySeries[id] || 0);
  }

  function bumpTrackingStatusRevision(seriesId: number) {
    const id = Number(seriesId || 0);
    if (!Number.isFinite(id) || id <= 0) return 0;
    const next = getTrackingStatusRevision(id) + 1;
    trackingStatusRevisionBySeries = {
      ...trackingStatusRevisionBySeries,
      [id]: next,
    };
    return next;
  }

  function setTrackingStatusVisible(seriesId: number, visible: boolean) {
    const id = Number(seriesId || 0);
    if (!Number.isFinite(id) || id <= 0) return;
    trackingStatusVisibleBySeries = {
      ...trackingStatusVisibleBySeries,
      [id]: Boolean(visible),
    };
  }

  function resetSeriesDetailState(includeDetailLoading = false) {
    detail = null;
    detailSeriesId = null;
    friends = [];
    trackedAnilistId = null;
    trackedMalId = null;
    activeTrackingServices = [];
    userTrackingStatuses = [];
    isTrackingStatusLoading = false;
    trackingStatusError = "";
    if (includeDetailLoading) {
      detailLoading = false;
    }
  }

  function applyCachedSeriesDetailState(
    seriesId: number,
    cached: DetailCacheEntry,
    fallbackIds: { anilistId: number | null; malId: number | null },
  ) {
    detail = cached.detail;
    detailSeriesId = seriesId;
    friends = [...cached.friends];
    trackedAnilistId = cached.trackedAnilistId || fallbackIds.anilistId || null;
    trackedMalId = cached.trackedMalId || fallbackIds.malId || null;
    activeTrackingServices = Array.isArray(cached.activeTrackingServices)
      ? [...cached.activeTrackingServices]
      : [];
    userTrackingStatuses = Array.isArray(cached.userTrackingStatuses)
      ? [...cached.userTrackingStatuses]
      : [];
    trackingStatusError = "";
    isTrackingStatusLoading = false;
  }

  function getSeriesTitle(item: any) {
    return resolveSeriesTitle(item, seriesTitleStyle, "Unknown Series");
  }

  function getSecondarySeriesTitle(item: any) {
    const primaryTitle = getSeriesTitle(item);
    const candidates = [
      String(item?.title_original || "").trim(),
      String(item?.title_romaji || "").trim(),
      String(item?.title_english || "").trim(),
    ];

    for (const candidate of candidates) {
      if (candidate && candidate !== primaryTitle) return candidate;
    }
    return "";
  }

  async function refreshSeriesTitleStyle() {
    try {
      const rawStyle = await mlvApi.getSeriesTitleStyle();
      seriesTitleStyle = normalizeSeriesTitleStyle(rawStyle);
    } catch (error) {
      console.warn("Failed to load series title style setting:", error);
      seriesTitleStyle = "romaji";
    }
  }

  async function refreshProviderSiteLookup() {
    try {
      const extensions = await mlvApi.getExtensions();
      const nextLookup = buildProviderSiteLookup(extensions);
      providerSiteLookup.clear();
      for (const [key, value] of nextLookup.entries()) {
        providerSiteLookup.set(key, value);
      }
    } catch (error) {
      console.warn("Failed to load provider site lookup:", error);
      providerSiteLookup.clear();
    } finally {
      providerSiteLookupVersion += 1;
    }
  }

  async function findAnilistIdByTitle(item: any) {
    return findAnilistIdByTitleInMetadata(item, (query, page) =>
      mlvApi.anilistSearch(query, page),
    );
  }

  function getDescription(item: any, allowSelectedDetail = true) {
    return getDescriptionText(
      item,
      {
        activeSelectedSeriesId: Number(activeSelectedSeriesId || 0),
        detailSeriesId: Number(detailSeriesId || 0),
        detail,
      },
      allowSelectedDetail,
    );
  }

  function getGenres(item: any) {
    return getGenresForSeries(item, {
      activeSelectedSeriesId: Number(activeSelectedSeriesId || 0),
      detailSeriesId: Number(detailSeriesId || 0),
      detail,
    });
  }

  function getSelectedYear(item: any): number | null {
    return getSelectedYearForSeries(item, {
      activeSelectedSeriesId: Number(activeSelectedSeriesId || 0),
      detailSeriesId: Number(detailSeriesId || 0),
      detail,
    });
  }

  const actionContext: MlvControllerActionContext =
    createMlvControllerActionContext({
      accessors: {
        detailLoading: [
          () => detailLoading,
          (value) => (detailLoading = value),
        ],
        detail: [() => detail, (value) => (detail = value)],
        detailSeriesId: [
          () => detailSeriesId,
          (value) => (detailSeriesId = value),
        ],
        friends: [() => friends, (value) => (friends = value)],
        trackedAnilistId: [
          () => trackedAnilistId,
          (value) => (trackedAnilistId = value),
        ],
        trackedMalId: [() => trackedMalId, (value) => (trackedMalId = value)],
        activeTrackingServices: [
          () => activeTrackingServices,
          (value) => (activeTrackingServices = value),
        ],
        userTrackingStatuses: [
          () => userTrackingStatuses,
          (value) => (userTrackingStatuses = value),
        ],
        isTrackingStatusLoading: [
          () => isTrackingStatusLoading,
          (value) => (isTrackingStatusLoading = value),
        ],
        trackingStatusError: [
          () => trackingStatusError,
          (value) => (trackingStatusError = value),
        ],
        isDescriptionExpanded: [
          () => isDescriptionExpanded,
          (value) => (isDescriptionExpanded = value),
        ],
        isContinueResolving: [
          () => isContinueResolving,
          (value) => (isContinueResolving = value),
        ],
        detailRequestId: [
          () => detailRequestId,
          (value) => (detailRequestId = value),
        ],
        activeDetailSeriesId: [
          () => activeDetailSeriesId,
          (value) => (activeDetailSeriesId = value),
        ],
        seriesCatalog: [
          () => seriesCatalog,
          (value) => (seriesCatalog = value),
        ],
        selectedSeriesId: [
          () => selectedSeriesId,
          (value) => (selectedSeriesId = value),
        ],
        trackingStatusVisibleBySeries: [
          () => trackingStatusVisibleBySeries,
          (value) => (trackingStatusVisibleBySeries = value),
        ],
        activeSelectedSeriesId: [() => activeSelectedSeriesId],
        selectedSeries: [() => selectedSeries],
        series: [() => series],
      },
      deps: {
        api: mlvApi,
        sessionState: mlvSessionState,
        detailCache,
        toasts,
        resetSeriesDetailState,
        applyCachedSeriesDetailState,
        setDetailCache,
        markDetailFetchAttempt,
        getTrackingStatusRevision,
        bumpTrackingStatusRevision,
        findAnilistIdByTitle,
        parsePositiveId,
        parseAnilistId,
        persistSeriesCatalog,
        getActiveTrackingServices,
        filterTrackingCardsForDisplay,
        buildUserTrackingStatusCards,
        mergeTrackingEntries,
        buildTrackingCards,
        getTrackingErrorDescriptor,
        shouldDiscardDetailCacheEntry,
        resolveInitialDetailTrackingContext,
        buildSeriesMetadataUpdates,
        mergeSeriesCatalogWithUpdates,
        mapFriendsReading,
        resolveRefreshTrackingIds,
        resolveTrackingStatusOpenState,
        hasUnknownTrackingTotal,
        getMostRecentLocalReadChapter,
        resolveContinueTargetChapter,
        getAnilistExternalUrl,
        getMalExternalUrl,
        getMangabakaExternalUrl,
        providerSiteLookup,
        resolvedProviderUrlCache: mlvResolvedProviderUrlCache,
        getSeriesDisplayTitle: getSeriesTitle,
        setTrackingStatusVisible,
      },
    });

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

  function resolveTrackingServices(
    rawTrackingAccounts: any[],
  ): TrackingServiceId[] {
    return getActiveTrackingServices(rawTrackingAccounts).filter(
      (service): service is TrackingServiceId =>
        service === "anilist" || service === "mal",
    );
  }

  const trackingEditorActions = createMlvTrackingEditorActions({
    state: trackingEditorState,
    api: {
      getTrackingAccounts: () => mlvApi.getTrackingAccounts(),
      getSyncBothSitesSetting: () =>
        mlvApi.getTrackingEditorSyncBothSitesSetting(),
      setSyncBothSitesSetting: (enabled: boolean) =>
        mlvApi.setTrackingEditorSyncBothSitesSetting(enabled),
      updateTrackingEntry: (payload) => mlvApi.updateTrackingEntry(payload),
      removeTrackingEntry: (payload) => mlvApi.removeTrackingEntry(payload),
    },
    toasts,
    formatTrackingListStatus,
    getSelectedSeries: () => selectedSeries,
    getActiveSelectedSeriesId: () => activeSelectedSeriesId,
    getTrackedAnilistId: () => trackedAnilistId,
    getTrackedMalId: () => trackedMalId,
    getActiveTrackingServices: () =>
      (Array.isArray(activeTrackingServices)
        ? activeTrackingServices
        : []
      ).filter(
        (service): service is TrackingServiceId =>
          service === "anilist" || service === "mal",
      ),
    setActiveTrackingServices: (services) => {
      activeTrackingServices = [...services];
    },
    getUserTrackingStatuses: () => userTrackingStatuses,
    refreshCurrentTrackingStatus: (seriesItem?: any) =>
      refreshCurrentTrackingStatus(seriesItem),
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

  async function loadLibrarySeries(initial = false, forceFetch = false) {
    if (initial) isLoading = true;
    else isRefreshing = true;
    try {
      await Promise.all([
        refreshSeriesTitleStyle(),
        refreshProviderSiteLookup(),
      ]);
      let catalog = Array.isArray(seriesCatalog) ? seriesCatalog : [];

      if (forceFetch || catalog.length === 0) {
        const allSeries = await mlvApi.getAllSeries();
        catalog = Array.isArray(allSeries) ? allSeries : [];
        seriesCatalog = catalog;
        mlvSessionState.seriesCatalogCache = [...catalog];
        persistSeriesCatalog(catalog);
      }
    } catch (e) {
      console.error("Failed to load manga series:", e);
      toasts.add("Failed to load manga library", "error");
    } finally {
      isLoading = false;
      isRefreshing = false;
    }
  }

  function openFriendProfile(friend: any) {
    const profile = getFriendProfileUrl(friend);
    if (!profile) return;
    mlvApi.openExternal(profile);
  }

  async function loadSeriesDetail(
    seriesItem: any,
    options: { force?: boolean; background?: boolean } = {},
  ) {
    await mlvLoadSeriesDetail(actionContext, seriesItem, options);
  }

  function toggleViewMode() {
    displayController.toggleViewMode();
  }

  function handleBackClick() {
    if (typeof onBack === "function") {
      onBack();
    }
  }

  function selectSeries(seriesItem: any) {
    mlvSelectSeries(actionContext, seriesItem);
  }

  function refreshSeriesDetail(seriesItem: any) {
    void mlvRefreshSeriesDetail(actionContext, seriesItem, loadSeriesDetail);
  }

  async function refreshCurrentTrackingStatus(seriesItem?: any) {
    await mlvRefreshCurrentTrackingStatus(actionContext, seriesItem);
  }

  async function handleTrackingStatusClick(seriesItem?: any) {
    await mlvHandleTrackingStatusClick(
      actionContext,
      seriesItem,
      refreshCurrentTrackingStatus,
    );
  }

  function openTrackingEditor() {
    void trackingEditorActions.openTrackingEditor();
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

  function openChapter(item: any) {
    const itemId = Number(item?.id || 0);
    if (!itemId) return;
    mlvApi.openReader(itemId, Number(activeSelectedSeriesId || 0) || null);
  }

  async function handleContinueClick(chapterCardsOverride?: any[]) {
    const continueCards = Array.isArray(chapterCardsOverride)
      ? chapterCardsOverride
      : chapterCards;
    await mlvHandleContinueClick(
      actionContext,
      continueCards,
      refreshCurrentTrackingStatus,
      openChapter,
    );
  }

  function openSource(seriesItem: any, providerHint?: string) {
    return mlvOpenSource(actionContext, seriesItem, providerHint);
  }

  function canOpenSource(seriesItem?: any, providerHint?: string) {
    providerSiteLookupVersion;

    const targetSeries = seriesItem || selectedSeries;
    if (!targetSeries) return false;

    const sourceUrl = String(targetSeries?.source_url || "").trim();
    const normalizedProviderHint = String(providerHint || "").trim();
    if (!normalizedProviderHint) {
      if (sourceUrl.length > 0) return true;
    }

    const providerSite = resolveOpenSourceProviderSite(
      targetSeries,
      normalizedProviderHint,
      providerSiteLookup,
    );
    if (!providerSite) return false;
    if (sourceUrlMatchesProviderSite(sourceUrl, providerSite)) return true;

    const preferredSourceId = String(providerSite.preferredSourceId || "").trim();
    return (
      preferredSourceId.length > 0 ||
      (Array.isArray(providerSite.sourceIds) && providerSite.sourceIds.length > 0)
    );
  }

  async function openInDownloader(seriesItem?: any) {
    if (isOpenInDownloaderResolving) return;
    isOpenInDownloaderResolving = true;
    try {
      await mlvOpenInDownloader(actionContext, seriesItem, getSeriesTitle);
    } finally {
      isOpenInDownloaderResolving = false;
    }
  }

  function getAnilistUrl(seriesItem?: any) {
    return mlvGetAnilistUrl(actionContext, seriesItem, getSeriesTitle);
  }

  function openAnilist(seriesItem?: any) {
    mlvApi.openExternal(getAnilistUrl(seriesItem));
  }

  function getMalUrl(seriesItem?: any) {
    return mlvGetMalUrl(actionContext, seriesItem, getSeriesTitle);
  }

  function openMal(seriesItem?: any) {
    mlvApi.openExternal(getMalUrl(seriesItem));
  }

  function getMangabakaUrl(seriesItem?: any) {
    return mlvGetMangabakaUrl(actionContext, seriesItem, getSeriesTitle);
  }

  function openMangabaka(seriesItem?: any) {
    mlvApi.openExternal(getMangabakaUrl(seriesItem));
  }

  const scopedChapterItems = $derived.by(() => {
    return filterScopedChapterItems(chapterItems, scopedSeriesIdSet);
  });

  const chapterCountInViewBySeries = $derived.by(() => {
    return countChapterItemsBySeries(scopedChapterItems);
  });

  const chapterCards = $derived.by(() => {
    return sortChapterCardsBySelectedSeries(
      scopedChapterItems,
      Number(activeSelectedSeriesId || 0),
    );
  });

  function getChapterCountInView(seriesId: number) {
    return Number(chapterCountInViewBySeries[seriesId] || 0);
  }

  function getChapterGridClass(): string {
    return getChapterGridClassForSize(gridSize as MlvGridSize);
  }

  const selectedDescriptionText = $derived(
    selectedSeries ? stripHtml(getDescription(selectedSeries)) : "",
  );
  const selectedGenres = $derived(
    selectedSeries ? getGenres(selectedSeries) : [],
  );
  const selectedReadingFormatLabel = $derived(
    selectedSeries ? getReadingFormatLabel(selectedSeries.reading_format) : null,
  );
  const selectedYear = $derived(
    selectedSeries ? getSelectedYear(selectedSeries) : null,
  );
  const selectedBannerSrc = $derived(
    selectedSeries ? getSeriesBannerSrc(selectedSeries) : "",
  );
  const selectedCoverSrc = $derived(
    selectedSeries ? getSeriesCoverSrc(selectedSeries) : "",
  );
  const selectedHasMetadata = $derived.by(() => {
    if (!selectedSeries) return false;
    const hasCover = Boolean(selectedCoverSrc);
    const hasDescription = selectedDescriptionText.length > 0;
    const hasGenres = selectedGenres.length > 0;
    const selectedId = Number(activeSelectedSeriesId || 0);
    const selectedDetail =
      selectedId > 0 && detailSeriesId === selectedId ? detail : null;
    const hasAniList = Boolean(Number(selectedDetail?.id || 0));
    return hasCover || hasDescription || hasGenres || hasAniList;
  });
  const selectedIsDetailLoading = $derived.by(() => {
    const selectedId = Number(activeSelectedSeriesId || 0);
    return selectedId > 0 && Number(activeDetailSeriesId || 0) === selectedId;
  });
  const selectedShouldShowUnavailable = $derived.by(() => {
    const selectedId = Number(activeSelectedSeriesId || 0);
    if (!selectedId) return false;
    if (selectedHasMetadata) return false;
    if (selectedIsDetailLoading) return false;
    return Boolean(detailFetchAttemptsBySeries[selectedId]);
  });
  const visibleUserTrackingStatuses = $derived.by(() => {
    if (userTrackingStatuses.length > 0) {
      return filterTrackingCardsForDisplay(userTrackingStatuses);
    }
    const selectedId = Number(activeSelectedSeriesId || 0);
    if (!selectedId) return [] as UserTrackingStatusCard[];
    const cached = detailCache.get(selectedId);
    return Array.isArray(cached?.userTrackingStatuses)
      ? filterTrackingCardsForDisplay(cached.userTrackingStatuses)
      : ([] as UserTrackingStatusCard[]);
  });
  const selectedTrackingStatusVisible = $derived.by(() => {
    const id = Number(activeSelectedSeriesId || 0);
    if (!id) return false;
    return Boolean(trackingStatusVisibleBySeries[id]);
  });
  let lastForcedCatalogRefreshScope = $state("");

  $effect(() => {
    if (providerSiteLookupVersion === 0 && !providerSiteLookupRequested) {
      providerSiteLookupRequested = true;
      void refreshProviderSiteLookup().finally(() => {
        providerSiteLookupRequested = false;
      });
    }
  });

  $effect(() => {
    const scopeKey = scopedSeriesKey;
    const hasCatalog = seriesCatalog.length > 0;
    const knownSeriesIds = new Set(
      seriesCatalog
        .map((entry) => Number(entry?.id || 0))
        .filter((id) => Number.isFinite(id) && id > 0),
    );
    const hasScopedMismatch =
      scopedSeriesIds.length > 0 &&
      hasCatalog &&
      scopedSeriesIds.some((id) => !knownSeriesIds.has(id));

    if (hasCatalog && !hasScopedMismatch) {
      lastForcedCatalogRefreshScope = "";
      isLoading = false;
      void refreshSeriesTitleStyle();
      return;
    }

    if (hasScopedMismatch) {
      if (lastForcedCatalogRefreshScope === scopeKey) {
        isLoading = false;
        return;
      }
      lastForcedCatalogRefreshScope = scopeKey;
    }

    void loadLibrarySeries(true, true);
  });

  $effect(() => {
    const selectedId = Number(selectedSeriesId || 0);
    const hasSelected =
      selectedId > 0 &&
      series.some((entry) => Number(entry?.id || 0) === selectedId);
    if (hasSelected) return;
    const firstSeries = series[0];
    if (!firstSeries) {
      selectedSeriesId = null;
      return;
    }
    selectSeries(firstSeries);
  });

  $effect(() => {
    const seriesId = Number(activeSelectedSeriesId || 0);
    if (!seriesId) {
      resetSeriesDetailState(true);
      return;
    }

    const seriesItem = series.find(
      (item) => Number(item?.id || 0) === seriesId,
    );
    if (!seriesItem) return;

    const seriesAnilistId = Number(seriesItem?.anilist_id || 0);
    const seriesMalId = Number(seriesItem?.mal_id || 0);
    trackedAnilistId =
      (Number.isFinite(seriesAnilistId) && seriesAnilistId > 0
        ? seriesAnilistId
        : parseAnilistId(seriesItem)) || null;
    trackedMalId =
      Number.isFinite(seriesMalId) && seriesMalId > 0 ? seriesMalId : null;

    const cached = detailCache.get(seriesId);
    if (cached) {
      applyCachedSeriesDetailState(seriesId, cached, {
        anilistId: trackedAnilistId || seriesAnilistId || null,
        malId: trackedMalId || seriesMalId || null,
      });
    } else {
      const isLoadingCurrentSeries =
        Number(activeDetailSeriesId || 0) === seriesId;
      if (!isLoadingCurrentSeries) {
        void loadSeriesDetail(seriesItem, { background: true });
      }
    }

    detailLoading = false;
  });

  function toggleDescriptionExpanded() {
    isDescriptionExpanded = !isDescriptionExpanded;
  }

  return {
    setInputs,
    get onBack() {
      return onBack;
    },
    get series() {
      return series;
    },
    get isLoading() {
      return isLoading;
    },
    get isRefreshing() {
      return isRefreshing;
    },
    get viewMode() {
      return viewMode;
    },
    get selectedSeries() {
      return selectedSeries;
    },
    get selectedShouldShowUnavailable() {
      return selectedShouldShowUnavailable;
    },
    get friends() {
      return friends;
    },
    get selectedIsDetailLoading() {
      return selectedIsDetailLoading;
    },
    get selectedBannerSrc() {
      return selectedBannerSrc;
    },
    get selectedCoverSrc() {
      return selectedCoverSrc;
    },
    get selectedYear() {
      return selectedYear;
    },
    get selectedTrackingStatusVisible() {
      return selectedTrackingStatusVisible;
    },
    get visibleUserTrackingStatuses() {
      return visibleUserTrackingStatuses;
    },
    get trackingStatusError() {
      return trackingStatusError;
    },
    get chapterCards() {
      return chapterCards;
    },
    get isContinueResolving() {
      return isContinueResolving;
    },
    get isOpenInDownloaderResolving() {
      return isOpenInDownloaderResolving;
    },
    get isTrackingStatusLoading() {
      return isTrackingStatusLoading;
    },
    get selectedDescriptionText() {
      return selectedDescriptionText;
    },
    get isDescriptionExpanded() {
      return isDescriptionExpanded;
    },
    get selectedGenres() {
      return selectedGenres;
    },
    get selectedReadingFormatLabel() {
      return selectedReadingFormatLabel;
    },
    get activeSelectedSeriesId() {
      return activeSelectedSeriesId;
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
    loadLibrarySeries,
    toggleViewMode,
    handleBackClick,
    refreshSeriesDetail,
    handleTrackingStatusClick,
    openSource,
    canOpenSource,
    openInDownloader,
    openAnilist,
    openMal,
    openMangabaka,
    openFriendProfile,
    cacheImageFromEvent,
    getSeriesBannerCacheKey,
    getSeriesTitle,
    handleBannerError,
    getSeriesCoverCacheKey,
    handleSelectedCoverLoad,
    handleCoverError,
    getSecondarySeriesTitle,
    formatTrackingListStatus,
    formatTrackingChapterProgress,
    handleContinueClick,
    openTrackingEditor,
    closeTrackingEditor,
    setTrackingEditorActiveService,
    setTrackingEditorSyncBothSitesEnabled,
    updateTrackingEditorField,
    saveTrackingEditor,
    removeTrackingEditorEntry,
    truncateText,
    selectSeries,
    getChapterCountInView,
    getChapterGridClass,
    getChapterCoverCacheKey,
    getChapterCoverSrc,
    openChapter,
    formatMangaStatus,
    toggleDescriptionExpanded,
  };
}
