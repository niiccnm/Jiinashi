<script lang="ts">
  import { untrack } from "svelte";
  import MangaCard from "./MangaCard.svelte";
  import {
    mangaRecommendationRenderedMediaIdsSession,
    mangaRecommendationSessionCache,
    type RecommendationSessionEntry,
    type RecommendationSessionPageResult,
  } from "./mangaSeriesSessionCache";
  import {
    formatMangaStatus,
    resolveSeriesTitle,
    type SeriesTitleStyle,
  } from "../../utils/manga";

  interface Props {
    mediaId: number;
    seriesTitleStyle: SeriesTitleStyle;
    onSelectManga: (manga: RecommendationMedia) => void;
  }

  type RecommendationsResponse = Awaited<
    ReturnType<typeof window.electronAPI.manga.anilistRecommendations>
  >;
  type RecommendationNode = RecommendationsResponse["nodes"][number];
  type RecommendationMedia = RecommendationNode["mediaRecommendation"];
  type RecommendationPageResult = RecommendationSessionPageResult;
  type RecommendationRenderState = {
    nodes: RecommendationNode[];
    visibleCount: number;
  };
  let { mediaId, seriesTitleStyle, onSelectManga }: Props = $props();

  const ITEMS_PER_PAGE = 5;

  let recommendationNodes = $state.raw<RecommendationNode[]>([]);
  let nextPage = $state(1);
  let hasNextPage = $state(false);
  let isLoading = $state(false);
  let visibleCount = $state(ITEMS_PER_PAGE);
  let loadError = $state<string | null>(null);
  let requestToken = 0;
  let renderedMediaIds = $state<number[]>(
    Array.from(mangaRecommendationRenderedMediaIdsSession),
  );

  function createRecommendationSessionEntry(): RecommendationSessionEntry {
    return {
      nodes: [],
      pageCache: new Map<number, RecommendationPageResult>(),
      pageRequests: new Map<number, Promise<RecommendationPageResult>>(),
      nextPage: 1,
      hasNextPage: false,
      visibleCount: ITEMS_PER_PAGE,
    };
  }

  function getRecommendationSessionEntry(
    mediaIdValue: number,
    createIfMissing = true,
  ) {
    if (!Number.isFinite(mediaIdValue) || mediaIdValue <= 0) return null;
    let entry = mangaRecommendationSessionCache.get(mediaIdValue);
    if (!entry && createIfMissing) {
      entry = createRecommendationSessionEntry();
      mangaRecommendationSessionCache.set(mediaIdValue, entry);
    }
    return entry ?? null;
  }

  function getNormalizedVisibleCount(value: number, total: number) {
    if (total <= 0) return ITEMS_PER_PAGE;
    const parsed = Number(value || ITEMS_PER_PAGE);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return ITEMS_PER_PAGE;
    }
    return Math.max(ITEMS_PER_PAGE, Math.min(parsed, total));
  }

  function clonePageResult(pageResult: RecommendationPageResult) {
    return {
      nodes: Array.isArray(pageResult?.nodes) ? [...pageResult.nodes] : [],
      pageInfo: {
        hasNextPage: Boolean(pageResult?.pageInfo?.hasNextPage),
      },
    } satisfies RecommendationPageResult;
  }

  function applySessionEntry(entry: RecommendationSessionEntry) {
    const cachedNodes = Array.isArray(entry.nodes)
      ? ([...entry.nodes] as RecommendationNode[])
      : [];
    recommendationNodes = cachedNodes;
    const parsedNextPage = Number(entry.nextPage || 1);
    nextPage =
      Number.isFinite(parsedNextPage) && parsedNextPage > 0 ? parsedNextPage : 1;
    hasNextPage = Boolean(entry.hasNextPage);
    visibleCount =
      cachedNodes.length > 0
        ? getNormalizedVisibleCount(entry.visibleCount, cachedNodes.length)
        : ITEMS_PER_PAGE;
    loadError = null;
  }

  function getRenderStateForMediaId(
    mediaIdValue: number,
  ): RecommendationRenderState | null {
    if (mediaIdValue <= 0) return null;

    if (mediaIdValue === mediaId) {
      return {
        nodes: recommendationNodes,
        visibleCount,
      };
    }

    const cached = getRecommendationSessionEntry(mediaIdValue, false);
    if (!cached) return null;
    const nodes = Array.isArray(cached.nodes)
      ? ([...cached.nodes] as RecommendationNode[])
      : [];
    return {
      nodes,
      visibleCount:
        nodes.length > 0
          ? getNormalizedVisibleCount(cached.visibleCount, nodes.length)
          : ITEMS_PER_PAGE,
    };
  }

  function persistSessionEntry(mediaIdValue: number) {
    const entry = getRecommendationSessionEntry(mediaIdValue);
    if (!entry) return;

    entry.nodes = [...recommendationNodes];
    const parsedNextPage = Number(nextPage || 1);
    entry.nextPage =
      Number.isFinite(parsedNextPage) && parsedNextPage > 0 ? parsedNextPage : 1;
    entry.hasNextPage = Boolean(hasNextPage);
    entry.visibleCount =
      recommendationNodes.length > 0
        ? getNormalizedVisibleCount(visibleCount, recommendationNodes.length)
        : ITEMS_PER_PAGE;
  }

  function getDisplayTitle(manga: RecommendationMedia) {
    return resolveSeriesTitle(
      {
        title_original: manga?.title?.native,
        title_romaji: manga?.title?.romaji,
        title_english: manga?.title?.english,
      },
      seriesTitleStyle,
      "Unknown Series",
    );
  }

  function normalizeRecommendationNodes(nodes: unknown[]): RecommendationNode[] {
    return nodes
      .map((node): RecommendationNode | null => {
        if (!node || typeof node !== "object") return null;
        const candidate = node as {
          id?: unknown;
          mediaRecommendation?: RecommendationMedia | null;
        };
        if (candidate.mediaRecommendation == null) return null;
        const id = Number(candidate.id ?? 0);
        if (!Number.isFinite(id) || id <= 0) return null;
        return {
          id,
          mediaRecommendation: candidate.mediaRecommendation,
        };
      })
      .filter((node): node is RecommendationNode => node !== null);
  }

  function mergeRecommendationNodes(nextNodes: RecommendationNode[]) {
    recommendationNodes = mergeRecommendationNodeCollections(
      recommendationNodes,
      nextNodes,
    );
  }

  function mergeRecommendationNodeCollections(
    existingNodes: RecommendationNode[],
    nextNodes: RecommendationNode[],
  ) {
    const seenIds = new Set<number>();
    for (const existing of existingNodes) {
      if (existing?.id > 0) seenIds.add(existing.id);
    }
    const merged = [...existingNodes];
    for (const next of nextNodes) {
      if (seenIds.has(next.id)) continue;
      seenIds.add(next.id);
      merged.push(next);
    }
    return merged;
  }

  async function fetchRecommendationPage(
    mediaIdValue: number,
    pageValue: number,
  ): Promise<RecommendationPageResult> {
    const result = await window.electronAPI.manga.anilistRecommendations(
      mediaIdValue,
      pageValue,
      ITEMS_PER_PAGE,
    );
    return {
      nodes: normalizeRecommendationNodes(result?.nodes ?? []),
      pageInfo: {
        hasNextPage: Boolean(result?.pageInfo?.hasNextPage),
      },
    };
  }

  async function getRecommendationPage(
    mediaIdValue: number,
    pageValue: number,
  ): Promise<RecommendationPageResult> {
    const sessionEntry = getRecommendationSessionEntry(mediaIdValue);
    if (!sessionEntry) {
      throw new Error("Missing recommendation session cache entry");
    }

    const cached = sessionEntry.pageCache.get(pageValue);
    if (cached) return cached;

    const inFlight = sessionEntry.pageRequests.get(pageValue);
    if (inFlight) return inFlight;

    const request = fetchRecommendationPage(mediaIdValue, pageValue)
      .then((pageResult) => {
        const activeEntry = getRecommendationSessionEntry(mediaIdValue);
        if (activeEntry) {
          const clonedPageResult = clonePageResult(pageResult);
          activeEntry.pageCache.set(pageValue, clonedPageResult);
          activeEntry.nodes = mergeRecommendationNodeCollections(
            activeEntry.nodes as RecommendationNode[],
            clonedPageResult.nodes as RecommendationNode[],
          );
          activeEntry.nextPage = Math.max(
            Number(activeEntry.nextPage || 1),
            pageValue + 1,
          );
          activeEntry.hasNextPage = clonedPageResult.pageInfo.hasNextPage;
        }
        return pageResult;
      })
      .finally(() => {
        const activeEntry = getRecommendationSessionEntry(
          mediaIdValue,
          false,
        );
        if (activeEntry?.pageRequests.get(pageValue) === request) {
          activeEntry.pageRequests.delete(pageValue);
        }
      });

    sessionEntry.pageRequests.set(pageValue, request);
    return request;
  }

  function showLess() {
    visibleCount = ITEMS_PER_PAGE;
    persistSessionEntry(mediaId);
  }

  async function loadMore() {
    // If we have already-fetched cards that are just hidden, reveal them first
    if (visibleCount < recommendationNodes.length) {
      visibleCount = Math.min(
        visibleCount + ITEMS_PER_PAGE,
        recommendationNodes.length,
      );
      persistSessionEntry(mediaId);
      return;
    }
    if (isLoading || !mediaId) return;

    const token = requestToken;
    const currentMediaId = mediaId;
    const currentPage = nextPage;
    isLoading = true;
    loadError = null;
    try {
      const result = await getRecommendationPage(currentMediaId, currentPage);
      if (token !== requestToken || currentMediaId !== mediaId) return;
      mergeRecommendationNodes(result.nodes as RecommendationNode[]);
      hasNextPage = result.pageInfo.hasNextPage;
      nextPage = currentPage + 1;
      visibleCount = recommendationNodes.length;
      persistSessionEntry(currentMediaId);
    } catch (e: unknown) {
      if (token !== requestToken || currentMediaId !== mediaId) return;
      console.error(
        "[MangaRecommendations] Failed to load recommendations:",
        e,
      );
      loadError =
        e instanceof Error && e.message
          ? e.message
          : "Failed to load recommendations";
    } finally {
      if (token === requestToken) {
        isLoading = false;
      }
    }
  }

  $effect.pre(() => {
    // Track only mediaId. Everything else (isLoading etc.) must NOT be
    // be tracked here. This runs before the DOM updates so we don't briefly
    // show the previous series' recommendation covers on fast back/forward.
    const id = mediaId;
    if (id > 0 && !renderedMediaIds.includes(id)) {
      mangaRecommendationRenderedMediaIdsSession.add(id);
      renderedMediaIds = [...renderedMediaIds, id];
    }
    requestToken += 1;
    isLoading = false;
    const cached = getRecommendationSessionEntry(id, false);
    if (cached) {
      applySessionEntry(cached);
    } else {
      recommendationNodes = [];
      nextPage = 1;
      hasNextPage = false;
      visibleCount = ITEMS_PER_PAGE;
      loadError = null;
    }
  });

  $effect(() => {
    const id = mediaId;
    const cached = getRecommendationSessionEntry(id, false);
    if (id > 0) {
      const shouldBootstrap =
        !cached || !cached.pageCache.has(1) || cached.pageRequests.has(1);
      if (shouldBootstrap) {
        untrack(() => void loadMore());
      }
    }
  });
