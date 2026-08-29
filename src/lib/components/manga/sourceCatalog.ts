import type { MangaSourceDescriptor } from "../../../../electron/preload/types";
import {
  getBaseSourceName,
  getSourceGroupId,
  humanizeSourceId,
} from "../../utils/source-grouping";

export interface SourceCatalogVariant {
  id: string;
  lang: string;
  label: string;
  source: MangaSourceDescriptor;
}

export interface SourceCatalogGroup {
  id: string;
  name: string;
  iconUrl?: string;
  baseUrl?: string;
  firstIndex: number;
  variants: SourceCatalogVariant[];
}

export interface SourceBadge {
  label: string;
  iconUrl?: string;
  sourceId: string;
}

export function buildSourceGroups(
  rawSources: MangaSourceDescriptor[],
  selectedVariantByGroup: Record<string, string> = {},
) {
  const map = new Map<string, SourceCatalogGroup>();

  for (const [index, source] of rawSources.entries()) {
    const groupId = getSourceGroupId(source);
    const existing = map.get(groupId);
    const variant: SourceCatalogVariant = {
      id: source.id,
      lang: source.lang || "en",
      label: (source.lang || "en").toUpperCase(),
      source,
    };

    if (!existing) {
      map.set(groupId, {
        id: groupId,
        name: getBaseSourceName(source),
        iconUrl: source.iconUrl,
        baseUrl: source.baseUrl,
        firstIndex: index,
        variants: [variant],
      });
      continue;
    }

    existing.variants.push(variant);
    if (!existing.iconUrl && source.iconUrl) {
      existing.iconUrl = source.iconUrl;
    }
    if (!existing.baseUrl && source.baseUrl) {
      existing.baseUrl = source.baseUrl;
    }
  }

  const preferredVariantByGroup: Record<string, string> = {};
  const groups = Array.from(map.values())
    .map((group) => {
      group.variants.sort((a, b) => {
        if (a.lang === "en") return -1;
        if (b.lang === "en") return 1;
        return a.label.localeCompare(b.label);
      });

      preferredVariantByGroup[group.id] =
        selectedVariantByGroup[group.id] &&
        group.variants.some(
          (variant) => variant.id === selectedVariantByGroup[group.id],
        )
          ? selectedVariantByGroup[group.id]
          : (group.variants.find((variant) => variant.lang === "en")?.id ??
            group.variants[0]?.id ??
            "");

      return group;
    })
    .sort((a, b) => a.firstIndex - b.firstIndex);

  return {
    groups,
    preferredVariantByGroup,
  };
}

export function resolveSourceId(
  groupId: string,
  sourceGroups: SourceCatalogGroup[],
  selectedVariantByGroup: Record<string, string>,
  forcedSourceId?: string,
) {
  const group = sourceGroups.find((entry) => entry.id === groupId);
  if (!group) return "";
  const wantedSourceId = forcedSourceId || selectedVariantByGroup[groupId];
  return (
    group.variants.find((variant) => variant.id === wantedSourceId)?.id ||
    group.variants.find((variant) => variant.lang === "en")?.id ||
    group.variants[0]?.id ||
    ""
  );
}

export function createSourceBadgeLookup(rawSources: MangaSourceDescriptor[]) {
  const { groups } = buildSourceGroups(rawSources);
  const lookup = new Map<string, SourceBadge>();

  for (const group of groups) {
    for (const variant of group.variants) {
      lookup.set(variant.id, {
        label: group.name,
        iconUrl: group.iconUrl,
        sourceId: variant.id,
      });
    }
  }

  return lookup;
}

function fallbackSourceBadge(sourceId: string): SourceBadge {
  return {
    label: humanizeSourceId(sourceId),
    sourceId,
  };
}

export function resolveSourceBadge(
  sourceId: string,
  lookup: Map<string, SourceBadge> | undefined,
) {
  const normalizedSourceId = String(sourceId || "").trim();
  if (!normalizedSourceId) {
    return fallbackSourceBadge("");
  }
  return (
    lookup?.get(normalizedSourceId) || fallbackSourceBadge(normalizedSourceId)
  );
}
