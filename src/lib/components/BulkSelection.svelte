<script lang="ts">
  import TagSelector from "./TagSelector.svelte";
  import TypeSelector from "./TypeSelector.svelte";
  import Dialog from "./Dialog.svelte";
  import { fade } from "svelte/transition";
  import type { SelectionModel } from "../state/selection.svelte";
  import { toasts } from "../stores/toast";
  import {
    MANGA_RECOGNITION_OPTIONS,
    type MangaPreference,
  } from "../utils/manga";

  type MangaFolder = { manga_preference?: MangaPreference };

  let {
    selection,
    allIds = [],
    mangaFolders = [],
    menuCloseEpoch = 0,
    view = "library",
    onRefresh,
    onMove,
    onSetMangaPreference,
  } = $props<{
    selection: SelectionModel;
    allIds: number[];
    mangaFolders?: MangaFolder[];
    menuCloseEpoch?: number;
    view: "library" | "favorites";
    onRefresh: (
      action: "favorite" | "delete" | "tags" | "move",
    ) => void | Promise<void>;
    onMove: () => void;
    onSetMangaPreference?: (
      preference: MangaPreference,
    ) => void | Promise<void>;
  }>();

  let showBulkTagEditor = $state(false);
  let showBulkTypeEditor = $state(false);
  let showDeleteDialog = $state(false);
  let isDeleting = $state(false);
  let showMangaRecognitionMenu = $state(false);
  let isApplyingMangaPreference = $state(false);

  const selectedMangaPreference = $derived.by<MangaPreference | null>(() => {
    if (mangaFolders.length === 0) return null;
    const firstPreference = mangaFolders[0].manga_preference ?? "auto";
    return mangaFolders.every(
      (folder: MangaFolder) =>
        (folder.manga_preference ?? "auto") === firstPreference,
    )
      ? firstPreference
      : null;
  });
  const selectedMangaPreferenceLabel = $derived.by(() => {
    if (selectedMangaPreference === null) return "Mixed";
    return MANGA_RECOGNITION_OPTIONS.find(
      (option) => option.value === selectedMangaPreference,
    )!.statusLabel;
  });

  $effect(() => {
    if (selection.size === 0 || mangaFolders.length === 0) {
      showMangaRecognitionMenu = false;
    }
  });

  $effect(() => {
    void menuCloseEpoch;
    showMangaRecognitionMenu = false;
  });

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (showMangaRecognitionMenu) {
        showMangaRecognitionMenu = false;
        return;
      }
      if (showBulkTagEditor) {
        showBulkTagEditor = false;
        return;
      }
      if (showBulkTypeEditor) {
        showBulkTypeEditor = false;
        return;
      }
      if (showDeleteDialog) {
        showDeleteDialog = false;
        return;
      }
      if (selection.size > 0) {
        selection.clear();
        return;
      }
    }

    if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      selection.selectAll(allIds.map((id: number) => ({ id })));
    }
  }

  async function bulkToggleFavorite() {
    if (selection.size === 0) return;
    const ids = selection.ids;
    await window.electronAPI.library.bulkToggleFavorite(ids);
    onRefresh("favorite");
  }

  function bulkDelete() {
    if (selection.size === 0) return;
    showDeleteDialog = true;
  }

  async function handleConfirmDelete() {
    if (selection.size === 0) return;

    isDeleting = true;
    try {
      const ids = selection.ids;
      await window.electronAPI.library.bulkDeleteItems(ids);
      await onRefresh("delete");
      showDeleteDialog = false;
      selection.clear();
    } catch (e) {
      console.error("Bulk delete failed:", e);
      showDeleteDialog = false;
      selection.clear();
      toasts.add(
        "Some items could not be moved to the Recycle Bin. Items still on disk were kept in the library.",
        "error",
        7000,
      );
    } finally {
      isDeleting = false;
    }
  }

  function handleTagChange() {
    onRefresh("tags");
  }

  async function applyMangaPreference(preference: MangaPreference) {
    if (!onSetMangaPreference || isApplyingMangaPreference) return;
    showMangaRecognitionMenu = false;
    if (selectedMangaPreference === preference) return;

    isApplyingMangaPreference = true;
    try {
      await onSetMangaPreference(preference);
    } catch (error) {
      console.error("Bulk manga recognition update failed:", error);
      toasts.add("Failed to update manga recognition", "error");
    } finally {
      isApplyingMangaPreference = false;
    }
  }
