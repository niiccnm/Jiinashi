import path from "path";
import {
  getAllItemsFlat,
  getDownloadHistoryByPath,
  getItemById,
  updateItem,
} from "../../database/database";
import type { LibraryItem } from "../../database/database";
import * as mangaQueries from "../../database/queries/manga";
import {
  type MangaLinkHealResult,
  type MangaPreference,
  type PendingMangaLinkItem,
  normalizeMangaPreference,
  toPositiveInt,
} from "./contracts";
import {
  deriveScanSeriesAnchorFolder,
  deriveSeriesAnchorFromScanRoot,
  deriveStructuralScopeRootForFile,
  isPathUnderRoot,
  normalizePathForKey,
  normalizePathForStore,
} from "./scope-utils";

function resolveSeriesIdFromDownloadEvidence(filePath: string): number {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) return 0;
  const fromDownloadPath = toPositiveInt(
    mangaQueries.getMangaSeriesIdByChapterDownloadPath(normalizedPath),
  );
  if (fromDownloadPath > 0 && mangaQueries.getMangaSeries(fromDownloadPath)) {
    return fromDownloadPath;
  }
  const history = getDownloadHistoryByPath(normalizedPath);
  const historyUrl = String(history?.url || "").trim();
  if (!historyUrl) return 0;
  const byHistory = toPositiveInt(
    mangaQueries.getMangaSeriesIdByChapterSourceUrl(historyUrl),
  );
  if (byHistory > 0 && mangaQueries.getMangaSeries(byHistory)) {
    return byHistory;
  }
  return 0;
}

function buildItemIndexForPreferenceWalk(items: LibraryItem[]): Map<number, LibraryItem> {
  const out = new Map<number, LibraryItem>();
  for (const item of items) {
    const id = toPositiveInt(item?.id);
    if (id <= 0) continue;
    out.set(id, item);
  }
  return out;
}

function resolveEffectiveMangaPreferenceForItem(
  item: LibraryItem,
  itemIndex: Map<number, LibraryItem>,
  cache: Map<number, MangaPreference>,
): MangaPreference {
  const itemId = toPositiveInt(item?.id);
  if (itemId > 0 && cache.has(itemId)) {
    return cache.get(itemId)!;
  }

  const direct = normalizeMangaPreference(item.manga_preference);
  if (direct !== "auto") {
    if (itemId > 0) cache.set(itemId, direct);
    return direct;
  }

  const visited = new Set<number>();
  if (itemId > 0) visited.add(itemId);

  let parentId = toPositiveInt(item.parent_id);
  let effective: MangaPreference = "auto";
  while (parentId > 0 && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = itemIndex.get(parentId);
    if (!parent) break;

    const cached = cache.get(parentId);
    if (cached) {
      effective = cached;
      break;
    }

    const parentPreference = normalizeMangaPreference(parent.manga_preference);
    if (parentPreference !== "auto") {
      effective = parentPreference;
      break;
    }

    parentId = toPositiveInt(parent.parent_id);
  }

  if (itemId > 0) cache.set(itemId, effective);
  return effective;
}

function resolveScopeRootPathForValidationItem(
  item: LibraryItem,
  itemIndex: Map<number, LibraryItem>,
  effectivePreferenceCache: Map<number, MangaPreference>,
  fallbackRoot: string,
): string {
  const normalizedFallback = normalizePathForStore(fallbackRoot);
  const visited = new Set<number>();
  let parentId = toPositiveInt(item.parent_id);
  let preferenceScopeRootPath = "";

  while (parentId > 0 && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = itemIndex.get(parentId);
    if (!parent) break;

    const parentEffective = resolveEffectiveMangaPreferenceForItem(
      parent,
      itemIndex,
      effectivePreferenceCache,
    );
    const parentParent = toPositiveInt(parent.parent_id);
    const parentParentItem = parentParent > 0 ? itemIndex.get(parentParent) : null;
    const parentParentEffective = parentParentItem
      ? resolveEffectiveMangaPreferenceForItem(
          parentParentItem,
          itemIndex,
          effectivePreferenceCache,
        )
      : "auto";

    if (parent.type === "folder" && parentEffective === "force_manga") {
      const normalizedParentPath = normalizePathForStore(parent.path);
      if (normalizedParentPath) {
        if (parentParentEffective !== "force_manga") {
          preferenceScopeRootPath = normalizedParentPath;
        }
      }
    }

    parentId = parentParent;
  }

  const preferenceScopeCandidate = normalizePathForStore(preferenceScopeRootPath);
  const structuralScopeCandidate = deriveStructuralScopeRootForFile(
    item.path,
    normalizedFallback,
  );

  const hasPreferenceScope =
    Boolean(preferenceScopeCandidate) &&
    isPathUnderRoot(item.path, preferenceScopeCandidate);
  const hasStructuralScope =
    Boolean(structuralScopeCandidate) &&
    isPathUnderRoot(item.path, structuralScopeCandidate);

  if (hasPreferenceScope && hasStructuralScope) {
    const preferenceNarrower = isPathUnderRoot(
      preferenceScopeCandidate!,
      structuralScopeCandidate!,
    );
    const structuralNarrower = isPathUnderRoot(
      structuralScopeCandidate!,
      preferenceScopeCandidate!,
    );
    if (preferenceNarrower && !structuralNarrower) return preferenceScopeCandidate!;
    if (structuralNarrower && !preferenceNarrower) return structuralScopeCandidate!;
    return preferenceScopeCandidate!;
  }

  if (hasPreferenceScope) return preferenceScopeCandidate!;
  if (hasStructuralScope) return structuralScopeCandidate!;
  if (normalizedFallback && isPathUnderRoot(item.path, normalizedFallback)) {
    return normalizedFallback;
  }
  return deriveScanSeriesAnchorFolder(item.path);
}

