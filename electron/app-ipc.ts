import fs from "fs";
import path from "path";
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
  extractCover,
  extractCoverFromFolder,
  clearCoverCache,
  deleteCachedCover,
  getCoverAsDataUrl,
} from "./coverExtractor";
import { registerLibraryIpcHandlers } from "./library-ipc";
import { registerLibraryMangaLinkIpcHandlers } from "./library-manga-link-ipc";
import { registerMangaIpcHandlers } from "./manga-ipc";
import {
  createScanProgressEmitter,
  inferLibraryRootsFromDb,
  isValidLibraryPath,
  queueLibraryScan,
  readLibraryRoots,
  rememberLibraryRoot,
  resolveInitialScanMangaPreference,
  resolveScanParentItemId,
  scanLibraryFolder,
  writeLibraryRoots,
} from "./library/scanner";
import {
  buildPendingMangaLinkGroups,
  clearDeferredMangaLinkResolution,
  enqueueDeferredMangaLinkResolution,
  healContaminatedSeriesLinksForRoot,
  resumeDeferredMangaLinkResolution,
} from "./library/manga-linker";
import type { PendingMangaLinkItem } from "./library/manga-linker";
import {
  addItem,
  clearAllItems,
  deleteItem,
  getAllFolders,
  getAllHiddenPages,
  getAllItems,
  getDescendants,
  getFavorites,
  getHiddenPages,
  getItemById,
  getItemByPath,
  getRecent,
  getSetting,
  removeFromRecent,
  renameItemWithChildren,
  searchItems,
  toggleFavorite,
  updateItem,
} from "./database/database";
import type { LibraryItem } from "./database/database";
import type { DownloaderManager } from "./downloader/manager";
import { getMangaSeries } from "./database/queries/manga";
import {
  resolveReaderBootstrapOverrides,
  type ReaderBootstrapOverrides,
} from "../src/lib/utils/manga";
import { trashLibraryPath } from "./library/trash";

type RegisterAppIpcHandlersOptions = {
  createDownloadLogsWindow: (taskId: number) => void;
  createReaderWindow: (
    bookId: number,
    pageIndex?: number,
    options?: ReaderBootstrapOverrides,
  ) => void;
  downloaderManager: DownloaderManager | null;
  mainWindow: BrowserWindow | null;
};

