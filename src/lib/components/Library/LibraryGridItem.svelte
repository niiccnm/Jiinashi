<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import type { LibraryItem } from "../../stores/app";
  import {
    MANGA_RECOGNITION_OPTIONS,
    type MangaPreference,
  } from "../../utils/manga";
  import { handleSelectionMouseDown } from "../../state/selection.svelte";
  const MANGA_SUBMENU_WIDTH_PX = 196;

  interface SelectionModelLike {
    selectionMode: boolean;
    has: (id: number) => boolean;
    toggle: (
      id: number,
      items: LibraryItem[],
      event?: MouseEvent | KeyboardEvent,
    ) => void;
  }

  let {
    item,
    idx,
    isActiveView,
    skipItemAnimation,
    selection,
    filteredItems,
    activeMenuId,
    blurR18,
    blurR18Hover,
    blurR18Intensity,
    currentFolderId,
    searchQuery,
    getCoverSrc,
    getStatusColor,
    getStatusLabel,
    getReadingProgress,
    getBreadcrumbPath,
    getLanguageCodes,
    onItemClick,
    onToggleFavorite,
    onToggleMenu,
    onCloseMenu,
    onOpenTagEditor,
    onOpenTypeEditor,
    onSetMangaPreference,
    onManageArchive,
    onMoveItem,
    onOpenRename,
    onShowInFolder,
    onDeleteItem,
  } = $props<{
    item: LibraryItem;
    idx: number;
    isActiveView: boolean;
    skipItemAnimation: boolean;
    selection: SelectionModelLike;
    filteredItems: LibraryItem[];
    activeMenuId: number | null;
    blurR18: boolean;
    blurR18Hover: boolean;
    blurR18Intensity: number;
    currentFolderId: number | null;
    searchQuery: string;
    getCoverSrc: (item: LibraryItem) => string | null;
    getStatusColor: (status: LibraryItem["reading_status"]) => string;
    getStatusLabel: (status: string) => string;
    getReadingProgress: (item: LibraryItem) => number;
    getBreadcrumbPath: (item: LibraryItem) => string;
    getLanguageCodes: (tagsList: string | undefined) => string[];
    onItemClick: (item: LibraryItem, event?: MouseEvent | KeyboardEvent) => void;
    onToggleFavorite: (item: LibraryItem, event?: MouseEvent) => void;
    onToggleMenu: (id: number, event: MouseEvent) => void;
    onCloseMenu: () => void;
    onOpenTagEditor: (item: LibraryItem, event?: MouseEvent) => void;
    onOpenTypeEditor: (item: LibraryItem, event?: MouseEvent) => void;
    onSetMangaPreference: (
      item: LibraryItem,
      preference: MangaPreference,
    ) => Promise<void>;
    onManageArchive: (item: LibraryItem) => void;
    onMoveItem: (item: LibraryItem) => void;
    onOpenRename: (item: LibraryItem) => void;
    onShowInFolder: (item: LibraryItem) => void;
    onDeleteItem: (item: LibraryItem, event?: MouseEvent) => void;
  }>();

  let mangaSubmenuOpen = $state(false);
  let mangaSubmenuOpensLeft = $state(false);

  const mangaPreference = $derived(item.manga_preference ?? "auto");
  const mangaMenuActive = $derived(
    item.type === "folder" && activeMenuId === item.id,
  );

  $effect(() => {
    if (!mangaMenuActive) {
      mangaSubmenuOpen = false;
    }
  });

  function showMangaSubmenu(trigger: HTMLElement) {
    const triggerRect = trigger.getBoundingClientRect();
    mangaSubmenuOpensLeft =
      triggerRect.right + MANGA_SUBMENU_WIDTH_PX > window.innerWidth &&
      triggerRect.left >= MANGA_SUBMENU_WIDTH_PX;
    mangaSubmenuOpen = true;
  }

  function handleMangaSubmenuFocusOut(
    container: HTMLElement,
    nextTarget: EventTarget | null,
  ) {
    if (!(nextTarget instanceof Node) || !container.contains(nextTarget)) {
      mangaSubmenuOpen = false;
    }
  }
</script>

