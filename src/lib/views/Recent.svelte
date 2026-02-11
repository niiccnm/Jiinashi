<script lang="ts">
  import { onMount } from "svelte";
  import { openBook } from "../stores/app";
  import { dragScroll } from "../utils/dragScroll";
  import Dialog from "../components/Dialog.svelte";

  interface LibraryItem {
    id: number;
    path: string;
    title: string;
    type: "book" | "folder";
    page_count: number;
    cover_path: string | null;
    parent_id: number | null;
    is_favorite: boolean;
    reading_status: "unread" | "reading" | "read";
    current_page: number;
    last_read_at: string | null;
    added_at: string;
    types_list?: string;
  }

  let items = $state<LibraryItem[]>([]);
  let loading = $state(true);
  let coverCache = $state<Record<number, string>>({});
  let loadingCovers = $state<Set<number>>(new Set());
  let refreshTimer: any = null;
  let blurR18 = $state(false);
  let blurR18Hover = $state(false);
  let blurR18Intensity = $state(12);

  async function refreshSettings() {
    try {
      const all = await window.electronAPI.settings.getAll();
      if (all) {
        blurR18 = all.blurR18 === "true";
        blurR18Hover = all.blurR18Hover === "true";
        blurR18Intensity = all.blurR18Intensity
          ? parseInt(all.blurR18Intensity)
          : 12;
      }
    } catch (e) {
      console.error("Failed to refresh settings", e);
    }
  }

  // Dialog state
  let removeDialogOpen = $state(false);
  let itemToRemove = $state<LibraryItem | null>(null);

  async function openRemoveDialog(item: LibraryItem, event: Event) {
    event.stopPropagation();
    itemToRemove = item;
    removeDialogOpen = true;
  }

  function closeRemoveDialog() {
    removeDialogOpen = false;
    itemToRemove = null;
  }

  async function confirmRemove() {
    if (!itemToRemove) return;

    try {
      await window.electronAPI.library.removeFromRecent(itemToRemove.id);
      items = items.filter((i) => i.id !== itemToRemove!.id);
      closeRemoveDialog();
    } catch (e) {
      console.error("Failed to remove from recent:", e);
    }
  }

  async function loadRecent(silent: boolean = false) {
    if (!silent) loading = true;
    try {
      items = await window.electronAPI.library.getRecent(50);
      loadCoversForItems(items);
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) loading = false;
    }
  }

  async function loadCoversForItems(itemList: LibraryItem[]) {
    for (const item of itemList) {
      if (
        item.cover_path &&
        !coverCache[item.id] &&
        !loadingCovers.has(item.id)
      ) {
        loadingCovers.add(item.id);
        loadingCovers = new Set(loadingCovers);

        try {
          const dataUrl = await window.electronAPI.library.getCover(
            item.cover_path,
          );
          if (dataUrl) {
            coverCache[item.id] = dataUrl;
            coverCache = { ...coverCache };
          }
        } catch (e) {
          console.error("Failed to load cover:", e);
        } finally {
          loadingCovers.delete(item.id);
          loadingCovers = new Set(loadingCovers);
        }
      }
    }
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  function getProgressPercent(item: LibraryItem): number {
    if (item.page_count === 0) return 0;
    return Math.round((item.current_page / item.page_count) * 100);
  }

  onMount(() => {
    loadRecent();
    refreshSettings();
    const unsubscribe = window.electronAPI.library.onItemUpdated(
      async (payload) => {
        const existingIndex = items.findIndex((i) => i.id === payload.id);
        if (existingIndex !== -1) {
          const updated = {
            ...items[existingIndex],
            current_page: payload.current_page,
            last_read_at:
              payload.last_read_at ?? items[existingIndex].last_read_at,
          };
          if (payload.last_read_at) {
            items = [
              updated,
              ...items.slice(0, existingIndex),
              ...items.slice(existingIndex + 1),
            ];
          } else {
            items = [
              ...items.slice(0, existingIndex),
              updated,
              ...items.slice(existingIndex + 1),
            ];
          }
          loadCoversForItems([updated]);
        } else {
          try {
            const fetched = await window.electronAPI.library.getItem(
              payload.id,
            );
            if (fetched && fetched.last_read_at) {
              items = [fetched, ...items];
              loadCoversForItems([fetched]);
            }
          } catch (e) {
            console.error(e);
          }
        }

        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          loadRecent(true);
        }, 300);
      },
    );
    const unsubscribeRefreshed = window.electronAPI.library.onRefreshed(() => {
      loadRecent(true);
    });
    const unsubscribeCleared = window.electronAPI.library.onCleared(() => {
      loadRecent(true);
    });
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
      unsubscribeRefreshed();
      unsubscribeCleared();
    };
  });
</script>

<header
  class="h-16 bg-slate-900/80 border-b border-slate-700/50 flex items-center px-6"
