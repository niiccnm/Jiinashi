import { getItemSeriesId } from "./mlv-domain-core";
import type { MangaExtensionSite } from "../../../../../electron/preload/types";
import {
  getProviderTokenFromSourceId,
  getSourceHost,
  isLanguageSegment,
} from "../../../utils/source-grouping";

type ProviderLookupExtension = {
  is_enabled?: boolean | null;
  sites?: Array<Partial<MangaExtensionSite> | null> | null;
};

export type ResolvedProviderSite = {
  siteName: string;
  host: string;
  sourceIds: string[];
  preferredSourceId: string;
};

export type UnlinkedProviderTab = {
  provider: string;
  count: number;
};

export function extractProviderLabelFromChapterItem(item: any): string {
  const titleValue = String(item?.title || "").trim();
  const pathValue = String(item?.path || "").trim();
  const fileName =
    pathValue.length > 0 ? pathValue.split(/[/\\]/).at(-1) || "" : "";
  const pathSegments =
    pathValue.length > 0
      ? pathValue
          .split(/[/\\]/)
          .map((segment) => String(segment || "").trim())
          .filter(Boolean)
      : [];
  const parentSegments = pathSegments.slice(-4, -1);
  const candidates = [titleValue, fileName, ...parentSegments];
  const bracketPatterns = [
    /^[\s._-]*[\[【［]([^\]】］]+)[\]】］]/,
    /[\[【［]([^\]】］]+)[\]】］]/,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const pattern of bracketPatterns) {
      const bracketMatch = candidate.match(pattern);
      if (!bracketMatch?.[1]) continue;
      const label = bracketMatch[1]
        .trim()
        .replace(/\s+/g, " ")
        .replace(/^[-_.\s]+|[-_.\s]+$/g, "");
      if (!label) continue;
      if (label.length > 64) continue;
      return label;
    }
  }

  return "";
}

export function normalizeProviderKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function getProviderKeyFromSourceId(sourceId: unknown): string {
  return normalizeProviderKey(
    getProviderTokenFromSourceId(String(sourceId || "").trim()),
  );
}

function normalizeProviderHostKey(value: string): string {
  const host = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) {
    return normalizeProviderKey(labels[0] || host);
  }
  return normalizeProviderKey(labels.slice(0, -1).join(""));
}

function pickPreferredSourceId(sourceIds: string[]): string {
  const normalizedSourceIds = Array.from(
    new Set(
      (sourceIds || [])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    ),
  );
  if (normalizedSourceIds.length === 0) return "";

  const defaultSourceId = normalizedSourceIds.find((sourceId) => {
    const segments = sourceId.split(".").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    return !isLanguageSegment(lastSegment);
  });
  if (defaultSourceId) return defaultSourceId;

  const englishSourceId = normalizedSourceIds.find((sourceId) =>
    sourceId.toLowerCase().endsWith(".en"),
  );
  if (englishSourceId) return englishSourceId;

  return normalizedSourceIds[0] || "";
}

function getProviderSiteAliases(site: ResolvedProviderSite): string[] {
  const aliases = new Set<string>();
  const push = (value: unknown) => {
    const normalized = normalizeProviderKey(value);
    if (normalized) aliases.add(normalized);
  };

  push(site.siteName);
  push(site.host);
  push(normalizeProviderHostKey(site.host));

  for (const sourceId of site.sourceIds) {
    push(sourceId);
    push(getProviderTokenFromSourceId(sourceId));
  }

  return Array.from(aliases);
}

export function buildProviderSiteLookup(extensions: ProviderLookupExtension[]) {
  const lookup = new Map<string, ResolvedProviderSite>();

  for (const extension of Array.isArray(extensions) ? extensions : []) {
    const sites = Array.isArray(extension?.sites) ? extension.sites : [];

    for (const site of sites) {
      if (!site) continue;

      const sourceIds: string[] = Array.from(
        new Set(
          (Array.isArray(site.source_ids) ? site.source_ids : [])
            .map((entry: string | null | undefined) => String(entry || "").trim())
            .filter(Boolean),
        ),
      );
      if (sourceIds.length === 0) continue;

      const resolvedSite: ResolvedProviderSite = {
        siteName: String(site.name || "").trim(),
        host: getSourceHost(String(site.base_url || "").trim()),
        sourceIds,
        preferredSourceId: pickPreferredSourceId(sourceIds),
      };

      for (const alias of getProviderSiteAliases(resolvedSite)) {
        if (!lookup.has(alias)) {
          lookup.set(alias, resolvedSite);
        }
      }
    }
  }

  return lookup;
}

export function resolveProviderSite(
  providerLabel: unknown,
  providerSiteLookup: Map<string, ResolvedProviderSite>,
) {
  const normalizedKey = normalizeProviderKey(providerLabel);
  if (!normalizedKey) return null;
  return providerSiteLookup.get(normalizedKey) || null;
}

function getProviderHostCandidates(sourceUrl: unknown): string[] {
  const raw = String(sourceUrl || "").trim();
  if (!raw) return [];

  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    return [host, normalizeProviderHostKey(host)].filter(Boolean);
  } catch {
    return [];
  }
}

