import fs from "fs";
import path from "path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import type { DownloaderManager } from "./downloader/manager";
import { mangaDownloader } from "./downloader/manga-downloader";
import { extractCover, deleteCachedCover } from "./coverExtractor";
import { trackingService } from "./tracking/tracking-service";
import {
  backupLibrary,
  exportLibraryTags,
  importLibraryBackup,
  importLibraryTags,
} from "./library/backup-restore";
import {
  isValidLibraryPath,
  queueLibraryScan,
  readLibraryRoots,
  writeLibraryRoots,
} from "./library/scanner";
import {
  addCategoryAliases,
  addItemTags,
  addItemTypes,
  addTagAliases,
  addTypeAliases,
  bulkAddItemTypes,
  bulkDeleteItems,
  bulkRemoveItemTypes,
  bulkSetContentType,
  bulkSetTags,
  bulkToggleFavorite,
  createCategory,
  createTag,
  createType,
  deleteCategory,
  deleteItemsByRoot,
  deleteTag,
  deleteType,
  getAllCategories,
  getAllSettings,
  getAllTags,
  getAllTagsWithAliases,
  getAllTypes,
  getAllTypesWithAliases,
  getBulkItemTags,
  getCategoryAliases,
  getHiddenPages,
  getItemById,
  getItemByPath,
  getItemTags,
  getItemTypes,
  getSetting,
  getTagAliases,
  getTotalBookCount,
  getTypeAliases,
  removeCategoryAlias,
  removeItemTags,
  removeItemTypes,
  removeTagAlias,
  removeTypeAlias,
  searchTags,
  setPageVisibility,
  setSetting,
  updateCategory,
  updateItem,
  updateReadingProgress,
  updateTag,
  updateType,
} from "./database/database";
import type { Category, ContentType, Tag } from "./database/database";
import {
  getReaderArchiveContent,
  getReaderPage,
  getReaderPageCount,
  getReaderPageInfo,
} from "./reader-archive";
import { trashLibraryPath } from "./library/trash";

type RegisterLibraryIpcHandlersOptions = {
  broadcastItemUpdate: (id: number) => void;
  broadcastItemsDeleted: (ids: number[]) => void;
  downloaderManager: DownloaderManager | null;
  mainWindow: BrowserWindow | null;
  refreshFolderCover: (folderId: number) => Promise<void>;
};

