<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fade, scale } from "svelte/transition";
  import type { LibraryItem } from "../../../electron/preload";

  interface Props {
    item: LibraryItem;
    onClose: () => void;
  }

  let { item, onClose }: Props = $props();

  let pages: string[] = $state([]);
  let hiddenPages: Set<string> = $state(new Set());
  let loading = $state(true);
  let pageThumbnails: Record<string, string> = $state({});
  let selectedPages: Set<string> = $state(new Set());
  let lastSelectedPage: string | null = null;
  let scrollContainer: HTMLElement | undefined = $state();

  // Drag Scroll State
  let isDragging = $state(false);
  let startX = 0;
  let startY = 0;
  let scrollLeft = 0;
  let scrollTop = 0;
  let isDown = $state(false);
  let suppressClick = $state(false);
  let showHiddenOnly = $state(false);

  // Click Debouncing
  let clickTimeout: NodeJS.Timeout | null = null;

  onMount(async () => {
    await loadContent();
  });

  onDestroy(() => {
    Object.values(pageThumbnails).forEach((url) => URL.revokeObjectURL(url));
  });

  async function loadContent() {
    loading = true;
    try {
      const [allPages, currentHidden] = await Promise.all([
        window.electronAPI.reader.getArchiveContent(item.path),
        window.electronAPI.reader.getPageVisibility(item.id),
      ]);
      pages = allPages;
      hiddenPages = new Set(currentHidden);
    } catch (e) {
      console.error("Failed to load archive content:", e);
    } finally {
      loading = false;
    }
  }

  async function loadThumbnail(pageName: string) {
    if (pageThumbnails[pageName]) return;
    const index = pages.indexOf(pageName);
    if (index === -1) return;

    try {
      const pageData = await window.electronAPI.reader.getPage(
        item.path,
        index,
        true
      );
      if (pageData && pageData.data) {
        const blob = new Blob([pageData.data as any], { type: "image/jpeg" });
        pageThumbnails[pageName] = URL.createObjectURL(blob);
      }
    } catch (e) {
      console.error(`Failed to load thumbnail for ${pageName}:`, e);
    }
  }

  function lazyLoad(node: HTMLElement, page: string) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadThumbnail(page);
          observer.unobserve(node);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
      },
    };
  }

  async function toggleVisibility(pageName: string, forceState?: boolean) {
    let newHidden: boolean;

    if (forceState !== undefined) {
      newHidden = forceState;
      if (hiddenPages.has(pageName) === newHidden) return; // No change needed
    } else {
      newHidden = !hiddenPages.has(pageName);
    }

    await window.electronAPI.reader.setPageVisibility(
      item.id,
      pageName,
      newHidden
    );
    if (newHidden) {
      hiddenPages.add(pageName);
    } else {
      hiddenPages.delete(pageName);
    }
    hiddenPages = new Set(hiddenPages);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (selectedPages.size > 0) {
        selectedPages = new Set();
      } else {
        onClose();
      }
    }
  }

  function handlePageClick(e: MouseEvent, page: string) {
    if (isDragging || suppressClick) return;

    // Multi-select logic
    if (e.ctrlKey || e.metaKey) {
      if (selectedPages.has(page)) {
        selectedPages.delete(page);
      } else {
        selectedPages.add(page);
        lastSelectedPage = page;
      }
      selectedPages = new Set(selectedPages);
      return;
    }

    if (e.shiftKey && lastSelectedPage) {
      const start = pages.indexOf(lastSelectedPage);
      const end = pages.indexOf(page);
      const [lower, upper] = start < end ? [start, end] : [end, start];

      for (let i = lower; i <= upper; i++) {
        selectedPages.add(pages[i]);
      }
      selectedPages = new Set(selectedPages);
      return;
    }

    // Normal toggle visibility if no modifier keys
    if (selectedPages.size > 0 && !e.shiftKey && !e.ctrlKey) {
      // Clear selection if clicking without modifiers
      selectedPages = new Set();
    }

    // Clear any existing timeout
    if (clickTimeout) clearTimeout(clickTimeout);

    // Debounce the toggle
    clickTimeout = setTimeout(() => {
      toggleVisibility(page);
      lastSelectedPage = page;
      clickTimeout = null;
    }, 250);
  }

  async function handleBulkHide(hidden: boolean) {
    for (const page of selectedPages) {
      await toggleVisibility(page, hidden);
    }
    selectedPages = new Set();
  }

  function handleDoubleClick(page: string) {
    // Clear the click timeout to prevent toggling visibility
    if (clickTimeout) {
      clearTimeout(clickTimeout);
      clickTimeout = null;
    }

    const index = pages.indexOf(page);
    if (index !== -1) {
      // Find the *actual* index including hidden pages is what we have here.
      // But the reader expects index relative to *visible* pages usually?
      // Actually, wait. createReaderWindow just opens the reader.
      // If we pass a page index, the reader needs to know if it's an index into ALL pages or VALID pages.
      // The reader logic usually filters hidden pages.
      // If I say "Page 5" (0-indexed) but Page 2 is hidden, Reader will see [0, 1, 3, 4, 5...].
      // So index 5 in the full list maps to index 4 in the filtered list.
      // We need to calculate the *visible index*.

      let visibleIndex = 0;
      for (let i = 0; i < index; i++) {
        if (!hiddenPages.has(pages[i])) {
          visibleIndex++;
        }
      }

      // If the target page itself is hidden, we probably should unhide it first or just open near it?
      // For now, let's just open it. If it's hidden, Reader might just skip it or show blank?
      // Actually Reader filters hidden pages, so it might jump to the next one.
      // Let's just calculate visible index.

      window.electronAPI.reader.openWindow(item.id, visibleIndex);
    }
  }

  // Drag Scroll Handlers
  function onMouseDown(e: MouseEvent) {
    if (!scrollContainer) return;
    isDown = true;
    isDragging = false;
    suppressClick = false;
    startX = e.pageX - scrollContainer.offsetLeft;
    startY = e.pageY - scrollContainer.offsetTop;
    scrollLeft = scrollContainer.scrollLeft;
    scrollTop = scrollContainer.scrollTop;
  }

  function onMouseLeave() {
    isDown = false;
    if (isDragging) {
      isDragging = false;
    }
  }

  function onMouseUp() {
    isDown = false;
    if (isDragging) {
      isDragging = false;
      suppressClick = true;
    }
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDown || !scrollContainer) return;
    e.preventDefault();
    const x = e.pageX - scrollContainer.offsetLeft;
    const y = e.pageY - scrollContainer.offsetTop;

    const deltaX = x - startX;
    const deltaY = y - startY;

    if (!isDragging) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) {
        return;
      }
      isDragging = true;
    }

    const walkX = (x - startX) * 1.5; // Scroll speed multiplier
    const walkY = (y - startY) * 1.5;
    scrollContainer.scrollLeft = scrollLeft - walkX;
    scrollContainer.scrollTop = scrollTop - walkY;
  }
