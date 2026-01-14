<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";

  interface Props {
    pages: number[]; // List of page INDICES to render
    currentPage: number;
    loadPageFn: (
      index: number
    ) => Promise<{ url: string; ratio?: number } | null>; // Function to load a specific page URL (+ optional aspect ratio)
    onPageChange: (index: number) => void;
    onToggleUI?: () => void;
    brightness?: number;
    contrast?: number;
    zoomLevel?: number;
    onContextMenu?: (index: number, e: MouseEvent) => void;
  }

  let {
    pages, // Total page count effectively, or list of all indices
    currentPage,
    loadPageFn,
    onPageChange,
    onToggleUI,
    brightness = 100,
    contrast = 100,
    zoomLevel = 100,
    onContextMenu,
  }: Props = $props();

  let container: HTMLElement;
  let pageUrls = $state<Map<number, string>>(new Map());
  let pageRatios = $state<Map<number, number>>(new Map());
  let pageObserver: IntersectionObserver;
  let loadedRanges = $state({ start: 0, end: 0 });

  let visibleRatios = new Map<number, number>();
  let updateVisibleRafId = 0;

  const LOAD_CONCURRENCY = 3;
  let activeLoads = 0;
  let queuedLoads = new Set<number>();
  let loadingLoads = new Set<number>();
  let loadQueue: number[] = [];

  const KEEP_BEHIND = 15;
  const KEEP_AHEAD = 40;

  let observedIndices = new Set<number>();

  const DEFAULT_ASPECT_RATIO = 2 / 3;

  async function computeRatio(url: string): Promise<number | null> {
    try {
      const img: HTMLImageElement = new Image();
      img.decoding = "async";
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image decode failed"));
      });
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w > 0 && h > 0) return w / h;
    } catch {}
    return null;
  }

  function scheduleVisibleUpdate() {
    if (updateVisibleRafId) return;
    updateVisibleRafId = requestAnimationFrame(() => {
      updateVisibleRafId = 0;
      let best = -1;
      let bestRatio = 0;
      for (const [idx, ratio] of visibleRatios) {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          best = idx;
        }
      }
      if (best !== -1 && best !== currentPage) {
        onPageChange(best);
      }
    });
  }

  function pumpLoads() {
    while (activeLoads < LOAD_CONCURRENCY && loadQueue.length) {
      const next = loadQueue.shift()!;
      queuedLoads.delete(next);
      if (pageUrls.has(next) || loadingLoads.has(next)) continue;
      void loadIndex(next);
    }
  }

  async function loadIndex(index: number) {
    if (pageUrls.has(index) || loadingLoads.has(index)) return;
    loadingLoads.add(index);
    activeLoads += 1;
    try {
      const result = await loadPageFn(index);
      if (result?.url) {
        let ratio = pageRatios.get(index) ?? result.ratio;
        if (!ratio) {
          const computed = await computeRatio(result.url);
          if (computed) ratio = computed;
        }
        if (ratio) {
          pageRatios.set(index, ratio);
          pageRatios = new Map(pageRatios);
        }

        pageUrls.set(index, result.url);
        pageUrls = new Map(pageUrls);
      }
    } finally {
      loadingLoads.delete(index);
      activeLoads -= 1;
      pumpLoads();
    }
  }

  function requestLoad(index: number, priority = false) {
    if (index < 0 || index >= pages.length) return;
    if (
      pageUrls.has(index) ||
      loadingLoads.has(index) ||
      queuedLoads.has(index)
    )
      return;
    queuedLoads.add(index);
    if (priority) loadQueue.unshift(index);
    else loadQueue.push(index);
    pumpLoads();
  }

  const LOAD_MARGIN = 2; // How many pages before/after viewport to load

  // Helper to load a range of pages
  async function loadRange(start: number, end: number) {
    for (let i = start; i <= end; i++) {
      requestLoad(i);
    }
  }

  function loadAround(center: number, behind: number, ahead: number) {
    const start = Math.max(0, center - behind);
    const end = Math.min(pages.length - 1, center + ahead);

    for (let i = center; i <= end; i++) {
      requestLoad(i, true);
    }
    for (let i = center - 1; i >= start; i--) {
      requestLoad(i, false);
    }
  }

  $effect(() => {
    // Determine range to render/load based on currentPage
    // In a virtual list we'd only render DOM for a few, but for simplifying Webtoon (usually not 10,000 pages),
    // we can render div placeholders for ALL, but only IMG tags for nearby.
    loadAround(currentPage, 6, 30);
  });

  $effect(() => {
    if (!pages.length) return;
    const minKeep = Math.max(0, currentPage - KEEP_BEHIND);
    const maxKeep = Math.min(pages.length - 1, currentPage + KEEP_AHEAD);
    const evict: number[] = [];
    for (const [idx] of pageUrls) {
      if (idx < minKeep || idx > maxKeep) evict.push(idx);
    }
    if (evict.length) {
      for (const idx of evict) {
        pageUrls.delete(idx);
        pageRatios.delete(idx);
      }
      pageUrls = new Map(pageUrls);
      pageRatios = new Map(pageRatios);
    }
  });

  // Scroll to current page on mount or external change (if significant)
  // We need to distinguish between "User Scrolled" and "Prop Changed"
  // For now, let's just use scroll for manual, and if `currentPage` changes drastically (jump), we scroll.

  export function scrollToPage(index: number) {
    if (!container) return;
    const el = container.querySelector(`[data-page-index="${index}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "auto", block: "start" });
    }
  }

  onMount(async () => {
    await tick();
    if (!container) return;

    pageObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const raw = el.getAttribute("data-page-index");
          const idx = raw ? parseInt(raw, 10) : -1;
          if (idx === -1) continue;
          if (entry.intersectionRatio > 0)
            visibleRatios.set(idx, entry.intersectionRatio);
          else visibleRatios.delete(idx);
          if (entry.isIntersecting) {
            loadAround(idx, 6, 18);
          }
        }
        scheduleVisibleUpdate();
      },
      {
        root: container,
        rootMargin: "1200px 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    const pageElements = container.querySelectorAll("[data-page-index]");
    pageElements.forEach((el) => {
      const raw = (el as HTMLElement).getAttribute("data-page-index");
      const idx = raw ? parseInt(raw, 10) : -1;
      if (idx === -1) return;
      if (observedIndices.has(idx)) return;
      observedIndices.add(idx);
      pageObserver.observe(el);
    });

    loadAround(currentPage, 6, 30);
    await tick();
    scrollToPage(currentPage);
  });

  $effect(() => {
    if (!container || !pageObserver) return;
    const pageElements = container.querySelectorAll("[data-page-index]");
    pageElements.forEach((el) => {
      const raw = (el as HTMLElement).getAttribute("data-page-index");
      const idx = raw ? parseInt(raw, 10) : -1;
      if (idx === -1) return;
      if (observedIndices.has(idx)) return;
      observedIndices.add(idx);
      pageObserver.observe(el);
    });
  });

  onDestroy(() => {
    if (updateVisibleRafId) cancelAnimationFrame(updateVisibleRafId);
    if (pageObserver) pageObserver.disconnect();
    pageUrls.clear();
    queuedLoads.clear();
    loadingLoads.clear();
    visibleRatios.clear();
    observedIndices.clear();
    pageRatios.clear();
  });
</script>

<div
  bind:this={container}
  class="flex-1 overflow-y-auto w-full h-full bg-black scroll-smooth"
  style="filter: brightness({brightness}%) contrast({contrast}%);"
  onclick={() => onToggleUI?.()}
  role="button"
  tabindex="0"
  onkeydown={(e) => {
    if (e.key === "Enter") onToggleUI?.();
  }}
>
  <div
    class="flex flex-col items-center min-h-full"
    style="width: {zoomLevel}%; margin: 0 auto;"
  >
    {#each pages as pageIndex}
      {@const url = pageUrls.get(pageIndex)}
      {@const ratio = pageRatios.get(pageIndex) ?? DEFAULT_ASPECT_RATIO}
      <div
        class="w-full flex items-center justify-center bg-black"
        data-page-index={pageIndex}
        style="content-visibility: auto; contain-intrinsic-size: 800px 1200px;"
        oncontextmenu={(e) => onContextMenu?.(pageIndex, e)}
        role="presentation"
      >
        {#if url}
          <div class="w-full" style="aspect-ratio: {ratio};">
            <img
              src={url}
              alt="Page {pageIndex}"
              class="w-full h-full block object-contain"
              decoding="async"
              fetchpriority={Math.abs(pageIndex - currentPage) <= 1
                ? "high"
                : "low"}
            />
          </div>
        {:else}
          <div class="w-full" style="aspect-ratio: {ratio};"></div>
        {/if}
      </div>
    {/each}
  </div>
</div>
