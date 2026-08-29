<script lang="ts">
  import Dialog from "../../Dialog.svelte";

  let {
    open = false,
    selectedSeries = null,
    getSeriesTitle,
    isTrackingEditorSaving = false,
    isTrackingEditorRemoving = false,
    isTrackingEditorHydrating = false,
    trackingEditorError = "",
    trackingEditorServices = [],
    showSyncBothSitesToggle = false,
    syncBothSitesEnabled = true,
    trackingEditorActiveService = null,
    closeTrackingEditor,
    setTrackingEditorActiveService,
    setTrackingEditorSyncBothSitesEnabled,
    updateTrackingEditorField,
    saveTrackingEditor,
    removeTrackingEditorEntry,
  }: {
    open?: boolean;
    selectedSeries?: any;
    getSeriesTitle: (item: any) => string;
    isTrackingEditorSaving?: boolean;
    isTrackingEditorRemoving?: boolean;
    isTrackingEditorHydrating?: boolean;
    trackingEditorError?: string;
    trackingEditorServices?: any[];
    showSyncBothSitesToggle?: boolean;
    syncBothSitesEnabled?: boolean;
    trackingEditorActiveService?: any | null;
    closeTrackingEditor: () => void;
    setTrackingEditorActiveService: (service: "anilist" | "mal") => void;
    setTrackingEditorSyncBothSitesEnabled: (enabled: boolean) => void;
    updateTrackingEditorField: (
      service: "anilist" | "mal",
      field: "status" | "progress" | "volumes" | "score",
      value: string,
    ) => void;
    saveTrackingEditor: () => Promise<void>;
    removeTrackingEditorEntry: () => Promise<void>;
  } = $props();

  function canRemoveEntry() {
    if (showSyncBothSitesToggle && syncBothSitesEnabled) {
      return trackingEditorServices.some((serviceForm) => serviceForm?.hasEntry);
    }
    return Boolean(trackingEditorActiveService?.hasEntry);
  }

  function getRemoveButtonLabel() {
    return showSyncBothSitesToggle && syncBothSitesEnabled
      ? "Remove Synced"
      : "Remove";
  }
</script>

<Dialog
  {open}
  title={selectedSeries
    ? `Edit Tracking • ${getSeriesTitle(selectedSeries)}`
    : "Edit Tracking"}
  description="Update your manga list values and sync them with your connected tracking services."
  confirmText=""
  maxWidth="max-w-3xl"
  onConfirm={() => {}}
  onCancel={closeTrackingEditor}
