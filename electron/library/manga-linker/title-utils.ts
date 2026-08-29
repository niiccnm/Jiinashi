import path from "path";
import type { MangaStatus, ReadingFormat } from "../../types/manga-types";
import { MAX_SEARCH_QUERIES, type MangaLinkResolveInput } from "./contracts";

export type SeriesTitleStyle = "original" | "romaji" | "english";

type SeriesTitleSource = {
  title_original?: string | null;
  title_romaji?: string | null;
  title_english?: string | null;
};

export function normalizeSeriesTitleStyle(
  value: string | null | undefined,
): SeriesTitleStyle {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "original") return "original";
  if (normalized === "english") return "english";
  return "romaji";
}

export function resolveSeriesTitle(
  series: SeriesTitleSource | null | undefined,
  style: SeriesTitleStyle = "romaji",
  fallback = "Unknown Series",
): string {
  const english = String(series?.title_english || "").trim();
  const romaji = String(series?.title_romaji || "").trim();
  const original = String(series?.title_original || "").trim();

  const orderedCandidates =
    style === "original"
      ? [original, romaji, english]
      : style === "english"
        ? [english, romaji, original]
        : [romaji, english, original];

  for (const candidate of orderedCandidates) {
    if (candidate) return candidate;
  }
  return fallback;
}

export function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const normalized = String(raw || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function firstMeaningfulTitle(
  values: Array<string | null | undefined>,
): string {
  for (const value of values) {
    if (isMeaningfulTitleToken(String(value || ""))) {
      return String(value || "").trim();
    }
  }
  return "";
}

export function normalizeTitleForCompare(value: string): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTitleNoise(value: string): string {
  const withoutBrackets = String(value || "")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*]/g, " ")
    .replace(/\{[^}]*}/g, " ")
    .replace(/_+/g, " ")
    .replace(/\.[a-z0-9]{2,5}$/i, " ");
  const withoutChapterTokens = withoutBrackets
    .replace(
      /\b(ch(?:apter)?|ep(?:isode)?|vol(?:ume)?|v|part|pt)\.?\s*\d+(?:\.\d+)?\b/gi,
      " ",
    )
    .replace(/\b(?:raw|scanlation|digital|official|english|jp|kr|cn)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = withoutBrackets.trim();
  if (!withoutChapterTokens) {
    const normalizedFallback = normalizeTitleForCompare(fallback);
    if (
      !normalizedFallback ||
      /^(?:ch|chapter|chapters?|ep|episode|vol|volume|v|part|pt)(?:\s+\d+(?:\.\d+)?)?$/.test(
        normalizedFallback,
      ) ||
      /^\d+(?:\s+\d+)*$/.test(normalizedFallback)
    ) {
      return "";
    }
  }
  return withoutChapterTokens || fallback;
}