</script>

<svelte:window
  onkeydown={handleGlobalKeydown}
  onclick={() => (showMangaRecognitionMenu = false)}
/>

{#if selection.size > 0}
  <!-- Bulk Action Bar -->
  <div
    class="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-slate-900/95 backdrop-blur-2xl border border-slate-700/50 px-5 py-3.5 rounded-3xl shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)] flex items-center gap-4 sm:gap-6 animate-in fade-in slide-in-from-bottom-4 zoom-in-95 duration-300 max-w-[95vw] sm:max-w-none"
  >
    <div class="flex items-center gap-3 sm:gap-4 flex-shrink-0">
      <button
        onclick={() => selection.clear()}
        class="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-all border border-slate-700/50 hover:border-slate-600 group active:scale-95"
        title="Cancel selection"
        aria-label="Cancel selection"
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
            stroke-width="2.5"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>

      <div class="flex flex-col min-w-0">
        <span
          class="text-white font-bold tracking-tight whitespace-nowrap text-sm sm:text-base"
        >
          {selection.size}
          <span class="hidden xs:inline"
            >{selection.size === 1 ? "item" : "items"} selected</span
          >
        </span>
      </div>

      <div class="flex items-center gap-1.5 ml-1">
        <button
          onclick={() =>
            selection.selectAll(allIds.map((id: number) => ({ id })))}
          class="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-[10px] uppercase tracking-wider font-bold transition-all border border-slate-700/50"
        >
          All
        </button>
        <button
          onclick={() => selection.clear()}
          class="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-[10px] uppercase tracking-wider font-bold transition-all border border-slate-700/50"
        >
          None
        </button>
      </div>
    </div>

    <div class="h-8 w-px bg-slate-800/80 flex-shrink-0"></div>

    <div class="flex items-center gap-2 sm:gap-3 flex-shrink-0">
      <button
        onclick={onMove}
        class="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-blue-500/20 text-slate-300 hover:text-blue-400 transition-all border border-slate-700/50 hover:border-blue-500/30 group active:scale-95"
      >
        <svg
          class="w-4 h-4 transition-transform group-hover:scale-110"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
          />
        </svg>
        <span class="font-bold text-xs sm:text-sm hidden sm:inline">Move</span>
      </button>

      <button
        onclick={bulkToggleFavorite}
        class="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-rose-500/20 text-slate-300 hover:text-rose-400 transition-all border border-slate-700/50 hover:border-rose-500/30 group active:scale-95"
      >
        <svg
          class="w-4 h-4 transition-transform group-hover:scale-110"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </svg>
        <span class="font-bold text-xs sm:text-sm hidden sm:inline">
          {view === "favorites" ? "Unfavorite" : "Favorite"}
        </span>
      </button>

      <button
        onclick={() => (showBulkTagEditor = true)}
        class="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-blue-500/20 text-slate-300 hover:text-blue-400 transition-all border border-slate-700/50 hover:border-blue-500/30 group active:scale-95"
      >
        <svg
          class="w-4 h-4 transition-transform group-hover:scale-110"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
          />
        </svg>
        <span class="font-bold text-xs sm:text-sm hidden sm:inline">Tags</span>
      </button>

      <button
        onclick={() => (showBulkTypeEditor = true)}
        class="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-blue-500/20 text-slate-300 hover:text-blue-400 transition-all border border-slate-700/50 hover:border-blue-500/30 group active:scale-95"
      >
        <svg
          class="w-4 h-4 transition-transform group-hover:scale-110"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
        <span class="font-bold text-xs sm:text-sm hidden sm:inline">Types</span>
      </button>

      {#if view === "library" && mangaFolders.length > 0 && onSetMangaPreference}
        <div class="relative">
          <button
            aria-haspopup="dialog"
            aria-expanded={showMangaRecognitionMenu}
            aria-busy={isApplyingMangaPreference}
            disabled={isApplyingMangaPreference}
            title={`Manga recognition: ${selectedMangaPreferenceLabel}`}
            class="flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all border group active:scale-95 disabled:cursor-wait disabled:opacity-60 {showMangaRecognitionMenu
              ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
              : 'bg-slate-800/80 hover:bg-blue-500/20 text-slate-300 hover:text-blue-400 border-slate-700/50 hover:border-blue-500/30'}"
            onclick={(event) => {
              event.stopPropagation();
              showMangaRecognitionMenu = !showMangaRecognitionMenu;
            }}
          >
            <svg
              class="w-4 h-4 transition-transform group-hover:scale-110"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            <span class="font-bold text-xs sm:text-sm hidden sm:inline">
              Recognition
            </span>
            <svg
              class="w-3.5 h-3.5 text-slate-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d={showMangaRecognitionMenu ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"}
              />
            </svg>
          </button>

          {#if showMangaRecognitionMenu}
            <div
              class="absolute bottom-full right-0 z-[110] pb-3"
              role="dialog"
              aria-label="Manga recognition"
              tabindex="-1"
              onclick={(event) => event.stopPropagation()}
              onkeydown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  showMangaRecognitionMenu = false;
                }
              }}
              transition:fade={{ duration: 100 }}
            >
              <div
                class="relative w-72 overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl"
              >
                <div
                  class="flex items-start justify-between gap-4 border-b border-slate-800 px-4 py-3.5"
                >
                  <div class="min-w-0">
                    <p class="text-sm font-semibold text-white">
                      Manga recognition
                    </p>
                    <p class="mt-0.5 text-[11px] text-slate-400">
                      Apply to {mangaFolders.length} selected {mangaFolders.length ===
                      1
                        ? "folder"
                        : "folders"}
                    </p>
                  </div>
                  <span
                    class="flex-shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold {selectedMangaPreference ===
                    null
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-sky-500/15 text-sky-300'}"
                  >
                    {selectedMangaPreferenceLabel}
                  </span>
                </div>

                <div
                  class="space-y-1 p-2"
                  role="radiogroup"
                  aria-label="Manga recognition mode"
                >
                  {#each MANGA_RECOGNITION_OPTIONS as option}
                    {@const isSelected =
                      selectedMangaPreference === option.value}
                    <button
                      role="radio"
                      aria-checked={isSelected}
                      disabled={isApplyingMangaPreference}
                      class="group/option flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all disabled:cursor-wait disabled:opacity-60 {isSelected
                        ? 'border-sky-500/30 bg-sky-500/10'
                        : 'border-transparent hover:border-slate-700 hover:bg-slate-800/80'}"
                      onclick={() => void applyMangaPreference(option.value)}
                    >
                      <span
                        class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border transition-colors {isSelected
                          ? 'border-sky-400 bg-sky-500'
                          : 'border-slate-600 bg-slate-800 group-hover/option:border-slate-500'}"
                      >
                        {#if isSelected}
                          <span class="h-1.5 w-1.5 rounded-full bg-white"></span>
                        {/if}
                      </span>
                      <span class="min-w-0">
                        <span
                          class="block text-sm font-medium {isSelected
                            ? 'text-white'
                            : 'text-slate-200'}"
                        >
                          {option.label}
                        </span>
                        <span class="mt-0.5 block text-[11px] text-slate-400">
                          {option.description}
                        </span>
                      </span>
                    </button>
                  {/each}
                </div>
              </div>
              <div
                class="absolute bottom-1.5 right-6 h-3 w-3 rotate-45 border-b border-r border-slate-700/80 bg-slate-900"
              ></div>
            </div>
          {/if}
        </div>
      {/if}

      <button
        onclick={bulkDelete}
        class="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500 text-white transition-all shadow-lg shadow-rose-500/20 hover:bg-rose-600 hover:shadow-rose-600/30 group active:scale-95"
      >
        <svg
          class="w-4 h-4 transition-transform group-hover:scale-110"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
        <span class="font-bold text-xs sm:text-sm">Delete</span>
      </button>
    </div>
  </div>
{/if}

