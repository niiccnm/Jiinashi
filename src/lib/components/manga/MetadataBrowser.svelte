<script module lang="ts">
  import type { SeriesTitleStyle as MetadataSeriesTitleStyle } from "../../utils/manga";

  type MetadataBrowserTab = "trending" | "popular" | "search";

  interface MetadataBrowserSessionSnapshot {
    activeTab: MetadataBrowserTab;
    searchQuery: string;
    searchResults: any[];
    page: number;
    hasNextPage: boolean;
    seriesTitleStyle: MetadataSeriesTitleStyle;
  }

  let sessionSnapshot: MetadataBrowserSessionSnapshot | null = null;

  function getSessionSnapshot() {
    if (!sessionSnapshot) return null;
    return {
      ...sessionSnapshot,
      searchResults: Array.isArray(sessionSnapshot.searchResults)
        ? [...sessionSnapshot.searchResults]
        : [],
    };
  }

  function setSessionSnapshot(snapshot: MetadataBrowserSessionSnapshot) {
    sessionSnapshot = {
      ...snapshot,
      page: Number(snapshot.page || 1),
      hasNextPage: Boolean(snapshot.hasNextPage),
      searchResults: Array.isArray(snapshot.searchResults)
        ? [...snapshot.searchResults]
        : [],
    };
  }