>
  <div class="mt-1 space-y-5">
    <div class="relative min-h-[32px]">
      {#if trackingEditorServices.length > 1}
        <div class="inline-flex rounded-xl border border-slate-700/70 bg-slate-950/70 p-1">
          {#each trackingEditorServices as serviceForm (serviceForm.service)}
            <button
              onclick={() => setTrackingEditorActiveService(serviceForm.service)}
              class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors {trackingEditorActiveService?.service ===
              serviceForm.service
                ? 'bg-blue-500/20 text-blue-200 border border-blue-500/40'
                : 'text-slate-400 hover:text-white border border-transparent'}"
              title={serviceForm.label}
              aria-label={serviceForm.label}
            >
              <img
                src={serviceForm.iconUrl}
                alt={serviceForm.label}
                class="h-3.5 w-3.5 rounded-sm"
              />
              <span>
                {serviceForm.service === "anilist" ? "AL" : "MAL"}
              </span>
            </button>
          {/each}
        </div>
      {/if}

      <div class="pointer-events-none absolute right-0 top-0">
        <div
          class="inline-flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-900/70 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 transition-opacity {isTrackingEditorHydrating
            ? 'opacity-100'
            : 'opacity-0'}"
          aria-hidden={!isTrackingEditorHydrating}
        >
          <svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="3"
            ></circle>
            <path
              class="opacity-90"
              fill="currentColor"
              d="M22 12a10 10 0 00-10-10v3a7 7 0 017 7h3z"
            ></path>
          </svg>
          Syncing latest tracking data
        </div>
      </div>
    </div>

    {#if trackingEditorActiveService}
      {@const service = trackingEditorActiveService.service}
      <div
        class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 md:p-5 space-y-4"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <img
              src={trackingEditorActiveService.iconUrl}
              alt={trackingEditorActiveService.label}
              class="h-4 w-4 rounded-sm"
            />
            <p class="text-sm font-bold text-white">
              {trackingEditorActiveService.label}
            </p>
          </div>
          <div class="flex items-center gap-3">
            <p class="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {#if trackingEditorActiveService.hasEntry}
                List Entry Found
              {:else}
                New Entry
              {/if}
            </p>
            {#if showSyncBothSitesToggle}
              <button
                type="button"
                role="switch"
                aria-checked={syncBothSitesEnabled}
                aria-label={syncBothSitesEnabled
                  ? "Disable sync between AniList and MAL while editing"
                  : "Enable sync between AniList and MAL while editing"}
                title={syncBothSitesEnabled
                  ? "Disable Sync Both"
                  : "Enable Sync Both"}
                onclick={() =>
                  setTrackingEditorSyncBothSitesEnabled(!syncBothSitesEnabled)}
                onkeydown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setTrackingEditorSyncBothSitesEnabled(!syncBothSitesEnabled);
                }}
                class="relative inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors {syncBothSitesEnabled
                  ? 'border-blue-500/45 bg-blue-500/15 text-blue-200'
                  : 'border-slate-700/80 bg-slate-900/70 text-slate-500 hover:text-slate-300'}"
              >
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                  <path
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8 7H6a4 4 0 000 8h2m8-8h2a4 4 0 010 8h-2m-8 0l8-8"
                  ></path>
                </svg>
                <span
                  class="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-slate-950 transition-colors {syncBothSitesEnabled
                    ? 'bg-blue-400'
                    : 'bg-slate-700'}"
                ></span>
              </button>
            {/if}
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label class="space-y-2">
            <span
              class="text-[11px] font-black uppercase tracking-widest text-slate-400"
            >
              Status
            </span>
            <select
              value={trackingEditorActiveService.status}
              onchange={(event) =>
                updateTrackingEditorField(
                  service,
                  "status",
                  (event.currentTarget as HTMLSelectElement).value,
                )}
              class="w-full rounded-xl border border-slate-700/70 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-blue-500/50 focus:outline-none"
            >
              {#each trackingEditorActiveService.statusOptions as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>

          <label class="space-y-2">
            <span
              class="text-[11px] font-black uppercase tracking-widest text-slate-400"
            >
              Score
            </span>
            <input
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={trackingEditorActiveService.score}
              oninput={(event) =>
                updateTrackingEditorField(
                  service,
                  "score",
                  (event.currentTarget as HTMLInputElement).value,
                )}
              class="w-full rounded-xl border border-slate-700/70 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-blue-500/50 focus:outline-none"
            />
          </label>

          <label class="space-y-2">
            <span
              class="text-[11px] font-black uppercase tracking-widest text-slate-400"
            >
              Progress
            </span>
            <input
              type="number"
              min="0"
              step="1"
              value={trackingEditorActiveService.progress}
              oninput={(event) =>
                updateTrackingEditorField(
                  service,
                  "progress",
                  (event.currentTarget as HTMLInputElement).value,
                )}
              class="w-full rounded-xl border border-slate-700/70 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-blue-500/50 focus:outline-none"
            />
            {#if trackingEditorActiveService.totalChapters}
              <p class="text-[10px] font-medium text-slate-500">
                Total Chapters: {trackingEditorActiveService.totalChapters}
              </p>
            {/if}
          </label>

          <label class="space-y-2">
            <span
              class="text-[11px] font-black uppercase tracking-widest text-slate-400"
            >
              Volume
            </span>
            <input
              type="number"
              min="0"
              step="1"
              value={trackingEditorActiveService.volumes}
              oninput={(event) =>
                updateTrackingEditorField(
                  service,
                  "volumes",
                  (event.currentTarget as HTMLInputElement).value,
                )}
              class="w-full rounded-xl border border-slate-700/70 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-blue-500/50 focus:outline-none"
            />
            {#if trackingEditorActiveService.totalVolumes}
              <p class="text-[10px] font-medium text-slate-500">
                Total Volumes: {trackingEditorActiveService.totalVolumes}
              </p>
            {/if}
          </label>
        </div>
      </div>
    {/if}

    {#if trackingEditorError}
      <p class="text-xs font-bold uppercase tracking-widest text-amber-400/90">
        {trackingEditorError}
      </p>
    {/if}

    <div class="flex items-center justify-end gap-3 pt-1">
      <button
        onclick={() => void removeTrackingEditorEntry()}
        class="mr-auto px-4 py-2 rounded-lg bg-rose-600/85 text-white text-sm font-semibold hover:bg-rose-500 transition-colors disabled:opacity-60 disabled:cursor-default inline-flex items-center gap-2"
        disabled={isTrackingEditorSaving ||
          isTrackingEditorRemoving ||
          !canRemoveEntry()}
      >
        {#if isTrackingEditorRemoving}
          <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="3"
            ></circle>
            <path
              class="opacity-90"
              fill="currentColor"
              d="M22 12a10 10 0 00-10-10v3a7 7 0 017 7h3z"
            ></path>
          </svg>
        {/if}
        {getRemoveButtonLabel()}
      </button>
      <button
        onclick={closeTrackingEditor}
        class="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm font-medium hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-default"
        disabled={isTrackingEditorSaving || isTrackingEditorRemoving}
      >
        Cancel
      </button>
      <button
        onclick={() => void saveTrackingEditor()}
        class="px-4 py-2 rounded-lg bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 transition-colors disabled:opacity-60 disabled:cursor-default inline-flex items-center gap-2"
        disabled={isTrackingEditorSaving ||
          isTrackingEditorRemoving ||
          !trackingEditorActiveService}
      >
        {#if isTrackingEditorSaving}
          <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="3"
            ></circle>
            <path
              class="opacity-90"
              fill="currentColor"
              d="M22 12a10 10 0 00-10-10v3a7 7 0 017 7h3z"
            ></path>
          </svg>
        {/if}
        Save Changes
      </button>
    </div>
  </div>
</Dialog>
