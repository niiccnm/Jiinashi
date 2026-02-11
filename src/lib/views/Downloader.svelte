<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import DownloadItem from "../components/downloader/DownloadItem.svelte";
  import { toasts } from "../stores/toast";
  import { dragScroll } from "../utils/dragScroll";

  // --- State ---
  let downloadUrl = $state("");
  let queue = $state<any[]>([]);
  let history = $state<any[]>([]);
  let activeTab = $state<"queue" | "history">("queue");
  let activeMenuId = $state<number | null>(null);
  let isSearching = $state(false);
  let unsubscribe: (() => void) | null = null;
  let unsubscribeToasts: (() => void) | null = null;

  // --- Methods ---
  async function refreshHistory() {
    try {
      history = await window.electronAPI.downloader.getHistory();
    } catch (e) {
      console.error("Failed to load history:", e);
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
      await window.electronAPI.downloader.clearHistory();
      await refreshHistory();
      toasts.add("Download history cleared", "success");
    } catch (e) {
      console.error("Failed to clear history:", e);
    }
  }

  async function handleClearFinished() {
    try {
      // @ts-ignore - clearFinished might missing in some versions of API
      (await window.electronAPI.downloader.clearFinished?.()) ||
        (await window.electronAPI.downloader.clearQueue());
      toasts.add("Cleared finished downloads from queue", "success");
    } catch (e) {
      console.error("Failed to clear finished:", e);
    }
  }

  async function handleCancelAll() {
    try {
      // @ts-ignore - cancelAll might missing in some versions of API
      await window.electronAPI.downloader.cancelAll?.();
      toasts.add("Cancelled all active downloads", "info");
    } catch (e) {
      console.error("Failed to cancel all:", e);
    }
  }

  async function handleRetryAll() {
    try {
      // @ts-ignore - retryAll might missing in some versions of API
      await window.electronAPI.downloader.retryAll?.();
      toasts.add("Retrying all stopped downloads", "info");
    } catch (e) {
      console.error("Failed to retry all:", e);
    }
  }

  async function handleOpenFolder() {
    window.electronAPI.downloader.openFolder();
  }

  function handleCancel(id: number) {
    window.electronAPI.downloader.cancel(id);
  }

  async function handleRetry(id: number) {
    try {
      await window.electronAPI.downloader.retry(id);
      toasts.add("Retrying download", "info");
      activeTab = "queue";
    } catch (e) {
      console.error("Failed to retry download:", e);
    }
  }

  async function handleRemove(id: number) {
    try {
      await window.electronAPI.downloader.removeHistoryItem(id);
      toasts.add("Removed from history", "success");
      await refreshHistory();
    } catch (e) {
      console.error("Failed to remove history item:", e);
      toasts.add("Failed to remove item", "error");
    }
  }

  async function handleRemoveFromQueue(id: number) {
    try {
      await window.electronAPI.downloader.removeFromQueue(id);
      toasts.add("Removed from queue", "success");
    } catch (e) {
      console.error("Failed to remove from queue:", e);
      toasts.add("Failed to remove item", "error");
    }
  }

  // --- Lifecycle ---
  onMount(async () => {
    try {
      queue = await window.electronAPI.downloader.getQueue();
      await refreshHistory();
    } catch (e) {
      console.error("Failed initial load:", e);
    }

    unsubscribe = window.electronAPI.downloader.onQueueUpdate(
      (updatedQueue: any[]) => {
        queue = updatedQueue;
        const hasFinished = updatedQueue.some((item) =>
          ["completed", "failed", "cancelled"].includes(item.status),
        );
        if (hasFinished) refreshHistory();
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
    if (unsubscribeToasts) unsubscribeToasts();
  });
</script>

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

    <div class="flex items-center gap-3">
      <div
        class="flex bg-slate-800/50 p-1 rounded-xl border border-slate-700/50"
      >
        <button
          onclick={() => (activeTab = "queue")}
          class="px-4 py-1.5 rounded-lg text-sm font-bold transition-all {activeTab ===
          'queue'
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
            : 'text-slate-400 hover:text-white'}"
        >
          Queue
          {#if queue.length > 0}
            <span
              class="ml-1.5 px-1.5 py-0.5 rounded-md bg-white/10 text-[10px]"
              >{queue.length}</span
            >
          {/if}
        </button>
        <button
          onclick={() => {
            activeTab = "history";
            refreshHistory();
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
    class="flex-1 overflow-auto p-8 flex flex-col gap-8 max-w-6xl mx-auto w-full"
    use:dragScroll={{ axis: "y" }}
    onscroll={() => (activeMenuId = null)}
  >
    <!-- Search / Add URL -->
    <section class="flex flex-col gap-4">
      <div class="relative group">
        <input
          type="text"
          bind:value={downloadUrl}
          placeholder="Paste nhentai, e-hentai, or hitomi URL here..."
          class="w-full pl-6 pr-32 py-5 bg-slate-900/50 border border-slate-700/50 rounded-2xl text-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all duration-300"
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

      <div class="text-xs text-slate-500 px-2 flex gap-4">
        {#each ["Supports nhentai", "E-Hentai / ExHentai", "Hitomi.la"] as site}
          <span class="flex items-center gap-1.5">
            <div class="w-1 h-1 rounded-full bg-slate-600"></div>
            {site}
          </span>
        {/each}
      </div>
    </section>

    <!-- Content List -->
    <div class="flex-1 flex flex-col gap-4">
      {#if activeTab === "queue"}
        <div class="flex items-center justify-between px-2">
          <h2
            class="text-sm font-bold text-slate-400 uppercase tracking-widest"
          >
            Active Queue
          </h2>
          {#if queue.length > 0}
            <div class="flex items-center gap-4">
              {#if queue.some( (t) => ["pending", "parsing", "downloading", "zipping", "verification"].includes(t.status), )}
                <button
                  class="text-[10px] font-bold text-rose-400 group flex items-center gap-1.5 transition-all hover:text-rose-300 uppercase tracking-widest"
                  onclick={handleCancelAll}
                  title="Stop all active downloads"
                >
                  <div
                    class="w-1 h-1 rounded-full bg-rose-400 animate-pulse"
                  ></div>
                  Cancel All
                </button>
              {/if}

              {#if queue.some((t) => t.status === "failed" || t.status === "cancelled")}
                <button
                  class="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-widest"
                  onclick={handleRetryAll}
                  title="Restart stopped downloads"
                >
                  Retry All
                </button>
              {/if}

              {#if queue.some( (t) => ["completed", "failed", "cancelled"].includes(t.status), )}
                <button
                  class="text-[10px] font-bold text-slate-500 hover:text-rose-400 transition-colors uppercase tracking-widest"
                  onclick={handleClearFinished}
                  title="Remove stopped/finished items from list"
                >
                  Clear Finished
                </button>
              {/if}
            </div>
          {/if}
        </div>

        {#if queue.length === 0}
          <div
            class="flex flex-col items-center justify-center py-20 bg-slate-900/30 rounded-3xl border border-dashed border-slate-800"
            in:fade
          >
            <div class="p-6 bg-slate-800/50 rounded-full mb-4">
              <svg
                class="w-12 h-12 text-slate-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>
            <p class="text-slate-400 font-medium">No active downloads</p>
            <p class="text-slate-600 text-sm mt-1">
              Paste a URL above to start downloading
            </p>
          </div>
        {:else}
          <div class="grid gap-3" in:fade>
            {#each queue as item (item.id)}
              <DownloadItem
                {item}
                onCancel={handleCancel}
                onRetry={handleRetry}
                onRemove={handleRemoveFromQueue}
                isMenuOpen={activeMenuId === item.id}
                onToggleMenu={(open) => (activeMenuId = open ? item.id : null)}
              />
            {/each}
          </div>
        {/if}
      {:else}
        <div class="flex items-center justify-between px-2">
          <h2
            class="text-sm font-bold text-slate-400 uppercase tracking-widest"
          >
            Recent History
          </h2>
          <button
            class="text-[10px] font-bold text-slate-500 hover:text-rose-400 transition-colors uppercase tracking-widest"
            onclick={handleClearHistory}
          >
            Clear All
          </button>
        </div>

        {#if history.length === 0}
          <div
            class="flex flex-col items-center justify-center py-20 bg-slate-900/30 rounded-3xl border border-dashed border-slate-800"
            in:fade
          >
            <p class="text-slate-500 font-medium">Download history is empty</p>
          </div>
        {:else}
          <div class="grid gap-3" in:fade>
            {#each history as item (item.id)}
              <DownloadItem
                {item}
                onCancel={handleCancel}
                onRetry={handleRetry}
                onRemove={handleRemove}
                isMenuOpen={activeMenuId === item.id}
                onToggleMenu={(open) => (activeMenuId = open ? item.id : null)}
              />
            {/each}
          </div>
        {/if}
      {/if}
    </div>
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
