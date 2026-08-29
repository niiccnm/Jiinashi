import { BrowserWindow, ipcMain } from "electron";
import {
  getDescendants,
  getItemById,
  updateItem,
} from "./database/database";
import type { LibraryItem } from "./database/database";
import {
  normalizeMangaPreference,
  parseMangaSeriesId,
  resolveSeriesIdFromDownloadHistoryPath,
} from "./library/scanner";
import type { MangaPreference } from "./library/scanner";
import {
  buildPendingMangaLinkGroups,
  enqueueDeferredMangaLinkResolution,
  type PendingMangaLinkItem,
} from "./library/manga-linker";

type RegisterLibraryMangaLinkIpcHandlersOptions = {
  broadcastItemUpdate: (id: number) => void;
};

function resolveEffectivePreference(item: LibraryItem): MangaPreference {
  const visited = new Set<number>();
  let current: LibraryItem | null = item;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    const preference = normalizeMangaPreference(current.manga_preference);
    if (preference !== "auto") return preference;

    const parentId: number = Number(current.parent_id || 0);
    current = parentId > 0 ? (getItemById(parentId) ?? null) : null;
  }

  return "auto";
}

export function registerLibraryMangaLinkIpcHandlers({
  broadcastItemUpdate,
}: RegisterLibraryMangaLinkIpcHandlersOptions) {
  function broadcastBulkItemUpdates(updatedIds: number[]) {
    if (updatedIds.length <= 40) {
      for (const id of updatedIds) {
        broadcastItemUpdate(id);
      }
      return;
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("library:refreshed");
    }
  }

  ipcMain.handle(
    "library:setMangaPreference",
    async (
      _,
      itemId: number,
      preference: MangaPreference,
      options?: {
        recursive?: boolean;
        clearSeriesLinks?: boolean;
        seriesId?: number | null;
      },
    ) => {
      try {
        const target = getItemById(itemId);
        if (!target) {
          return { success: false, error: "Item not found" };
        }

        const normalizedPreference = normalizeMangaPreference(preference);
        const shouldApplyRecursively =
          target.type === "folder" && options?.recursive !== false;
        const clearSeriesLinks = options?.clearSeriesLinks === true;
        const parsedSeriesId = Number(options?.seriesId || 0);
        const forcedSeriesId =
          Number.isFinite(parsedSeriesId) && parsedSeriesId > 0
            ? parsedSeriesId
            : null;

        const targets = shouldApplyRecursively
          ? [target, ...getDescendants(target.id)]
          : [target];
        const shouldClearAutoLinks =
          normalizedPreference === "force_non_manga" &&
          resolveEffectivePreference(target) === "auto";

        const updatedIds: number[] = [];
        const pendingMangaLinkItems: PendingMangaLinkItem[] = [];
        let unresolvedCount = 0;
        for (const item of targets) {
          const updates: Partial<LibraryItem> = {
            manga_preference: normalizedPreference,
          };

          if (item.type !== "folder") {
            const existingSeriesId = parseMangaSeriesId(item.manga_series_id);
            if (clearSeriesLinks || shouldClearAutoLinks) {
              updates.manga_series_id = null;
            } else if (
              normalizedPreference === "force_manga" &&
              forcedSeriesId
            ) {
              updates.manga_series_id = forcedSeriesId;
            } else if (
              normalizedPreference === "force_manga" &&
              existingSeriesId <= 0
            ) {
              const linkedSeriesId = resolveSeriesIdFromDownloadHistoryPath(
                item.path,
              );
              if (linkedSeriesId > 0) {
                updates.manga_series_id = linkedSeriesId;
              } else {
                pendingMangaLinkItems.push({
                  itemId: item.id,
                  itemPath: item.path,
                  rawTitle: item.title,
                });
              }
            }
          }

          updateItem(item.id, updates);
          updatedIds.push(item.id);
        }

        if (
          normalizedPreference === "force_manga" &&
          !clearSeriesLinks &&
          !forcedSeriesId &&
          pendingMangaLinkItems.length > 0
        ) {
          const pendingGroups = buildPendingMangaLinkGroups(pendingMangaLinkItems);
          enqueueDeferredMangaLinkResolution(pendingGroups, {
            mode: "scan_deferred",
            onItemsBound: (boundIds) => broadcastBulkItemUpdates(boundIds),
          });
          unresolvedCount = pendingMangaLinkItems.length;
        }

        broadcastBulkItemUpdates(updatedIds);

        return {
          success: true,
          updated: updatedIds.length,
          unresolved: unresolvedCount,
        };
      } catch (error: any) {
        return { success: false, error: error?.message || "Unknown error" };
      }
    },
  );

}
