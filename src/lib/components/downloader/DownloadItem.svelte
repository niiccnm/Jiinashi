<script module lang="ts">
  const coverCache = new Map<string, string>();

  const sourceIcons: Record<string, string> = {
    nhentai: "icons/sources/nhentai.png",
    hitomi: "icons/sources/hitomi.png",
    "e-hentai": "icons/sources/exhentai.png",
    exhentai: "icons/sources/exhentai.png",
  };
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { fade } from "svelte/transition";

  interface Progress {
    item: any;
    current: number;
    total: number;
    percent: number;
  }

  let { item, onCancel, onRetry, onRemove, isMenuOpen, onToggleMenu } = $props<{
    item: any;
    onCancel?: (id: number) => void;
    onRetry?: (id: number) => void;
    onRemove?: (id: number) => void;
    isMenuOpen: boolean;
    onToggleMenu: (open: boolean) => void;
  }>();

  // Initialize from cache synchronously to prevent flicker on re-mount
  let resolvedCover = $state<string | null>(
    untrack(() =>
      item.cover_url && coverCache.has(item.cover_url)
        ? coverCache.get(item.cover_url)!
        : null,
    ),
  );

  function toggleMenu(e: MouseEvent) {
    e.stopPropagation();
    onToggleMenu(!isMenuOpen);
  }

  $effect(() => {
    if (isMenuOpen) {
      const handleOutsideClick = () => {
        onToggleMenu(false);
      };
      window.addEventListener("click", handleOutsideClick);
      return () => window.removeEventListener("click", handleOutsideClick);
    }
  });

  $effect(() => {
    // Live preview during download
    if (
      item.preview_data &&
      (item.status === "downloading" || item.status === "zipping")
    ) {
      resolvedCover = item.preview_data;
      return;
    }

    // Reset if URL changes (and we aren't in a live preview mode)
    if (
      resolvedCover &&
      item.cover_url &&
      resolvedCover !== item.cover_url &&
      !resolvedCover.startsWith("data:")
    ) {
      resolvedCover = null;
    }

    if (!resolvedCover) {
      // 1. Check cache first
      if (item.cover_url && coverCache.has(item.cover_url)) {
        resolvedCover = coverCache.get(item.cover_url)!;
        return;
      }

      // 2. Try local cover for completed items
      const localPath = item.file_path || item.outputPath;
      if (item.status === "completed" && localPath) {
        // @ts-ignore
        window.electronAPI.downloader
          .getLocalCover(localPath)
          .then((cover: string | null) => {
            if (cover) {
              resolvedCover = cover;
              if (item.cover_url) coverCache.set(item.cover_url, cover);
            }
            // Fallback to remote if local fails
            else if (item.cover_url) resolveRemote();
          });
      } else if (item.cover_url) {
        resolveRemote();
      }
    }
  });

  function resolveRemote() {
    if (!item.cover_url) return;
    // @ts-ignore
    window.electronAPI.downloader
      .proxyImage(item.cover_url, item.source)
      .then((proxied: string | null) => {
        if (proxied) {
          resolvedCover = proxied;
          coverCache.set(item.cover_url, proxied);
        } else {
          resolvedCover = item.cover_url;
        }
      });
  }

  const statusColors: Record<string, string> = {
    pending: "bg-slate-700 text-slate-300",
    parsing: "bg-blue-900/50 text-blue-300 border-blue-500/30",
    downloading: "bg-indigo-900/50 text-indigo-300 border-indigo-500/30",
    zipping: "bg-purple-900/50 text-purple-300 border-purple-500/30",
    completed: "bg-emerald-900/50 text-emerald-300 border-emerald-500/30",
    failed: "bg-rose-900/50 text-rose-300 border-rose-500/30",
    error: "bg-rose-900/50 text-rose-300 border-rose-500/30",
    cancelled: "bg-slate-900/50 text-slate-400 border-slate-700/30",
    verification: "bg-amber-900/50 text-amber-300 border-amber-500/30",
  };

  const statusLabels: Record<string, string> = {
    pending: "Waiting...",
    parsing: "Parsing...",
    downloading: "Downloading...",
    zipping: "Zipping...",
    completed: "Finished",
    failed: "Failed",
    error: "Failed",
    cancelled: "Cancelled",
    verification: "Verifying...",
  };

  function openLogs(e: MouseEvent) {
    e.stopPropagation();
    onToggleMenu(false);
    // @ts-ignore
    window.electronAPI.downloader.openLogs(item.id);
  }
</script>

<div
  class="relative bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4 flex gap-4 items-center group transition-all duration-200 hover:bg-slate-800/60 min-w-0 {isMenuOpen
    ? 'z-50'
    : 'z-auto'} {item.status === 'failed' || item.status === 'error'
    ? 'border-rose-500/20'
    : item.status === 'cancelled'
      ? 'border-slate-700/20'
      : ''}"