export function inferMangaLinkTitle(rawTitle: string): string {
  const normalized = stripTitleNoise(rawTitle);
  return normalized || String(rawTitle || "").trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeTitleForCompare(value);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

function diceSimilarity(a: string, b: string): number {
  const left = normalizeTitleForCompare(a);
  const right = normalizeTitleForCompare(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const bigrams = (input: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < input.length - 1; i += 1) {
      const key = input[i] + input[i + 1];
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  };

  const leftSet = bigrams(left);
  const rightSet = bigrams(right);
  let overlap = 0;
  for (const [key, count] of leftSet) {
    overlap += Math.min(count, rightSet.get(key) || 0);
  }
  const total =
    [...leftSet.values()].reduce((sum, count) => sum + count, 0) +
    [...rightSet.values()].reduce((sum, count) => sum + count, 0);
  return total > 0 ? (2 * overlap) / total : 0;
}

function tokenSimilarity(a: string, b: string): number {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of left) {
    if (rightSet.has(token)) overlap += 1;
  }
  return overlap / Math.max(left.length, right.length);
}

export function titleSimilarity(a: string, b: string): number {
  const left = normalizeTitleForCompare(a);
  const right = normalizeTitleForCompare(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const containsBonus = left.includes(right) || right.includes(left) ? 0.08 : 0;
  const dice = diceSimilarity(left, right);
  const token = tokenSimilarity(left, right);
  return Math.max(
    0,
    Math.min(1, dice * 0.62 + token * 0.38 + containsBonus),
  );
}

export function scoreToConfidence(score: number): "high" | "medium" | "low" {
  if (score >= 0.9) return "high";
  if (score >= 0.7) return "medium";
  return "low";
}

export function getDisplayTitle(media: any): string {
  return (
    String(media?.title?.english || "").trim() ||
    String(media?.title?.romaji || "").trim() ||
    String(media?.title?.native || "").trim() ||
    String(media?.title?.userPreferred || "").trim() ||
    `AniList #${media?.id || "unknown"}`
  );
}

export function getCandidateTitles(media: any): string[] {
  return uniqueStrings([
    media?.title?.english,
    media?.title?.romaji,
    media?.title?.native,
    media?.title?.userPreferred,
    ...(Array.isArray(media?.synonyms) ? media.synonyms : []),
  ]);
}

export function cleanDescription(value: unknown): string | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  const stripped = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripped || undefined;
}

export function mapStatus(value: unknown): MangaStatus | undefined {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (normalized === "FINISHED") return "completed";
  if (normalized === "RELEASING") return "ongoing";
  if (normalized === "HIATUS") return "hiatus";
  if (normalized === "CANCELLED") return "cancelled";
  return undefined;
}

export function mapFormat(
  value: unknown,
  country: unknown,
): ReadingFormat {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  const countryCode = String(country || "")
    .trim()
    .toUpperCase();
  if (normalized === "MANHWA" || (normalized === "MANGA" && countryCode === "KR")) return "manhwa";
  if (normalized === "MANHUA" || (normalized === "MANGA" && countryCode === "CN")) return "manhua";
  return "manga";
}

export function extractStaffNames(detail: any): {
  author?: string;
  artist?: string;
} {
  const edges = Array.isArray(detail?.staff?.edges) ? detail.staff.edges : [];
  const authors: string[] = [];
  const artists: string[] = [];
  for (const edge of edges) {
    const role = String(edge?.role || "")
      .trim()
      .toLowerCase();
    const name =
      String(edge?.node?.name?.full || "").trim() ||
      String(edge?.node?.name?.native || "").trim();
    if (!name) continue;
    if (role.includes("story") || role.includes("author")) {
      authors.push(name);
    }
    if (role.includes("art") || role.includes("illustration")) {
      artists.push(name);
    }
  }
  const uniqueAuthors = uniqueStrings(authors);
  const uniqueArtists = uniqueStrings(artists);
  return {
    author: uniqueAuthors.length ? uniqueAuthors.join(", ") : undefined,
    artist: uniqueArtists.length ? uniqueArtists.join(", ") : undefined,
  };
}

export function isMeaningfulTitleToken(token: string): boolean {
  const normalized = normalizeTitleForCompare(token);
  if (!normalized) return false;
  if (/^\d+(?:\s+\d+)*$/.test(normalized)) return false;
  if (/^(?:ch|chapter|ep|episode|vol|volume|v|part|pt|raw)$/.test(normalized)) {
    return false;
  }
  if (normalized.length <= 1) return false;
  return true;
}

function isUsableSearchQuery(token: string): boolean {
  const normalized = normalizeTitleForCompare(token);
  if (!normalized) return false;
  if (!isMeaningfulTitleToken(normalized)) return false;
  if (/^(?:the|manga|comic|manhwa|manhua|doujin(?:shi)?|book)$/.test(normalized)) {
    return false;
  }
  return true;
}

export function buildTitleCandidates(input: MangaLinkResolveInput): string[] {
  const rawCandidates = uniqueStrings([
    input.preferredTitle,
    ...(input.titleCandidates || []),
    ...(input.itemPaths || []).map((p) => path.basename(String(p || "").trim())),
    ...(input.itemPaths || []).map((p) =>
      path.basename(String(p || "").trim(), path.extname(String(p || "").trim())),
    ),
    ...(input.itemPaths || []).map((p) =>
      path.basename(path.dirname(String(p || "").trim())),
    ),
    ...(input.itemPaths || []).map((p) =>
      path.basename(path.dirname(path.dirname(String(p || "").trim()))),
    ),
    input.folderPath ? path.basename(input.folderPath) : "",
  ]);

  const normalized = uniqueStrings(
    rawCandidates
      .map((candidate) => inferMangaLinkTitle(candidate))
      .filter(isUsableSearchQuery),
  );

  if (normalized.length === 0) return [];

  const preferred = inferMangaLinkTitle(String(input.preferredTitle || "").trim());
  if (preferred && isUsableSearchQuery(preferred)) {
    return uniqueStrings([preferred, ...normalized]).slice(0, MAX_SEARCH_QUERIES * 2);
  }
  return normalized.slice(0, MAX_SEARCH_QUERIES * 2);
}

export function inferItemTitleFromPath(
  itemPath: string,
  rawTitle?: string | null,
): string {
  const normalizedPath = String(itemPath || "").trim();
  const fallback = path.basename(
    normalizedPath,
    path.extname(normalizedPath || ""),
  );
  return inferMangaLinkTitle(String(rawTitle || "").trim() || fallback);
}
