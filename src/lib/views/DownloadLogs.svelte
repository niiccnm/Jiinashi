<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  let taskId = $state<number | null>(null);
  let task = $state<any>(null);
  let logs = $state<string[]>([]);

  let unsubscribe: (() => void) | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  let showCopiedFeedback = $state(false);

  function updateFromQueue(queue: any[]) {
    if (taskId === null) return;
    task = queue.find((t: any) => t.id === taskId) || null;
  }

  async function refreshLogs() {
    if (taskId === null) return;
    try {
      // @ts-ignore
      logs = await window.electronAPI.downloader.getTaskLogs(taskId);
    } catch (e) {
      logs = [];
    }
  }

  function copyLogs() {
    if (logs.length === 0) return;
    const textToCopy = logs.join("\n");
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        showCopiedFeedback = true;
        setTimeout(() => {
          showCopiedFeedback = false;
        }, 2000);
      })
      .catch((err) => {
        console.error("Failed to copy logs:", err);
      });
  }

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    const tid = params.get("taskId");
    taskId = tid ? parseInt(tid, 10) : null;

    try {
      // @ts-ignore
      const queue = await window.electronAPI.downloader.getQueue();
      updateFromQueue(queue);
    } catch (e) {}

    await refreshLogs();

    // @ts-ignore
    unsubscribe = window.electronAPI.downloader.onQueueUpdate((q: any[]) => {
      updateFromQueue(q);

      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshLogs();
      }, 200);
    });
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  });
</script>

<div class="h-full w-full bg-[#030712] text-slate-200 flex flex-col font-sans">
  <header
    class="shrink-0 border-b border-slate-800/60 px-5 py-4 bg-slate-900/40 backdrop-blur-md"
  >
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 mb-0.5">
          <span
            class="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono uppercase tracking-wider border border-slate-700/50"
          >
            ID: {taskId ?? "?"}
          </span>
          {#if task?.source}
            <span
              class="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border border-blue-500/20"
            >
              {task.source}
            </span>
          {/if}
        </div>
        <div
          class="text-sm font-bold text-white truncate"
          title={task?.title || ""}
        >
          {task?.title || "Download Logs"}
        </div>
        {#if task?.status}
          <div class="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
            <span
              class="w-1.5 h-1.5 rounded-full {task.status === 'completed'
                ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]'
                : task.status === 'failed' || task.status === 'error'
                  ? 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'
                  : 'bg-blue-500 shadow-[0_0_8px_#3b82f6] animate-pulse'}"
            ></span>
            {task.status}
          </div>
        {/if}
      </div>

      <div class="flex flex-col items-end gap-3">
        <button
          onclick={copyLogs}
          disabled={logs.length === 0}
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 text-[11px] font-bold uppercase tracking-wider transition-all border border-slate-700/50 hover:bg-slate-700 hover:text-white disabled:opacity-30 disabled:pointer-events-none group active:scale-95 {showCopiedFeedback
            ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
            : 'text-slate-400'}"
        >
          {#if showCopiedFeedback}
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2.5"
                d="M5 13l4 4L19 7"
              />
            </svg>
            Copied!
          {:else}
            <svg
              class="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
              />
            </svg>
            Copy Logs
          {/if}
        </button>

        {#if task?.progress}
          <div
            class="text-[10px] text-slate-400 font-mono bg-slate-900/80 px-2 py-1 rounded border border-slate-800/50"
          >
            {task.progress.current || 0}/{task.progress.total || 0} ({task
              .progress.percent || 0}%)
          </div>
        {/if}
      </div>
    </div>
  </header>

  <div class="flex-1 overflow-auto p-5 custom-scrollbar">
    <div
      class="font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words text-slate-300"
    >
      {#if logs && logs.length}
        {#each logs as line, idx (idx)}
          <div class="hover:bg-white/5 px-1 -mx-1 rounded transition-colors">
            {line}
          </div>
        {/each}
      {:else}
        <div
          class="flex flex-col items-center justify-center h-40 text-slate-500 italic gap-2"
        >
          <svg
            class="w-8 h-8 opacity-20"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          No logs available for this task yet.
        </div>
      {/if}
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
    border-radius: 9999px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.1);
  }
</style>
