import fs from "fs";
import path from "path";
import { dialog, BrowserWindow } from "electron";
import type { DownloaderManager } from "../downloader/manager";
import { mangaDownloader } from "../downloader/manga-downloader";
import * as mangaQueries from "../database/queries/manga";
import { resolveMangaSeriesByExactIdentifiers } from "./manga-linker/resolution-core";
import {
  addDownloadHistory,
  addItemTags,
  addItemTypes,
  addTagAliases,
  addTypeAliases,
  clearPageVisibility,
  createCategory,
  createTag,
  createType,
  getAllCategories,
  getAllDownloadHistory,
  getAllHiddenPages,
  getAllItemsFlat,
  getAllTags,
  getAllTypes,
  getDownloadLogs,
  getItemByPath,
  getLatestDownloadHistoryByUrl,
  getSetting,
  getTagExportData,
  hideFromMangaQueue,
  hideFromQueue,
  saveDownloadLogs,
  setPageVisibility,
  setSetting,
  updateDownloadHistory,
  updateItem,
} from "../database/database";
import type { LibraryItem } from "../database/database";
import {
  normalizeMangaPreference,
  readLibraryRoots,
} from "./scanner";
import type { MangaPreference } from "./scanner";

type BackupOptions = {
  includeDownloadHistory?: boolean;
  includeDownloadLogs?: boolean;
};

type ImportBackupOptions = {
  inputPath?: string;
  downloaderManager?: DownloaderManager | null;
};

type PortableSeries = {
  mediaType: "manga";
  identifiers: {
    anilist?: string;
    mal?: string;
    mangabaka?: string;
  };
  source?: {
    id: string;
    url: string;
  };
};

function toPositiveIdString(value: unknown): string | undefined {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0
    ? String(Math.floor(parsed))
    : undefined;
}

function toRootMaps(roots: string[]) {
  return roots
    .map((r, index) => ({
      original: r,
      norm: r.toLowerCase().replace(/\\/g, "/"),
      index,
    }))
    .sort((a, b) => b.norm.length - a.norm.length);
}

function toRelativePathWithRootIndex(filePath: string, roots: string[]) {
  let relativePath = filePath;
  let matchedRootIndex: number | undefined = undefined;

  const allRoots = toRootMaps(roots);
  const normP = filePath.toLowerCase().replace(/\\/g, "/");
  for (const root of allRoots) {
    if (normP.startsWith(root.norm)) {
      const rel = path.relative(root.original, filePath).replace(/\\/g, "/");
      if (!rel.startsWith("..")) {
        relativePath = rel;
        matchedRootIndex = root.index;
        break;
      }
    }
  }

  return { relativePath, matchedRootIndex };
}

