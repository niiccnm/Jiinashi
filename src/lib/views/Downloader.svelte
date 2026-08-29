<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import DownloadItem from "../components/downloader/DownloadItem.svelte";
  import MetadataBrowser from "../components/manga/MetadataBrowser.svelte";
  import MangaSeriesView from "../components/manga/MangaSeriesView.svelte";
  import { appState, clearDownloaderNavigation } from "../stores/app";
  import { toasts } from "../stores/toast";
  import { dragScroll } from "../utils/dragScroll";
  import {
    createSourceBadgeLookup,
    resolveSourceBadge,
    type SourceBadge,
  } from "../components/manga/sourceCatalog";
  import type {
    DownloadHistoryEntry,
    DownloaderHistoryScope,
    DownloaderQueueItem,
    MangaSourceDescriptor,
    MangaQueueItem,
  } from "../../../electron/preload/types";

  // --- State ---
  let downloadUrl = $state("");
  let queue = $state<DownloaderQueueItem[]>([]);
  let mangaQueue = $state<MangaQueueItem[]>([]);
  let historyByScope = $state<Record<DownloaderHistoryScope, DownloadHistoryEntry[]>>({
    manga: [],
    doujinshi: [],
  });
  let historyRequestedScope = $state<DownloaderHistoryScope | null>(null);
  let historyLoadedByScope = $state<Record<DownloaderHistoryScope, boolean>>({
    manga: false,
    doujinshi: false,
  });
  let historyErrorByScope = $state<Record<DownloaderHistoryScope, string | null>>({
    manga: null,
    doujinshi: null,
  });
  let historyLoading = $state(false);
  let historyRequestToken = 0;
  let activeTab = $state<"queue" | "history">("queue");
  let activeMenuId = $state<number | null>(null);
  let isSearching = $state(false);
  let mode = $state<"doujinshi" | "manga">("manga");
  const isReaderWindow =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("view") === "reader";
  let lastHandledDownloaderNavigationRequestId = $state(0);
  let sourceBadgeLookup = new Map<string, SourceBadge>();

  type QueueLikeItem =
    | DownloaderQueueItem
    | MangaQueueItem
    | DownloadHistoryEntry;

  function getHistoryScope(): DownloaderHistoryScope {
    return mode === "manga" ? "manga" : "doujinshi";
  }

  function isMangaItem(item: QueueLikeItem) {
    const itemType = "type" in item ? item.type : undefined;
    return itemType === "manga";
  }

  // Derived filtered lists
  const filteredQueue = $derived(
    (mode === "manga" ? mangaQueue : queue).filter((item) =>
      mode === "manga" ? isMangaItem(item) : !isMangaItem(item),
    ),
  );
  const currentHistoryScope = $derived(getHistoryScope());
  const currentHistory = $derived(historyByScope[currentHistoryScope] ?? []);
  const currentHistoryLoaded = $derived(
    Boolean(historyLoadedByScope[currentHistoryScope]),
  );
  const currentHistoryError = $derived(
    historyErrorByScope[currentHistoryScope] ?? null,
  );
  const shouldShowHistoryLoading = $derived(
    activeTab === "history" &&
      historyLoading &&
      !currentHistoryLoaded &&
      currentHistory.length === 0,
  );

  // Manga Integration
  let selectedManga = $state<any>(null);
  let contentScrollEl: HTMLDivElement | null = null;
  let doujinshiScrollTop = $state(0);
  let mangaBrowserScrollTop = $state(0);
  let metadataBrowserRef = $state<any>(null);
  let mangaSeriesViewRef = $state<any>(null);
  type MangaSelectionRestoreMode = "top" | "restore";
  type MangaNavEntry = {
    selection: any | null;
    historyRestoreMode: MangaSelectionRestoreMode;
  };
  let mangaNavStack = $state<MangaNavEntry[]>([
    { selection: null, historyRestoreMode: "top" },
  ]);
  let mangaNavIndex = $state(0);
  const mangaSeriesScrollTopByKey = new Map<string, number>();
  let mangaScrollRestoreSequence = 0;
  let isRestoringMangaView = $state(false);

  function getMangaNavKey(selection: any | null) {
    if (!selection) return "";
    const id = String(selection?.id || "").trim();
    const sourceUrl = String(selection?.source_url || "").trim();
    const title = String(selection?.title || "").trim();
    return `${id}|${sourceUrl}|${title}`;
  }

  function createMangaNavEntry(
    selection: any | null,
    historyRestoreMode: MangaSelectionRestoreMode,
  ): MangaNavEntry {
    return {
      selection,
      historyRestoreMode,
    };
  }

  function getCurrentMangaNavEntry() {
    return mangaNavStack[mangaNavIndex] ?? createMangaNavEntry(null, "top");
  }

  function getCurrentMangaNavKey() {
    return getMangaNavKey(selectedManga);
  }

  function persistCurrentContentScroll() {
    if (mode !== "manga") return;
    if (!contentScrollEl) return;
    const currentScrollTop = Math.max(
      0,
      Number(contentScrollEl.scrollTop || 0),
    );
    const currentNavKey = getCurrentMangaNavKey();
    if (currentNavKey) {
      mangaSeriesScrollTopByKey.set(currentNavKey, currentScrollTop);
      return;
    }
    mangaBrowserScrollTop = currentScrollTop;
  }

  function scheduleMangaScrollRestore(
    expectedNavKey: string,
    targetScrollTop: number,
  ) {
    const runSequence = ++mangaScrollRestoreSequence;
    const clampedTarget = Math.max(0, Number(targetScrollTop || 0));
    let attempts = 24;

    return new Promise<void>((resolve) => {
      const finish = () => resolve();

      const run = () => {
        if (runSequence !== mangaScrollRestoreSequence) {
          finish();
          return;
        }
        if (mode !== "manga") {
          finish();
          return;
        }
        if (getCurrentMangaNavKey() !== expectedNavKey) {
          finish();
          return;
        }

        const scrollHost = contentScrollEl;
        if (!scrollHost) {
          if (attempts-- > 0) {
            requestAnimationFrame(run);
            return;
          }
          finish();
          return;
        }

        if (Math.abs(scrollHost.scrollTop - clampedTarget) > 1) {
          const previousBehavior = scrollHost.style.scrollBehavior;
          scrollHost.style.scrollBehavior = "auto";
          scrollHost.scrollTop = clampedTarget;
          requestAnimationFrame(() => {
            scrollHost.style.scrollBehavior = previousBehavior;
          });
        }

        if (
          Math.abs(scrollHost.scrollTop - clampedTarget) > 1 &&
          attempts-- > 0
        ) {
          requestAnimationFrame(run);
          return;
        }

        finish();
      };

      tick().then(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(run);
        });
      });
    });
  }

  async function applyMangaSelection(
    selection: any | null,
    restoreMode: MangaSelectionRestoreMode = "restore",
    forceHideDuringRestore = false,
  ) {
    const targetNavKey = getMangaNavKey(selection);
    const savedScrollTop =
      targetNavKey && restoreMode === "restore"
        ? (mangaSeriesScrollTopByKey.get(targetNavKey) ?? 0)
        : 0;
    const shouldHideForRestore =
      forceHideDuringRestore ||
      (Boolean(targetNavKey) && savedScrollTop > 0);

    isRestoringMangaView = shouldHideForRestore;
    selectedManga = selection;
    await tick();

    if (targetNavKey) {
      if (shouldHideForRestore && contentScrollEl) {
        const previousBehavior = contentScrollEl.style.scrollBehavior;
        contentScrollEl.style.scrollBehavior = "auto";
        contentScrollEl.scrollTop = Math.max(0, Number(savedScrollTop || 0));
        requestAnimationFrame(() => {
          if (contentScrollEl) {
            contentScrollEl.style.scrollBehavior = previousBehavior;
          }
        });
      }

      const restorePromise = scheduleMangaScrollRestore(
        targetNavKey,
        savedScrollTop,
      );
      if (shouldHideForRestore) {
        if (forceHideDuringRestore) {
          await restorePromise;
        } else {
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
          });
        }
      }

      isRestoringMangaView = false;
      return;
    }

    scheduleMangaScrollRestore("", mangaBrowserScrollTop);
    isRestoringMangaView = false;
  }

  async function pushMangaNavigation(
    selection: any | null,
    restoreMode: MangaSelectionRestoreMode = "restore",
    persistCurrentScroll = true,
  ) {
    if (persistCurrentScroll) {
      persistCurrentContentScroll();
    }
    const currentEntry = getCurrentMangaNavEntry();
    if (getMangaNavKey(currentEntry.selection) === getMangaNavKey(selection)) {
      if (currentEntry.selection && restoreMode === "restore") {
        const updatedStack = [...mangaNavStack];
        updatedStack[mangaNavIndex] = createMangaNavEntry(
          currentEntry.selection,
          "restore",
        );
        mangaNavStack = updatedStack;
      }
      await applyMangaSelection(selection, restoreMode);
      return;
    }

    const nextStack = mangaNavStack.slice(0, mangaNavIndex + 1);
    if (restoreMode === "restore" && currentEntry.selection) {
      nextStack[mangaNavIndex] = createMangaNavEntry(
        currentEntry.selection,
        "restore",
      );
    }
    nextStack.push(createMangaNavEntry(selection, restoreMode));
    mangaNavStack = nextStack;
    mangaNavIndex = nextStack.length - 1;
    await applyMangaSelection(selection, restoreMode);
  }

  async function navigateMangaSelection(direction: -1 | 1) {
    persistCurrentContentScroll();
    const nextIndex = mangaNavIndex + direction;
    if (nextIndex < 0 || nextIndex >= mangaNavStack.length) return false;
    mangaNavIndex = nextIndex;
    const nextEntry =
      mangaNavStack[nextIndex] ?? createMangaNavEntry(null, "top");
    await applyMangaSelection(
      nextEntry.selection,
      nextEntry.historyRestoreMode,
    );
    return true;
  }

  async function switchActiveTab(nextTab: "queue" | "history") {
    if (activeTab === nextTab) return;

    const preservedScrollTop = contentScrollEl?.scrollTop ?? null;
    activeTab = nextTab;
    await tick();
    if (activeTab !== nextTab) return;
    if (preservedScrollTop !== null && contentScrollEl) {
      contentScrollEl.scrollTop = preservedScrollTop;
    }
  }

  async function handleSelectMangaFromBrowser(manga: any) {
    await pushMangaNavigation(manga, "top");
  }

  async function handleSelectRecommendedManga(manga: any) {
    await pushMangaNavigation(manga, "restore");
  }

  async function handleModeSwitch(nextMode: "manga" | "doujinshi") {
    if (mode === nextMode) return;
    const shouldForceHideSelectedMangaOnEntry =
      nextMode === "manga" && Boolean(selectedManga);
    if (mode === "manga") {
      persistCurrentContentScroll();
    } else if (contentScrollEl) {
      doujinshiScrollTop = Math.max(0, Number(contentScrollEl.scrollTop || 0));
    }
    if (nextMode !== "manga") {
      mangaScrollRestoreSequence += 1;
      isRestoringMangaView = false;
    }

    if (shouldForceHideSelectedMangaOnEntry) {
      isRestoringMangaView = true;
    }
    mode = nextMode;

    if (nextMode !== "manga") {
      await tick();
      if (contentScrollEl) {
        const previousBehavior = contentScrollEl.style.scrollBehavior;
        contentScrollEl.style.scrollBehavior = "auto";
        contentScrollEl.scrollTop = doujinshiScrollTop;
        requestAnimationFrame(() => {
          if (contentScrollEl) {
            contentScrollEl.style.scrollBehavior = previousBehavior;
          }
        });
      }
      return;
    }
    await applyMangaSelection(
      selectedManga,
      "restore",
      shouldForceHideSelectedMangaOnEntry,
    );
  }

  async function handleBackToBrowser() {
    await pushMangaNavigation(null);
  }

  function handleMangaDownloadQueued() {
    void switchActiveTab("queue");
  }

  async function handleMouseSideNavigation(e: MouseEvent) {
    if ($appState.currentView !== "downloader" || mode !== "manga") return;

    if (e.button === 3) {
      if (mangaNavIndex > 0) {
        e.preventDefault();
        e.stopPropagation();
        await navigateMangaSelection(-1);
      }
      return;
    }

    if (e.button === 4) {
      if (mangaNavIndex < mangaNavStack.length - 1) {
        e.preventDefault();
        e.stopPropagation();
        await navigateMangaSelection(1);
      }
    }
  }

  $effect(() => {
    if (mode !== "manga") return;
    if (mangaNavStack.length > 0) return;

    const initial = selectedManga || null;
    mangaNavStack = [createMangaNavEntry(initial, "top")];
    mangaNavIndex = 0;
  });

  async function applyDownloaderNavigation(intent: any) {
    const requestId = Number(intent?.requestId || 0);
    if (!requestId || requestId === lastHandledDownloaderNavigationRequestId) {
      return;
    }
    lastHandledDownloaderNavigationRequestId = requestId;

    try {
      const previousMode = mode;
      const requestedMode = String(intent?.mode || "")
        .trim()
        .toLowerCase();
      if (requestedMode === "queue" || requestedMode === "history") {
        activeTab = requestedMode;
      }
      if (requestedMode === "manga" || requestedMode === "doujinshi") {
        if (requestedMode !== "manga") {
          mangaScrollRestoreSequence += 1;
          isRestoringMangaView = false;
        }
        mode = requestedMode;
      }

      if (requestedMode !== "manga") return;
      const mangaPayload = intent?.manga;
      const sourceId = String(mangaPayload?.sourceId || "").trim();
      const sourceUrl = String(mangaPayload?.sourceUrl || "").trim();
      const displayTitle = String(mangaPayload?.displayTitle || "").trim();
      const title = mangaPayload?.title || {};
      const titleRomaji = String(title?.romaji || "").trim();
      const titleEnglish = String(title?.english || "").trim();
      const titleNative = String(title?.native || "").trim();
      const anilistId = Number(mangaPayload?.id || 0);

      if (anilistId > 0) {
        const nextSelection = {
          id: anilistId,
          title: {
            romaji: titleRomaji || displayTitle || undefined,
            english: titleEnglish || undefined,
            native: titleNative || undefined,
          },
          source_id: sourceId || undefined,
          source_url: sourceUrl || undefined,
        };
        await pushMangaNavigation(
          nextSelection,
          "top",
          previousMode === "manga",
        );
        return;
      }

      await pushMangaNavigation(null, "restore", previousMode === "manga");
      if (displayTitle) {
        toasts.add(
          `Opened manga downloader for "${displayTitle}". Search to continue.`,
          "info",
        );
      }
    } finally {
      clearDownloaderNavigation(requestId);
    }
  }

  $effect(() => {
    const intent = $appState.downloaderNavigation;
    if (!intent) return;
    void applyDownloaderNavigation(intent);
  });

  $effect(() => {
    const scope = getHistoryScope();
    if (historyLoadedByScope[scope]) return;
    if (historyErrorByScope[scope]) return;
    if (historyLoading && historyRequestedScope === scope) return;
    void refreshHistory();
  });

  async function handleGlobalKeydown(e: KeyboardEvent) {
    if (
      (e.key !== "F5" && e.code !== "F5") ||
      $appState.currentView !== "downloader"
    ) {
      return;
    }
    if (mode !== "manga") return;

    e.preventDefault();
    if (selectedManga) {
      await mangaSeriesViewRef?.reloadCurrentSeries?.();
      return;
    }
    await metadataBrowserRef?.reloadCurrentResults?.();
  }

  let unsubscribe: (() => void) | null = null;
  let unsubscribeManga: (() => void) | null = null;
  let unsubscribeToasts: (() => void) | null = null;
  let historyRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  let historyRefreshInFlight = false;
  let historyRefreshQueued = false;
  let lastDoujinshiTerminalFingerprint = "";
  let lastMangaTerminalFingerprint = "";

  const TERMINAL_DOWNLOAD_STATUSES = new Set([
    "completed",
    "failed",
    "cancelled",
  ]);

  function getTerminalFingerprint(
    items: Array<DownloaderQueueItem | MangaQueueItem>,
  ): string {
    return items
      .filter((item) =>
        TERMINAL_DOWNLOAD_STATUSES.has(String(item?.status || "")),
      )
      .map((item) => `${item.id}:${item.status}`)
      .sort()
      .join("|");
  }

  function scheduleHistoryRefresh() {
    if (historyRefreshTimeout) return;
    historyRefreshTimeout = setTimeout(async () => {
      historyRefreshTimeout = null;

      if (historyRefreshInFlight) {
        historyRefreshQueued = true;
        return;
      }

      historyRefreshInFlight = true;
      try {
        await refreshHistory();
      } finally {
        historyRefreshInFlight = false;
        if (historyRefreshQueued) {
          historyRefreshQueued = false;
          scheduleHistoryRefresh();
        }
      }
    }, 250);
  }

  function invalidateHistoryScope(scope: DownloaderHistoryScope) {
    historyLoadedByScope = {
      ...historyLoadedByScope,
      [scope]: false,
    };
    historyErrorByScope = {
      ...historyErrorByScope,
      [scope]: null,
    };
  }

  // --- Methods ---
  async function refreshHistory() {
    const scope = getHistoryScope();
    const requestToken = ++historyRequestToken;
    historyRequestedScope = scope;
    historyErrorByScope = {
      ...historyErrorByScope,
      [scope]: null,
    };
    historyLoading = true;

    try {
      const nextHistory = await window.electronAPI.downloader.getHistory(scope);
      if (requestToken !== historyRequestToken) return;
      if (scope !== getHistoryScope()) return;
      historyByScope = {
        ...historyByScope,
        [scope]: nextHistory,
      };
      historyLoadedByScope = {
        ...historyLoadedByScope,
        [scope]: true,
      };
    } catch (e) {
      if (requestToken !== historyRequestToken) return;
      console.error("Failed to load history:", e);
      historyErrorByScope = {
        ...historyErrorByScope,
        [scope]:
          e instanceof Error && e.message
            ? e.message
            : "Failed to refresh history",
      };
    } finally {
      if (requestToken === historyRequestToken) {
        historyLoading = false;
      }
    }
  }

  async function handleDownload() {
    if (!downloadUrl) return;
    const url = downloadUrl.trim();
    downloadUrl = "";
    isSearching = true;

    try {
      const res = await window.electronAPI.downloader.start(url);
      if (res && !res.success) {
        toasts.add(res.error || "Failed to start download", "error");
      } else {
        toasts.add("Added to download queue", "success");
        activeTab = "queue";
      }
    } catch (e: any) {
      console.error("Failed to start download:", e);
      toasts.add(e.message || "Error starting download", "error");
    } finally {
      isSearching = false;
    }
  }

  async function handleClearHistory() {
    try {
      const scope = getHistoryScope();
      await window.electronAPI.downloader.clearHistory(scope);
      historyByScope = {
        ...historyByScope,
        [scope]: [],
      };
      historyLoadedByScope = {
        ...historyLoadedByScope,
        [scope]: true,
      };
      historyErrorByScope = {
        ...historyErrorByScope,
        [scope]: null,
      };
      await refreshHistory();
      toasts.add("Download history cleared", "success");
    } catch (e) {
      console.error("Failed to clear history:", e);
    }
  }

  async function handleClearFinished() {
    try {
      if (mode === "manga") {
        await window.electronAPI.manga.clearFinished();
      } else {
        await window.electronAPI.downloader.clearFinished();
      }
      toasts.add("Cleared finished downloads from queue", "success");
    } catch (e) {
      console.error("Failed to clear finished:", e);
    }
  }

  async function handleCancelAll() {
    try {
      if (mode === "manga") {
        await window.electronAPI.manga.cancelAll();
      } else {
        await window.electronAPI.downloader.cancelAll();
      }
    } catch (e) {
      console.error("Failed to cancel all:", e);
    }
  }

  async function handleOpenFolder() {
    window.electronAPI.downloader.openFolder();
  }

  function handleCancel(id: number) {
    if (mode === "manga") {
      window.electronAPI.manga.cancelDownload(id);
    } else {
      window.electronAPI.downloader.cancel(id);
    }
  }

  async function handleRetry(id: number) {
    try {
      if (mode === "manga") {
        await window.electronAPI.manga.retryDownload(id);
      } else {
        await window.electronAPI.downloader.retry(id);
      }
      activeTab = "queue";
    } catch (e) {
      console.error("Failed to retry download:", e);
    }
  }

  async function handleRemove(id: number) {
    try {
      const scope = getHistoryScope();
      await window.electronAPI.downloader.removeHistoryItem(scope, id);
      historyByScope = {
        ...historyByScope,
        [scope]: (historyByScope[scope] ?? []).filter((item) => item.id !== id),
      };
      historyLoadedByScope = {
        ...historyLoadedByScope,
        [scope]: true,
      };
      historyErrorByScope = {
        ...historyErrorByScope,
        [scope]: null,
      };
      await refreshHistory();
    } catch (e) {
      console.error("Failed to remove history item:", e);
    }
  }

  async function handleRemoveFromQueue(id: number) {
    try {
      if (mode === "manga") {
        await window.electronAPI.manga.removeFromQueue(id);
      } else {
        await window.electronAPI.downloader.removeFromQueue(id);
      }
    } catch (e) {
      console.error("Failed to remove from queue:", e);
    }
  }

  function getItemSourceBadge(item: QueueLikeItem) {
    return resolveSourceBadge(String(item?.source || ""), sourceBadgeLookup);
  }

  async function loadSourceDescriptors(): Promise<MangaSourceDescriptor[]> {
    try {
      const catalog = await window.electronAPI.manga.getSourceCatalog();
      if (Array.isArray(catalog) && catalog.length > 0) {
        return catalog;
      }
    } catch (e) {
      console.warn(
        "Failed to load source catalog; falling back to enabled sources.",
        e,
      );
    }

    try {
      const enabledSources = await window.electronAPI.manga.getEnabledSources();
      return Array.isArray(enabledSources) ? enabledSources : [];
    } catch (e) {
      console.warn("Failed to load enabled sources for downloader badges.", e);
      return [];
    }
  }

  // --- Lifecycle ---
  onMount(async () => {
    try {
      const [nextQueue, nextMangaQueue, sourceCatalog] = await Promise.all([
        window.electronAPI.downloader.getQueue(),
        window.electronAPI.manga.getDownloadQueue(),
        loadSourceDescriptors(),
      ]);
      queue = nextQueue;
      mangaQueue = nextMangaQueue;
      sourceBadgeLookup = createSourceBadgeLookup(sourceCatalog);
      lastDoujinshiTerminalFingerprint = getTerminalFingerprint(queue);
      lastMangaTerminalFingerprint = getTerminalFingerprint(mangaQueue);
    } catch (e) {
      console.error("Failed initial load:", e);
    }

    unsubscribe = window.electronAPI.downloader.onQueueUpdate(
      (updatedQueue: DownloaderQueueItem[]) => {
        queue = updatedQueue;
        const nextFingerprint = getTerminalFingerprint(updatedQueue);
        if (nextFingerprint !== lastDoujinshiTerminalFingerprint) {
          lastDoujinshiTerminalFingerprint = nextFingerprint;
          invalidateHistoryScope("doujinshi");
          if (getHistoryScope() === "doujinshi") {
            scheduleHistoryRefresh();
          }
        }
      },
    );

    unsubscribeManga = window.electronAPI.manga.onDownloaderProgress(
      (updatedQueue: MangaQueueItem[]) => {
        mangaQueue = updatedQueue;
        const nextFingerprint = getTerminalFingerprint(updatedQueue);
        if (nextFingerprint !== lastMangaTerminalFingerprint) {
          lastMangaTerminalFingerprint = nextFingerprint;
          invalidateHistoryScope("manga");
          if (getHistoryScope() === "manga") {
            scheduleHistoryRefresh();
          }
        }
      },
    );

    unsubscribeToasts = window.electronAPI.downloader.onToast(
      (message: string, type: "success" | "error" | "info") => {
        toasts.add(message, type);
      },
    );
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
    if (unsubscribeManga) unsubscribeManga();
    if (unsubscribeToasts) unsubscribeToasts();
    if (historyRefreshTimeout) {
      clearTimeout(historyRefreshTimeout);
      historyRefreshTimeout = null;
    }
  });
