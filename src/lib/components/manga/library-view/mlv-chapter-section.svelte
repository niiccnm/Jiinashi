<script lang="ts">
  import { fade } from "svelte/transition";
  import type { LibraryItem } from "../../../stores/app";
  import { handleSelectionMouseDown } from "../../../state/selection.svelte";
  import type { MlvChapterActions, MlvSelectionContext } from "./mlv-types";

  const LEGACY_CHAPTER_WITH_PROVIDER_PATTERN =
    /^([\s._-]*[\[【［][^\]】］]+[\]】］])\s*Ch\.\s*(.+)$/i;

  type ChapterActionHandler = (item: LibraryItem) => void | Promise<void>;

  type ChapterMenuAction = {
    key: string;
    label: string;
    iconClass: string;
    iconPath: string;
    handler: ChapterActionHandler;
  };

  let {
    chapterCards = [],
    viewMode = "grid",
    chapterGridClass = "",
    seriesTitle = "",
    chapterActions = null,
    selectionContext = null,
    menuCloseEpoch = 0,
    isActive = true,
    getChapterCoverCacheKey,
    getChapterCoverSrc,
    openChapter,
    cacheImageFromEvent,
    handleCoverError,
  }: {
    chapterCards?: LibraryItem[];
    viewMode?: "grid" | "list";
    chapterGridClass?: string;
    seriesTitle?: string;
    chapterActions?: MlvChapterActions | null;
    selectionContext?: MlvSelectionContext | null;
    menuCloseEpoch?: number;
    isActive?: boolean;
    getChapterCoverCacheKey: (item: LibraryItem) => string;
    getChapterCoverSrc: (item: LibraryItem) => string;
    openChapter: (item: LibraryItem) => void;
    cacheImageFromEvent: (cacheKey: string, event: Event) => void;
    handleCoverError: (event: Event) => void;
  } = $props();

  let activeMenuItemId = $state<number | null>(null);
  let lastMenuCloseEpoch: number | undefined;
  const selection = $derived(selectionContext?.selection ?? null);

  const menuActions = $derived.by((): ChapterMenuAction[] => {
    const actions = chapterActions;
    if (!actions) return [];

    const candidates = [
      {
        key: "edit-tags",
        label: "Edit Tags",
        iconClass: "text-sky-400 opacity-80",
        iconPath:
          "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
        handler: actions.editTags,
      },
      {
        key: "set-type",
        label: "Set Type",
        iconClass: "text-sky-400 opacity-80",
        iconPath:
          "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
        handler: actions.setType,
      },
      {
        key: "manage-content",
        label: "Manage Content",
        iconClass: "text-sky-400 opacity-80",
        iconPath:
          "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
        handler: actions.manageContent,
      },
      {
        key: "move-item",
        label: "Move Item",
        iconClass: "text-sky-400 opacity-80",
        iconPath:
          "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
        handler: actions.moveItem,
      },
      {
        key: "rename",
        label: "Rename",
        iconClass: "text-sky-400 opacity-80",
        iconPath:
          "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
        handler: actions.rename,
      },
      {
        key: "open-location",
        label: "Open Location",
        iconClass: "text-sky-400 opacity-80",
        iconPath:
          "M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z",
        handler: actions.openLocation,
      },
      {
        key: "delete",
        label: "Delete",
        iconClass: "text-rose-500 opacity-90",
        iconPath:
          "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
        handler: actions.deleteItem,
      },
    ];

    return candidates.filter(
      (entry): entry is ChapterMenuAction =>
        typeof entry.handler === "function",
    );
  });

  const hasMenuActions = $derived(menuActions.length > 0);

  $effect(() => {
    chapterCards;
    viewMode;
    activeMenuItemId = null;
  });

  $effect(() => {
    const nextEpoch = Number(menuCloseEpoch || 0);
    if (
      lastMenuCloseEpoch !== undefined &&
      nextEpoch !== lastMenuCloseEpoch &&
      activeMenuItemId !== null
    ) {
      closeMenu();
    }
    lastMenuCloseEpoch = nextEpoch;
  });

  function getChapterDisplayTitle(item: LibraryItem) {
    const rawTitle = String(item?.title || "").trim();
    if (!rawTitle) return "Untitled Chapter";

    const resolvedSeriesTitle = String(seriesTitle || "").trim();
    if (!resolvedSeriesTitle) return rawTitle;

    const chapterOnlyWithProvider = rawTitle.match(
      LEGACY_CHAPTER_WITH_PROVIDER_PATTERN,
    );
    if (!chapterOnlyWithProvider?.[1] || !chapterOnlyWithProvider?.[2]) {
      return rawTitle;
    }

    const providerLabel = chapterOnlyWithProvider[1]
      .replace(/\s+/g, " ")
      .trim();
    const chapterSuffix = String(chapterOnlyWithProvider[2]).trim();
    if (!providerLabel || !chapterSuffix) return rawTitle;

    return `${providerLabel} ${resolvedSeriesTitle} - Ch. ${chapterSuffix}`;
  }

  function toggleMenu(itemId: number, event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    activeMenuItemId = activeMenuItemId === itemId ? null : itemId;
  }

  function closeMenu() {
    activeMenuItemId = null;
  }

  async function runMenuAction(
    item: LibraryItem,
    handler: ChapterActionHandler,
    event: MouseEvent,
  ) {
    event.stopPropagation();
    event.preventDefault();
    closeMenu();
    await handler(item);
  }

  function handleWindowClick(event: MouseEvent) {
    if (!isActive) return;
    if (activeMenuItemId === null) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-mlv-menu-root="true"]')) return;
    closeMenu();
  }

  function handleWindowPointerDownCapture(event: PointerEvent) {
    if (!isActive) return;
    if (activeMenuItemId === null) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-mlv-menu-root="true"]')) return;
    closeMenu();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!isActive) return;
    if (event.key === "Escape" && activeMenuItemId !== null) {
      closeMenu();
    }
  }

  function canToggleSelection(event?: MouseEvent | KeyboardEvent) {
    if (!selection || !event) return false;
    return (
      selection.selectionMode ||
      Boolean(event.ctrlKey) ||
      Boolean(event.metaKey)
    );
  }

  function handleCardInteraction(
    item: LibraryItem,
    event?: MouseEvent | KeyboardEvent,
  ) {
    if (selection && canToggleSelection(event)) {
      selection.toggle(item.id, chapterCards, event);
      return;
    }

    if (
      !event ||
      event.type === "dblclick" ||
      (event instanceof KeyboardEvent &&
        (event.key === "Enter" || event.key === " "))
    ) {
      openChapter(item);
    }
  }
