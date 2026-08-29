<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";

  type WebtoonFitMode = "width" | "contain";

  interface Props {
    pages: number[]; // List of page INDICES to render
    currentPage: number;
    initialPageOffset?: number;
    fitMode?: WebtoonFitMode;
    fullscreen?: boolean;
    loadPageFn: (
      index: number
    ) => Promise<{ url: string; ratio?: number } | null>; // Function to load a specific page URL (+ optional aspect ratio)
    loadPageInfoFn?: (
      index: number
    ) => Promise<{ ratio?: number } | null>;
    onPositionChange: (position: WebtoonPosition) => void;
    onToggleUI?: () => void;
    onInitialPositioned?: () => void | Promise<void>;
    brightness?: number;
    contrast?: number;
    zoomLevel?: number;
    onContextMenu?: (index: number, e: MouseEvent) => void;
    onMoveWindow?: (x: number, y: number) => void;
    onDragStart?: () => void;
    onColumnAspectRatioResolved?: (ratio: number) => void | Promise<void>;
  }

  type WebtoonPosition = {
    pageIndex: number;
    pageOffset: number;
  };

  type ZoomAnchor = {
    target: HTMLElement;
    clientX: number;
    clientY: number;
    relativeX: number;
    relativeY: number;
  };

  let {
    pages, // Total page count effectively, or list of all indices
    currentPage,
    initialPageOffset = 0,
    fitMode = "contain",
    fullscreen = false,
    loadPageFn,
    loadPageInfoFn,
    onPositionChange,
    onToggleUI,
    onInitialPositioned,
    brightness = 100,
    contrast = 100,
    zoomLevel = 100,
    onContextMenu,
    onMoveWindow,
    onDragStart,
    onColumnAspectRatioResolved,
  }: Props = $props();

  const DEFAULT_ASPECT_RATIO = 2 / 3;

  let container: HTMLElement;
  let pageUrls = $state<Map<number, string>>(new Map());
  let pageRatios = $state<Map<number, number>>(new Map());
  let columnAspectRatio = $state(DEFAULT_ASPECT_RATIO);
  let pageObserver: IntersectionObserver;
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);

  let positionUpdateRafId = 0;
  let resizeRestoreRafId = 0;
  let applyingPosition = false;
  let positionTrackingEnabled = false;
  let resizeObserver: ResizeObserver | null = null;

  type ActiveDragMode = "scroll" | "window";

  type DragGesture = {
    id: number;
    mode: "pending" | ActiveDragMode;
    startedAt: number;
    trace: Array<[number, number, number]>;
    x: number;
    y: number;
    screenX: number;
    screenY: number;
    scrollLeft: number;
    scrollTop: number;
    windowX: number;
    windowY: number;
    pageCanPanX: boolean;
  };
  let dragGesture = $state<DragGesture | null>(null);
  let suppressNextClick = false;

  const DRAG_THRESHOLD_PX = 5;
  const RECENT_INTENT_MS = 36;
  const RECENT_INTENT_PX = 40;
  const WINDOW_AXIS_RATIO = 1.35;
  const SCROLL_AXIS_RATIO = 0.9;
  const SLOW_INTENT_MS = 250;
  const SLOW_INTENT_PX = 100;
  const SLOW_WINDOW_AXIS_RATIO = 1.5;
  const MAX_INTENT_SAMPLES = 24;

  const LOAD_CONCURRENCY = 3;
  let activeLoads = 0;
  let queuedLoads = new Set<number>();
  let loadingLoads = new Set<number>();
  let loadQueue: number[] = [];

  const KEEP_BEHIND = 15;
  const KEEP_AHEAD = 40;

  let observedIndices = new Set<number>();
  let prefetchEnabled = $state(false);
  const pendingInitialPages = untrack(
    () =>
      new Set(
        [currentPage, currentPage + 1].filter((index) => index < pages.length),
      ),
  );
  let resolveInitialImage: (() => void) | undefined;
  const initialImageReady = new Promise<void>(
    (resolve) => (resolveInitialImage = resolve),
  );

  function settleInitialImage(index: number) {
    if (!pendingInitialPages.delete(index) || pendingInitialPages.size) return;
    resolveInitialImage?.();
    resolveInitialImage = undefined;
  }

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

  async function waitForContainerLayout(maxFrames = 60) {
    for (let i = 0; i < maxFrames; i++) {
      if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        return;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  function getPageSize(index: number): { width: number; height: number } | null {
    const ratio = pageRatios.get(index) ?? DEFAULT_ASPECT_RATIO;
    if (
      viewportWidth <= 0 ||
      viewportHeight <= 0 ||
      !ratio ||
      ratio <= 0
    ) {
      return null;
    }

    const scale = Math.max(0.01, zoomLevel / 100);
    switch (fitMode) {
      case "width":
        return {
          width: viewportWidth * scale,
          height: (viewportWidth / ratio) * scale,
        };
    }

    const width =
      Math.min(viewportWidth, viewportHeight * columnAspectRatio) * scale;
    return {
      width,
      height: width / ratio,
    };
  }

  function getPageHeight(index: number): number | null {
    return getPageSize(index)?.height ?? null;
  }

  function getCanvasWidth() {
    let widestPage = 0;
    for (const pageIndex of pages) {
      widestPage = Math.max(
        widestPage,
        getPageSize(pageIndex)?.width ?? 0,
      );
    }
    if (zoomLevel <= 100) {
      return Math.max(viewportWidth, widestPage);
    }
    return widestPage + viewportWidth * 2;
  }

  function getHorizontalCenter() {
    if (!container) return 0;
    return Math.max(0, (container.scrollWidth - container.clientWidth) / 2);
  }

  export async function centerZoomHorizontally() {
    await tick();
    if (container) container.scrollLeft = getHorizontalCenter();
  }

  export async function prepareVisibleFrame() {
    await tick();
    const images = container?.querySelectorAll<HTMLImageElement>(
      `[data-page-index="${currentPage}"] img, [data-page-index="${currentPage + 1}"] img`,
    );
    await Promise.all(Array.from(images ?? [], (image) => image.decode()));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(resolve, 0)),
      ),
    );
  }

  async function ensureRatiosThrough(index: number) {
    if (!loadPageInfoFn) return;
    const end = Math.min(Math.max(index, 0), pages.length - 1);
    for (let i = 0; i <= end; i++) {
      if (pageRatios.has(i)) continue;
      const info = await loadPageInfoFn(i);
      const ratio = info?.ratio;
      if (ratio && ratio > 0) {
        pageRatios.set(i, ratio);
        pageRatios = new Map(pageRatios);
      }
    }
  }

  async function resolveColumnAspectRatio(): Promise<number> {
    if (!loadPageInfoFn || pages.length === 0) return columnAspectRatio;
    const sampleCount = Math.min(5, pages.length);
    const sampleIndices = Array.from({ length: sampleCount }, (_, position) =>
      Math.round((position * (pages.length - 1)) / Math.max(1, sampleCount - 1)),
    );
    const results = await Promise.all(
      sampleIndices.map(async (position) => {
        const pageIndex = pages[position];
        const info = await loadPageInfoFn(pageIndex);
        if (info?.ratio && info.ratio > 0) {
          pageRatios.set(pageIndex, info.ratio);
          return info.ratio;
        }
        return null;
      }),
    );
    pageRatios = new Map(pageRatios);

    const ratios = results
      .filter((ratio): ratio is number => ratio !== null)
      .sort((a, b) => a - b);
    if (ratios.length) {
      columnAspectRatio = ratios[Math.floor(ratios.length / 2)];
    }
    return columnAspectRatio;
  }

  function getScrollTopForPage(index: number): number | null {
    if (!pages.length) return null;
    const safeIndex = Math.min(Math.max(index, 0), pages.length - 1);
    let top = 0;
    for (let i = 0; i < safeIndex; i++) {
      const height = getPageHeight(pages[i]);
      if (height === null) return null;
      top += height;
    }
    return top;
  }

  function clampPageOffset(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }

  function readCurrentPosition(): WebtoonPosition | null {
    if (!container || pages.length === 0) return null;
    const scrollTop = container.scrollTop;
    let pageTop = 0;

    for (const [position, pageIndex] of pages.entries()) {
      const pageHeight = getPageHeight(pageIndex);
      if (pageHeight === null) return null;
      if (scrollTop < pageTop + pageHeight || position === pages.length - 1) {
        return {
          pageIndex,
          pageOffset: clampPageOffset((scrollTop - pageTop) / pageHeight),
        };
      }
      pageTop += pageHeight;
    }
    return null;
  }

  export function capturePosition(): WebtoonPosition {
    return (
      readCurrentPosition() ?? {
        pageIndex: currentPage,
        pageOffset: clampPageOffset(initialPageOffset),
      }
    );
  }

  function getScrollTopForPosition(index: number, pageOffset: number) {
    const pageTop = getScrollTopForPage(index);
    const pageHeight = getPageHeight(index);
    if (pageTop === null || pageHeight === null) return null;
    return pageTop + pageHeight * clampPageOffset(pageOffset);
  }

  async function applyStablePosition(
    index: number,
    pageOffset: number,
    maxFrames = 60,
  ) {
    let stableFrames = 0;
    let previousTarget = -1;
    applyingPosition = true;

    try {
      for (let i = 0; i < maxFrames; i++) {
        if (!container) return false;
        await tick();
        const rawTarget = getScrollTopForPosition(index, pageOffset);
        if (rawTarget === null) return false;
        const maxScrollTop = Math.max(
          0,
          container.scrollHeight - container.clientHeight,
        );
        const target = Math.min(rawTarget, maxScrollTop);
        container.scrollTop = target;

        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const nextRawTarget = getScrollTopForPosition(index, pageOffset);
        if (nextRawTarget === null) return false;
        const nextMaxScrollTop = Math.max(
          0,
          container.scrollHeight - container.clientHeight,
        );
        const nextTarget = Math.min(nextRawTarget, nextMaxScrollTop);
        const targetStable = Math.abs(nextTarget - previousTarget) <= 1;
        const scrollStable = Math.abs(container.scrollTop - nextTarget) <= 1;
        stableFrames = targetStable && scrollStable ? stableFrames + 1 : 0;
        previousTarget = nextTarget;

        if (stableFrames >= 2) return true;
      }
    } finally {
      applyingPosition = false;
    }

    return false;
  }

  export async function jumpToPosition(index: number, pageOffset = 0) {
    const initialPosition = !pageObserver;
    if (initialPosition) await tick();
    else await waitForContainerLayout();
    await ensureRatiosThrough(index);
    await tick();
    if (initialPosition) {
      const target = getScrollTopForPosition(index, pageOffset);
      if (target !== null && container) {
        container.scrollTop = Math.min(
          target,
          Math.max(0, container.scrollHeight - container.clientHeight),
        );
      }
      return;
    }
    const applied = await applyStablePosition(index, pageOffset);
    if (applied) return;
    const target = getScrollTopForPosition(index, pageOffset);
    if (target !== null && container) container.scrollTop = target;
    else scrollToPage(index);
  }

  export function captureZoomAnchor(
    clientX: number,
    clientY: number,
  ): ZoomAnchor | null {
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    const hit = document.elementFromPoint(clientX, clientY);
    let target = hit?.closest<HTMLElement>("[data-webtoon-page]");
    let anchorX = clientX;
    let anchorY = clientY;

    if (!target || !container.contains(target)) {
      anchorX = containerRect.left + containerRect.width / 2;
      anchorY = containerRect.top + containerRect.height / 2;
      target = document
        .elementFromPoint(anchorX, anchorY)
        ?.closest<HTMLElement>("[data-webtoon-page]");
    }
    if (!target || !container.contains(target)) return null;

    const targetRect = target.getBoundingClientRect();
    if (targetRect.width <= 0 || targetRect.height <= 0) return null;
    return {
      target,
      clientX: anchorX,
      clientY: anchorY,
      relativeX: (anchorX - targetRect.left) / targetRect.width,
      relativeY: (anchorY - targetRect.top) / targetRect.height,
    };
  }

  export async function restoreZoomAnchor(
    anchor: ZoomAnchor,
    centerHorizontally = false,
  ) {
    await tick();

    if (!container || !anchor.target.isConnected) return;
    const nextRect = anchor.target.getBoundingClientRect();
    if (centerHorizontally) {
      container.scrollLeft = getHorizontalCenter();
    } else {
      container.scrollLeft +=
        nextRect.left +
        nextRect.width * anchor.relativeX -
        anchor.clientX;
    }
    container.scrollTop +=
      nextRect.top +
      nextRect.height * anchor.relativeY -
      anchor.clientY;
  }

  function schedulePositionUpdate() {
    if (!positionTrackingEnabled || applyingPosition || positionUpdateRafId)
      return;
    positionUpdateRafId = requestAnimationFrame(() => {
      positionUpdateRafId = 0;
      if (applyingPosition) return;
      const position = readCurrentPosition();
      if (!position) return;
      onPositionChange(position);
    });
  }

  function handleScroll() {
    schedulePositionUpdate();
  }

  function updateViewportSize(preservePosition = false) {
    if (!container) return;
    const nextWidth = container.clientWidth;
    const nextHeight = container.clientHeight;
    if (nextWidth === viewportWidth && nextHeight === viewportHeight) return;
    const position = preservePosition ? readCurrentPosition() : null;
    viewportWidth = nextWidth;
    viewportHeight = nextHeight;
    if (resizeRestoreRafId) cancelAnimationFrame(resizeRestoreRafId);
    resizeRestoreRafId = requestAnimationFrame(() => {
      resizeRestoreRafId = 0;
      container.scrollLeft = getHorizontalCenter();
      if (position) {
        void applyStablePosition(position.pageIndex, position.pageOffset, 12);
      }
    });
  }

  function handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target;
    const page =
      target instanceof Element
        ? target.closest<HTMLElement>("[data-webtoon-page]")
        : null;
    const pageWidth = page?.getBoundingClientRect().width ?? 0;
    const viewport = container.getBoundingClientRect();
    const pageCanPanX = Boolean(
      page && (zoomLevel > 100 || pageWidth > viewport.width + 1),
    );
    dragGesture = {
      id: e.pointerId,
      mode: "pending",
      startedAt: performance.now(),
      trace: [],
      x: e.clientX,
      y: e.clientY,
      screenX: e.screenX,
      screenY: e.screenY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      windowX: window.screenX,
      windowY: window.screenY,
      pageCanPanX,
    };
    suppressNextClick = false;
  }

  function sampleGesture(gesture: DragGesture, e: PointerEvent) {
    const sample: [number, number, number] = [
      Math.round(performance.now() - gesture.startedAt),
      Math.round(e.screenX - gesture.screenX),
      Math.round(e.screenY - gesture.screenY),
    ];
    const previous = gesture.trace.at(-1);
    if (previous && sample[0] - previous[0] < 16) return;
    if (gesture.trace.length >= MAX_INTENT_SAMPLES) gesture.trace.shift();
    gesture.trace.push(sample);
  }

  function classifyPageDrag(gesture: DragGesture): ActiveDragMode | null {
    const current = gesture.trace.at(-1);
    if (!current) return null;

    let previous = current;
    for (let i = gesture.trace.length - 2; i >= 0; i--) {
      previous = gesture.trace[i];
      if (current[0] - previous[0] >= RECENT_INTENT_MS) break;
    }

    const recentDx = current[1] - previous[1];
    const recentDy = current[2] - previous[2];
    if (
      current[0] - previous[0] >= RECENT_INTENT_MS &&
      Math.hypot(recentDx, recentDy) >= RECENT_INTENT_PX
    ) {
      const horizontal = Math.abs(recentDx);
      const vertical = Math.abs(recentDy);
      if (vertical >= horizontal * SCROLL_AXIS_RATIO) return "scroll";
      if (horizontal >= vertical * WINDOW_AXIS_RATIO) return "window";
    }

    if (
      current[0] >= SLOW_INTENT_MS &&
      Math.hypot(current[1], current[2]) >= SLOW_INTENT_PX
    ) {
      return Math.abs(current[1]) >=
        Math.abs(current[2]) * SLOW_WINDOW_AXIS_RATIO
        ? "window"
        : "scroll";
    }

    return null;
  }

  function handlePointerMove(e: PointerEvent) {
    const gesture = dragGesture;
    if (!gesture || gesture.id !== e.pointerId) return;
    if (e.pointerType === "mouse" && (e.buttons & 1) === 0) {
      finishPointerGesture(e);
      return;
    }
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;

    if (gesture.mode === "pending") {
      sampleGesture(gesture, e);
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      const immediateMode: ActiveDragMode | null =
        fullscreen || !onMoveWindow || gesture.pageCanPanX
          ? "scroll"
          : e.altKey
            ? "window"
            : null;
      const mode = immediateMode ?? classifyPageDrag(gesture);
      if (!mode) return;

      gesture.mode = mode;
      suppressNextClick = true;
      container.setPointerCapture(e.pointerId);
      onDragStart?.();
    }

    if (gesture.mode === "window") {
      onMoveWindow?.(
        gesture.windowX + e.screenX - gesture.screenX,
        gesture.windowY + e.screenY - gesture.screenY,
      );
    } else {
      positionTrackingEnabled = true;
      container.scrollLeft = gesture.scrollLeft - dx;
      container.scrollTop = gesture.scrollTop - dy;
    }
    e.preventDefault();
  }

  function finishPointerGesture(e: PointerEvent) {
    const gesture = dragGesture;
    if (!gesture || gesture.id !== e.pointerId) return;
    if (container.hasPointerCapture(e.pointerId)) {
      container.releasePointerCapture(e.pointerId);
    }
    dragGesture = null;
    if (suppressNextClick) {
      setTimeout(() => {
        suppressNextClick = false;
      }, 0);
    }
  }

  function handleClick(e: MouseEvent) {
    if (suppressNextClick) {
      suppressNextClick = false;
      e.stopPropagation();
      return;
    }
    onToggleUI?.();
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
      } else {
        settleInitialImage(index);
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
    requestLoad(currentPage, true);
    if (prefetchEnabled) loadAround(currentPage, 6, 30);
    else requestLoad(currentPage + 1, true);
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
      }
      pageUrls = new Map(pageUrls);
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

    const resolvedColumnAspectRatio = await resolveColumnAspectRatio();
    await onColumnAspectRatioResolved?.(resolvedColumnAspectRatio);
    updateViewportSize();
    await jumpToPosition(currentPage, initialPageOffset);
    await centerZoomHorizontally();
    await initialImageReady;

    resizeObserver = new ResizeObserver(() => {
      updateViewportSize(true);
    });
    resizeObserver.observe(container, { box: "border-box" });

    pageObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const raw = el.getAttribute("data-page-index");
          const idx = raw ? parseInt(raw, 10) : -1;
          if (idx === -1) continue;
          if (entry.isIntersecting) {
            loadAround(idx, 6, 18);
          }
        }
      },
      {
        root: container,
        rootMargin: "1200px 0px",
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

    await onInitialPositioned?.();
    prefetchEnabled = true;
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
    if (positionUpdateRafId) cancelAnimationFrame(positionUpdateRafId);
    if (resizeRestoreRafId) cancelAnimationFrame(resizeRestoreRafId);
    resizeObserver?.disconnect();
    if (pageObserver) pageObserver.disconnect();
    pageUrls.clear();
    queuedLoads.clear();
    loadingLoads.clear();
    observedIndices.clear();
    pageRatios.clear();
  });
