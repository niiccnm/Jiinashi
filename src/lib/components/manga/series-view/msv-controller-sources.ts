import { toasts } from "../../../stores/toast";
import {
  AUTO_MATCH_ORIGIN,
  MANUAL_MATCH_ORIGIN,
  normalizeMatchText,
  scoreCandidateMatch,
  getCandidatePublicationYear,
  getExactDisplayTitleSpecificity,
  getCandidateBookmarkCount,
  getCandidateSourceUrl,
  getCandidateDedupeKey,
  sortSlugRankedScoredCandidates,
  isAmbiguousSlugRankedDuplicate,
  getMaxChapterNumber,
  shouldAdoptFallbackMatch,
  isSlugRankedSource,
  isStrictRankedSource,
  isTitleExactSource,
  isManualMatchedSource,
} from "./msv-domain-match";
import { msvApi } from "./msv-runtime";
import { createMsvSourceMatchSlice } from "./msv-controller-source-match";
import {
  buildSourceGroups as buildSharedSourceGroups,
  resolveSourceId as resolveSharedSourceId,
} from "../sourceCatalog";

export function createMsvSourceSlice(ctx: any) {
  const matchSlice = createMsvSourceMatchSlice(ctx);

  function buildSourceGroups(rawSources: any[]) {
    const next = buildSharedSourceGroups(
      rawSources,
      ctx.selectedVariantByGroup,
    );
    ctx.selectedVariantByGroup = {
      ...ctx.selectedVariantByGroup,
      ...next.preferredVariantByGroup,
    };
    return next.groups;
  }

  function resolveSourceId(groupId: string, forcedSourceId?: string) {
    return resolveSharedSourceId(
      groupId,
      ctx.sourceGroups,
      ctx.selectedVariantByGroup,
      forcedSourceId,
    );
  }

  function getGroupById(groupId: string) {
    return ctx.sourceGroups.find((entry: any) => entry.id === groupId) || null;
  }

  function getGroupSourceIds(groupId: string) {
    const group = getGroupById(groupId);
    if (!group || !Array.isArray(group.variants)) return [] as string[];
    return group.variants
      .map((variant: any) => String(variant?.id || "").trim())
      .filter(Boolean);
  }

  function getExpectedHostForGroup(groupId: string) {
    const group = getGroupById(groupId);
    const baseUrl = String(group?.variants?.[0]?.source?.baseUrl || "").trim();
    if (!baseUrl) return "";
    try {
      return new URL(baseUrl).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function normalizeManualUrl(rawValue: string) {
    const raw = String(rawValue || "").trim();
    if (!raw) {
      return { ok: false as const, error: "Please paste a series URL." };
    }

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false as const, error: "Please enter a valid URL." };
    }

    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return {
        ok: false as const,
        error: "Only http/https URLs are supported.",
      };
    }

    return { ok: true as const, value: parsed.toString() };
  }

  function isProviderHostMatch(expectedHost: string, inputUrl: string) {
    const normalizedExpected = String(expectedHost || "")
      .toLowerCase()
      .replace(/^www\./, "");
    if (!normalizedExpected) return true;
    try {
      const parsedHost = new URL(inputUrl).hostname
        .toLowerCase()
        .replace(/^www\./, "");
      return (
        parsedHost === normalizedExpected ||
        parsedHost.endsWith(`.${normalizedExpected}`)
      );
    } catch {
      return false;
    }
  }

  function getGroupContext(groupId: string) {
    const sourceIds = getGroupSourceIds(groupId);
    const expectedHost = getExpectedHostForGroup(groupId);
    const preferredSourceId =
      resolveSourceId(groupId) || (sourceIds.length > 0 ? sourceIds[0] : "");
    return {
      sourceIds,
      expectedHost,
      preferredSourceId,
    };
  }

  function toAutoMatch(candidate: any) {
    if (!candidate || typeof candidate !== "object") return candidate;
    return {
      ...candidate,
      match_origin: AUTO_MATCH_ORIGIN,
    };
  }

  function buildManualMatch(url: string) {
    const title =
      String(
        ctx.detail?.title?.english ||
          ctx.detail?.title?.romaji ||
          ctx.detail?.title?.native ||
          ctx.manga?.title?.english ||
          ctx.manga?.title?.romaji ||
          ctx.manga?.title?.native ||
          (typeof ctx.manga?.title === "string" ? ctx.manga.title : "") ||
          "Manual Source",
      ).trim() || "Manual Source";

    return {
      source_url: url,
      title,
      match_origin: MANUAL_MATCH_ORIGIN,
      is_manual_match: true,
    };
  }

  function clearGroupSourceCaches(groupId: string) {
    const sourceIds = getGroupSourceIds(groupId);
    if (sourceIds.length === 0) return;

    const nextScanned = { ...ctx.scannedSources };
    const nextChaptersBySource = { ...ctx.chaptersBySource };
    for (const sourceId of sourceIds) {
      delete nextScanned[sourceId];
      delete nextChaptersBySource[sourceId];
      ctx.pendingSlugRankedDuplicateRefinement.delete(sourceId);
    }
    ctx.scannedSources = nextScanned;
    ctx.chaptersBySource = nextChaptersBySource;
  }

  function getManualSourceUrl(groupId: string) {
    const sourceIds = getGroupSourceIds(groupId);
    for (const sourceId of sourceIds) {
      const candidate = ctx.matchedSources[sourceId];
      if (!isManualMatchedSource(candidate)) continue;
      const sourceUrl = String(candidate?.source_url || "").trim();
      if (sourceUrl) return sourceUrl;
    }
    return "";
  }

  async function scanSources(token: number) {
    const scanPromises = ctx.sourceGroups.map((group: any) =>
      scanSourceGroup(group.id, token),
    );
    await Promise.all(scanPromises);
  }

  async function applyManualSourceUrl(groupId: string, inputUrl: string) {
    const normalized = normalizeManualUrl(inputUrl);
    if (!normalized.ok) {
      return { ok: false as const, error: normalized.error };
    }

    const context = getGroupContext(groupId);
    if (!isProviderHostMatch(context.expectedHost, normalized.value)) {
      return {
        ok: false as const,
        error: context.expectedHost
          ? `URL host must match ${context.expectedHost}.`
          : "URL host does not match this provider.",
      };
    }

    if (context.sourceIds.length === 0) {
      return {
        ok: false as const,
        error: "Could not resolve source variants.",
      };
    }

    const manualMatch = buildManualMatch(normalized.value);
    const nextMatches = { ...ctx.matchedSources };
    for (const sourceId of context.sourceIds) {
      nextMatches[sourceId] = { ...manualMatch };
      ctx.pendingSlugRankedDuplicateRefinement.delete(sourceId);
    }
    ctx.matchedSources = nextMatches;
    clearGroupSourceCaches(groupId);
    ctx.persistSeriesSessionCache();

    const sourceId = context.preferredSourceId;
    if (!sourceId) {
      return {
        ok: false as const,
        error: "Could not resolve source for this group.",
      };
    }

    ctx.scanningByGroup = { ...ctx.scanningByGroup, [groupId]: true };
    try {
      await selectSource(groupId, sourceId);
      if (!ctx.isMounted) {
        return {
          ok: false as const,
          error: "Series view is no longer mounted.",
        };
      }
    } finally {
      const nextScanning = { ...ctx.scanningByGroup };
      delete nextScanning[groupId];
      ctx.scanningByGroup = nextScanning;
    }

    return { ok: true as const };
  }

  async function forgetManualSourceUrl(groupId: string) {
    const context = getGroupContext(groupId);
    if (context.sourceIds.length === 0) {
      return {
        ok: false as const,
        error: "Could not resolve source variants.",
      };
    }

    let removedAny = false;
    const nextMatches = { ...ctx.matchedSources };
    for (const sourceId of context.sourceIds) {
      if (!isManualMatchedSource(nextMatches[sourceId])) continue;
      delete nextMatches[sourceId];
      ctx.pendingSlugRankedDuplicateRefinement.delete(sourceId);
      removedAny = true;
    }

    if (!removedAny) {
      return { ok: true as const };
    }

    ctx.matchedSources = nextMatches;
    clearGroupSourceCaches(groupId);
    ctx.persistSeriesSessionCache();

    if (String(ctx.selectedSourceGroupId || "") === String(groupId || "")) {
      const sourceId = context.preferredSourceId;
      if (sourceId) {
        await selectSource(groupId, sourceId);
      }
    }

    return { ok: true as const };
  }

  async function scanSourceGroup(
    groupId: string,
    token: number,
    forcedSourceId?: string,
  ) {
    if (!ctx.isMounted || token !== ctx.loadToken) return;

    const sourceId = resolveSourceId(groupId, forcedSourceId);
    if (
      !sourceId ||
      ctx.matchedSources[sourceId] ||
      ctx.scannedSources[sourceId]
    ) {
      return;
    }

    const source = ctx.availableSources.find(
      (item: any) => item.id === sourceId,
    );
    if (!source) return;

    ctx.scanningByGroup = { ...ctx.scanningByGroup, [groupId]: true };
    const sourceIsSlugRanked = isSlugRankedSource(source.id);
    const sourceIsStrictRanked = isStrictRankedSource(source.id);
    const sourceIsTitleExact = isTitleExactSource(source.id);
    const strictTitleSet = new Set(
      sourceIsStrictRanked || sourceIsTitleExact
        ? matchSlice.getStrictNormalizedSearchTitles()
        : [],
    );
    const queries = sourceIsTitleExact
      ? matchSlice.getSearchTitleCandidates()
      : matchSlice.getExpandedSearchQueries();
    const normalizedQueries = queries
      .map((query) => normalizeMatchText(query))
      .filter(Boolean);
    const expectedYear = Number(ctx.detail?.startDate?.year || ctx.manga?.year || 0);
    const hasExpectedYear = Number.isInteger(expectedYear) && expectedYear > 0;
    const sourceNeedsEditionDisambiguation =
      sourceIsSlugRanked || sourceIsStrictRanked;
    const shouldSearchDisambiguatingTitles =
      sourceNeedsEditionDisambiguation &&
      matchSlice.hasDisambiguatingSearchTitle();
    const maxQueries = sourceIsSlugRanked
      ? Math.min(4, queries.length)
      : sourceIsStrictRanked
        ? Math.min(ctx.STRICT_RANKED_MATCH_MAX_QUERIES, queries.length)
        : sourceIsTitleExact
          ? Math.min(8, queries.length)
          : Math.min(16, queries.length);
    const searchQueries =
      queries.length > 0
        ? queries.slice(0, maxQueries)
        : [matchSlice.getSearchTitle()];
    const interQueryDelayMs = sourceIsSlugRanked
      ? 150
      : sourceIsStrictRanked
        ? ctx.STRICT_RANKED_MATCH_INTER_QUERY_DELAY_MS
        : sourceIsTitleExact
          ? 200
          : 800;
    const maxCandidatesPerQuery = sourceIsSlugRanked
      ? 20
      : sourceIsStrictRanked
        ? ctx.STRICT_RANKED_MATCH_MAX_CANDIDATES
        : 8;
    let bestMatch: any = null;
    let bestScore = 0;
    let bestStrictMatch: any = null;
    let bestStrictScore = -1;
    const scoredCandidatesByKey = new Map<
      string,
      { candidate: any; score: number }
    >();

    function isBetterMatch(
      candidate: any,
      score: number,
      current: any,
      currentScore: number,
    ) {
      if (!current || score !== currentScore) return !current || score > currentScore;
      if (sourceNeedsEditionDisambiguation) {
        const candidateMatchesYear =
          hasExpectedYear && getCandidatePublicationYear(candidate) === expectedYear;
        const currentMatchesYear =
          hasExpectedYear && getCandidatePublicationYear(current) === expectedYear;
        if (candidateMatchesYear !== currentMatchesYear) return candidateMatchesYear;

        const candidateSpecificity = getExactDisplayTitleSpecificity(
          candidate,
          normalizedQueries,
        );
        const currentSpecificity = getExactDisplayTitleSpecificity(
          current,
          normalizedQueries,
        );
        if (candidateSpecificity !== currentSpecificity) {
          return candidateSpecificity > currentSpecificity;
        }
      }
      if (sourceIsSlugRanked) {
        return getCandidateBookmarkCount(candidate) > getCandidateBookmarkCount(current);
      }
      return false;
    }

    try {
      let lastHadResults = false;
      for (const query of searchQueries) {
        if (lastHadResults) {
          await new Promise((resolve) =>
            setTimeout(resolve, interQueryDelayMs),
          );
        }

        let results: any;
        try {
          results = await msvApi.manga.search(
            source.id,
            query,
            1,
            ctx.searchContextId,
          );
        } catch {
          lastHadResults = false;
          continue;
        }
        if (!ctx.isMounted || token !== ctx.loadToken) return;

        const candidates = (results?.items || []).slice(
          0,
          maxCandidatesPerQuery,
        );
        lastHadResults = candidates.length > 0;
        for (const candidate of candidates) {
          const score =
            normalizedQueries.length > 0
              ? scoreCandidateMatch(candidate, normalizedQueries)
              : 1;
          const strictTitleMatch =
            (sourceIsStrictRanked || sourceIsTitleExact) &&
            matchSlice.isExactStrictTitleMatch(
              candidate,
              strictTitleSet,
            );
          if (sourceIsTitleExact && !strictTitleMatch) {
            continue;
          }
          const bookmarkCount = sourceIsSlugRanked
            ? getCandidateBookmarkCount(candidate)
            : 0;
          const candidateKey = sourceIsSlugRanked
            ? getCandidateDedupeKey(candidate, source.id)
            : getCandidateSourceUrl(candidate);
          if (sourceIsSlugRanked && candidateKey) {
            const existing = scoredCandidatesByKey.get(candidateKey);
            if (!existing || score > existing.score) {
              scoredCandidatesByKey.set(candidateKey, { candidate, score });
            }
          }
          if (
            strictTitleMatch &&
            isBetterMatch(candidate, score, bestStrictMatch, bestStrictScore)
          ) {
            bestStrictMatch = candidate;
            bestStrictScore = score;
          }
          if (isBetterMatch(candidate, score, bestMatch, bestScore)) {
            bestMatch = candidate;
            bestScore = score;
          }
        }

        if (bestScore >= 350 && !shouldSearchDisambiguatingTitles) break;
      }

      if ((sourceIsStrictRanked || sourceIsTitleExact) && bestStrictMatch) {
        bestMatch = bestStrictMatch;
        bestScore = Math.max(bestScore, bestStrictScore);
      }

      if (bestMatch && (normalizedQueries.length === 0 || bestScore >= 120)) {
        if (sourceIsSlugRanked) {
          const scoredEntries = Array.from(scoredCandidatesByKey.values());
          const rankedSlugRankedEntries = sortSlugRankedScoredCandidates(
            scoredEntries,
            normalizedQueries,
          );
          bestMatch = await matchSlice.resolveSlugRankedDuplicateMatch(
            source.id,
            bestMatch,
            bestScore,
            scoredEntries,
            { normalizedQueries, expectedYear },
          );
          if (!ctx.isMounted || token !== ctx.loadToken) return;

          const rankedSlugRankedCandidates = rankedSlugRankedEntries
            .map((entry) => entry.candidate)
            .slice(0, 8);

          if (
            isAmbiguousSlugRankedDuplicate(rankedSlugRankedEntries) &&
            !shouldSearchDisambiguatingTitles
          ) {
            const bestUrl = getCandidateSourceUrl(bestMatch);
            const refinementCandidates = [
              bestMatch,
              ...rankedSlugRankedCandidates.filter(
                (candidate) => getCandidateSourceUrl(candidate) !== bestUrl,
              ),
            ].slice(0, 2);
            matchSlice.refineSlugRankedDuplicateMatchInBackground(
              source.id,
              token,
              refinementCandidates,
              normalizedQueries,
            );
          } else {
            ctx.pendingSlugRankedDuplicateRefinement.delete(source.id);
          }
        }
        const previousMatchUrl = getCandidateSourceUrl(
          ctx.matchedSources[source.id],
        );
        const nextMatchUrl = getCandidateSourceUrl(bestMatch);
        ctx.matchedSources = {
          ...ctx.matchedSources,
          [source.id]: toAutoMatch(bestMatch),
        };
        if (
          previousMatchUrl &&
          nextMatchUrl &&
          previousMatchUrl !== nextMatchUrl &&
          Object.prototype.hasOwnProperty.call(ctx.chaptersBySource, source.id)
        ) {
          const next = { ...ctx.chaptersBySource };
          delete next[source.id];
          ctx.chaptersBySource = next;
        }
      } else if (sourceIsSlugRanked) {
        ctx.pendingSlugRankedDuplicateRefinement.delete(source.id);
      }
      ctx.scannedSources = { ...ctx.scannedSources, [source.id]: true };
      ctx.persistSeriesSessionCache();
    } catch (e) {
      console.warn(`Failed to scan source ${source.name}:`, e);
    } finally {
      if (!ctx.isMounted || token !== ctx.loadToken) return;
      const nextScanning = { ...ctx.scanningByGroup };
      delete nextScanning[groupId];
      ctx.scanningByGroup = nextScanning;
    }
  }

  async function selectSource(groupId: string, forcedSourceId?: string) {
    const requestToken = ++ctx.chapterLoadToken;
    const sourceId = resolveSourceId(groupId, forcedSourceId);
    if (!sourceId) return;
    const hasCachedForSource = Object.prototype.hasOwnProperty.call(
      ctx.chaptersBySource,
      sourceId,
    );

    ctx.selectedSourceGroupId = groupId;
    ctx.selectedVariantByGroup = {
      ...ctx.selectedVariantByGroup,
      [groupId]: sourceId,
    };
    ctx.selectedSourceId = sourceId;
    ctx.selectedChapters = new Set();
    ctx.lastSelectedChapterIndex = null;
    ctx.currentPage = 1;

    if (hasCachedForSource) {
      const cachedChapters = [...(ctx.chaptersBySource[sourceId] || [])];
      ctx.chapters = cachedChapters;
      ctx.isLoading = false;
      ctx.persistSeriesSessionCache();
      void ctx.refreshLocalStatesForSource(
        sourceId,
        requestToken,
        cachedChapters,
      );
      return;
    }

    ctx.isLoading = true;
    ctx.chapters = [];

    const token = ctx.loadToken;
    if (!ctx.matchedSources[sourceId] && ctx.scannedSources[sourceId]) {
      const nextScanned = { ...ctx.scannedSources };
      delete nextScanned[sourceId];
      ctx.scannedSources = nextScanned;
    }
    if (!ctx.matchedSources[sourceId]) {
      await scanSourceGroup(groupId, token, sourceId);
    }
    if (!ctx.isMounted || requestToken !== ctx.chapterLoadToken) return;

    let matchedManga = ctx.matchedSources[sourceId];
    if (
      matchedManga &&
      isTitleExactSource(sourceId) &&
      !isManualMatchedSource(matchedManga) &&
      !matchSlice.isExactStrictTitleMatch(
        matchedManga,
        new Set(matchSlice.getStrictNormalizedSearchTitles()),
      )
    ) {
      const nextMatches = { ...ctx.matchedSources };
      const nextScanned = { ...ctx.scannedSources };
      const nextChapters = { ...ctx.chaptersBySource };
      delete nextMatches[sourceId];
      delete nextScanned[sourceId];
      delete nextChapters[sourceId];
      ctx.matchedSources = nextMatches;
      ctx.scannedSources = nextScanned;
      ctx.chaptersBySource = nextChapters;
      await scanSourceGroup(groupId, token, sourceId);
      if (!ctx.isMounted || requestToken !== ctx.chapterLoadToken) return;
      matchedManga = ctx.matchedSources[sourceId];
    }
    ctx.selectedSourceId = sourceId;
    try {
      let fetched: any[] = [];
      if (matchedManga) {
        fetched = await matchSlice.fetchChaptersForMatch(
          sourceId,
          matchedManga,
        );
      }
      const isManualMatch = isManualMatchedSource(matchedManga);

      const normalizedQueries = matchSlice
        .getExpandedSearchQueries()
        .map((query) => normalizeMatchText(query))
        .filter(Boolean);
      const shouldProbeStrictRankedAlternatives =
        isStrictRankedSource(sourceId) &&
        fetched.length > 0 &&
        fetched.length <= ctx.STRICT_RANKED_LOW_CHAPTER_PROBE_THRESHOLD;
      const canFallbackForSource =
        !isSlugRankedSource(sourceId) && !isManualMatch;

      if (!matchedManga) {
        if (isTitleExactSource(sourceId)) {
          toasts.add("Could not find this manga on this source", "info");
          return;
        }
        const fallback =
          await matchSlice.findFallbackMatchWithChapters(sourceId);
        if (!ctx.isMounted || requestToken !== ctx.chapterLoadToken) return;
        if (!fallback) {
          toasts.add("Could not find this manga on this source", "info");
          return;
        }
        matchedManga = fallback.match;
        fetched = fallback.chapters;
        ctx.matchedSources = {
          ...ctx.matchedSources,
          [sourceId]: toAutoMatch(matchedManga),
        };
      } else if (
        !isManualMatch &&
        ((fetched.length === 0 && canFallbackForSource) ||
          shouldProbeStrictRankedAlternatives)
      ) {
        const fallback = await matchSlice.findFallbackMatchWithChapters(
          sourceId,
          matchedManga,
        );
        if (!ctx.isMounted || requestToken !== ctx.chapterLoadToken) return;
        const currentTitleScore = scoreCandidateMatch(
          matchedManga,
          normalizedQueries,
        );
        const fallbackTitleScore =
          fallback?.titleScore ??
          scoreCandidateMatch(fallback?.match, normalizedQueries);
        const currentMaxChapter = getMaxChapterNumber(fetched);
        const fallbackMaxChapter = getMaxChapterNumber(
          fallback?.chapters || [],
        );
        if (
          fallback &&
          shouldAdoptFallbackMatch(
            fetched.length,
            fallback.chapters.length,
            currentTitleScore,
            fallbackTitleScore,
            currentMaxChapter,
            fallbackMaxChapter,
          )
        ) {
          matchedManga = fallback.match;
          fetched = fallback.chapters;
          ctx.matchedSources = {
            ...ctx.matchedSources,
            [sourceId]: toAutoMatch(matchedManga),
          };
        }
      }

      if (!ctx.isMounted || requestToken !== ctx.chapterLoadToken) return;
      const mergedFetched = await ctx.mergeLocalChapterStates(fetched);
      if (!ctx.isMounted || requestToken !== ctx.chapterLoadToken) return;
      ctx.chapters = mergedFetched;
      ctx.chaptersBySource = {
        ...ctx.chaptersBySource,
        [sourceId]: [...mergedFetched],
      };
      ctx.persistSeriesSessionCache();
    } catch (e) {
      const isStaleRequest =
        requestToken !== ctx.chapterLoadToken || token !== ctx.loadToken;
      if (isStaleRequest) {
        console.warn("Ignoring stale chapter load failure:", e);
        return;
      }
      console.error("Failed to load chapters:", e);
      toasts.add("Failed to load chapters from source", "error");
    } finally {
      if (requestToken !== ctx.chapterLoadToken) return;
      if (token !== ctx.loadToken) return;
      ctx.isLoading = false;
    }
  }

  async function handleSourceLanguageChange(groupId: string, sourceId: string) {
    ctx.selectedVariantByGroup = {
      ...ctx.selectedVariantByGroup,
      [groupId]: sourceId,
    };
    await selectSource(groupId, sourceId);
    ctx.persistSeriesSessionCache();
  }

  return {
    buildSourceGroups,
    resolveSourceId,
    scanSources,
    scanSourceGroup,
    selectSource,
    handleSourceLanguageChange,
    applyManualSourceUrl,
    forgetManualSourceUrl,
    getManualSourceUrl,
    getExpectedHostForGroup,
  };
}