</script>

{#if recommendationNodes.length > 0 || isLoading || renderedMediaIds.length > 0}
  <section class="flex flex-col gap-4 mt-12">
    <div class="flex items-center justify-between px-2">
      <h2
        class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide"
      >
        Recommendations
      </h2>
      {#if isLoading && recommendationNodes.length === 0}
        <div
          class="flex items-center gap-2 text-[10px] font-bold text-blue-400 animate-pulse"
        >
          <div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
          Loading...
        </div>
      {/if}
    </div>

    {#if recommendationNodes.length === 0 && isLoading}
      <!-- skeleton placeholders -->
      <div
        class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-6"
      >
        {#each { length: ITEMS_PER_PAGE } as _}
          <div class="flex flex-col gap-3">
            <div
              class="relative aspect-[3/4] rounded-2xl bg-slate-900/60 border border-white/5 animate-pulse"
            ></div>
            <div class="h-3 w-3/4 rounded bg-slate-800/80 animate-pulse"></div>
          </div>
        {/each}
      </div>
    {:else}
      {#each renderedMediaIds as renderedMediaId (renderedMediaId)}
        {@const renderState = getRenderStateForMediaId(renderedMediaId)}
        {#if renderState && renderState.nodes.length > 0}
          <div
            class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-6"
            style:display={renderedMediaId === mediaId ? "grid" : "none"}
          >
            {#each renderState.nodes.slice(0, renderState.visibleCount) as recNode (recNode?.id)}
              <MangaCard
                title={getDisplayTitle(recNode?.mediaRecommendation)}
                coverUrl={recNode?.mediaRecommendation?.coverImage?.extraLarge ||
                  recNode?.mediaRecommendation?.coverImage?.large ||
                  null}
                subtitle={formatMangaStatus(recNode?.mediaRecommendation?.status)}
                imageLoading="eager"
                onClick={() => onSelectManga(recNode?.mediaRecommendation)}
              />
            {/each}
          </div>
        {/if}
      {/each}

      {#if hasNextPage || visibleCount < recommendationNodes.length}
        <div class="flex justify-center py-6">
          <button
            onclick={loadMore}
            disabled={isLoading}
            class="px-8 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300
                   hover:text-white font-bold rounded-2xl transition-all active:scale-95 disabled:opacity-50"
          >
            {#if isLoading}
              <div
                class="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto"
              ></div>
            {:else}
              Load More
            {/if}
          </button>
        </div>
      {/if}
      {#if loadError}
        <p class="text-center text-[11px] font-semibold text-rose-400 px-2">
          {loadError}
        </p>
      {/if}
      {#if visibleCount > ITEMS_PER_PAGE}
        <div class="flex justify-center pb-4">
          <button
            onclick={showLess}
            class="text-[11px] font-bold text-slate-500 hover:text-slate-300 uppercase tracking-widest transition-colors"
          >
            Show Less
          </button>
        </div>
      {/if}
    {/if}
  </section>
{/if}