</script>

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { fade } from "svelte/transition";
  import MangaCard from "./MangaCard.svelte";
  import { toasts } from "../../stores/toast";
  import {
    formatMangaStatus,
    normalizeSeriesTitleStyle,
    resolveSeriesTitle,
    type SeriesTitleStyle,
  } from "../../utils/manga";
  import { parseMangabakaId, parsePositiveId } from "./library-view/mlv-domain-core";

  interface Props {
    onSelectManga: (manga: any) => void;
  }

  let { onSelectManga }: Props = $props();

  // --- State ---
  let searchQuery = $state("");
  let searchResults = $state.raw<any[]>([]);
  let isLoading = $state(false);
  let activeTab = $state<MetadataBrowserTab>("trending");
  let page = $state(1);
  let hasNextPage = $state(true);
  let searchTimeout = $state<any>(null);
  let seriesTitleStyle = $state<SeriesTitleStyle>("romaji");

  function persistSessionSnapshot() {
    setSessionSnapshot({
      activeTab,
      searchQuery,
      searchResults,
      page,
      hasNextPage,
      seriesTitleStyle,
    });
  }

  function restoreSessionSnapshot() {
    const snapshot = getSessionSnapshot();
    if (!snapshot) return false;

    activeTab = snapshot.activeTab;
    searchQuery = snapshot.searchQuery;
    searchResults = Array.isArray(snapshot.searchResults)
      ? [...snapshot.searchResults]
      : [];
    const parsedPage = Number(snapshot.page || 1);
    page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    hasNextPage = Boolean(snapshot.hasNextPage);
    seriesTitleStyle = normalizeSeriesTitleStyle(snapshot.seriesTitleStyle);
    return true;
  }

  function toPositiveInt(value: unknown) {
    return parsePositiveId(value) || 0;
  }

  function collectIdentityKeys(manga: any): string[] {
    const provider = String(manga?.provider || "").toLowerCase();
    const anilistId =
      toPositiveInt(manga?.anilist_id) ||
      (provider === "anilist" ? toPositiveInt(manga?.id) : 0) ||
      toPositiveInt(manga?.idAnilist);
    const malId = toPositiveInt(manga?.mal_id) || toPositiveInt(manga?.idMal);
    const mangabakaId =
      (parseMangabakaId(manga) || 0) ||
      (provider === "mangabaka" ? toPositiveInt(manga?.id) : 0) ||
      0;

    const keys: string[] = [];
    if (anilistId > 0) keys.push(`anilist:${anilistId}`);
    if (malId > 0) keys.push(`mal:${malId}`);
    if (mangabakaId > 0) keys.push(`mangabaka:${mangabakaId}`);
    return keys;
  }

  function collectTitleFingerprints(manga: any): string[] {
    const titles = [
      manga?.title?.romaji,
      manga?.title?.english,
      manga?.title?.native,
      manga?.romanized_title,
      manga?.title,
      manga?.native_title,
    ];
    const out = new Set<string>();
    for (const title of titles) {
      const normalized = normalizeText(title);
      if (normalized) out.add(normalized);
    }
    return [...out];
  }

  function normalizeCoverUrl(value: unknown) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return raw.replace(/\?.*$/, "");
  }

  function getProviderPriority(manga: any) {
    const provider = String(manga?.provider || "").toLowerCase();
    if (provider === "anilist") return 2;
    if (provider === "mangabaka") return 1;
    return 0;
  }

  function getResultQualityScore(manga: any) {
    const idScore =
      (toPositiveInt(manga?.anilist_id) > 0 ? 12 : 0) +
      (toPositiveInt(manga?.mal_id) > 0 ? 8 : 0) +
      (toPositiveInt(manga?.mangabaka_id) > 0 ? 6 : 0);
    const contentScore =
      (normalizeCoverUrl(getCoverUrl(manga)) ? 4 : 0) +
      (String(manga?.description || "").trim() ? 2 : 0);
    return idScore + contentScore;
  }

  function shouldPreferResult(candidate: any, current: any) {
    const candidateProviderPriority = getProviderPriority(candidate);
    const currentProviderPriority = getProviderPriority(current);

    // AniList is the canonical metadata provider. Mangabaka may fill missing
    // fields and IDs, but its extra metadata must never replace AniList titles.
    if (candidateProviderPriority !== currentProviderPriority) {
      return candidateProviderPriority > currentProviderPriority;
    }

    return getResultQualityScore(candidate) > getResultQualityScore(current);
  }

  function mergeTitles(preferred: any, secondary: any) {
    return {
      romaji: preferred?.title?.romaji || secondary?.title?.romaji || null,
      english: preferred?.title?.english || secondary?.title?.english || null,
      native: preferred?.title?.native || secondary?.title?.native || null,
    };
  }

  function mergeCoverImage(preferred: any, secondary: any) {
    return {
      extraLarge:
        preferred?.coverImage?.extraLarge ||
        secondary?.coverImage?.extraLarge ||
        null,
      large: preferred?.coverImage?.large || secondary?.coverImage?.large || null,
    };
  }

  function mergeDuplicateResult(preferred: any, secondary: any) {
    const preferredProvider = String(preferred?.provider || "").toLowerCase();
    const merged = {
      ...secondary,
      ...preferred,
      provider: preferred?.provider || secondary?.provider,
      sourceProvider: preferred?.sourceProvider || secondary?.sourceProvider,
      title: mergeTitles(preferred, secondary),
      coverImage: mergeCoverImage(preferred, secondary),
      anilist_id:
        toPositiveInt(preferred?.anilist_id) ||
        toPositiveInt(secondary?.anilist_id) ||
        undefined,
      mal_id:
        toPositiveInt(preferred?.mal_id) ||
        toPositiveInt(secondary?.mal_id) ||
        undefined,
      mangabaka_id:
        toPositiveInt(preferred?.mangabaka_id) ||
        toPositiveInt(secondary?.mangabaka_id) ||
        undefined,
    };

    if (preferredProvider === "anilist" && !merged.mangabaka_id) {
      merged.mangabaka_id =
        toPositiveInt(secondary?.id) ||
        (parseMangabakaId(secondary) || 0) ||
        undefined;
    }

    if (preferredProvider === "anilist") {
      const anilistId =
        toPositiveInt(merged.anilist_id) || toPositiveInt(merged.id);
      merged.source_url =
        String(preferred?.source_url || "").trim() ||
        (anilistId > 0 ? `https://anilist.co/manga/${anilistId}` : undefined);
    } else if (!merged.source_url) {
      merged.source_url = preferred?.source_url || secondary?.source_url;
    }

    return merged;
  }

  function hasIntersection(left: Set<string>, right: Set<string>) {
    for (const value of left) {
      if (right.has(value)) return true;
    }
    return false;
  }

  function dedupeSearchResults(results: any[]) {
    const deduped: Array<{
      item: any;
      keys: Set<string>;
      titleFingerprints: Set<string>;
      cover: string;
    }> = [];

    for (const result of results) {
      const keys = new Set(collectIdentityKeys(result));
      const titleFingerprints = new Set(collectTitleFingerprints(result));
      const cover = normalizeCoverUrl(getCoverUrl(result));

      let matchIndex = -1;
      for (let i = 0; i < deduped.length; i++) {
        const existing = deduped[i];
        const identityMatch = hasIntersection(keys, existing.keys);
        const titleMatch = hasIntersection(titleFingerprints, existing.titleFingerprints);
        const coverMatch = Boolean(cover) && Boolean(existing.cover) && cover === existing.cover;
        if (identityMatch || (titleMatch && coverMatch)) {
          matchIndex = i;
          break;
        }
      }

      if (matchIndex < 0) {
        deduped.push({
          item: result,
          keys,
          titleFingerprints,
          cover,
        });
        continue;
      }

      const existing = deduped[matchIndex];
      const preferred = shouldPreferResult(result, existing.item)
        ? result
        : existing.item;
      const secondary = preferred === result ? existing.item : result;
      const merged = mergeDuplicateResult(preferred, secondary);
      deduped[matchIndex] = {
        item: merged,
        keys: new Set([...existing.keys, ...keys, ...collectIdentityKeys(merged)]),
        titleFingerprints: new Set([
          ...existing.titleFingerprints,
          ...titleFingerprints,
          ...collectTitleFingerprints(merged),
        ]),
        cover: normalizeCoverUrl(getCoverUrl(merged)) || existing.cover || cover,
      };
    }

    return deduped.map((entry) => entry.item);
  }

  function normalizeText(value: unknown) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function getDisplayTitle(manga: any) {
    if (String(manga?.provider || "").toLowerCase() === "mangabaka") {
      return resolveSeriesTitle(
        {
          title_original: manga?.title?.native || manga?.native_title,
          title_romaji: manga?.title?.romaji || manga?.romanized_title,
          title_english: manga?.title?.english || manga?.title,
        },
        seriesTitleStyle,
        "Unknown Series",
      );
    }

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

  function getCoverUrl(manga: any) {
    if (String(manga?.provider || "").toLowerCase() === "mangabaka") {
      return (
        manga?.coverImage?.extraLarge ||
        manga?.coverImage?.large ||
        manga?.cover?.raw?.url ||
        manga?.cover?.x350?.x2 ||
        manga?.cover?.x350?.x1
      );
    }
    return manga?.coverImage?.extraLarge || manga?.coverImage?.large;
  }

  function getSubtitle(manga: any) {
    const status = formatMangaStatus(manga?.status);
    if (String(manga?.provider || "").toLowerCase() === "mangabaka") {
      return status ? `Mangabaka • ${status}` : "Mangabaka";
    }
    return status;
  }

  function normalizeAnilistMedia(media: any) {
    return {
      ...media,
      provider: "anilist",
      sourceProvider: "anilist",
      anilist_id: Number(media?.id || 0) || undefined,
      mal_id: Number(media?.idMal || 0) || undefined,
    };
  }

  function normalizeMangabakaSeries(series: any) {
    const id = Number(series?.id || 0) || 0;
    return {
      ...series,
      provider: "mangabaka",
      sourceProvider: "mangabaka",
      id,
      mangabaka_id: id || undefined,
      anilist_id: Number(series?.source?.anilist?.id || 0) || undefined,
      mal_id: Number(series?.source?.my_anime_list?.id || 0) || undefined,
      source_url: id > 0 ? `https://mangabaka.org/${id}` : undefined,
      title: {
        romaji: String(series?.romanized_title || "").trim() || null,
        english: String(series?.title || "").trim() || null,
        native: String(series?.native_title || "").trim() || null,
      },
      coverImage: {
        extraLarge:
          String(series?.cover?.raw?.url || "").trim() ||
          String(series?.cover?.x350?.x2 || "").trim() ||
          String(series?.cover?.x350?.x1 || "").trim() ||
          null,
        large:
          String(series?.cover?.x350?.x1 || "").trim() ||
          String(series?.cover?.raw?.url || "").trim() ||
          null,
      },
    };
  }

  async function refreshSeriesTitleStyle() {
    try {
      const rawStyle =
        await window.electronAPI.settings.get("seriesTitleStyle");
      seriesTitleStyle = normalizeSeriesTitleStyle(rawStyle);
    } catch {
      seriesTitleStyle = "romaji";
    }
  }

  // --- Methods ---
  async function refreshResults(resetPage = true, force = false) {
    if (force) {
      clearTimeout(searchTimeout);
    }
    // Don't clear results immediately to prevent flickering
    if (resetPage) {
      page = 1;
    }
    isLoading = true;

    try {
      await refreshSeriesTitleStyle();
      let res;
      if (activeTab === "search" && searchQuery) {
        const [anilistResult, mangabakaResult] = await Promise.allSettled([
          window.electronAPI.manga.anilistSearch(searchQuery, page),
          window.electronAPI.manga.mangabakaSearch(searchQuery, page, 10),
        ]);

        const anilistMedia =
          anilistResult.status === "fulfilled" &&
          Array.isArray(anilistResult.value?.media)
            ? anilistResult.value.media.map(normalizeAnilistMedia)
            : [];
        const mangabakaMedia =
          mangabakaResult.status === "fulfilled" &&
          Array.isArray(mangabakaResult.value?.data)
            ? mangabakaResult.value.data.map(normalizeMangabakaSeries)
            : [];
        const merged = dedupeSearchResults([...anilistMedia, ...mangabakaMedia]);

        if (resetPage) {
          searchResults = merged;
        } else {
          searchResults = dedupeSearchResults([...searchResults, ...merged]);
        }

        const anilistHasNext =
          anilistResult.status === "fulfilled"
            ? Boolean(anilistResult.value?.pageInfo?.hasNextPage)
            : false;
        const mangabakaHasNext =
          mangabakaResult.status === "fulfilled"
            ? Number(mangabakaResult.value?.pagination?.current_page || 0) <
              Number(mangabakaResult.value?.pagination?.last_page || 0)
            : false;
        hasNextPage = anilistHasNext || mangabakaHasNext;
        persistSessionSnapshot();
        return;
      } else if (activeTab === "trending") {
        res = await window.electronAPI.manga.anilistTrending(page);
      } else {
        res = await window.electronAPI.manga.anilistPopular(page);
      }

      if (res && res.media) {
        const mapped = res.media.map(normalizeAnilistMedia);
        if (resetPage) {
          searchResults = mapped;
        } else {
          searchResults = [...searchResults, ...mapped];
        }
        hasNextPage = res.pageInfo.hasNextPage;
      } else {
        console.warn("No results or invalid format:", res);
        hasNextPage = false;
        if (resetPage) searchResults = [];
      }
      persistSessionSnapshot();
    } catch (e) {
      console.error("Failed to load results:", e);
      toasts.add("Downloader: Failed to fetch metadata results.", "error");
      if (resetPage) {
        searchResults = [];
      }
      persistSessionSnapshot();
    } finally {
      isLoading = false;
    }
  }

  export async function reloadCurrentResults() {
    await refreshResults(true, true);
  }

  function handleSearch() {
    if (!searchQuery.trim()) {
      activeTab = "trending";
    } else {
      activeTab = "search";
    }
    persistSessionSnapshot();
    void refreshResults();
  }

  function debounceSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      handleSearch();
    }, 500);
  }

  function handleSearchInput() {
    debounceSearch();
    persistSessionSnapshot();
  }

  function handleLoadMore() {
    if (isLoading || !hasNextPage) return;
    page++;
    persistSessionSnapshot();
    void refreshResults(false);
  }

  // --- Lifecycle ---
  onMount(async () => {
    const restored = restoreSessionSnapshot();
    await refreshSeriesTitleStyle();
    if (restored) {
      return;
    }
    await refreshResults();
  });

  onDestroy(() => {
    clearTimeout(searchTimeout);
  });