>
  <!-- Cover Thumbnail -->
  <div
    class="w-16 h-24 rounded-lg bg-slate-900 overflow-hidden shrink-0 shadow-lg border border-white/5 {item.status ===
    'cancelled'
      ? 'opacity-60'
      : ''}"
  >
    {#if resolvedCover}
      <img
        src={resolvedCover}
        alt=""
        class="w-full h-full object-cover"
        draggable="false"
      />
    {:else}
      <div
        class="w-full h-full flex items-center justify-center text-slate-700"
      >
        <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
          <path
            d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"
          />
        </svg>
      </div>
    {/if}
  </div>

  <!-- Content Info -->
  <div
    class="flex-1 min-w-0 flex flex-col gap-1.5 {item.status === 'cancelled'
      ? 'opacity-60'
      : ''}"
  >
    <div class="flex items-start justify-between gap-2 min-w-0">
      <h3
        class="text-sm font-bold text-white truncate flex-1 min-w-0"
        title={item.title}
      >
        {item.title}
      </h3>
      <span
        class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border {statusColors[
          item.status
        ] || 'bg-slate-700 text-slate-300'}"
      >
        {statusLabels[item.status] || item.status}
      </span>
    </div>

    <div class="flex items-center gap-3 text-xs text-slate-500">
      <button
        onclick={(e) => {
          e.stopPropagation();
          // @ts-ignore
          if (item.url) window.electronAPI.utils.openExternal(item.url);
        }}
        class="flex items-center gap-1.5 font-medium bg-slate-900/50 pl-1.5 pr-2 py-0.5 rounded border border-slate-700/30 uppercase tracking-tight hover:bg-slate-800 transition-colors cursor-pointer group/source"
        title="Open in browser"
      >
        {#if sourceIcons[item.source]}
          <img
            src={sourceIcons[item.source]}
            alt={item.source}
            class="w-3.5 h-3.5 object-contain opacity-80 group-hover/source:opacity-100"
          />
        {/if}
        <span>{item.source}</span>
      </button>

      {#if item.status === "downloading" || item.status === "zipping"}
        <span class="font-mono text-blue-400">
          {item.progress?.current || 0} / {item.progress?.total || "?"}
        </span>
        {#if item.speed}
          <span class="font-mono text-slate-300">{item.speed}</span>
        {/if}
      {/if}
    </div>

    <!-- Progress Bar -->
    <div
      class="mt-1 w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-white/5"
    >
      <div
        class="h-full transition-all duration-300 {item.status === 'failed' ||
        item.status === 'error'
          ? 'bg-rose-500'
          : item.status === 'cancelled'
            ? 'bg-slate-600'
            : item.status === 'completed'
              ? 'bg-emerald-500'
              : 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]'}"
        style="width: {item.status === 'completed'
          ? 100
          : item.progress?.percent || 0}%"
      ></div>
    </div>

    {#if (item.error_message || item.errorMessage) && item.status !== "cancelled"}
      <p class="text-[11px] text-rose-400 truncate mt-0.5 leading-tight">
        {item.error_message || item.errorMessage}
      </p>
    {:else if item.status === "cancelled"}
      <p
        class="text-[11px] text-slate-500 truncate mt-0.5 leading-tight italic"
      >
        Download cancelled
      </p>
    {/if}
  </div>

  <!-- Actions -->
  <div
    class="flex items-center gap-1 transition-opacity {isMenuOpen
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100'}"
  >
    <div class="relative">
      <button
        onclick={toggleMenu}
        class="p-2 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded-xl transition-all"
        title="Menu"
      >
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>

      {#if isMenuOpen}
        <div
          class="absolute right-0 mt-2 w-44 bg-slate-950/95 border border-slate-700/50 rounded-xl shadow-xl overflow-hidden z-50"
          transition:fade={{ duration: 120 }}
        >
          <button
            class="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
            onclick={openLogs}
          >
            Logs
          </button>

          {#if item.status !== "completed" && item.status !== "failed" && item.status !== "cancelled"}
            <button
              class="w-full text-left px-3 py-2 text-sm text-rose-300 hover:bg-rose-400/10"
              onclick={(e) => {
                e.stopPropagation();
                onToggleMenu(false);
                onCancel?.(item.id);
              }}
            >
              Cancel
            </button>
          {/if}

          {#if item.status === "failed" || item.status === "error" || item.status === "cancelled"}
            <button
              class="w-full text-left px-3 py-2 text-sm text-blue-300 hover:bg-blue-400/10"
              onclick={(e) => {
                e.stopPropagation();
                onToggleMenu(false);
                onRetry?.(item.id);
              }}
            >
              Retry
            </button>
          {/if}

          {#if onRemove}
            <button
              class="w-full text-left px-3 py-2 text-sm text-rose-300 hover:bg-rose-400/10"
              onclick={(e) => {
                e.stopPropagation();
                onToggleMenu(false);
                onRemove?.(item.id);
              }}
            >
              Remove
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
