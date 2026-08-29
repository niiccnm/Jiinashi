import fs from "fs";
import path from "path";
import StreamZip from "node-stream-zip";
import { ArchiveHandler } from "../archives/archive";
import {
  addItem,
  addItemTags,
  bulkAddItemTypes,
  bulkSetContentType,
  deleteItem,
  ensureCategory,
  ensureContentType,
  ensureTag,
  getAllItems,
  getAllItemsFlat,
  getDownloadHistoryByPath,
  getItemById,
  getItemByPath,
  getSetting,
  getTagByName,
  getTypeByName,
  incrementMissCount,
  resetMissCount,
  setSetting,
  updateItem,
} from "../database/database";
import type { LibraryItem } from "../database/database";
import * as mangaQueries from "../database/queries/manga";
import {
  deleteCachedCover,
  extractCover,
  extractCoverFromFolder,
  getCoverCachePath,
} from "../coverExtractor";
import {
  deriveSeriesAnchorFromScanRoot,
  deriveStructuralScopeRootForFile,
} from "./manga-linker";
import type { PendingMangaLinkItem } from "./manga-linker";

const LIBRARY_ROOTS_SETTING_KEY = "libraryRoots";

export type MangaPreference = "auto" | "force_manga" | "force_non_manga";
export type ScanProgressPayload = { count: number; item: LibraryItem | null };

export function parseMangaSeriesId(value: unknown): number {
  const next = Number(value || 0);
  return Number.isFinite(next) && next > 0 ? next : 0;
}

function resolveExistingMangaSeriesId(
  value: unknown,
  existsCache: Map<number, boolean>,
): number {
  const parsed = parseMangaSeriesId(value);
  if (parsed <= 0) return 0;

  if (existsCache.has(parsed)) {
    return existsCache.get(parsed) ? parsed : 0;
  }

  let exists = false;
  try {
    exists = Boolean(mangaQueries.getMangaSeries(parsed));
  } catch {
    exists = false;
  }
  existsCache.set(parsed, exists);
  return exists ? parsed : 0;
}

export function normalizeMangaPreference(value: unknown): MangaPreference {
  const next = String(value || "")
    .trim()
    .toLowerCase();
  if (next === "force_manga") return "force_manga";
  if (next === "force_non_manga") return "force_non_manga";
  return "auto";
}

export function normalizeLibraryRoots(roots: string[]): string[] {
  const unique = new Map<string, string>();

  for (const root of roots) {
    if (typeof root !== "string") continue;
    const trimmed = root.trim();
    if (!trimmed) continue;
    const resolved = path.resolve(trimmed);
    const key = resolved.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, resolved);
    }
  }

  const sorted = Array.from(unique.values()).sort(
    (a, b) => a.length - b.length,
  );
  const collapsed: string[] = [];

  for (const candidate of sorted) {
    const normalizedCandidate = candidate.toLowerCase();
    const overlaps = collapsed.some((parent) => {
      const normalizedParent = parent.toLowerCase();
      return (
        normalizedCandidate === normalizedParent ||
        normalizedCandidate.startsWith(normalizedParent + path.sep)
      );
    });
    if (!overlaps) {
      collapsed.push(candidate);
    }
  }

  return collapsed;
}

export function readLibraryRoots(): string[] {
  const raw = getSetting(LIBRARY_ROOTS_SETTING_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeLibraryRoots(
      parsed.filter(
        (p): p is string => typeof p === "string" && p.trim().length > 0,
      ),
    );
  } catch {
    return [];
  }
}

export function writeLibraryRoots(roots: string[]) {
  const normalized = normalizeLibraryRoots(roots);
  setSetting(LIBRARY_ROOTS_SETTING_KEY, JSON.stringify(normalized));
}

export function rememberLibraryRoot(
  rootPath: string,
  onRootsUpdated?: (roots: string[]) => void,
): string[] {
  const resolved = path.resolve(rootPath);
  const existing = readLibraryRoots();
  const nextRoots = normalizeLibraryRoots([...existing, resolved]);

  const changed =
    nextRoots.length !== existing.length ||
    nextRoots.some((root, index) => root !== existing[index]);

  if (changed) {
    writeLibraryRoots(nextRoots);
  }

  if (onRootsUpdated) {
    onRootsUpdated(nextRoots);
  }

  return nextRoots;
}