</script>

<div class="flex flex-col gap-6">
  <!-- Controls -->
  <div
    class="flex flex-col gap-6 p-6 bg-slate-900/30 rounded-3xl border border-white/5 shadow-inner"
  >
    <div class="flex flex-wrap items-center gap-6">
      <!-- Browse Type -->
      <div class="flex flex-col gap-2">
        <label
          for="browse-type"
          class="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1"
          >Browse</label
        >
        <div
          class="flex bg-slate-900/80 p-1 rounded-xl border border-slate-700/50 shadow-lg"
        >
          <button
            onclick={() => {
              activeTab = "trending";
              persistSessionSnapshot();
              void refreshResults();
            }}
            class="px-5 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all {activeTab ===
            'trending'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
              : 'text-slate-500 hover:text-white'}"
          >
            Trending
          </button>
          <button
            onclick={() => {
              activeTab = "popular";
              persistSessionSnapshot();
              void refreshResults();
            }}
            class="px-5 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all {activeTab ===
            'popular'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
              : 'text-slate-500 hover:text-white'}"
          >
            All Time
          </button>
        </div>
      </div>

      <!-- Search Group -->
      <div class="flex-1 flex flex-col gap-2">
        <label
          for="manga-search-input"
          class="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1"
          >Search Global Database (AniList + Mangabaka)</label
        >
        <div class="relative group">
          <input
            id="manga-search-input"
            type="text"
            bind:value={searchQuery}
            placeholder="Enter manga title..."
            class="w-full pl-12 pr-10 py-3 bg-slate-900 border border-slate-700/50 rounded-xl text-sm font-medium text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all shadow-lg"
            oninput={handleSearchInput}
            onkeydown={(e) => e.key === "Enter" && handleSearch()}
          />

          {#if isLoading}
            <div
              class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin"
            ></div>
          {:else}
            <svg
              class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-blue-500 transition-colors"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2.5"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          {/if}

          {#if searchQuery}
            <button
              onclick={() => {
                searchQuery = "";
                handleSearch();
              }}
              class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-white rounded-full hover:bg-slate-700/50 transition-colors"
              aria-label="Clear search"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- Results Grid -->
  {#if searchResults.length === 0 && !isLoading}
    <div
      class="flex flex-col items-center justify-center py-20 bg-slate-900/20 rounded-3xl border border-dashed border-slate-800"
      in:fade
    >
      <p class="text-slate-500 font-medium">
        No results found on AniList or Mangabaka
      </p>
    </div>
  {:else}
    <div
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-6"
    >
      {#each searchResults as manga}
        <MangaCard
          title={getDisplayTitle(manga)}
          coverUrl={getCoverUrl(manga)}
          subtitle={getSubtitle(manga)}
          onClick={() => onSelectManga(manga)}
        />
      {/each}
    </div>

    {#if hasNextPage}
      <div class="flex justify-center py-10">
        <button
          onclick={handleLoadMore}
          disabled={isLoading}
          class="px-8 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white font-bold rounded-2xl transition-all active:scale-95 disabled:opacity-50"
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
  {/if}
</div>
