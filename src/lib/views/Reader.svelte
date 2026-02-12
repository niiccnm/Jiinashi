<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { fade } from "svelte/transition";
  import { openLibrary } from "../stores/app";

  // Components
  import ReaderOverlay from "../components/Reader/ReaderOverlay.svelte";
  import ReaderSettings from "../components/Reader/ReaderSettings.svelte";
  import SinglePageCanvas from "../components/Reader/SinglePageCanvas.svelte";
  import DoublePageCanvas from "../components/Reader/DoublePageCanvas.svelte";
  import WebtoonCanvas from "../components/Reader/WebtoonCanvas.svelte";
  import ReaderContextMenu from "../components/Reader/ReaderContextMenu.svelte";

  interface LibraryItem {
    id: number;
    path: string;
    title: string;
    type: "book" | "folder";
    page_count: number;
    cover_path: string | null;
    is_favorite: boolean;
    reading_status: "unread" | "reading" | "read";
    current_page: number;
    last_read_at: string | null;
    added_at: string;
  }

  interface Props {
    book: LibraryItem;
  }

  let { book }: Props = $props();

  // --- State ---
  let currentPage = $state(0);
  let totalPages = $state(0);
  let lastNavigationFromPage = $state(0);

  // Settings
  let viewMode = $state<"single" | "double" | "webtoon">("single");
  let fitMode = $state<"width" | "height" | "contain" | "fill">("contain");
  let mangaMode = $state(true);
  let brightness = $state(100);
  let contrast = $state(100);
  let gamma = $state(100);
  let backgroundColor = $state("#000000");

  // Zoom state (percentage, 100 = normal)
  let zoomLevel = $state(100);
  const ZOOM_MIN = 20;
  const ZOOM_MAX = 2000;
  const ZOOM_STEP = 25;

  // Pan state (offset in pixels when zoomed)
  let panX = $state(0);
  let panY = $state(0);
  let isPanning = $state(false);
  let wasPanning = $state(false);
  let isPanCandidate = false;
  let panCandidateStartX = 0;
  let panCandidateStartY = 0;
  const PAN_START_THRESHOLD_PX = 6;
  let isWindowDragging = false;
  let isWindowDragCandidate = false;
  let windowDragCandidateStartX = 0;
  let windowDragCandidateStartY = 0;
  const WINDOW_DRAG_START_THRESHOLD_PX = 4;
  let suppressNextPrimaryClick = false;
  let windowDragStartX = 0;
  let windowDragStartY = 0;
  let panStartX = 0;
  let panStartY = 0;
  let panMoveRafId = 0;
  let pendingPanMoveX = 0;
  let pendingPanMoveY = 0;

  // Optimization: Cache bounds during interaction to avoid layout thrashing
  let cachedPanBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let localPanX = 0;
  let localPanY = 0;

  let transformTargetEl: HTMLElement | null = $state(null);
  let viewportEl: HTMLElement | null = $state(null);

  let targetZoomLevel = $state(100);
  let targetPanX = $state(0);
  let targetPanY = $state(0);
  let zoomAnimRafId = 0;
  let lastZoomAnimTs = 0;

  let wheelQueue: { deltaY: number; clientX: number; clientY: number }[] = [];
  let wheelRafId = 0;

  // UI State
  let showOverlay = $state(true);
  let showSettings = $state(false);
  let uiTimeout: any;
  let showSpinner = $state(false);
  let loadingTimeout: any;
  let navCancelNonce = $state(0);
  let hasWindowResized = false; // Renamed from initialResizeDone to avoid conflict
  let lastAutoResizeMode = $state<"single" | "double" | "webtoon" | null>(null);
  let windowShown = false; // Track if we have shown the window
  let isFullscreen = $state(false); // Track full screen state
  let isFullscreenTransitioning = $state(false);
  let fullscreenTransitionRafId1 = 0;
  let fullscreenTransitionRafId2 = 0;
  let fullscreenTransitionTimeout: any;
  let cleanupFullscreenListener: (() => void) | undefined;

  // --- Context Menu State ---
  let contextMenu = $state({
    x: 0,
    y: 0,
    visible: false,
    pageIndex: -1,
  });

  let pageNames = new Map<number, string>();

  function hasElectronFullscreenApi(): boolean {
    return Boolean((window as any).electronAPI?.reader?.toggleFullscreen);
  }

  function handleDomFullscreenChange() {
    if (hasElectronFullscreenApi()) return;
    isFullscreen = Boolean(document.fullscreenElement);

    isFullscreenTransitioning = true;
    clearTimeout(fullscreenTransitionTimeout);
    if (fullscreenTransitionRafId1)
      cancelAnimationFrame(fullscreenTransitionRafId1);
    if (fullscreenTransitionRafId2)
      cancelAnimationFrame(fullscreenTransitionRafId2);

    fullscreenTransitionRafId1 = requestAnimationFrame(() => {
      fullscreenTransitionRafId2 = requestAnimationFrame(() => {
        isFullscreenTransitioning = false;
        fullscreenTransitionRafId1 = 0;
        fullscreenTransitionRafId2 = 0;
      });
    });
  }

  async function toggleFullscreenSafe() {
    try {
      if (hasElectronFullscreenApi()) {
        (window as any).electronAPI.reader.toggleFullscreen();
        return;
      }

      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (e) {
      console.error("Fullscreen toggle failed:", e);
    }
  }

  // Cache
  interface PageResult {
    url: string;
    ratio?: number;
  }

  let preloadedPages = new Map<number, PageResult>();
  let inFlightPages = new Map<number, Promise<PageResult | null>>();
  // Current active URLs (for Single/Double modes mostly)
  let activePageUrls = $state<{ [key: number]: string }>({});
  // Track latest page load request to avoid out-of-order async updates when scrubbing
  let loadRequestId = 0;
  // Track which page load is actually needed; skip intermediate ones during scrubbing
  let targetLoadIndex: number | null = null;
  let currentLoadingIndex: number | null = null;

  function showReaderWindow() {
    if (windowShown) return;
    windowShown = true;
    window.electronAPI.reader.showWindow();
  }

  async function loadImageDims(
    url: string
  ): Promise<{ w: number; h: number } | null> {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function resizeWindowToDoubleImages(url1: string, url2: string | null) {
    if (lastAutoResizeMode === "double") return;
    lastAutoResizeMode = "double";
    hasWindowResized = true;

    const d1 = await loadImageDims(url1);
    const d2 = url2 ? await loadImageDims(url2) : null;

    if (!d1) {
      showReaderWindow();
      return;
    }

    const TARGET_BASE_H = 950;
    const MAX_W = window.screen.availWidth * 0.9;
    const MAX_H = window.screen.availHeight * 0.9;
    const MIN_W = 400;
    const MIN_H = 400;

    let targetH = TARGET_BASE_H;
    const w1 = targetH * (d1.w / d1.h);
    const w2 = d2 ? targetH * (d2.w / d2.h) : 0;
    let targetW = w1 + w2;

    if (targetH > MAX_H) {
      const s = MAX_H / targetH;
      targetH = MAX_H;
      targetW = targetW * s;
    }

    if (targetW > MAX_W) {
      const s = MAX_W / targetW;
      targetW = MAX_W;
      targetH = targetH * s;
    }

    if (targetW < MIN_W) targetW = MIN_W;
    if (targetH < MIN_H) targetH = MIN_H;

    window.electronAPI.reader.resizeWindow(targetW, targetH).then(() => {
      showReaderWindow();
    });
  }

  async function resizeWindowToImage(url: string) {
    // Auto-resize window for single-page view
    if (lastAutoResizeMode === "single") return;
    lastAutoResizeMode = "single";
    hasWindowResized = true;

    const img = new Image();
    img.onload = () => {
      const aspect = img.naturalWidth / img.naturalHeight;

      const TARGET_BASE_H = 950;
      const MAX_W = window.screen.availWidth * 0.9;
      const MAX_H = window.screen.availHeight * 0.9;
      const MIN_W = 400;
      const MIN_H = 400;

      let targetH = TARGET_BASE_H;
      let targetW = targetH * aspect;

      if (targetH > MAX_H) {
        targetH = MAX_H;
        targetW = targetH * aspect;
      }

      if (targetW > MAX_W) {
        targetW = MAX_W;
        targetH = targetW / aspect;
      }

      if (targetW < MIN_W) targetW = MIN_W;
      if (targetH < MIN_H) targetH = MIN_H;

      if (targetH < MIN_H) targetH = MIN_H;

      window.electronAPI.reader.resizeWindow(targetW, targetH).then(() => {
        showReaderWindow();
      });
    };
    img.onerror = () => {
      showReaderWindow();
    };
    img.src = url;
  }

  async function resizeWindowToWebtoon(page: PageResult) {
    if (lastAutoResizeMode === "webtoon") return;
    lastAutoResizeMode = "webtoon";
    hasWindowResized = true;

    const TARGET_BASE_H = 950;
    const MAX_W = window.screen.availWidth * 0.9;
    const MAX_H = window.screen.availHeight * 0.9;
    const MIN_W = 500;
    const MIN_H = 500;

    let ratio = page.ratio;
    if (!ratio) {
      const d = await loadImageDims(page.url);
      if (d && d.w > 0 && d.h > 0) ratio = d.w / d.h;
    }

    if (!ratio || ratio <= 0) {
      showReaderWindow();
      return;
    }

    let targetH = Math.min(TARGET_BASE_H, MAX_H);
    let targetW = targetH * ratio;

    if (targetW > MAX_W) {
      const s = MAX_W / targetW;
      targetW = MAX_W;
      targetH = targetH * s;
    }

    if (targetW < MIN_W) targetW = MIN_W;
    if (targetH < MIN_H) targetH = MIN_H;

    window.electronAPI.reader.resizeWindow(targetW, targetH).then(() => {
      showReaderWindow();
    });
  }

  // --- Lifecycle ---

  async function initReader() {
    await loadSettings();
    // Initialize state from book
    totalPages = await window.electronAPI.reader.getPageCount(book.path);
    currentPage = book.current_page || 0;
    // Initial Load
    await loadPage(currentPage);
  }

  onMount(() => {
    initReader();

    // Listen for fullscreen changes
    if ((window as any).electronAPI?.reader?.onFullscreenChange) {
      cleanupFullscreenListener = (
        window as any
      ).electronAPI.reader.onFullscreenChange((state: boolean) => {
        isFullscreen = state;

        isFullscreenTransitioning = true;
        clearTimeout(fullscreenTransitionTimeout);
        if (fullscreenTransitionRafId1)
          cancelAnimationFrame(fullscreenTransitionRafId1);
        if (fullscreenTransitionRafId2)
          cancelAnimationFrame(fullscreenTransitionRafId2);

        fullscreenTransitionRafId1 = requestAnimationFrame(() => {
          fullscreenTransitionRafId2 = requestAnimationFrame(() => {
            isFullscreenTransitioning = false;
            fullscreenTransitionRafId1 = 0;
            fullscreenTransitionRafId2 = 0;
          });
        });

        // Force cancel any ongoing window drag if we enter fullscreen
        if (state && isWindowDragging) {
          isWindowDragging = false;
        }
      });
    }

    document.addEventListener("fullscreenchange", handleDomFullscreenChange);

    // Fallback: If auto-resize doesn't happen (e.g. error, or slow), show window anyway
    setTimeout(() => {
      if (!windowShown) {
        showReaderWindow();
      }
    }, 1000);

    // Start auto-hider for controls
    resetUiTimeout();

    const handleGlobalClick = () => {
      if (contextMenu.visible) {
        contextMenu.visible = false;
      }
    };
    window.addEventListener("click", handleGlobalClick);
    return () => {
      window.removeEventListener("click", handleGlobalClick);
    };
  });

  onDestroy(() => {
    // Cleanup blobs
    cleanupBlobs();
    clearTimeout(uiTimeout);
    clearTimeout(loadingTimeout);
    clearTimeout(fullscreenTransitionTimeout);
    if (fullscreenTransitionRafId1)
      cancelAnimationFrame(fullscreenTransitionRafId1);
    if (fullscreenTransitionRafId2)
      cancelAnimationFrame(fullscreenTransitionRafId2);
    if (cleanupFullscreenListener) cleanupFullscreenListener();
    document.removeEventListener("fullscreenchange", handleDomFullscreenChange);
  });

  function cleanupBlobs() {
    const revoked = new Set<string>();
    preloadedPages.forEach(({ url }) => {
      if (revoked.has(url)) return;
      revoked.add(url);
      URL.revokeObjectURL(url);
    });
    preloadedPages.clear();
    Object.values(activePageUrls).forEach((url) => {
      if (revoked.has(url)) return;
      revoked.add(url);
      URL.revokeObjectURL(url);
    });
    inFlightPages.clear();
  }

  // --- Logic ---

  function isForwardProgress(from: number, to: number): boolean {
    if (from === to) return false;
    return to > from;
  }

  async function handleWebtoonPageChange(index: number) {
    const prevPage = currentPage;
    lastNavigationFromPage = prevPage;
    const shouldUpdateTimestamp = isForwardProgress(prevPage, index);
    currentPage = index;

    const status =
      index === 0 ? "reading" : index >= totalPages - 1 ? "read" : "reading";
    try {
      await window.electronAPI.reader.updateProgress(
        book.id,
        index,
        status,
        shouldUpdateTimestamp
      );
    } catch (e) {
      console.error("Failed to persist reading progress (webtoon):", e);
    }
  }

  function handleWindowBlur() {
    cancelPanState();
  }

  async function loadSettings() {
    const settings = await window.electronAPI.settings.getAll();
    viewMode = (settings.defaultViewMode as any) || "single";
    fitMode = (settings.defaultFitMode as any) || "contain";
    mangaMode = settings.mangaMode !== "false";
    backgroundColor = settings.backgroundColor || "#000000";
  }

  function updateSettings(newSettings: any) {
    if (newSettings.viewMode) {
      const nextMode = newSettings.viewMode;
      const modeChanged = nextMode !== viewMode;
      viewMode = nextMode;
      if (nextMode === "webtoon") {
        clearTimeout(loadingTimeout);
        showSpinner = false;
      }
      if (modeChanged && !isFullscreen) {
        hasWindowResized = false;
        lastAutoResizeMode = null;
        void loadPage(currentPage);
      }
    }
    if (newSettings.fitMode) fitMode = newSettings.fitMode;
    if (newSettings.mangaMode !== undefined) mangaMode = newSettings.mangaMode;
    if (newSettings.brightness) brightness = newSettings.brightness;
    if (newSettings.contrast) contrast = newSettings.contrast;
    if (newSettings.gamma) gamma = newSettings.gamma;

    if (newSettings.viewMode)
      window.electronAPI.settings.set("defaultViewMode", newSettings.viewMode);
    if (newSettings.fitMode)
      window.electronAPI.settings.set("defaultFitMode", newSettings.fitMode);
    if (newSettings.mangaMode !== undefined)
      window.electronAPI.settings.set(
        "mangaMode",
        String(newSettings.mangaMode)
      );
  }

  async function fetchPage(index: number): Promise<PageResult | null> {
    if (index < 0 || (totalPages > 0 && index >= totalPages)) return null;

    if (preloadedPages.has(index)) {
      const page = preloadedPages.get(index)!;
      return page;
    }

    if (inFlightPages.has(index)) {
      return await inFlightPages.get(index)!;
    }

    const promise: Promise<PageResult | null> = (async () => {
      try {
        const result = await window.electronAPI.reader.getPage(
          book.path,
          index
        );
        if (result && result.data) {
          if (result.totalPages) totalPages = result.totalPages;
          if (result.name) pageNames.set(index, result.name);

          const blob = new Blob([result.data as BlobPart]);
          const url = URL.createObjectURL(blob);
          const w = (result as any).width as number | undefined;
          const h = (result as any).height as number | undefined;
          const ratio = w && h ? w / h : undefined;
          return { url, ratio };
        }
      } catch (e) {
        console.error("Error loading page " + index, e);
      }
      return null;
    })();

    inFlightPages.set(index, promise);
    try {
      return await promise;
    } finally {
      inFlightPages.delete(index);
    }
  }

  async function preload(index: number) {
    if (index < 0 || index >= totalPages || preloadedPages.has(index)) return;
    const page = await fetchPage(index);
    if (page) preloadedPages.set(index, page);
  }

  async function loadPage(index: number) {
    if (index < 0 || (totalPages > 0 && index >= totalPages)) return;

    targetLoadIndex = index;

    if (currentLoadingIndex !== null && currentLoadingIndex !== index) {
      return;
    }

    const requestId = ++loadRequestId;
    currentLoadingIndex = index;

    const modeAtLoad = viewMode;

    const prevPage = currentPage;
    lastNavigationFromPage = prevPage;

    if (windowShown && modeAtLoad !== "webtoon") {
      loadingTimeout = setTimeout(() => {
        if (requestId === loadRequestId && viewMode === modeAtLoad) {
          showSpinner = true;
        }
      }, 800);
    } else {
      clearTimeout(loadingTimeout);
      showSpinner = false;
    }

    try {
      if (viewMode === "single") {
        const page = await fetchPage(index);
        if (requestId !== loadRequestId) {
          return;
        }

        if (page?.url) {
          if (!activePageUrls[index]) {
            activePageUrls[index] = page.url;
          }

          currentPage = index;

          clearTimeout(loadingTimeout);
          showSpinner = false;

          if (!hasWindowResized && index === (book.current_page || 0)) {
            resizeWindowToImage(page.url);
          }
        } else {
          if (!hasWindowResized && index === (book.current_page || 0)) {
            showReaderWindow();
          }
        }
      } else if (viewMode === "double") {
        let pairStart = index;
        if (index > 0) {
          if (index % 2 !== 0) {
            pairStart = index;
          } else {
            pairStart = index - 1;
          }
        }

        const p1 = await fetchPage(pairStart);
        const p2 = await fetchPage(pairStart + 1);

        if (requestId !== loadRequestId) {
          return;
        }

        clearTimeout(loadingTimeout);
        showSpinner = false;

        if (p1?.url) {
          activePageUrls[pairStart] = p1.url;
        }
        if (p2?.url) activePageUrls[pairStart + 1] = p2.url;

        currentPage = index;

        if (p1?.url) {
          if (!isFullscreen && lastAutoResizeMode !== "double") {
            resizeWindowToDoubleImages(p1.url, p2?.url ?? null);
          }
        } else {
          if (
            (!hasWindowResized && pairStart === (book.current_page || 0)) ||
            (book.current_page === 0 && pairStart === 0)
          ) {
            showReaderWindow();
          }
        }
      } else if (viewMode === "webtoon") {
        clearTimeout(loadingTimeout);
        showSpinner = false;
        // Preload the current page before showing the window to avoid an initial blank flash.
        // This matches the perceived behavior of single/double where the current page is loaded before display.
        const prefetched = await fetchPage(index);
        if (prefetched && !preloadedPages.has(index)) {
          preloadedPages.set(index, prefetched);
        }
        if (!hasWindowResized) {
          if (!isFullscreen && prefetched) {
            await resizeWindowToWebtoon(prefetched);
          } else {
            hasWindowResized = true;
            showReaderWindow();
          }
        }
      }

      if (requestId !== loadRequestId) {
        return;
      }

      const shouldUpdateTimestamp = isForwardProgress(prevPage, index);

      currentPage = index;

      // Update DB
      const status =
        index === 0 ? "reading" : index >= totalPages - 1 ? "read" : "reading";
      try {
        await window.electronAPI.reader.updateProgress(
          book.id,
          index,
          status,
          shouldUpdateTimestamp
        );
      } catch (e) {
        console.error("Failed to persist reading progress:", e);
      }

      // Preload neighbors
      preload(index + 1);
      preload(index + 2);
      preload(index - 1);
    } finally {
      clearTimeout(loadingTimeout);
      if (requestId === loadRequestId) {
        showSpinner = false;
      }
      currentLoadingIndex = null;
      // If a different index was requested while we were loading, load it now
      if (targetLoadIndex !== null && targetLoadIndex !== index) {
        const nextIndex = targetLoadIndex;
        await loadPage(nextIndex);
      }
    }
  }

  // --- Interaction ---

  function nextPage() {
    let next = currentPage;
    if (viewMode === "single") {
      next = currentPage + 1;
    } else if (viewMode === "double") {
      const step = currentPage === 0 ? 1 : 2;
      next = mangaMode
        ? currentPage === 0
          ? -1
          : currentPage - 2
        : currentPage + step;
      if (mangaMode && currentPage > 0 && currentPage % 2 === 0)
        next = currentPage - 2;
    }

    const direction = mangaMode ? -1 : 1;
    const step = viewMode === "double" && currentPage > 0 ? 2 : 1;
    let target = currentPage + step * direction;

    if (viewMode === "double") {
      if (mangaMode) {
        if (currentPage === 0) target = 1;
        else target = currentPage + 2;
      } else {
        if (currentPage === 0) target = 1;
        else
          target =
            currentPage === 0
              ? 1
              : currentPage % 2 !== 0
                ? currentPage + 2
                : currentPage + 1;
      }
    }

    if (viewMode === "double") {
      if (!mangaMode) {
        if (currentPage === 0) loadPage(1);
        else {
          const currentPairStart =
            currentPage % 2 !== 0 ? currentPage : currentPage - 1;
          loadPage(currentPairStart + 2);
        }
      } else {
        if (currentPage === 0) loadPage(1);
        else {
          const currentPairStart =
            currentPage % 2 !== 0 ? currentPage : currentPage - 1;
          loadPage(currentPairStart + 2);
        }
      }
    } else {
      loadPage(currentPage + 1);
    }
  }

  function prevPage() {
    if (viewMode === "double") {
      if (!mangaMode) {
        // 1 -> 0
        if (currentPage <= 1) loadPage(0);
        else {
          const currentPairStart =
            currentPage % 2 !== 0 ? currentPage : currentPage - 1;
          loadPage(currentPairStart - 2);
        }
      } else {
        // RTL
        if (currentPage <= 1) loadPage(0);
        else {
          const currentPairStart =
            currentPage % 2 !== 0 ? currentPage : currentPage - 1;
          loadPage(currentPairStart - 2);
        }
      }
    } else {
      // Single
      loadPage(currentPage - 1);
    }
  }

  function sideNextPage() {
    if (viewMode === "double") {
      if (currentPage === 0) loadPage(1);
      else {
        const currentPairStart =
          currentPage % 2 !== 0 ? currentPage : currentPage - 1;
        loadPage(currentPairStart + 2);
      }
    } else {
      loadPage(currentPage + 1);
    }
  }

  function sidePrevPage() {
    if (viewMode === "double") {
      if (currentPage <= 1) loadPage(0);
      else {
        const currentPairStart =
          currentPage % 2 !== 0 ? currentPage : currentPage - 1;
        loadPage(currentPairStart - 2);
      }
    } else {
      loadPage(currentPage - 1);
    }
  }

  function handleInteraction() {
    if (isPanning) return; // Don't reset UI timeout while panning
    showOverlay = true;
    resetUiTimeout();
  }

  function toggleOverlay() {
    showOverlay = !showOverlay;
    if (showOverlay) resetUiTimeout();
    else clearTimeout(uiTimeout);
  }

  function resetUiTimeout() {
    clearTimeout(uiTimeout);
    uiTimeout = setTimeout(() => {
      if (!showSettings) showOverlay = false; // Keep showing if settings open
    }, 1500);
  }

  function getPanBounds(zoomPct: number): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    if (!transformTargetEl || !viewportEl)
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    const z = zoomPct / 100;
    if (z <= 1) {
      // Allow panning even when zoomed out (infinite canvas feel)
      // return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
    }

    const baseW = transformTargetEl.offsetWidth;
    const baseH = transformTargetEl.offsetHeight;
    const viewportW = viewportEl.clientWidth;
    const viewportH = viewportEl.clientHeight;

    const scaledW = baseW * z;
    const scaledH = baseH * z;

    // Relaxed bounds: Allow image to be panned freely.
    // We allow the center of the image to go almost to the edge of the viewport.
    const maxX = (scaledW + viewportW) / 2;
    const maxY = (scaledH + viewportH) / 2;

    return {
      minX: -maxX,
      maxX: maxX,
      minY: -maxY,
      maxY: maxY,
    };
  }

  function clampPan(
    nextX: number,
    nextY: number,
    zoomPct: number
  ): { x: number; y: number } {
    const { minX, maxX, minY, maxY } = getPanBounds(zoomPct);
    const x = Math.min(maxX, Math.max(minX, nextX));
    const y = Math.min(maxY, Math.max(minY, nextY));
    return { x, y };
  }

  function startZoomAnimation() {
    if (zoomAnimRafId) return;
    lastZoomAnimTs = 0;

    const step = (ts: number) => {
      if (!lastZoomAnimTs) lastZoomAnimTs = ts;
      const dt = Math.min(64, ts - lastZoomAnimTs);
      lastZoomAnimTs = ts;

      // Frame-rate independent smoothing
      const t = 1 - Math.pow(0.001, dt / 16);

      zoomLevel = zoomLevel + (targetZoomLevel - zoomLevel) * t;
      panX = panX + (targetPanX - panX) * t;
      panY = panY + (targetPanY - panY) * t;

      const done =
        Math.abs(targetZoomLevel - zoomLevel) < 0.01 &&
        Math.abs(targetPanX - panX) < 0.25 &&
        Math.abs(targetPanY - panY) < 0.25;

      if (done) {
        zoomLevel = targetZoomLevel;
        panX = targetPanX;
        panY = targetPanY;
        zoomAnimRafId = 0;
        return;
      }

      zoomAnimRafId = requestAnimationFrame(step);
    };

    zoomAnimRafId = requestAnimationFrame(step);
  }

  function cancelPanState() {
    if (!isPanning) return;
    isPanning = false;
    panX = localPanX;
    panY = localPanY;
    targetPanX = localPanX;
    targetPanY = localPanY;
    setTimeout(() => {
      wasPanning = false;
    }, 0);
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!target) return false;
    const el = target as HTMLElement;
    const tag = el.tagName?.toLowerCase?.() ?? "";
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if ((el as HTMLElement).isContentEditable) return true;
    return !!el.closest?.('[contenteditable="true"]');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (showSettings) return; // Let settings handle its own, or close on esc
    if (isTypingTarget(e.target)) return;

    switch (e.key) {
      case "Home":
        e.preventDefault();
        loadPage(0);
        break;
      case "End":
        if (totalPages > 0) {
          e.preventDefault();
          loadPage(totalPages - 1);
        }
        break;
      case "ArrowRight":
      case "d":
        mangaMode ? prevPage() : nextPage();
        break;
      case "ArrowLeft":
      case "a":
        mangaMode ? nextPage() : prevPage();
        break;
      case "Space":
        e.preventDefault();
        nextPage();
        break;
      case "Escape":
        if (showSettings) showSettings = false;
        else window.close();
        break;
      case "Enter":
        toggleOverlay();
        break;
      case "+":
      case "=": // Handle = key (same key as + without shift)
        e.preventDefault();
        zoomIn();
        break;
      case "-":
      case "_": // Handle underscore (shift + -)
        e.preventDefault();
        zoomOut();
        break;
      case "0":
        e.preventDefault();
        resetZoom();
        break;
    }
  }

  function zoomIn() {
    // Keyboard zoom - just zoom at center
    const newZoom = Math.min(ZOOM_MAX, targetZoomLevel + ZOOM_STEP);
    targetZoomLevel = newZoom;
    if (newZoom === 100) {
      targetPanX = 0;
      targetPanY = 0;
    } else {
      const clamped = clampPan(targetPanX, targetPanY, newZoom);
      targetPanX = clamped.x;
      targetPanY = clamped.y;
    }
    startZoomAnimation();
  }

  function zoomOut() {
    // Keyboard zoom - zoom at center, scale pan proportionally
    const oldZoom = targetZoomLevel;
    const newZoom = Math.max(ZOOM_MIN, targetZoomLevel - ZOOM_STEP);
    targetZoomLevel = newZoom;

    // Scale pan proportionally to keep view centered
    if (oldZoom > 100 && newZoom > 100) {
      const ratio = newZoom / oldZoom;
      targetPanX = targetPanX * ratio;
      targetPanY = targetPanY * ratio;
    }

    // Reset pan when back to 100%
    if (newZoom === 100) {
      targetPanX = 0;
      targetPanY = 0;
      cancelPanState();
    } else {
      const clamped = clampPan(targetPanX, targetPanY, newZoom);
      targetPanX = clamped.x;
      targetPanY = clamped.y;
    }

    startZoomAnimation();
  }

  function resetZoom() {
    targetZoomLevel = 100;
    targetPanX = 0;
    targetPanY = 0;
    startZoomAnimation();
    cancelPanState();
  }

  function handleWheel(e: WheelEvent) {
    // Don't zoom in webtoon mode - let it scroll naturally
    if (viewMode === "webtoon") return;

    e.preventDefault();

    const el = transformTargetEl;
    if (!el || !viewportEl) return;

    // Normalize wheel delta to pixels. deltaMode: 0=pixel, 1=line, 2=page.
    const linePx = 16;
    const normalizedDeltaY =
      e.deltaMode === 1
        ? e.deltaY * linePx
        : e.deltaMode === 2
          ? e.deltaY * viewportEl.clientHeight
          : e.deltaY;

    wheelQueue.push({
      deltaY: normalizedDeltaY,
      clientX: e.clientX,
      clientY: e.clientY,
    });

    if (wheelRafId) return;

    const process = () => {
      wheelRafId = 0;
      if (!transformTargetEl || !viewportEl) {
        wheelQueue = [];
        return;
      }

      if (zoomAnimRafId) {
        cancelAnimationFrame(zoomAnimRafId);
        zoomAnimRafId = 0;
      }

      const sensitivity = 0.0012;

      if (wheelQueue.length) {
        const evt = wheelQueue.shift()!;

        const oldZoom = zoomLevel;
        const oldScale = oldZoom / 100;
        if (oldScale <= 0) {
          if (wheelQueue.length) wheelRafId = requestAnimationFrame(process);
          return;
        }

        const cappedDelta = Math.max(-80, Math.min(80, evt.deltaY));
        const factor = Math.exp(-cappedDelta * sensitivity);

        let newScale = oldScale * factor;
        newScale = Math.min(ZOOM_MAX / 100, Math.max(ZOOM_MIN / 100, newScale));
        const newZoom = newScale * 100;

        if (Math.abs(newZoom - oldZoom) < 0.01) {
          if (wheelQueue.length) wheelRafId = requestAnimationFrame(process);
          return;
        }

        const viewportRect = viewportEl.getBoundingClientRect();
        const vx = viewportRect.left + viewportRect.width / 2;
        const vy = viewportRect.top + viewportRect.height / 2;

        const elRect = transformTargetEl.getBoundingClientRect();
        const insideTarget =
          evt.clientX >= elRect.left &&
          evt.clientX <= elRect.right &&
          evt.clientY >= elRect.top &&
          evt.clientY <= elRect.bottom;

        const anchorX = insideTarget ? evt.clientX : vx;
        const anchorY = insideTarget ? evt.clientY : vy;

        const basePanX = panX;
        const basePanY = panY;

        const worldX = (anchorX - vx - basePanX) / oldScale;
        const worldY = (anchorY - vy - basePanY) / oldScale;

        const desiredPanX = anchorX - vx - worldX * newScale;
        const desiredPanY = anchorY - vy - worldY * newScale;

        // No auto-snap to center at 100% to prevent jumping

        const bounds = getPanBounds(newZoom);
        let nextX = desiredPanX;
        let nextY = desiredPanY;
        // Strict clamping to prevent drift/snapping
        nextX = Math.max(bounds.minX, Math.min(bounds.maxX, nextX));
        nextY = Math.max(bounds.minY, Math.min(bounds.maxY, nextY));

        zoomLevel = newZoom;
        panX = nextX;
        panY = nextY;
      }

      targetZoomLevel = zoomLevel;
      targetPanX = panX;
      targetPanY = panY;

      if (wheelQueue.length) {
        wheelRafId = requestAnimationFrame(process);
      }
    };

    wheelRafId = requestAnimationFrame(process);
  }

  function handleMouseDown(e: MouseEvent) {
    if (showSettings) return;
    // Ignore scrubber interactions
    const target = e.target as HTMLElement | null;
    if (target && target.closest("[data-reader-scrubber]")) {
      return;
    }

    if (e.button === 1) {
      e.preventDefault();
      resetZoom();
      return;
    }

    // Left mouse interaction
    if (e.button === 0 && viewMode !== "webtoon") {
      if (zoomAnimRafId) {
        cancelAnimationFrame(zoomAnimRafId);
        zoomAnimRafId = 0;
      }

      const isZoomedOut = zoomLevel <= 100;

      if (isZoomedOut && !isFullscreen) {
        isWindowDragCandidate = true;
        isWindowDragging = false;
        windowDragCandidateStartX = e.screenX;
        windowDragCandidateStartY = e.screenY;
        windowDragStartX = e.screenX;
        windowDragStartY = e.screenY;
        suppressNextPrimaryClick = false;
      } else {
        if (isFullscreen || zoomLevel > 100) {
          isPanCandidate = true;
          panCandidateStartX = e.clientX;
          panCandidateStartY = e.clientY;
          isPanning = false;
          wasPanning = false;
        } else {
          isPanCandidate = false;
          isPanning = false;
          wasPanning = false;
        }
      }
      e.preventDefault();
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (isWindowDragCandidate && !isWindowDragging) {
      const dx0 = e.screenX - windowDragCandidateStartX;
      const dy0 = e.screenY - windowDragCandidateStartY;
      if (Math.hypot(dx0, dy0) >= WINDOW_DRAG_START_THRESHOLD_PX) {
        isWindowDragging = true;
        windowDragStartX = e.screenX;
        windowDragStartY = e.screenY;
      }
    }

    if (isWindowDragging) {
      const dx = e.screenX - windowDragStartX;
      const dy = e.screenY - windowDragStartY;
      const winX = window.screenX;
      const winY = window.screenY;

      window.electronAPI.reader.moveWindow(winX + dx, winY + dy);

      windowDragStartX = e.screenX;
      windowDragStartY = e.screenY;
      return;
    }

    if (isPanCandidate && !isPanning) {
      const dx = e.clientX - panCandidateStartX;
      const dy = e.clientY - panCandidateStartY;
      if (Math.hypot(dx, dy) >= PAN_START_THRESHOLD_PX) {
        isPanning = true;

        cachedPanBounds = getPanBounds(zoomLevel);
        panStartX = e.clientX - panX;
        panStartY = e.clientY - panY;
        localPanX = panX;
        localPanY = panY;

        targetZoomLevel = zoomLevel;
        targetPanX = panX;
        targetPanY = panY;
      }
    }

    if (isPanning) {
      pendingPanMoveX = e.clientX - panStartX;
      pendingPanMoveY = e.clientY - panStartY;
      if (panMoveRafId) return;

      panMoveRafId = requestAnimationFrame(() => {
        panMoveRafId = 0;
        const { minX, maxX, minY, maxY } = cachedPanBounds;

        localPanX = Math.min(maxX, Math.max(minX, pendingPanMoveX));
        localPanY = Math.min(maxY, Math.max(minY, pendingPanMoveY));

        if (transformTargetEl) {
          transformTargetEl.style.transform = `translate3d(${localPanX}px, ${localPanY}px, 0px) scale(${zoomLevel / 100})`;
        }

        if (!wasPanning) wasPanning = true;
      });
    }
  }

  function handleMouseUp(e: MouseEvent) {
    if (isWindowDragging) {
      isWindowDragging = false;
      isWindowDragCandidate = false;
      suppressNextPrimaryClick = true;
      return;
    }
    if (isWindowDragCandidate) {
      isWindowDragCandidate = false;
    }

    if (isPanning) {
      isPanCandidate = false;
      isPanning = false;
      panX = localPanX;
      panY = localPanY;
      targetPanX = localPanX;
      targetPanY = localPanY;

      setTimeout(() => {
        wasPanning = false;
      }, 50);
      return;
    }

    // Mouse was pressed but never moved far enough to count as a pan.
    // Allow the click handler in the canvas to run normally.
    if (isPanCandidate) {
      isPanCandidate = false;
    }

    if (e.button === 3 || e.button === 4) {
      e.preventDefault();
      if (e.button === 3) {
        sidePrevPage();
      } else if (e.button === 4) {
        sideNextPage();
      }
    }
  }

  function handleReaderClick(e: MouseEvent) {
    if (e.button !== 0) return;

    if (suppressNextPrimaryClick) {
      suppressNextPrimaryClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }

  function getWindowEdgeZonePx(viewportWidth: number): number {
    const pct = 0.2;
    const minPx = 56;
    const maxPx = 320;
    return Math.max(minPx, Math.min(maxPx, viewportWidth * pct));
  }

  function handleReaderDoubleClick(e: MouseEvent) {
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const edgeZone = getWindowEdgeZonePx(rect.width);
    const isEdge = x <= edgeZone || x >= rect.width - edgeZone;

    if (!isFullscreen && isEdge && viewMode !== "webtoon") {
      navCancelNonce += 1;
    }

    e.preventDefault();
    void handleDoubleClick();
  }

  async function handleDoubleClick() {
    if (isFullscreenTransitioning) return;
    isFullscreenTransitioning = true;
    clearTimeout(fullscreenTransitionTimeout);

    if (hasElectronFullscreenApi()) {
      await tick();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
      await toggleFullscreenSafe();
    } else {
      void toggleFullscreenSafe();
    }
    fullscreenTransitionTimeout = setTimeout(() => {
      isFullscreenTransitioning = false;
    }, 700);
  }

  // --- Context Menu Handlers ---
  function openContextMenu(pageIndex: number, x: number, y: number) {
    contextMenu = {
      x,
      y,
      visible: true,
      pageIndex,
    };
  }

  async function hidePage() {
    const index = contextMenu.pageIndex;
    const name = pageNames.get(index);
    if (name) {
      contextMenu.visible = false;
      await window.electronAPI.reader.setPageVisibility(book.id, name, true);
      // Refresh
      location.reload();
    }
  }

  function handleSinglePageContextMenu(e: MouseEvent) {
    e.preventDefault();
    openContextMenu(currentPage, e.clientX, e.clientY);
  }

  function handleDoublePageContextMenu(side: "left" | "right", e: MouseEvent) {
    e.preventDefault();
    if (currentPage === 0) {
      if (side === "right") {
        openContextMenu(0, e.clientX, e.clientY);
      }
      return;
    }

    const pairStart = currentPage % 2 !== 0 ? currentPage : currentPage - 1;
    let index: number;
    if (mangaMode) {
      index = side === "left" ? pairStart + 1 : pairStart;
    } else {
      index = side === "left" ? pairStart : pairStart + 1;
    }

    if (activePageUrls[index]) {
      openContextMenu(index, e.clientX, e.clientY);
    }
  }

  function handleWebtoonContextMenu(index: number, e: MouseEvent) {
    e.preventDefault();
    openContextMenu(index, e.clientX, e.clientY);
  }

  // --- Derived Props ---
  let doublePageProps = $derived.by(() => {
    // Compute left/right page URLs for double-page view.
    if (currentPage === 0) {
      return { left: null, right: activePageUrls[0] || null };
    }

    const pairStart = currentPage % 2 !== 0 ? currentPage : currentPage - 1;
    const p1 = activePageUrls[pairStart];
    const p2 = activePageUrls[pairStart + 1];

    // RTL: [p2] [p1]
    // LTR: [p1] [p2]
    return {
      left: mangaMode ? p2 : p1,
      right: mangaMode ? p1 : p2,
    };
  });

  let webtoonPages = $derived.by(() => {
    return Array.from({ length: totalPages }, (_, i) => i);
  });
</script>

<svelte:window
  on:keydown={handleKeydown}
  on:mouseup={handleMouseUp}
  on:wheel={handleWheel}
  on:mousedown={handleMouseDown}
  on:mousemove={handleMouseMove}
  on:blur={handleWindowBlur}
/>

<div
  class="relative w-full h-full overflow-hidden flex flex-col"
  style="background-color: {backgroundColor};"
  onmousemove={handleInteraction}
  onclickcapture={handleReaderClick}
  ondblclick={handleReaderDoubleClick}
  role="region"
  aria-label="Reader View"
>
  <div
    class="relative w-full h-full flex flex-col"
    class:invisible={isFullscreenTransitioning}
    class:pointer-events-none={isFullscreenTransitioning}
  >
    <ReaderOverlay
      title={book.title}
      {currentPage}
      {totalPages}
      show={showOverlay || showSettings}
      {mangaMode}
      onPageChange={loadPage}
      onNext={mangaMode ? prevPage : nextPage}
      onPrev={mangaMode ? nextPage : prevPage}
      onToggleSettings={() => (showSettings = !showSettings)}
    />

    <ReaderSettings
      show={showSettings}
      {viewMode}
      {fitMode}
      {mangaMode}
      {brightness}
      {contrast}
      {gamma}
      onClose={() => (showSettings = false)}
      onUpdateSettings={updateSettings}
    />

    <div class="flex-1 w-full h-full relative z-0" bind:this={viewportEl}>
      {#if viewMode === "webtoon"}
        <WebtoonCanvas
          pages={webtoonPages}
          {currentPage}
          loadPageFn={fetchPage}
          onPageChange={handleWebtoonPageChange}
          onToggleUI={toggleOverlay}
          {brightness}
          {contrast}
          {zoomLevel}
          onContextMenu={handleWebtoonContextMenu}
        />
      {:else if viewMode === "double" && currentPage > 0}
        <DoublePageCanvas
          imageSrcLeft={doublePageProps.left}
          imageSrcRight={doublePageProps.right}
          {fitMode}
          rtl={mangaMode}
          fullscreen={isFullscreen}
          {navCancelNonce}
          {brightness}
          {contrast}
          {gamma}
          {zoomLevel}
          {panX}
          {panY}
          {isPanning}
          {wasPanning}
          onTransformTargetReady={(el) => (transformTargetEl = el)}
          onNext={nextPage}
          onPrev={prevPage}
          onToggleUI={toggleOverlay}
          onContextMenu={handleDoublePageContextMenu}
        />
      {:else}
        <SinglePageCanvas
          imageSrc={activePageUrls[currentPage]}
          {fitMode}
          rtl={mangaMode}
          fullscreen={isFullscreen}
          {navCancelNonce}
          {brightness}
          {contrast}
          {gamma}
          {zoomLevel}
          {panX}
          {panY}
          {isPanning}
          {wasPanning}
          onTransformTargetReady={(el) => (transformTargetEl = el)}
          onNext={nextPage}
          onPrev={prevPage}
          onToggleUI={toggleOverlay}
          onContextMenu={handleSinglePageContextMenu}
        />
      {/if}
    </div>

    <ReaderContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      visible={contextMenu.visible}
      onClose={() => (contextMenu.visible = false)}
      onHidePage={hidePage}
      {viewMode}
      {fitMode}
      {mangaMode}
      onUpdateSettings={updateSettings}
    />

    {#if showSpinner}
      <div
        class="fixed inset-0 flex items-center justify-center pointer-events-none z-[9999]"
      >
        <div
          class="w-16 h-16 border-4 border-blue-500/50 border-t-blue-500 rounded-full animate-spin"
        ></div>
      </div>
    {/if}
  </div>
</div>
