import type {
  FriendReading,
  MangaChapter,
  MangaExtension,
  MangaExtensionSite,
  MangaSearchResult,
  MangaSeries,
  MangaSeriesMetadata,
  TrackingAccount,
  TrackingEntry,
  UserTrackingStatus,
} from "../types/manga-types";
import type { DownloadTask, MangaMetadata } from "../downloader/types";
import type { ReaderBootstrapOverrides } from "../../src/lib/utils/manga";

// --- Shared Types (used by both preload and renderer) ---
export interface LibraryItem {
  id: number;
  path: string;
  title: string;
  type: "book" | "folder";
  page_count: number;
  cover_path: string | null;
  parent_id: number | null;
  is_favorite: boolean;
  reading_status: "unread" | "reading" | "read";
  current_page: number;
  current_page_offset?: number;
  last_read_at: string | null;
  added_at: string;
  tags_list?: string;
  types_list?: string;
  content_type?: string | null;
  _coverVersion?: number;
  manga_series_id?: number | null;
  manga_preference?: "auto" | "force_manga" | "force_non_manga";
  readerInit?: ReaderBootstrapOverrides | null;
}

export interface ScanProgressPayload {
  count: number;
  item: LibraryItem | null;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  is_default?: boolean;
}

export interface Tag {
  id: number;
  name: string;
  category_id: number | null;
  description: string | null;
  is_default?: boolean;
}

export interface TagWithCategory extends Tag {
  category_name: string | null;
}

export interface TagWithAliases extends TagWithCategory {
  aliases: string[];
}

export interface ContentType {
  id: number;
  name: string;
  description: string | null;
  is_default?: boolean;
}

export interface ContentTypeWithAliases extends ContentType {
  aliases: string[];
}

export interface PageData {
  data: Uint8Array;
  totalPages: number;
  width?: number;
  height?: number;
  name?: string;
}

export interface PageInfo {
  width?: number;
  height?: number;
}

export type TrackingProvider = "mal" | "anilist";

export interface AniListTitle {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
}

export interface AniListCoverImage {
  extraLarge?: string | null;
  large?: string | null;
}

export interface AniListRecommendationMedia {
  id: number;
  title: AniListTitle;
  coverImage?: AniListCoverImage | null;
  format?: string | null;
  status?: string | null;
  averageScore?: number | null;
  countryOfOrigin?: string | null;
}

export interface AniListRecommendationNode {
  id: number;
  rating?: number | null;
  mediaRecommendation: AniListRecommendationMedia;
}

export interface AniListRecommendationsPageInfo {
  hasNextPage: boolean;
  currentPage: number;
}

export interface AniListRecommendationsResponse {
  nodes: AniListRecommendationNode[];
  pageInfo: AniListRecommendationsPageInfo;
}

export interface AniListPageInfo {
  total?: number;
  currentPage: number;
  lastPage?: number;
  hasNextPage: boolean;
  perPage?: number;
}

export interface AniListStaffEdge {
  role?: string | null;
  node?: {
    name?: {
      full?: string | null;
    } | null;
  } | null;
}

export interface AniListExternalLink {
  url?: string | null;
  site?: string | null;
}

export interface AniListStartDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}

export interface AniListMediaEntry {
  id: number;
  idMal?: number | null;
  idMangabaka?: number | null;
  title: AniListTitle;
  synonyms?: string[];
  coverImage?: AniListCoverImage | null;
  bannerImage?: string | null;
  description?: string | null;
  countryOfOrigin?: string | null;
  status?: string | null;
  genres?: string[];
  averageScore?: number | null;
  format?: string | null;
  chapters?: number | null;
  volumes?: number | null;
  startDate?: AniListStartDate | null;
  staff?: {
    edges: AniListStaffEdge[];
  } | null;
  externalLinks?: AniListExternalLink[];
  sourceProvider?: string | null;
  sourceUrl?: string | null;
}

export interface AniListLikeDetail extends Omit<AniListMediaEntry, "id"> {
  id: number | null;
}

export interface AniListMediaPageResponse {
  pageInfo: AniListPageInfo;
  media: AniListMediaEntry[];
}