export function inferLibraryRootsFromDb(): string[] {
  const topLevel = getAllItems(null);
  const roots = new Map<string, string>();
  for (const item of topLevel) {
    const candidate = path.dirname(item.path);
    const resolved = path.resolve(candidate);
    const key = resolved.toLowerCase();
    if (!roots.has(key) && fs.existsSync(resolved)) {
      roots.set(key, resolved);
    }
  }
  return Array.from(roots.values());
}

export function isValidLibraryPath(targetPath: string): boolean {
  if (!targetPath) return false;
  const normalizedTarget = path.resolve(targetPath).toLowerCase();

  const roots = readLibraryRoots();
  const isInDataRoot = roots.some((root) => {
    const normalizedRoot = path.resolve(root).toLowerCase();
    return (
      normalizedTarget.startsWith(normalizedRoot + path.sep) ||
      normalizedTarget === normalizedRoot
    );
  });

  if (isInDataRoot) return true;
  return false;
}

export async function runIntegrityCheck(): Promise<void> {
  const MISS_THRESHOLD = 3;
  const allItems = getAllItemsFlat();
  const mangaSeriesExistsCache = new Map<number, boolean>();

  for (const item of allItems) {
    if (item.type !== "folder") {
      const seriesId = parseMangaSeriesId(item.manga_series_id);
      if (
        seriesId > 0 &&
        resolveExistingMangaSeriesId(seriesId, mangaSeriesExistsCache) <= 0
      ) {
        updateItem(item.id, { manga_series_id: null });
      }
    }

    const pathExists = fs.existsSync(item.path);

    if (pathExists) {
      if (item.miss_count && item.miss_count > 0) {
        resetMissCount(item.id);
      }
    } else {
      incrementMissCount(item.id);

      const newMissCount = (item.miss_count || 0) + 1;

      if (newMissCount >= MISS_THRESHOLD) {
        if (item.cover_path) {
          deleteCachedCover(item.path);
        }
        deleteItem(item.id);
      }
    }
  }
}

type ScanProgressEmitter = {
  onAdded: (item: LibraryItem) => void;
  flush: () => void;
  getCount: () => number;
};

export function createScanProgressEmitter(
  emit: (payload: ScanProgressPayload) => void,
): ScanProgressEmitter {
  let totalAdded = 0;
  let lastEmittedAt = 0;
  let lastItem: LibraryItem | null = null;

  function sendProgress(force: boolean) {
    const now = Date.now();
    if (!force && now - lastEmittedAt < 120) return;
    lastEmittedAt = now;
    emit({ count: totalAdded, item: lastItem });
  }

  return {
    onAdded: (item: LibraryItem) => {
      totalAdded += 1;
      lastItem = item;
      sendProgress(false);
    },
    flush: () => {
      sendProgress(true);
    },
    getCount: () => totalAdded,
  };
}

let libraryScanLock: Promise<void> = Promise.resolve();

export function queueLibraryScan<T>(task: () => Promise<T>): Promise<T> {
  const previous = libraryScanLock;
  let release: () => void = () => {};
  libraryScanLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  return (async () => {
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  })();
}

export function resolveSeriesIdFromDownloadHistoryPath(
  filePath: string,
): number {
  const fromDownloadPath = parseMangaSeriesId(
    mangaQueries.getMangaSeriesIdByChapterDownloadPath(filePath),
  );
  if (fromDownloadPath > 0 && mangaQueries.getMangaSeries(fromDownloadPath)) {
    return fromDownloadPath;
  }

  const history = getDownloadHistoryByPath(filePath);
  const historyUrl = String(history?.url || "").trim();
  if (!historyUrl) return 0;
  const seriesId = parseMangaSeriesId(
    mangaQueries.getMangaSeriesIdByChapterSourceUrl(historyUrl),
  );
  if (seriesId <= 0) return 0;
  return mangaQueries.getMangaSeries(seriesId) ? seriesId : 0;
}

