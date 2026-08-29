import path from "path";
import { getItemById } from "../../database/database";
import {
  type PendingMangaLinkGroup,
  type PendingMangaLinkItem,
  toPositiveInt,
} from "./contracts";
import {
  firstMeaningfulTitle,
  inferItemTitleFromPath,
  inferMangaLinkTitle,
  isMeaningfulTitleToken,
  normalizeTitleForCompare,
  uniqueStrings,
} from "./title-utils";

export function normalizePathForKey(input: unknown): string {
  const normalized = String(input || "").trim();
  if (!normalized) return "";
  return path
    .resolve(normalized)
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

export function normalizePathForStore(input: unknown): string {
  const normalized = String(input || "").trim();
  if (!normalized) return "";
  return path.resolve(normalized);
}

export function isPathUnderRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = normalizePathForKey(targetPath);
  const normalizedRoot = normalizePathForKey(rootPath);
  if (!normalizedTarget || !normalizedRoot) return false;
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}/`)
  );
}

export function findBestRootForPath(
  itemPath: string,
  candidateRoots: string[],
): string | null {
  const normalizedItem = normalizePathForKey(itemPath);
  let bestRoot = "";
  for (const candidate of candidateRoots) {
    const normalizedCandidate = normalizePathForStore(candidate);
    if (!normalizedCandidate) continue;
    if (!isPathUnderRoot(normalizedItem, normalizedCandidate)) continue;
    if (
      !bestRoot ||
      normalizePathForKey(normalizedCandidate).length >
        normalizePathForKey(bestRoot).length
    ) {
      bestRoot = normalizedCandidate;
    }
  }
  return bestRoot || null;
}

export function deriveScanSeriesAnchorFolder(filePath: string): string {
  const normalizedFilePath = normalizePathForStore(filePath);
  if (!normalizedFilePath) return "";
  if (!path.extname(normalizedFilePath)) return normalizedFilePath;
  return path.dirname(normalizedFilePath);
}

export function deriveSeriesAnchorFromScanRoot(
  filePath: string,
  scanRootPath: string,
): string {
  const normalizedFilePath = normalizePathForStore(filePath);
  const normalizedScanRoot = normalizePathForStore(scanRootPath);
  if (!normalizedFilePath) return deriveScanSeriesAnchorFolder(filePath);
  if (!normalizedScanRoot || !isPathUnderRoot(normalizedFilePath, normalizedScanRoot)) {
    return deriveScanSeriesAnchorFolder(filePath);
  }
  const fileFolder = deriveScanSeriesAnchorFolder(normalizedFilePath);
  const relativeFolder = path.relative(normalizedScanRoot, fileFolder);
  const firstSegment = String(relativeFolder || "")
    .split(path.sep)
    .filter(Boolean)[0];
  if (!firstSegment) return normalizedScanRoot;
  return path.resolve(normalizedScanRoot, firstSegment);
}

export function deriveStructuralScopeRootForFile(
  filePath: string,
  scanRootPath: string,
): string {
  const normalizedScanRoot = normalizePathForStore(scanRootPath);
  const normalizedFilePath = normalizePathForStore(filePath);
  if (!normalizedFilePath) return normalizedScanRoot || "";
  const fallbackRoot =
    (normalizedScanRoot && isPathUnderRoot(normalizedFilePath, normalizedScanRoot)
      ? normalizedScanRoot
      : "") || deriveScanSeriesAnchorFolder(filePath);
  const seriesAnchorPath = deriveScanSeriesAnchorFolder(filePath);
  if (!seriesAnchorPath) return fallbackRoot;
  const candidateScopeRoot = normalizePathForStore(path.dirname(seriesAnchorPath));
  if (!candidateScopeRoot) return fallbackRoot;
  if (
    normalizedScanRoot &&
    isPathUnderRoot(candidateScopeRoot, normalizedScanRoot) &&
    isPathUnderRoot(seriesAnchorPath, candidateScopeRoot)
  ) {
    return candidateScopeRoot;
  }
  if (isPathUnderRoot(seriesAnchorPath, fallbackRoot)) {
    return fallbackRoot;
  }
  return fallbackRoot;
}

export function resolvePendingScopeRootPathForFile(options: {
  itemPath: string;
  scanRootPath?: string | null;
  scanScopeRootPath?: string | null;
}): string {
  const itemPath = normalizePathForStore(options.itemPath);
  if (!itemPath) return "";
  const hintedScopeRootPath = normalizePathForStore(options.scanScopeRootPath);
  const hintedScanRootPath = normalizePathForStore(options.scanRootPath);
  if (hintedScopeRootPath && isPathUnderRoot(itemPath, hintedScopeRootPath)) {
    return hintedScopeRootPath;
  }
  const structuralScopeRootPath = deriveStructuralScopeRootForFile(
    itemPath,
    hintedScanRootPath || hintedScopeRootPath || "",
  );
  if (structuralScopeRootPath && isPathUnderRoot(itemPath, structuralScopeRootPath)) {
    return structuralScopeRootPath;
  }
  const fallbackRoot = findBestRootForPath(itemPath, [
    hintedScanRootPath,
    structuralScopeRootPath,
  ]);
  if (fallbackRoot) return fallbackRoot;
  return deriveScanSeriesAnchorFolder(itemPath);
}

export function buildRootScopedGroupKey(
  scanRootPath: string,
  anchorFolderPath: string,
): string {
  return `scan-root::${normalizePathForKey(scanRootPath)}::anchor::${normalizePathForKey(anchorFolderPath)}`;
}

export function buildDeferredDedupeKey(group: PendingMangaLinkGroup): string {
  return `${normalizePathForKey(group.scanRootPath || "")}::${group.groupKey}`;
}

function mergePendingGroup(
  groups: Map<string, PendingMangaLinkGroup>,
  group: PendingMangaLinkGroup,
) {
  const existing = groups.get(group.groupKey);
  if (!existing) {
    groups.set(group.groupKey, {
      ...group,
      itemIds: Array.from(new Set(group.itemIds)),
      itemPaths: Array.from(new Set(group.itemPaths)),
      titleCandidates: uniqueStrings(group.titleCandidates),
    });
    return;
  }

  const mergedItemIds = Array.from(new Set([...existing.itemIds, ...group.itemIds]));
  const mergedItemPaths = Array.from(
    new Set([...existing.itemPaths, ...group.itemPaths]),
  );
  const mergedTitleCandidates = uniqueStrings([
    ...existing.titleCandidates,
    ...group.titleCandidates,
  ]);
  groups.set(group.groupKey, {
    ...existing,
    scanSessionId: existing.scanSessionId || group.scanSessionId || null,
    scanRootPath: existing.scanRootPath || group.scanRootPath || null,
    seriesAnchorPath: existing.seriesAnchorPath || group.seriesAnchorPath || null,
    folderPath: existing.folderPath || group.folderPath,
    preferredTitle: existing.preferredTitle || group.preferredTitle,
    itemIds: mergedItemIds,
    itemPaths: mergedItemPaths,
    titleCandidates: mergedTitleCandidates,
  });
}

export function buildPendingMangaLinkGroups(
  items: PendingMangaLinkItem[],
): PendingMangaLinkGroup[] {
  type Candidate = {
    itemId: number;
    itemPath: string;
    scanSessionId: string | null;
    scanRootPath: string;
    scopeRootPath: string;
    seriesAnchorPath: string;
    inferredTitle: string;
    meaningfulKey: string;
    rootTitle: string;
    anchorTitle: string;
  };

  const dedupedByItemId = new Map<number, PendingMangaLinkItem>();
  for (const entry of items) {
    const itemId = toPositiveInt(entry?.itemId);
    const itemPath = String(entry?.itemPath || "").trim();
    if (itemId <= 0 || !itemPath) continue;
    const scanSessionId = String(entry?.scanSessionId || "").trim() || null;
    const scanRootPathHint = String(entry?.scanRootPath || "").trim();
    const scanScopeRootPathHint = String(entry?.scanScopeRootPath || "").trim();
    const normalizedScopeRootPath = resolvePendingScopeRootPathForFile({
      itemPath,
      scanRootPath: scanRootPathHint,
      scanScopeRootPath: scanScopeRootPathHint,
    });
    const normalizedScanRootPath =
      findBestRootForPath(itemPath, [
        scanRootPathHint,
        normalizedScopeRootPath,
      ]) ||
      normalizedScopeRootPath ||
      deriveScanSeriesAnchorFolder(itemPath);
    if (!dedupedByItemId.has(itemId)) {
      dedupedByItemId.set(itemId, {
        itemId,
        itemPath: path.resolve(itemPath),
        rawTitle: String(entry?.rawTitle || "").trim() || null,
        scanSessionId,
        scanRootPath: normalizedScanRootPath,
        scanScopeRootPath: normalizedScopeRootPath || normalizedScanRootPath,
      });
    }
  }

  const byAnchor = new Map<string, Candidate[]>();
  for (const entry of dedupedByItemId.values()) {
    const scopeRootPath = resolvePendingScopeRootPathForFile({
      itemPath: entry.itemPath,
      scanRootPath: entry.scanRootPath,
      scanScopeRootPath: entry.scanScopeRootPath,
    });
    const scanRootPath = scopeRootPath;
    const seriesAnchorPath = deriveSeriesAnchorFromScanRoot(entry.itemPath, scanRootPath);
    const inferredTitle = inferItemTitleFromPath(entry.itemPath, entry.rawTitle);
    const meaningfulKey = isMeaningfulTitleToken(inferredTitle)
      ? normalizeTitleForCompare(inferredTitle)
      : "";
    const candidate: Candidate = {
      itemId: entry.itemId,
      itemPath: entry.itemPath,
      scanSessionId: String(entry.scanSessionId || "").trim() || null,
      scanRootPath,
      scopeRootPath,
      seriesAnchorPath,
      inferredTitle,
      meaningfulKey,
      rootTitle: inferMangaLinkTitle(path.basename(scanRootPath)),
      anchorTitle: inferMangaLinkTitle(path.basename(seriesAnchorPath)),
    };
    const bucketKey =
      `${String(candidate.scanSessionId || "").toLowerCase()}::` +
      `${normalizePathForKey(candidate.scopeRootPath)}::` +
      normalizePathForKey(candidate.seriesAnchorPath);
    if (!byAnchor.has(bucketKey)) byAnchor.set(bucketKey, []);
    byAnchor.get(bucketKey)!.push(candidate);
  }

  const groups = new Map<string, PendingMangaLinkGroup>();
  for (const entries of byAnchor.values()) {
    if (entries.length === 0) continue;
    const representative = entries[0];
    const scanSessionId = representative.scanSessionId;
    const scanRootPath = representative.scanRootPath;
    const seriesAnchorPath = representative.seriesAnchorPath;
    const baseGroupKey = buildRootScopedGroupKey(scanRootPath, seriesAnchorPath);
    const meaningful = Array.from(
      new Set(entries.map((entry) => entry.meaningfulKey).filter(Boolean)),
    );
    const isFlatAtRoot =
      normalizePathForKey(scanRootPath) === normalizePathForKey(seriesAnchorPath);
    const isSubfolderGroup = !isFlatAtRoot;
    const shouldSplitMixedFlatFolder = isFlatAtRoot && meaningful.length >= 2;

    if (!shouldSplitMixedFlatFolder) {
      const hasMeaningfulItemTitle = entries.some((entry) =>
        isMeaningfulTitleToken(entry.inferredTitle),
      );
      const primaryContextTitle = isSubfolderGroup ? "anchorTitle" : "rootTitle";
      const secondaryContextTitle = isSubfolderGroup ? "rootTitle" : "anchorTitle";
      const preferredTitle =
        (!hasMeaningfulItemTitle &&
          firstMeaningfulTitle(
            entries.map((entry) => entry[primaryContextTitle]),
          )) ||
        firstMeaningfulTitle(entries.map((entry) => entry[primaryContextTitle])) ||
        firstMeaningfulTitle(
          entries.map((entry) => entry[secondaryContextTitle]),
        ) ||
        firstMeaningfulTitle(entries.map((entry) => entry.inferredTitle)) ||
        String(representative[primaryContextTitle] || "").trim() ||
        String(representative[secondaryContextTitle] || "").trim() ||
        inferMangaLinkTitle(path.basename(seriesAnchorPath));
      const titleCandidates = uniqueStrings([
        ...(isSubfolderGroup
          ? [representative.anchorTitle, representative.rootTitle]
          : [representative.rootTitle, representative.anchorTitle]),
        preferredTitle,
        ...(isSubfolderGroup
          ? entries.map((entry) => entry.anchorTitle)
          : entries.map((entry) => entry.rootTitle)),
        ...(isSubfolderGroup
          ? entries.map((entry) => entry.rootTitle)
          : entries.map((entry) => entry.anchorTitle)),
        ...entries.map((entry) => entry.inferredTitle),
      ]);
      mergePendingGroup(groups, {
        groupKey: baseGroupKey,
        folderPath: seriesAnchorPath,
        itemIds: entries.map((entry) => entry.itemId),
        itemPaths: entries.map((entry) => entry.itemPath),
        preferredTitle: preferredTitle || null,
        titleCandidates,
        scanSessionId,
        scanRootPath,
        seriesAnchorPath,
      });
      continue;
    }

    for (const entry of entries) {
      const subgroupKey =
        entry.meaningfulKey || `generic-${String(entry.itemId || "").trim()}`;
      const groupKey = `${baseGroupKey}::${subgroupKey}`;
      const primaryContextTitle = isSubfolderGroup ? entry.anchorTitle : entry.rootTitle;
      const secondaryContextTitle = isSubfolderGroup
        ? entry.rootTitle
        : entry.anchorTitle;
      const preferredTitle =
        entry.meaningfulKey && isMeaningfulTitleToken(entry.inferredTitle)
          ? entry.inferredTitle
          : primaryContextTitle ||
            secondaryContextTitle ||
            inferMangaLinkTitle(path.basename(seriesAnchorPath));
      const titleCandidates = uniqueStrings([
        primaryContextTitle,
        secondaryContextTitle,
        preferredTitle,
        entry.inferredTitle,
      ]);
      mergePendingGroup(groups, {
        groupKey,
        folderPath: seriesAnchorPath,
        itemIds: [entry.itemId],
        itemPaths: [entry.itemPath],
        preferredTitle: preferredTitle || null,
        titleCandidates,
        scanSessionId: entry.scanSessionId,
        scanRootPath: entry.scanRootPath,
        seriesAnchorPath: entry.seriesAnchorPath,
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.groupKey.localeCompare(b.groupKey),
  );
}

function resolveRootAndAnchorForItemPath(
  itemPath: string,
  group: PendingMangaLinkGroup,
): { scanRootPath: string; seriesAnchorPath: string } {
  const fallbackAnchor = deriveScanSeriesAnchorFolder(itemPath);
  const hintedRoot = normalizePathForStore(group.scanRootPath) || "";
  const scanRootPath =
    (hintedRoot && isPathUnderRoot(itemPath, hintedRoot) ? hintedRoot : "") ||
    fallbackAnchor;
  const seriesAnchorPath = deriveSeriesAnchorFromScanRoot(itemPath, scanRootPath);
  return {
    scanRootPath,
    seriesAnchorPath: seriesAnchorPath || fallbackAnchor,
  };
}

function getIndexedItemPath(
  group: PendingMangaLinkGroup,
  index: number,
  itemId: number,
): string {
  const direct = String(group.itemPaths[index] || "").trim();
  if (direct) return direct;
  const item = getItemById(itemId);
  return String(item?.path || "").trim();
}

export function isPendingGroupHomogeneous(group: PendingMangaLinkGroup): boolean {
  let expectedRoot = normalizePathForKey(group.scanRootPath || "");
  let expectedAnchor = normalizePathForKey(
    group.seriesAnchorPath || group.folderPath || "",
  );
  for (let i = 0; i < group.itemIds.length; i += 1) {
    const itemPath = getIndexedItemPath(group, i, group.itemIds[i]);
    if (!itemPath) continue;
    const scoped = resolveRootAndAnchorForItemPath(itemPath, group);
    const rootKey = normalizePathForKey(scoped.scanRootPath);
    const anchorKey = normalizePathForKey(scoped.seriesAnchorPath);
    if (!expectedRoot) expectedRoot = rootKey;
    if (!expectedAnchor) expectedAnchor = anchorKey;
    if (rootKey !== expectedRoot || anchorKey !== expectedAnchor) {
      return false;
    }
  }
  return true;
}

export function splitPendingGroupByRootAndAnchor(
  group: PendingMangaLinkGroup,
): PendingMangaLinkGroup[] {
  const buckets = new Map<
    string,
    {
      scanRootPath: string;
      seriesAnchorPath: string;
      itemIds: number[];
      itemPaths: string[];
      inferredTitles: string[];
    }
  >();

  for (let i = 0; i < group.itemIds.length; i += 1) {
    const itemId = toPositiveInt(group.itemIds[i]);
    if (itemId <= 0) continue;
    const itemPath = getIndexedItemPath(group, i, itemId);
    if (!itemPath) continue;
    const scoped = resolveRootAndAnchorForItemPath(itemPath, group);
    const bucketKey =
      `${normalizePathForKey(scoped.scanRootPath)}::` +
      normalizePathForKey(scoped.seriesAnchorPath);
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        scanRootPath: scoped.scanRootPath,
        seriesAnchorPath: scoped.seriesAnchorPath,
        itemIds: [],
        itemPaths: [],
        inferredTitles: [],
      });
    }
    const bucket = buckets.get(bucketKey)!;
    bucket.itemIds.push(itemId);
    bucket.itemPaths.push(itemPath);
    bucket.inferredTitles.push(
      inferItemTitleFromPath(itemPath, path.basename(itemPath, path.extname(itemPath))),
    );
  }

  const out: PendingMangaLinkGroup[] = [];
  for (const bucket of buckets.values()) {
    const rootTitle = inferMangaLinkTitle(path.basename(bucket.scanRootPath));
    const anchorTitle = inferMangaLinkTitle(path.basename(bucket.seriesAnchorPath));
    const isRootLevelBucket =
      normalizePathForKey(bucket.scanRootPath) ===
      normalizePathForKey(bucket.seriesAnchorPath);
    const hasMeaningfulInferred = bucket.inferredTitles.some((title) =>
      isMeaningfulTitleToken(title),
    );
    const primaryContextTitle = isRootLevelBucket ? rootTitle : anchorTitle;
    const secondaryContextTitle = isRootLevelBucket ? anchorTitle : rootTitle;
    const preferredTitle =
      (!hasMeaningfulInferred &&
        isMeaningfulTitleToken(primaryContextTitle) &&
        primaryContextTitle) ||
      (isMeaningfulTitleToken(primaryContextTitle) && primaryContextTitle) ||
      (isMeaningfulTitleToken(secondaryContextTitle) && secondaryContextTitle) ||
      bucket.inferredTitles.find((title) => isMeaningfulTitleToken(title)) ||
      primaryContextTitle ||
      secondaryContextTitle ||
      group.preferredTitle ||
      null;
    const titleCandidates = uniqueStrings([
      primaryContextTitle,
      secondaryContextTitle,
      preferredTitle,
      ...bucket.inferredTitles,
      ...(group.titleCandidates || []),
    ]);
    out.push({
      groupKey: buildRootScopedGroupKey(bucket.scanRootPath, bucket.seriesAnchorPath),
      folderPath: bucket.seriesAnchorPath,
      itemIds: Array.from(new Set(bucket.itemIds)),
      itemPaths: Array.from(new Set(bucket.itemPaths)),
      preferredTitle,
      titleCandidates,
      scanSessionId: group.scanSessionId,
      scanRootPath: bucket.scanRootPath,
      seriesAnchorPath: bucket.seriesAnchorPath,
    });
  }
  return out;
}

export function mergeDeferredJobGroup(
  left: PendingMangaLinkGroup,
  right: PendingMangaLinkGroup,
): PendingMangaLinkGroup {
  return {
    groupKey: left.groupKey,
    scanSessionId: left.scanSessionId || right.scanSessionId,
    scanRootPath: left.scanRootPath || right.scanRootPath,
    seriesAnchorPath: left.seriesAnchorPath || right.seriesAnchorPath,
    folderPath: left.folderPath || right.folderPath,
    preferredTitle: left.preferredTitle || right.preferredTitle,
    itemIds: Array.from(new Set([...left.itemIds, ...right.itemIds])),
    itemPaths: Array.from(new Set([...left.itemPaths, ...right.itemPaths])),
    titleCandidates: uniqueStrings([...left.titleCandidates, ...right.titleCandidates]),
  };
}

export function normalizePendingGroup(
  group: PendingMangaLinkGroup,
): PendingMangaLinkGroup | null {
  const itemIds = Array.from(
    new Set((group.itemIds || []).map((id) => toPositiveInt(id)).filter(Boolean)),
  );
  const itemPaths = uniqueStrings(group.itemPaths || []);
  if (itemIds.length === 0 || itemPaths.length === 0) return null;
  const titleCandidates = uniqueStrings(group.titleCandidates || []);
  const preferredTitle = String(group.preferredTitle || "").trim() || null;
  const normalizedScanRootPath = normalizePathForStore(group.scanRootPath);
  const normalizedSeriesAnchorPath = normalizePathForStore(
    group.seriesAnchorPath || group.folderPath || "",
  );
  return {
    groupKey: String(group.groupKey || "").trim(),
    scanSessionId: String(group.scanSessionId || "").trim() || null,
    scanRootPath: normalizedScanRootPath || null,
    seriesAnchorPath: normalizedSeriesAnchorPath || null,
    folderPath:
      normalizedSeriesAnchorPath || String(group.folderPath || "").trim() || null,
    itemIds,
    itemPaths,
    preferredTitle,
    titleCandidates,
  };
}
