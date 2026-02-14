/// <reference types="svelte" />
/// <reference types="vite/client" />

interface LibraryItem {
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
  last_read_at: string | null;
  added_at: string;
  tags_list?: string; // Comma-separated
  types_list?: string;
  content_type?: string | null; // Comma-separated: manga, doujinshi, webtoon, r18
}

interface PageData {
  data: Uint8Array;
  totalPages: number;
  width?: number;
  height?: number;
  name?: string;
}

interface ScanProgressPayload {
  count: number;
  item: LibraryItem | null;
}

interface Category {
  id: number;
  name: string;
  description: string | null;
  is_default?: boolean;
}

interface Tag {
  id: number;
  name: string;
  category_id: number | null;
  description: string | null;
  is_default?: boolean;
}

interface TagWithCategory extends Tag {
  category_name: string | null;
}

interface TagWithAliases extends TagWithCategory {
  aliases: string[];
}

interface ContentType {
  id: number;
  name: string;
  description: string | null;
  is_default?: boolean;
}

interface ContentTypeWithAliases extends ContentType {
  aliases: string[];
}

interface Window {
  electronAPI: {
    dialog: {
      selectFolder: () => Promise<string | null>;
    };
    utils: {
      getPathForFile: (file: File) => string;
      openExternal: (url: string) => Promise<void>;
      getVersion: () => Promise<string>;
    };
    downloader: {
      search: (url: string) => Promise<any>;
      start: (
        url: string,
      ) => Promise<{ success: boolean; id?: number; error?: string }>;
      cancel: (id: number) => Promise<void>;
      retry: (id: number) => Promise<boolean>;
      removeHistoryItem: (id: number) => Promise<boolean>;
      openLogs: (taskId: number) => Promise<void>;
      getTaskLogs: (taskId: number) => Promise<string[]>;
      getQueue: () => Promise<any[]>;
      removeFromQueue: (id: number) => Promise<boolean>;
      getHistory: () => Promise<any[]>;
      login: (siteKey: string) => Promise<boolean>;
      clearHistory: () => Promise<boolean>;
      clearQueue: () => Promise<boolean>;
      openFolder: () => Promise<boolean>;
      proxyImage: (imageUrl: string, source: string) => Promise<string | null>;
      getLocalCover: (path: string) => Promise<string | null>;
      getPathSeparators: () => Promise<string>;
      onQueueUpdate: (callback: (queue: any[]) => void) => () => void;
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
      updateItem: (
        id: number,
        updates: Partial<LibraryItem>,
      ) => Promise<boolean>;
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
    };
    reader: {
      getPage: (
        path: string,
        pageIndex: number,
        includeHidden?: boolean,
      ) => Promise<PageData | null>;
      getPageCount: (path: string) => Promise<number>;
      updateProgress: (
        id: number,
        currentPage: number,
        status?: "unread" | "reading" | "read",
        updateTimestamp?: boolean,
      ) => Promise<boolean>;
      openWindow: (id: number, pageIndex?: number) => Promise<boolean>;
      toggleFullscreen: () => Promise<void>;
      resizeWindow: (width: number, height: number) => Promise<boolean>;
      showWindow: () => Promise<void>;
      moveWindow: (x: number, y: number) => Promise<void>;
      getArchiveContent: (path: string) => Promise<string[]>;
      getPageVisibility: (itemId: number) => Promise<string[]>;
      setPageVisibility: (
        itemId: number,
        pageName: string,
        hidden: boolean,
      ) => Promise<boolean>;
      onFullscreenChange: (
        callback: (isFullscreen: boolean) => void,
      ) => () => void;
    };
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
      create: (
        name: string,
        description: string | null,
      ) => Promise<ContentType>;
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
      check: () => Promise<any>;
      download: () => Promise<any>;
      install: () => Promise<void>;
      onStatusChange: (callback: (status: any) => void) => () => void;
      testEvent: (type: string) => Promise<void>;
    };
    env: {
      isDev: boolean;
    };
  };
}