function getProviderSeriesCandidates(
  seriesItem: any,
  providerHint?: string,
): string[] {
  const rawSourceId = String(seriesItem?.source_id || "").trim();
  const sourceProviderToken = getProviderTokenFromSourceId(rawSourceId);
  const candidates = [
    String(providerHint || "").trim(),
    rawSourceId,
    sourceProviderToken,
    ...getProviderHostCandidates(seriesItem?.source_url),
  ];

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeProviderKey(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(candidate);
  }
  return deduped;
}

export function resolveProviderSiteForSeries(
  seriesItem: any,
  providerHint: string | undefined,
  providerSiteLookup: Map<string, ResolvedProviderSite>,
) {
  for (const candidate of getProviderSeriesCandidates(seriesItem, providerHint)) {
    const resolved = resolveProviderSite(candidate, providerSiteLookup);
    if (resolved) return resolved;
  }
  return null;
}

export function resolveOpenSourceProviderSite(
  seriesItem: any,
  providerHint: string | undefined,
  providerSiteLookup: Map<string, ResolvedProviderSite>,
) {
  const normalizedProviderHint = String(providerHint || "").trim();
  return normalizedProviderHint
    ? resolveProviderSite(normalizedProviderHint, providerSiteLookup)
    : resolveProviderSiteForSeries(
        seriesItem,
        normalizedProviderHint,
        providerSiteLookup,
      );
}

export function sourceUrlMatchesProviderSite(
  sourceUrl: unknown,
  providerSite: ResolvedProviderSite | null | undefined,
): boolean {
  if (!providerSite?.host) return false;

  try {
    const host = new URL(String(sourceUrl || "").trim()).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return host === providerSite.host || host.endsWith(`.${providerSite.host}`);
  } catch {
    return false;
  }
}

export function buildUnlinkedProviderTabs(chapterItems: any[]): UnlinkedProviderTab[] {
  const counts = new Map<string, UnlinkedProviderTab>();
  const allChapterItems = Array.isArray(chapterItems) ? chapterItems : [];

  for (const item of allChapterItems) {
    if (String(item?.type || "") === "folder") continue;
    if (getItemSeriesId(item) > 0) continue;

    const provider = extractProviderLabelFromChapterItem(item);
    const key = normalizeProviderKey(provider);
    if (!key) continue;

    const existing = counts.get(key);
    if (existing) {
      existing.count = Number(existing.count || 0) + 1;
      continue;
    }
    counts.set(key, { provider, count: 1 });
  }

  return [...counts.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.provider.localeCompare(b.provider, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

export function buildChapterProviderBySeries(
  chapterItems: any[],
  scopedSeriesIdSet: Set<number>,
): Record<number, string> {
  const providerCountsBySeries = new Map<number, Map<string, number>>();
  const allChapterItems = (Array.isArray(chapterItems) ? chapterItems : []).filter(
    (item) => String(item?.type || "") !== "folder",
  );
  const parentSeriesCandidates = new Map<number, Set<number>>();

  for (const item of allChapterItems) {
    const directSeriesId = getItemSeriesId(item);
    if (!directSeriesId) continue;
    if (scopedSeriesIdSet.size > 0 && !scopedSeriesIdSet.has(directSeriesId)) {
      continue;
    }
    const parentId = Number(item?.parent_id || 0);
    if (!Number.isFinite(parentId) || parentId <= 0) continue;
    const knownSeries = parentSeriesCandidates.get(parentId) || new Set<number>();
    knownSeries.add(directSeriesId);
    parentSeriesCandidates.set(parentId, knownSeries);
  }

  for (const item of allChapterItems) {
    let seriesId = getItemSeriesId(item);
    if (!seriesId) {
      const parentId = Number(item?.parent_id || 0);
      const siblingSeries = parentSeriesCandidates.get(parentId);
      if (siblingSeries && siblingSeries.size === 1) {
        seriesId = [...siblingSeries][0] || 0;
      }
    }
    if (!seriesId) continue;
    if (scopedSeriesIdSet.size > 0 && !scopedSeriesIdSet.has(seriesId)) {
      continue;
    }

    const provider = extractProviderLabelFromChapterItem(item);
    if (!provider) continue;
    const seriesMap = providerCountsBySeries.get(seriesId) || new Map<string, number>();
    seriesMap.set(provider, Number(seriesMap.get(provider) || 0) + 1);
    providerCountsBySeries.set(seriesId, seriesMap);
  }

  const resolved: Record<number, string> = {};
  for (const [seriesId, counts] of providerCountsBySeries.entries()) {
    const best = [...counts.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0], undefined, {
        sensitivity: "base",
        numeric: true,
      });
    })[0];
    if (!best?.[0]) continue;
    resolved[seriesId] = best[0];
  }

  return resolved;
}

export function filterUnlinkedChapterItemsByProvider(
  chapterItems: any[],
  selectedProvider: string,
): any[] {
  const selectedProviderKey = normalizeProviderKey(selectedProvider);
  if (!selectedProviderKey) return Array.isArray(chapterItems) ? chapterItems : [];

  const allChapterItems = Array.isArray(chapterItems) ? chapterItems : [];
  return allChapterItems.filter((item) => {
    if (String(item?.type || "") === "folder") return false;
    if (getItemSeriesId(item) > 0) return false;
    return (
      normalizeProviderKey(extractProviderLabelFromChapterItem(item)) ===
      selectedProviderKey
    );
  });
}
