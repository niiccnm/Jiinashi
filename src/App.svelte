<script lang="ts">
  import { onMount, type Component } from "svelte";
  import Library from "./lib/views/Library.svelte";
  import About from "./lib/views/About.svelte";
  import ToastNotification from "./lib/components/ToastNotification.svelte";
  import UpdateNotification from "./lib/components/UpdateNotification.svelte";
  import { toasts } from "./lib/stores/toast";
  import {
    appState,
    openLibrary,
    openFavorites,
    openRecent,
    openSettings,
    openTags,
    openDownloader,
    navigateHistory,
  } from "./lib/stores/app";
  import type { View } from "./lib/stores/app";
  import type { ReaderBootstrapOverrides } from "./lib/utils/manga";
  import {
    DEFAULT_CONTENT_FILTER_SETTINGS,
    parseContentFilterSettings,
    type ContentFilterSettings,
  } from "./lib/utils/content-filter";

  type ViewModule = { default: Component<any> };

  const viewLoaders: Partial<Record<View, () => Promise<ViewModule>>> = {
    reader: () => import("./lib/views/Reader.svelte"),
    favorites: () => import("./lib/views/Favorites.svelte"),
    recent: () => import("./lib/views/Recent.svelte"),
    settings: () => import("./lib/views/Settings.svelte"),
    tags: () => import("./lib/views/Tags.svelte"),
    downloader: () => import("./lib/views/Downloader.svelte"),
    download_logs: () => import("./lib/views/DownloadLogs.svelte"),
  };

  let viewComponents = $state<Partial<Record<View, Component<any>>>>({
    library: Library,
  });
  let unreadyViews = $state<View[]>([
    "library",
    "favorites",
    "downloader",
    "recent",
  ]);

  function markViewReady(target: View) {
    if (!unreadyViews.includes(target)) return;
    unreadyViews = unreadyViews.filter((view) => view !== target);
  }

  async function loadView(target: View) {
    if (viewComponents[target]) return;
    const loader = viewLoaders[target];
    // import() already caches modules and coalesces concurrent requests.
    if (loader) viewComponents[target] = (await loader()).default;
  }

  async function preloadPrimaryViews() {
    const primaryViews: View[] = [
      "favorites",
      "downloader",
      "recent",
      "settings",
      "tags",
    ];
    for (const target of primaryViews) {
      await new Promise<void>((resolve) =>
        requestIdleCallback(() => resolve(), { timeout: 2000 }),
      );
      try {
        // Favorites, Downloader, and Recent load their data while hidden.
        await loadView(target);
      } catch (error) {
        console.error(`Failed to preload the ${target} view:`, error);
      }
    }
  }

  function waitForPaint(): Promise<void> {
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }

  let view = $state<View>("library");
  let requestedView = $state<View>("library");
  let currentBook = $state<any>(null);
  let showAbout = $state(false);
  let contentFilter = $state<ContentFilterSettings>({
    ...DEFAULT_CONTENT_FILTER_SETTINGS,
  });

  // Try to get initial width synchronously from localStorage to avoid flashing
  const cachedWidth =
    typeof window !== "undefined" ? localStorage.getItem("sidebarWidth") : null;
  let sidebarWidth = $state(cachedWidth ? parseInt(cachedWidth) : 256);

  let isResizing = $state(false);
  let isInitialLoad = $state(true);
  let initialSettingsReady = $state(false);
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get("view");
  const initialView: View =
    viewParam === "reader" || viewParam === "download_logs"
      ? viewParam
      : "library";

  // Reader shows its own window, so its toasts bypass this queue.
  let toastWindowReady = initialView === "reader";
  const pendingToasts: Parameters<typeof toasts.add>[] = [];

  function addToast(...args: Parameters<typeof toasts.add>) {
    if (toastWindowReady) toasts.add(...args);
    else pendingToasts.push(args);
  }

  async function showWindow() {
    await window.electronAPI.window.show();
    toastWindowReady = true;
    // Start the existing expiration timers only once the window is visible.
    for (const args of pendingToasts.splice(0)) toasts.add(...args);
  }

  $effect(() => {
    const target = requestedView;
    if (!viewComponents[target] || unreadyViews.includes(target)) return;
    view = target;

    if (!isInitialLoad || !initialSettingsReady || target !== initialView) return;

    isInitialLoad = false;
    // Reader shows its window after loading the requested book and page.
    if (initialView === "reader") return;
    void waitForPaint()
      .then(showWindow)
      .then(() => {
        if (initialView === "library") void preloadPrimaryViews();
      });
  });

  // Snap points and friction
  const SNAP_ICON = 64;
  const SNAP_SMALL = 180;
  const SNAP_NORMAL = 256;
  const snapPoints = [SNAP_ICON, SNAP_SMALL, SNAP_NORMAL];
  const snapThreshold = 15;
  const snapFriction = 30;
  let isSnapped = $state(false);
  let initialSnapX = 0;

  function parseReaderInitOverrides(
    params: URLSearchParams,
  ): ReaderBootstrapOverrides | null {
    const initialViewMode = params.get("initialViewMode");
    const initialMangaMode = params.get("initialMangaMode");

    const overrides: ReaderBootstrapOverrides = {};

    if (
      initialViewMode === "single" ||
      initialViewMode === "double" ||
      initialViewMode === "webtoon"
    ) {
      overrides.initialViewMode = initialViewMode;
    }

    if (initialMangaMode === "true") {
      overrides.initialMangaMode = true;
    } else if (initialMangaMode === "false") {
      overrides.initialMangaMode = false;
    }

    return Object.keys(overrides).length > 0 ? overrides : null;
  }

  onMount(() => {
    // Check for query params (Reader Window Mode)
    const bookId = params.get("bookId");

    const taskId = params.get("taskId");

    void loadView(initialView).catch((error) => {
      console.error(`Failed to load the ${initialView} view:`, error);
      addToast("Failed to open this window. Please close it and try again.", "error");
      isInitialLoad = false;
      void showWindow();
    });

    if (viewParam === "download_logs" && taskId) {
      appState.update((s) => ({
        ...s,
        currentView: "download_logs",
        currentBook: null,
      }));
    }

    if (viewParam === "reader" && bookId) {
      const id = parseInt(bookId);
      window.electronAPI.library.getItem(id).then((book) => {
        if (book) {
          const pageParam = params.get("page");
          if (pageParam) {
            book.current_page = parseInt(pageParam);
            book.current_page_offset = 0;
          }
          const readerInit = parseReaderInitOverrides(params);
          if (readerInit) {
            book.readerInit = readerInit;
          }
          appState.update((s) => ({
            ...s,
            currentView: "reader",
            currentBook: book,
          }));
        }
      });
    }

    async function loadInitialSettings() {
      try {
        if (initialView !== "library") return;
        const settings = await window.electronAPI.settings.getAll();
        contentFilter = parseContentFilterSettings(settings);
        const width = Number.parseInt(settings?.sidebarWidth ?? "", 10);
        if (Number.isFinite(width)) {
          sidebarWidth = width;
          appState.update((s) => ({ ...s, sidebarWidth: width }));
        }
      } catch (error) {
        console.error("Failed to load the initial window settings:", error);
      } finally {
        initialSettingsReady = true;
      }
    }

    void loadInitialSettings();

    const unsubscribe = appState.subscribe((state) => {
      requestedView = state.currentView;
      currentBook = state.currentBook;
      // The startup load above already handles errors for this view.
      if (state.currentView === initialView) return;
      void loadView(state.currentView).catch((error) => {
        console.error(`Failed to load the ${state.currentView} view:`, error);
        addToast("Failed to open this page. Please close and reopen Jiinashi.", "error");
      });
    });
    const unsubscribeAppToast = window.electronAPI.notifications.onToast(addToast);
    const unsubscribeDownloaderToast =
      initialView === "download_logs"
        ? undefined
        : window.electronAPI.downloader.onToast(addToast);

    const handleMouseDown = (e: MouseEvent) => {
      // If in reader mode, let the Reader component handle navigation
      if (view === "reader") return;

      if (e.button === 3 || e.button === 4) {
        e.preventDefault(); // Prevent default browser behavior if any
        if (e.button === 3) {
          navigateHistory(-1);
        } else if (e.button === 4) {
          navigateHistory(1);
        }
      }
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      let targetWidth = e.clientX;
      let snapped = false;

      for (const snap of snapPoints) {
        if (Math.abs(targetWidth - snap) < snapThreshold) {
          if (!isSnapped) {
            initialSnapX = e.clientX;
            isSnapped = true;
          }

          if (Math.abs(e.clientX - initialSnapX) < snapFriction) {
            targetWidth = snap;
            snapped = true;
          }
          break;
        }
      }

      if (!snapped) {
        isSnapped = false;
      }

      // Constraints
      if (targetWidth < 64) targetWidth = 64;
      if (targetWidth > 256) targetWidth = 256;

      sidebarWidth = targetWidth;
      appState.update((s) => ({ ...s, sidebarWidth: targetWidth }));
    };

    const handleGlobalMouseUp = () => {
      if (isResizing) {
        isResizing = false;
        isSnapped = false;
        window.electronAPI.settings.set(
          "sidebarWidth",
          sidebarWidth.toString(),
        );
        localStorage.setItem("sidebarWidth", sidebarWidth.toString());
      }
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleGlobalMouseMove);
    window.addEventListener("mouseup", handleGlobalMouseUp);

    // Auto-Scan Triggered after download completion
    const unsubscribeScan = window.electronAPI.library.onTriggerScan(
      (path: string) => {
        console.log("[Auto-Scan] Triggered for path:", path);
        window.electronAPI.library.scan(path).catch((e) => {
          console.error("[Auto-Scan] Failed to scan:", e);
        });
      },
    );
    return () => {
      unsubscribe();
      unsubscribeAppToast();
      unsubscribeDownloaderToast?.();
      pendingToasts.length = 0;
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
      unsubscribeScan();
    };
  });

  function startResizing(e: MouseEvent) {
    e.preventDefault();
    isResizing = true;
  }

  function toggleSidebar() {
    const targetWidth = sidebarWidth > 120 ? 64 : 256;
    sidebarWidth = targetWidth;
    appState.update((s) => ({ ...s, sidebarWidth: targetWidth }));
    window.electronAPI.settings.set("sidebarWidth", targetWidth.toString());
    localStorage.setItem("sidebarWidth", targetWidth.toString());
  }