export function resolveInitialScanMangaPreference(
  folderPath: string,
): MangaPreference {
  const existingRootItem = getItemByPath(folderPath);
  if (existingRootItem) {
    const existingPreference = normalizeMangaPreference(
      existingRootItem.manga_preference,
    );
    if (existingPreference !== "auto") {
      return existingPreference;
    }
  }

  const configuredDownloadPath = String(
    getSetting("downloadPath") || "",
  ).trim();
  if (!configuredDownloadPath) return "auto";

  const mangaDownloadRoot = path.resolve(configuredDownloadPath, "Manga");
  const resolvedTargetPath = path.resolve(folderPath);
  const normalizedMangaRoot = mangaDownloadRoot.toLowerCase();
  const normalizedTargetPath = resolvedTargetPath.toLowerCase();

  if (
    normalizedTargetPath === normalizedMangaRoot ||
    normalizedTargetPath.startsWith(normalizedMangaRoot + path.sep)
  ) {
    return "force_manga";
  }

  return "auto";
}

export async function resolveScanParentItemId(
  folderPath: string,
  parentId: number | null,
  progress: ScanProgressEmitter | undefined,
  inheritedMangaPreference: MangaPreference,
): Promise<number | null> {
  if (parentId !== null) return parentId;

  const resolvedFolderPath = path.resolve(folderPath);
  const normalizedFolderPath = resolvedFolderPath.toLowerCase();
  const roots = readLibraryRoots();
  if (roots.length === 0) return null;

  const containingRoot = roots
    .map((root) => path.resolve(root))
    .filter((root) => {
      const normalizedRoot = root.toLowerCase();
      return (
        normalizedFolderPath === normalizedRoot ||
        normalizedFolderPath.startsWith(normalizedRoot + path.sep)
      );
    })
    .sort((a, b) => b.length - a.length)[0];

  if (!containingRoot) return null;
  if (normalizedFolderPath === containingRoot.toLowerCase()) return null;

  const relativePath = path.relative(containingRoot, resolvedFolderPath);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  const pathSegments = relativePath.split(path.sep).filter(Boolean);
  if (pathSegments.length === 0) return null;

  let currentParentId: number | null = null;
  let currentPath = containingRoot;

  for (const segment of pathSegments) {
    currentPath = path.join(currentPath, segment);

    let existingFolder = getItemByPath(currentPath);
    if (!existingFolder) {
      const folderCover = await extractCoverFromFolder(currentPath);
      const folderMangaPreference =
        inheritedMangaPreference !== "auto" ? inheritedMangaPreference : "auto";

      const createdFolderId = addItem({
        path: currentPath,
        title: segment,
        type: "folder",
        page_count: 0,
        cover_path: folderCover,
        parent_id: currentParentId,
        is_favorite: false,
        reading_status: "unread",
        current_page: 0,
        last_read_at: null,
        manga_preference: folderMangaPreference,
      });

      currentParentId = createdFolderId;
      const createdFolder = getItemById(createdFolderId);
      if (createdFolder && progress) {
        progress.onAdded(createdFolder);
      }
      continue;
    }

    if (existingFolder.type !== "folder") {
      return parentId;
    }

    if (existingFolder.parent_id !== currentParentId) {
      updateItem(existingFolder.id, { parent_id: currentParentId });
      existingFolder = getItemById(existingFolder.id) || existingFolder;
    }

    const existingFolderPreference = normalizeMangaPreference(
      existingFolder.manga_preference,
    );
    if (
      existingFolderPreference === "auto" &&
      inheritedMangaPreference !== "auto"
    ) {
      updateItem(existingFolder.id, {
        manga_preference: inheritedMangaPreference,
      });
      existingFolder = getItemById(existingFolder.id) || existingFolder;
    }

    currentParentId = existingFolder.id;
  }

  return currentParentId;
}

type ScanOptions = {
  refreshFolderCover?: (folderId: number) => Promise<void>;
  seriesExistsCache?: Map<number, boolean>;
  pendingMangaLinkItems?: PendingMangaLinkItem[];
  scanSessionId?: string;
  scanRootPath?: string;
  scanScopeRootPath?: string;
};

