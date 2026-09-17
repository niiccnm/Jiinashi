<script lang="ts">
  import type { SettingsModel } from "./createSettingsModel.svelte";
  let { model }: { model: SettingsModel } = $props();
</script>

<section data-setting="locations">
  <h2
    class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
  >
    Library Locations
  </h2>

  <div
    class="bg-slate-800/[0.28] rounded-2xl border border-slate-700/45 overflow-hidden"
  >
    <!-- Library Sort Order -->
    <div data-setting="folder-sort"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex flex-col">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Folder Sort Order</span
        >
        <span class="text-sm text-slate-500"
          >How library folders are displayed in the switcher</span
        >
      </div>
      <div class="relative">
        <select
          value={model.settings["librarySortOrder"] || "alphabetical"}
          onchange={(e) =>
            model.updateSetting("librarySortOrder", e.currentTarget.value)}
          class="appearance-none bg-slate-900/50 text-slate-200 pl-4 pr-10 py-2 rounded-lg border border-white/10 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none transition-all cursor-pointer hover:bg-slate-900"
        >
          <option value="alphabetical">Alphabetical</option>
          <option value="imported">Import Order</option>
        </select>
        <div
          class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 9l-7 7-7-7"
            /></svg
          >
        </div>
      </div>
    </div>

    <div class="h-px bg-white/[0.06] mx-5"></div>

    {#if model.libraryRoots.length === 0}
      <div class="p-8 text-center text-slate-500 text-sm">
        No library locations found. Import a folder to get started.
      </div>
    {:else}
      {#each model.libraryRoots as root, i}
        <div
          class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors {i !==
          model.libraryRoots.length - 1
            ? 'border-b border-white/[0.06]'
            : ''}"
        >
          <div class="flex flex-col overflow-hidden mr-4">
            <span
              class="text-base font-medium text-slate-200 group-hover:text-white transition-colors truncate"
              title={root}>{root}</span
            >
            <span class="text-xs text-slate-500">Source Folder</span>
          </div>
          <button
            onclick={() => model.handleRemoveRoot(root)}
            disabled={model.loading}
            class="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-sm font-medium rounded-lg transition-colors border border-rose-500/20 active:scale-95 disabled:opacity-50 shrink-0"
          >
            Remove
          </button>
        </div>
      {/each}
    {/if}
  </div>
</section>
