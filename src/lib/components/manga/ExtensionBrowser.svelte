<script lang="ts">
  import { onMount } from "svelte";
  import { fade, slide } from "svelte/transition";
  import MangaCard from "./MangaCard.svelte";
  import { toasts } from "../../stores/toast";
  import { buildSourceGroups, resolveSourceId } from "./sourceCatalog";

  interface Props {
    onSelectManga: (manga: any, sourceId: string) => void;
  }

  let { onSelectManga }: Props = $props();

  // --- State ---
  let sources = $state<any[]>([]);
  let sourceGroups = $state<any[]>([]);
  let selectedSourceId = $state<string>("");
  let selectedSourceGroupId = $state<string>("");
  let selectedVariantByGroup = $state<Record<string, string>>({});
  let searchQuery = $state("");
  let searchResults = $state<any[]>([]);
  let isLoading = $state(false);
  let activeTab = $state<"popular" | "latest" | "search">("popular");
  let page = $state(1);
  let hasNextPage = $state(true);
  let refreshToken = 0;
  const activeGroup = $derived(
    sourceGroups.find((g) => g.id === selectedSourceGroupId),
  );
  const activeSourceId = $derived(
    resolveSourceId(
      selectedSourceGroupId,
      sourceGroups,
      selectedVariantByGroup,
    ),
  );

  function getSourceFetchErrorMessage(sourceId: string, error: unknown) {
    void sourceId;
    const message = String(
      (error as any)?.message || error || "",
    ).toLowerCase();
    if (message.includes("verification required") || message.includes("cloudflare") || message.includes("challenge")) {
      return "Source verification required; complete the browser window and retry.";
    }
    return "Failed to fetch manga from source";
  }

  // --- Methods ---
  async function loadSources() {
    try {
      sources = await window.electronAPI.manga.getEnabledSources();
      const next = buildSourceGroups(sources, selectedVariantByGroup);
      sourceGroups = next.groups;
      selectedVariantByGroup = {
        ...selectedVariantByGroup,
        ...next.preferredVariantByGroup,
      };
      if (sourceGroups.length > 0 && !selectedSourceGroupId) {
        selectedSourceGroupId = sourceGroups[0].id;
        selectedSourceId = resolveSourceId(
          selectedSourceGroupId,
          sourceGroups,
          selectedVariantByGroup,
        );
      }
    } catch (e) {
      console.error("Failed to load sources:", e);
    }
  }

  function handleGroupChange(groupId: string) {
    selectedSourceGroupId = groupId;
    selectedSourceId = resolveSourceId(
      groupId,
      sourceGroups,
      selectedVariantByGroup,
    );
    refreshResults();
  }

  function handleLanguageChange(groupId: string, sourceId: string) {
    selectedVariantByGroup[groupId] = sourceId;
    selectedVariantByGroup = { ...selectedVariantByGroup };
    selectedSourceGroupId = groupId;
    selectedSourceId = resolveSourceId(
      groupId,
      sourceGroups,
      selectedVariantByGroup,
      sourceId,
    );
    refreshResults();
  }

  async function refreshResults(resetPage = true) {
    if (!selectedSourceId) return;
    const token = ++refreshToken;
    if (resetPage) {
      page = 1;
      searchResults = [];
    }
    isLoading = true;

    try {
      let res;
      if (activeTab === "search" && searchQuery) {
        res = await window.electronAPI.manga.search(
          selectedSourceId,
          searchQuery,
          page,
        );
      } else if (activeTab === "latest") {
        res = await window.electronAPI.manga.getLatest(selectedSourceId, page);
      } else {
        res = await window.electronAPI.manga.getPopular(selectedSourceId, page);
      }

      if (res) {
        if (token !== refreshToken) return;
        searchResults = [...searchResults, ...res.items];
        hasNextPage = res.hasNextPage;
      }
    } catch (e) {
      console.error("Failed to load results:", e);
      toasts.add(getSourceFetchErrorMessage(selectedSourceId, e), "error");
    } finally {
      isLoading = false;
    }
  }

  function handleSearch() {
    if (!searchQuery.trim()) return;
    activeTab = "search";
    refreshResults();
  }

  function handleLoadMore() {
    if (isLoading || !hasNextPage) return;
    page++;
    refreshResults(false);
  }

  // --- Lifecycle ---
  onMount(async () => {
    await loadSources();
    if (selectedSourceId) {
      refreshResults();
    }
  });

  $effect(() => {
    if (selectedSourceId && selectedSourceGroupId && activeTab !== "search") {
      refreshResults();
    }
  });
</script>

<div class="flex flex-col gap-6">
  <!-- Controls -->
  <div
    class="flex flex-col gap-6 p-6 bg-slate-900/30 rounded-3xl border border-white/5 shadow-inner"
  >
    <div class="flex flex-wrap items-center gap-6">
      <!-- Source Selection Group -->
      <div class="flex flex-col gap-2">
        <label
          for="extension-source-select"
          class="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1"
          >Extension Source</label
        >
        <div class="flex items-center gap-3">
          <select
            id="extension-source-select"
            bind:value={selectedSourceGroupId}
            onchange={(e) =>
              handleGroupChange((e.currentTarget as HTMLSelectElement).value)}
            class="bg-slate-900 border border-slate-700/50 rounded-xl px-4 py-2.5 text-sm font-bold text-white focus:outline-none focus:border-blue-500/50 transition-all min-w-[200px] shadow-lg"
          >
            {#each sourceGroups as group}
              <option value={group.id}>{group.name}</option>
            {/each}
          </select>

          {#if activeGroup && activeGroup.variants.length > 1}
            <select
              value={activeSourceId}
              onchange={(e) =>
                handleLanguageChange(
                  selectedSourceGroupId,
                  (e.currentTarget as HTMLSelectElement).value,
                )}
              class="bg-slate-900 border border-slate-700/50 rounded-xl px-3 py-2.5 text-xs font-black uppercase tracking-widest text-blue-300 focus:outline-none focus:border-blue-500/50 transition-all min-w-[88px] shadow-lg"
              title="Source Language"
            >
              {#each activeGroup.variants as variant}
                <option value={variant.id}>{variant.label}</option>
              {/each}
            </select>
          {/if}

          <div
            class="flex bg-slate-900/80 p-1 rounded-xl border border-slate-700/50 shadow-lg"
          >
            <button
              onclick={() => (activeTab = "popular")}
              class="px-5 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all {activeTab ===
              'popular'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'text-slate-500 hover:text-white'}"
            >
              Popular
            </button>
            <button
              onclick={() => (activeTab = "latest")}
              class="px-5 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all {activeTab ===
              'latest'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'text-slate-500 hover:text-white'}"
            >
              Latest
            </button>
          </div>
        </div>
      </div>

      <!-- Search Group -->
      <div class="flex-1 flex flex-col gap-2">
        <label
          for="manga-search-input"
          class="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1"
          >Search Catalog</label
        >
        <div class="relative group">
          <input
            id="manga-search-input"
            type="text"
            bind:value={searchQuery}
            placeholder="Enter search keywords..."
            class="w-full pl-12 pr-4 py-3 bg-slate-900 border border-slate-700/50 rounded-xl text-sm font-medium text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all shadow-lg"
            onkeydown={(e) => e.key === "Enter" && handleSearch()}
          />
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
      <p class="text-slate-500 font-medium">No results found</p>
    </div>
  {:else}
    <div
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6"
    >
      {#each searchResults as manga}
        <MangaCard
          title={manga.title}
          coverUrl={manga.cover_url}
          subtitle={manga.subtitle}
          onClick={() => onSelectManga(manga, selectedSourceId)}
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