export interface MangabakaSeriesRecord {
  id: number;
  title?: string | null;
  romanized_title?: string | null;
  native_title?: string | null;
  description?: string | null;
  status?: string | null;
  type?: string | null;
  year?: number | null;
  rating?: number | null;
  total_chapters?: number | null;
  final_volume?: number | null;
  genres?: Array<string | null>;
  links?: Array<string | null>;
  cover?: {
    raw?: {
      url?: string | null;
    } | null;
    x350?: {
      x1?: string | null;
      x2?: string | null;
    } | null;
  } | null;
  source?: {
    anilist?: {
      id?: number | string | null;
    } | null;
    my_anime_list?: {
      id?: number | string | null;
    } | null;
  } | null;
  secondary_titles?: Record<string, Array<{ title?: string | null }>>;
}

export interface MangabakaSearchPagination {
  current_page: number;
  last_page: number;
  per_page?: number;
  total?: number;
}

export interface MangabakaSearchResponse {
  data: MangabakaSeriesRecord[];
  pagination?: MangabakaSearchPagination | null;
}

export interface MangaSourceDescriptor {
  id: string;
  name: string;
  baseUrl: string;
  lang: string;
  iconUrl?: string;
  matchProfile?: "slug-ranked" | "strict-ranked" | "title-exact" | "fast-first";
}

export interface ExtensionRepositoryDescriptor {
  url: string;
  name: string;
  extensionIds: string[];
  lastUpdated: string;
}

export interface TrackingSeriesPayload {
  source_id: string;
  source_url: string;
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
  anilist_id?: number;
  mal_id?: number;
  mangabaka_id?: number;
  last_updated?: string;
}

export type MangaChapterLocalStates = Record<string, MangaChapter>;

export interface LegacyScannerMatch {
  remoteId: string;
  title: string;
  coverUrl: string;
  description: string;
  score: number;
  type: string;
  format: string;
}

export interface MangaDetectedPayload {
  itemId?: number;
  query?: string;
  matches?: LegacyScannerMatch[];
}

export interface DownloaderQueueItem extends Omit<
  DownloadTask,
  "logs" | "status"
> {
  status: DownloadTask["status"] | "error";
  logs?: string[];
  file_path?: string;
  error_message?: string;
}

export type MangaQueueStatus =
  | "pending"
  | "parsing"
  | "downloading"
  | "zipping"
  | "completed"
  | "failed"
  | "cancelled"
  | "error";

export interface MangaQueueItem {
  id: number;
  type: "manga";
  url: string;
  source: string;
  title: string;
  cover_url?: string;
  status: MangaQueueStatus;
  progress: {
    current: number;
    total: number;
    percent: number;
  };
  totalImages: number;
  downloadedImages: number;
  bytesDownloaded: number;
  speed?: string;
  preview_data?: string;
  errorMessage?: string;
  error_message?: string;
  outputPath?: string;
  file_path?: string;
  series: MangaSeries;
  chapter: MangaChapter;
  logs?: string[];
}

export interface MangaDownloadSeriesPayload {
  source_id: string;
  source_url: string;
  title_original: string;
  title_romaji?: string;
  title_english?: string;
  description?: string;
  cover_url?: string;
  author?: string;
  artist?: string;
  status?: string;
  reading_format?: "manga" | "manhwa" | "manhua";
  anilist_id?: number;
  mal_id?: number;
  mangabaka_id?: number;
}

export interface MangaDownloadChapterPayload {
  chapter_number: number;
  source_url: string;
  title?: string;
  volume_number?: number;
  scanlator?: string;
  date_uploaded?: string;
  is_downloaded?: boolean;
  download_path?: string;
  is_read?: boolean;
  current_page?: number;
  page_count?: number;
  series_id?: number;
}

export interface DownloadHistoryEntry {
  id: number;
  url: string;
  title: string;
  status: string;
  source?: string | null;
  cover_url?: string | null;
  artist?: string | null;
  parody?: string | null;
  added_at?: string | null;
  completed_at?: string | null;
  file_path?: string | null;
  error_message?: string | null;
  content_type?: string | null;
  logs?: string | null;
  total_images?: number | null;
  downloaded_images?: number | null;
  progress_percent?: number | null;
  hidden_from_queue?: number | null;
  hidden_from_manga_queue?: number | null;
}

