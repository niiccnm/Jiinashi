<script lang="ts">
  import type { SettingsModel } from "./createSettingsModel.svelte";
  let { model }: { model: SettingsModel } = $props();
</script>

<section>
  <div class="mb-6 px-2">
    <h2
      class="text-sm font-bold text-blue-400 uppercase tracking-widest"
    >
      Extension Management
    </h2>
  </div>

  <div data-setting="repository" class="mb-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
    <div class="mb-4 flex flex-col gap-1">
      <span class="text-sm font-medium text-slate-200">
        Add Extension Repository
      </span>
      <span class="text-xs text-slate-500">
        Paste a compatible JSON catalog URL. Only import repositories
        you trust.
      </span>
    </div>
    <form
      class="flex flex-col sm:flex-row gap-3"
      onsubmit={(event) => {
        event.preventDefault();
        model.importExtensionRepository();
      }}
    >
      <input
        id="extension-catalog-url"
        type="url"
        bind:value={model.extensionRepositoryUrl}
        placeholder="https://example.com/catalog.json"
        autocomplete="off"
        spellcheck="false"
        class="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
      />
      <button
        type="submit"
        disabled={!model.extensionRepositoryUrl.trim() || model.importingExtensionRepository}
        class="rounded-xl border border-blue-500/20 bg-blue-500/10 px-5 py-2.5 text-sm font-medium text-blue-400 transition-colors hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {model.importingExtensionRepository ? "Importing…" : "Import"}
      </button>
    </form>
  </div>

  <div data-setting="installed" class="mb-3 flex items-end justify-between gap-4 px-2">
    <div>
      <h3 class="text-sm font-medium text-slate-300">
        Installed Extensions
      </h3>
      <p class="mt-0.5 text-xs text-slate-600">
        Manage installed packages and the sites available through them.
      </p>
    </div>
    <span
      class="shrink-0 rounded bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-slate-500"
    >
      {model.extensions.length} Installed
    </span>
  </div>

  <div
    class="space-y-1 bg-slate-800/[0.28] rounded-2xl border border-slate-700/45 overflow-hidden"
  >
    {#if model.extensions.length === 0}
      <div class="p-8 text-center text-slate-500 text-sm">
        No extensions installed.
      </div>
    {:else}
      {#each model.extensions as ext, i}
        <div
          class="group overflow-hidden rounded-2xl transition-colors hover:bg-white/[0.015]"
        >
          <div
            class={`flex items-center gap-5 p-5 ${model.canManageExtensionSites(ext) ? "cursor-pointer" : ""}`}
            role="button"
            tabindex={model.canManageExtensionSites(ext) ? 0 : -1}
            aria-expanded={model.canManageExtensionSites(ext)
              ? model.expandedExtensionSites[ext.id]
              : undefined}
            onclick={(event) => model.handleExtensionHeaderClick(event, ext)}
            onkeydown={(event) =>
              model.handleExtensionHeaderKeydown(event, ext)}
          >
            <div class="flex min-w-0 flex-1 items-center gap-4">
              <div
                class="w-10 h-10 rounded-xl bg-slate-800 border border-white/5 flex items-center justify-center overflow-hidden shrink-0"
              >
                {#if ext.icon_url}
                  <img
                    src={ext.icon_url}
                    alt={ext.name}
                    class="w-full h-full object-contain"
                  />
                {:else}
                  <svg
                    class="w-5 h-5 text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                    />
                  </svg>
                {/if}
              </div>
              <div class="flex min-w-0 flex-1 flex-col">
                <div class="flex min-w-0 items-center gap-2.5">
                  <button
                    type="button"
                    disabled={!model.canManageExtensionSites(ext)}
                    class="flex min-w-0 items-center gap-2 rounded-md text-left outline-none disabled:cursor-default"
                    aria-expanded={model.canManageExtensionSites(ext)
                      ? model.expandedExtensionSites[ext.id]
                      : undefined}
                    aria-label={model.canManageExtensionSites(ext)
                      ? `${model.expandedExtensionSites[ext.id] ? "Hide" : "Show"} sites for ${ext.name}`
                      : ext.name}
                    onclick={() =>
                      model.canManageExtensionSites(ext) &&
                      model.toggleExtensionSitesPanel(ext.id)}
                  >
                    <span
                      class="truncate text-base font-medium text-slate-200 transition-colors group-hover:text-white"
                    >
                      {ext.name}
                    </span>
                    {#if model.canManageExtensionSites(ext)}
                      <svg
                        class={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ${model.expandedExtensionSites[ext.id] ? "rotate-180" : ""}`}
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
                    {/if}
                  </button>
                  <span
                    class="shrink-0 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-slate-500"
                  >
                    {ext.content_type || "manga"}
                  </span>
                  {#if ext.repository_url}
                    <button
                      type="button"
                      disabled={model.importingExtensionRepository}
                      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Update ${ext.name}`}
                      title="Update extension"
                      onclick={() =>
                        model.refreshExtensionRepository(ext.repository_url)}
                    >
                      <svg
                        class="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M4 4v6h6M20 20v-6h-6M5.1 15a8 8 0 0013.15 2.75M18.9 9A8 8 0 005.75 6.25"
                        />
                      </svg>
                    </button>
                  {/if}
                </div>
                <div class="mt-1 flex min-w-0 items-center gap-2">
                  <span
                    class="shrink-0 text-xs text-slate-500"
                    title="Extension version"
                  >
                    v{ext.version || "unknown"}
                  </span>
                  <span aria-hidden="true" class="text-slate-700">·</span>
                  <span class="truncate text-xs text-slate-500">
                    From {ext.repository_name || "imported repository"}
                  </span>
                </div>
              </div>
            </div>

            <div class="flex shrink-0 items-center">
              <div class="flex items-center gap-5">
                {#if model.canManageExtensionSites(ext)}
                  <button
                    type="button"
                    class="flex items-center overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.025] text-xs font-medium transition-colors hover:border-blue-500/20 hover:bg-blue-500/[0.05]"
                    aria-label={`${model.expandedExtensionSites[ext.id] ? "Hide" : "Show"} ${model.getExtensionSites(ext).length} sites for ${ext.name}`}
                    aria-expanded={model.expandedExtensionSites[ext.id]}
                    onclick={() => model.toggleExtensionSitesPanel(ext.id)}
                  >
                    <span class="border-r border-blue-500/15 bg-blue-500/[0.09] px-2.5 py-1.5 text-blue-400">
                      {model.getEnabledSiteCount(ext)}
                    </span>
                    <span class="px-2.5 py-1.5 text-slate-400">
                      {model.getExtensionSites(ext).length} Sites
                    </span>
                  </button>
                {/if}
                <div class="flex items-center gap-3">
                  <span
                    class={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest ${ext.is_enabled ? "text-emerald-500/80" : "text-slate-600"}`}
                  >
                    <span
                      class={`h-1 w-1 rounded-full ${ext.is_enabled ? "bg-emerald-500" : "bg-slate-600"}`}
                    ></span>
                    {ext.is_enabled ? "Active" : "Disabled"}
                  </span>
                  <button
                    type="button"
                    class={`relative h-7 w-12 cursor-pointer rounded-full transition-colors duration-300 ${ext.is_enabled ? "bg-blue-600" : "bg-slate-700"}`}
                    aria-label={`${ext.is_enabled ? "Disable" : "Enable"} ${ext.name}`}
                    aria-pressed={ext.is_enabled}
                    onclick={() =>
                      model.toggleExtension(ext.id, ext.is_enabled)}
                  >
                    <span
                      class={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${ext.is_enabled ? "translate-x-5" : "translate-x-0"}`}
                    ></span>
                  </button>
                </div>
              </div>
              <div class="ml-4 border-l border-white/[0.07] pl-4">
                <button
                  type="button"
                  class="flex h-9 w-9 items-center justify-center rounded-xl text-red-400/60 transition-colors hover:bg-red-500/[0.1] hover:text-red-300"
                  aria-label={`Remove ${ext.name}`}
                  title="Remove extension"
                  onclick={() => model.requestRemoveExtension(ext.id, ext.name)}
                >
                  <svg
                    class="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {#if model.canManageExtensionSites(ext) && model.expandedExtensionSites[ext.id]}
            <div
              class="overflow-hidden border-t border-white/[0.05] bg-slate-950/45"
            >
              <div class="divide-y divide-white/[0.05]">
                {#each model.getExtensionSites(ext) as site}
                  <div
                    class={`flex items-center justify-between gap-4 px-4 py-3 transition-colors ${ext.is_enabled
                      ? "hover:bg-white/[0.015]"
                      : "opacity-60"}`}
                  >
                    <div class="flex items-center gap-3 min-w-0">
                      <div
                        class="w-9 h-9 rounded-xl bg-slate-900 border border-white/[0.05] flex items-center justify-center overflow-hidden shrink-0"
                      >
                        {#if model.canShowSiteIcon(ext.id, site)}
                          <img
                            src={site.icon_url}
                            alt={site.name}
                            class="w-full h-full object-contain"
                            onerror={() =>
                              model.markSiteIconBroken(ext.id, site.id)}
                          />
                        {:else}
                          <svg
                            class="w-4 h-4 text-slate-500"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M13 10V3L4 14h7v7l9-11h-7z"
                            />
                          </svg>
                        {/if}
                      </div>

                      <div class="min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="text-sm font-medium text-slate-200">
                            {site.name}
                          </span>
                          <span
                            class={`text-[10px] font-bold uppercase tracking-widest ${site.is_enabled
                              ? "text-emerald-400/90"
                              : "text-slate-500"}`}
                          >
                            {site.is_enabled ? "On" : "Off"}
                          </span>
                        </div>
                        {#if model.formatSiteHost(site.base_url)}
                          <p class="text-xs text-slate-500 truncate">
                            {model.formatSiteHost(site.base_url)}
                          </p>
                        {/if}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={!ext.is_enabled}
                      class={`relative w-11 h-6 rounded-full transition-colors duration-300 ${site.is_enabled
                        ? "bg-blue-600"
                        : "bg-slate-700"} ${ext.is_enabled
                        ? "cursor-pointer"
                        : "cursor-not-allowed"}`}
                      aria-label={`${site.is_enabled ? "Disable" : "Enable"} ${site.name}`}
                      onclick={() =>
                        model.toggleExtensionSite(
                          ext.id,
                          site.id,
                          site.is_enabled,
                        )}
                    >
                      <div
                        class={`absolute left-1 top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${site.is_enabled
                          ? "translate-x-5"
                          : "translate-x-0"}`}
                      ></div>
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
        {#if i !== model.extensions.length - 1}
          <div class="h-px bg-white/[0.06] mx-5"></div>
        {/if}
      {/each}
    {/if}
  </div>
</section>
