<script lang="ts">
  import DangerSettings from "./DangerSettings.svelte";
  import type { SettingsModel } from "./createSettingsModel.svelte";
  let { model }: { model: SettingsModel } = $props();
</script>

<section>
  <h2
    class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
  >
    Data Management
  </h2>

  <div
    class="space-y-1 bg-slate-800/[0.28] rounded-2xl border border-slate-700/45 overflow-hidden"
  >
    <!-- Backup -->
    <div data-setting="backup" class="group p-5 hover:bg-white/[0.015] transition-colors">
      <div class="flex items-center justify-between">
        <div class="flex flex-col">
          <span
            class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
            >Backup / Export</span
          >
          <span class="text-sm text-slate-500"
            >Save your reading progress and favorites to a JSON file</span
          >
        </div>
        <button
          onclick={model.handleBackup}
          disabled={model.loading}
          class="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-medium rounded-lg transition-colors border border-emerald-500/20 active:scale-95 disabled:opacity-50"
        >
          Backup
        </button>
      </div>

      <!-- Backup Options -->
      <div
        class="mt-4 flex flex-col gap-3 p-4 bg-emerald-500/[0.03] rounded-2xl border border-emerald-500/10 shadow-inner"
      >
        <!-- Include Download History -->
        <label data-setting="backup-history" class="flex items-center justify-between cursor-pointer">
          <div class="flex flex-col gap-0.5">
            <span id="setting-backup-history-label" class="text-sm font-semibold text-slate-200"
              >Include Download History</span
            >
            <span class="text-xs text-slate-500"
              >Include completed downloads and queue items</span
            >
          </div>
          <input
            type="checkbox"
            role="switch"
            aria-labelledby="setting-backup-history-label"
            bind:checked={model.includeDownloadHistory}
            class="sr-only"
          />
          <div
            class="relative shrink-0 w-10 h-6 rounded-full transition-colors duration-200 cursor-pointer {model.includeDownloadHistory
              ? 'bg-emerald-500'
              : 'bg-slate-700'}"
          >
            <div
              class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform duration-200 {model.includeDownloadHistory
                ? 'translate-x-4'
                : 'translate-x-0'}"
            ></div>
          </div>
        </label>

        {#if model.includeDownloadHistory}
          <!-- Connector Line -->
          <div class="flex gap-4">
            <div class="ml-4 w-px bg-emerald-500/20 rounded-full"></div>

            <!-- Include Download Logs -->
            <label data-setting="backup-logs" class="flex-1 flex items-center justify-between py-1 cursor-pointer">
              <div class="flex flex-col gap-0.5">
                <span id="setting-backup-logs-label" class="text-xs font-medium text-slate-400"
                  >Include Detailed Logs</span
                >
                <span class="text-[10px] text-slate-500"
                  >Include full execution logs for each download</span
                >
              </div>
              <input
                type="checkbox"
                role="switch"
                aria-labelledby="setting-backup-logs-label"
                bind:checked={model.includeDownloadLogs}
                class="sr-only"
              />
              <div
                class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200 cursor-pointer {model.includeDownloadLogs
                  ? 'bg-emerald-500'
                  : 'bg-slate-800'}"
              >
                <div
                  class="absolute left-1 top-1 bg-white w-3 h-3 rounded-full shadow-sm transition-transform duration-200 {model.includeDownloadLogs
                    ? 'translate-x-4'
                    : 'translate-x-0'}"
                ></div>
              </div>
            </label>
          </div>
        {/if}
      </div>
    </div>

    <div class="h-px bg-white/[0.06] mx-5"></div>

    <!-- Restore -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div data-setting="restore"
      class="group relative flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors overflow-hidden"
      class:bg-blue-500_10={model.isDragging}
      ondragenter={() => (model.isDragging = true)}
      ondragover={(e) => e.preventDefault()}
      ondragleave={(e) => {
        // Check if we're moving to a child element to prevent flashing
        const relatedTarget = e.relatedTarget as Node;
        if (
          !relatedTarget ||
          !e.currentTarget.contains(relatedTarget)
        ) {
          model.isDragging = false;
        }
      }}
      ondrop={model.handleDrop}
    >
      <!-- Drag Overlay -->
      {#if model.isDragging}
        <div
          class="absolute inset-0 bg-blue-500/20 flex items-center justify-center z-10 backdrop-blur-[1px] border border-blue-500/30"
        >
          <div
            class="bg-blue-950/90 text-blue-200 px-4 py-2 rounded-xl shadow-xl border border-blue-500/30 font-medium flex items-center gap-2 pointer-events-none"
          >
            <svg
              class="w-5 h-5 animate-bounce"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              /></svg
            >
            Drop to Restore
          </div>
        </div>
      {/if}

      <div class="flex flex-col relative z-0">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Restore / Relocate</span
        >
        <span class="text-sm text-slate-500"
          >Restore data or apply it to a new location</span
        >
        <span
          class="text-xs text-blue-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
        >
          <svg
            class="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            /></svg
          >
          Drag & Drop backup file here
        </span>
      </div>
      <button
        onclick={() => model.handleRestore()}
        disabled={model.loading}
        class="relative z-0 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-medium rounded-lg transition-colors border border-blue-500/20 active:scale-95 disabled:opacity-50"
      >
        Restore
      </button>
    </div>

    <div class="h-px bg-white/[0.06] mx-5"></div>

    <!-- Import Tags -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div data-setting="import"
      class="group relative flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors overflow-hidden"
      class:bg-blue-500_10={model.isDragging}
      ondragenter={() => (model.isDragging = true)}
      ondragover={(e) => e.preventDefault()}
      ondragleave={() => (model.isDragging = false)}
      onpointerup={() => (model.isDragging = false)}
      ondrop={model.handleDrop}
    >
      {#if model.isDragging}
        <div
          class="absolute inset-0 bg-blue-500/10 flex items-center justify-center z-10"
        >
          <div
            class="flex items-center gap-2 text-blue-400 font-bold uppercase tracking-wider text-xs"
          >
            <svg
              class="w-5 h-5 animate-bounce"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              /></svg
            >
            Drop Tags File
          </div>
        </div>
      {/if}

      <div class="flex flex-col relative z-0">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Import Metadata</span
        >
        <span class="text-sm text-slate-500"
          >Restore tags, categories, and types from export file</span
        >
      </div>
      <button
        onclick={() => model.handleImportTags()}
        disabled={model.loading}
        class="relative z-0 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-medium rounded-lg transition-colors border border-blue-500/20 active:scale-95 disabled:opacity-50"
      >
        Import
      </button>
    </div>

    <div class="h-px bg-white/[0.06] mx-5"></div>

    <!-- Tag Export -->
    <div data-setting="export"
      class="group flex flex-col p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex items-center justify-between mb-6">
        <div class="flex flex-col">
          <span
            class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
            >Export Metadata</span
          >
          <span class="text-sm text-slate-500"
            >Export tags, categories, and types with item associations</span
          >
        </div>
        <button
          onclick={model.handleExportTags}
          disabled={model.loading}
          class="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-medium rounded-lg transition-colors border border-blue-500/20 active:scale-95 disabled:opacity-50"
        >
          Export
        </button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-2">
        <!-- Include Descriptions -->
        <label data-setting="descriptions"
          class="flex items-center gap-3 cursor-pointer group/label"
        >
          <div class="relative flex items-center">
            <input
              type="checkbox"
              bind:checked={model.includeDescription}
              class="peer sr-only"
            />
            <div
              class="w-10 h-6 bg-slate-700 peer-checked:bg-blue-600 rounded-full transition-colors"
            ></div>
            <div
              class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4"
            ></div>
          </div>
          <span
            class="text-xs font-medium text-slate-400 group-hover/label:text-slate-200 transition-colors"
          >
            Include Descriptions
          </span>
        </label>

        <!-- Include Keywords -->
        <label data-setting="keywords"
          class="flex items-center gap-3 cursor-pointer group/label"
        >
          <div class="relative flex items-center">
            <input
              type="checkbox"
              bind:checked={model.includeKeywords}
              class="peer sr-only"
            />
            <div
              class="w-10 h-6 bg-slate-700 peer-checked:bg-blue-600 rounded-full transition-colors"
            ></div>
            <div
              class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4"
            ></div>
          </div>
          <span
            class="text-xs font-medium text-slate-400 group-hover/label:text-slate-200 transition-colors"
          >
            Include Keywords
          </span>
        </label>

        <!-- Include Default Tags -->
        <label data-setting="default-tags"
          class="flex items-center gap-3 cursor-pointer group/label"
        >
          <div class="relative flex items-center">
            <input
              type="checkbox"
              bind:checked={model.includeDefaultTags}
              class="peer sr-only"
            />
            <div
              class="w-10 h-6 bg-slate-700 peer-checked:bg-blue-600 rounded-full transition-colors"
            ></div>
            <div
              class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4"
            ></div>
          </div>
          <span
            class="text-xs font-medium text-slate-400 group-hover/label:text-slate-200 transition-colors"
          >
            Include Default Tags
          </span>
        </label>
      </div>

      <!-- Exclude Categories -->
      {#if model.allCategories.length > 0}
        <div data-setting="exclude-categories" class="mt-6 pt-6 border-t border-slate-700/50">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-4">
              <p
                class="text-[10px] font-bold text-slate-500 uppercase tracking-wider"
              >
                Exclude Categories
              </p>
              {#if model.showExcludedCategories}
                <div class="flex items-center gap-2">
                  <button
                    onclick={model.selectAllCategories}
                    type="button"
                    class="text-[10px] font-bold text-slate-400 hover:text-slate-200 transition-colors uppercase tracking-wider"
                  >
                    Select All
                  </button>
                  <span class="text-[10px] text-slate-700">|</span>
                  <button
                    onclick={model.deselectAllCategories}
                    type="button"
                    class="text-[10px] font-bold text-slate-400 hover:text-slate-200 transition-colors uppercase tracking-wider"
                  >
                    Deselect All
                  </button>
                </div>
              {/if}
            </div>
            <button
              onclick={() =>
                (model.showExcludedCategories = !model.showExcludedCategories)}
              type="button"
              class="text-[10px] font-bold text-blue-500 hover:text-blue-400 transition-colors uppercase tracking-wider flex items-center gap-1"
            >
              <span>{model.showExcludedCategories ? "Hide" : "Show"}</span>
              <svg
                class="w-3 h-3 transition-transform {model.showExcludedCategories
                  ? 'rotate-180'
                  : ''}"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </div>

          {#if model.showExcludedCategories}
            <div class="flex flex-wrap gap-2">
              {#each model.allCategories as cat}
                <button
                  onclick={() => model.toggleCategoryExclusion(cat.id)}
                  type="button"
                  class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border {model.excludedCategoryIds.includes(
                    cat.id,
                  )
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                    : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'}"
                >
                  {cat.name}
                </button>
              {/each}
            </div>
            <p class="mt-2 text-[10px] text-slate-500 italic">
              Selected categories and their tags will be omitted from
              the export.
            </p>
          {/if}
        </div>
      {/if}

      <!-- Types Export Options -->
      <div data-setting="types" class="mt-6 pt-6 border-t border-slate-700/50">
        <p
          class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-4"
        >
          Types Options
        </p>
        <div class="flex items-center gap-4 mb-4">
          <label
            class="flex items-center gap-3 cursor-pointer group/label"
          >
            <div class="relative flex items-center">
              <input
                type="checkbox"
                bind:checked={model.includeTypes}
                class="peer sr-only"
              />
              <div
                class="w-10 h-6 bg-slate-700 peer-checked:bg-blue-600 rounded-full transition-colors"
              ></div>
              <div
                class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4"
              ></div>
            </div>
            <span
              class="text-xs font-medium text-slate-400 group-hover/label:text-slate-200 transition-colors"
            >
              Include Types
            </span>
          </label>

          {#if model.includeTypes}
            <label data-setting="default-types"
              class="flex items-center gap-3 cursor-pointer group/label"
            >
              <div class="relative flex items-center">
                <input
                  type="checkbox"
                  bind:checked={model.includeDefaultTypes}
                  class="peer sr-only"
                />
                <div
                  class="w-10 h-6 bg-slate-700 peer-checked:bg-blue-600 rounded-full transition-colors"
                ></div>
                <div
                  class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4"
                ></div>
              </div>
              <span
                class="text-xs font-medium text-slate-400 group-hover/label:text-slate-200 transition-colors"
              >
                Include Default Types
              </span>
            </label>
          {/if}
        </div>

        {#if model.includeTypes && model.allTypes.length > 0}
          <div data-setting="exclude-types" class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-4">
              <p
                class="text-[10px] font-bold text-slate-500 uppercase tracking-wider"
              >
                Exclude Types
              </p>
              {#if model.showExcludedTypes}
                <div class="flex items-center gap-2">
                  <button
                    onclick={model.selectAllTypes}
                    type="button"
                    class="text-[10px] font-bold text-slate-400 hover:text-slate-200 transition-colors uppercase tracking-wider"
                  >
                    Select All
                  </button>
                  <span class="text-[10px] text-slate-700">|</span>
                  <button
                    onclick={model.deselectAllTypes}
                    type="button"
                    class="text-[10px] font-bold text-slate-400 hover:text-slate-200 transition-colors uppercase tracking-wider"
                  >
                    Deselect All
                  </button>
                </div>
              {/if}
            </div>
            <button
              onclick={() => (model.showExcludedTypes = !model.showExcludedTypes)}
              type="button"
              class="text-[10px] font-bold text-blue-500 hover:text-blue-400 transition-colors uppercase tracking-wider flex items-center gap-1"
            >
              <span>{model.showExcludedTypes ? "Hide" : "Show"}</span>
              <svg
                class="w-3 h-3 transition-transform {model.showExcludedTypes
                  ? 'rotate-180'
                  : ''}"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </div>

          {#if model.showExcludedTypes}
            <div class="flex flex-wrap gap-2">
              {#each model.allTypes as type}
                <button
                  onclick={() => model.toggleTypeExclusion(type.id)}
                  type="button"
                  class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border {model.excludedTypeIds.includes(
                    type.id,
                  )
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                    : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'}"
                >
                  {type.name}
                </button>
              {/each}
            </div>
            <p class="mt-2 text-[10px] text-slate-500 italic">
              Selected types will be omitted from the export.
            </p>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</section>

<DangerSettings {model} />
