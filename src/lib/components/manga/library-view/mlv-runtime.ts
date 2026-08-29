import { openDownloaderToMangaSeries as navigateToDownloaderMangaSeries } from "../../../stores/app";

export const SERIES_CATALOG_STORAGE_KEY = "mangaSeriesCatalogCacheV1";
export const TRACKING_EDITOR_SYNC_BOTH_SITES_SETTING_KEY =
  "trackingEditorSyncBothSites";

export const mlvImageCache = new Map<string, string>();
export const mlvFailedImageSources = new Set<string>();
export const mlvDetailCache = new Map<number, any>();
export const mlvTrackingTotalsCache = new Map<string, number>();
export const mlvSourceTotalCache = new Map<number, number>();
export const mlvResolvedProviderUrlCache = new Map<string, string>();

export const mlvSessionState: {
  seriesCatalogCache: any[] | null;
} = {
  seriesCatalogCache: null,
};

export const mlvApi = {
  getSeriesTitleStyle() {
    return window.electronAPI.settings.get("seriesTitleStyle");
  },
  getTrackingEditorSyncBothSitesSetting() {
    return window.electronAPI.settings.get(
      TRACKING_EDITOR_SYNC_BOTH_SITES_SETTING_KEY,
    );
  },
  setTrackingEditorSyncBothSitesSetting(enabled: boolean) {
    return window.electronAPI.settings.set(
      TRACKING_EDITOR_SYNC_BOTH_SITES_SETTING_KEY,
      enabled ? "true" : "false",
    );
  },
  anilistSearch(query: string, page = 1) {
    return window.electronAPI.manga.anilistSearch(query, page);
  },
  getExtensions() {
    return window.electronAPI.manga.getExtensions();
  },
  searchSource(sourceId: string, query: string, page = 1) {
    return window.electronAPI.manga.search(sourceId, query, page);
  },
  getChapters(sourceId: string, sourceUrl: string) {
    return window.electronAPI.manga.getChapters(sourceId, sourceUrl);
  },
  getSeriesChapters(seriesId: number) {
    return window.electronAPI.manga.getChapters(seriesId);
  },
  getAllSeries() {
    return window.electronAPI.manga.getAllSeries();
  },
  getTrackingAccounts() {
    return window.electronAPI.manga.getTrackingAccounts();
  },
  getTrackingEntries(seriesId: number) {
    return window.electronAPI.manga.getTrackingEntries(seriesId);
  },
  updateTrackingEntry(payload: {
    seriesId: number;
    service: "anilist" | "mal";
    remoteId: number;
    chaptersRead: number;
    volumesRead?: number;
    score: number | null;
    status: string;
    totalChapters: number | null;
    totalVolumes?: number | null;
  }) {
    return window.electronAPI.manga.updateTrackingEntry(payload);
  },
  removeTrackingEntry(payload: {
    seriesId: number;
    service: "anilist" | "mal";
    remoteId: number;
  }) {
    return window.electronAPI.manga.removeTrackingEntry(payload);
  },
  anilistDetails(anilistId: number) {
    return window.electronAPI.manga.anilistDetails(anilistId);
  },
  searchMalIdByTitle(anilistId: number) {
    return window.electronAPI.manga.searchMalIdByTitle(anilistId);
  },
  updateSeries(seriesId: number, updates: any) {
    return window.electronAPI.manga.updateSeries(seriesId, updates);
  },
  getFriendsReading(anilistId?: number, malId?: number) {
    return window.electronAPI.manga.getFriendsReading(anilistId, malId);
  },
  getUserTrackingStatus(seriesId: number, anilistId?: number, malId?: number) {
    return window.electronAPI.manga.getUserTrackingStatus(
      seriesId,
      anilistId,
      malId,
    );
  },
  openExternal(url: string) {
    return window.electronAPI.utils.openExternal(url);
  },
  openReader(itemId: number, mangaSeriesId?: number | null) {
    return window.electronAPI.reader.openWindow(
      itemId,
      undefined,
      mangaSeriesId,
    );
  },
  openDownloaderToMangaSeries(payload: {
    id?: number | null;
    sourceId?: string;
    sourceUrl?: string;
    title?: {
      romaji?: string;
      english?: string;
      native?: string;
    };
    displayTitle?: string;
  }) {
    navigateToDownloaderMangaSeries(payload || {});
  },
};
