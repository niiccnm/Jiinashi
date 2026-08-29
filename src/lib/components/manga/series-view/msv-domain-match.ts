export function normalizeMatchText(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function diceSimilarity(left: string, right: string) {
  const a = left.replace(/\s+/g, "");
  const b = right.replace(/\s+/g, "");
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }

  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    const remaining = counts.get(gram) || 0;
    if (remaining > 0) {
      overlap++;
      counts.set(gram, remaining - 1);
    }
  }

  return (2 * overlap) / (a.length + b.length - 2);
}

export function scoreCandidateTitle(title: string, searchQueries: string[]) {
  const normalizedTitle = normalizeMatchText(title);
  if (!normalizedTitle) return 0;

  const titleTokens = normalizedTitle.split(" ").filter(Boolean);
  let best = 0;
  for (const query of searchQueries) {
    if (!query) continue;
    const queryTokens = query.split(" ").filter(Boolean);
    let score = 0;
    if (normalizedTitle === query) score += 600;
    if (normalizedTitle.startsWith(query) || query.startsWith(normalizedTitle)) {
      score += 420;
    }
    if (normalizedTitle.includes(query) || query.includes(normalizedTitle)) {
      score += 260;
    }
    const similarity = diceSimilarity(normalizedTitle, query);
    if (similarity >= 0.92) score += 300;
    else if (similarity >= 0.84) score += 220;
    else if (similarity >= 0.76) score += 150;
    else if (similarity >= 0.68) score += 90;
    for (const token of queryTokens) {
      if (token.length < 2) continue;
      if (titleTokens.includes(token) || normalizedTitle.includes(token)) {
        score += 25;
      }
    }
    if (score > best) best = score;
  }
  return best;
}

const sourceProfiles = new Map<string, { matchProfile?: string; lang?: string }>();

export function configureSourceDescriptors(sources: any[]) {
  sourceProfiles.clear();
  for (const source of sources || []) {
    const id = String(source?.id || "").trim();
    if (id) sourceProfiles.set(id, source || {});
  }
}

export function getCandidateMatchTitles(candidate: any) {
  const aliases = Array.isArray(candidate?.match_titles)
    ? candidate.match_titles
    : [];
  return Array.from(
    new Set(
      [candidate?.title, ...aliases]
        .map((title) => String(title || "").trim())
        .filter(Boolean),
    ),
  );
}

export function scoreCandidateMatch(candidate: any, searchQueries: string[]) {
  return getCandidateMatchTitles(candidate).reduce(
    (best, title) => Math.max(best, scoreCandidateTitle(title, searchQueries)),
    0,
  );
}

/** Prefer a provider's explicitly named sequel or edition over a shared alias. */
export function getExactDisplayTitleSpecificity(
  candidate: any,
  searchQueries: string[],
) {
  const title = normalizeMatchText(String(candidate?.title || ""));
  if (!title) return 0;
  return searchQueries.reduce(
    (best, query) => (title === query ? Math.max(best, title.length) : best),
    0,
  );
}

export function getCandidatePublicationYear(candidate: any) {
  const year = Number(candidate?.year);
  return Number.isInteger(year) && year >= 1800 && year <= 3000 ? year : 0;
}

export function expandSearchQueryVariants(value: string) {
  let base = String(value || "").trim();
  if (!base) return [] as string[];

  if (base.startsWith('"') && base.endsWith('"')) {
    base = base.slice(1, -1).trim();
  }

  const asciiApostrophe = base.replace(/\u2019/g, "'");
  const noApostrophe = asciiApostrophe.replace(/'/g, "");
  const noPossessive = asciiApostrophe.replace(/'s\b/gi, "");

  let shortened = asciiApostrophe;
  const splitMatch =
    shortened.match(/^([^:]+):/i) ||
    shortened.match(/^([^-]+)\s+-/i) ||
    shortened.match(/^([^.]+)\./i);

  if (splitMatch?.[1] && splitMatch[1].trim().length > 3) {
    shortened = splitMatch[1].trim();
  }

  const firstFourWords = asciiApostrophe.split(/\s+/).slice(0, 4).join(" ");

  let firstWord = base;
  const wordMatch = asciiApostrophe.match(/^([^\s\-:]+)/);
  if (wordMatch?.[1] && wordMatch[1].length > 3) {
    firstWord = wordMatch[1];
  }

  const variants = [
    base,
    firstWord !== base ? firstWord : null,
    shortened !== base ? shortened : null,
    firstFourWords !== base ? firstFourWords : null,
    asciiApostrophe,
    noApostrophe,
    noPossessive,
    asciiApostrophe
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ].filter(Boolean) as string[];

  return Array.from(new Set(variants));
}

export function parseCompactMetricNumber(value: unknown) {
  const raw = String(value || "")
    .replace(/,/g, "")
    .trim()
    .toLowerCase();
  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)([km])?$/);
  if (!match) return 0;
  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) return 0;
  if (match[2] === "k") return Math.round(base * 1_000);
  if (match[2] === "m") return Math.round(base * 1_000_000);
  return Math.round(base);
}