</script>

<svelte:window
  onpointerdowncapture={handleWindowPointerDownCapture}
  onclick={handleWindowClick}
  onkeydown={handleWindowKeydown}
/>

{#if chapterCards.length === 0}
  <div
    class="flex flex-col items-center justify-center py-20 bg-slate-900/20 rounded-3xl border border-dashed border-slate-800"
  >
    <p class="text-slate-400 font-semibold">
      No chapter files found in this folder
    </p>
    <p class="text-slate-600 text-sm mt-1">
      Add chapter files for this series to open them from series view
    </p>
  </div>
{:else if viewMode === "grid"}
  <div class="grid {chapterGridClass} gap-4 library-grid">
    {#each chapterCards as item (item.id)}
      {@const chapterCoverCacheKey = getChapterCoverCacheKey(item)}
      {@const chapterCoverSrc = getChapterCoverSrc(item)}
      {@const chapterDisplayTitle = getChapterDisplayTitle(item)}
      {@const itemId = Number(item?.id || 0)}
      {@const isSelected = Boolean(selection?.has(itemId))}
      {@const showSelectionOverlay = Boolean(
        selection && (selection.selectionMode || isSelected)
      )}
      <div
        role="button"
        tabindex="0"
        onclick={(e: MouseEvent) => handleCardInteraction(item, e)}
        onmousedown={(e: MouseEvent) =>
          handleSelectionMouseDown(e, Boolean(selection?.selectionMode))}
        ondblclick={(e: MouseEvent) => handleCardInteraction(item, e)}
        onkeydown={(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCardInteraction(item, e);
          }
        }}
        class="flex flex-col group relative rounded-xl transition-[transform,shadow,border-color] duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-blue-500/10 text-left cursor-pointer bg-slate-900 border border-slate-700/50 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 select-none outline-none ring-0 overflow-hidden hover:border-blue-500/50 {isSelected
          ? 'border-blue-500/80 shadow-[0_0_20px_rgba(59,130,246,0.2)]'
          : ''}"
      >
        {#if showSelectionOverlay}
          <div
            class="absolute inset-0 z-40 rounded-xl transition-all duration-200 pointer-events-none {isSelected
              ? 'bg-blue-500/10 border-2 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.2)]'
              : 'bg-blue-500/0 border-2 border-transparent'}"
          >
            <div class="absolute top-2 left-2 p-1">
              <div
                class="w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 {isSelected
                  ? 'bg-blue-500 border-blue-500'
                  : 'bg-black/40 border-slate-400 group-hover:border-blue-400'}"
              >
                {#if isSelected}
                  <svg
                    class="w-4 h-4 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="3"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                {/if}
              </div>
            </div>
          </div>
        {/if}

        {#if hasMenuActions}
          <div
            class="absolute top-2 left-2 {activeMenuItemId === itemId ? 'z-[70]' : 'z-20'}"
            data-mlv-menu-root="true"
          >
            <button
              aria-label="Options"
              class="p-1.5 rounded-full transition-all duration-200 {activeMenuItemId ===
              itemId
                ? 'bg-black/60 text-white opacity-100'
                : 'bg-black/40 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-black/60'}"
              onclick={(e) => toggleMenu(itemId, e)}
              onkeydown={(e) => e.stopPropagation()}
              ondblclick={(e) => e.stopPropagation()}
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
                  d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                />
              </svg>
            </button>

            {#if activeMenuItemId === itemId}
              <div
                class="absolute left-0 top-full mt-1 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden text-left"
                role="menu"
                tabindex="-1"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => e.stopPropagation()}
                transition:fade={{ duration: 100 }}
              >
                <div class="p-1">
                  {#each menuActions as action (action.key)}
                    <button
                      class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
                      onclick={(e) => void runMenuAction(item, action.handler, e)}
                    >
                      <svg
                        class="w-4 h-4 {action.iconClass}"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d={action.iconPath}
                        />
                      </svg>
                      {action.label}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <div
          class="aspect-[2/3] bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center relative overflow-hidden rounded-t-xl"
        >
          {#if chapterCoverSrc}
            <img
              src={chapterCoverSrc}
              alt={chapterDisplayTitle}
              data-cache-key={chapterCoverCacheKey}
              class="w-full h-full object-cover transition-all duration-300 group-hover:scale-105"
              onload={(e) => cacheImageFromEvent(chapterCoverCacheKey, e)}
              onerror={handleCoverError}
            />
          {:else}
            <div class="flex flex-col items-center gap-2 text-slate-500">
              <svg
                class="w-14 h-14 text-slate-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1"
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            </div>
          {/if}

          {#if item.current_page > 0 && item.page_count > 0}
            <div class="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
              <div
                class="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300"
                style="width: {(Math.max(
                  0,
                  Math.min(item.current_page, item.page_count),
                ) /
                  item.page_count) *
                  100}%"
              ></div>
            </div>
          {/if}
        </div>

        <div class="p-3 bg-slate-800 rounded-b-xl flex-1 flex flex-col">
          <p
            class="text-sm font-medium text-white truncate group-hover:text-blue-400 transition-colors"
            title={chapterDisplayTitle}
          >
            {chapterDisplayTitle}
          </p>
          <div class="flex items-center justify-between mt-auto pt-1.5">
            <p class="text-xs text-slate-500">{item.page_count || 0} pages</p>
            {#if item.current_page > 0}
              <p class="text-xs text-blue-400 font-medium">
                p.{item.current_page + 1}
              </p>
            {/if}
          </div>
        </div>
      </div>
    {/each}
  </div>
{:else}
  <div class="flex flex-col gap-2">
    {#each chapterCards as item (item.id)}
      {@const chapterCoverCacheKey = getChapterCoverCacheKey(item)}
      {@const chapterCoverSrc = getChapterCoverSrc(item)}
      {@const chapterDisplayTitle = getChapterDisplayTitle(item)}
      {@const itemId = Number(item?.id || 0)}
      {@const isSelected = Boolean(selection?.has(itemId))}
      {@const showSelectionOverlay = Boolean(
        selection && (selection.selectionMode || isSelected)
      )}
      <div
        role="button"
        tabindex="0"
        onclick={(e: MouseEvent) => handleCardInteraction(item, e)}
        onmousedown={(e: MouseEvent) =>
          handleSelectionMouseDown(e, Boolean(selection?.selectionMode))}
        ondblclick={(e: MouseEvent) => handleCardInteraction(item, e)}
        onkeydown={(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCardInteraction(item, e);
          }
        }}
        class="group relative flex items-center gap-4 p-3 bg-slate-900/90 rounded-xl hover:bg-slate-800/90 transition-colors text-left overflow-visible shadow-md shadow-black/35 focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 border border-transparent {isSelected
          ? 'border-blue-500/80 shadow-[0_0_20px_rgba(59,130,246,0.2)]'
          : ''}"
      >
        {#if showSelectionOverlay}
          <div
            class="absolute inset-0 z-40 rounded-xl transition-all duration-200 pointer-events-none {isSelected
              ? 'bg-blue-500/10 border border-blue-500'
              : 'bg-blue-500/0 border border-transparent'}"
          >
            <div class="absolute top-2 left-2 p-1">
              <div
                class="w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 {isSelected
                  ? 'bg-blue-500 border-blue-500'
                  : 'bg-black/40 border-slate-400 group-hover:border-blue-400'}"
              >
                {#if isSelected}
                  <svg
                    class="w-4 h-4 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="3"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                {/if}
              </div>
            </div>
          </div>
        {/if}

        {#if hasMenuActions}
          <div
            class="absolute top-2 left-2 {activeMenuItemId === itemId ? 'z-[70]' : 'z-20'}"
            data-mlv-menu-root="true"
          >
            <button
              aria-label="Options"
              class="p-1.5 rounded-full transition-all duration-200 {activeMenuItemId ===
              itemId
                ? 'bg-black/60 text-white opacity-100'
                : 'bg-black/40 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-black/60'}"
              onclick={(e) => toggleMenu(itemId, e)}
              onkeydown={(e) => e.stopPropagation()}
              ondblclick={(e) => e.stopPropagation()}
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
                  d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                />
              </svg>
            </button>

            {#if activeMenuItemId === itemId}
              <div
                class="absolute left-0 top-full mt-1 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden text-left"
                role="menu"
                tabindex="-1"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => e.stopPropagation()}
                transition:fade={{ duration: 100 }}
              >
                <div class="p-1">
                  {#each menuActions as action (action.key)}
                    <button
                      class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
                      onclick={(e) => void runMenuAction(item, action.handler, e)}
                    >
                      <svg
                        class="w-4 h-4 {action.iconClass}"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d={action.iconPath}
                        />
                      </svg>
                      {action.label}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <div
          class="w-12 h-16 rounded-lg overflow-hidden bg-slate-800 shrink-0 border border-slate-800 shadow-inner"
        >
          {#if chapterCoverSrc}
            <img
              src={chapterCoverSrc}
              alt={chapterDisplayTitle}
              data-cache-key={chapterCoverCacheKey}
              class="w-full h-full object-cover transition-all duration-500 group-hover:scale-110"
              onload={(e) => cacheImageFromEvent(chapterCoverCacheKey, e)}
              onerror={handleCoverError}
            />
          {/if}
        </div>
        <div class="flex-1 min-w-0">
          <h3
            class="text-sm font-bold text-white truncate group-hover:text-blue-400 transition-colors tracking-tight"
          >
            {chapterDisplayTitle}
          </h3>
          <p
            class="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-0.5"
          >
            {item.page_count || 0} pages
          </p>
        </div>

        {#if item.current_page > 0}
          <div
            class="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-md text-[9px] font-black text-blue-400 uppercase tracking-tighter shadow-sm"
          >
            p.{item.current_page + 1}
          </div>
        {/if}

        {#if item.current_page > 0 && item.page_count > 0}
          <div class="absolute bottom-0 left-0 right-0 h-[3px] bg-slate-950/40">
            <div
              class="h-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all duration-500"
              style="width: {(Math.max(
                0,
                Math.min(item.current_page, item.page_count),
              ) /
                item.page_count) *
                100}%"
            ></div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