</script>

<div
  class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
  transition:fade={{ duration: 200 }}
  onkeydown={handleKeydown}
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <!-- Modal Container (to hold shadow separate from overflow-hidden content) -->
  <div
    class="relative w-full max-w-5xl max-h-[90vh] flex flex-col"
    transition:scale={{ start: 0.95, duration: 200 }}
  >
    <!-- Stable Shadow Layer -->
    <div
      class="absolute inset-0 bg-black/50 rounded-2xl shadow-2xl blur-xl -z-10 transform-gpu"
    ></div>

    <!-- Actual Modal Content -->
    <div
      class="w-full flex-1 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col overflow-hidden outline-none transform-gpu"
      role="document"
    >
      <!-- Header -->
      <div
        class="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50 backdrop-blur-xl"
      >
        <div class="space-y-1">
          <h3 class="text-xl font-bold text-white flex items-center gap-3">
            <span class="p-2 bg-blue-500/10 text-blue-400 rounded-lg">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path
                  d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
                ></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"
                ></polyline><line x1="12" y1="22.08" x2="12" y2="12"
                ></line></svg
              >
            </span>
            Manage Archive Content
          </h3>
          <p class="text-slate-400 text-sm truncate max-w-2xl px-1">
            {item.title}
          </p>
        </div>

        <div class="flex items-center gap-2">
          {#if selectedPages.size > 0}
            <div class="flex items-center gap-2 mr-4" transition:fade>
              <span
                class="text-xs text-slate-400 font-medium uppercase tracking-wider"
                >{selectedPages.size} Selected</span
              >
              <button
                class="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium transition-colors"
                onclick={() => handleBulkHide(false)}
              >
                Show
              </button>
              <button
                class="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-lg text-xs font-medium transition-colors"
                onclick={() => handleBulkHide(true)}
              >
                Hide
              </button>
            </div>
          {/if}
          <button
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors
          {showHiddenOnly
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-400 hover:text-white'}"
            onclick={() => (showHiddenOnly = !showHiddenOnly)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              {#if showHiddenOnly}
                <path
                  d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                ></path><line x1="1" y1="1" x2="23" y2="23"></line>
              {:else}
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              {/if}
            </svg>
            {showHiddenOnly ? "Showing Hidden" : "Filter Hidden"}
          </button>
          <button
            class="p-2 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 rounded-lg transition-colors"
            onclick={onClose}
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="w-6 h-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><line x1="18" y1="6" x2="6" y2="18"></line><line
                x1="6"
                y1="6"
                x2="18"
                y2="18"
              ></line></svg
            >
          </button>
        </div>
      </div>

      <!-- Content -->
      <div
        bind:this={scrollContainer}
        class="flex-1 overflow-y-auto p-6 bg-gray-950/20 custom-scrollbar {isDragging
          ? 'cursor-grabbing'
          : 'cursor-default'} {isDown ? 'select-none' : ''}"
        onmousedown={onMouseDown}
        onmouseleave={onMouseLeave}
        onmouseup={onMouseUp}
        onmousemove={onMouseMove}
        role="presentation"
      >
        {#if loading}
          <div
            class="h-full flex flex-col items-center justify-center space-y-4 text-slate-500"
          >
            <div
              class="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"
            ></div>
            <p class="text-sm font-medium animate-pulse">
              Analyzing archive structure...
            </p>
          </div>
        {:else if pages.length === 0}
          <div
            class="h-full flex flex-col items-center justify-center space-y-4 text-slate-500"
          >
            <div class="p-4 bg-white/5 rounded-full">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-12 h-12 opacity-20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><rect x="3" y="3" width="18" height="18" rx="2" ry="2"
                ></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg
              >
            </div>
            <p class="text-sm font-medium">No images found in this archive</p>
          </div>
        {:else}
          <div
            class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
          >
            {#each pages as page, i}
              {#if !showHiddenOnly || (showHiddenOnly && hiddenPages.has(page))}
                <button
                  class="group relative aspect-[3/4] bg-gray-800 rounded-xl overflow-hidden border transition-all duration-300 shadow-lg
              {selectedPages.has(page)
                    ? 'border-blue-500 ring-2 ring-blue-500/30 ring-offset-2 ring-offset-[#0f172a]'
                    : 'border-white/5 hover:border-blue-500/50 hover:shadow-blue-500/10'}
              {hiddenPages.has(page)
                    ? 'opacity-40 grayscale blur-[2px] scale-95'
                    : selectedPages.has(page)
                      ? ''
                      : 'hover:-translate-y-1'}"
                  use:lazyLoad={page}
                  onclick={(e) => handlePageClick(e, page)}
                  ondblclick={() => handleDoubleClick(page)}
                >
                  {#if pageThumbnails[page]}
                    <img
                      src={pageThumbnails[page]}
                      alt={page}
                      class="w-full h-full object-cover"
                      loading="lazy"
                    />
                  {:else}
                    <div
                      class="w-full h-full flex flex-col items-center justify-center p-4 text-center space-y-2"
                    >
                      <span
                        class="text-[10px] font-bold text-slate-600 uppercase tracking-wider"
                        >Page {i + 1}</span
                      >
                      <div
                        class="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="w-4 h-4 text-slate-700"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          ><rect
                            x="3"
                            y="3"
                            width="18"
                            height="18"
                            rx="2"
                            ry="2"
                          ></rect><circle cx="8.5" cy="8.5" r="1.5"
                          ></circle><polyline points="21 15 16 10 5 21"
                          ></polyline></svg
                        >
                      </div>
                    </div>
                  {/if}

                  <div
                    class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3"
                  >
                    <span class="text-[10px] font-medium text-white/90 truncate"
                      >{page}</span
                    >
                  </div>

                  <div
                    class="absolute top-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur-md rounded-md text-[10px] font-bold text-white border border-white/10"
                  >
                    {i + 1}
                  </div>

                  <div
                    class="absolute top-2 right-2 p-1.5 rounded-lg transition-all duration-300 {hiddenPages.has(
                      page
                    )
                      ? 'bg-rose-500 text-white'
                      : 'bg-black/60 text-white/70 group-hover:bg-blue-500 group-hover:text-white'}"
                  >
                    {#if hiddenPages.has(page)}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="w-3.5 h-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        ><path
                          d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                        ></path><line x1="1" y1="1" x2="23" y2="23"></line></svg
                      >
                    {:else}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="w-3.5 h-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        ><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                        ></path><circle cx="12" cy="12" r="3"></circle></svg
                      >
                    {/if}
                  </div>

                  {#if hiddenPages.has(page)}
                    <div
                      class="absolute inset-0 flex items-center justify-center bg-rose-500/10"
                    >
                      <span
                        class="px-2 py-1 bg-rose-500 text-[10px] font-black uppercase tracking-tighter rounded text-white shadow-xl"
                        >Hidden</span
                      >
                    </div>
                  {/if}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>

      <!-- Footer Info -->
      <div
        class="px-6 py-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500"
      >
        <div class="flex items-center gap-4">
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-blue-500"></span>
            {pages.length} Total Pages
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-rose-500"></span>
            {hiddenPages.size} Hidden
          </span>
        </div>
        <p>Click an image to toggle visibility in the reader</p>
      </div>
    </div>
  </div>
</div>

<style>
  .custom-scrollbar::-webkit-scrollbar {
    width: 8px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 10px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.1);
  }
</style>
