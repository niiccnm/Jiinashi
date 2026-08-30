import { invoke, on, send, sendSync } from "./bridge-helpers";
import type { Category, ContentType, ElectronAPI, Tag } from "./types";

type NonDomainBridge = Omit<ElectronAPI, "library" | "manga">;

export function createMiscBridge(
  electronWebUtils: typeof import("electron").webUtils,
): NonDomainBridge {
  return {
    dialog: {
      selectFolder: () => invoke("dialog:selectFolder"),
    },
    utils: {
      getPathForFile: (file: File) => electronWebUtils.getPathForFile(file),
      openExternal: (url: string) => invoke("utils:openExternal", url),
      getVersion: () => invoke("utils:getVersion"),
    },
    notifications: {
      onToast: (callback: (message: string, type: "success" | "error" | "info") => void) =>
        on("app:toast", callback),
    },
    reader: {
      getPage: (path: string, pageIndex: number, includeHidden?: boolean) =>
        invoke("reader:getPage", path, pageIndex, includeHidden),
      getPageInfo: (path: string, pageIndex: number, includeHidden?: boolean) =>
        invoke("reader:getPageInfo", path, pageIndex, includeHidden),
      getPageCount: (path: string) => invoke("reader:getPageCount", path),
      updateProgress: (
        id: number,
        currentPage: number,
        status?: "unread" | "reading" | "read",
        updateTimestamp?: boolean,
        currentPageOffset?: number,
      ) =>
        invoke(
          "reader:updateProgress",
          id,
          currentPage,
          status,
          updateTimestamp,
          currentPageOffset,
        ),
      flushProgress: (
        id: number,
        currentPage: number,
        status?: "unread" | "reading" | "read",
        currentPageOffset?: number,
      ) =>
        sendSync<boolean>(
          "reader:flushProgress",
          id,
          currentPage,
          status,
          currentPageOffset,
        ),
      openWindow: (id: number, pageIndex?: number, mangaSeriesId?: number | null) =>
        invoke("reader:openWindow", id, pageIndex, mangaSeriesId),
      toggleFullscreen: (concealExit = false) =>
        invoke("window:toggle-fullscreen", concealExit),
      resizeWindow: (width: number, height: number) =>
        invoke("window:resize", width, height),
      moveWindow: async (x: number, y: number) => send("window:move", x, y),
      showWindow: (concealed = false) => invoke("window:show", concealed),
      revealWindow: () => invoke("window:reveal"),
      getArchiveContent: (path: string) => invoke("reader:getArchiveContent", path),
      getPageVisibility: (itemId: number) =>
        invoke("reader:getPageVisibility", itemId),
      setPageVisibility: (itemId: number, pageName: string, hidden: boolean) =>
        invoke("reader:setPageVisibility", itemId, pageName, hidden),
      onFullscreenChange: (callback: (isFullscreen: boolean) => void) =>
        on("window:fullscreen-change", callback),
      onToggleGreyscale: (callback: () => void) =>
        on("reader:toggle-greyscale", callback),
    },
    window: {
      show: () => invoke("window:show"),
    },
    settings: {
      get: (key: string) => invoke("settings:get", key),
      set: (key: string, value: string) => invoke("settings:set", key, value),
      getAll: () => invoke("settings:getAll"),
    },
    tags: {
      getAll: () => invoke("tags:getAll"),
      getAllWithAliases: () => invoke("tags:getAllWithAliases"),
      search: (query: string) => invoke("tags:search", query),
      create: (
        name: string,
        categoryId: number | null,
        description: string | null,
      ) => invoke("tags:create", name, categoryId, description),
      update: (id: number, updates: Partial<Tag>) => invoke("tags:update", id, updates),
      delete: (id: number) => invoke("tags:delete", id),
      addAliases: (tagId: number, aliases: string[]) =>
        invoke("tags:addAliases", tagId, aliases),
      removeAlias: (tagId: number, alias: string) =>
        invoke("tags:removeAlias", tagId, alias),
      getAliases: (tagId: number) => invoke("tags:getAliases", tagId),
    },
    categories: {
      getAll: () => invoke("categories:getAll"),
      create: (name: string, description: string | null = null) =>
        invoke("categories:create", name, description),
      update: (id: number, updates: Partial<Category>) =>
        invoke("categories:update", id, updates),
      delete: (id: number) => invoke("categories:delete", id),
      addAliases: (catId: number, aliases: string[]) =>
        invoke("categories:addAliases", catId, aliases),
      removeAlias: (catId: number, alias: string) =>
        invoke("categories:removeAlias", catId, alias),
      getAliases: (catId: number) => invoke("categories:getAliases", catId),
    },
    itemTags: {
      add: (itemId: number, tagIds: number[]) =>
        invoke("library:addItemTags", itemId, tagIds),
      remove: (itemId: number, tagIds: number[]) =>
        invoke("library:removeItemTags", itemId, tagIds),
      get: (itemId: number) => invoke("library:getItemTags", itemId),
      getBulk: (itemIds: number[]) => invoke("library:getBulkItemTags", itemIds),
    },
    types: {
      getAll: () => invoke("types:getAll"),
      getAllWithAliases: () => invoke("types:getAllWithAliases"),
      create: (name: string, description: string | null) =>
        invoke("types:create", name, description),
      update: (id: number, updates: Partial<ContentType>) =>
        invoke("types:update", id, updates),
      delete: (id: number) => invoke("types:delete", id),
      addAliases: (typeId: number, aliases: string[]) =>
        invoke("types:addAliases", typeId, aliases),
      removeAlias: (typeId: number, alias: string) =>
        invoke("types:removeAlias", typeId, alias),
      getAliases: (typeId: number) => invoke("types:getAliases", typeId),
    },
    itemTypes: {
      add: (itemId: number, typeIds: number[]) =>
        invoke("library:addItemTypes", itemId, typeIds),
      remove: (itemId: number, typeIds: number[]) =>
        invoke("library:removeItemTypes", itemId, typeIds),
      get: (itemId: number) => invoke("library:getItemTypes", itemId),
      bulkAdd: (itemIds: number[], typeIds: number[]) =>
        invoke("library:bulkAddItemTypes", itemIds, typeIds),
      bulkRemove: (itemIds: number[], typeIds: number[]) =>
        invoke("library:bulkRemoveItemTypes", itemIds, typeIds),
    },
    update: {
      check: () => invoke("update:check"),
      download: () => invoke("update:download"),
      install: () => invoke("update:install"),
      onStatusChange: (callback) => on("update:status", callback),
      testEvent: (type: string) => invoke("update:test-event", type),
    },
    env: {
      isDev:
        process.env.NODE_ENV === "development" ||
        !sendSync<boolean>("env:is-packaged"),
    },
    downloader: {
      search: (url: string) => invoke("downloader:search", url),
      start: (url: string) => invoke("downloader:start", url),
      cancel: (id: number) => invoke("downloader:cancel", id),
      retry: (id: number) => invoke("downloader:retry", id),
      removeHistoryItem: (scope, id: number) =>
        invoke("downloader:remove-history-item", scope, id),
      openLogs: (taskId: number) => invoke("downloader:openLogsWindow", taskId),
      getTaskLogs: (taskId: number) => invoke("downloader:get-task-logs", taskId),
      getQueue: () => invoke("downloader:get-queue"),
      removeFromQueue: (id: number) => invoke("downloader:remove-from-queue", id),
      getHistory: (scope) => invoke("downloader:get-history", scope),
      login: (siteKey: string) => invoke("downloader:login", siteKey),
      clearHistory: (scope) => invoke("downloader:clear-history", scope),
      clearFinished: () => invoke("downloader:clear-finished"),
      cancelAll: () => invoke("downloader:cancel-all"),
      retryAll: () => invoke("downloader:retry-all"),
      openFolder: () => invoke("downloader:open-folder"),
      proxyImage: (url: string, source: string) =>
        invoke("downloader:proxy-image", url, source),
      getLocalCover: (path: string) => invoke("downloader:get-local-cover", path),
      getPathSeparators: () => invoke("path-separators"),
      onQueueUpdate: (callback) =>
        on("downloader:queue-update", callback),
      onToast: (callback: (message: string, type: "success" | "error" | "info") => void) =>
        on("downloader:toast", callback),
    },
  };
}
