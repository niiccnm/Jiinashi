<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";

  let isIncognito = $state(false);

  onMount(() => {
    // Initial check
    window.electronAPI.manga.getIncognito().then((val) => (isIncognito = val));

    // Listen for changes (assuming we emit this event)
    const unsubscribe = window.electronAPI.downloader.onQueueUpdate(() => {
      // Periodic check or event-based
      window.electronAPI.manga
        .getIncognito()
        .then((val) => (isIncognito = val));
    });

    return unsubscribe;
  });
</script>

{#if isIncognito}
  <div
    transition:fade
    class="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg shadow-lg shadow-black/20"
    title="Incognito Mode Active: Automatic reading progress will not be synced to MAL/AniList; manual status edits still sync"
  >
    <div class="relative">
      <svg
        class="w-4 h-4 text-slate-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
        />
      </svg>
      <div
        class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"
      ></div>
    </div>
    <span
      class="text-[10px] font-bold text-slate-400 uppercase tracking-widest cursor-default"
    >
      Incognito
    </span>
  </div>
{/if}