export type DownloaderHistoryScope = "manga" | "doujinshi";

export type UpdateStatusPayload =
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "not-available" }
  | { status: "downloading"; progress: number }
  | { status: "downloaded"; version: string }
  | { status: "error"; error: string };

export interface ReaderAPI {
  getPage: (
    path: string,
    pageIndex: number,
    includeHidden?: boolean,
  ) => Promise<PageData | null>;
  getPageInfo: (
    path: string,
    pageIndex: number,
    includeHidden?: boolean,
  ) => Promise<PageInfo | null>;
  getPageCount: (path: string) => Promise<number>;
  updateProgress: (
    id: number,
    currentPage: number,
    status?: "unread" | "reading" | "read",
    updateTimestamp?: boolean,
    currentPageOffset?: number,
  ) => Promise<boolean>;
  flushProgress: (
    id: number,
    currentPage: number,
    status?: "unread" | "reading" | "read",
    currentPageOffset?: number,
  ) => boolean;
  openWindow: (
    id: number,
    pageIndex?: number,
    mangaSeriesId?: number | null,
  ) => Promise<boolean>;
  toggleFullscreen: (concealExit?: boolean) => Promise<void>;
  resizeWindow: (width: number, height: number) => Promise<boolean>;
  moveWindow: (x: number, y: number) => Promise<void>;
  showWindow: (concealed?: boolean) => Promise<void>;
  revealWindow: () => Promise<void>;
  getArchiveContent: (path: string) => Promise<string[]>;
  getPageVisibility: (itemId: number) => Promise<string[]>;
  setPageVisibility: (
    itemId: number,
    pageName: string,
    hidden: boolean,
  ) => Promise<boolean>;
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void;
  onToggleGreyscale: (callback: () => void) => () => void;
}