</script>

<svelte:window
  onkeydowncapture={handleGlobalKeydown}
  onmousedowncapture={handleMouseSideNavigation}
/>

<div class="h-full flex flex-col bg-[#030712] text-slate-200">
  <header
    class="h-20 shrink-0 border-b border-slate-800/50 bg-[#030712]/80 backdrop-blur-md px-8 flex items-center justify-between gap-4 z-40"
  >
    <div class="flex items-center gap-4">
      <div class="p-2.5 bg-blue-500/10 rounded-xl border border-blue-500/20">
        <svg
          class="w-6 h-6 text-blue-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
      </div>
      <h1 class="text-2xl font-bold text-white tracking-tight">Downloader</h1>
    </div>

    <!-- Mode Toggle -->
    <div class="flex bg-slate-900/50 p-1 rounded-xl border border-white/5">
      <button
        onclick={() => {
          void handleModeSwitch("manga");
        }}
        class="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-bold transition-all {mode ===
        'manga'
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
          : 'text-slate-400 hover:text-white'}"
      >
        Manga
      </button>
      <button
        onclick={() => {
          void handleModeSwitch("doujinshi");
        }}
        class="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-bold transition-all {mode ===
        'doujinshi'
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
          : 'text-slate-400 hover:text-white'}"
      >
        Doujinshi
      </button>
    </div>

    <div class="flex items-center gap-3">
      <div
        class="flex bg-slate-800/50 p-1 rounded-xl border border-slate-700/50"
      >
        <button
          onclick={() => {
            void switchActiveTab("queue");
          }}
          class="px-4 py-1.5 rounded-lg text-sm font-bold transition-all {activeTab ===
          'queue'
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
            : 'text-slate-400 hover:text-white'}"
        >
          Queue
          {#if filteredQueue.length > 0}
            <span
              class="ml-1.5 px-1.5 py-0.5 rounded-md bg-white/10 text-[10px]"
              >{filteredQueue.length}</span
            >
          {/if}
        </button>
        <button
          onclick={() => {
            void switchActiveTab("history");
          }}
          class="px-4 py-1.5 rounded-lg text-sm font-bold transition-all {activeTab ===
          'history'
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
            : 'text-slate-400 hover:text-white'}"
        >
          History
        </button>
      </div>

      <button
        onclick={handleOpenFolder}
        class="p-2.5 bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 hover:text-white rounded-xl border border-slate-700/50 transition-all active:scale-95"
        title="Open Download Folder"
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
            d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9l-2-2H5a2 2 0 01-2 2v8a2 2 0 012 2z"
          />
        </svg>
      </button>
    </div>
  </header>

  <div
    bind:this={contentScrollEl}
    class="flex-1 overflow-auto p-8 flex flex-col gap-8 w-full {mode ===
    'doujinshi'
      ? 'max-w-6xl mx-auto'
      : ''}"
    use:dragScroll={{ axis: "y" }}
    onscroll={() => {
      activeMenuId = null;
      persistCurrentContentScroll();
    }}
  >
    <!-- Persistent Input Area -->
    <div class="shrink-0 flex flex-col gap-6">
      {#if mode === "doujinshi"}
        <section class="flex flex-col gap-4">
          <div class="relative group">
            <input
              type="text"
              bind:value={downloadUrl}
              placeholder="Paste nhentai, e-hentai, or hitomi URL here..."
              class="w-full pl-6 pr-32 py-5 bg-slate-900/50 border border-slate-700/50 rounded-2xl text-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all duration-300 shadow-xl shadow-black/20"
              onkeydown={(e) => e.key === "Enter" && handleDownload()}
            />
            <button
              onclick={handleDownload}
              disabled={!downloadUrl || isSearching}
              class="absolute right-3 top-1/2 -translate-y-1/2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 transition-all active:scale-95"
            >
              {#if isSearching}
                <div
                  class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"
                ></div>
              {:else}
                Download
              {/if}
            </button>
          </div>
          <div
            class="text-[10px] text-slate-500 px-2 flex gap-4 font-bold uppercase tracking-widest"
          >
            {#each ["Supports nhentai", "E-Hentai / ExHentai", "Hitomi.la"] as site}
              <span class="flex items-center gap-1.5 opacity-60">
                <div class="w-1 h-1 rounded-full bg-slate-600"></div>
                {site}
              </span>
            {/each}
          </div>
        </section>
      {:else}
        <div>
          <div style="display: {selectedManga ? 'none' : 'block'}">
            {#if !isReaderWindow}
              <MetadataBrowser
                bind:this={metadataBrowserRef}
                onSelectManga={handleSelectMangaFromBrowser}
              />
            {/if}
          </div>
          {#if selectedManga}
            <div style:visibility={isRestoringMangaView ? "hidden" : "visible"}>
              <MangaSeriesView
                bind:this={mangaSeriesViewRef}
                manga={selectedManga}
                onBack={handleBackToBrowser}
                onSelectManga={handleSelectRecommendedManga}
                onDownloadQueued={handleMangaDownloadQueued}
              />
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Active List Section -->
    {#if activeTab === "queue"}
      <div
        class="flex-1 flex flex-col gap-4"
        style:visibility={isRestoringMangaView ? "hidden" : "visible"}
      >
        <div class="flex items-center justify-between px-2">
          <h2
            class="text-sm font-bold text-slate-400 uppercase tracking-widest"
          >
            {mode === "manga" ? "Manga" : "Doujinshi"} Queue ({filteredQueue.length})
          </h2>
          {#if filteredQueue.length > 0}
            <div class="flex items-center gap-4">
              {#if filteredQueue.some( (t) => ["pending", "parsing", "downloading", "zipping", "verification"].includes(t.status), )}
                <button
                  class="text-[10px] font-bold text-rose-400 group flex items-center gap-1.5 transition-all hover:text-rose-300 uppercase tracking-widest"
                  onclick={handleCancelAll}
                >
                  Cancel All
                </button>
              {/if}
              <button
                class="text-[10px] font-bold text-slate-500 hover:text-rose-400 transition-colors uppercase tracking-widest"
                onclick={handleClearFinished}
              >
                Clear Finished
              </button>
            </div>
          {/if}
        </div>

        {#if filteredQueue.length === 0}
          <div
            class="flex flex-col items-center justify-center py-20 bg-slate-900/30 rounded-3xl border border-dashed border-slate-800"
          >
            <p class="text-slate-500 font-medium tracking-wide">
              No active {mode} downloads
            </p>
          </div>
        {:else}
          <div class="grid gap-3">
            {#each filteredQueue as item (item.id)}
              <DownloadItem
                {item}
                sourceBadge={getItemSourceBadge(item)}
                onCancel={handleCancel}
                onRetry={handleRetry}
                onRemove={handleRemoveFromQueue}
                isMenuOpen={activeMenuId === item.id}
                onToggleMenu={(open) => (activeMenuId = open ? item.id : null)}
              />
            {/each}
          </div>
        {/if}
      </div>
    {:else if activeTab === "history"}
      <div
        class="flex-1 flex flex-col gap-4"
        style:visibility={isRestoringMangaView ? "hidden" : "visible"}
      >
        <div class="flex items-center justify-between px-2">
          <h2
            class="text-sm font-bold text-slate-400 uppercase tracking-widest"
          >
            {mode === "manga" ? "Manga" : "Doujinshi"} History ({currentHistory.length})
          </h2>
          <button
            class="text-[10px] font-bold text-slate-500 hover:text-rose-400 transition-colors uppercase tracking-widest"
            onclick={handleClearHistory}
          >
            Clear All
          </button>
        </div>

        {#if shouldShowHistoryLoading}
          <div
            class="flex flex-col items-center justify-center py-20 bg-slate-900/30 rounded-3xl border border-dashed border-slate-800"
          >
            <div
              class="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin mb-4"
            ></div>
            <p class="text-slate-500 font-medium tracking-wide">
              Loading {mode} history
            </p>
          </div>
        {:else if currentHistoryError && currentHistory.length === 0}
          <div
            class="flex flex-col items-center justify-center py-20 bg-slate-900/30 rounded-3xl border border-dashed border-slate-800"
          >
            <p class="text-amber-400 font-medium tracking-wide">
              Failed to load {mode} history
            </p>
          </div>
        {:else if currentHistory.length === 0}
          <div
            class="flex flex-col items-center justify-center py-20 bg-slate-900/30 rounded-3xl border border-dashed border-slate-800"
          >
            <p class="text-slate-500 font-medium tracking-wide">
              {mode} history is empty
            </p>
          </div>
        {:else}
          <div class="grid gap-3">
            {#each currentHistory as item (item.id)}
              <DownloadItem
                {item}
                sourceBadge={getItemSourceBadge(item)}
                onCancel={handleCancel}
                onRetry={handleRetry}
                onRemove={handleRemove}
                isMenuOpen={activeMenuId === item.id}
                onToggleMenu={(open) => (activeMenuId = open ? item.id : null)}
              />
            {/each}
          </div>
        {/if}
        {#if currentHistoryError && currentHistory.length > 0}
          <p class="px-2 text-[11px] font-semibold text-amber-400">
            Showing cached history. Refresh failed.
          </p>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  ::-webkit-scrollbar {
    width: 10px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: #1e293b;
    border-radius: 20px;
    border: 3px solid #030712;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: #334155;
  }
</style>
