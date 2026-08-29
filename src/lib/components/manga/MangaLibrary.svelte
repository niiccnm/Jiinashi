<script lang="ts">
  import { onMount } from "svelte";
  import MangaCard from "./MangaCard.svelte";
  import { dragScroll } from "../../utils/dragScroll";

  let { onSelectManga } = $props<{
    onSelectManga: (manga: any, sourceId: string) => void;
  }>();

  let series = $state<any[]>([]);
  let viewMode = $state<"grid" | "list">("grid");
  let loading = $state(true);

  async function loadLibrary() {
    loading = true;
    try {
      series = await window.electronAPI.manga.getLibrarySeries();
    } catch (e) {
      console.error("Failed to load manga library:", e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadLibrary();
  });

  function handleMangaClick(item: any) {
    onSelectManga(item, item.source_id);
  }
</script>

<div class="flex-1 flex flex-col gap-6">
  <div class="flex items-center justify-between px-2">
    <div>
      <h2 class="text-sm font-bold text-slate-400 uppercase tracking-widest">
        Downloaded Series ({series.length})
      </h2>
    </div>

    <div class="flex bg-slate-900/50 p-1 rounded-xl border border-white/5">
      <button
        onclick={() => (viewMode = "grid")}
        class="p-2 rounded-lg transition-all {viewMode === 'grid'
          ? 'bg-slate-800 text-white shadow-lg'
          : 'text-slate-500 hover:text-slate-300'}"
        title="Grid View"
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
            d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
          />
        </svg>
      </button>
      <button
        onclick={() => (viewMode = "list")}
        class="p-2 rounded-lg transition-all {viewMode === 'list'
          ? 'bg-slate-800 text-white shadow-lg'
          : 'text-slate-500 hover:text-slate-300'}"
        title="List View"
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
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>
    </div>
  </div>

  {#if loading}
    <div class="flex-1 flex items-center justify-center py-20">
      <div
        class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"
      ></div>
    </div>
  {:else if series.length === 0}
    <div
      class="flex flex-col items-center justify-center py-32 bg-slate-900/20 rounded-3xl border border-dashed border-slate-800/50"
    >
      <div class="p-6 bg-slate-800/30 rounded-full mb-4 text-slate-600">
        <svg
          class="w-12 h-12"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
      </div>
      <p class="text-slate-400 font-medium tracking-wide">
        Your manga library is empty
      </p>
      <p class="text-slate-600 text-sm mt-2">
        Start browsing to download your favorite series
      </p>
    </div>
  {:else if viewMode === "grid"}
    <div
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6"
    >
      {#each series as item}
        <button
          class="text-left group transition-transform active:scale-95"
          onclick={() => handleMangaClick(item)}
        >
          <MangaCard
            title={item.title}
            coverUrl={item.cover_url}
            sourceName={item.source_id}
            onClick={() => handleMangaClick(item)}
          />
        </button>
      {/each}
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      {#each series as item}
        <button
          class="flex items-center gap-4 p-3 rounded-xl bg-slate-900/30 border border-white/5 hover:bg-slate-800/50 hover:border-blue-500/30 transition-all group"
          onclick={() => handleMangaClick(item)}
        >
          <img
            src={item.cover_url}
            alt={item.title}
            class="w-12 h-16 object-cover rounded-lg shadow-lg group-hover:scale-105 transition-transform"
          />
          <div class="flex-1 min-w-0">
            <h3
              class="font-bold text-slate-200 truncate group-hover:text-white transition-colors"
            >
              {item.title}
            </h3>
            <p class="text-xs text-slate-500 uppercase tracking-widest mt-0.5">
              {item.source_id} • {item.status || "Unknown"}
            </p>
          </div>
          <div
            class="text-slate-600 group-hover:text-blue-400 transition-colors"
          >
            <svg
              class="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>
