<script lang="ts">
  let { onClear, searchFailed = false }: { onClear: () => void; searchFailed?: boolean } = $props();
</script>

<div class="flex flex-col items-center justify-center h-full text-center p-8">
  <svg
    class="w-16 h-16 mb-4 shrink-0 text-slate-600"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle cx="10.5" cy="10.5" r="6.5" stroke-width="1.5" />
    <path d="m16 16 4.5 4.5M8 10.5h5" stroke-width="1.5" stroke-linecap="round" />
  </svg>
  <div role="status">
    <h2 class="text-2xl font-bold text-white mb-2">{searchFailed ? "Search unavailable" : "No matching items"}</h2>
    <p class="text-slate-400 max-w-md">{searchFailed ? "Clear the search and try again." : "Try a different search or clear your filters."}</p>
  </div>
  <button
    class="mt-6 px-4 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
    onclick={onClear}
  >Clear search and filters</button>
</div>