export async function scanLibraryFolder(
  dirPath: string,
  parentItemId: number | null,
  progress?: ScanProgressEmitter,
  inheritedMangaPreference: MangaPreference = "auto",
  options: ScanOptions = {},
): Promise<number> {
  const supportedExtensions = [
    ".cbz",
    ".zip",
    ".cbr",
    ".rar",
    ".cb7",
    ".7z",
    ".pdf",
  ];
  const imageExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".tiff",
  ];
  let addedCount = 0;
  let firstArchiveCandidatePath: string | null = null;
  let firstImageCandidatePath: string | null = null;
  const scanOptions: ScanOptions = {
    ...options,
    seriesExistsCache: options.seriesExistsCache || new Map<number, boolean>(),
    pendingMangaLinkItems: options.pendingMangaLinkItems || [],
    scanSessionId: String(options.scanSessionId || "").trim() || "scan-unknown",
    scanRootPath: path.resolve(String(options.scanRootPath || dirPath)),
    scanScopeRootPath: path.resolve(
      String(options.scanScopeRootPath || options.scanRootPath || dirPath),
    ),
  };
  const seriesExistsCache = scanOptions.seriesExistsCache!;
  const pendingMangaLinkItems = scanOptions.pendingMangaLinkItems!;
  const scanSessionId = scanOptions.scanSessionId!;
  const scanRootPath = scanOptions.scanRootPath!;
  const scanScopeRootPath = scanOptions.scanScopeRootPath!;

  function resolveEffectiveMangaPreference(
    itemPreference: unknown,
  ): MangaPreference {
    const normalizedItemPreference = normalizeMangaPreference(itemPreference);
    if (normalizedItemPreference !== "auto") return normalizedItemPreference;
    return inheritedMangaPreference;
  }

  function resolveMangaSeriesId(
    archiveInfo: any,
    history: any,
    filePath?: string,
  ): number {
    const metadataCandidates = [
      archiveInfo?.mangaSeriesId,
      archiveInfo?.manga_series_id,
      archiveInfo?.seriesId,
      archiveInfo?.series_id,
    ];

    for (const candidate of metadataCandidates) {
      const parsed = resolveExistingMangaSeriesId(candidate, seriesExistsCache);
      if (parsed > 0) return parsed;
    }

    const fromDownloadPath = resolveExistingMangaSeriesId(
      mangaQueries.getMangaSeriesIdByChapterDownloadPath(
        String(filePath || ""),
      ),
      seriesExistsCache,
    );
    if (fromDownloadPath > 0) return fromDownloadPath;

    const historyUrl = String(history?.url || "").trim();
    if (historyUrl) {
      const fromChapterSource =
        mangaQueries.getMangaSeriesIdByChapterSourceUrl(historyUrl);
      const parsed = resolveExistingMangaSeriesId(
        fromChapterSource,
        seriesExistsCache,
      );
      if (parsed > 0) return parsed;
    }

    return 0;
  }

  function queuePendingMangaLinkItem(
    itemId: number,
    filePath: string,
    rawTitle: string,
    effectivePreference: MangaPreference,
  ) {
    if (effectivePreference !== "force_manga") return;
    const structuralScopeRootPath = deriveStructuralScopeRootForFile(
      filePath,
      scanRootPath,
    );
    const seriesAnchorPath = deriveSeriesAnchorFromScanRoot(
      filePath,
      structuralScopeRootPath,
    );
    pendingMangaLinkItems.push({
      itemId,
      itemPath: filePath,
      rawTitle,
      scanSessionId,
      scanRootPath,
      scanScopeRootPath: structuralScopeRootPath,
    });
    console.log(
      `[MangaLinker][Pending] session=${scanSessionId} scanRoot=${scanRootPath} scopeRoot=${structuralScopeRootPath} anchor=${seriesAnchorPath} item=${itemId}`,
    );
  }

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    const sortedEntries = entries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
    const folderHasArchiveFile = sortedEntries.some((candidate) => {
      if (!candidate.isFile()) return false;
      const candidateExt = path.extname(candidate.name).toLowerCase();
      return supportedExtensions.includes(candidateExt);
    });

    for (const entry of sortedEntries) {
      const file = entry.name;
      const filePath = path.join(dirPath, file);

      if (
        file.startsWith(".") ||
        file === "Thumbs.db" ||
        file === "__MACOSX" ||
        file === "$RECYCLE.BIN" ||
        file === "System Volume Information"
      ) {
        continue;
      }

      try {
        if (entry.isFile()) {
          const ext = path.extname(file).toLowerCase();
          if (ext === ".file" || ext === ".ini" || ext === ".db") continue;
          const isSyntheticMangaCover =
            folderHasArchiveFile &&
            imageExtensions.includes(ext) &&
            /^cover\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(file);
          if (isSyntheticMangaCover) {
            const existingCoverItem = getItemByPath(filePath);
            if (existingCoverItem) {
              deleteItem(existingCoverItem.id);
            }
            continue;
          }

          if (!firstArchiveCandidatePath && supportedExtensions.includes(ext)) {
            firstArchiveCandidatePath = filePath;
          } else if (
            !firstImageCandidatePath &&
            imageExtensions.includes(ext)
          ) {
            firstImageCandidatePath = filePath;
          }

          const existingItem = getItemByPath(filePath);
          if (existingItem) {
            if (existingItem.parent_id !== parentItemId) {
              updateItem(existingItem.id, { parent_id: parentItemId });
            }

            const effectiveMangaPreference = resolveEffectiveMangaPreference(
              existingItem.manga_preference,
            );
            if (supportedExtensions.includes(ext)) {
              const storedSeriesId = parseMangaSeriesId(
                existingItem.manga_series_id,
              );
              const existingSeriesId = resolveExistingMangaSeriesId(
                storedSeriesId,
                seriesExistsCache,
              );
              if (storedSeriesId > 0 && existingSeriesId <= 0) {
                updateItem(existingItem.id, { manga_series_id: null });
              }
              if (
                existingSeriesId <= 0 &&
                effectiveMangaPreference !== "force_non_manga"
              ) {
                const history = getDownloadHistoryByPath(filePath);
                const linkedSeriesId = resolveMangaSeriesId(
                  undefined,
                  history,
                  filePath,
                );
                if (linkedSeriesId > 0) {
                  updateItem(existingItem.id, {
                    manga_series_id: linkedSeriesId,
                  });
                } else {
                  queuePendingMangaLinkItem(
                    existingItem.id,
                    filePath,
                    path.basename(file, ext),
                    effectiveMangaPreference,
                  );
                }
              }
            }
            continue;
          }

          if (supportedExtensions.includes(ext)) {
            let pageCount = 0;
            let coverPath: string | null = null;

            let archiveInfo: any = null;

            const sidecarPath = path.join(
              path.dirname(filePath),
              path.basename(filePath, path.extname(filePath)) + ".info.json",
            );
            if (fs.existsSync(sidecarPath)) {
              try {
                archiveInfo = JSON.parse(fs.readFileSync(sidecarPath, "utf-8"));
                fs.unlinkSync(sidecarPath);
                console.log(
                  `[Scanner] Consumed and removed metadata sidecar: ${sidecarPath}`,
                );
              } catch (e) {}
            }

            if (ext === ".cbz" || ext === ".zip") {
              try {
                const zip = new StreamZip.async({ file: filePath });
                const entries = await zip.entries();
                const imageEntries = Object.values(entries).filter(
                  (e) =>
                    /\.(jpg|jpeg|png|gif|webp)$/i.test(e.name) &&
                    !e.isDirectory,
                );
                pageCount = imageEntries.length;

                try {
                  const infoEntry = await zip.entryData("info.json");
                  if (infoEntry) {
                    archiveInfo = JSON.parse(infoEntry.toString());
                  }
                } catch (e) {}

                await zip.close();
                coverPath = await extractCover(filePath);
              } catch (e) {
                console.error("Failed to read zip archive:", filePath, e);
              }
            } else if (ext === ".rar" || ext === ".cbr") {
              try {
                const handler = await ArchiveHandler.open(filePath);
                const entries = await handler.getEntries();
                pageCount = entries.length;

                try {
                  const infoBuffer = await handler.getFile("info.json");
                  if (infoBuffer) {
                    archiveInfo = JSON.parse(infoBuffer.toString());
                  }
                } catch (e) {}

                handler.close();
                coverPath = await extractCover(filePath);
              } catch (e) {
                console.error("Failed to read rar archive:", filePath, e);
              }
            }

            const history = getDownloadHistoryByPath(filePath);
            let linkedMangaSeriesId = resolveMangaSeriesId(
              archiveInfo,
              history,
              filePath,
            );
            const effectiveMangaPreference =
              resolveEffectiveMangaPreference(undefined);

            const newItemId = addItem({
              path: filePath,
              title: path.basename(file, ext),
              type: "book",
              page_count: pageCount,
              cover_path: coverPath,
              parent_id: parentItemId,
              is_favorite: false,
              reading_status: "unread",
              current_page: 0,
              last_read_at: null,
            });
            addedCount++;

            if (
              linkedMangaSeriesId <= 0 &&
              effectiveMangaPreference === "force_manga"
            ) {
              queuePendingMangaLinkItem(
                newItemId,
                filePath,
                path.basename(file, ext),
                effectiveMangaPreference,
              );
            }

            if (
              linkedMangaSeriesId > 0 &&
              effectiveMangaPreference !== "force_non_manga"
            ) {
              updateItem(newItemId, { manga_series_id: linkedMangaSeriesId });
            }

            try {
              const strict = getSetting("strictImport") !== "false";
              const tagIds: number[] = [];

              const artistCatId = strict ? null : ensureCategory("Artist");
              const parodyCatId = strict ? null : ensureCategory("Parody");

              if (archiveInfo) {
                if (archiveInfo.tags && Array.isArray(archiveInfo.tags)) {
                  for (const t of archiveInfo.tags) {
                    const clean = t.toLowerCase().trim();
                    const parts = clean.split(":");
                    const nameOnly =
                      parts.length > 1 ? parts[1].trim() : parts[0].trim();

                    const tag = getTagByName(clean) || getTagByName(nameOnly);
                    if (tag && !tagIds.includes(tag.id)) {
                      tagIds.push(tag.id);
                    }
                  }
                }
                if (archiveInfo.artist) {
                  const names = archiveInfo.artist
                    .split(",")
                    .map((s: any) => s.trim())
                    .filter(Boolean);
                  for (const n of names) {
                    const tag = getTagByName(n);
                    if (tag && !tagIds.includes(tag.id)) tagIds.push(tag.id);
                    else if (!tag && !strict && artistCatId !== null)
                      tagIds.push(ensureTag(n, artistCatId));
                  }
                }
                if (archiveInfo.parody) {
                  const names = archiveInfo.parody
                    .split(",")
                    .map((s: any) => s.trim())
                    .filter(Boolean);
                  for (const n of names) {
                    const tag = getTagByName(n);
                    if (tag && !tagIds.includes(tag.id)) tagIds.push(tag.id);
                    else if (!tag && !strict && parodyCatId !== null)
                      tagIds.push(ensureTag(n, parodyCatId));
                  }
                }
              }

              if (tagIds.length === 0) {
                if (history) {
                  if (history.artist) {
                    const tag = getTagByName(history.artist);
                    if (tag) tagIds.push(tag.id);
                    else if (!strict && artistCatId !== null)
                      tagIds.push(ensureTag(history.artist, artistCatId));
                  }
                  if (history.parody) {
                    const tag = getTagByName(history.parody);
                    if (tag) tagIds.push(tag.id);
                    else if (!strict && parodyCatId !== null)
                      tagIds.push(ensureTag(history.parody, parodyCatId));
                  }
                }
              }

              if (tagIds.length > 0) {
                addItemTags(newItemId, tagIds);
                console.log(
                  `[Scanner] Applied ${tagIds.length} bridge tags to ${filePath}`,
                );
              }

              const contentType =
                archiveInfo?.contentType || history?.content_type;
              console.log(
                `[Scanner] Metadata for ${filePath}: Tags=${tagIds.length}, Type=${contentType}`,
              );
              if (contentType) {
                if (strict) {
                  const existingType = getTypeByName(contentType);
                  if (existingType) {
                    bulkAddItemTypes([newItemId], [existingType.id]);
                    bulkSetContentType([newItemId], existingType.name);
                    console.log(
                      `[Scanner] Applied Content Type Badge: ${existingType.name}`,
                    );
                  } else {
                    console.log(
                      `[Scanner] Skipped unknown Content Type "${contentType}" (strict mode).`,
                    );
                  }
                } else {
                  const typeId = ensureContentType(contentType);
                  bulkAddItemTypes([newItemId], [typeId]);
                  bulkSetContentType([newItemId], contentType);
                  console.log(
                    `[Scanner] Applied Content Type Badge: ${contentType}`,
                  );
                }
              }
            } catch (bridgeErr) {
              console.error("[Scanner] Metadata bridge failed:", bridgeErr);
            }

            const newItem = getItemById(newItemId) ?? getItemByPath(filePath);
            if (newItem && progress) {
              progress.onAdded(newItem);
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
          } else if (imageExtensions.includes(ext)) {
            addItem({
              path: filePath,
              title: path.basename(file, ext),
              type: "book",
              page_count: 1,
              cover_path: filePath,
              parent_id: parentItemId,
              is_favorite: false,
              reading_status: "unread",
              current_page: 0,
              last_read_at: null,
            });
            addedCount++;
            const newItem = getItemByPath(filePath);
            if (newItem && progress) {
              progress.onAdded(newItem);
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        } else if (entry.isDirectory()) {
          let existingFolder = getItemByPath(filePath);
          let folderId: number;

          if (!existingFolder) {
            const folderCover = await extractCoverFromFolder(filePath);
            const folderMangaPreference =
              inheritedMangaPreference !== "auto"
                ? inheritedMangaPreference
                : "auto";

            folderId = addItem({
              path: filePath,
              title: file,
              type: "folder",
              page_count: 0,
              cover_path: folderCover,
              parent_id: parentItemId,
              is_favorite: false,
              reading_status: "unread",
              current_page: 0,
              last_read_at: null,
              manga_preference: folderMangaPreference,
            });
            console.log(`  -> Folder added with ID: ${folderId}`);
            addedCount++;

            const newFolder = getItemById(folderId) ?? getItemByPath(filePath);
            if (newFolder && progress) {
              progress.onAdded(newFolder);
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
          } else {
            console.log("  -> Folder exists in DB:", existingFolder.id);
            if (existingFolder.parent_id !== parentItemId) {
              updateItem(existingFolder.id, { parent_id: parentItemId });
              existingFolder = getItemById(existingFolder.id) || existingFolder;
            }
            const existingFolderPreference = normalizeMangaPreference(
              existingFolder.manga_preference,
            );
            if (
              existingFolderPreference === "auto" &&
              inheritedMangaPreference !== "auto"
            ) {
              updateItem(existingFolder.id, {
                manga_preference: inheritedMangaPreference,
              });
              existingFolder = getItemById(existingFolder.id) || existingFolder;
            }
            folderId = existingFolder.id;
          }

          const nextInheritedMangaPreference = (() => {
            const folderPreference = normalizeMangaPreference(
              existingFolder?.manga_preference,
            );
            if (folderPreference !== "auto") return folderPreference;
            return inheritedMangaPreference;
          })();
          const nextScopeRootPath =
            inheritedMangaPreference !== "force_manga" &&
            nextInheritedMangaPreference === "force_manga"
              ? path.resolve(filePath)
              : scanScopeRootPath;

          addedCount += await scanLibraryFolder(
            filePath,
            folderId,
            progress,
            nextInheritedMangaPreference,
            {
              ...scanOptions,
              scanScopeRootPath: nextScopeRootPath,
            },
          );
        }
      } catch (fileErr) {
        console.error("Error processing file:", filePath, fileErr);
      }
    }
  } catch (dirErr) {
    console.error("Error reading directory:", dirPath, dirErr);
  }

  if (parentItemId !== null) {
    const folder = getItemById(parentItemId);
    if (folder && folder.type === "folder") {
      const firstCandidatePath =
        firstArchiveCandidatePath ?? firstImageCandidatePath;

      let shouldRefresh = false;
      if (!firstCandidatePath) {
        shouldRefresh = !!folder.cover_path;
      } else {
        const candidateExt = path.extname(firstCandidatePath).toLowerCase();
        const expectedCoverPath = imageExtensions.includes(candidateExt)
          ? firstCandidatePath
          : getCoverCachePath(firstCandidatePath);
        shouldRefresh = folder.cover_path !== expectedCoverPath;
      }

      if (shouldRefresh && options.refreshFolderCover) {
        await options.refreshFolderCover(parentItemId);
      }
    }
  }

  return addedCount;
}
