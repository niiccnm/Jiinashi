// Preload script — Type-safe IPC bridge for context-isolated renderers.
import { contextBridge, ipcRenderer, webUtils } from "electron";

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
  last_read_at: string | null;
  added_at: string;
  tags_list?: string;
  types_list?: string;
  content_type?: string | null;
}

export interface ScanProgressPayload {
  count: number;
  item: LibraryItem | null;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
}

export interface Tag {
  id: number;
  name: string;
  category_id: number | null;
  description: string | null;
}

export interface TagWithCategory extends Tag {
  category_name: string | null;
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
}

export interface ReaderAPI {
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
  moveWindow: (x: number, y: number) => Promise<void>;
  showWindow: () => Promise<void>;
  getArchiveContent: (path: string) => Promise<string[]>;
  getPageVisibility: (itemId: number) => Promise<string[]>;
  setPageVisibility: (
    itemId: number,
    pageName: string,
    hidden: boolean,
  ) => Promise<boolean>;
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void;
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
    getTotalBookCount: () => Promise<number>;
    exportTags: (options: {
      includeDescription: boolean;
      includeKeywords: boolean;
      includeDefaultTags: boolean;
      excludedCategoryIds: number[];
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
    onItemUpdated: (callback: (item: LibraryItem) => void) => () => void;
    onItemAdded: (callback: (item: LibraryItem) => void) => () => void;
    onScanProgress: (
      callback: (payload: ScanProgressPayload) => void,
    ) => () => void;
    onCleared: (callback: () => void) => () => void;
    onRefreshed: (callback: () => void) => () => void;
    onTriggerScan: (callback: (folderPath: string) => void) => () => void;
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
    getAllWithAliases: () => Promise<any[]>;
    search: (query: string) => Promise<Tag[]>;
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
    check: () => Promise<any>;
    download: () => Promise<any>;
    install: () => Promise<void>;
    onStatusChange: (callback: (status: any) => void) => () => void;
    testEvent: (type: string) => Promise<void>;
  };
  env: {
    isDev: boolean;
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
    clearFinished: () => Promise<boolean>;
    cancelAll: () => Promise<boolean>;
    retryAll: () => Promise<boolean>;
    openFolder: () => Promise<boolean>;
    proxyImage: (imageUrl: string, source: string) => Promise<string | null>;
    getLocalCover: (path: string) => Promise<string | null>;
    getPathSeparators: () => Promise<string>;
    onQueueUpdate: (callback: (queue: any[]) => void) => () => void;
    onToast: (
      callback: (message: string, type: "success" | "error" | "info") => void,
    ) => () => void;
  };
}

// --- IPC Bridge Implementation ---
const api: ElectronAPI = {
  dialog: {
    selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  },
  utils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    openExternal: (url: string) =>
      ipcRenderer.invoke("utils:openExternal", url),
    getVersion: () => ipcRenderer.invoke("utils:getVersion"),
  },
  library: {
    scan: (path: string) => ipcRenderer.invoke("library:scan", path),
    rescan: () => ipcRenderer.invoke("library:rescan"),
    getItems: (parentId: number | null = null, rootPath: string = "") =>
      ipcRenderer.invoke("library:getItems", parentId, rootPath),
    search: (
      query: string,
      options?: {
        folderId?: number | null;
        favoritesOnly?: boolean;
        root?: string;
      },
    ) => ipcRenderer.invoke("library:searchItems", query, options),
    getItem: (id: number) => ipcRenderer.invoke("library:getItem", id),
    getFavorites: (rootPath: string = "") =>
      ipcRenderer.invoke("library:getFavorites", rootPath),
    getRecent: (limit?: number) =>
      ipcRenderer.invoke("library:getRecent", limit),
    removeFromRecent: (id: number) =>
      ipcRenderer.invoke("library:removeFromRecent", id),
    toggleFavorite: (id: number) =>
      ipcRenderer.invoke("library:toggleFavorite", id),
    updateItem: (id: number, updates: Partial<LibraryItem>) =>
      ipcRenderer.invoke("library:updateItem", id, updates),
    deleteItem: (id: number) => ipcRenderer.invoke("library:deleteItem", id),
    showInFolder: (itemPath: string) =>
      ipcRenderer.invoke("library:showInFolder", itemPath),
    renameItem: (id: number, newName: string) =>
      ipcRenderer.invoke("library:renameItem", id, newName),
    getCover: (coverPath: string) =>
      ipcRenderer.invoke("library:getCover", coverPath),
    backup: (options?: { includeDownloadHistory?: boolean }) =>
      ipcRenderer.invoke("library:backup", options),
    importBackup: (inputPath?: string) =>
      ipcRenderer.invoke("library:importBackup", inputPath),
    getRoots: () => ipcRenderer.invoke("library:getRoots"),
    removeRoot: (rootPath: string) =>
      ipcRenderer.invoke("library:removeRoot", rootPath),
    // Event subscription pattern with cleanup
    onRootsUpdated: (callback: (roots: string[]) => void) => {
      const subscription = (_: any, roots: string[]) => callback(roots);
      ipcRenderer.on("library:roots-updated", subscription);
      return () =>
        ipcRenderer.removeListener("library:roots-updated", subscription);
    },
    clear: () => ipcRenderer.invoke("library:clear"),
    getTotalBookCount: (rootPath?: string) =>
      ipcRenderer.invoke("library:getTotalBookCount", rootPath),
    exportTags: (options: {
      includeDescription: boolean;
      includeKeywords: boolean;
      includeDefaultTags: boolean;
      excludedCategoryIds?: number[];
      includeTypes?: boolean;
      includeDefaultTypes?: boolean;
      excludedTypeIds?: number[];
    }) => ipcRenderer.invoke("library:exportTags", options),
    importTags: (filePath?: string) =>
      ipcRenderer.invoke("library:importTags", filePath),
    bulkDeleteItems: (ids: number[]) =>
      ipcRenderer.invoke("library:bulkDeleteItems", ids),
    bulkToggleFavorite: (ids: number[]) =>
      ipcRenderer.invoke("library:bulkToggleFavorite", ids),
    bulkSetTags: (
      itemIds: number[],
      tagIds: number[],
      action: "add" | "remove",
    ) => ipcRenderer.invoke("library:bulkSetTags", itemIds, tagIds, action),
    bulkSetContentType: (itemIds: number[], contentType: string | null) =>
      ipcRenderer.invoke("library:bulkSetContentType", itemIds, contentType),
    onItemUpdated: (callback: (item: LibraryItem) => void) => {
      const subscription = (_: any, item: LibraryItem) => callback(item);
      ipcRenderer.on("library:item-updated", subscription);
      return () =>
        ipcRenderer.removeListener("library:item-updated", subscription);
    },
    onItemAdded: (callback: (item: LibraryItem) => void) => {
      const subscription = (_: any, item: LibraryItem) => callback(item);
      ipcRenderer.on("library:item-added", subscription);
      return () =>
        ipcRenderer.removeListener("library:item-added", subscription);
    },
    onScanProgress: (callback: (payload: ScanProgressPayload) => void) => {
      const subscription = (_: any, payload: ScanProgressPayload) =>
        callback(payload);
      ipcRenderer.on("library:scan-progress", subscription);
      return () =>
        ipcRenderer.removeListener("library:scan-progress", subscription);
    },
    onCleared: (callback: () => void) => {
      const subscription = () => callback();
      ipcRenderer.on("library:cleared", subscription);
      return () => ipcRenderer.removeListener("library:cleared", subscription);
    },
    onRefreshed: (callback: () => void) => {
      const subscription = () => callback();
      ipcRenderer.on("library:refreshed", subscription);
      return () =>
        ipcRenderer.removeListener("library:refreshed", subscription);
    },
    onTriggerScan: (callback: (folderPath: string) => void) => {
      const subscription = (_: any, path: string) => callback(path);
      ipcRenderer.on("library:trigger-scan", subscription);
      return () =>
        ipcRenderer.removeListener("library:trigger-scan", subscription);
    },
  },
  reader: {
    getPage: (path: string, pageIndex: number, includeHidden?: boolean) =>
      ipcRenderer.invoke("reader:getPage", path, pageIndex, includeHidden),
    getPageCount: (path: string) =>
      ipcRenderer.invoke("reader:getPageCount", path),
    updateProgress: (
      id: number,
      currentPage: number,
      status?: "unread" | "reading" | "read",
      updateTimestamp?: boolean,
    ) =>
      ipcRenderer.invoke(
        "reader:updateProgress",
        id,
        currentPage,
        status,
        updateTimestamp,
      ),
    openWindow: (id: number, pageIndex?: number) =>
      ipcRenderer.invoke("reader:openWindow", id, pageIndex),
    toggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),
    resizeWindow: (width: number, height: number) =>
      ipcRenderer.invoke("window:resize", width, height),
    moveWindow: async (x: number, y: number) =>
      ipcRenderer.send("window:move", x, y),
    showWindow: () => ipcRenderer.invoke("window:show"),
    getArchiveContent: (path: string) =>
      ipcRenderer.invoke("reader:getArchiveContent", path),
    getPageVisibility: (itemId: number) =>
      ipcRenderer.invoke("reader:getPageVisibility", itemId),
    setPageVisibility: (itemId: number, pageName: string, hidden: boolean) =>
      ipcRenderer.invoke("reader:setPageVisibility", itemId, pageName, hidden),
    onFullscreenChange: (callback: (isFullscreen: boolean) => void) => {
      const subscription = (_: any, isFullscreen: boolean) =>
        callback(isFullscreen);
      ipcRenderer.on("window:fullscreen-change", subscription);
      return () =>
        ipcRenderer.removeListener("window:fullscreen-change", subscription);
    },
  },
  window: {
    show: () => ipcRenderer.invoke("window:show"),
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke("settings:get", key),
    set: (key: string, value: string) =>
      ipcRenderer.invoke("settings:set", key, value),
    getAll: () => ipcRenderer.invoke("settings:getAll"),
  },
  tags: {
    getAll: () => ipcRenderer.invoke("tags:getAll"),
    getAllWithAliases: () => ipcRenderer.invoke("tags:getAllWithAliases"),
    search: (query: string) => ipcRenderer.invoke("tags:search", query),
    create: (
      name: string,
      categoryId: number | null,
      description: string | null,
    ) => ipcRenderer.invoke("tags:create", name, categoryId, description),
    update: (id: number, updates: Partial<Tag>) =>
      ipcRenderer.invoke("tags:update", id, updates),
    delete: (id: number) => ipcRenderer.invoke("tags:delete", id),
    addAliases: (tagId: number, aliases: string[]) =>
      ipcRenderer.invoke("tags:addAliases", tagId, aliases),
    removeAlias: (tagId: number, alias: string) =>
      ipcRenderer.invoke("tags:removeAlias", tagId, alias),
    getAliases: (tagId: number) => ipcRenderer.invoke("tags:getAliases", tagId),
  },
  categories: {
    getAll: () => ipcRenderer.invoke("categories:getAll"),
    create: (name: string, description: string | null = null) =>
      ipcRenderer.invoke("categories:create", name, description),
    update: (id: number, updates: Partial<Category>) =>
      ipcRenderer.invoke("categories:update", id, updates),
    delete: (id: number) => ipcRenderer.invoke("categories:delete", id),
    addAliases: (catId: number, aliases: string[]) =>
      ipcRenderer.invoke("categories:addAliases", catId, aliases),
    removeAlias: (catId: number, alias: string) =>
      ipcRenderer.invoke("categories:removeAlias", catId, alias),
    getAliases: (catId: number) =>
      ipcRenderer.invoke("categories:getAliases", catId),
  },
  itemTags: {
    add: (itemId: number, tagIds: number[]) =>
      ipcRenderer.invoke("library:addItemTags", itemId, tagIds),
    remove: (itemId: number, tagIds: number[]) =>
      ipcRenderer.invoke("library:removeItemTags", itemId, tagIds),
    get: (itemId: number) => ipcRenderer.invoke("library:getItemTags", itemId),
    getBulk: (itemIds: number[]) =>
      ipcRenderer.invoke("library:getBulkItemTags", itemIds),
  },
  types: {
    getAll: () => ipcRenderer.invoke("types:getAll"),
    getAllWithAliases: () => ipcRenderer.invoke("types:getAllWithAliases"),
    create: (name: string, description: string | null) =>
      ipcRenderer.invoke("types:create", name, description),
    update: (id: number, updates: Partial<ContentType>) =>
      ipcRenderer.invoke("types:update", id, updates),
    delete: (id: number) => ipcRenderer.invoke("types:delete", id),
    addAliases: (typeId: number, aliases: string[]) =>
      ipcRenderer.invoke("types:addAliases", typeId, aliases),
    removeAlias: (typeId: number, alias: string) =>
      ipcRenderer.invoke("types:removeAlias", typeId, alias),
    getAliases: (typeId: number) =>
      ipcRenderer.invoke("types:getAliases", typeId),
  },
  itemTypes: {
    add: (itemId: number, typeIds: number[]) =>
      ipcRenderer.invoke("library:addItemTypes", itemId, typeIds),
    remove: (itemId: number, typeIds: number[]) =>
      ipcRenderer.invoke("library:removeItemTypes", itemId, typeIds),
    get: (itemId: number) => ipcRenderer.invoke("library:getItemTypes", itemId),
    bulkAdd: (itemIds: number[], typeIds: number[]) =>
      ipcRenderer.invoke("library:bulkAddItemTypes", itemIds, typeIds),
    bulkRemove: (itemIds: number[], typeIds: number[]) =>
      ipcRenderer.invoke("library:bulkRemoveItemTypes", itemIds, typeIds),
  },
  update: {
    check: () => ipcRenderer.invoke("update:check"),
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
    onStatusChange: (callback: (status: any) => void) => {
      const subscription = (_: any, status: any) => callback(status);
      ipcRenderer.on("update:status", subscription);
      return () => ipcRenderer.removeListener("update:status", subscription);
    },
    testEvent: (type: string) => ipcRenderer.invoke("update:test-event", type),
  },
  env: {
    // Sync check for environment initialization
    isDev:
      process.env.NODE_ENV === "development" ||
      !ipcRenderer.sendSync("env:is-packaged"),
  },
  downloader: {
    search: (url: string) => ipcRenderer.invoke("downloader:search", url),
    start: (url: string) => ipcRenderer.invoke("downloader:start", url),
    cancel: (id: number) => ipcRenderer.invoke("downloader:cancel", id),
    retry: (id: number) => ipcRenderer.invoke("downloader:retry", id),
    removeHistoryItem: (id: number) =>
      ipcRenderer.invoke("downloader:remove-history-item", id),
    openLogs: (taskId: number) =>
      ipcRenderer.invoke("downloader:openLogsWindow", taskId),
    getTaskLogs: (taskId: number) =>
      ipcRenderer.invoke("downloader:get-task-logs", taskId),
    getQueue: () => ipcRenderer.invoke("downloader:get-queue"),
    removeFromQueue: (id: number) =>
      ipcRenderer.invoke("downloader:remove-from-queue", id),
    getHistory: () => ipcRenderer.invoke("downloader:get-history"),
    login: (siteKey: string) => ipcRenderer.invoke("downloader:login", siteKey),
    clearHistory: () => ipcRenderer.invoke("downloader:clear-history"),
    clearFinished: () => ipcRenderer.invoke("downloader:clear-finished"),
    cancelAll: () => ipcRenderer.invoke("downloader:cancel-all"),
    retryAll: () => ipcRenderer.invoke("downloader:retry-all"),
    openFolder: () => ipcRenderer.invoke("downloader:open-folder"),
    proxyImage: (url: string, source: string) =>
      ipcRenderer.invoke("downloader:proxy-image", url, source),
    getLocalCover: (path: string) =>
      ipcRenderer.invoke("downloader:get-local-cover", path),
    getPathSeparators: () => ipcRenderer.invoke("path-separators"),
    onQueueUpdate: (callback: (queue: any[]) => void) => {
      const subscription = (_: any, queue: any[]) => callback(queue);
      ipcRenderer.on("downloader:queue-update", subscription);
      return () =>
        ipcRenderer.removeListener("downloader:queue-update", subscription);
    },
    onToast: (
      callback: (message: string, type: "success" | "error" | "info") => void,
    ) => {
      const subscription = (
        _: any,
        message: string,
        type: "success" | "error" | "info",
      ) => callback(message, type);
      ipcRenderer.on("downloader:toast", subscription);
      return () => ipcRenderer.removeListener("downloader:toast", subscription);
    },
  },
};

// Expose API under window.electronAPI
contextBridge.exposeInMainWorld("electronAPI", api);