>
  <svg
    class="w-6 h-6 text-blue-400 mr-3"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
  <h1 class="text-2xl font-bold text-white">Recent</h1>
  <span
    class="ml-3 px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-sm"
    >{items.length}</span
  >
</header>

<div class="flex-1 overflow-auto p-6" use:dragScroll={{ axis: "y" }}>
  {#if loading}
    <div class="flex items-center justify-center h-full">
      <div
        class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
      ></div>
    </div>
  {:else if items.length === 0}
    <div class="flex flex-col items-center justify-center h-full text-center">
      <div
        class="w-32 h-32 mb-6 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center"
      >
        <svg
          class="w-16 h-16 text-slate-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h2 class="text-2xl font-bold text-white mb-2">No Recent Items</h2>
      <p class="text-slate-400 max-w-md">
        Start reading something to see it here.
      </p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each items as item (item.id)}
        <div
          role="button"
          tabindex="0"
          class="w-full flex items-center gap-4 p-4 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-blue-500/50 rounded-xl transition-all duration-200 text-left group relative cursor-pointer"
          ondblclick={() => openBook(item)}
          onkeydown={(e) => e.key === "Enter" && openBook(item)}
        >
          <!-- Thumbnail -->
          <div
            class="relative w-16 h-24 bg-slate-700 rounded-lg flex-shrink-0 flex items-center justify-center overflow-hidden group/thumb"
          >
            {#if coverCache[item.id]}
              <img
                src={coverCache[item.id]}
                alt=""
                draggable="false"
                style="--r18-blur: {blurR18Intensity}px"
                class="w-full h-full object-cover transition-all duration-300 group-hover/thumb:scale-105 {item.types_list
                  ?.toLowerCase()
                  .includes('r18') && blurR18
                  ? `blur-[var(--r18-blur)] ${blurR18Hover ? 'group-hover/thumb:blur-0' : ''}`
                  : ''}"
              />
            {:else if loadingCovers.has(item.id)}
              <div
                class="w-6 h-6 border-2 border-slate-500 border-t-blue-500 rounded-full animate-spin"
              ></div>
            {:else}
              <svg
                class="w-8 h-8 text-slate-500"
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
            {/if}

            {#if item.types_list?.toLowerCase().includes("r18")}
              <div class="absolute bottom-0 right-0 z-10">
                <div
                  class="px-1 py-0.5 text-[8px] font-bold uppercase text-white bg-red-600 rounded-tl shadow-sm"
                >
                  R18
                </div>
              </div>
            {/if}

            <button
              class="absolute top-0 right-0 w-5 h-5 flex items-center justify-center bg-black/40 hover:bg-rose-500 text-white/90 hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-md shadow-sm hover:scale-110"
              onclick={(e) => openRemoveDialog(item, e)}
              title="Remove from Recent"
            >
              <svg
                class="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <!-- Info -->
          <div class="flex-1 min-w-0">
            <p
              class="text-white font-medium truncate group-hover:text-blue-400 transition-colors"
            >
              {item.title}
            </p>
            {#if item.types_list}
              {@const displayTypes = item.types_list
                .split(",")
                .filter((t) => t.trim().toLowerCase() !== "r18")}
              {#if displayTypes.length > 0}
                <div class="flex flex-wrap gap-1 mt-1 mb-1">
                  {#each displayTypes as type}
                    <span
                      class="px-1.5 py-0.5 text-[10px] font-medium text-slate-300 bg-slate-700/50 rounded border border-slate-600/50"
                    >
                      {type}
                    </span>
                  {/each}
                </div>
              {/if}
            {/if}
            <p class="text-sm text-slate-400 mt-1">
              Page {item.current_page + 1} of {item.page_count}
            </p>
            <!-- Progress bar -->
            <div class="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                class="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all"
                style="width: {getProgressPercent(item)}%"
              ></div>
            </div>
          </div>

          <!-- Time and Status -->
          <div class="text-right flex-shrink-0">
            <p class="text-sm text-slate-400">
              {formatDate(item.last_read_at)}
            </p>
            <span
              class="inline-block mt-2 px-2.5 py-1 text-xs font-medium rounded-full {item.reading_status ===
              'read'
                ? 'bg-emerald-500/20 text-emerald-400'
                : item.reading_status === 'reading'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-slate-700 text-slate-400'}"
            >
              {item.reading_status === "read"
                ? "Completed"
                : item.reading_status === "reading"
                  ? "Reading"
                  : "Unread"}
            </span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<Dialog
  open={removeDialogOpen}
  title="Remove from Recent"
  description="Are you sure you want to remove '{itemToRemove?.title}' from your recent list? This will not delete the file."
  confirmText="Remove"
  variant="danger"
  onConfirm={confirmRemove}
  onCancel={closeRemoveDialog}
/>