{#if showBulkTagEditor}
  <div
    class="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300"
    onclick={() => (showBulkTagEditor = false)}
    onkeydown={(e) => e.key === "Escape" && (showBulkTagEditor = false)}
    role="button"
    tabindex="-1"
    aria-label="Close modal"
  >
    <div
      class="bg-slate-900 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl border border-slate-800 flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-300 relative cursor-default"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key !== "Escape") {
          e.stopPropagation();
        }
      }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- Close Button -->
      <button
        onclick={() => (showBulkTagEditor = false)}
        class="absolute top-4 right-4 text-slate-500 hover:text-white z-50 transition-colors"
        aria-label="Close"
      >
        <svg
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          /></svg
        >
      </button>

      <div class="p-6 pb-2 shrink-0">
        <h3 class="text-xl font-bold text-white mb-1">Bulk Tagging</h3>
        <p class="text-sm text-slate-400 truncate">
          {selection.size} items selected
        </p>
      </div>

      <div class="flex-1 overflow-hidden flex flex-col">
        <div class="px-6 py-3 bg-blue-500/10 border-y border-blue-500/20">
          <p
            class="text-blue-300 text-[11px] font-bold uppercase tracking-wider"
          >
            Bulk Mode
          </p>
          <p class="text-blue-400/80 text-xs mt-0.5">
            Tags added or removed here apply to ALL selected items.
          </p>
        </div>
        <div class="flex-1 min-h-0 relative flex flex-col">
          <TagSelector itemIds={selection.ids} onchange={handleTagChange} />
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showBulkTypeEditor}
  <div
    class="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300"
    onclick={() => (showBulkTypeEditor = false)}
    onkeydown={(e) => e.key === "Escape" && (showBulkTypeEditor = false)}
    role="button"
    tabindex="-1"
    aria-label="Close modal"
  >
    <div
      class="bg-slate-900 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl border border-slate-800 flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-300 relative cursor-default"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key !== "Escape") {
          e.stopPropagation();
        }
      }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- Close Button -->
      <button
        onclick={() => (showBulkTypeEditor = false)}
        class="absolute top-4 right-4 text-slate-500 hover:text-white z-50 transition-colors"
        aria-label="Close"
      >
        <svg
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          /></svg
        >
      </button>

      <div class="p-6 pb-2 shrink-0">
        <h3 class="text-xl font-bold text-white mb-1">Bulk Types</h3>
        <p class="text-sm text-slate-400 truncate">
          {selection.size} items selected
        </p>
      </div>

      <div class="flex-1 overflow-hidden flex flex-col">
        <div class="px-6 py-3 bg-blue-500/10 border-y border-blue-500/20">
          <p
            class="text-blue-300 text-[11px] font-bold uppercase tracking-wider"
          >
            Bulk Mode
          </p>
          <p class="text-blue-400/80 text-xs mt-0.5">
            Types added or removed here apply to ALL selected items.
          </p>
        </div>
        <div class="flex-1 min-h-0 relative flex flex-col">
          <TypeSelector itemIds={selection.ids} onchange={handleTagChange} />
        </div>
      </div>
    </div>
  </div>
{/if}

<Dialog
  open={showDeleteDialog}
  title="Delete Items"
  description={`Are you sure you want to move ${selection.size} ${selection.size === 1 ? "item" : "items"} to the Trash? This action cannot be easily undone.`}
  confirmText="Move to Trash"
  variant="danger"
  loading={isDeleting}
  onConfirm={handleConfirmDelete}
  onCancel={() => (showDeleteDialog = false)}
/>
