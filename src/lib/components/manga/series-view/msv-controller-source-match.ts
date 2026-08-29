import {
  expandSearchQueryVariants,
  normalizeMatchText,
  getCandidateMatchTitles,
  getExactDisplayTitleSpecificity,
  getCandidatePublicationYear,
  diceSimilarity,
  scoreCandidateMatch,
  getCandidateBookmarkCount,
  getCandidateSourceUrl,
  AUTO_MATCH_ORIGIN,
  dedupeCandidatesBySourceUrl,
  isManualMatchedSource,
  scoreSlugRankedSlugQuality,
  hasStrongBookmarkLead,
  getMaxChapterNumber,
  shouldAdoptFallbackMatch,
  isSlugRankedSource,
  isStrictRankedSource,
  isTitleExactSource,
  withTimeout,
  sortSlugRankedScoredCandidates,
  isAmbiguousSlugRankedDuplicate,
  withMangaChapterLangHint,
} from "./msv-domain-match";
import { msvApi } from "./msv-runtime";

export function createMsvSourceMatchSlice(ctx: any) {
  function getSearchTitle() {
    return getSearchTitleCandidates()[0] || "";
  }

  function normalizeTitleList(values: unknown[]) {
    return values
      .flatMap((value) => {
        if (Array.isArray(value)) {
          return value;
        }
        return value;
      })
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  }

  function getSearchTitleCandidates() {
    const candidates = normalizeTitleList([
      ctx.detail?.title?.romaji,
      ctx.detail?.title?.english,
      ctx.detail?.title?.native,
      ctx.detail?.synonyms,
      ctx.manga?.title?.romaji,
      ctx.manga?.title?.english,
      ctx.manga?.title?.native,
      ctx.manga?.synonyms,
      typeof ctx.manga?.title === "string" ? ctx.manga.title : undefined,
    ]);

    return Array.from(new Set(candidates));
  }

  function getExpandedSearchQueries() {
    const variantBuckets = getSearchTitleCandidates()
      .map((value) => expandSearchQueryVariants(value))
      .filter((variants) => variants.length > 0);
    const interleaved: string[] = [];
    let index = 0;
    while (true) {
      let didAdd = false;
      for (const variants of variantBuckets) {
        const query = variants[index];
        if (!query) continue;
        interleaved.push(query);
        didAdd = true;
      }
      if (!didAdd) break;
      index += 1;
    }
    return Array.from(new Set(interleaved));
  }

  function getStrictNormalizedSearchTitles() {
    return Array.from(
      new Set(
        getSearchTitleCandidates()
          .map((title) => normalizeMatchText(title))
          .filter((title) => title.length >= 3),
      ),
    );
  }

  function hasDisambiguatingSearchTitle() {
    const primaryTitle = normalizeMatchText(getSearchTitle());
    if (!primaryTitle) return false;
    return getSearchTitleCandidates().some((title) => {
      const normalizedTitle = normalizeMatchText(title);
      return (
        normalizedTitle.length > primaryTitle.length &&
        normalizedTitle.startsWith(`${primaryTitle} `)
      );
    });
  }

  function isExactStrictTitleMatch(candidate: any, strictTitles: Set<string>) {
    if (strictTitles.size === 0) return false;
    return getCandidateMatchTitles(candidate).some((title) =>
      strictTitles.has(normalizeMatchText(title)),
    );
  }

  async function fetchChaptersForMatch(sourceId: string, match: any) {
    const urlOrId = match?.source_url || match?.id;
    if (!urlOrId) return [];
    const chapterRequestTarget = withMangaChapterLangHint(sourceId, urlOrId);
    return msvApi.manga.getChapters(
      sourceId,
      chapterRequestTarget as string,
      ctx.searchContextId,
    );
  }

  async function resolveSlugRankedDuplicateMatch(
    sourceId: string,
    bestMatch: any,
    bestScore: number,
    scoredCandidates: Array<{ candidate: any; score: number }>,
    options?: { normalizedQueries?: string[]; expectedYear?: number },
  ) {
    const baseTitle = normalizeMatchText(String(bestMatch?.title || ""));
    const slugQueries =
      Array.isArray(options?.normalizedQueries) && options.normalizedQueries.length > 0
        ? options.normalizedQueries
        : baseTitle
          ? [baseTitle]
          : [];
    const expectedYear = Number(options?.expectedYear || 0);
    const hasExpectedYear = Number.isInteger(expectedYear) && expectedYear > 0;
    if (!baseTitle || scoredCandidates.length < 2) {
      return bestMatch;
    }

    const scoreByUrl = new Map<string, number>();
    for (const entry of scoredCandidates) {
      const url = getCandidateSourceUrl(entry?.candidate);
      if (!url) continue;
      const current = scoreByUrl.get(url) || 0;
      if (entry.score > current) {
        scoreByUrl.set(url, entry.score);
      }
    }

    const baseTokens = baseTitle.split(" ").filter((token) => token.length >= 2);
    const minimumScore = Math.max(120, bestScore - 700);
    const contenders = dedupeCandidatesBySourceUrl(
      scoredCandidates
        .filter((entry) => entry.score >= minimumScore)
        .map((entry) => entry.candidate)
        .filter((candidate) => {
          const normalized = normalizeMatchText(String(candidate?.title || ""));
          if (!normalized) return false;
          const similarity = diceSimilarity(normalized, baseTitle);
          const tokenCoverage =
            baseTokens.length > 0 &&
            baseTokens.every((token) => normalized.includes(token));
          return (
            normalized === baseTitle ||
            normalized.startsWith(baseTitle) ||
            baseTitle.startsWith(normalized) ||
            similarity >= 0.72 ||
            tokenCoverage
          );
        }),
      sourceId,
    );
    if (contenders.length < 2) {
      return bestMatch;
    }

    const byTitleScore = [...contenders].sort((left, right) => {
      const leftUrl = getCandidateSourceUrl(left);
      const rightUrl = getCandidateSourceUrl(right);
      const rightTitleScore = scoreByUrl.get(rightUrl) || 0;
      const leftTitleScore = scoreByUrl.get(leftUrl) || 0;
      if (rightTitleScore !== leftTitleScore) {
        return rightTitleScore - leftTitleScore;
      }
      const rightMatchesYear =
        hasExpectedYear && getCandidatePublicationYear(right) === expectedYear;
      const leftMatchesYear =
        hasExpectedYear && getCandidatePublicationYear(left) === expectedYear;
      if (rightMatchesYear !== leftMatchesYear) {
        return Number(rightMatchesYear) - Number(leftMatchesYear);
      }
      const rightSpecificity = getExactDisplayTitleSpecificity(right, slugQueries);
      const leftSpecificity = getExactDisplayTitleSpecificity(left, slugQueries);
      if (rightSpecificity !== leftSpecificity) {
        return rightSpecificity - leftSpecificity;
      }
      const rightBookmark = getCandidateBookmarkCount(right);
      const leftBookmark = getCandidateBookmarkCount(left);
      if (hasStrongBookmarkLead(rightBookmark, leftBookmark)) return -1;
      if (hasStrongBookmarkLead(leftBookmark, rightBookmark)) return 1;
      if (rightBookmark !== leftBookmark) {
        return rightBookmark - leftBookmark;
      }
      const rightTitle = normalizeMatchText(String(right?.title || ""));
      const leftTitle = normalizeMatchText(String(left?.title || ""));
      if (rightTitle && leftTitle && rightTitle === leftTitle) {
        return 0;
      }
      const rightSlugQuality = scoreSlugRankedSlugQuality(right, slugQueries);
      const leftSlugQuality = scoreSlugRankedSlugQuality(left, slugQueries);
      if (rightSlugQuality !== leftSlugQuality) {
        return rightSlugQuality - leftSlugQuality;
      }

      return leftUrl.localeCompare(rightUrl);
    });

    return byTitleScore[0];
  }

  function refineSlugRankedDuplicateMatchInBackground(
    sourceId: string,
    token: number,
    candidates: any[],
    normalizedQueries: string[],
  ) {
    const deduped = dedupeCandidatesBySourceUrl(candidates, sourceId).slice(0, 2);
    if (deduped.length < 2) {
      ctx.pendingSlugRankedDuplicateRefinement.delete(sourceId);
      return;
    }

    const taskId = `${sourceId}:${++ctx.slugRankedDuplicateRefinementSeq}`;
    ctx.pendingSlugRankedDuplicateRefinement.set(sourceId, taskId);

    void (async () => {
      try {
        const resolved = await Promise.all(
          deduped.map(async (candidate) => {
            let chapters: any[] = [];
            let bookmarkCount = getCandidateBookmarkCount(candidate);
            try {
              chapters = await withTimeout(fetchChaptersForMatch(sourceId, candidate), 5000);
            } catch {}
            const candidateUrl = getCandidateSourceUrl(candidate);
            if (candidateUrl) {
              try {
                const detail = await withTimeout(msvApi.manga.getDetail(sourceId, candidateUrl), 4000);
                bookmarkCount = Math.max(bookmarkCount, getCandidateBookmarkCount(detail));
              } catch {}
            }

            const chapterList = Array.isArray(chapters) ? chapters : [];
            return {
              candidate,
              chapterCount: chapterList.length,
              maxChapter: getMaxChapterNumber(chapterList),
              bookmarkCount,
              normalizedTitle: normalizeMatchText(String(candidate?.title || "")),
              titleScore: scoreCandidateMatch(candidate, normalizedQueries),
              slugScore: scoreSlugRankedSlugQuality(candidate, normalizedQueries),
              sourceUrl: getCandidateSourceUrl(candidate),
            };
          }),
        );

        if (!ctx.isMounted || token !== ctx.loadToken) return;
        if (ctx.pendingSlugRankedDuplicateRefinement.get(sourceId) !== taskId) return;

        resolved.sort((left, right) => {
          const sameNormalizedTitle =
            left.normalizedTitle &&
            right.normalizedTitle &&
            left.normalizedTitle === right.normalizedTitle;
          if (
            sameNormalizedTitle &&
            hasStrongBookmarkLead(right.bookmarkCount, left.bookmarkCount)
          ) {
            return -1;
          }
          if (
            sameNormalizedTitle &&
            hasStrongBookmarkLead(left.bookmarkCount, right.bookmarkCount)
          ) {
            return 1;
          }
          if (sameNormalizedTitle && right.bookmarkCount !== left.bookmarkCount) {
            return right.bookmarkCount - left.bookmarkCount;
          }
          if (right.chapterCount !== left.chapterCount) {
            return right.chapterCount - left.chapterCount;
          }
          if (right.maxChapter !== left.maxChapter) {
            return right.maxChapter - left.maxChapter;
          }
          if (right.slugScore !== left.slugScore) {
            return right.slugScore - left.slugScore;
          }
          if (right.titleScore !== left.titleScore) {
            return right.titleScore - left.titleScore;
          }
          if (right.bookmarkCount !== left.bookmarkCount) {
            return right.bookmarkCount - left.bookmarkCount;
          }
          return left.sourceUrl.localeCompare(right.sourceUrl);
        });

        if (resolved.length < 2) return;
        const winner = resolved[0];
        const runnerUp = resolved[1];
        const winnerUrl = winner?.sourceUrl || "";
        if (!winnerUrl) return;

        const currentMatch = ctx.matchedSources[sourceId];
        if (isManualMatchedSource(currentMatch)) return;
        const currentUrl = getCandidateSourceUrl(currentMatch);
        if (winnerUrl === currentUrl) return;

        const chapterSignalsImproved =
          winner.chapterCount > runnerUp.chapterCount || winner.maxChapter > runnerUp.maxChapter;
        const chapterSignalsTied =
          winner.chapterCount === runnerUp.chapterCount &&
          winner.maxChapter === runnerUp.maxChapter;
        const strongSlugUpgrade =
          chapterSignalsTied && winner.slugScore >= runnerUp.slugScore + 120;
        const strongBookmarkUpgrade = hasStrongBookmarkLead(
          winner.bookmarkCount,
          runnerUp.bookmarkCount,
        );
        const clearlyBetter = chapterSignalsImproved || strongSlugUpgrade || strongBookmarkUpgrade;
        if (!clearlyBetter) return;

        ctx.matchedSources = {
          ...ctx.matchedSources,
          [sourceId]: { ...winner.candidate, match_origin: AUTO_MATCH_ORIGIN },
        };
        if (Object.prototype.hasOwnProperty.call(ctx.chaptersBySource, sourceId)) {
          const next = { ...ctx.chaptersBySource };
          delete next[sourceId];
          ctx.chaptersBySource = next;
        }
        ctx.persistSeriesSessionCache();
      } catch {
      } finally {
        if (ctx.pendingSlugRankedDuplicateRefinement.get(sourceId) === taskId) {
          ctx.pendingSlugRankedDuplicateRefinement.delete(sourceId);
        }
      }
    })();
  }

  async function findFallbackMatchWithChapters(sourceId: string, initialMatch?: any) {
    const isTitleExact = isTitleExactSource(sourceId);
    const queries = isTitleExact
      ? getSearchTitleCandidates()
      : getExpandedSearchQueries();
    const normalizedQueries = queries.map((query) => normalizeMatchText(query)).filter(Boolean);
    const attemptedUrls = new Set<string>();
    const initialUrl = String(initialMatch?.source_url || "");
    if (initialUrl) attemptedUrls.add(initialUrl);

    let bestFallback: {
      match: any;
      chapters: any[];
      titleScore: number;
      bookmarkCount: number;
      exactTitleMatch: boolean;
    } | null = null;
    const isSlugRanked = isSlugRankedSource(sourceId);
    const isStrictRanked = isStrictRankedSource(sourceId);
    const strictTitleSet = new Set(
      isStrictRanked || isTitleExact ? getStrictNormalizedSearchTitles() : [],
    );
    const maxCandidatesPerQuery = isSlugRanked
      ? 12
      : isStrictRanked
        ? ctx.STRICT_RANKED_MATCH_MAX_CANDIDATES
        : 8;
    const maxQueries = isSlugRanked
      ? Math.min(4, queries.length)
      : isStrictRanked
        ? Math.min(ctx.STRICT_RANKED_MATCH_MAX_QUERIES, queries.length)
        : isTitleExact
          ? Math.min(8, queries.length)
          : Math.min(16, queries.length);
    const interQueryDelayMs = isSlugRanked
      ? 200
      : isStrictRanked
        ? ctx.STRICT_RANKED_MATCH_INTER_QUERY_DELAY_MS
        : isTitleExact
          ? 200
          : 800;
    const minTitleScore = 120;

    let lastHadResults = false;
    let resolvedStrictExact = false;
    for (const query of queries.slice(0, maxQueries)) {
      if (lastHadResults) {
        await new Promise((resolve) => setTimeout(resolve, interQueryDelayMs));
      }

      let result: any;
      try {
        result = await msvApi.manga.search(sourceId, query, 1, ctx.searchContextId);
      } catch {
        lastHadResults = false;
        continue;
      }

      const candidates = (result?.items || []).slice(0, maxCandidatesPerQuery);
      lastHadResults = candidates.length > 0;
      const orderedCandidates = isStrictRanked || isTitleExact
        ? [...candidates].sort((left, right) => {
            const leftExact = isExactStrictTitleMatch(left, strictTitleSet);
            const rightExact = isExactStrictTitleMatch(right, strictTitleSet);
            if (rightExact !== leftExact) return Number(rightExact) - Number(leftExact);
            if (isStrictRanked) {
              return (
                getExactDisplayTitleSpecificity(right, normalizedQueries) -
                getExactDisplayTitleSpecificity(left, normalizedQueries)
              );
            }
            return 0;
          })
        : candidates;
      for (const candidate of orderedCandidates) {
        const candidateUrl = String(candidate?.source_url || "");
        if (!candidateUrl || attemptedUrls.has(candidateUrl)) continue;
        attemptedUrls.add(candidateUrl);

        const titleScore = scoreCandidateMatch(candidate, normalizedQueries);
        const exactTitleMatch =
          (isStrictRanked || isTitleExact) &&
          isExactStrictTitleMatch(candidate, strictTitleSet);
        const bookmarkCount = isSlugRanked ? getCandidateBookmarkCount(candidate) : 0;
        if (isTitleExact && !exactTitleMatch) {
          continue;
        }
        if (titleScore < minTitleScore) {
          continue;
        }

        try {
          const chapters = await fetchChaptersForMatch(sourceId, candidate);
          if (chapters.length === 0) continue;
          if ((isStrictRanked || isTitleExact) && exactTitleMatch) {
            bestFallback = {
              match: candidate,
              chapters,
              titleScore,
              bookmarkCount,
              exactTitleMatch,
            };
            resolvedStrictExact = true;
            break;
          }
          const shouldReplaceFallback = (() => {
            if (!bestFallback) return true;
            if (isStrictRanked && exactTitleMatch !== bestFallback.exactTitleMatch) {
              return exactTitleMatch;
            }
            if (chapters.length > bestFallback.chapters.length) return true;
            if (chapters.length < bestFallback.chapters.length) return false;
            if (titleScore > bestFallback.titleScore) return true;
            if (titleScore < bestFallback.titleScore) return false;
            if (isSlugRanked && bookmarkCount > bestFallback.bookmarkCount) {
              return true;
            }
            return false;
          })();
          if (shouldReplaceFallback) {
            bestFallback = {
              match: candidate,
              chapters,
              titleScore,
              bookmarkCount,
              exactTitleMatch,
            };
          }
        } catch {
        }
      }
      if (resolvedStrictExact) break;
    }

    if (!bestFallback) return null;
    return {
      match: bestFallback.match,
      chapters: bestFallback.chapters,
      titleScore: bestFallback.titleScore,
    };
  }

  return {
    getSearchTitle,
    getSearchTitleCandidates,
    getExpandedSearchQueries,
    getStrictNormalizedSearchTitles,
    hasDisambiguatingSearchTitle,
    isExactStrictTitleMatch,
    fetchChaptersForMatch,
    resolveSlugRankedDuplicateMatch,
    refineSlugRankedDuplicateMatchInBackground,
    findFallbackMatchWithChapters,
    isSlugRankedSource,
    isStrictRankedSource,
  };
}
