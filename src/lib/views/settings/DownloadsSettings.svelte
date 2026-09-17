<script lang="ts">
  import type { SettingsModel } from "./createSettingsModel.svelte";
  let { model }: { model: SettingsModel } = $props();
</script>

<section>
  <h2
    class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
  >
    Downloader
  </h2>

  <div
    class="space-y-1 bg-slate-800/[0.28] rounded-2xl border border-slate-700/45 overflow-hidden"
  >
    <!-- Download Path -->
    <div data-setting="download-location"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex flex-col overflow-hidden mr-4">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Download Location</span
        >
        <span
          class="text-sm text-slate-500 truncate"
          title={model.settings["downloadPath"]}
        >
          {model.settings["downloadPath"] || "Not set"}
        </span>
      </div>
      <button
        onclick={model.handleSelectDownloadPath}
        class="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-medium rounded-lg transition-colors border border-blue-500/20 active:scale-95 shrink-0"
      >
        Change
      </button>
    </div>

    <div class="h-px bg-white/[0.06] mx-5"></div>

    <!-- Concurrent Downloads -->
    <div data-setting="concurrent"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex flex-col">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Concurrent Downloads</span
        >
        <span class="text-sm text-slate-500"
          >Number of items to download at once</span
        >
      </div>
      <div class="flex items-center gap-3">
        <input
          type="number"
          min="1"
          max="5"
          value={model.settings["concurrentDownloads"] || "2"}
          onchange={(e) =>
            model.updateSetting("concurrentDownloads", e.currentTarget.value)}
          class="w-16 bg-slate-900/50 text-slate-200 px-3 py-1.5 rounded-lg border border-white/10 focus:border-blue-500/50 focus:outline-none transition-all text-center font-mono"
        />
      </div>
    </div>

    <div class="h-px bg-white/[0.06] mx-5"></div>

    <!-- Download Delay -->
    <div data-setting="delay"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex flex-col">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Image Delay (ms)</span
        >
        <span class="text-sm text-slate-500"
          >Wait time between image requests to avoid rate limits</span
        >
      </div>
      <div class="flex items-center gap-3">
        <input
          type="number"
          min="0"
          max="5000"
          step="100"
          value={model.settings["downloadDelay"] || "500"}
          onchange={(e) =>
            model.updateSetting("downloadDelay", e.currentTarget.value)}
          class="w-20 bg-slate-900/50 text-slate-200 px-3 py-1.5 rounded-lg border border-white/10 focus:border-blue-500/50 focus:outline-none transition-all text-center font-mono"
        />
      </div>
    </div>

    <div class="h-px bg-white/[0.06] mx-5"></div>

    <!-- Max History -->
    <div data-setting="history"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex flex-col">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Max History Items</span
        >
        <span class="text-sm text-slate-500"
          >Number of completed downloads to keep in history</span
        >
      </div>
      <div class="flex items-center gap-3">
        <input
          type="number"
          min="10"
          max="500"
          step="10"
          value={model.settings["maxHistoryItems"] || "50"}
          onchange={(e) =>
            model.updateSetting("maxHistoryItems", e.currentTarget.value)}
          class="w-20 bg-slate-900/50 text-slate-200 px-3 py-1.5 rounded-lg border border-white/10 focus:border-blue-500/50 focus:outline-none transition-all text-center font-mono"
        />
      </div>
    </div>
  </div>
</section>

<section>
  <h2
    class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
  >
    Site Authentication
  </h2>

  <div
    class="space-y-1 bg-slate-800/[0.28] rounded-2xl border border-slate-700/45 overflow-hidden"
  >
    <!-- E-Hentai / ExHentai -->
    <div data-setting="authentication"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex flex-col">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >E-Hentai / ExHentai</span
        >
        <div class="flex items-center gap-2 mt-1">
          {#if model.settings["cookies:e-hentai"] || model.settings["cookies:exhentai"]}
            <span
              class="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20"
            >
              <div
                class="w-1.5 h-1.5 rounded-full bg-emerald-400"
              ></div>
              Authenticated
            </span>
          {:else}
            <span class="text-sm text-slate-500">Not logged in</span>
          {/if}
        </div>
      </div>
      <button
        onclick={() => model.handleLogin("e-hentai")}
        disabled={model.loading}
        class="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-medium rounded-lg transition-colors border border-blue-500/20 active:scale-95 shrink-0"
      >
        {model.settings["cookies:e-hentai"] || model.settings["cookies:exhentai"]
          ? "Re-login"
          : "Login"}
      </button>
    </div>
  </div>
</section>
