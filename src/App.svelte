<script lang="ts">
  import Library from "./lib/views/Library.svelte";
  import Reader from "./lib/views/Reader.svelte";
  import Favorites from "./lib/views/Favorites.svelte";
  import Recent from "./lib/views/Recent.svelte";
  import Settings from "./lib/views/Settings.svelte";
  import Tags from "./lib/views/Tags.svelte";
  import About from "./lib/views/About.svelte";
  import Downloader from "./lib/views/Downloader.svelte";
  import DownloadLogs from "./lib/views/DownloadLogs.svelte";
  import ToastNotification from "./lib/components/ToastNotification.svelte";
  import UpdateNotification from "./lib/components/UpdateNotification.svelte";
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

  let view = $state<View>("library");
  let currentBook = $state<any>(null);
  let showAbout = $state(false);

  // Try to get initial width synchronously from localStorage to avoid flashing
  const cachedWidth =
    typeof window !== "undefined" ? localStorage.getItem("sidebarWidth") : null;
  let sidebarWidth = $state(cachedWidth ? parseInt(cachedWidth) : 256);

  let isResizing = $state(false);
  let isInitialLoad = $state(true);

  // Snap points and friction
  const SNAP_ICON = 64;
  const SNAP_SMALL = 180;
  const SNAP_NORMAL = 256;
  const snapPoints = [SNAP_ICON, SNAP_SMALL, SNAP_NORMAL];
  const snapThreshold = 15;
  const snapFriction = 30;
  let isSnapped = $state(false);
  let initialSnapX = 0;

  $effect(() => {
    // Check for query params (Reader Window Mode)
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");
    const bookId = params.get("bookId");

    const taskId = params.get("taskId");

    if (viewParam === "download_logs" && taskId) {
      appState.update((s) => ({
        ...s,
        currentView: "download_logs",
        currentBook: null,
      }));

      // Auxiliary window; show/fade handled in settings block
    }

    if (viewParam === "reader" && bookId) {
      const id = parseInt(bookId);
      window.electronAPI.library.getItem(id).then((book) => {
        if (book) {
          const pageParam = params.get("page");
          if (pageParam) {
            book.current_page = parseInt(pageParam);
          }
          appState.update((s) => ({
            ...s,
            currentView: "reader",
            currentBook: book,
          }));
        }
      });
    }

    // In auxiliary windows (like download logs), Electron APIs may not be ready the same way as the main window.
    // Never leave the whole UI stuck invisible.
    const failSafe = setTimeout(() => {
      isInitialLoad = false;
    }, 1200);

    window.electronAPI.settings
      .get("sidebarWidth")
      .then((val) => {
        if (val) {
          const w = parseInt(val);
          if (!isNaN(w)) {
            sidebarWidth = w;
            appState.update((s) => ({ ...s, sidebarWidth: w }));
          }
        }

        // Show sequence for auxiliary windows to prevent flash
        const isAuxiliary = !!viewParam;

        // Show window during dark loading state to prevent native white flash (v10)
        setTimeout(
          async () => {
            // Ensure browser has painted at least one dark frame
            await new Promise((r) => requestAnimationFrame(r));
            await new Promise((r) => requestAnimationFrame(r));

            // Native Show
            window.electronAPI.window.show();

            // Wait a bit more for window manager to settle before fading in UI
            setTimeout(
              () => {
                isInitialLoad = false;
              },
              isAuxiliary ? 50 : 150,
            );
          },
          isAuxiliary ? 150 : 500,
        );
      })
      .catch(() => {
        isInitialLoad = false;
      })
      .finally(() => {
        clearTimeout(failSafe);
      });

    const unsubscribe = appState.subscribe((state) => {
      view = state.currentView;
      currentBook = state.currentBook;
    });

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
    : 'opacity-100 transition-opacity duration-300'} {isResizing
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
      <DownloadLogs />
    {:else}
      <!-- Library View (Always mounted, hidden via CSS when not active) -->
      <div
        style="display: {view === 'library' ? 'flex' : 'none'}"
        class="h-full flex-col"
      >
        <Library />
      </div>

      <!-- Favorites View (Now persisted) -->
      <div
        style="display: {view === 'favorites' ? 'flex' : 'none'}"
        class="h-full flex-col"
      >
        <Favorites />
      </div>

      <!-- Downloader View (Persisted) -->
      <div
        style="display: {view === 'downloader' ? 'flex' : 'none'}"
        class="h-full flex-col"
      >
        <Downloader />
      </div>

      <!-- Other views still use conditional rendering as they might not need state preservation or are lighter -->
      {#if view === "reader" && currentBook}
        <Reader book={currentBook} />
      {:else if view === "recent"}
        <Recent />
      {:else if view === "settings"}
        <Settings />
      {:else if view === "tags"}
        <Tags />
      {/if}
    {/if}
  </main>

  <About open={showAbout} onCancel={() => (showAbout = false)} />

  <ToastNotification />
  <UpdateNotification />
</div>