<div
  role="button"
  tabindex="0"
  data-nav-index={idx}
  data-type={item.type}
  data-item-id={item.id}
  class="flex flex-col group relative rounded-xl transition-[transform,shadow,border-color] duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-blue-500/10 text-left cursor-pointer bg-slate-900 border border-slate-700/50 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 select-none outline-none ring-0 {mangaMenuActive
    ? 'overflow-visible z-[60]'
    : 'overflow-hidden'} {item.type ===
  'folder'
    ? 'hover:border-amber-500/50 hover:shadow-amber-500/10'
    : 'hover:border-blue-500/50 hover:shadow-blue-500/10'}"
  in:fly|local={{
    y: skipItemAnimation ? 0 : 10,
    duration: skipItemAnimation ? 0 : 300,
    opacity: 1,
  }}
  style={isActiveView && !mangaMenuActive ? "content-visibility: auto;" : ""}
  onclick={(e: MouseEvent) => onItemClick(item, e)}
  onmousedown={(e: MouseEvent) =>
    handleSelectionMouseDown(e, selection.selectionMode)}
  ondblclick={(e: MouseEvent) => onItemClick(item, e)}
  onkeydown={(e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onItemClick(item, e);
    }
  }}
>
  {#if selection.selectionMode || selection.has(item.id)}
    <div
      class="absolute inset-0 z-40 rounded-xl transition-all duration-200 pointer-events-none {selection.has(
        item.id,
      )
        ? 'bg-blue-500/10 border-2 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.2)]'
        : 'bg-blue-500/0 border-2 border-transparent'}"
      onclick={(e: MouseEvent) => selection.toggle(item.id, filteredItems, e)}
      onkeydown={(e: KeyboardEvent) =>
        e.key === "Enter" && selection.toggle(item.id, filteredItems, e)}
      role="button"
      tabindex="0"
      aria-label="Toggle selection"
    >
      <div class="absolute top-2 left-2 p-1">
        <div
          class="w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 {selection.has(
            item.id,
          )
            ? 'bg-blue-500 border-blue-500'
            : 'bg-black/40 border-slate-400 group-hover:border-blue-400'}"
        >
          {#if selection.has(item.id)}
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

  {#if item.type === "book"}
    <button
      aria-label={item.is_favorite ? "Remove from favorites" : "Add to favorites"}
      class="absolute top-2 right-2 z-20 p-1.5 rounded-full transition-all duration-200 {item.is_favorite
        ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/50'
        : 'bg-black/40 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-rose-400 hover:bg-black/60'}"
      onclick={(e) => onToggleFavorite(item, e)}
    >
      <svg
        class="w-4 h-4"
        fill={item.is_favorite ? "currentColor" : "none"}
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
    </button>
  {/if}

  <div class="absolute top-2 left-2 {activeMenuId === item.id ? 'z-[70]' : 'z-20'}">
    <button
      aria-label="Options"
      class="p-1.5 rounded-full transition-all duration-200 {activeMenuId === item.id
        ? 'bg-black/60 text-white opacity-100'
        : 'bg-black/40 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-black/60'}"
      onclick={(e) => onToggleMenu(item.id, e)}
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
        />
      </svg>
    </button>

    {#if activeMenuId === item.id}
      <div
        class="absolute left-0 top-full mt-1 {item.type === 'folder'
          ? 'w-52 overflow-visible'
          : 'w-48 overflow-hidden'} bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50 text-left"
        role="menu"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        transition:fade={{ duration: 100 }}
      >
        <div class="p-1">
          <button
            class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
            onclick={(e) => {
              onCloseMenu();
              onOpenTagEditor(item, e);
            }}
          >
            <svg
              class="w-4 h-4 text-sky-400 opacity-80"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
              /></svg
            >
            Edit Tags
          </button>

          <button
            class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
            onclick={(e) => {
              onCloseMenu();
              onOpenTypeEditor(item, e);
            }}
          >
            <svg
              class="w-4 h-4 text-sky-400 opacity-80"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              /></svg
            >
            Set Type
          </button>

          {#if item.type === "folder"}
            <div
              role="presentation"
              class="relative"
              onmouseenter={(event) => showMangaSubmenu(event.currentTarget)}
              onmouseleave={() => (mangaSubmenuOpen = false)}
              onfocusin={(event) => showMangaSubmenu(event.currentTarget)}
              onfocusout={(event) =>
                handleMangaSubmenuFocusOut(
                  event.currentTarget,
                  event.relatedTarget,
                )}
            >
              <button
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={mangaSubmenuOpen}
                class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
              >
                <svg
                  class="w-4 h-4 text-sky-400 opacity-80"
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
                <span class="flex-1">Manga Recognition</span>
                <svg
                  class="w-4 h-4 text-slate-500"
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
              </button>

              {#if mangaSubmenuOpen}
                <div
                  class="absolute top-0 z-[80] {mangaSubmenuOpensLeft
                    ? 'right-full pr-1'
                    : 'left-full pl-1'}"
                  role="menu"
                  aria-label="Manga recognition"
                  transition:fade={{ duration: 100 }}
                >
                  <div
                    class="w-48 rounded-xl border border-slate-700 bg-slate-800 p-1 shadow-xl"
                  >
                    {#each MANGA_RECOGNITION_OPTIONS as option}
                      {@const isSelected = mangaPreference === option.value}
                      <button
                        role="menuitemradio"
                        aria-checked={isSelected}
                        class="w-full rounded-lg px-3 py-2 text-left text-sm transition-colors flex items-center justify-between gap-3 {isSelected
                          ? 'bg-slate-700/70 text-white'
                          : 'text-slate-300 hover:bg-slate-600 hover:text-white'}"
                        onclick={() => {
                          onCloseMenu();
                          if (!isSelected) {
                            void onSetMangaPreference(item, option.value);
                          }
                        }}
                      >
                        <span>{option.label}</span>
                        {#if isSelected}
                          <svg
                            class="h-4 w-4 flex-shrink-0 text-sky-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2.5"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        {/if}
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          {#if item.type === "book"}
            <button
              class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
              onclick={() => {
                onCloseMenu();
                onManageArchive(item);
              }}
            >
              <svg
                class="w-4 h-4 text-sky-400 opacity-80"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                ><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                /></svg
              >
              Manage Content
            </button>
          {/if}

          <button
            class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
            onclick={() => {
              onCloseMenu();
              onMoveItem(item);
            }}
          >
            <svg
              class="w-4 h-4 text-sky-400 opacity-80"
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
            Move Item
          </button>

          <button
            class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
            onclick={() => {
              onCloseMenu();
              onOpenRename(item);
            }}
          >
            <svg
              class="w-4 h-4 text-sky-400 opacity-80"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            Rename
          </button>

          <button
            class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
            onclick={() => {
              onCloseMenu();
              onShowInFolder(item);
            }}
          >
            <svg
              class="w-4 h-4 text-sky-400 opacity-80"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
              />
            </svg>
            Open Location
          </button>

          <button
            class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
            onclick={(e) => {
              onCloseMenu();
              onDeleteItem(item, e);
            }}
          >
            <svg
              class="w-4 h-4 text-rose-500 opacity-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              /></svg
            >
            Delete
          </button>
        </div>
      </div>
    {/if}
  </div>

  <div
    class="aspect-[2/3] bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center relative overflow-hidden rounded-t-xl"
  >
    <div class="absolute top-0 left-0 z-10 flex flex-col gap-1 items-start">
      {#if item.type === "folder"}
        <div
          class="absolute top-2 left-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200 bg-amber-600 rounded-full shadow-lg"
        >
          Folder
        </div>
      {:else if item.reading_status !== "unread"}
        <div
          class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white {getStatusColor(
            item.reading_status,
          )} rounded-br-lg shadow-lg"
        >
          {getStatusLabel(item.reading_status)}
        </div>
      {/if}
    </div>

    {#if item.types_list?.toLowerCase().includes("r18")}
      <div class="absolute bottom-0 right-0 z-20 flex flex-col gap-1 items-end">
        <div
          class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white bg-red-600 rounded-tl-lg shadow-lg"
        >
          R18
        </div>
      </div>
    {/if}

    {#if item.type !== "folder"}
      <div class="absolute bottom-2 left-2 z-10 flex flex-col gap-1 items-start">
        {#each getLanguageCodes(item.tags_list) as code}
          <div
            class="px-1.5 py-0.5 text-[9px] font-bold bg-black/60 text-white rounded backdrop-blur-md border border-white/10 shadow-sm"
          >
            {code}
          </div>
        {/each}
      </div>
    {/if}

    {#if item.cover_path}
      <img
        src={getCoverSrc(item) || ""}
        alt={item.title}
        draggable="false"
        loading={isActiveView ? "eager" : "lazy"}
        fetchpriority={isActiveView && idx < 16 ? "high" : "auto"}
        style="--r18-blur: {blurR18Intensity}px"
        class="w-full h-full object-cover transition-all duration-300 group-hover:scale-105 {item.types_list
          ?.toLowerCase()
          .includes('r18') && blurR18
          ? `blur-[var(--r18-blur)] ${blurR18Hover ? 'group-hover:blur-0' : ''}`
          : ''}"
      />
    {:else}
      <div class="flex flex-col items-center gap-2 text-slate-500">
        {#if item.type === "folder"}
          <svg
            class="w-16 h-16 text-amber-500/80 drop-shadow-lg"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M19.5 21a2.5 2.5 0 0 0 2.5-2.5v-10a2.5 2.5 0 0 0-2.5-2.5h-5.83l-1.38-2.76A2.5 2.5 0 0 0 10.05 1H4.5A2.5 2.5 0 0 0 2 3.5v15A2.5 2.5 0 0 0 4.5 21h15z"
              opacity="0.4"
            />
            <path
              d="M21 9H3v9.5A2.5 2.5 0 0 0 5.5 21h13a2.5 2.5 0 0 0 2.5-2.5V9z"
            />
          </svg>
        {:else}
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
        {/if}
      </div>
    {/if}

    {#if item.type === "book" && item.current_page > 0 && item.page_count > 0}
      <div class="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
        <div
          class="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300"
          style="width: {getReadingProgress(item)}%"
        ></div>
      </div>
    {/if}
  </div>

  <div class="p-3 bg-slate-800 rounded-b-xl flex-1 flex flex-col">
    <p
      class="text-sm font-medium text-white truncate {item.type === 'folder'
        ? 'group-hover:text-amber-400'
        : 'group-hover:text-blue-400'} transition-colors"
      title={item.title}
    >
      {item.title || "Untitled"}
    </p>

    {#if item.types_list}
      {@const displayTypes = item.types_list
        .split(",")
        .filter((t: string) => t.trim().toLowerCase() !== "r18")}
      {#if displayTypes.length > 0}
        <div class="flex flex-wrap gap-1 mt-2 mb-1">
          {#each displayTypes as type}
            <span
              class="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-300 bg-slate-700/50 rounded border border-slate-600/50"
            >
              {type}
            </span>
          {/each}
        </div>
      {/if}
    {/if}

    {#if currentFolderId === null && searchQuery}
      <div class="flex items-center gap-1.5 mt-1.5 text-xs text-slate-500 mb-1">
        <svg
          class="w-3.5 h-3.5 flex-shrink-0 opacity-70"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        <span class="truncate opacity-80">
          {getBreadcrumbPath(item)}
        </span>
      </div>
    {/if}

    <div class="flex items-center justify-between mt-auto pt-1.5">
      <p class="text-xs text-slate-500">
        {#if item.type === "folder"}
          Folder
        {:else}
          {item.page_count || 0} pages
        {/if}
      </p>
      {#if item.type === "book" && item.current_page > 0}
        <p class="text-xs text-blue-400 font-medium">p.{item.current_page + 1}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  [role="button"]:focus-visible {
    outline: 2px solid #3b82f6 !important;
    outline-offset: 2px !important;
    box-shadow: 0 0 15px rgba(59, 130, 246, 0.4) !important;
    z-index: 60;
  }

  [role="button"][data-type="folder"]:focus-visible {
    outline: 2px solid #f59e0b !important;
    box-shadow: 0 0 15px rgba(245, 158, 11, 0.4) !important;
    z-index: 60;
  }
</style>
