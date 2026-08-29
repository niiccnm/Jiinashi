import { invoke, on } from "./bridge-helpers";
import type { ElectronAPI } from "./types";

export function createMangaBridge(): ElectronAPI["manga"] {
  const call = (channel: string, ...args: unknown[]) =>
    invoke(channel, ...args);
  const subscribe = <TPayload>(
    channel: string,
    callback: (payload: TPayload) => void,
  ) => on<[TPayload]>(channel, callback);

  return {
    // Core source browsing
    getExtensions: () => call("manga:get-extensions"),
    getExtensionRepositories: () => call("manga:get-extension-repositories"),
    importExtensionRepository: (url: string) =>
      call("manga:import-extension-repository", url),
    removeExtension: (id: string) => call("manga:remove-extension", id),
    toggleExtension: (id: string, enabled: boolean) =>
      call("manga:toggle-extension", id, enabled),
    toggleExtensionSite: (
      extensionId: string,
      siteId: string,
      enabled: boolean,
    ) => call("manga:toggle-extension-site", extensionId, siteId, enabled),
    getEnabledSources: () => call("manga:get-enabled-sources"),
    getSourceCatalog: () => call("manga:get-source-catalog"),
    getPopular: (sourceId: string, page: number) =>
      call("manga:get-popular", sourceId, page),
    getLatest: (sourceId: string, page: number) =>
      call("manga:get-latest", sourceId, page),
    search: (
      sourceId: string,
      query: string,
      page: number,
      contextId?: string,
    ) => call("manga:search", sourceId, query, page, contextId),
    cancelSearchContext: (contextId: string) =>
      call("manga:cancel-search-context", contextId),
    getDetail: (sourceId: string, urlOrId: string | number) =>
      call("manga:get-detail", sourceId, urlOrId),

    // Chapters and downloads
    getChapters: (
      sourceIdOrSeriesId: string | number,
      mangaId?: string,
      contextId?: string,
    ) => call("manga:get-chapters", sourceIdOrSeriesId, mangaId, contextId),
    getChapterLocalStates: (sourceUrls: string[]) =>
      call("manga:get-chapter-local-states", sourceUrls),
    downloadChapter: (series, chapter) =>
      call("manga:download-chapter", series, chapter),
    getDownloadQueue: () => call("manga:get-download-queue"),
    getDownloadLogs: (id: number) => call("manga:get-download-logs", id),
    cancelDownload: (id: number) => call("manga:cancel-download", id),
    retryDownload: (id: number) => call("manga:retry-download", id),
    clearFinished: () => call("manga:clear-finished"),
    cancelAll: () => call("manga:cancel-all"),
    removeFromQueue: (id: number) => call("manga:remove-from-queue", id),
    getSeries: (id: number) => call("manga:get-series", id),
    updateSeries: (id: number, updates) =>
      call("manga:update-series", id, updates),
    getAllSeries: () => call("manga:get-all-series"),
    getChapterCount: (seriesId: number) =>
      call("manga:get-chapter-count", seriesId),
    getLibrarySeries: () => call("manga:get-library-series"),
    ensureLocalSeriesForTracking: (payload) =>
      call("manga:ensure-local-series-for-tracking", payload),
    onDownloaderProgress: (callback) =>
      subscribe("manga:downloader-progress", callback),

    // Legacy compatibility
    onMangaDetected: (callback) =>
      subscribe("library:manga-detected", callback),
    setAsManga: (itemId: number, mangaData) =>
      call("manga:set-as-manga", itemId, mangaData),
    scanForManga: (itemId: number, query: string) =>
      call("manga:scan-for-manga", itemId, query),
    searchMangaMatch: (query: string) => call("manga:search-match", query),

    // Tracking
    getTrackingAccounts: () => call("manga:get-tracking-accounts"),
    getTrackingEntries: (seriesId: number) =>
      call("manga:get-tracking-entries", seriesId),
    updateTrackingProgress: (
      seriesId: number,
      chaptersRead: number,
      score?: number,
      status?: string,
    ) =>
      call(
        "manga:update-tracking-progress",
        seriesId,
        chaptersRead,
        score,
        status,
      ),
    updateTrackingEntry: (payload: {
      seriesId: number;
      service: "mal" | "anilist";
      remoteId?: number | string | null;
      chaptersRead: number;
      volumesRead?: number;
      score?: number | null;
      status?: string;
      totalChapters?: number | null;
      totalVolumes?: number | null;
    }) => call("manga:update-tracking-entry", payload),
    removeTrackingEntry: (payload: {
      seriesId: number;
      service: "mal" | "anilist";
      remoteId?: number | string | null;
    }) => call("manga:remove-tracking-entry", payload),
    loginTracking: (service: "mal" | "anilist") =>
      call("manga:login-tracking", service),
    disconnectTracking: (service: "mal" | "anilist") =>
      call("manga:disconnect-tracking", service),
    getTrackingCustomClientId: (service: "mal" | "anilist") =>
      call("manga:get-tracking-custom-client-id", service),
    setTrackingCustomClientId: (
      service: "mal" | "anilist",
      clientId: string,
    ) => call("manga:set-tracking-custom-client-id", service, clientId),
    resetTrackingCustomClientId: (service: "mal" | "anilist") =>
      call("manga:reset-tracking-custom-client-id", service),
    getFriendsReading: (anilistId?: number, malId?: number) =>
      call("manga:get-friends-reading", anilistId, malId),
    getUserTrackingStatus: (
      seriesId: number,
      anilistId?: number,
      malId?: number,
    ) => call("manga:get-user-tracking-status", seriesId, anilistId, malId),
    getMangaDexTotalChapters: (seriesId: number) =>
      call("manga:get-mangadex-total-chapters", seriesId),

    // AniList
    anilistSearch: (query: string, page: number) =>
      call("manga:anilist-search", query, page),
    mangabakaSearch: (query: string, page: number, limit?: number) =>
      call("manga:mangabaka-search", query, page, limit),
    anilistTrending: (page: number) => call("manga:anilist-trending", page),
    anilistPopular: (page: number) => call("manga:anilist-popular", page),
    anilistDetails: (id: number) => call("manga:anilist-details", id),
    mangabakaDetails: (id: number) => call("manga:mangabaka-details", id),
    searchMalIdByTitle: (anilistId: number) =>
      call("manga:search-mal-id-by-title", anilistId),
    anilistRecommendations: (id: number, page: number, perPage: number) =>
      call("manga:anilist-recommendations", id, page, perPage),
    getIncognito: () => call("manga:get-incognito"),
    setIncognito: (value: boolean) => call("manga:set-incognito", value),
  };
}