</script>

<div
  bind:this={container}
  data-webtoon-canvas
  class="flex-1 overflow-auto w-full h-full bg-black select-none"
  style="filter: brightness({brightness}%) contrast({contrast}%); touch-action: none; cursor: {dragGesture?.mode === 'scroll'
    ? 'grabbing'
    : dragGesture?.mode === 'window'
      ? 'move'
      : 'grab'};"
  onclick={handleClick}
  role="button"
  tabindex="0"
  onkeydown={(e) => {
    if (e.key === "Enter") onToggleUI?.();
  }}
  onscroll={handleScroll}
  onwheel={() => (positionTrackingEnabled = true)}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={finishPointerGesture}
  onpointercancel={finishPointerGesture}
>
  <div
    class="flex min-h-full flex-col items-center"
    style="width: {getCanvasWidth()}px;"
  >
    {#each pages as pageIndex}
      {@const url = pageUrls.get(pageIndex)}
      {@const pageSize = getPageSize(pageIndex)}
      <div
        class="flex shrink-0 items-center justify-center bg-black"
        style="width: {Math.max(viewportWidth, pageSize?.width ?? 0)}px; height: {pageSize
          ?.height ?? 0}px;"
        data-page-index={pageIndex}
        oncontextmenu={(e) => onContextMenu?.(pageIndex, e)}
        role="presentation"
      >
        {#if url}
          <img
            src={url}
            alt="Page {pageIndex + 1}"
            class="block shrink-0"
            data-webtoon-page
            style="width: {pageSize?.width ?? 0}px; height: {pageSize?.height ??
              0}px; object-fit: contain; cursor: {dragGesture?.mode === 'scroll'
              ? 'grabbing'
              : dragGesture?.mode === 'window'
                ? 'move'
                : 'grab'};"
            decoding="async"
            fetchpriority={Math.abs(pageIndex - currentPage) <= 1
              ? "high"
              : "low"}
            onload={() => settleInitialImage(pageIndex)}
            onerror={() => settleInitialImage(pageIndex)}
            draggable="false"
          />
        {:else}
          <div
            class="shrink-0 bg-black"
            data-webtoon-page
            style="width: {pageSize?.width ?? 0}px; height: {pageSize?.height ??
              0}px; cursor: {dragGesture?.mode === 'scroll'
              ? 'grabbing'
              : dragGesture?.mode === 'window'
                ? 'move'
                : 'grab'};"
          ></div>
        {/if}
      </div>
    {/each}
  </div>
</div>