function resolveItemFromRelativePath(
  relPath: string,
  currentRoots: string[],
  exportedRoots?: string[],
  rootIndex?: number,
): LibraryItem | null {
  const platformRelative = relPath.replace(/\//g, path.sep);
  let itemToUpdate: LibraryItem | null = null;

  if (
    exportedRoots &&
    rootIndex !== undefined &&
    rootIndex !== -1 &&
    exportedRoots[rootIndex]
  ) {
    const exportedRootName = exportedRoots[rootIndex];
    const localRootMatch = currentRoots.find(
      (r) => path.basename(r) === exportedRootName,
    );

    if (localRootMatch) {
      const candidatePath = path.join(localRootMatch, platformRelative);
      const item = getItemByPath(candidatePath);
      if (item) {
        itemToUpdate = item;
      }
    }
  }

  if (!itemToUpdate) {
    for (const root of currentRoots) {
      const candidatePath = path.join(root, platformRelative);
      const item = getItemByPath(candidatePath);
      if (item) {
        if (fs.existsSync(item.path)) {
          itemToUpdate = item;
          break;
        } else if (!itemToUpdate) {
          itemToUpdate = item;
        }
      }
    }
  }

  return itemToUpdate;
}

export async function backupLibrary(
  mainWindow: BrowserWindow,
  options?: BackupOptions,
) {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Save Library Backup",
    defaultPath: `jiinashi-backup-${new Date().toISOString().split("T")[0]}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (canceled || !filePath) return { success: false, error: "Cancelled" };

  try {
    const roots = readLibraryRoots();
    const allItems = getAllItemsFlat();
    const allHiddenPages = getAllHiddenPages();
    const rootNames = roots.map((r) => path.basename(r));
    const series: Record<string, PortableSeries> = {};
    const backupSeriesIds = new Map<number, number>();

    for (const item of allItems) {
      const seriesId = Number(item.manga_series_id || 0);
      if (!Number.isFinite(seriesId) || seriesId <= 0) continue;
      const normalizedSeriesId = Math.floor(seriesId);
      if (backupSeriesIds.has(normalizedSeriesId)) continue;

      const storedSeries = mangaQueries.getMangaSeries(normalizedSeriesId);
      if (!storedSeries) continue;
      const identifiers = {
        anilist: toPositiveIdString(storedSeries.anilist_id),
        mal: toPositiveIdString(storedSeries.mal_id),
        mangabaka: toPositiveIdString(storedSeries.mangabaka_id),
      };
      const sourceId = String(storedSeries.source_id || "").trim();
      const sourceUrl = String(storedSeries.source_url || "").trim();
      if (!Object.values(identifiers).some(Boolean) && (!sourceId || !sourceUrl)) {
        continue;
      }

      const backupSeriesId = backupSeriesIds.size + 1;
      backupSeriesIds.set(normalizedSeriesId, backupSeriesId);
      series[String(backupSeriesId)] = {
        mediaType: "manga",
        identifiers,
        ...(sourceId && sourceUrl
          ? { source: { id: sourceId, url: sourceUrl } }
          : {}),
      };
    }

    const backupItems = allItems
      .filter(
        (item) =>
          item.reading_status !== "unread" ||
          item.is_favorite ||
          item.current_page > 0 ||
          Number(item.current_page_offset || 0) > 0 ||
          Number(item.manga_series_id || 0) > 0 ||
          normalizeMangaPreference(item.manga_preference) !== "auto" ||
          (allHiddenPages[item.id] && allHiddenPages[item.id].length > 0),
      )
      .map((item) => {
        const seriesId = backupSeriesIds.get(Number(item.manga_series_id || 0));
        const { relativePath, matchedRootIndex } = toRelativePathWithRootIndex(
          item.path,
          roots,
        );

        if (matchedRootIndex === undefined) {
          console.warn(`Item ${item.path} not under any known library root.`);
        }

        return {
          relativePath,
          rootIndex: matchedRootIndex,
          isFavorite: item.is_favorite,
          readingStatus: item.reading_status,
          currentPage: item.current_page,
          currentPageOffset: item.current_page_offset || 0,
          lastReadAt: item.last_read_at,
          ...(seriesId ? { seriesId } : {}),
          mangaPreference: normalizeMangaPreference(item.manga_preference),
          hiddenPages: allHiddenPages[item.id] || [],
        };
      });

    const blurSettings: Record<string, string | null> = {
      blurR18: getSetting("blurR18"),
      blurR18Hover: getSetting("blurR18Hover"),
      blurR18Intensity: getSetting("blurR18Intensity"),
      mangaMode: getSetting("mangaMode"),
    };

    let downloadHistoryData: any[] = [];
    if (options?.includeDownloadHistory !== false) {
      const history = getAllDownloadHistory();
      downloadHistoryData = history.map((entry) => {
        let relativeFilePath = entry.file_path;
        if (entry.file_path) {
          const mapped = toRelativePathWithRootIndex(entry.file_path, roots);
          relativeFilePath = mapped.relativePath;
        }

        return {
          url: entry.url,
          title: entry.title,
          status: entry.status,
          source: entry.source,
          cover_url: entry.cover_url,
          artist: entry.artist,
          parody: entry.parody,
          content_type: entry.content_type,
          added_at: entry.added_at,
          completed_at: entry.completed_at,
          file_path: relativeFilePath,
          error_message: entry.error_message,
          hidden_from_queue: !!entry.hidden_from_queue,
          hidden_from_manga_queue: !!entry.hidden_from_manga_queue,
          logs: options?.includeDownloadLogs ? getDownloadLogs(entry.id) : [],
        };
      });
    }

    const backupData = {
      createdAt: new Date().toISOString(),
      roots: rootNames,
      items: backupItems,
      ...(Object.keys(series).length > 0 ? { series } : {}),
      settings: blurSettings,
      ...(downloadHistoryData.length > 0 && {
        downloadHistory: downloadHistoryData,
      }),
    };

    await fs.promises.writeFile(
      filePath,
      JSON.stringify(backupData, null, 2),
      "utf-8",
    );
    return {
      success: true,
      count: backupItems.length,
      historyCount: downloadHistoryData.length,
    };
  } catch (e: any) {
    console.error("Backup error:", e);
    return { success: false, error: e.message };
  }
}

export async function exportLibraryTags(mainWindow: BrowserWindow, options?: any) {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Export Tags and Categories",
    defaultPath: `jiinashi-tags-${new Date().toISOString().split("T")[0]}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (canceled || !filePath) return { success: false, error: "Cancelled" };

  try {
    const exportData = getTagExportData(options);
    if (!exportData) throw new Error("Failed to collect export data");

    const roots = readLibraryRoots();
    const rootNames = roots.map((r) => path.basename(r));

    const normalizedTagItems: Record<string, string[]> = {};
    const tagItemRootIndices: Record<string, number[]> = {};

    for (const [tag, paths] of Object.entries(
      exportData.tagItems as Record<string, string[]>,
    )) {
      normalizedTagItems[tag] = [];
      tagItemRootIndices[tag] = [];

      for (const p of paths) {
        const mapped = toRelativePathWithRootIndex(p, roots);
        normalizedTagItems[tag].push(mapped.relativePath);
        tagItemRootIndices[tag].push(mapped.matchedRootIndex ?? -1);
      }
    }

    const normalizedTypeItems: Record<string, string[]> = {};
    const typeItemRootIndices: Record<string, number[]> = {};

    if (exportData.typeItems) {
      for (const [typeName, paths] of Object.entries(
        exportData.typeItems as Record<string, string[]>,
      )) {
        normalizedTypeItems[typeName] = [];
        typeItemRootIndices[typeName] = [];

        for (const p of paths) {
          const mapped = toRelativePathWithRootIndex(p, roots);
          normalizedTypeItems[typeName].push(mapped.relativePath);
          typeItemRootIndices[typeName].push(mapped.matchedRootIndex ?? -1);
        }
      }
    }

    const finalData = {
      version: 1,
      createdAt: new Date().toISOString(),
      roots: rootNames,
      categories: exportData.categories,
      tags: exportData.tags,
      tagItems: normalizedTagItems,
      tagItemRootIndices,
      types: exportData.types,
      typeItems: normalizedTypeItems,
      typeItemRootIndices,
    };

    await fs.promises.writeFile(
      filePath,
      JSON.stringify(finalData, null, 2),
      "utf-8",
    );
    return { success: true };
  } catch (e: any) {
    console.error("Export error:", e);
    return { success: false, error: e.message };
  }
}

export async function importLibraryTags(
  mainWindow: BrowserWindow,
  inputPath?: string,
) {
  let filePathToUse = inputPath;
  if (!filePathToUse) {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Select Tag Export File",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (canceled || filePaths.length === 0)
      return { success: false, error: "Cancelled" };
    filePathToUse = filePaths[0];
  }

  try {
    const content = await fs.promises.readFile(filePathToUse, "utf-8");
    const data = JSON.parse(content) as {
      version: number;
      roots?: string[];
      categories?: any[];
      tags?: any[];
      tagItems?: Record<string, string[]>;
      tagItemRootIndices?: Record<string, number[]>;
      types?: any[];
      typeItems?: Record<string, string[]>;
      typeItemRootIndices?: Record<string, number[]>;
    };

    if (
      !data.version ||
      (!data.categories &&
        !data.tags &&
        !data.tagItems &&
        !data.types &&
        !data.typeItems)
    ) {
      return { success: false, error: "Invalid export file format" };
    }

    const currentRoots = readLibraryRoots();

    const categoryMap: Record<string, number> = {};
    if (data.categories) {
      for (const cat of data.categories) {
        const existing = getAllCategories().find((c) => c.name === cat.name);
        if (existing) {
          categoryMap[cat.name] = existing.id;
        } else {
          const newCat = createCategory(cat.name, cat.description);
          categoryMap[cat.name] = newCat.id;
        }
      }
    }

    const tagMap: Record<string, number> = {};
    if (data.tags) {
      for (const tag of data.tags) {
        const localCatId = tag.categoryName ? categoryMap[tag.categoryName] : null;
        const existing = getAllTags().find((t) => t.name === tag.name);
        if (existing) {
          tagMap[tag.name] = existing.id;
          if (tag.keywords) {
            addTagAliases(existing.id, tag.keywords);
          }
        } else {
          const newTag = createTag(tag.name, localCatId, tag.description);
          tagMap[tag.name] = newTag.id;
          if (tag.keywords) {
            addTagAliases(newTag.id, tag.keywords);
          }
        }
      }
    }

    let mappedCount = 0;
    if (data.tagItems) {
      for (const [tagName, relPaths] of Object.entries(data.tagItems)) {
        const localTagId =
          tagMap[tagName] || getAllTags().find((t) => t.name === tagName)?.id;
        if (!localTagId) continue;

        const rootIndices = data.tagItemRootIndices?.[tagName];

        for (let i = 0; i < relPaths.length; i++) {
          const itemToUpdate = resolveItemFromRelativePath(
            relPaths[i],
            currentRoots,
            data.roots,
            rootIndices?.[i],
          );
          if (itemToUpdate) {
            addItemTags(itemToUpdate.id, [localTagId]);
            mappedCount++;
          }
        }
      }
    }

    const typeMap: Record<string, number> = {};
    if (data.types) {
      for (const type of data.types) {
        const existing = getAllTypes().find((t) => t.name === type.name);
        if (existing) {
          typeMap[type.name] = existing.id;
          if (type.keywords) {
            addTypeAliases(existing.id, type.keywords);
          }
        } else {
          const newType = createType(type.name, type.description);
          typeMap[type.name] = newType.id;
          if (type.keywords) {
            addTypeAliases(newType.id, type.keywords);
          }
        }
      }
    }

    let typeMappedCount = 0;
    if (data.typeItems) {
      for (const [typeName, relPaths] of Object.entries(data.typeItems)) {
        const localTypeId =
          typeMap[typeName] || getAllTypes().find((t) => t.name === typeName)?.id;
        if (!localTypeId) continue;

        const rootIndices = data.typeItemRootIndices?.[typeName];

        for (let i = 0; i < relPaths.length; i++) {
          const itemToUpdate = resolveItemFromRelativePath(
            relPaths[i],
            currentRoots,
            data.roots,
            rootIndices?.[i],
          );
          if (itemToUpdate) {
            addItemTypes(itemToUpdate.id, [localTypeId]);
            typeMappedCount++;
          }
        }
      }
    }

    return { success: true, count: mappedCount, typeCount: typeMappedCount };
  } catch (e: any) {
    console.error("Import tags error:", e);
    return { success: false, error: e.message };
  }
}

export async function importLibraryBackup(
  mainWindow: BrowserWindow,
  options: ImportBackupOptions = {},
) {
  let filePathToUse = options.inputPath;

  if (!filePathToUse) {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Select Backup File",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });

    if (canceled || filePaths.length === 0)
      return { success: false, error: "Cancelled" };
    filePathToUse = filePaths[0];
  }

  try {
    const content = await fs.promises.readFile(filePathToUse, "utf-8");
    const data = JSON.parse(content);
    if (!data || (typeof data !== "object" && !Array.isArray(data))) {
      return { success: false, error: "Invalid backup file format" };
    }

    const backup: {
      roots?: string[];
      items: any[];
      series?: Record<string, PortableSeries>;
      settings?: Record<string, string | null>;
      downloadHistory?: any[];
    } = Array.isArray(data) ? { items: data } : data;

    if (!Array.isArray(backup.items)) {
      return { success: false, error: "Invalid backup file: no items found" };
    }

    const currentRoots = readLibraryRoots();
    let updatedCount = 0;
    const restoredSeriesIds = new Map<number, number>();

    if (backup.series && typeof backup.series === "object") {
      for (const [backupSeriesIdValue, portableSeries] of Object.entries(
        backup.series,
      )) {
        const backupSeriesId = Number(backupSeriesIdValue);
        if (!Number.isFinite(backupSeriesId) || backupSeriesId <= 0) continue;
        if (portableSeries?.mediaType !== "manga") continue;
        const identifiers = portableSeries.identifiers || {};
        const sourceId = String(portableSeries.source?.id || "").trim();
        const sourceUrl = String(portableSeries.source?.url || "").trim();
        let localSeriesId = Number(
          (sourceId && sourceUrl
            ? mangaQueries.getMangaSeriesBySource(sourceId, sourceUrl)?.id
            : 0) || 0,
        );
        if (localSeriesId <= 0) {
          try {
            localSeriesId = Number(
              (await resolveMangaSeriesByExactIdentifiers({
                anilistId: Number(identifiers.anilist || 0),
                malId: Number(identifiers.mal || 0),
                mangabakaId: Number(identifiers.mangabaka || 0),
              })) || 0,
            );
          } catch (error) {
            console.warn(
              `[LibraryBackup] Could not restore series ${backupSeriesId} by provider ID:`,
              error,
            );
          }
        }
        if (localSeriesId > 0) {
          restoredSeriesIds.set(Math.floor(backupSeriesId), localSeriesId);
        }
      }
    }

    for (const item of backup.items) {
      const {
        relativePath,
        rootIndex,
        isFavorite,
        readingStatus,
        currentPage,
        currentPageOffset,
        lastReadAt,
        seriesId,
        mangaSeriesId,
        mangaPreference,
      } = item as {
        relativePath: string;
        rootIndex?: number;
        isFavorite: boolean;
        readingStatus: "unread" | "reading" | "read";
        currentPage: number;
        currentPageOffset?: number;
        lastReadAt: string | null;
        seriesId?: number;
        mangaSeriesId?: number | null;
        mangaPreference?: MangaPreference;
      };
      if (!relativePath) continue;

      const itemToUpdate = resolveItemFromRelativePath(
        relativePath,
        currentRoots,
        backup.roots,
        rootIndex,
      );

      if (itemToUpdate) {
        const hasSeriesId = Object.prototype.hasOwnProperty.call(
          item,
          "seriesId",
        );
        const hasMangaSeriesId = Object.prototype.hasOwnProperty.call(
          item,
          "mangaSeriesId",
        );
        const hasMangaPreference = Object.prototype.hasOwnProperty.call(
          item,
          "mangaPreference",
        );
        const parsedSeriesId = Number(mangaSeriesId || 0);
        const normalizedPreference = normalizeMangaPreference(mangaPreference);
        const updates: Partial<LibraryItem> = {
          is_favorite: isFavorite,
          reading_status: readingStatus,
          current_page: currentPage,
          current_page_offset: Math.min(
            1,
            Math.max(
              0,
              Number.isFinite(Number(currentPageOffset))
                ? Number(currentPageOffset)
                : 0,
            ),
          ),
          last_read_at: lastReadAt,
        };
        if (hasSeriesId) {
          const restoredSeriesId = restoredSeriesIds.get(Number(seriesId || 0));
          if (restoredSeriesId) updates.manga_series_id = restoredSeriesId;
        } else if (
          hasMangaSeriesId &&
          (!Number.isFinite(parsedSeriesId) || parsedSeriesId <= 0)
        ) {
          updates.manga_series_id = null;
        }
        if (hasMangaPreference) {
          updates.manga_preference = normalizedPreference;
        }
        updateItem(itemToUpdate.id, updates);

        if (item.hiddenPages && Array.isArray(item.hiddenPages)) {
          clearPageVisibility(itemToUpdate.id);
          for (const pageName of item.hiddenPages) {
            setPageVisibility(itemToUpdate.id, pageName, true);
          }
        }

        updatedCount++;
      }
    }

    if (backup.settings && typeof backup.settings === "object") {
      for (const [key, value] of Object.entries(backup.settings)) {
        if (value !== null && value !== undefined) {
          setSetting(key, String(value));
        }
      }
    }

    let historyImportedCount = 0;
    if (backup.downloadHistory && Array.isArray(backup.downloadHistory)) {
      for (const entry of backup.downloadHistory) {
        const existing = getLatestDownloadHistoryByUrl(entry.url);
        if (!existing) {
          let absolutePath = entry.file_path;
          if (entry.file_path && !path.isAbsolute(entry.file_path)) {
            const platformRelative = entry.file_path.replace(/\//g, path.sep);
            for (const root of currentRoots) {
              const candidate = path.join(root, platformRelative);
              if (fs.existsSync(candidate)) {
                absolutePath = candidate;
                break;
              }
            }
          }

          const id = addDownloadHistory({
            url: entry.url,
            title: entry.title,
            status: entry.status,
            source: entry.source,
            cover_url: entry.cover_url,
            artist: entry.artist,
            parody: entry.parody,
            content_type: entry.content_type,
          });

          updateDownloadHistory(id, {
            completed_at: entry.completed_at,
            file_path: absolutePath,
            error_message: entry.error_message,
          });

          if (entry.hidden_from_queue) {
            hideFromQueue(id);
          }
          if (entry.hidden_from_manga_queue) {
            hideFromMangaQueue(id);
          }

          if (entry.logs && Array.isArray(entry.logs) && entry.logs.length > 0) {
            saveDownloadLogs(id, entry.logs);
          }

          historyImportedCount++;
        }
      }
    }

    mainWindow.webContents.send("library:refreshed");

    if (options.downloaderManager) {
      options.downloaderManager.queue.restoreFromDatabase();
      options.downloaderManager.notifyUpdate(true);
    }
    mangaDownloader.reloadFromDatabase();

    return {
      success: true,
      count: updatedCount,
      historyCount: historyImportedCount,
    };
  } catch (e: any) {
    console.error("Import error:", e);
    return { success: false, error: e.message };
  }
}