export function registerAppIpcHandlers({
  createDownloadLogsWindow,
  createReaderWindow,
  downloaderManager,
  mainWindow,
}: RegisterAppIpcHandlersOptions) {
  ipcMain.on("manga:downloader-progress", (event, queue) => {
    if (mainWindow) {
      mainWindow.webContents.send("manga:downloader-progress", queue);
    }
  });

  function getCoverVersionFromPath(
    coverPath: string | null | undefined,
  ): number | undefined {
    const normalizedPath = String(coverPath || "").trim();
    if (!normalizedPath) return undefined;
    try {
      const stat = fs.statSync(normalizedPath);
      const version = Math.trunc(stat.mtimeMs);
      return Number.isFinite(version) && version > 0 ? version : undefined;
    } catch {
      return undefined;
    }
  }

  function attachCoverVersion<T extends { cover_path?: string | null }>(
    item: T,
  ): T & { _coverVersion?: number } {
    const coverVersion = getCoverVersionFromPath(item.cover_path);
    return coverVersion
      ? { ...item, _coverVersion: coverVersion }
      : (item as T & { _coverVersion?: number });
  }

  function attachCoverVersions<T extends { cover_path?: string | null }>(
    items: T[],
  ): Array<T & { _coverVersion?: number }> {
    return items.map((item) => attachCoverVersion(item));
  }

  function broadcastItemUpdate(id: number) {
    // Broadcast item update to all windows
    const updatedItem = getItemById(id);
    if (!updatedItem) return;
    // Append _coverVersion for browser cache busting
    const payload = { ...updatedItem, _coverVersion: Date.now() };
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("library:item-updated", payload);
    }
  }

  function broadcastItemsDeleted(ids: number[]) {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("library:items-deleted", ids);
    }
  }

  function toPositiveSeriesId(value: unknown): number {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }

  function resolveReaderInitForSeriesId(
    seriesIdValue: number | null | undefined,
  ): ReaderBootstrapOverrides | undefined {
    const seriesId = toPositiveSeriesId(seriesIdValue);
    if (!seriesId) return undefined;

    const series = getMangaSeries(seriesId);
    if (!series) return undefined;

    const overrides = resolveReaderBootstrapOverrides(
      series.reading_format,
      series.reading_format === "manhwa" ||
        series.reading_format === "manhua"
        ? undefined
        : getSetting("defaultViewMode"),
    );
    return overrides || undefined;
  }

  async function refreshFolderCover(folderId: number): Promise<void> {
    const folder = getItemById(folderId);
    if (!folder || folder.type !== "folder") return;

    const hiddenPagesLookup = (filePath: string): string[] => {
      const normalized = filePath.replace(/\\/g, "/");
      const item = getItemByPath(normalized);
      return item ? getHiddenPages(item.id) : [];
    };

    const newCover = await extractCoverFromFolder(
      folder.path,
      hiddenPagesLookup,
    );
    updateItem(folderId, { cover_path: newCover });
    broadcastItemUpdate(folderId);
  }

  function broadcastItemAdded(id: number) {
    const newItem = getItemById(id);
    if (!newItem) return;
    const payload = attachCoverVersion(newItem);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("library:item-added", payload);
    }
  }

  function broadcastRootsUpdated(roots: string[]) {
    if (!mainWindow) return;
    mainWindow.webContents.send("library:roots-updated", roots);
  }

  function createScanSessionId(prefix: "scan" | "rescan"): string {
    const randomPart = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
  }

  function broadcastBulkItemUpdates(itemIds: number[]) {
    const uniqueIds = Array.from(
      new Set(
        itemIds
          .map((id) => Number(id || 0))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    );
    if (uniqueIds.length <= 0) return;
    if (uniqueIds.length <= 40) {
      for (const id of uniqueIds) {
        broadcastItemUpdate(id);
      }
      return;
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("library:refreshed");
    }
  }

  function enqueueDeferredFromPendingItems(
    pendingItems: PendingMangaLinkItem[],
    logLabel: "scan" | "rescan" | "heal",
  ): {
    pendingItems: number;
    pendingGroups: number;
    queuedGroups: number;
    dedupedGroups: number;
  } {
    if (pendingItems.length === 0) {
      return {
        pendingItems: 0,
        pendingGroups: 0,
        queuedGroups: 0,
        dedupedGroups: 0,
      };
    }
    const groups = buildPendingMangaLinkGroups(pendingItems);
    const queueStats = enqueueDeferredMangaLinkResolution(groups, {
      mode: "scan_deferred",
      onItemsBound: (boundIds) => {
        broadcastBulkItemUpdates(boundIds);
      },
    });
    const groupPreview = groups
      .slice(0, 3)
      .map(
        (group) =>
          `scopeRoot=${String(group.scanRootPath || "none")} anchor=${String(group.seriesAnchorPath || "none")}`,
      )
      .join(" | ");
    console.log(
      `[MangaLinker][${logLabel}] pendingItems=${pendingItems.length} pendingGroups=${groups.length} queuedGroups=${queueStats.queued} dedupedGroups=${queueStats.deduped}${groupPreview ? ` preview=${groupPreview}` : ""}`,
    );
    if (mainWindow && logLabel !== "heal" && queueStats.queued > 0) {
      mainWindow.webContents.send(
        "downloader:toast",
        `Recognizing ${groups.length} manga series in the background`,
        "info",
      );
    }
    return {
      pendingItems: pendingItems.length,
      pendingGroups: groups.length,
      queuedGroups: queueStats.queued,
      dedupedGroups: queueStats.deduped,
    };
  }

  function runRootScopedHealAfterRescan(
    scanRootPath: string,
    scanSessionId: string,
  ): {
    validatedCandidates: number;
    contaminatedGroups: number;
    clearedItems: number;
    evidenceKeeps: number;
    queuedGroups: number;
    dedupedGroups: number;
  } {
    const normalizedRoot = path.resolve(scanRootPath);
    const heal = healContaminatedSeriesLinksForRoot({
      scanRootPath: normalizedRoot,
      scanSessionId: `${scanSessionId}-heal`,
    });
    if (heal.clearedItemIds.length > 0) {
      broadcastBulkItemUpdates(heal.clearedItemIds);
    }
    const deferredStats = enqueueDeferredFromPendingItems(
      heal.pendingItems,
      "heal",
    );
    console.log(
      `[MangaLinker][rescan-heal] session=${scanSessionId} root=${normalizedRoot} validatedCandidates=${heal.validatedCandidates} contaminatedGroups=${heal.contaminatedGroups} clearedItems=${heal.clearedItems} evidenceKeeps=${heal.evidenceKeeps} queuedGroups=${deferredStats.queuedGroups}`,
    );
    return {
      validatedCandidates: heal.validatedCandidates,
      contaminatedGroups: heal.contaminatedGroups,
      clearedItems: heal.clearedItems,
      evidenceKeeps: heal.evidenceKeeps,
      queuedGroups: deferredStats.queuedGroups,
      dedupedGroups: deferredStats.dedupedGroups,
    };
  }

  resumeDeferredMangaLinkResolution({
    onItemsBound: (boundIds) => broadcastBulkItemUpdates(boundIds),
  });

  ipcMain.handle("dialog:selectFolder", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select your manga/doujinshi folder",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // Library handlers
  ipcMain.handle(
    "library:scan",
    async (_, folderPath: string, parentId: number | null = null) => {
      return queueLibraryScan(async () => {
        try {
          if (parentId === null) {
            rememberLibraryRoot(folderPath, broadcastRootsUpdated);
          }

          const progress = createScanProgressEmitter((payload) => {
            if (!mainWindow) return;
            mainWindow.webContents.send("library:scan-progress", payload);
          });
          const initialMangaPreference =
            resolveInitialScanMangaPreference(folderPath);
          const resolvedParentId = await resolveScanParentItemId(
            folderPath,
            parentId,
            progress,
            initialMangaPreference,
          );
          const scanSessionId = createScanSessionId("scan");
          const scanRootPath = path.resolve(folderPath);
          const pendingMangaLinkItems: PendingMangaLinkItem[] = [];
          const count = await scanLibraryFolder(
            folderPath,
            resolvedParentId,
            progress,
            initialMangaPreference,
            {
              refreshFolderCover,
              pendingMangaLinkItems,
              scanSessionId,
              scanRootPath,
            },
          );
          progress.flush();
          const deferredStats = enqueueDeferredFromPendingItems(
            pendingMangaLinkItems,
            "scan",
          );
          console.log(
            `[MangaLinker][scan] session=${scanSessionId} root=${scanRootPath} count=${count} pendingItems=${deferredStats.pendingItems} queuedGroups=${deferredStats.queuedGroups}`,
          );

          // Refresh UI after scan
          BrowserWindow.getAllWindows().forEach((w) => {
            w.webContents.send("library:refreshed");
          });

          return {
            success: true,
            count,
            pendingItems: deferredStats.pendingItems,
            pendingGroups: deferredStats.pendingGroups,
            queuedGroups: deferredStats.queuedGroups,
            dedupedGroups: deferredStats.dedupedGroups,
            repairScanned: 0,
            repairCleared: 0,
            repairQueuedGroups: 0,
            scanSessionId,
          };
        } catch (e: any) {
          console.error("Scan error:", e);
          return { success: false, error: e.message };
        }
      });
    },
  );

  ipcMain.handle(
    "library:createFolder",
    async (_, parentId: number | null, name: string, rootPath?: string) => {
      try {
        let parentPath = rootPath;
        if (parentId !== null) {
          const parent = getItemById(parentId);
          if (!parent) throw new Error("Parent folder not found");
          parentPath = parent.path;
        }

        if (!parentPath || !fs.existsSync(parentPath)) {
          throw new Error("Target parent path not found");
        }

        const safeName = name.replace(/[<>:"/\\|?*]/g, "").trim();
        if (!safeName) throw new Error("Invalid folder name");

        const targetPath = path.join(parentPath, safeName);
        if (fs.existsSync(targetPath)) {
          throw new Error("Folder already exists");
        }

        await fs.promises.mkdir(targetPath, { recursive: true });
        const id = addItem({
          path: targetPath,
          title: safeName,
          type: "folder",
          page_count: 0,
          cover_path: null,
          parent_id: parentId,
          is_favorite: false,
          reading_status: "unread",
          current_page: 0,
          last_read_at: null,
        });

        const item = getItemById(id);
        if (item) broadcastItemAdded(id);
        return { success: true, item };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
  );

  ipcMain.handle("library:getAllFolders", () => {
    try {
      return {
        success: true,
        folders: getAllFolders(),
        roots: readLibraryRoots(),
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle(
    "library:moveItems",
    async (_, itemIds: number[], destinationId: number | string | null) => {
      try {
        let destinationPath: string;
        let finalParentId: number | null = null;

        if (typeof destinationId === "string") {
          destinationPath = destinationId;
        } else if (typeof destinationId === "number") {
          const dest = getItemById(destinationId);
          if (!dest) throw new Error("Destination not found");
          destinationPath = dest.path;
          finalParentId = destinationId;
        } else throw new Error("Target not specified");

        const sourceFolderIds = new Set<number>();

        const results = [];
        for (const id of itemIds) {
          const item = getItemById(id);
          if (!item) continue;

          if (item.parent_id !== null) {
            sourceFolderIds.add(item.parent_id);
          }

          const oldPath = item.path;
          const ext = path.extname(oldPath);
          const base = path.basename(oldPath, ext);
          let targetPath = path.join(destinationPath, path.basename(oldPath));

          let counter = 1;
          while (fs.existsSync(targetPath)) {
            targetPath = path.join(
              destinationPath,
              `${base} (${counter++})${ext}`,
            );
          }

          try {
            await fs.promises.rename(oldPath, targetPath);
          } catch (e: any) {
            if (e.code === "EXDEV") {
              await fs.promises.cp(oldPath, targetPath, { recursive: true });
              await fs.promises.rm(oldPath, { recursive: true, force: true });
            } else throw e;
          }

          const finalTitle = path.basename(targetPath, ext);
          updateItem(id, {
            path: targetPath,
            parent_id: finalParentId,
            title: finalTitle,
          });

          for (const d of getDescendants(id)) {
            const rel = path.relative(oldPath, d.path);
            updateItem(d.id, { path: path.join(targetPath, rel) });
          }

          results.push({ id, status: "moved", newPath: targetPath });
          broadcastItemUpdate(id);
        }

        // Refresh covers for affected folders
        if (typeof destinationId === "number") {
          await refreshFolderCover(destinationId);
        }
        for (const sourceId of sourceFolderIds) {
          await refreshFolderCover(sourceId);
        }

        return { success: true, results };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
  );

  ipcMain.handle("library:rescan", async () => {
    return queueLibraryScan(async () => {
      try {
        let roots = readLibraryRoots();
        if (roots.length === 0) {
          roots = inferLibraryRootsFromDb();
          if (roots.length > 0) writeLibraryRoots(roots);
        } else {
          // Persist canonicalized roots to avoid nested-root scan overlap.
          writeLibraryRoots(roots);
        }

        console.log("Rescanning library roots:", roots);

        const progress = createScanProgressEmitter((payload) => {
          if (!mainWindow) return;
          mainWindow.webContents.send("library:scan-progress", payload);
        });
        let totalAdded = 0;
        let totalPendingItems = 0;
        let totalPendingGroups = 0;
        let totalQueuedGroups = 0;
        let totalDedupedGroups = 0;
        let totalHealValidatedCandidates = 0;
        let totalHealContaminatedGroups = 0;
        let totalHealClearedItems = 0;
        let totalHealEvidenceKeeps = 0;
        let totalHealQueuedGroups = 0;
        let totalHealDedupedGroups = 0;
        const seriesExistsCache = new Map<number, boolean>();
        for (const rootPath of roots) {
          if (!fs.existsSync(rootPath)) continue;
          const resolvedRootPath = path.resolve(rootPath);
          const scanSessionId = createScanSessionId("rescan");
          const pendingMangaLinkItems: PendingMangaLinkItem[] = [];
          const initialMangaPreference =
            resolveInitialScanMangaPreference(rootPath);
          totalAdded += await scanLibraryFolder(
            rootPath,
            null,
            progress,
            initialMangaPreference,
            {
              refreshFolderCover,
              pendingMangaLinkItems,
              seriesExistsCache,
              scanSessionId,
              scanRootPath: resolvedRootPath,
            },
          );
          const perRootDeferred = enqueueDeferredFromPendingItems(
            pendingMangaLinkItems,
            "rescan",
          );
          totalPendingItems += perRootDeferred.pendingItems;
          totalPendingGroups += perRootDeferred.pendingGroups;
          totalQueuedGroups += perRootDeferred.queuedGroups;
          totalDedupedGroups += perRootDeferred.dedupedGroups;
          const healStats = runRootScopedHealAfterRescan(
            resolvedRootPath,
            scanSessionId,
          );
          totalHealValidatedCandidates += healStats.validatedCandidates;
          totalHealContaminatedGroups += healStats.contaminatedGroups;
          totalHealClearedItems += healStats.clearedItems;
          totalHealEvidenceKeeps += healStats.evidenceKeeps;
          totalHealQueuedGroups += healStats.queuedGroups;
          totalHealDedupedGroups += healStats.dedupedGroups;
          console.log(
            `[MangaLinker][rescan] session=${scanSessionId} root=${resolvedRootPath} pendingItems=${perRootDeferred.pendingItems} queuedGroups=${perRootDeferred.queuedGroups} healCleared=${healStats.clearedItems} contaminatedGroups=${healStats.contaminatedGroups}`,
          );
        }
        progress.flush();

        // Refresh covers for items with hidden pages
        const allHidden = getAllHiddenPages() as Record<string, string[]>;
        for (const [itemIdStr, hiddenPages] of Object.entries(allHidden)) {
          const itemId = Number(itemIdStr);
          const item = getItemById(itemId);
          if (!item || item.type === "folder") continue;

          deleteCachedCover(item.path);
          const newCover = await extractCover(item.path, hiddenPages);
          if (newCover !== item.cover_path) {
            updateItem(itemId, { cover_path: newCover });
            broadcastItemUpdate(itemId);
          }

          // Update parent folder cover if needed
          if (item.parent_id !== null) {
            await refreshFolderCover(item.parent_id);
          }
        }

        // Notify UI
        BrowserWindow.getAllWindows().forEach((w) => {
          w.webContents.send("library:refreshed");
        });

        return {
          success: true,
          count: totalAdded,
          pendingItems: totalPendingItems,
          pendingGroups: totalPendingGroups,
          queuedGroups: totalQueuedGroups,
          dedupedGroups: totalDedupedGroups,
          validationScanned: totalHealValidatedCandidates,
          validationCleared: totalHealClearedItems,
          validationQueuedGroups: totalHealQueuedGroups,
          validationMultiAnchorSeriesWithinScope: totalHealContaminatedGroups,
          healValidatedCandidates: totalHealValidatedCandidates,
          healContaminatedGroups: totalHealContaminatedGroups,
          healClearedItems: totalHealClearedItems,
          healEvidenceKeeps: totalHealEvidenceKeeps,
          healQueuedGroups: totalHealQueuedGroups,
          healDedupedGroups: totalHealDedupedGroups,
          repairScanned: totalHealValidatedCandidates,
          repairCleared: totalHealClearedItems,
          repairQueuedGroups: totalHealQueuedGroups,
        };
      } catch (e: any) {
        console.error("Rescan error:", e);
        return { success: false, error: e.message };
      }
    });
  });

  ipcMain.handle(
    "library:getItems",
    (_, parentId: number | null = null, rootPath?: string) => {
      console.log(
        `[library:getItems] parentId: ${parentId}, rootPath: ${rootPath}`,
      );
      return attachCoverVersions(getAllItems(parentId, rootPath));
    },
  );

  ipcMain.handle(
    "library:searchItems",
    (
      _,
      query: string,
      options?: {
        folderId?: number | null;
        favoritesOnly?: boolean;
        root?: string;
      },
    ) => {
      let rootPath = options?.root;

      if (options?.folderId) {
        const folder = getItemById(options.folderId);
        if (folder) {
          rootPath = folder.path;
        }
      }

      return attachCoverVersions(
        searchItems(query, {
          rootPath,
          favoritesOnly: options?.favoritesOnly,
        }),
      );
    },
  );

  ipcMain.handle("library:getItem", (_, id: number) => {
    const item = getItemById(id);
    return item ? attachCoverVersion(item) : null;
  });

  ipcMain.handle(
    "reader:openWindow",
    (_, id: number, pageIndex?: number, mangaSeriesId?: number | null) => {
      const item = getItemById(id);
      const storedSeriesId = toPositiveSeriesId(item?.manga_series_id);
      const requestedSeriesId = toPositiveSeriesId(mangaSeriesId);
      const resolvedSeriesId =
        item?.manga_preference === "force_non_manga"
          ? null
          : storedSeriesId || requestedSeriesId || null;
      const readerInit = resolveReaderInitForSeriesId(resolvedSeriesId);
      createReaderWindow(id, pageIndex, readerInit);
      return true;
    },
  );

  ipcMain.handle("downloader:openLogsWindow", (_, taskId: number) => {
    createDownloadLogsWindow(taskId);
  });

  ipcMain.handle("library:clear", () => {
    clearDeferredMangaLinkResolution();
    clearAllItems();
    clearCoverCache();
    // Also clear roots for a total "fresh start"
    writeLibraryRoots([]);
    console.log("Library cleared!");
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("library:cleared");
      win.webContents.send("library:roots-updated", []);
    }
    return true;
  });

  ipcMain.handle("library:getFavorites", (_, rootPath?: string) => {
    return attachCoverVersions(getFavorites(rootPath));
  });

  ipcMain.handle("library:getRecent", (_, limit: number = 20) => {
    return attachCoverVersions(getRecent(limit));
  });

  ipcMain.handle("library:removeFromRecent", (_, id: number) => {
    removeFromRecent(id);
    broadcastItemUpdate(id);
    return true;
  });

  ipcMain.handle("library:toggleFavorite", (_, id: number) => {
    const isFavorite = toggleFavorite(id);
    broadcastItemUpdate(id);
    return isFavorite;
  });

  ipcMain.handle(
    "library:updateItem",
    (_, id: number, updates: Partial<LibraryItem>) => {
      updateItem(id, updates);
      return true;
    },
  );

  ipcMain.handle("library:deleteItem", async (_, id: number) => {
    const item = getItemById(id);
    if (!item) return false;

    if (item.path) {
      await trashLibraryPath(item.path, downloaderManager);
    }

    // Persist parent as root if deleting root item
    if (item.parent_id === null) {
      try {
        rememberLibraryRoot(path.dirname(item.path), broadcastRootsUpdated);
      } catch (e) {
        console.error(
          "Failed to remember library root during delete:",
          item.path,
          e,
        );
      }
    }

    deleteItem(id);
    broadcastItemsDeleted([id]);
    return true;
  });

  // Open file/folder location in File Explorer
  ipcMain.handle("library:showInFolder", (_, itemPath: string) => {
    if (itemPath && fs.existsSync(itemPath)) {
      if (!isValidLibraryPath(itemPath)) {
        console.error("Blocked access to path outside library:", itemPath);
        return false;
      }
      shell.showItemInFolder(path.resolve(itemPath));
      return true;
    }
    return false;
  });

  // Rename file/folder
  ipcMain.handle(
    "library:renameItem",
    async (_, id: number, newName: string) => {
      const item = getItemById(id);
      if (!item || !item.path || !fs.existsSync(item.path)) {
        return { success: false, error: "Item not found" };
      }

      const dir = path.dirname(item.path);
      const ext = item.type === "folder" ? "" : path.extname(item.path);
      const newPath = path.join(dir, newName + ext);

      // Check if target already exists
      if (fs.existsSync(newPath)) {
        return {
          success: false,
          error: "A file with that name already exists",
        };
      }

      try {
        await fs.promises.rename(item.path, newPath);

        // Update database
        try {
          renameItemWithChildren(id, newName, newPath);
          broadcastItemUpdate(id);
          return { success: true };
        } catch (dbErr: any) {
          console.error("DB update failed, rolling back FS rename:", dbErr);
          try {
            await fs.promises.rename(newPath, item.path);
          } catch (rollbackErr) {
            console.error("Critical: FS Rollback failed:", rollbackErr);
          }
          return {
            success: false,
            error: "Database update failed: " + dbErr.message,
          };
        }
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
  );

  ipcMain.handle("library:getCover", (_, coverPath: string) => {
    if (!coverPath) return null;
    return getCoverAsDataUrl(coverPath);
  });
  registerLibraryIpcHandlers({
    broadcastItemUpdate,
    broadcastItemsDeleted,
    downloaderManager,
    mainWindow,
    refreshFolderCover,
  });

  registerLibraryMangaLinkIpcHandlers({
    broadcastItemUpdate,
  });
  registerMangaIpcHandlers({
    broadcastItemUpdate,
  });
}