// Main API contract for the renderer
export interface ElectronAPI {
  dialog: {
    selectFolder: () => Promise<string | null>;
  };
  utils: {
    getPathForFile: (file: File) => string;
    openExternal: (url: string) => Promise<void>;
    getVersion: () => Promise<string>;
  };
  notifications: {
    onToast: (
      callback: (message: string, type: "success" | "error" | "info") => void,
    ) => () => void;
  };
  library: {
    scan: (
      path: string,
    ) => Promise<{ success: boolean; count?: number; error?: string }>;
    rescan: () => Promise<{
      success: boolean;
      count?: number;
      error?: string;
    }>;
    getItems: (
      parentId?: number | null,
      rootPath?: string,
    ) => Promise<LibraryItem[]>;
    search: (
      query: string,
      options?: {
        folderId?: number | null;
        favoritesOnly?: boolean;
        root?: string;
      },
    ) => Promise<LibraryItem[]>;
    getItem: (id: number) => Promise<LibraryItem | undefined>;
    getFavorites: (rootPath?: string) => Promise<LibraryItem[]>;
    getRecent: (limit?: number) => Promise<LibraryItem[]>;
    removeFromRecent: (id: number) => Promise<boolean>;
    toggleFavorite: (id: number) => Promise<boolean>;
    updateItem: (id: number, updates: Partial<LibraryItem>) => Promise<boolean>;
    setMangaPreference: (
      itemId: number,
      preference: "auto" | "force_manga" | "force_non_manga",
      options?: {
        recursive?: boolean;
        clearSeriesLinks?: boolean;
        seriesId?: number | null;
      },
    ) => Promise<{
      success: boolean;
      updated?: number;
      unresolved?: number;
      error?: string;
    }>;
    deleteItem: (id: number) => Promise<boolean>;
    showInFolder: (path: string) => Promise<boolean>;
    renameItem: (
      id: number,
      newName: string,
    ) => Promise<{ success: boolean; error?: string }>;
    getCover: (coverPath: string) => Promise<string | null>;
    backup: (options?: {
      includeDownloadHistory?: boolean;
      includeDownloadLogs?: boolean;
    }) => Promise<{
      success: boolean;
      count?: number;
      historyCount?: number;
      error?: string;
    }>;
    importBackup: (inputPath?: string) => Promise<{
      success: boolean;
      count?: number;
      historyCount?: number;
      error?: string;
    }>;
    getRoots: () => Promise<string[]>;
    removeRoot: (
      rootPath: string,
    ) => Promise<{ success: boolean; error?: string }>;
    onRootsUpdated: (callback: (roots: string[]) => void) => () => void;
    clear: () => Promise<boolean>;
    getTotalBookCount: (rootPath?: string) => Promise<number>;
    exportTags: (options: {
      includeDescription: boolean;
      includeKeywords: boolean;
      includeDefaultTags: boolean;
      excludedCategoryIds: number[];
      includeTypes?: boolean;
      includeDefaultTypes?: boolean;
      excludedTypeIds?: number[];
    }) => Promise<{ success: boolean; error?: string }>;
    importTags: (
      inputPath?: string,
    ) => Promise<{ success: boolean; count?: number; error?: string }>;
    bulkDeleteItems: (ids: number[]) => Promise<boolean>;
    bulkToggleFavorite: (ids: number[]) => Promise<boolean>;
    bulkSetTags: (
      itemIds: number[],
      tagIds: number[],
      action: "add" | "remove",
    ) => Promise<boolean>;
    bulkSetContentType: (
      itemIds: number[],
      contentType: string | null,
    ) => Promise<boolean>;
    onItemsDeleted: (callback: (ids: number[]) => void) => () => void;
    onItemUpdated: (callback: (item: LibraryItem) => void) => () => void;
    onItemAdded: (callback: (item: LibraryItem) => void) => () => void;
    onScanProgress: (
      callback: (payload: ScanProgressPayload) => void,
    ) => () => void;
    onCleared: (callback: () => void) => () => void;
    onRefreshed: (callback: () => void) => () => void;
    onTriggerScan: (callback: (folderPath: string) => void) => () => void;
    createFolder: (
      parentId: number | null,
      name: string,
      rootPath?: string,
    ) => Promise<{ success: boolean; item?: LibraryItem; error?: string }>;
    getAllFolders: () => Promise<{
      success: boolean;
      folders?: LibraryItem[];
      roots?: string[];
      error?: string;
    }>;
    moveItems: (
      itemIds: number[],
      destinationFolderId: number | string | null,
    ) => Promise<{
      success: boolean;
      results?: Array<{ id: number; status: string; newPath: string }>;
      error?: string;
    }>;
  };
  manga: {
    getExtensions: () => Promise<MangaExtension[]>;
    getExtensionRepositories: () => Promise<ExtensionRepositoryDescriptor[]>;
    importExtensionRepository: (
      url: string,
    ) => Promise<ExtensionRepositoryDescriptor>;
    removeExtension: (id: string) => Promise<void>;
    toggleExtension: (id: string, enabled: boolean) => Promise<void>;
    toggleExtensionSite: (
      extensionId: string,
      siteId: string,
      enabled: boolean,
    ) => Promise<void>;
    getEnabledSources: () => Promise<MangaSourceDescriptor[]>;
    getSourceCatalog: () => Promise<MangaSourceDescriptor[]>;
    getPopular: (sourceId: string, page: number) => Promise<MangaSearchResult>;
    getLatest: (sourceId: string, page: number) => Promise<MangaSearchResult>;
    search: (
      sourceId: string,
      query: string,
      page: number,
      contextId?: string,
    ) => Promise<MangaSearchResult>;
    cancelSearchContext: (contextId: string) => Promise<boolean>;
    getDetail: (
      sourceId: string,
      urlOrId: string | number,
    ) => Promise<MangaSeriesMetadata>;
    getChapters: (
      sourceIdOrSeriesId: string | number,
      mangaId?: string,
      contextId?: string,
    ) => Promise<MangaChapter[]>;
    getChapterLocalStates: (
      sourceUrls: string[],
    ) => Promise<MangaChapterLocalStates>;
    downloadChapter: (
      series: MangaDownloadSeriesPayload,
      chapter: MangaDownloadChapterPayload,
    ) => Promise<void>;
    getDownloadQueue: () => Promise<MangaQueueItem[]>;
    getDownloadLogs: (id: number) => Promise<string[]>;
    cancelDownload: (id: number) => Promise<boolean>;
    retryDownload: (id: number) => Promise<boolean>;
    clearFinished: () => Promise<boolean>;
    cancelAll: () => Promise<boolean>;
    removeFromQueue: (id: number) => Promise<boolean>;
    getSeries: (id: number) => Promise<MangaSeries | null>;
    updateSeries: (
      id: number,
      updates: Partial<MangaSeries>,
    ) => Promise<boolean>;
      getAllSeries: () => Promise<MangaSeries[]>;
      getChapterCount: (seriesId: number) => Promise<number>;
      getLibrarySeries: () => Promise<MangaSeries[]>;
      ensureLocalSeriesForTracking: (
        payload: TrackingSeriesPayload,
      ) => Promise<{ seriesId: number }>;
      onDownloaderProgress: (
        callback: (queue: MangaQueueItem[]) => void,
      ) => () => void;
    onMangaDetected: (
      callback: (payload: MangaDetectedPayload) => void,
    ) => () => void;
    setAsManga: (
      itemId: number,
      mangaData: LegacyScannerMatch,
    ) => Promise<number>;
    scanForManga: (
      itemId: number,
      query: string,
    ) => Promise<LegacyScannerMatch[]>;
    searchMangaMatch: (query: string) => Promise<LegacyScannerMatch[]>;
    getTrackingAccounts: () => Promise<TrackingAccount[]>;
    getTrackingEntries: (seriesId: number) => Promise<TrackingEntry[]>;
    updateTrackingProgress: (
      seriesId: number,
      chaptersRead: number,
      score?: number,
      status?: string,
    ) => Promise<void>;
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
    }) => Promise<void>;
    removeTrackingEntry: (payload: {
      seriesId: number;
      service: "mal" | "anilist";
      remoteId?: number | string | null;
    }) => Promise<void>;
    loginTracking: (service: "mal" | "anilist") => Promise<{
      status: "success" | "cancelled" | "error";
      error?: string;
    }>;
    disconnectTracking: (service: "mal" | "anilist") => Promise<boolean>;
    getTrackingCustomClientId: (service: TrackingProvider) => Promise<string>;
    setTrackingCustomClientId: (
      service: TrackingProvider,
      clientId: string,
    ) => Promise<string>;
    resetTrackingCustomClientId: (
      service: TrackingProvider,
    ) => Promise<string>;
    getFriendsReading: (
      anilistId?: number,
      malId?: number,
    ) => Promise<FriendReading[]>;
    getUserTrackingStatus: (
      seriesId: number,
      anilistId?: number,
      malId?: number,
    ) => Promise<UserTrackingStatus[]>;
    getMangaDexTotalChapters: (seriesId: number) => Promise<number | null>;
    anilistSearch: (
      query: string,
      page: number,
    ) => Promise<AniListMediaPageResponse>;
    mangabakaSearch: (
      query: string,
      page: number,
      limit?: number,
    ) => Promise<MangabakaSearchResponse>;
    anilistTrending: (page: number) => Promise<AniListMediaPageResponse>;
    anilistPopular: (page: number) => Promise<AniListMediaPageResponse>;
    anilistDetails: (id: number) => Promise<AniListLikeDetail | null>;
    mangabakaDetails: (id: number) => Promise<AniListLikeDetail | null>;
    searchMalIdByTitle: (anilistId: number) => Promise<number | null>;
    anilistRecommendations: (
      id: number,
      page: number,
      perPage: number,
    ) => Promise<AniListRecommendationsResponse>;
    getIncognito: () => Promise<boolean>;
    setIncognito: (value: boolean) => Promise<boolean>;
  };
  reader: ReaderAPI;
  window: {
    show: () => Promise<void>;
  };
  settings: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<boolean>;
    getAll: () => Promise<Record<string, string>>;
  };
  tags: {
    getAll: () => Promise<TagWithCategory[]>;
    getAllWithAliases: () => Promise<TagWithAliases[]>;
    search: (query: string) => Promise<TagWithCategory[]>;
    create: (
      name: string,
      categoryId: number | null,
      description: string | null,
    ) => Promise<Tag>;
    update: (id: number, updates: Partial<Tag>) => Promise<boolean>;
    delete: (id: number) => Promise<boolean>;
    addAliases: (tagId: number, aliases: string[]) => Promise<boolean>;
    removeAlias: (tagId: number, alias: string) => Promise<boolean>;
    getAliases: (tagId: number) => Promise<string[]>;
  };
  categories: {
    getAll: () => Promise<Category[]>;
    create: (name: string, description: string | null) => Promise<Category>;
    update: (id: number, updates: Partial<Category>) => Promise<boolean>;
    delete: (id: number) => Promise<boolean>;
    addAliases: (catId: number, aliases: string[]) => Promise<boolean>;
    removeAlias: (catId: number, alias: string) => Promise<boolean>;
    getAliases: (catId: number) => Promise<string[]>;
  };
  itemTags: {
    add: (itemId: number, tagIds: number[]) => Promise<boolean>;
    remove: (itemId: number, tagIds: number[]) => Promise<boolean>;
    get: (itemId: number) => Promise<TagWithCategory[]>;
    getBulk: (itemIds: number[]) => Promise<TagWithCategory[]>;
  };
  types: {
    getAll: () => Promise<ContentType[]>;
    getAllWithAliases: () => Promise<ContentTypeWithAliases[]>;
    create: (name: string, description: string | null) => Promise<ContentType>;
    update: (id: number, updates: Partial<ContentType>) => Promise<boolean>;
    delete: (id: number) => Promise<boolean>;
    addAliases: (typeId: number, aliases: string[]) => Promise<boolean>;
    removeAlias: (typeId: number, alias: string) => Promise<boolean>;
    getAliases: (typeId: number) => Promise<string[]>;
  };
  itemTypes: {
    add: (itemId: number, typeIds: number[]) => Promise<boolean>;
    remove: (itemId: number, typeIds: number[]) => Promise<boolean>;
    get: (itemId: number) => Promise<ContentType[]>;
    bulkAdd: (itemIds: number[], typeIds: number[]) => Promise<boolean>;
    bulkRemove: (itemIds: number[], typeIds: number[]) => Promise<boolean>;
  };
  update: {
    check: () => Promise<void>;
    download: () => Promise<void>;
    install: () => Promise<void>;
    onStatusChange: (
      callback: (status: UpdateStatusPayload) => void,
    ) => () => void;
    testEvent: (type: string) => Promise<void>;
  };
  env: {
    isDev: boolean;
  };
  downloader: {
    search: (url: string) => Promise<MangaMetadata>;
    start: (
      url: string,
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    cancel: (id: number) => Promise<void>;
    retry: (id: number) => Promise<boolean>;
    removeHistoryItem: (
      scope: DownloaderHistoryScope,
      id: number,
    ) => Promise<boolean>;
    openLogs: (taskId: number) => Promise<void>;
    getTaskLogs: (taskId: number) => Promise<string[]>;
    getQueue: () => Promise<DownloaderQueueItem[]>;
    removeFromQueue: (id: number) => Promise<boolean>;
    getHistory: (
      scope: DownloaderHistoryScope,
    ) => Promise<DownloadHistoryEntry[]>;
    login: (siteKey: string) => Promise<boolean>;
    clearHistory: (scope: DownloaderHistoryScope) => Promise<boolean>;
    clearFinished: () => Promise<boolean>;
    cancelAll: () => Promise<boolean>;
    retryAll: () => Promise<boolean>;
    openFolder: () => Promise<boolean>;
    proxyImage: (imageUrl: string, source: string) => Promise<string | null>;
    getLocalCover: (path: string) => Promise<string | null>;
    getPathSeparators: () => Promise<string>;
    onQueueUpdate: (
      callback: (queue: DownloaderQueueItem[]) => void,
    ) => () => void;
    onToast: (
      callback: (message: string, type: "success" | "error" | "info") => void,
    ) => () => void;
  };
}

export type { MangaExtensionSite };