export function getCandidateBookmarkCount(candidate: any) {
  const raw = candidate?.bookmark_count;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.round(raw));
  }
  return parseCompactMetricNumber(raw);
}

export function getCandidateSourceUrl(candidate: any) {
  return String(candidate?.source_url || "").trim();
}

export const MANUAL_MATCH_ORIGIN = "manual";
export const AUTO_MATCH_ORIGIN = "auto";

export function isManualMatchedSource(candidate: any) {
  return (
    String(candidate?.match_origin || "").toLowerCase() ===
      MANUAL_MATCH_ORIGIN || Boolean(candidate?.is_manual_match)
  );
}

export function getSlugRankedCanonicalCandidateKey(candidate: any) {
  const url = getCandidateSourceUrl(candidate);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const titleIndex = parts.indexOf("title");
    const titleSegment = titleIndex >= 0 ? parts[titleIndex + 1] || "" : "";
    // Support both current and legacy route shapes for canonical deduplication.
    if (titleSegment) {
      const hid = titleSegment.split("-")[0];
      if (hid) return `canonical:${hid.toLowerCase()}`;
    }
    const legacySlug =
      parts[0] === "manga" ? parts[1] || "" : parts[parts.length - 1] || "";
    const token = legacySlug.includes(".")
      ? legacySlug.split(".").pop() || ""
      : "";
    return token ? `canonical:${token.toLowerCase()}` : "";
  } catch {
    return "";
  }
}

export function isSlugRankedSource(sourceId: string) {
  return sourceProfiles.get(sourceId)?.matchProfile === "slug-ranked";
}

export function isStrictRankedSource(sourceId: string) {
  return sourceProfiles.get(sourceId)?.matchProfile === "strict-ranked";
}

export function isTitleExactSource(sourceId: string) {
  return sourceProfiles.get(sourceId)?.matchProfile === "title-exact";
}

export function getCandidateDedupeKey(candidate: any, sourceId?: string) {
  const url = getCandidateSourceUrl(candidate);
  if (!url) return "";

  if (sourceId && isSlugRankedSource(sourceId)) {
    const canonical = getSlugRankedCanonicalCandidateKey(candidate);
    if (canonical) return canonical;
  }

  return `url:${url.toLowerCase()}`;
}

export function dedupeCandidatesBySourceUrl(candidates: any[], sourceId?: string) {
  const byKey = new Map<string, any>();
  for (const candidate of candidates || []) {
    const key = getCandidateDedupeKey(candidate, sourceId);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, candidate);
  }
  return Array.from(byKey.values());
}