</script>

<div
  class="h-screen w-screen flex bg-gray-950 text-gray-100 font-sans overflow-hidden {isInitialLoad
    ? 'no-animations opacity-0'
    : 'opacity-100'} {isResizing
    ? 'is-resizing'
    : ''}"
>
  <!-- Sidebar -->
  {#if view !== "reader" && view !== "download_logs"}
    <aside
      style="width: {sidebarWidth}px"
      class="bg-gray-900 border-r border-gray-800 flex flex-col relative group {isResizing ||
      isInitialLoad
        ? 'transition-none'
        : 'transition-all duration-150 ease-out'}"
    >
      <!-- Resize Handle -->
      <button
        class="absolute -right-0.5 top-0 bottom-0 w-1 cursor-col-resize hover:w-2 hover:bg-blue-500/50 transition-all z-50 p-0 border-none appearance-none outline-none {isResizing
          ? 'bg-blue-500 w-2'
          : 'bg-transparent'} {isResizing && isSnapped
          ? 'bg-blue-400 w-2 shadow-[0_0_8px_rgba(96,165,250,0.4)]'
          : ''}"
        onmousedown={startResizing}
        tabindex="-1"
        aria-label="Sidebar Resizer"
      ></button>

      <!-- Logo/Brand -->
      <div
        class="h-16 flex items-center border-b border-gray-800"
        style="padding-left: {sidebarWidth < 120
          ? '12px'
          : '20px'}; padding-right: {sidebarWidth < 120
          ? '12px'
          : '20px'}; transition: {!isResizing && !isInitialLoad
          ? sidebarWidth < 120
            ? 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
            : 'all 0.15s ease-out'
          : 'none'}"
      >
        <button
          onclick={toggleSidebar}
          class="flex-shrink-0 p-0 border-none bg-transparent cursor-pointer hover:scale-110 active:scale-95 transition-transform duration-200 focus:outline-none"
          aria-label="Toggle Sidebar"
        >
          <img
            src="logo.svg"
            alt=""
            class="w-[40px] h-[40px] block"
            style="transition: {!isResizing && !isInitialLoad
              ? sidebarWidth < 120
                ? 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                : 'all 0.15s ease-out'
              : 'none'}"
          />
        </button>
        <div
          class="min-w-0 flex items-center overflow-hidden"
          style="opacity: {sidebarWidth < 120
            ? 0
            : 1}; margin-left: {sidebarWidth < 120
            ? 0
            : 12}px; max-width: {sidebarWidth < 120
            ? '0px'
            : '200px'}; transition: {!isResizing && !isInitialLoad
            ? sidebarWidth < 120
              ? 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
              : 'all 0.15s ease-out'
            : 'none'}"
        >
          <span
            class="text-xl font-bold text-white tracking-tight whitespace-nowrap cursor-default select-none"
            >Jiinashi</span
          >
        </div>
      </div>

      <!-- Navigation -->
      <nav
        class="flex-1 py-4 space-y-1.5 overflow-y-auto overflow-x-hidden px-2"
      >
        <button
          class="w-full flex items-center rounded-lg transition-all duration-200 group/nav h-11 {view ===
          'library'
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
            : 'hover:bg-gray-800 text-gray-400 hover:text-white'}"
          title={sidebarWidth < 120 ? "Library" : ""}
          style="padding-left: 14px; padding-right: 8px;"
          onclick={() => openLibrary()}
        >
          <div class="w-5 h-5 flex items-center justify-center shrink-0">
            <svg
              class="w-5 h-5 transition-transform duration-200 group-hover/nav:scale-110"
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
          </div>
          <div
            class="flex-1 min-w-0 overflow-hidden flex items-center transition-opacity duration-200"
            style="opacity: {Math.max(
              0,
              Math.min(1, (sidebarWidth - 80) / 40),
            )}; margin-left: {Math.max(
              0,
              Math.min(12, ((sidebarWidth - 64) / 56) * 12),
            )}px"
          >
            <span class="truncate font-medium">Library</span>
          </div>
        </button>

        <button
          class="w-full flex items-center rounded-lg transition-all duration-200 group/nav h-11 {view ===
          'recent'
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
            : 'hover:bg-gray-800 text-gray-400 hover:text-white'}"
          title={sidebarWidth < 120 ? "Recent" : ""}
          style="padding-left: 14px; padding-right: 8px;"
          onclick={() => openRecent()}
        >
          <div class="w-5 h-5 flex items-center justify-center shrink-0">
            <svg
              class="w-5 h-5 transition-transform duration-200 group-hover/nav:scale-110"
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
          </div>
          <div
            class="flex-1 min-w-0 overflow-hidden flex items-center transition-opacity duration-200"
            style="opacity: {Math.max(
              0,
              Math.min(1, (sidebarWidth - 80) / 40),
            )}; margin-left: {Math.max(
              0,
              Math.min(12, ((sidebarWidth - 64) / 56) * 12),
            )}px"
          >
            <span class="truncate font-medium">Recent</span>
          </div>
        </button>

        <button
          class="w-full flex items-center rounded-lg transition-all duration-200 group/nav h-11 {view ===
          'tags'
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
            : 'hover:bg-gray-800 text-gray-400 hover:text-white'}"
          title={sidebarWidth < 120 ? "Tags" : ""}
          style="padding-left: 14px; padding-right: 8px;"
          onclick={() => openTags()}
        >
          <div class="w-5 h-5 flex items-center justify-center shrink-0">
            <svg
              class="w-5 h-5 transition-transform duration-200 group-hover/nav:scale-110"
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
          </div>
          <div
            class="flex-1 min-w-0 overflow-hidden flex items-center transition-opacity duration-200"
            style="opacity: {Math.max(
              0,
              Math.min(1, (sidebarWidth - 80) / 40),
            )}; margin-left: {Math.max(
              0,
              Math.min(12, ((sidebarWidth - 64) / 56) * 12),
            )}px"
          >
            <span class="truncate font-medium">Tags</span>
          </div>
        </button>

        <button
          class="w-full flex items-center rounded-lg transition-all duration-200 group/nav h-11 {view ===
          'favorites'
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
            : 'hover:bg-gray-800 text-gray-400 hover:text-white'}"
          title={sidebarWidth < 120 ? "Favorites" : ""}
          style="padding-left: 14px; padding-right: 8px;"
          onclick={() => openFavorites()}
        >
          <div class="w-5 h-5 flex items-center justify-center shrink-0">
            <svg
              class="w-5 h-5 transition-transform duration-200 group-hover/nav:scale-110"
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
          </div>
          <div
            class="flex-1 min-w-0 overflow-hidden flex items-center transition-opacity duration-200"
            style="opacity: {Math.max(
              0,
              Math.min(1, (sidebarWidth - 80) / 40),
            )}; margin-left: {Math.max(
              0,
              Math.min(12, ((sidebarWidth - 64) / 56) * 12),
            )}px"
          >
            <span class="truncate font-medium">Favorites</span>
          </div>
        </button>

        <button
          class="w-full flex items-center rounded-lg transition-all duration-200 group/nav h-11 {view ===
          'downloader'
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
            : 'hover:bg-gray-800 text-gray-400 hover:text-white'}"
          title={sidebarWidth < 120 ? "Downloader" : ""}
          style="padding-left: 14px; padding-right: 8px;"
          onclick={() => openDownloader()}
        >
          <div class="w-5 h-5 flex items-center justify-center shrink-0">
            <svg
              class="w-5 h-5 transition-transform duration-200 group-hover/nav:scale-110"
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
          <div
            class="flex-1 min-w-0 overflow-hidden flex items-center transition-opacity duration-200"
            style="opacity: {Math.max(
              0,
              Math.min(1, (sidebarWidth - 80) / 40),
            )}; margin-left: {Math.max(
              0,
              Math.min(12, ((sidebarWidth - 64) / 56) * 12),
            )}px"
          >
            <span class="truncate font-medium">Downloader</span>
          </div>
        </button>
      </nav>

      <!-- Settings at bottom -->
      <div class="py-4 border-t border-gray-800 px-2">
        <button
          class="w-full flex items-center rounded-lg transition-all duration-200 group/nav h-11 {showAbout
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
            : 'hover:bg-gray-800 text-gray-400 hover:text-white'}"
          title={sidebarWidth < 120 ? "About" : ""}
          style="padding-left: 14px; padding-right: 8px;"
          onclick={() => (showAbout = true)}
        >
          <div class="w-5 h-5 flex items-center justify-center shrink-0">
            <svg
              class="w-5 h-5 transition-transform duration-200 group-hover/nav:scale-110"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div
            class="flex-1 min-w-0 overflow-hidden flex items-center transition-opacity duration-200"
            style="opacity: {Math.max(
              0,
              Math.min(1, (sidebarWidth - 80) / 40),
            )}; margin-left: {Math.max(
              0,
              Math.min(12, ((sidebarWidth - 64) / 56) * 12),
            )}px"
          >
            <span class="truncate font-medium">About</span>
          </div>
        </button>

        <button
          class="w-full flex items-center rounded-lg transition-all duration-200 group/nav h-11 {view ===
          'settings'
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
            : 'hover:bg-gray-800 text-gray-400 hover:text-white'}"
          title={sidebarWidth < 120 ? "Settings" : ""}
          style="padding-left: 14px; padding-right: 8px; margin-top: 6px;"
          onclick={() => openSettings()}
        >
          <div class="w-5 h-5 flex items-center justify-center shrink-0">
            <svg
              class="w-5 h-5 transition-transform duration-200 group-hover/nav:scale-110"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <div
            class="flex-1 min-w-0 overflow-hidden flex items-center transition-opacity duration-200"
            style="opacity: {Math.max(
              0,
              Math.min(1, (sidebarWidth - 80) / 40),
            )}; margin-left: {Math.max(
              0,
              Math.min(12, ((sidebarWidth - 64) / 56) * 12),
            )}px"
          >
            <span class="truncate font-medium">Settings</span>
          </div>
        </button>
      </div>
    </aside>
  {/if}

  <!-- Main Content -->
  <main class="flex-1 flex flex-col overflow-hidden">
    {#if view === "download_logs"}
      {#if viewComponents.download_logs}
        {@const DownloadLogsView = viewComponents.download_logs}
        <DownloadLogsView />
      {/if}
    {:else}
      <!-- Library View (Always mounted, hidden via CSS when not active) -->
      <div
        style="display: {view === 'library' ? 'flex' : 'none'}"
        class="h-full flex-col"
      >
        <Library
          active={view === "library"}
          {contentFilter}
          onReady={() => markViewReady("library")}
        />
      </div>

      <!-- Favorites View (Now persisted) -->
      <div
        style="display: {view === 'favorites' ? 'flex' : 'none'}"
        class="h-full flex-col"
      >
        {#if viewComponents.favorites}
          {@const FavoritesView = viewComponents.favorites}
          <FavoritesView
            active={view === "favorites"}
            {contentFilter}
            onReady={() => markViewReady("favorites")}
          />
        {/if}
      </div>

      <!-- Downloader View (Persisted) -->
      <div
        style="display: {view === 'downloader' ? 'flex' : 'none'}"
        class="h-full flex-col"
      >
        {#if viewComponents.downloader}
          {@const DownloaderView = viewComponents.downloader}
          <DownloaderView
            active={view === "downloader"}
            onReady={() => markViewReady("downloader")}
          />
        {/if}
      </div>

      <div
        style="display: {view === 'recent' ? 'flex' : 'none'}"
        class="h-full flex-col"
      >
        {#if viewComponents.recent}
          {@const RecentView = viewComponents.recent}
          <RecentView
            active={view === "recent"}
            {contentFilter}
            onReady={() => markViewReady("recent")}
          />
        {/if}
      </div>

      {#if view === "reader" && currentBook && viewComponents.reader}
        {@const ReaderView = viewComponents.reader}
        <ReaderView book={currentBook} />
      {:else if view === "settings" && viewComponents.settings}
        {@const SettingsView = viewComponents.settings}
        <SettingsView />
      {:else if view === "tags" && viewComponents.tags}
        {@const TagsView = viewComponents.tags}
        <TagsView />
      {/if}
    {/if}
  </main>

  <About open={showAbout} onCancel={() => (showAbout = false)} />

  <ToastNotification />
  <UpdateNotification />
</div>