function sendAppToast(
  windows: Array<BrowserWindow | null | undefined>,
  message: string,
  type: "success" | "error" | "info",
) {
  const sentWindowIds = new Set<number>();
  for (const window of windows) {
    if (!window || window.isDestroyed()) continue;
    if (sentWindowIds.has(window.id)) continue;
    sentWindowIds.add(window.id);
    window.webContents.send("app:toast", message, type);
  }
}
export function registerLibraryIpcHandlers({
  broadcastItemUpdate,
  broadcastItemsDeleted,
  downloaderManager,
  mainWindow,
  refreshFolderCover,
}: RegisterLibraryIpcHandlersOptions) {
  // Tag Handlers
  ipcMain.handle("tags:getAll", () => getAllTags());
  ipcMain.handle("tags:getAllWithAliases", () => getAllTagsWithAliases());
  ipcMain.handle("tags:search", (_, query: string) => searchTags(query));
  ipcMain.handle(
    "tags:create",
    (_, name: string, categoryId: number | null, description: string | null) =>
      createTag(name, categoryId, description),
  );
  ipcMain.handle("tags:update", (_, id: number, updates: Partial<Tag>) => {
    updateTag(id, updates);
    return true;
  });
  ipcMain.handle("tags:delete", (_, id: number) => {
    deleteTag(id);
    return true;
  });
  ipcMain.handle("tags:addAliases", (_, tagId: number, aliases: string[]) => {
    addTagAliases(tagId, aliases);
    return true;
  });
  ipcMain.handle("tags:removeAlias", (_, tagId: number, alias: string) => {
    removeTagAlias(tagId, alias);
    return true;
  });
  ipcMain.handle("tags:getAliases", (_, tagId: number) => {
    return getTagAliases(tagId);
  });

  ipcMain.handle("categories:getAll", () => getAllCategories());
  ipcMain.handle(
    "categories:create",
    (_, name: string, description: string | null) =>
      createCategory(name, description),
  );
  ipcMain.handle(
    "categories:update",
    (_, id: number, updates: Partial<Category>) => {
      updateCategory(id, updates);
      return true;
    },
  );
  ipcMain.handle("categories:delete", (_, id: number) => {
    deleteCategory(id);
    return true;
  });
  ipcMain.handle(
    "categories:addAliases",
    (_, catId: number, aliases: string[]) => {
      addCategoryAliases(catId, aliases);
      return true;
    },
  );
  ipcMain.handle(
    "categories:removeAlias",
    (_, catId: number, alias: string) => {
      removeCategoryAlias(catId, alias);
      return true;
    },
  );
  ipcMain.handle("categories:getAliases", (_, catId: number) => {
    return getCategoryAliases(catId);
  });

  ipcMain.handle(
    "library:addItemTags",
    (_, itemId: number, tagIds: number[]) => {
      addItemTags(itemId, tagIds);
      broadcastItemUpdate(itemId);
      return true;
    },
  );
  ipcMain.handle(
    "library:removeItemTags",
    (_, itemId: number, tagIds: number[]) => {
      removeItemTags(itemId, tagIds);
      broadcastItemUpdate(itemId);
      return true;
    },
  );
  ipcMain.handle("library:getItemTags", (_, itemId: number) => {
    return getItemTags(itemId);
  });

  ipcMain.handle("library:getRoots", () => {
    return readLibraryRoots();
  });

  ipcMain.handle("library:removeRoot", (_, rootPath: string) => {
    try {
      const current = readLibraryRoots();
      const normalizedPath = path.resolve(rootPath).toLowerCase();
      const newRoots = current.filter(
        (r) => path.resolve(r).toLowerCase() !== normalizedPath,
      );

      if (newRoots.length !== current.length) {
        // Cleanup DB first; if it fails, keep the root
        deleteItemsByRoot(rootPath);

        writeLibraryRoots(newRoots);

        if (mainWindow) {
          mainWindow.webContents.send("library:refreshed");
        }

        return { success: true };
      }
      return { success: false, error: "Root not found" };
    } catch (e: any) {
      console.error("Error removing library root:", e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle(
    "library:backup",
    async (
      _,
      options?: {
        includeDownloadHistory?: boolean;
        includeDownloadLogs?: boolean;
      },
    ) => {
      if (!mainWindow) return null;
      return backupLibrary(mainWindow, options);
    },
  );

  ipcMain.handle("library:exportTags", async (_, options) => {
    if (!mainWindow) return null;
    return exportLibraryTags(mainWindow, options);
  });

  ipcMain.handle("library:importTags", async (_, inputPath?: string) => {
    if (!mainWindow) return null;
    return importLibraryTags(mainWindow, inputPath);
  });

  ipcMain.handle("library:importBackup", async (_, inputPath?: string) => {
    if (!mainWindow) return null;
    return queueLibraryScan(() =>
      importLibraryBackup(mainWindow, { inputPath, downloaderManager }),
    );
  });

  ipcMain.handle(
    "reader:getPage",
    async (
      _,
      archivePath: string,
      pageIndex: number,
      includeHidden: boolean = false,
    ) => {
      try {
        if (!isValidLibraryPath(archivePath)) {
          console.error("Blocked access to path outside library:", archivePath);
          return null;
        }

        const item = getItemByPath(archivePath);
        const hiddenPages = item ? getHiddenPages(item.id) : [];
        return await getReaderPage(
          archivePath,
          pageIndex,
          hiddenPages,
          includeHidden,
        );
      } catch (e) {
        console.error("Failed to read page:", e);
        return null;
      }
    },
  );

  ipcMain.handle("reader:getArchiveContent", async (_, archivePath: string) => {
    try {
      if (!isValidLibraryPath(archivePath)) {
        console.error("Blocked access to path outside library:", archivePath);
        return [];
      }
      return await getReaderArchiveContent(archivePath);
    } catch (e) {
      console.error("Failed to get archive content:", e);
      return [];
    }
  });

  ipcMain.handle("reader:getPageVisibility", async (_, itemId: number) => {
    return getHiddenPages(itemId);
  });

  ipcMain.handle(
    "reader:setPageVisibility",
    async (_, itemId: number, pageName: string, hidden: boolean) => {
      setPageVisibility(itemId, pageName, hidden);

      // Re-extract cover excluding hidden pages
      const item = getItemById(itemId);
      if (item) {
        deleteCachedCover(item.path);
        const hiddenPages = getHiddenPages(itemId);
        const newCover = await extractCover(item.path, hiddenPages);
        updateItem(itemId, { cover_path: newCover });
        broadcastItemUpdate(itemId);

        // Refresh parent folder cover if this item is inside one
        if (item.parent_id !== null) {
          await refreshFolderCover(item.parent_id);
        }
      }
      return true;
    },
  );

  ipcMain.handle("reader:getPageCount", async (_, archivePath: string) => {
    try {
      if (!isValidLibraryPath(archivePath)) return 0;

      const item = getItemByPath(archivePath);
      const hiddenPages = item ? getHiddenPages(item.id) : [];
      return await getReaderPageCount(archivePath, hiddenPages);
    } catch (e) {
      return 0;
    }
  });

  ipcMain.handle(
    "reader:getPageInfo",
    async (
      _,
      archivePath: string,
      pageIndex: number,
      includeHidden?: boolean,
    ) => {
      try {
        if (!isValidLibraryPath(archivePath)) return null;

        const item = getItemByPath(archivePath);
        const hiddenPages = item ? getHiddenPages(item.id) : [];
        return await getReaderPageInfo(
          archivePath,
          pageIndex,
          hiddenPages,
          includeHidden,
        );
      } catch (e) {
        return null;
      }
    },
  );

  ipcMain.handle(
    "reader:updateProgress",
    async (
      event,
      id: number,
      currentPage: number,
      status?: "unread" | "reading" | "read",
      updateTimestamp?: boolean,
      currentPageOffset?: number,
    ) => {
      updateReadingProgress(
        id,
        currentPage,
        status,
        updateTimestamp,
        currentPageOffset,
      );
      broadcastItemUpdate(id);

      if (status === "read") {
        try {
          const sourceWindow = BrowserWindow.fromWebContents(event.sender);
          const toastTargets = [sourceWindow, mainWindow];
          const autoTracking = await trackingService.handleAutoTrackingForCompletedChapter(
            id,
          );
          if (autoTracking) {
            if (autoTracking.action === "manual") {
              sendAppToast(
                toastTargets,
                `Finished ${autoTracking.label}. Update tracking manually.`,
                "info",
              );
              return true;
            }
            const serviceLabel = autoTracking.services
              .map((service) => (service === "anilist" ? "AniList" : "MAL"))
              .join(", ");
            const actionLabel =
              autoTracking.action === "completed"
                ? "set to Completed"
                : autoTracking.action === "reading"
                  ? "set to Reading"
                  : "progress synced";
            const message =
              autoTracking.action === "progress"
                ? `${autoTracking.label} updated`
                : `Tracking updated: ${autoTracking.seriesTitle} ${autoTracking.label} ${actionLabel} on ${serviceLabel}`;
            sendAppToast(toastTargets, message, "success");
            return true;
          }
        } catch (error) {
          console.warn("[Tracking] Auto-tracking update failed:", error);
        }
      }

      return true;
    },
  );

  ipcMain.on(
    "reader:flushProgress",
    (
      event,
      id: number,
      currentPage: number,
      status?: "unread" | "reading" | "read",
      currentPageOffset?: number,
    ) => {
      try {
        updateReadingProgress(
          id,
          currentPage,
          status,
          false,
          currentPageOffset,
        );
        broadcastItemUpdate(id);
        event.returnValue = true;
      } catch (error) {
        console.error("Failed to flush reader progress:", error);
        event.returnValue = false;
      }
    },
  );

  ipcMain.handle("settings:get", (_, key: string) => {
    return getSetting(key);
  });

  ipcMain.handle("settings:set", (_, key: string, value: string) => {
    setSetting(key, value);
    if (key === "concurrentDownloads" || key === "downloadDelay") {
      mangaDownloader.refreshRuntimeSettings();
    }
    if (key === "maxHistoryItems") {
      mangaDownloader.reloadFromDatabase();

      if (downloaderManager) {
        downloaderManager.queue.restoreFromDatabase();
        downloaderManager.notifyUpdate(true);
      }
    }
    return true;
  });

  ipcMain.handle("settings:getAll", () => {
    return getAllSettings();
  });

  ipcMain.handle("library:getTotalBookCount", (_, rootPath?: string) => {
    return getTotalBookCount(rootPath);
  });

  ipcMain.handle("library:bulkDeleteItems", async (_, ids: number[]) => {
    const deletedIds: number[] = [];
    let failureCount = 0;

    for (const id of ids) {
      const item = getItemById(id);
      if (!item) continue;

      try {
        if (item.path) {
          await trashLibraryPath(item.path, downloaderManager);
        }
        deletedIds.push(id);
      } catch (error) {
        console.error(`Failed to trash bulk item ${id}:`, error);
        failureCount += 1;
      }
    }

    if (deletedIds.length > 0) {
      try {
        await bulkDeleteItems(deletedIds);
        broadcastItemsDeleted(deletedIds);
      } catch (err) {
        console.error("Database bulk deletion failed:", err);
        throw err;
      }
    }

    if (failureCount > 0) {
      throw new Error(
        `${failureCount} ${failureCount === 1 ? "item was" : "items were"} not moved to the Recycle Bin.`,
      );
    }

    return true;
  });

  ipcMain.handle("library:bulkToggleFavorite", (_, ids: number[]) => {
    const result = bulkToggleFavorite(ids);
    for (const id of ids) {
      broadcastItemUpdate(id);
    }
    return result;
  });

  ipcMain.handle(
    "library:bulkSetTags",
    (_, itemIds: number[], tagIds: number[], action: "add" | "remove") => {
      bulkSetTags(itemIds, tagIds, action);
      for (const id of itemIds) {
        broadcastItemUpdate(id);
      }
      return true;
    },
  );

  ipcMain.handle("library:getBulkItemTags", (_, itemIds: number[]) => {
    return getBulkItemTags(itemIds);
  });

  ipcMain.handle(
    "library:bulkSetContentType",
    (_, itemIds: number[], contentType: string | null) => {
      bulkSetContentType(itemIds, contentType);
      for (const id of itemIds) {
        broadcastItemUpdate(id);
      }
      return true;
    },
  );

  ipcMain.handle("types:getAll", () => getAllTypes());
  ipcMain.handle("types:getAllWithAliases", () => getAllTypesWithAliases());
  ipcMain.handle(
    "types:create",
    (_, name: string, description: string | null) =>
      createType(name, description),
  );
  ipcMain.handle(
    "types:update",
    (_, id: number, updates: Partial<ContentType>) => {
      updateType(id, updates);
      return true;
    },
  );
  ipcMain.handle("types:delete", (_, id: number) => {
    deleteType(id);
    return true;
  });
  ipcMain.handle("types:addAliases", (_, typeId: number, aliases: string[]) => {
    addTypeAliases(typeId, aliases);
    return true;
  });
  ipcMain.handle("types:removeAlias", (_, typeId: number, alias: string) => {
    removeTypeAlias(typeId, alias);
    return true;
  });
  ipcMain.handle("types:getAliases", (_, typeId: number) => {
    return getTypeAliases(typeId);
  });

  ipcMain.handle("library:getItemTypes", (_, itemId: number) => {
    return getItemTypes(itemId);
  });
  ipcMain.handle(
    "library:addItemTypes",
    (_, itemId: number, typeIds: number[]) => {
      addItemTypes(itemId, typeIds);
      broadcastItemUpdate(itemId);
      return true;
    },
  );
  ipcMain.handle(
    "library:removeItemTypes",
    (_, itemId: number, typeIds: number[]) => {
      removeItemTypes(itemId, typeIds);
      broadcastItemUpdate(itemId);
      return true;
    },
  );
  ipcMain.handle(
    "library:bulkAddItemTypes",
    (_, itemIds: number[], typeIds: number[]) => {
      bulkAddItemTypes(itemIds, typeIds);
      for (const id of itemIds) {
        broadcastItemUpdate(id);
      }
      return true;
    },
  );
  ipcMain.handle(
    "library:bulkRemoveItemTypes",
    (_, itemIds: number[], typeIds: number[]) => {
      bulkRemoveItemTypes(itemIds, typeIds);
      for (const id of itemIds) {
        broadcastItemUpdate(id);
      }
      return true;
    },
  );

  ipcMain.handle("utils:openExternal", (_, url) => {
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        shell.openExternal(url);
      } else {
        console.error("Blocked opening non-http/https URL:", url);
      }
    } catch {
      console.error("Blocked opening invalid URL:", url);
    }
  });
  ipcMain.handle("utils:getVersion", () => app.getVersion());
  ipcMain.handle("path-separators", () => {
    return path.sep;
  });
}