export function extractSlugRankedSlugTitle(sourceUrl: string) {
  const url = String(sourceUrl || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const titleIndex = parts.indexOf("title");
    const currentTitleSegment =
      titleIndex >= 0 ? parts[titleIndex + 1] || "" : "";
    const legacySlug =
      parts[0] === "manga" ? parts[1] || "" : parts[parts.length - 1] || "";
    const slugWithoutToken = currentTitleSegment
      ? currentTitleSegment.replace(/^[^-]+-/, "")
      : legacySlug.includes(".")
        ? legacySlug.slice(0, legacySlug.lastIndexOf("."))
        : legacySlug;
    if (!slugWithoutToken) return "";
    return decodeURIComponent(slugWithoutToken)
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

export function scoreSlugRankedSlugQuality(
  candidate: any,
  normalizedQueries: string[],
) {
  const slugTitle = extractSlugRankedSlugTitle(getCandidateSourceUrl(candidate));
  const normalizedSlug = normalizeMatchText(slugTitle);
  if (!normalizedSlug) return 0;

  const queries = normalizedQueries.length > 0 ? normalizedQueries : [];
  let score = queries.length > 0 ? scoreCandidateTitle(normalizedSlug, queries) : 0;

  if (/\d+$/.test(normalizedSlug)) score -= 180;

  return score;
}

export function hasStrongBookmarkLead(leader: number, follower: number) {
  return leader >= Math.max(follower + 2000, 5000);
}

export function sortSlugRankedScoredCandidates(
  entries: Array<{ candidate: any; score: number }>,
  normalizedQueries: string[],
) {
  return [...entries].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const rightBookmark = getCandidateBookmarkCount(right.candidate);
    const leftBookmark = getCandidateBookmarkCount(left.candidate);
    if (hasStrongBookmarkLead(rightBookmark, leftBookmark)) return -1;
    if (hasStrongBookmarkLead(leftBookmark, rightBookmark)) return 1;
    if (rightBookmark !== leftBookmark) {
      return rightBookmark - leftBookmark;
    }
    const rightTitle = normalizeMatchText(String(right?.candidate?.title || ""));
    const leftTitle = normalizeMatchText(String(left?.candidate?.title || ""));
    if (rightTitle && leftTitle && rightTitle === leftTitle) {
      return 0;
    }
    const rightSlugQuality = scoreSlugRankedSlugQuality(
      right.candidate,
      normalizedQueries,
    );
    const leftSlugQuality = scoreSlugRankedSlugQuality(
      left.candidate,
      normalizedQueries,
    );
    if (rightSlugQuality !== leftSlugQuality) {
      return rightSlugQuality - leftSlugQuality;
    }
    const leftUrl = getCandidateSourceUrl(left.candidate);
    const rightUrl = getCandidateSourceUrl(right.candidate);
    return leftUrl.localeCompare(rightUrl);
  });
}

export function isAmbiguousSlugRankedDuplicate(
  rankedEntries: Array<{ candidate: any; score: number }>,
) {
  if (!Array.isArray(rankedEntries) || rankedEntries.length < 2) return false;
  const top = rankedEntries[0];
  const next = rankedEntries[1];
  const scoreDelta = Number(top?.score || 0) - Number(next?.score || 0);
  if (scoreDelta <= 120) return true;

  const topTitle = normalizeMatchText(String(top?.candidate?.title || ""));
  const nextTitle = normalizeMatchText(String(next?.candidate?.title || ""));
  return Boolean(topTitle && nextTitle && topTitle === nextTitle);
}

export function getMaxChapterNumber(chapterList: any[]) {
  let maxChapterNumber = 0;
  for (const chapter of chapterList || []) {
    const chapterNumber = Number(chapter?.chapter_number);
    if (Number.isFinite(chapterNumber) && chapterNumber > maxChapterNumber) {
      maxChapterNumber = chapterNumber;
    }
  }
  return maxChapterNumber;
}

export function shouldAdoptFallbackMatch(
  currentChapterCount: number,
  fallbackChapterCount: number,
  currentTitleScore: number,
  fallbackTitleScore: number,
  currentMaxChapter: number,
  fallbackMaxChapter: number,
) {
  if (fallbackChapterCount <= 0) return false;
  if (currentChapterCount <= 0) return true;

  if (fallbackTitleScore + 120 < currentTitleScore) return false;

  if (
    currentMaxChapter > 0 &&
    fallbackMaxChapter > 0 &&
    fallbackMaxChapter < currentMaxChapter
  ) {
    return false;
  }

  if (fallbackMaxChapter >= currentMaxChapter + 25) {
    return true;
  }

  return (
    fallbackChapterCount >= currentChapterCount + 25 &&
    fallbackChapterCount >= Math.ceil(currentChapterCount * 1.5)
  );
}

export function extractVariantLang(sourceId: string, baseId: string) {
  if (sourceId === baseId) return "en";
  if (sourceId.startsWith(`${baseId}.`)) {
    return sourceId.slice(baseId.length + 1) || "en";
  }
  return "en";
}

export function withMangaChapterLangHint(
  sourceId: string,
  urlOrId: string | number,
) {
  if (typeof urlOrId !== "string") return urlOrId;
  if (!isSlugRankedSource(sourceId)) {
    return urlOrId;
  }

  const lang = String(sourceProfiles.get(sourceId)?.lang || "en");
  try {
    const parsed = new URL(urlOrId);
    const hashParams = new URLSearchParams(
      parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash,
    );
    hashParams.set("ji_lang", lang);
    parsed.hash = hashParams.toString();
    return parsed.toString();
  } catch {
    const separator = urlOrId.includes("#") ? "&" : "#";
    return `${urlOrId}${separator}ji_lang=${encodeURIComponent(lang)}`;
  }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
