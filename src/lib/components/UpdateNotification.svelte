<script lang="ts">
  import { onMount } from "svelte";
  import { fade, fly } from "svelte/transition";

  type UpdateStatus =
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";

  let status = $state<UpdateStatus>("idle");
  let version = $state<string | null>(null);
  let progress = $state(0);
  let visible = $state(false);

  onMount(() => {
    const unsubscribe = window.electronAPI.update.onStatusChange(
      (updateState: any) => {
        console.log("[Notification] Received update status:", updateState);
        if (updateState.status === "available") {
          status = "available";
          version = updateState.version;
          visible = true;
        } else if (updateState.status === "downloading") {
          status = "downloading";
          progress = Math.round(updateState.progress);
          // Keep visible if it was already visible or if we want to show progress
          if (!visible) visible = true;
        } else if (updateState.status === "downloaded") {
          status = "downloaded";
          version = updateState.version;
          visible = true;
        } else if (updateState.status === "not-available") {
          // Don't show anything for "not available" globally, that's annoying
        } else if (updateState.status === "error") {
          // Optional: show error? Maybe not on startup.
        }
      }
    );

    return () => unsubscribe();
  });

  function download() {
    window.electronAPI.update.download();
  }

  function install() {
    window.electronAPI.update.install();
  }

  function close() {
    visible = false;
  }
</script>

{#if visible}
  <div
    transition:fly={{ y: 50, duration: 300 }}
    class="fixed bottom-6 right-6 z-50 w-80 bg-gray-900 border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden font-sans"
  >
    <!-- Header / Title -->
    <div
      class="px-4 py-3 bg-white/5 border-b border-white/5 flex items-center justify-between"
    >
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
        <span class="text-xs font-bold text-white uppercase tracking-wider"
          >Software Update</span
        >
      </div>
      <button
        onclick={close}
        class="text-slate-500 hover:text-white transition-colors"
        aria-label="Close"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>

    <!-- Content -->
    <div class="p-4">
      {#if status === "available"}
        <div class="flex flex-col gap-3">
          <div>
            <h4 class="text-sm font-bold text-white">New Version Available</h4>
            <p class="text-xs text-slate-400">
              Version {version} is ready to download.
            </p>
          </div>
          <button
            onclick={download}
            class="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Download Update
          </button>
        </div>
      {:else if status === "downloading"}
        <div class="space-y-3">
          <div class="flex justify-between items-end">
            <span class="text-sm font-medium text-white">Downloading...</span>
            <span class="text-xs font-mono text-blue-400">{progress}%</span>
          </div>
          <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              class="bg-blue-500 h-full transition-all duration-200 ease-out"
              style="width: {progress}%"
            ></div>
          </div>
        </div>
      {:else if status === "downloaded"}
        <div class="flex flex-col gap-3">
          <div>
            <h4 class="text-sm font-bold text-white">Update Ready</h4>
            <p class="text-xs text-slate-400">
              Restart now to apply the update.
            </p>
          </div>
          <div class="flex gap-2">
            <button
              onclick={install}
              class="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg transition-colors"
            >
              Restart
            </button>
            <button
              onclick={close}
              class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg transition-colors"
            >
              Later
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
