<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { fade } from "svelte/transition";
  import {
    openBook,
    appState,
    updateLibraryState,
    tryNavigateBackTo,
  } from "../stores/app";
  import { dragScroll } from "../utils/dragScroll";
  import Dialog from "../components/Dialog.svelte";
  import BulkSelection from "../components/BulkSelection.svelte";
  import ArchiveManager from "../components/ArchiveManager.svelte";
  import FolderSwitcher from "../components/FolderSwitcher.svelte";
  import MoveToFolderDialog from "../components/MoveToFolderDialog.svelte";
  import LibraryGridItem from "../components/Library/LibraryGridItem.svelte";
  import LibraryMetadataDialogs from "../components/Library/LibraryMetadataDialogs.svelte";
  import LibraryScanOverlay from "../components/Library/LibraryScanOverlay.svelte";
  import MangaLibraryView from "../components/manga/MangaLibraryView.svelte";
  import { SelectionModel } from "../state/selection.svelte";
  import { toasts } from "../stores/toast";
  import type { LibraryItem } from "../stores/app";
  import type { MangaPreference } from "../utils/manga";
  import type {
    MlvChapterActions,
    MlvSelectionContext,
  } from "../components/manga/library-view/mlv-types";

  interface FolderView {
    id: number | null;
    items: LibraryItem[];
    scrollTop: number;
    title: string;
    renderLimit: number;
  }

  const LANGUAGE_CODES: Record<string, string> = {
    English: "EN",
    Japanese: "JP",
    Korean: "KR",
    Chinese: "CN",
    Spanish: "ES",
  };

  function getLanguageCodes(tagsList: string | undefined): string[] {
    if (!tagsList) return [];
    const tags = tagsList.split(",").map((t) => t.trim());
    const codes: string[] = [];

    for (const tag of tags) {
      if (LANGUAGE_CODES[tag]) {
        codes.push(LANGUAGE_CODES[tag]);
      }
    }
    return codes;
  }

  function selectTextOnFocus(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  let activeNavigationToken = 0;
  let folderViewState = new Map<
    string,
    { scrollTop: number; renderLimit: number }
  >();

  function beginNavigationToken() {
    activeNavigationToken += 1;
    return activeNavigationToken;
  }

  function cancelPendingNavigation() {
    activeNavigationToken += 1;
    loading = false;
    skipItemAnimation = false;
  }

  function getFolderStateKey(
    folderId: number | null,
    root: string = selectedRoot,
  ): string {
    return `${root || "all"}:${folderId?.toString() ?? "root"}`;
  }

  function readFolderViewState(
    folderId: number | null,
    root: string = selectedRoot,
  ): { scrollTop: number; renderLimit: number } {
    const saved = folderViewState.get(getFolderStateKey(folderId, root));
    const scrollTop = Math.max(0, Number(saved?.scrollTop || 0));
    const renderLimit = Math.max(50, Number(saved?.renderLimit || 50));
    return { scrollTop, renderLimit };
  }

  function writeFolderViewState(
    folderId: number | null,
    scrollTop: number,
    renderLimitValue: number,
    root: string = selectedRoot,
  ) {
    folderViewState.set(getFolderStateKey(folderId, root), {
      scrollTop: Math.max(0, Number(scrollTop || 0)),
      renderLimit: Math.max(50, Number(renderLimitValue || 50)),
    });
  }

  let scrollRestoreSequence = 0;

  function scheduleActiveScrollRestore(
    expectedFolderId: number | null,
    targetScrollTop: number,
  ) {
    const runSequence = ++scrollRestoreSequence;
    const clampedTarget = Math.max(0, Number(targetScrollTop || 0));
    let attempts = 24;

    const run = () => {
      if (runSequence !== scrollRestoreSequence) return;
      const current = viewStack[activeIndex];
      if (!current || current.id !== expectedFolderId) return;

      const activeViewEl = document.querySelector(
        '[data-stack-view="true"][data-active-view="true"]',
      ) as HTMLElement | null;
      if (!activeViewEl) {
        if (attempts-- > 0) requestAnimationFrame(run);
        return;
      }

      if (Math.abs(activeViewEl.scrollTop - clampedTarget) > 1) {
        const prevBehavior = activeViewEl.style.scrollBehavior;
        activeViewEl.style.scrollBehavior = "auto";
        activeViewEl.scrollTop = clampedTarget;
        requestAnimationFrame(() => {
          activeViewEl.style.scrollBehavior = prevBehavior;
        });
      }

      if (Math.abs(activeViewEl.scrollTop - clampedTarget) > 1 && attempts-- > 0) {
        requestAnimationFrame(run);
      }
    };

    tick().then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(run);
      });
    });
  }

  function persistActiveViewScroll() {
    if (activeIndex < 0 || !viewStack[activeIndex]) return;
    const activeViewEl = document.querySelector(
      '[data-stack-view="true"][data-active-view="true"]',
    ) as HTMLElement | null;
    if (!activeViewEl) return;
    const activeView = viewStack[activeIndex];
    activeView.scrollTop = activeViewEl.scrollTop;
    activeView.renderLimit = renderLimit;
    writeFolderViewState(activeView.id, activeView.scrollTop, activeView.renderLimit);
    viewStack = viewStack;
  }

  let viewStack = $state<FolderView[]>([]);
  let activeIndex = $derived(Math.max(0, viewStack.length - 1));

  let currentView = $derived(
    viewStack[activeIndex] || {
      id: null,
      items: [],
      scrollTop: 0,
      title: "Library",
      renderLimit: 50,
    },
  );

  let items = $derived(
    [...currentView.items].sort((a, b) => {
      // 1. Folders first
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      // 2. Natural sort
      return a.title.localeCompare(b.title, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }),
  );

  let currentFolderId = $derived(currentView.id);
  let currentFolderMeta = $state<LibraryItem | null>(null);
  let currentFolderMetaRequestId = 0;
  let historyFolderResolveRequestId = 0;
  let blockedHistoryFolderId: number | null = null;

  // Sync state for breadcrumbs
  $effect(() => {
    updateLibraryState({
      currentFolderId: currentFolderId,
      folderPath: viewStack
        .slice(1)
        .map((v) => ({ title: v.title, id: v.id! }) as any),
    });
  });

  $effect(() => {
    const folderId = currentFolderId;
    const requestId = ++currentFolderMetaRequestId;

    if (folderId === null) {
      currentFolderMeta = null;
      return;
    }

    const parentItems =
      activeIndex > 0 && viewStack[activeIndex - 1]
        ? viewStack[activeIndex - 1].items
        : [];
    const folderFromParent = parentItems.find((item) => item.id === folderId);
    if (folderFromParent) {
      currentFolderMeta = folderFromParent;
      return;
    }

    currentFolderMeta = null;
    window.electronAPI.library
      .getItem(folderId)
      .then((item) => {
        if (requestId !== currentFolderMetaRequestId) return;
        currentFolderMeta = item ?? null;
      })
      .catch(() => {
        if (requestId !== currentFolderMetaRequestId) return;
        currentFolderMeta = null;
      });
  });

  // Watch for external folder changes (e.g. from history navigation)
  $effect(() => {
    const desiredFolderId = $appState.libraryState.currentFolderId;
    if (desiredFolderId === currentFolderId) {
      blockedHistoryFolderId = null;
      return;
    }
    if (
      blockedHistoryFolderId !== null &&
      desiredFolderId === blockedHistoryFolderId
    ) {
      return;
    }
    // If the state dictates a folder different from what we are showing
    cancelPendingNavigation();
    persistActiveViewScroll();
    // If we are just moving back up the stack (parent)
    const parentView = viewStack[viewStack.length - 2];
    if (parentView && parentView.id === desiredFolderId) {
      blockedHistoryFolderId = null;
      viewStack.pop();
      viewStack = viewStack;
      if (!searchQuery.trim()) {
        renderLimit = Number(parentView.renderLimit || 50);
      }
      scheduleActiveScrollRestore(parentView.id, parentView.scrollTop);
      return;
    }

    // History jump: slice stack if found, else open folder.
    const foundIndex = viewStack.findIndex((v) => v.id === desiredFolderId);
    if (foundIndex !== -1) {
      blockedHistoryFolderId = null;
      viewStack = viewStack.slice(0, foundIndex + 1);
      const targetView = viewStack[viewStack.length - 1];
      if (targetView) {
        if (!searchQuery.trim()) {
          renderLimit = Number(targetView.renderLimit || 50);
        }
        scheduleActiveScrollRestore(targetView.id, targetView.scrollTop);
      }
      return;
    }

    // Forward nav: find folder info in current items to open.
    const childFolder =
      activeIndex >= 0
        ? viewStack[activeIndex].items.find((i) => i.id === desiredFolderId)
        : null;
    if (childFolder) {
      blockedHistoryFolderId = null;
      openFolder(childFolder.id, childFolder.title);
      return;
    }

    const requestedFolderId = Number(desiredFolderId || 0);
    if (!Number.isFinite(requestedFolderId) || requestedFolderId <= 0) {
      blockedHistoryFolderId = requestedFolderId > 0 ? requestedFolderId : null;
      return;
    }

    const requestedRoot = selectedRoot;
    const resolveRequestId = ++historyFolderResolveRequestId;
    window.electronAPI.library
      .getItem(requestedFolderId)
      .then((resolvedFolder) => {
        if (resolveRequestId !== historyFolderResolveRequestId) return;
        if ($appState.currentView !== "library") return;
        if ($appState.libraryState.currentFolderId !== requestedFolderId) return;
        if (selectedRoot !== requestedRoot) return;
        if (!resolvedFolder || resolvedFolder.type !== "folder") {
          blockedHistoryFolderId = requestedFolderId;
          console.warn(
            `[Library] Ignoring invalid history folder target id=${requestedFolderId}`,
          );
          return;
        }
        if (requestedRoot && !isPathInRoot(resolvedFolder.path, requestedRoot)) {
          blockedHistoryFolderId = requestedFolderId;
          console.warn(
            `[Library] Ignoring history folder outside selected root id=${requestedFolderId} root=${requestedRoot}`,
          );
          return;
        }
        blockedHistoryFolderId = null;
        openFolder(resolvedFolder.id, resolvedFolder.title || "Folder");
      })
      .catch(() => {
        if (resolveRequestId !== historyFolderResolveRequestId) return;
        blockedHistoryFolderId = requestedFolderId;
      });
  });

  let itemsCache = new Map<string, LibraryItem[]>();
  let loading = $state(false);

  function getCacheKey(folderId: number | null): string {
    return `${selectedRoot || "all"}:${folderId?.toString() ?? "root"}`;
  }

  function normalizeComparablePath(value: string): string {
    return String(value || "")
      .replace(/\\/g, "/")
      .toLowerCase();
  }

  function isPathInRoot(itemPath: string, rootPath: string): boolean {
    const normalizedItem = normalizeComparablePath(itemPath);
    const normalizedRoot = normalizeComparablePath(rootPath);
    if (!normalizedRoot) return true;
    return (
      normalizedItem === normalizedRoot ||
      normalizedItem.startsWith(`${normalizedRoot}/`)
    );
  }

  function parseCacheKey(key: string): {
    root: string;
    folderId: number | null;
  } {
    const splitAt = key.lastIndexOf(":");
    if (splitAt < 0) return { root: "all", folderId: null };
    const root = key.slice(0, splitAt) || "all";
    const folderPart = key.slice(splitAt + 1);
    return {
      root,
      folderId: folderPart === "root" ? null : Number.parseInt(folderPart, 10),
    };
  }

  function getMangaSeriesId(item: LibraryItem): number {
    const value = Number(item?.manga_series_id || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function getCoverSrc(
    item: Pick<LibraryItem, "cover_path" | "_coverVersion">,
  ): string | null {
    const rawPath = String(item?.cover_path || "").trim();
    if (!rawPath) return null;
    const base = `media:///${rawPath.replace(/\\/g, "/")}`;
    const coverVersion = Number(item?._coverVersion || 0);
    return coverVersion > 0 ? `${base}?v=${coverVersion}` : base;
  }

  const COVER_PRELOAD_IMAGE_TIMEOUT_MS = 180;
  const COVER_PRELOAD_TOTAL_BUDGET_MS = 320;

  function preloadImageWithTimeout(src: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const img = new Image();
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        img.onload = null;
        img.onerror = null;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        resolve();
      };

      img.onload = finish;
      img.onerror = finish;
      timer = setTimeout(finish, COVER_PRELOAD_IMAGE_TIMEOUT_MS);
      img.src = src;
    });
  }

  function getCoverPreloadCount(): number {
    if (gridSize === "small") return 30;
    if (gridSize === "large") return 14;
    return 22;
  }

  async function preloadFolderCovers(folderItems: LibraryItem[]): Promise<void> {
    const sources = folderItems
      .slice(0, getCoverPreloadCount())
      .map((item) => getCoverSrc(item))
      .filter((src): src is string => Boolean(src));
    if (!sources.length) return;

    const preloadAll = Promise.all(sources.map((src) => preloadImageWithTimeout(src)));
    await Promise.race([
      preloadAll,
      new Promise<void>((resolve) =>
        setTimeout(resolve, COVER_PRELOAD_TOTAL_BUDGET_MS),
      ),
    ]);
  }

  function releaseSkipItemAnimation() {
    tick().then(() => {
      requestAnimationFrame(() => {
        skipItemAnimation = false;
      });
    });
  }

  let searchQuery = $state("");
  let searchResults = $state<LibraryItem[]>([]); // New state for global results
  let isSearching = $state(false);

  const selection = new SelectionModel();
  let lastSelectedId = $state<number | null>(null);
  let gridSize = $state<"small" | "medium" | "large">(
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem("libraryGridSize") as any)) ||
      "medium",
  );
  let itemCountHovered = $state(false);
  let totalLibraryBooks = $state(0);

  // Pagination/Incremental Rendering
  let renderLimit = $state(50);
  let loaderRef = $state<HTMLElement | null>(null);

  let blurR18 = $state(false);
  let blurR18Hover = $state(false);
  let blurR18Intensity = $state(12);

  let lastResetFolderId = $state<number | null>(null);
  let lastResetSearchQuery = $state("");
  let hasInitializedRootView = $state(false);

  let selectedRoot = $state(localStorage.getItem("librarySelectedRoot") || "");
  let librarySortOrder = $state<"alphabetical" | "imported">("alphabetical");
  let skipItemAnimation = $state(false);
  let mangaSeriesViewDisabled = $state(
    localStorage.getItem("mangaSeriesViewDisabled") === "true",
  );
  const mangaSeriesIdsInCurrentFolder = $derived.by(() => {
    const ids = currentView.items
      .map((item) => getMangaSeriesId(item))
      .filter((id) => id > 0);
    return Array.from(new Set(ids));
  });
  const inMangaContext = $derived.by(() =>
    Boolean(currentFolderMeta?.manga_preference === "force_manga"),
  );
  const hasDirectLinkedMangaItems = $derived.by(() =>
    currentView.items.some(
      (item) => item.type !== "folder" && getMangaSeriesId(item) > 0,
    ),
  );
  const mangaSeriesViewActive = $derived(
    inMangaContext && !mangaSeriesViewDisabled && hasDirectLinkedMangaItems,
  );
  let lastMangaContainerDebugKey = $state("");
  let menuCloseEpoch = $state(0);
  let mlvVisibleChapterIds = $state<number[]>([]);
  function areSameNumberIds(a: number[], b: number[]) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  const mlvSelectionContext: MlvSelectionContext = {
    selection,
    onVisibleChapterIdsChange: (ids: number[]) => {
      const nextIds = Array.from(
        new Set(
          ids
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      );
      if (areSameNumberIds(nextIds, mlvVisibleChapterIds)) return;
      mlvVisibleChapterIds = nextIds;
    },
  };

  $effect(() => {
    if (!mangaSeriesViewActive && mlvVisibleChapterIds.length > 0) {
      mlvVisibleChapterIds = [];
    }
  });

  $effect(() => {
    const inContext = inMangaContext;
    const hasDirectItems = hasDirectLinkedMangaItems;
    const folderId = currentFolderId;
    const root = selectedRoot;
    if (!inContext || hasDirectItems) return;
    const key = `${String(folderId ?? "root")}::${String(root || "")}`;
    if (key === lastMangaContainerDebugKey) return;
    lastMangaContainerDebugKey = key;
    console.debug(
      `[Library] Manga context container detected; keeping grid view (folderId=${String(folderId)}, root=${String(root || "")})`,
    );
  });

  $effect(() => {
    // Reactive dependency on selectedRoot
    const root = selectedRoot;
    const isFirstRootLoad = !hasInitializedRootView;
    localStorage.setItem("librarySelectedRoot", root);

    // When root changes, reset to the top level of the library
    // Use tick to ensure state is clean before loading
    tick().then(async () => {
      cancelPendingNavigation();
      if (isFirstRootLoad) {
        loading = true;
      }
      itemsCache.clear();

      try {
        // Pre-fetch the new root's items BEFORE clearing the view
        // Using "root" as folderId for openFolder's logic equivalent
        const cacheKey = `${root || "all"}:root`;
        const getItems = window.electronAPI.library.getItems as any;
        const folderItems = await getItems(null, root);
        itemsCache.set(cacheKey, folderItems);
        await preloadFolderCovers(folderItems);
        const rootState = readFolderViewState(null, root);

        // Atomically replace viewStack with new data (no empty state)
        skipItemAnimation = true;
        viewStack = [
          {
            id: null,
            items: folderItems,
            scrollTop: rootState.scrollTop,
            title: "Library",
            renderLimit: rootState.renderLimit,
          },
        ];
        // Reset animation suppression after first paint
        releaseSkipItemAnimation();
      } catch (e) {
        console.error("Failed to switch library root", e);
        // Fallback to standard open if pre-fetch fails
        viewStack = [];
        await openFolder(null, "Library", false);
      } finally {
        if (isFirstRootLoad) {
          loading = false;
          hasInitializedRootView = true;
        }
      }
      refreshGlobalCount();
    });
  });

  $effect(() => {
    localStorage.setItem(
      "mangaSeriesViewDisabled",
      mangaSeriesViewDisabled ? "true" : "false",
    );
  });

  $effect(() => {
    // Only reset limit when intent actually changes
    if (
      currentFolderId !== lastResetFolderId ||
      searchQuery !== lastResetSearchQuery
    ) {
      const savedLimit = Number(currentView?.renderLimit || 0);
      if (searchQuery.trim().length > 0) {
        renderLimit = 50;
      } else {
        renderLimit = savedLimit > 0 ? savedLimit : 50;
      }
      lastResetFolderId = currentFolderId;
      lastResetSearchQuery = searchQuery;
    }
  });

  $effect(() => {
    if (!loaderRef) return;
    // Track dependencies to re-run effect and re-trigger observer when more items are needed
    renderLimit;
    filteredItems.length;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && renderLimit < filteredItems.length) {
          // Incrementally load more items as user scrolls
          const nextLimit = Math.min(renderLimit + 50, filteredItems.length);
          renderLimit = nextLimit;
          if (activeIndex >= 0 && viewStack[activeIndex]) {
            viewStack[activeIndex].renderLimit = nextLimit;
            writeFolderViewState(
              viewStack[activeIndex].id,
              viewStack[activeIndex].scrollTop,
              viewStack[activeIndex].renderLimit,
            );
            viewStack = viewStack;
          }
        }
      },
      { rootMargin: "500px" },
    );
    observer.observe(loaderRef);
    return () => observer.disconnect();
  });

  async function refreshGlobalCount() {
    try {
      totalLibraryBooks = await window.electronAPI.library.getTotalBookCount(
        selectedRoot || undefined,
      );
    } catch (e) {
      console.error("Failed to get global book count", e);
    }
  }

  async function refreshSettings() {
    try {
      const all = await window.electronAPI.settings.getAll();
      if (all) {
        const newBlurR18 = all.blurR18 === "true";
        const newBlurR18Hover = all.blurR18Hover === "true";
        const newBlurR18Intensity = all.blurR18Intensity
          ? parseInt(all.blurR18Intensity)
          : 12;

        // Surgical updates to avoid unnecessary item card re-renders
        if (blurR18 !== newBlurR18) blurR18 = newBlurR18;
        if (blurR18Hover !== newBlurR18Hover) blurR18Hover = newBlurR18Hover;
        if (blurR18Intensity !== newBlurR18Intensity)
          blurR18Intensity = newBlurR18Intensity;

        if (
          all.librarySortOrder === "alphabetical" ||
          all.librarySortOrder === "imported"
        ) {
          librarySortOrder = all.librarySortOrder as any;
        }
      }
    } catch (e) {
      console.error("Failed to refresh settings", e);
    }
  }

  onMount(() => {
    refreshGlobalCount();

    // Fetch persisted settings
    window.electronAPI.settings.get("libraryGridSize").then((val) => {
      if (val && ["small", "medium", "large"].includes(val)) {
        gridSize = val as any;
        localStorage.setItem("libraryGridSize", val);
      }
    });

    refreshSettings();
    loadAvailableTypes();
  });

  $effect(() => {
    if ($appState.currentView === "library") {
      refreshSettings();
    }
  });

  $effect(() => {
    const unsubscribe = window.electronAPI.library.onCleared(async () => {
      try {
        selectedRoot = "";
        itemsCache.clear();
        pendingItems = [];
        realTotalScanned = 0;
        totalScanned = 0;
        lastScannedItem = null;
        lastScannedCover = null;

        viewStack = [];
        updateLibraryState({
          currentFolderId: null,
          folderPath: [],
        });
        await tick();
        await openFolder(null, "Library");
        await refreshGlobalCount();
      } catch (e) {
        console.error(e);
      }
    });

    const unsubscribeDeleted = window.electronAPI.library.onItemsDeleted(
      (ids) => {
        const deletedSet = new Set(ids);
        const filterOut = (list: LibraryItem[]) =>
          list.filter((i) => !deletedSet.has(i.id));

        viewStack = viewStack.map((v) => ({ ...v, items: filterOut(v.items) }));
        itemsCache.forEach((items, key) => {
          itemsCache.set(key, filterOut(items));
        });

        if (searchResults.length > 0) {
          searchResults = filterOut(searchResults);
        }

        refreshGlobalCount();
      },
    );

    const unsubscribeRefreshed = window.electronAPI.library.onRefreshed(() => {
      // Clear cache to force fresh fetch
      itemsCache.clear();
      refreshGlobalCount();
      // Reload all open levels (current + parents) to avoid stale back-navigation.
      refreshOpenViewStack();
    });

    return () => {
      unsubscribe();
      unsubscribeDeleted();
      unsubscribeRefreshed();
    };
  });

  async function openFolder(
    folderId: number | null,
    title: string,
    silent = false,
  ) {
    const navToken = !silent
      ? beginNavigationToken()
      : activeNavigationToken;
    if (!silent) {
      persistActiveViewScroll();
      loading = true;
      // Avoid opacity-based entry animation on navigation; it reads as a flash.
      skipItemAnimation = true;
      // Reset focus to prevent ghost navigation in new view
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
    try {
      // Always fetch fresh if silent (refresh) or if not in cache
      // Include selectedRoot in cache key to avoid cross-root pollution
      const cacheKey = `${selectedRoot || "all"}:${folderId?.toString() ?? "root"}`;
      let folderItems: LibraryItem[] = [];

      if (silent || !itemsCache.has(cacheKey)) {
        const getItems = window.electronAPI.library.getItems as any;
        folderItems = await getItems(folderId, selectedRoot);
        itemsCache.set(cacheKey, folderItems);
      } else {
        folderItems = itemsCache.get(cacheKey)!;
      }
      if (!silent) await preloadFolderCovers(folderItems);
      if (!silent && navToken !== activeNavigationToken) return;
      const savedState = readFolderViewState(folderId);

      // Push new view or update existing if silent
      if (silent) {
        // Update existing view in stack
        const index = viewStack.findIndex((v) => v.id === folderId);
        if (index !== -1) {
          viewStack[index].items = folderItems;
          if (!Number.isFinite(viewStack[index].renderLimit)) {
            viewStack[index].renderLimit = 50;
          }
        } else if (viewStack.length === 0) {
          viewStack = [
            {
              id: folderId,
              items: folderItems,
              scrollTop: savedState.scrollTop,
              title: title,
              renderLimit: savedState.renderLimit,
            },
          ];
        }
      } else {
        viewStack.push({
          id: folderId,
          items: folderItems,
          scrollTop: savedState.scrollTop,
          title: title,
          renderLimit: savedState.renderLimit,
        });
      }

      // Svelte 5 handling of array mutation
      viewStack = viewStack;
      if (!silent) {
        const targetView = viewStack[viewStack.length - 1];
        if (targetView) {
          scheduleActiveScrollRestore(targetView.id, targetView.scrollTop);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent && navToken === activeNavigationToken) {
        loading = false;
        releaseSkipItemAnimation();
      }
    }
  }

  function handleBack() {
    // Always cancel any pending forward/open navigation first.
    // This covers rapid back presses before async openFolder resolves.
    cancelPendingNavigation();

    if (viewStack.length > 1) {
      persistActiveViewScroll();
      const parentView = viewStack[viewStack.length - 2];

      // Try history-aware back navigation to avoid duplicate entries
      const didHistoryBack = tryNavigateBackTo({
        view: "library",
        folderId: parentView.id,
      });

      if (!didHistoryBack) {
        viewStack.pop();
        viewStack = viewStack;
        if (!searchQuery.trim()) {
          renderLimit = Number(parentView.renderLimit || 50);
        }
        scheduleActiveScrollRestore(parentView.id, parentView.scrollTop);
      }
    }
  }

  function navigateToStackIndex(index: number) {
    if (index >= 0 && index < viewStack.length) {
      cancelPendingNavigation();
      persistActiveViewScroll();
      // If navigating to immediate parent, try history back
      if (index === viewStack.length - 2) {
        const didHistoryBack = tryNavigateBackTo({
          view: "library",
          folderId: viewStack[index].id,
        });
        if (didHistoryBack) return;
      }

      viewStack = viewStack.slice(0, index + 1);
      const targetView = viewStack[viewStack.length - 1];
      if (targetView) {
        if (!searchQuery.trim()) {
          renderLimit = Number(targetView.renderLimit || 50);
        }
        scheduleActiveScrollRestore(targetView.id, targetView.scrollTop);
      }
    }
  }

  function handleBackFromMangaSeriesView() {
    if (viewStack.length > 1) {
      handleBack();
      return;
    }
    mangaSeriesViewDisabled = true;
  }

  function handleGlobalKeydown(e: any) {
    if ($appState.currentView !== "library") return;

    // Keyboard Shortcuts
    if (
      (e.ctrlKey || e.metaKey) &&
      e.shiftKey &&
      ((typeof e.key === "string" && e.key.toLowerCase() === "v") ||
        e.code === "KeyV")
    ) {
      e.preventDefault();
      if (mangaSeriesViewActive) {
        mangaSeriesViewDisabled = true;
        return;
      }
      if (!inMangaContext) return;
      mangaSeriesViewDisabled = false;
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      openCreateFolderDialog();
      return;
    }

    if (e.key === "Escape") {
      if (showTagEditor) {
        closeTagEditor();
        return;
      }
      if (showTypeEditor) {
        closeTypeEditor();
        return;
      }

      // Blur focused grid items
      if (document.activeElement?.hasAttribute("data-nav-index")) {
        (document.activeElement as HTMLElement).blur();
      }
    }

    // Global Grid Navigation
    if (e.key.startsWith("Arrow") || e.key === "Enter" || e.key === " ") {
      // If we're typing in search, don't hijack arrows unless specified
      if (e.target instanceof HTMLInputElement) return;

      // 1. Native scroll throttle
      if (e.repeat && (e.key === "ArrowUp" || e.key === "ArrowDown")) return;

      const items = visibleItems;
      if (items.length === 0) return;

      const focusedEl = document.activeElement as HTMLElement;
      let currentIndex = -1;
      let scanSuccess = false;

      // 2. Identify selection
      const activeView = document.querySelector(
        '[data-active-view="true"]',
      ) as HTMLElement;
      if (
        focusedEl?.hasAttribute("data-nav-index") &&
        activeView &&
        activeView.contains(focusedEl)
      ) {
        const containerRect = activeView.getBoundingClientRect();
        const itemRect = focusedEl.getBoundingClientRect();

        const isVisible =
          itemRect.bottom > containerRect.top &&
          itemRect.top < containerRect.bottom;
        const isHorizontalRepetition =
          e.repeat && (e.key === "ArrowLeft" || e.key === "ArrowRight");

        if (isHorizontalRepetition || isVisible) {
          currentIndex = parseInt(
            focusedEl.getAttribute("data-nav-index") || "-1",
          );
        } else {
          // 3. Recovery logic
          const viewportCenterY = containerRect.top + containerRect.height / 2;
          const isAtBottom =
            activeView.scrollTop + activeView.clientHeight >=
            activeView.scrollHeight - 50;
          const isAtTop = activeView.scrollTop < 50;

          let probeY = viewportCenterY;
          if (isAtBottom) probeY = containerRect.bottom - 60;
          if (isAtTop) probeY = containerRect.top + 60;

          // a. Entry point
          let probeX;
          if (e.key === "ArrowLeft") {
            probeX = containerRect.right - 40;
          } else if (e.key === "ArrowRight") {
            probeX = containerRect.left + 40;
          } else {
            probeX = itemRect.left + itemRect.width / 2;
            if (probeX < containerRect.left || probeX > containerRect.right) {
              probeX = containerRect.left + containerRect.width / 2;
            }
          }

          // b. Row grouping
          const allVisibleEl = Array.from(
            activeView.querySelectorAll("[data-nav-index]"),
          );
          let anchorItem: {
            index: number;
            top: number;
            bottom: number;
          } | null = null;
          let minDist = Infinity;

          const candidates: { index: number; rect: DOMRect }[] = [];
          for (const el of allVisibleEl) {
            const rect = el.getBoundingClientRect();
            const center = rect.top + rect.height / 2;
            const dist = Math.abs(center - probeY);

            if (dist < minDist) {
              minDist = dist;
              anchorItem = {
                index: parseInt(el.getAttribute("data-nav-index") || "-1"),
                top: rect.top,
                bottom: rect.bottom,
              };
            }
            candidates.push({
              index: parseInt(el.getAttribute("data-nav-index") || "-1"),
              rect,
            });
          }

          let bestRow: { index: number; left: number }[] = [];
          if (anchorItem) {
            const rowThreshold = (anchorItem.bottom - anchorItem.top) * 0.5;
            for (const c of candidates) {
              const overlap =
                Math.min(anchorItem.bottom, c.rect.bottom) -
                Math.max(anchorItem.top, c.rect.top);
              if (overlap > rowThreshold) {
                bestRow.push({ index: c.index, left: c.rect.left });
              }
            }
          }

          if (bestRow && bestRow.length > 0) {
            bestRow.sort((a, b) => a.left - b.left);
            if (e.key === "ArrowLeft") {
              currentIndex = bestRow[bestRow.length - 1].index;
            } else if (e.key === "ArrowRight") {
              currentIndex = bestRow[0].index;
            } else {
              const centerIdx = Math.floor((bestRow.length - 1) / 2);
              currentIndex = bestRow[centerIdx].index;
            }
            scanSuccess = true;
          }

          if (!scanSuccess) {
            if (isAtBottom) currentIndex = items.length - 1;
            else currentIndex = 0;
          }
        }
      } else {
        currentIndex = -1;
      }

      let nextIndex = -1;

      // 4. Calculate move
      if (scanSuccess) {
        nextIndex = currentIndex;
      } else {
        if (currentIndex === -1 && items.length > 0) {
          nextIndex = 0;
        } else if (currentIndex !== -1) {
          const cols = calculateGridColumns();
          if (e.key === "ArrowRight") nextIndex = currentIndex + 1;
          else if (e.key === "ArrowLeft") nextIndex = currentIndex - 1;
          else if (e.key === "ArrowDown") nextIndex = currentIndex + cols;
          else if (e.key === "ArrowUp") nextIndex = currentIndex - cols;
        }
      }

      if (currentIndex === -1 && nextIndex === -1 && items.length > 0) {
        nextIndex = 0;
      }

      // 5. Apply move
      if (nextIndex >= 0 && nextIndex < items.length) {
        e.preventDefault();
        const nextEl = activeView?.querySelector(
          `[data-nav-index="${nextIndex}"]`,
        ) as HTMLElement;
        if (nextEl) {
          nextEl.focus({ preventScroll: true });
          nextEl.scrollIntoView({ behavior: "auto", block: "nearest" });
        }
      }
    }
  }

  // Get grid columns based on breakpoints
  function calculateGridColumns() {
    const width = window.innerWidth;
    if (gridSize === "small") {
      if (width >= 1536) return 12;
      if (width >= 1280) return 10;
      if (width >= 1024) return 8;
      if (width >= 768) return 6;
      if (width >= 640) return 4;
      return 3;
    } else if (gridSize === "large") {
      if (width >= 1536) return 6;
      if (width >= 1280) return 5;
      if (width >= 1024) return 4;
      if (width >= 768) return 3;
      return 2;
    } else {
      if (width >= 1536) return 8;
      if (width >= 1280) return 6;
      if (width >= 1024) return 5;
      if (width >= 768) return 4;
      if (width >= 640) return 3;
      return 2;
    }
  }

  function handleItemClick(
    item: LibraryItem,
    event?: MouseEvent | KeyboardEvent,
  ) {
    if (selection.selectionMode || (event && event.ctrlKey)) {
      selection.toggle(item.id, filteredItems, event);
    } else {
      // Double click or Enter to open
      if (
        !event ||
        event.type === "dblclick" ||
        (event instanceof KeyboardEvent && event.key === "Enter")
      ) {
        if (item.type === "folder") {
          openFolder(item.id, item.title);
        } else {
          openBook(item);
        }
      }
    }
  }

  async function handleBulkRefresh(
    action: "favorite" | "delete" | "tags" | "move",
  ) {
    await tick();
    if (action === "delete") {
      const filterOut = (list: LibraryItem[]) =>
        list.filter((i) => !selection.has(i.id));
      viewStack = viewStack.map((v) => ({ ...v, items: filterOut(v.items) }));
      itemsCache.forEach((items, key) => {
        itemsCache.set(key, filterOut(items));
      });
      refreshGlobalCount();
      selection.clear();
    } else if (
      action === "favorite" ||
      action === "tags" ||
      action === "move"
    ) {
      // Batch update all modified items at once to prevent multi-render flash
      const updatedItems = await Promise.all(
        selection.ids.map((id) => window.electronAPI.library.getItem(id)),
      );
      const itemsMap = new Map(
        updatedItems.filter(Boolean).map((i) => [i!.id, i!]),
      );

      const updateList = (list: LibraryItem[]) =>
        list.map((i) =>
          itemsMap.get(i.id) ? { ...i, ...itemsMap.get(i.id) } : i,
        );

      viewStack = viewStack.map((v) => ({ ...v, items: updateList(v.items) }));
      itemsCache.forEach((items, key) => {
        itemsCache.set(key, updateList(items));
      });
      if (searchResults.length > 0) {
        searchResults = updateList(searchResults);
      }
    }
  }

  async function toggleFavorite(item: LibraryItem, event?: MouseEvent) {
    if (event) event.stopPropagation();
    const isFavorite = await window.electronAPI.library.toggleFavorite(item.id);

    const updateList = (list: LibraryItem[]) =>
      list.map((i) =>
        i.id === item.id ? { ...i, is_favorite: isFavorite } : i,
      );

    viewStack = viewStack.map((v) => ({ ...v, items: updateList(v.items) }));
    if (searchResults.length > 0) {
      searchResults = updateList(searchResults);
    }

    itemsCache.forEach((items, key) => {
      itemsCache.set(key, updateList(items));
    });
  }

  async function deleteItem(item: LibraryItem, event?: MouseEvent) {
    event?.stopPropagation();
    pendingDeleteItem = item;
    showDeleteDialog = true;
  }

  let showDeleteDialog = $state(false);
  let pendingDeleteItem = $state<LibraryItem | null>(null);
  let deleteDialogLoading = $state(false);

  let showRenameDialog = $state(false);
  let renameItem = $state<LibraryItem | null>(null);
  let renameValue = $state("");
  let renameLoading = $state(false);
  let renameError = $state("");

  let showTagEditor = $state(false);
  let managingArchiveItem = $state<LibraryItem | null>(null);
  let showMoveDialog = $state(false);
  let itemsToMove = $state<LibraryItem[]>([]);
  let tagEditorItemId = $state<number | null>(null);
  let tagEditorItemTitle = $state<string>("");

  // Type Editor State
  let showTypeEditor = $state(false);
  let typeEditorItemId = $state<number | null>(null);
  let typeEditorItemTitle = $state<string>("");

  // Create Folder State
  let showCreateFolderDialog = $state(false);
  let newFolderName = $state("");
  let createFolderLoading = $state(false);
  let createFolderError = $state("");

  // Filter State
  interface ContentType {
    id: number;
    name: string;
    description: string | null;
  }
  let availableTypes = $state<ContentType[]>([]);
  let selectedTypeIds = $state<number[]>([]);
  let excludedTypeIds = $state<number[]>([]);
  let lastClickTime = $state(0);
  let lastClickedId = $state<number | null>(null);
  let showTypeFilter = $state(false);

  async function loadAvailableTypes() {
    try {
      availableTypes = await window.electronAPI.types.getAll();
    } catch (e) {
      console.error("Failed to load types:", e);
    }
  }

  function toggleTypeFilter(typeId: number) {
    if (selectedTypeIds.includes(typeId)) {
      selectedTypeIds = selectedTypeIds.filter((id) => id !== typeId);
    } else {
      selectedTypeIds = [...selectedTypeIds, typeId];
    }
  }

  // Toggle type inclusion (click) or exclusion (double-click)
  function handleTypeClick(typeId: number) {
    const now = Date.now();
    const isDoubleClick = lastClickedId === typeId && now - lastClickTime < 300;

    if (isDoubleClick) {
      if (excludedTypeIds.includes(typeId)) {
        excludedTypeIds = excludedTypeIds.filter((id) => id !== typeId);
      } else {
        selectedTypeIds = selectedTypeIds.filter((id) => id !== typeId);
        excludedTypeIds = [...excludedTypeIds, typeId];
      }
    } else {
      if (excludedTypeIds.includes(typeId)) {
        excludedTypeIds = excludedTypeIds.filter((id) => id !== typeId);
      } else {
        toggleTypeFilter(typeId);
      }
    }

    lastClickTime = now;
    lastClickedId = typeId;
  }

  function clearTypeFilters() {
    selectedTypeIds = [];
    excludedTypeIds = [];
  }

  const ICONS: Record<string, string> = {
    manga: "📖",
    doujinshi: "📚",
    webtoon: "📱",
    r18: "🔞",
    "image set": "📁",
    "artist cg": "🎨",
  };

  function getIcon(name: string): string {
    return ICONS[name.toLowerCase()] || "📄";
  }

  function openTagEditor(item: LibraryItem, event?: MouseEvent) {
    event?.stopPropagation();
    tagEditorItemId = item.id;
    tagEditorItemTitle = item.title;
    tagEditorItemTitle = item.title;
    showTagEditor = true;
  }

  function openTypeEditor(item: LibraryItem, event?: MouseEvent) {
    event?.stopPropagation();
    typeEditorItemId = item.id;
    typeEditorItemTitle = item.title;
    showTypeEditor = true;
  }

  function closeTypeEditor() {
    showTypeEditor = false;
    typeEditorItemId = null;
  }

  async function handleTypeChange() {
    if (!typeEditorItemId) return;
    try {
      const updatedItem =
        await window.electronAPI.library.getItem(typeEditorItemId);
      if (updatedItem) {
        if (activeIndex >= 0 && viewStack[activeIndex]) {
          viewStack[activeIndex].items = viewStack[activeIndex].items.map(
            (i) => (i.id === updatedItem.id ? { ...i, ...updatedItem } : i),
          );
        }

        const key = getCacheKey(currentFolderId);
        if (itemsCache.has(key)) {
          itemsCache.set(
            key,
            itemsCache
              .get(key)!
              .map((i) =>
                i.id === updatedItem.id ? { ...i, ...updatedItem } : i,
              ),
          );
        }

        if (searchResults.length > 0) {
          searchResults = searchResults.map((i) =>
            i.id === updatedItem.id ? { ...i, ...updatedItem } : i,
          );
        }
      }
    } catch (e) {
      console.error("Failed to refresh item after type change", e);
    }
  }

  async function handleTagChange() {
    if (!tagEditorItemId) return;
    try {
      const updatedItem =
        await window.electronAPI.library.getItem(tagEditorItemId);
      if (updatedItem) {
        if (activeIndex >= 0 && viewStack[activeIndex]) {
          viewStack[activeIndex].items = viewStack[activeIndex].items.map(
            (i) => (i.id === updatedItem.id ? { ...i, ...updatedItem } : i),
          );
        }

        const key = getCacheKey(currentFolderId);
        if (itemsCache.has(key)) {
          itemsCache.set(
            key,
            itemsCache
              .get(key)!
              .map((i) =>
                i.id === updatedItem.id ? { ...i, ...updatedItem } : i,
              ),
          );
        }

        if (searchResults.length > 0) {
          searchResults = searchResults.map((i) =>
            i.id === updatedItem.id ? { ...i, ...updatedItem } : i,
          );
        }
      }
    } catch (e) {
      console.error("Failed to refresh item after tag change", e);
    }
  }

  function closeTagEditor() {
    showTagEditor = false;
    tagEditorItemId = null;
  }

  function openRenameDialog(item: LibraryItem) {
    renameItem = item;
    renameValue = item.title;
    renameError = "";
    showRenameDialog = true;
  }

  async function handleRename() {
    if (!renameItem || !renameValue.trim()) return;
    renameLoading = true;
    renameError = "";

    try {
      const result = await window.electronAPI.library.renameItem(
        renameItem.id,
        renameValue.trim(),
      );

      if (result.success) {
        showRenameDialog = false;
        renameItem = null;
      } else {
        renameError = result.error || "Failed to rename";
      }
    } catch (e: any) {
      renameError = e.message;
    } finally {
      renameLoading = false;
    }
  }

  function openCreateFolderDialog() {
    // Prevent folder creation in "All Collections" if no root is selected
    if (currentFolderId === null && !selectedRoot) {
      toasts.add(
        "Select a library root or navigate into a folder first.",
        "info",
      );
      return;
    }
    newFolderName = "";
    createFolderError = "";
    showCreateFolderDialog = true;
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    createFolderLoading = true;
    createFolderError = "";

    try {
      const result = await window.electronAPI.library.createFolder(
        currentFolderId,
        newFolderName.trim(),
        currentFolderId === null ? selectedRoot : undefined,
      );

      if (result.success) {
        showCreateFolderDialog = false;
        newFolderName = "";
        // Refresh triggers onRefreshed which reloads items
      } else {
        createFolderError = result.error || "Failed to create folder";
      }
    } catch (e: any) {
      createFolderError = e.message;
    } finally {
      createFolderLoading = false;
    }
  }

  function handleShowInFolder(item: LibraryItem) {
    window.electronAPI.library.showInFolder(item.path);
  }

  let activeMenuId = $state<number | null>(null);

  function toggleMenu(id: number, event: MouseEvent) {
    event.stopPropagation();
    if (activeMenuId === id) {
      activeMenuId = null;
    } else {
      activeMenuId = id;
    }
  }

  function closeMenu() {
    activeMenuId = null;
  }

  const mlvChapterActions: MlvChapterActions = {
    editTags: (item) => openTagEditor(item),
    setType: (item) => openTypeEditor(item),
    manageContent: (item) => {
      managingArchiveItem = item;
    },
    moveItem: (item) => {
      itemsToMove = [item];
      showMoveDialog = true;
    },
    rename: (item) => {
      openRenameDialog(item);
    },
    openLocation: (item) => {
      handleShowInFolder(item);
    },
    deleteItem: (item) => deleteItem(item),
  };

  async function refreshCurrentViewSilently() {
    itemsCache.clear();
    await refreshOpenViewStack();
  }

  async function setItemMangaPreference(
    item: LibraryItem,
    preference: MangaPreference,
  ) {
    try {
      const result = await persistItemMangaPreference(item, preference);

      if (!result?.success) {
        toasts.add(
          result?.error || "Failed to update manga preference",
          "error",
        );
        return;
      }

      await refreshCurrentViewSilently();
      if (preference === "force_manga") {
        toasts.add("Folder set as manga", "success");
      } else if (preference === "force_non_manga") {
        toasts.add("Folder set as non-manga", "success");
      } else {
        toasts.add("Manga recognition set to auto", "success");
      }
    } catch (error) {
      console.error("Failed to set manga preference:", error);
      toasts.add("Failed to update manga preference", "error");
    }
  }

  function persistItemMangaPreference(
    item: LibraryItem,
    preference: MangaPreference,
  ) {
    return window.electronAPI.library.setMangaPreference(item.id, preference, {
      recursive: item.type === "folder",
    });
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteItem) return;

    const itemToDelete = pendingDeleteItem;

    deleteDialogLoading = true;
    try {
      await window.electronAPI.library.deleteItem(itemToDelete.id);

      const filterList = (list: LibraryItem[]) =>
        list.filter((i) => i.id !== itemToDelete.id);

      viewStack[activeIndex].items = filterList(viewStack[activeIndex].items);

      const key = getCacheKey(currentFolderId);
      if (itemsCache.has(key)) {
        itemsCache.set(key, filterList(itemsCache.get(key)!));
      }

      if (searchResults.length > 0) {
        searchResults = filterList(searchResults);
      }

      showDeleteDialog = false;
      pendingDeleteItem = null;
      refreshGlobalCount();
    } catch (error) {
      console.error("Failed to delete library item:", error);
      toasts.add(
        "The item could not be moved to the Recycle Bin.",
        "error",
        6000,
      );
    } finally {
      deleteDialogLoading = false;
    }
  }

  function handleCancelDelete() {
    showDeleteDialog = false;
    pendingDeleteItem = null;
  }

  function getStatusColor(status: LibraryItem["reading_status"]) {
    switch (status) {
      case "reading":
        return "bg-blue-500";
      case "read":
        return "bg-green-500";
      default:
        return "bg-gray-500";
    }
  }

  function getBreadcrumbPath(item: LibraryItem): string {
    const normalize = (p: string) => p.replace(/\\/g, "/").toLowerCase();

    // 1. Find the Root Item in current items
    const root = items.find((r) =>
      normalize(item.path).startsWith(normalize(r.path)),
    );

    // Fallback: show immediate parent folder name
    if (!root) {
      return (
        item.path
          .split(/[/\\]/)
          .filter((p: string) => p && !p.includes(":"))
          .slice(-2, -1)[0] || "Unknown"
      );
    }

    // 2. Extract Library Name (parent of Root)
    const rootPathParts = root.path
      .split(/[/\\]/)
      .filter((p) => p && !p.includes(":"));
    const libraryName = rootPathParts[rootPathParts.length - 2]; // "hmco"

    if (item.id === root.id) return libraryName;

    // 3. Construct relative path from Root to Item
    const rel = item.path.slice(root.path.length).replace(/^[/\\]+/, "");
    const segments = rel.split(/[/\\]/);
    const parentSegments = segments.slice(0, -1);

    return [libraryName, root.title, ...parentSegments].join(" / ");
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case "read":
        return "Read";
      case "reading":
        return "Reading";
      default:
        return "Unread";
    }
  }

  // Get grid CSS classes
  function getGridClass(): string {
    switch (gridSize) {
      case "small":
        return "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12";
      case "large":
        return "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";
      default:
        return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8";
    }
  }

  function getReadingProgress(item: LibraryItem): number {
    if (!item.page_count || item.page_count === 0) return 0;
    return Math.round((item.current_page / item.page_count) * 100);
  }

  // Scanning logic (Simplified for stack)
  // ... (Keeping mostly same, just refreshing current view)
  let isScanning = $state(false);
  let lastScannedItem = $state<LibraryItem | null>(null);
  let lastScannedCover = $state<string | null>(null);
  let totalScanned = $state(0);
  let pendingItems: LibraryItem[] = [];
  let realTotalScanned = 0;

  $effect(() => {
    const unsubscribe = window.electronAPI.library.onItemAdded((item) => {
      // Only used for non-scan additions (scan uses scan-progress + refresh at end).
      if (isScanning) return;
      if (selectedRoot && !isPathInRoot(item.path, selectedRoot)) return;

      if (item.parent_id === currentFolderId) {
        pendingItems.push(item);
      }

      // Update local cache to ensure it persists on navigation
      itemsCache.forEach((cachedItems, key) => {
        const { root: cacheRoot, folderId: cacheFolderId } = parseCacheKey(key);
        const rootFilter = cacheRoot === "all" ? "" : cacheRoot;
        if (rootFilter && !isPathInRoot(item.path, rootFilter)) {
          return;
        }

        if (cacheFolderId === item.parent_id) {
          if (!cachedItems.some((i) => i.id === item.id)) {
            itemsCache.set(key, [...cachedItems, item]);
          }
        }
      });
    });

    const unsubscribeUpdated = window.electronAPI.library.onItemUpdated(
      (updatedItem) => {
        const visibleInCurrentRoot =
          !selectedRoot || isPathInRoot(updatedItem.path, selectedRoot);

        viewStack = viewStack.map((v) => {
          const matchesViewRoot =
            !selectedRoot || isPathInRoot(updatedItem.path, selectedRoot);
          const exists = v.items.some((i) => i.id === updatedItem.id);

          if (!matchesViewRoot) {
            if (!exists) return v;
            return {
              ...v,
              items: v.items.filter((i) => i.id !== updatedItem.id),
            };
          }

          if (!exists) {
            if (updatedItem.parent_id === v.id) {
              return { ...v, items: [...v.items, updatedItem] };
            }
            return v;
          }

          if (updatedItem.parent_id !== v.id) {
            return {
              ...v,
              items: v.items.filter((i) => i.id !== updatedItem.id),
            };
          }

          return {
            ...v,
            items: v.items.map((i) =>
              i.id === updatedItem.id ? { ...i, ...updatedItem } : i,
            ),
          };
        });

        itemsCache.forEach((items, key) => {
          const { root: cacheRoot, folderId: cacheFolderId } =
            parseCacheKey(key);
          const rootFilter = cacheRoot === "all" ? "" : cacheRoot;
          const visibleInCacheRoot =
            !rootFilter || isPathInRoot(updatedItem.path, rootFilter);
          const hasItem = items.some((i) => i.id === updatedItem.id);

          if (!visibleInCacheRoot) {
            if (hasItem) {
              itemsCache.set(
                key,
                items.filter((i) => i.id !== updatedItem.id),
              );
            }
            return;
          }

          if (hasItem && updatedItem.parent_id !== cacheFolderId) {
            itemsCache.set(
              key,
              items.filter((i) => i.id !== updatedItem.id),
            );
          } else if (hasItem) {
            itemsCache.set(
              key,
              items.map((i) =>
                i.id === updatedItem.id ? { ...i, ...updatedItem } : i,
              ),
            );
          }
        });

        if (
          visibleInCurrentRoot &&
          (searchResults.length > 0 ||
            (searchQuery.trim() && currentFolderId === null))
        ) {
          // Re-run search to handle potential new matches or removals (150ms debounce for bulk)
          clearTimeout(refreshSearchTimeout);
          refreshSearchTimeout = setTimeout(() => {
            window.electronAPI.library.search(searchQuery).then((results) => {
              if (searchQuery.trim()) {
                searchResults = results;
              }
            });
          }, 150);
        }
      },
    );

    const unsubscribeProgress = window.electronAPI.library.onScanProgress(
      ({ count, item }) => {
        if (!isScanning) return;

        totalScanned = count;
        realTotalScanned = count;

        if (item) {
          lastScannedItem = item;
          if (item.cover_path) {
            lastScannedCover = `media:///${item.cover_path.replace(/\\/g, "/")}`;
          }
        }
      },
    );

    const interval = setInterval(() => {
      if (!isScanning && pendingItems.length > 0) {
        const batch = pendingItems.splice(0, pendingItems.length);
        viewStack[activeIndex].items = [
          ...viewStack[activeIndex].items,
          ...batch,
        ];
      }
    }, 200);
    return () => {
      unsubscribe();
      unsubscribeUpdated();
      unsubscribeProgress();
      clearInterval(interval);
    };
  });

  async function handleAddFolder() {
    const selectedPath = await window.electronAPI.dialog.selectFolder();
    if (selectedPath) {
      isScanning = true;
      totalScanned = 0;
      realTotalScanned = 0;
      lastScannedItem = null;
      lastScannedCover = null;
      pendingItems = [];

      const startedAt = performance.now();
      try {
        await tick();
        await window.electronAPI.library.scan(selectedPath);
      } finally {
        const elapsed = performance.now() - startedAt;
        if (elapsed < 650) {
          await new Promise((resolve) => setTimeout(resolve, 650 - elapsed));
        }

        // Refresh while UI is visible to avoid grid flash during scan teardown
        try {
          pendingItems = [];
          await refreshOpenViewStack();
          await refreshGlobalCount();
        } catch (e) {
          console.error(e);
        }

        isScanning = false;
        await tick();
      }
    }
  }

  async function handleRescan() {
    isScanning = true;
    totalScanned = 0;
    realTotalScanned = 0;
    lastScannedItem = null;
    lastScannedCover = null;
    pendingItems = [];

    const startedAt = performance.now();
    try {
      await tick();
      await window.electronAPI.library.rescan();
    } finally {
      const elapsed = performance.now() - startedAt;
      if (elapsed < 650) {
        await new Promise((resolve) => setTimeout(resolve, 650 - elapsed));
      }

      // Refresh while scan UI is visible
      try {
        pendingItems = [];
        await refreshOpenViewStack();
        await refreshGlobalCount();
      } catch (e) {
        console.error(e);
      }

      isScanning = false;
      await tick();
    }
  }

  async function refreshOpenViewStack() {
    const snapshot = [...viewStack];
    if (snapshot.length === 0) {
      await openFolder(null, "Library", true);
      return;
    }

    const getItems = window.electronAPI.library.getItems as any;
    const refreshed = await Promise.all(
      snapshot.map(async (view) => {
        const nextItems = await getItems(view.id, selectedRoot);
        return { ...view, items: nextItems };
      }),
    );

    viewStack = refreshed;
    for (const view of refreshed) {
      itemsCache.set(getCacheKey(view.id), view.items);
    }
  }

  // Debounced search effect
  let searchTimeout: ReturnType<typeof setTimeout>;
  let refreshSearchTimeout: ReturnType<typeof setTimeout>;
  // Combined search params for reactive effect
  let searchParamsForEffect = $derived({
    q: searchQuery,
    f: currentFolderId,
    r: selectedRoot,
  });

  $effect(() => {
    const { q, f, r } = searchParamsForEffect;

    if (q.trim()) {
      clearTimeout(searchTimeout);

      // Use shorter delay if ONLY navigation changed
      const isNavOnly = untrack(() => lastProcessedQuery) === q;
      const delay = isNavOnly ? 50 : 300;
      lastProcessedQuery = q;

      searchTimeout = setTimeout(async () => {
        isSearching = true;
        try {
          const results = await window.electronAPI.library.search(q, {
            folderId: f,
            root: f ? undefined : r,
          });
          if (q === searchQuery) {
            searchResults = results;
          }
        } finally {
          isSearching = false;
        }
      }, delay);
    } else {
      searchResults = [];
      showSearchSuggestions = false;
      lastProcessedQuery = "";
    }
  });

  let lastProcessedQuery = "";

  let showSearchSuggestions = $state(false);
  let searchSuggestions = $state<any[]>([]);
  let searchInputRef = $state<HTMLInputElement | null>(null);

  const TAG_MARKER = "\u200B";

  let autocompleteTimeout: ReturnType<typeof setTimeout>;

  let searchRequestId = 0;

  async function handleSearchInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    searchQuery = val;

    // Increment ID to prevent race conditions
    searchRequestId++;
    const currentRequestId = searchRequestId;

    clearTimeout(autocompleteTimeout);
    autocompleteTimeout = setTimeout(async () => {
      const terms = val.split(/,\s*/);
      const currentTerm = terms[terms.length - 1].trim();

      if (currentTerm.length > 0 && currentTerm !== "-") {
        let cleanTerm = currentTerm.replaceAll(TAG_MARKER, "");
        if (cleanTerm.startsWith("-")) cleanTerm = cleanTerm.slice(1);

        const tags = await window.electronAPI.tags.search(cleanTerm);

        // Ensure response matches latest request
        if (searchRequestId === currentRequestId) {
          searchSuggestions = tags;
          showSearchSuggestions = tags.length > 0;
          selectedSearchIndex = -1;
        }
      } else {
        if (searchRequestId === currentRequestId) {
          searchSuggestions = [];
          showSearchSuggestions = false;
        }
      }
    }, 100);
  }

  function applySuggestion(tag: any) {
    const terms = searchQuery.split(",");
    const currentTerm = terms.pop()?.trim() || "";
    const isExclusion = currentTerm.startsWith("-");

    // Invisible marker for tag
    const prefix = isExclusion ? `-${TAG_MARKER}` : TAG_MARKER;

    terms.push(prefix + tag.name);
    searchQuery = terms.join(", ") + ", ";
    showSearchSuggestions = false;
    searchInputRef?.focus();
  }

  let selectedSearchIndex = $state(-1);

  function handleSearchKeydown(e: KeyboardEvent) {
    if (!showSearchSuggestions || searchSuggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (selectedSearchIndex === -1) {
        selectedSearchIndex = 0;
      } else {
        selectedSearchIndex =
          (selectedSearchIndex + 1) % searchSuggestions.length;
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (selectedSearchIndex === -1) {
        selectedSearchIndex = searchSuggestions.length - 1;
      } else {
        selectedSearchIndex =
          (selectedSearchIndex - 1 + searchSuggestions.length) %
          searchSuggestions.length;
      }
    } else if (e.key === "Enter") {
      if (selectedSearchIndex >= 0) {
        e.preventDefault();
        applySuggestion(searchSuggestions[selectedSearchIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      showSearchSuggestions = false;
      selectedSearchIndex = -1;
    }
  }

  let filteredItems = $derived.by(() => {
    if (!searchQuery) return items;

    // Parse terms for robust matching & optimistic filtering
    const terms = searchQuery
      .toLowerCase()
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (terms.length === 0) return items;

    const matchItem = (item: LibraryItem) => {
      // 1. Filter by Selected/Excluded Types
      const itemTypes = item.types_list
        ? item.types_list.split(",").map((t) => t.trim().toLowerCase())
        : [];

      // Exclusion check (priority)
      if (excludedTypeIds.length > 0) {
        const hasExcludedType = excludedTypeIds.some((id) => {
          const type = availableTypes.find((t) => t.id === id);
          return type && itemTypes.includes(type.name.toLowerCase());
        });
        if (hasExcludedType) return false;
      }

      // Inclusion check
      if (selectedTypeIds.length > 0) {
        const hasSelectedType = selectedTypeIds.some((id) => {
          const type = availableTypes.find((t) => t.id === id);
          return type && itemTypes.includes(type.name.toLowerCase());
        });

        if (!hasSelectedType) return false;
      }

      // 2. Filter by Search Query
      if (!searchQuery) return true;

      const title = item.title?.toLowerCase() || "";
      const tagsList = item.tags_list
        ? item.tags_list
            .toLowerCase()
            .split(",")
            .map((t) => t.trim())
        : [];

      return terms.every((term) => {
        // Handle exclusion and invisible tag markers
        const isExclusion = term.startsWith("-");
        let checkTerm = isExclusion ? term.slice(1) : term;

        const isTagSpecific = checkTerm.startsWith(TAG_MARKER);
        if (isTagSpecific) {
          checkTerm = checkTerm.slice(1); // remove ZWSP
          if (!checkTerm) return true;

          const hasTag = tagsList.includes(checkTerm);
          return isExclusion ? !hasTag : hasTag;
        }

        // Standard match: Title OR Tag
        const matches =
          title.includes(checkTerm) || tagsList.includes(checkTerm);
        return isExclusion ? !matches : matches;
      });
    };

    // Filter backend results to hide stale matches (if any from debouncing)
    // and apply type filters which are currently applied client-side.
    return searchResults.filter(matchItem);
  });

  let visibleItems = $derived(filteredItems.slice(0, renderLimit));

  let totalCount = $derived(filteredItems.length);
  let fileCount = $derived(
    filteredItems.filter((i) => {
      // Treat everything that is not explicitly a folder as a file
      return String(i.type).toLowerCase() !== "folder";
    }).length,
  );
  let stabilizedAllIds = $derived(filteredItems.map((i) => i.id));
  let bulkSelectableIds = $derived(
    mangaSeriesViewActive ? mlvVisibleChapterIds : stabilizedAllIds,
  );
  let selectedMangaFolders = $derived(
    filteredItems.filter(
      (item) => item.type === "folder" && selection.has(item.id),
    ),
  );

  async function setSelectedMangaPreference(preference: MangaPreference) {
    const folders = [...selectedMangaFolders];
    if (folders.length === 0) return;

    const outcomes = await Promise.allSettled(
      folders.map((folder) => persistItemMangaPreference(folder, preference)),
    );
    const failedCount = outcomes.filter(
      (outcome) =>
        outcome.status === "rejected" || outcome.value?.success !== true,
    ).length;
    const updatedCount = folders.length - failedCount;

    await refreshCurrentViewSilently();

    if (failedCount > 0) {
      toasts.add(
        updatedCount > 0
          ? `Updated ${updatedCount} of ${folders.length} selected folders`
          : "Failed to update manga recognition",
        "error",
      );
      return;
    }

    const folderLabel = folders.length === 1 ? "folder" : "folders";
    if (preference === "force_manga") {
      toasts.add(`${folders.length} ${folderLabel} set as manga`, "success");
    } else if (preference === "force_non_manga") {
      toasts.add(`${folders.length} ${folderLabel} set as non-manga`, "success");
    } else {
      toasts.add(`${folders.length} ${folderLabel} set to automatic manga recognition`, "success");
    }
  }

  function handleSearchFocus() {
    if (searchQuery.trim().length > 0) {
      const val = searchInputRef?.value || "";
      if (val.trim().length > 0) {
        const terms = val.split(/,\s*/);
        const currentTerm = terms[terms.length - 1].trim();
        if (currentTerm.length > 0 && currentTerm !== "-") {
          let cleanTerm = currentTerm.replace(/\u200B/g, "");
          if (cleanTerm.startsWith("-")) cleanTerm = cleanTerm.slice(1);

          window.electronAPI.tags.search(cleanTerm).then((tags) => {
            searchSuggestions = tags;
            showSearchSuggestions = tags.length > 0;
          });
        }
      }
    }
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as Node;

    // Handle Search Suggestions
    if (showSearchSuggestions) {
      const searchContainer = searchInputRef?.parentElement;
      if (searchContainer && !searchContainer.contains(target)) {
        showSearchSuggestions = false;
      }
    }

    // Handle Type Filter
    if (showTypeFilter) {
      showTypeFilter = false;
    }

    // Handle Active Menu
    if (activeMenuId !== null) {
      activeMenuId = null;
    }
  }

  function handleLibraryMouseButtons(e: MouseEvent) {
    if ($appState.currentView !== "library") return;

    // Cancel a pending folder open before App.svelte handles mouse Back.
    if (e.button === 3) {
      cancelPendingNavigation();
    }

    // Let both side buttons reach App.svelte for chronological history navigation.
    // Parent-folder Back navigation separately collapses skipped visits.
  }
</script>

<svelte:window
  onkeydowncapture={handleGlobalKeydown}
  onmousedowncapture={handleLibraryMouseButtons}
  onclick={handleWindowClick}
/>

<Dialog
  open={showDeleteDialog}
  title={pendingDeleteItem?.type === "folder" ? "Remove Folder" : "Remove File"}
  description={`Are you sure you want to move "${pendingDeleteItem?.title ?? ""}" to the Trash/Recycle Bin?`}
  confirmText="Move to Trash"
  variant="danger"
  loading={deleteDialogLoading}
  onConfirm={handleConfirmDelete}
  onCancel={handleCancelDelete}
/>

<Dialog
  open={showRenameDialog}
  title={renameItem?.type === "folder" ? "Rename Folder" : "Rename File"}
  description={`Enter a new name for "${renameItem?.title ?? ""}".`}
  confirmText="Rename"
  variant="neutral"
  loading={renameLoading}
  onConfirm={handleRename}
  onCancel={() => {
    showRenameDialog = false;
    renameItem = null;
    renameError = "";
  }}
>
  <div class="space-y-4">
    <input
      type="text"
      bind:value={renameValue}
      class="w-full px-4 py-2.5 bg-slate-950/20 border border-slate-700/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/10 transition-[border-color,background-color,ring-color] duration-200"
      placeholder="Enter new name..."
      onkeydown={(e) => e.key === "Enter" && handleRename()}
      use:selectTextOnFocus
    />
    {#if renameError}
      <p class="text-sm text-red-400">{renameError}</p>
    {/if}
  </div>
</Dialog>

<LibraryMetadataDialogs
  {showTagEditor}
  {tagEditorItemId}
  {tagEditorItemTitle}
  {closeTagEditor}
  {handleTagChange}
  {showTypeEditor}
  {typeEditorItemId}
  {typeEditorItemTitle}
  {closeTypeEditor}
  {handleTypeChange}
/>

{#if showCreateFolderDialog}
  <Dialog
    open={showCreateFolderDialog}
    title="Create New Folder"
    description="Enter a name for the new folder. This will be created on your filesystem."
    onCancel={() => (showCreateFolderDialog = false)}
    onConfirm={handleCreateFolder}
    confirmText="Create Folder"
    loading={createFolderLoading}
  >
    <div class="space-y-4">
      <div class="space-y-2">
        <label
          for="folderName"
          class="text-xs font-semibold text-slate-400 ml-1">Folder Name</label
        >
        <input
          id="folderName"
          type="text"
          bind:value={newFolderName}
          use:selectTextOnFocus
          placeholder="Enter folder name..."
          class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:border-blue-500/50 transition-all outline-none"
          onkeydown={(e) => {
            if (e.key === "Enter") handleCreateFolder();
            if (e.key === "Escape") showCreateFolderDialog = false;
          }}
        />
        {#if createFolderError}
          <p class="text-xs text-rose-500 ml-1">{createFolderError}</p>
        {/if}
      </div>
    </div>
  </Dialog>
{/if}

{#if managingArchiveItem}
  <ArchiveManager
    item={managingArchiveItem}
    onClose={() => (managingArchiveItem = null)}
  />
{/if}

<BulkSelection
  {selection}
  allIds={bulkSelectableIds}
  mangaFolders={selectedMangaFolders}
  {menuCloseEpoch}
  view={$appState?.currentView === "favorites" ? "favorites" : "library"}
  onRefresh={handleBulkRefresh}
  onSetMangaPreference={setSelectedMangaPreference}
  onMove={() => {
    itemsToMove = items.filter((i) => selection.has(i.id));
    showMoveDialog = true;
  }}
/>

{#if isScanning}
  <LibraryScanOverlay {lastScannedCover} {totalScanned} {lastScannedItem} />
{:else if mangaSeriesViewActive}
  <div class="flex-1 relative overflow-hidden">
    <div
      class="absolute inset-0 overflow-auto p-6 scroll-smooth bg-slate-900"
      use:dragScroll={{ axis: "y" }}
      onscroll={() => {
        menuCloseEpoch += 1;
      }}
      data-active-view="true"
    >
      <MangaLibraryView
        seriesIds={mangaSeriesIdsInCurrentFolder}
        chapterItems={currentView.items}
        {gridSize}
        onBack={handleBackFromMangaSeriesView}
        chapterActions={mlvChapterActions}
        selectionContext={mlvSelectionContext}
        {menuCloseEpoch}
      />
    </div>
  </div>
{:else if !hasInitializedRootView}
  <div class="flex-1 bg-slate-900"></div>
{:else}
  <header
    class="h-16 bg-slate-900/80 border-b border-slate-700/50 flex items-center justify-between px-6 gap-4 sticky top-0 z-30 backdrop-blur-md"
  >
    <!-- Left: Navigation (Breadcrumbs) -->
    <div class="flex items-center gap-3 flex-1 min-w-0">
      {#if viewStack.length > 1}
        <button
          onclick={handleBack}
          class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors flex-shrink-0"
          aria-label="Go back"
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
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
        </button>
      {/if}

      <div
        class="flex items-center gap-2 overflow-x-auto no-scrollbar mask-linear-fade"
      >
        {#each viewStack as view, i}
          {#if i > 0}
            <svg
              class="w-4 h-4 text-slate-600 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5l7 7-7 7"
              /></svg
            >
          {/if}
          <button
            onclick={() => navigateToStackIndex(i)}
            class="text-lg font-medium whitespace-nowrap {i === activeIndex
              ? 'text-white'
              : 'text-slate-400 hover:text-white'} transition-colors"
          >
            {view.title}
          </button>
        {/each}
      </div>

      <FolderSwitcher
        currentRoot={selectedRoot}
        sortOrder={librarySortOrder}
        onSelect={(root) => {
          selectedRoot = root;
        }}
      />

      <span
        role="status"
        title={!searchQuery
          ? itemCountHovered
            ? "Total files"
            : "Total items"
          : undefined}
        class="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-sm cursor-default select-none transition-all duration-200 hover:bg-slate-700 hover:text-white"
        onmouseenter={() => (itemCountHovered = true)}
        onmouseleave={() => (itemCountHovered = false)}
      >
        {itemCountHovered
          ? currentFolderId === null && !searchQuery
            ? totalLibraryBooks
            : fileCount
          : totalCount}
      </span>
    </div>

    <div class="flex-1 max-w-lg hidden md:block">
      <div class="relative group">
        <svg
          class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-blue-400 transition-colors"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          placeholder="Search library..."
          bind:this={searchInputRef}
          value={searchQuery}
          oninput={handleSearchInput}
          onkeydown={handleSearchKeydown}
          onfocus={handleSearchFocus}
          class="w-full pl-10 pr-10 py-2.5 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white placeholder-slate-500 outline-none ring-0 focus:outline-none focus:bg-slate-800 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-colors duration-200 shadow-sm"
        />
        {#if showSearchSuggestions}
          <div
            class="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50"
          >
            {#each searchSuggestions as tag, i}
              <button
                class="w-full text-left px-4 py-2 hover:bg-slate-700 flex justify-between items-center group transition-colors {i ===
                selectedSearchIndex
                  ? 'bg-slate-700 ring-1 ring-inset ring-blue-500/50'
                  : ''}"
                onmousedown={(e) => {
                  e.preventDefault();
                  applySuggestion(tag);
                }}
              >
                <div class="flex items-center gap-2">
                  <span class="text-white font-medium">{tag.name}</span>
                  <span
                    class="text-xs text-slate-500 group-hover:text-slate-300 transition-colors"
                    >{tag.alias ? `(${tag.alias})` : ""}</span
                  >
                </div>
                {#if tag.category_name}
                  <span
                    class="text-[10px] uppercase font-bold tracking-wider text-slate-400 bg-slate-900/50 px-1.5 py-0.5 rounded border border-slate-700 group-hover:border-slate-500 transition-colors"
                  >
                    {tag.category_name}
                  </span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
        {#if searchQuery}
          <button
            onclick={() => (searchQuery = "")}
            class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-white rounded-full hover:bg-slate-700/50 transition-colors"
            aria-label="Clear search"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-3">
      <button
        class="md:hidden p-2 text-slate-400 hover:text-white"
        aria-label="Toggle search"
      >
        <svg
          class="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </button>

      <div class="relative">
        <button
          class="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-800/50 border border-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-800 transition-all duration-200 {selectedTypeIds.length >
            0 || excludedTypeIds.length > 0
            ? 'border-blue-500/50 text-blue-400 bg-blue-500/5'
            : ''}"
          onclick={(e) => {
            e.stopPropagation();
            showTypeFilter = !showTypeFilter;
          }}
          title="Filter by content type"
        >
          <div class="relative">
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
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
            {#if selectedTypeIds.length > 0 || excludedTypeIds.length > 0}
              <span
                class="absolute -top-2 -right-2 min-w-[18px] h-[18px] flex items-center justify-center bg-blue-500 text-white text-[10px] font-bold rounded-full px-1 shadow-lg shadow-blue-500/20"
              >
                {selectedTypeIds.length + excludedTypeIds.length}
              </span>
            {/if}
          </div>
        </button>

        {#if showTypeFilter}
          <div
            role="menu"
            tabindex="-1"
            class="absolute right-0 top-full mt-3 w-80 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl z-[60] overflow-hidden p-5"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
            transition:fade={{ duration: 150 }}
          >
            <div class="flex items-center justify-between mb-5">
              <span
                class="text-[11px] font-bold text-slate-500 uppercase tracking-[0.1em]"
                >Filter by Type</span
              >
              <button
                class="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-wider"
                onclick={clearTypeFilters}
              >
                Clear All
              </button>
            </div>

            <div class="grid grid-cols-2 gap-2.5">
              {#each availableTypes as type}
                {@const isSelected = selectedTypeIds.includes(type.id)}
                {@const isExcluded = excludedTypeIds.includes(type.id)}
                <button
                  class="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 {isSelected
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                    : isExcluded
                      ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}"
                  onclick={() => handleTypeClick(type.id)}
                >
                  <span class="text-base leading-none">
                    {getIcon(type.name)}
                  </span>
                  <span class="truncate">{type.name}</span>
                  {#if isExcluded}
                    <svg
                      class="w-3 h-3 ml-auto opacity-70"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="3"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div
        class="hidden sm:flex items-center gap-1 bg-slate-800/50 rounded-xl p-1 border border-slate-700/30"
      >
        <!-- Small Grid (Dense 4x4) -->
        <button
          class="p-1.5 rounded-md transition-colors {gridSize === 'small'
            ? 'bg-slate-700 text-white shadow-sm'
            : 'text-slate-400 hover:text-white'}"
          onclick={() => {
            gridSize = "small";
            localStorage.setItem("libraryGridSize", "small");
            window.electronAPI.settings.set("libraryGridSize", "small");
          }}
          title="Small Grid"
          aria-label="Small Grid"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
            <!-- 4x4 Grid -->
            <path
              d="M1 1h3v3H1V1zm4.5 0h3v3h-3V1zM10 1h3v3h-3V1zM14.5 1h.5a1 1 0 0 1 1 1v2h-1.5V1zM1 5.5h3v3H1v-3zm4.5 0h3v3h-3v-3zM10 5.5h3v3h-3v-3zm4.5 0h1.5v3h-1.5v-3zM1 10h3v3H1v-3zm4.5 0h3v3h-3v-3zM10 10h3v3h-3v-3zm4.5 0h1.5v3h-1.5v-3zM1 14.5h3v.5a1 1 0 0 0 1-1h-4z"
            />
            <path
              d="M0 0h3v3H0V0zm4.33 0h3v3h-3V0zm4.33 0h3v3h-3V0zm4.34 0h3v3h-3V0zM0 4.33h3v3H0v-3zm4.33 0h3v3h-3v-3zm4.33 0h3v3h-3v-3zm4.34 0h3v3h-3v-3zM0 8.66h3v3H0v-3zm4.33 0h3v3h-3v-3zm4.33 0h3v3h-3v-3zm4.34 0h3v3h-3v-3zM0 13h3v3H0v-3zm4.33 0h3v3h-3v-3zm4.33 0h3v3h-3v-3zm4.34 0h3v3h-3v-3z"
            />
          </svg>
        </button>

        <!-- Medium Grid (3x3) -->
        <button
          class="p-1.5 rounded-md transition-colors {gridSize === 'medium'
            ? 'bg-slate-700 text-white shadow-sm'
            : 'text-slate-400 hover:text-white'}"
          onclick={() => {
            gridSize = "medium";
            localStorage.setItem("libraryGridSize", "medium");
            window.electronAPI.settings.set("libraryGridSize", "medium");
          }}
          title="Medium Grid"
          aria-label="Medium Grid"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
            <path
              d="M1 1h4v4H1V1zm5 0h4v4H6V1zm5 0h4v4h-4V1zM1 6h4v4H1V6zm5 0h4v4H6V6zm5 0h4v4h-4V6zM1 11h4v4H1v-4zm5 0h4v4H6v-4zm5 0h4v4h-4v-4z"
            />
          </svg>
        </button>

        <!-- Large Grid (2x2) -->
        <button
          class="p-1.5 rounded-md transition-colors {gridSize === 'large'
            ? 'bg-slate-700 text-white shadow-sm'
            : 'text-slate-400 hover:text-white'}"
          onclick={() => {
            gridSize = "large";
            localStorage.setItem("libraryGridSize", "large");
            window.electronAPI.settings.set("libraryGridSize", "large");
          }}
          title="Large Grid"
          aria-label="Large Grid"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
            <path d="M0 0h7v7H0V0zm9 0h7v7H9V0zM0 9h7v7H0V9zm9 0h7v7H9V9z" />
          </svg>
        </button>
      </div>

      <button
        onclick={openCreateFolderDialog}
        title="Create a new folder (Ctrl+Shift+N)"
        class="p-2.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-xl transition-all"
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
            d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
          />
        </svg>
      </button>

      <button
        onclick={handleRescan}
        title="Scan for new files in existing folders"
        class="p-2.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-xl transition-all"
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
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>

      <button
        onclick={handleAddFolder}
        class="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all duration-200 shadow-lg shadow-blue-600/25 hover:shadow-blue-500/40 font-medium whitespace-nowrap"
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
            d="M12 4v16m8-8H4"
          />
        </svg>
        <span class="hidden sm:inline">Add Folder</span>
      </button>
    </div>
  </header>

  <div class="flex-1 relative overflow-hidden">
    {#each viewStack as view, index (index)}
      {@const isActiveView = index === activeIndex}
      {@const stackItems = isActiveView ? visibleItems : view.items}
      <!-- Keep inactive views rendered to avoid repaint flash when returning. -->
      <div
        class="absolute inset-0 overflow-auto p-6 scroll-smooth bg-slate-900"
        use:dragScroll={{ axis: "y" }}
        onscroll={(e) => {
          if (activeMenuId !== null) closeMenu();
          if (showTypeFilter) showTypeFilter = false;
          if (showSearchSuggestions) showSearchSuggestions = false;
          // Capture scroll position
          view.scrollTop = (e.target as HTMLElement).scrollTop;
          if (isActiveView) {
            menuCloseEpoch += 1;
            writeFolderViewState(view.id, view.scrollTop, renderLimit);
          }
        }}
        style="opacity: {isActiveView ? 1 : 0}; z-index: {isActiveView ? 1 : 0}; pointer-events: {isActiveView ? 'auto' : 'none'};"
        data-stack-view="true"
        data-active-view={isActiveView}
        aria-hidden={isActiveView ? "false" : "true"}
      >
        {#if view.items.length === 0 && !loading}
          <div
            class="flex flex-col items-center justify-center h-full text-center p-8"
          >
            <div class="mb-4 text-slate-700">
              <svg
                class="w-24 h-24"
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
            <p class="text-xl text-slate-400 font-medium mb-2">
              Folder is empty
            </p>
            <p class="text-slate-500 text-sm mb-6 max-w-sm">
              Use the "Add Folder" button to import manga or scanning options to
              refresh content.
            </p>
            <div class="flex gap-3">
              <button
                onclick={handleAddFolder}
                class="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors cursor-pointer"
                >Add Folder</button
              >
              <button
                onclick={handleRescan}
                class="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-colors cursor-pointer"
                >Scan Library</button
              >
            </div>
          </div>
        {:else}
          <div class="grid {getGridClass()} gap-4 library-grid">
            {#each stackItems as item, idx (item.id)}
              <LibraryGridItem
                {item}
                {idx}
                {isActiveView}
                {skipItemAnimation}
                {selection}
                filteredItems={filteredItems}
                activeMenuId={activeMenuId}
                {blurR18}
                {blurR18Hover}
                blurR18Intensity={blurR18Intensity}
                currentFolderId={currentFolderId}
                searchQuery={searchQuery}
                getCoverSrc={getCoverSrc}
                getStatusColor={getStatusColor}
                getStatusLabel={getStatusLabel}
                getReadingProgress={getReadingProgress}
                getBreadcrumbPath={getBreadcrumbPath}
                getLanguageCodes={getLanguageCodes}
                onItemClick={handleItemClick}
                onToggleFavorite={toggleFavorite}
                onToggleMenu={toggleMenu}
                onCloseMenu={closeMenu}
                onOpenTagEditor={openTagEditor}
                onOpenTypeEditor={openTypeEditor}
                onSetMangaPreference={setItemMangaPreference}
                onManageArchive={(selectedItem) => {
                  managingArchiveItem = selectedItem;
                }}
                onMoveItem={(selectedItem) => {
                  itemsToMove = [selectedItem];
                  showMoveDialog = true;
                }}
                onOpenRename={openRenameDialog}
                onShowInFolder={handleShowInFolder}
                onDeleteItem={deleteItem}
              />
            {/each}
          </div>

          <!-- Loading Trigger -->
          {#if renderLimit < filteredItems.length}
            <div
              bind:this={loaderRef}
              class="h-20 flex items-center justify-center mt-8"
            >
              <div
                class="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"
              ></div>
            </div>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
{/if}

<MoveToFolderDialog
  open={showMoveDialog}
  {itemsToMove}
  onClose={() => (showMoveDialog = false)}
  onMoved={async (destinationId: number | string | null) => {
    const movedIds = new Set(itemsToMove.map((i) => i.id));

    viewStack = viewStack.map((v) => ({
      ...v,
      items: v.items.filter((i) => !movedIds.has(i.id)),
    }));

    const destId = typeof destinationId === "number" ? destinationId : null;
    const destIndex = viewStack.findIndex((v) => v.id === destId);
    if (destIndex !== -1) {
      try {
        const getItems = window.electronAPI.library.getItems as any;
        viewStack[destIndex].items = await getItems(destId, selectedRoot);
      } catch {}
    }

    itemsCache.clear();
    selection.clear();
    toasts.add(
      `Successfully moved ${itemsToMove.length} item${itemsToMove.length > 1 ? "s" : ""}`,
      "success",
    );
  }}
/>

<style>
  /* Aggressively nuke focus outlines for general elements to keep clean UI */
  :global(*:focus),
  :global(*:focus-visible) {
    outline: none !important;
  }

  :global(input:focus),
  :global(textarea:focus) {
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2) !important;
  }

  :global(.select-none) {
    -webkit-user-select: none !important;
    user-select: none !important;
  }
</style>