type HealerCandidate = {
  itemId: number;
  itemPath: string;
  rawTitle: string;
  seriesId: number;
  scanRootPath: string;
  scopeRootPath: string;
  seriesAnchorPath: string;
  parentScopePath: string;
  evidenceSeriesId: number;
};

export function healContaminatedSeriesLinksForRoot(options: {
  scanRootPath: string;
  scanSessionId?: string | null;
}): MangaLinkHealResult {
  const normalizedRoot = normalizePathForStore(options.scanRootPath);
  const scanSessionId = String(options.scanSessionId || "").trim() || "rescan-heal";
  if (!normalizedRoot) {
    return {
      validatedCandidates: 0,
      contaminatedGroups: 0,
      clearedItems: 0,
      evidenceKeeps: 0,
      clearedItemIds: [],
      pendingItems: [],
    };
  }

  const allItems = getAllItemsFlat();
  const itemIndex = buildItemIndexForPreferenceWalk(allItems);
  const effectivePreferenceCache = new Map<number, MangaPreference>();
  const candidates: HealerCandidate[] = [];

  for (const item of allItems) {
    if (item.type !== "book") continue;
    if (!isPathUnderRoot(item.path, normalizedRoot)) continue;
    if (
      resolveEffectiveMangaPreferenceForItem(
        item,
        itemIndex,
        effectivePreferenceCache,
      ) === "force_non_manga"
    ) {
      continue;
    }

    const seriesId = toPositiveInt(item.manga_series_id);
    if (seriesId <= 0) continue;

    const scopeRootPath = resolveScopeRootPathForValidationItem(
      item,
      itemIndex,
      effectivePreferenceCache,
      normalizedRoot,
    );
    const seriesAnchorPath = deriveSeriesAnchorFromScanRoot(item.path, scopeRootPath);
    const parentScopePath =
      normalizePathForStore(path.dirname(seriesAnchorPath)) || scopeRootPath;
    candidates.push({
      itemId: item.id,
      itemPath: item.path,
      rawTitle: String(item.title || "").trim(),
      seriesId,
      scanRootPath: normalizedRoot,
      scopeRootPath,
      seriesAnchorPath,
      parentScopePath,
      evidenceSeriesId: resolveSeriesIdFromDownloadEvidence(item.path),
    });
  }

  const groupedByParentScopeAndSeries = new Map<string, HealerCandidate[]>();
  for (const candidate of candidates) {
    const key =
      `${normalizePathForKey(candidate.parentScopePath)}::${String(candidate.seriesId)}`;
    if (!groupedByParentScopeAndSeries.has(key)) {
      groupedByParentScopeAndSeries.set(key, []);
    }
    groupedByParentScopeAndSeries.get(key)!.push(candidate);
  }

  const contaminatedGroupKeys = new Set<string>();
  for (const [groupKey, grouped] of groupedByParentScopeAndSeries.entries()) {
    const uniqueAnchors = new Set(
      grouped.map((entry) => normalizePathForKey(entry.seriesAnchorPath)),
    );
    if (uniqueAnchors.size > 1) {
      contaminatedGroupKeys.add(groupKey);
    }
  }

  const clearedItemIds: number[] = [];
  const pendingItems: PendingMangaLinkItem[] = [];
  let evidenceKeeps = 0;
  for (const candidate of candidates) {
    const groupKey =
      `${normalizePathForKey(candidate.parentScopePath)}::${String(candidate.seriesId)}`;
    if (
      candidate.evidenceSeriesId > 0 &&
      candidate.evidenceSeriesId === candidate.seriesId
    ) {
      evidenceKeeps += 1;
      continue;
    }
    if (!contaminatedGroupKeys.has(groupKey)) continue;

    const item = getItemById(candidate.itemId);
    if (!item || item.type !== "book") continue;
    if (toPositiveInt(item.manga_series_id) !== candidate.seriesId) continue;

    updateItem(item.id, { manga_series_id: null });
    clearedItemIds.push(item.id);
    pendingItems.push({
      itemId: item.id,
      itemPath: candidate.itemPath,
      rawTitle: candidate.rawTitle,
      scanSessionId,
      scanRootPath: candidate.scanRootPath,
      scanScopeRootPath: candidate.parentScopePath,
    });
  }

  const result: MangaLinkHealResult = {
    validatedCandidates: candidates.length,
    contaminatedGroups: contaminatedGroupKeys.size,
    clearedItems: clearedItemIds.length,
    evidenceKeeps,
    clearedItemIds,
    pendingItems,
  };
  console.log(
    `[MangaLinker][Heal] session=${scanSessionId} root=${normalizedRoot} validatedCandidates=${result.validatedCandidates} contaminatedGroups=${result.contaminatedGroups} clearedItems=${result.clearedItems} evidenceKeeps=${result.evidenceKeeps}`,
  );
  return result;
}
