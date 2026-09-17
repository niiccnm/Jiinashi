<script lang="ts">
  import type { SettingsModel } from "./createSettingsModel.svelte";
  import TrackingClientIdControl from "../../components/manga/TrackingClientIdControl.svelte";
  let { model }: { model: SettingsModel } = $props();
</script>

<section>
  <h2
    class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
  >
    Tracking Services
  </h2>
  <div
    class="space-y-1 bg-slate-800/[0.28] rounded-2xl border border-slate-700/45 overflow-hidden"
  >
    <!-- MyAnimeList -->
    <div data-setting="mal"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex flex-col">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >MyAnimeList</span
        >
        <div class="flex items-center gap-2 mt-1">
          {#if model.isTrackingConnected("mal")}
            <span
              class="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20"
            >
              <div
                class="w-1.5 h-1.5 rounded-full bg-emerald-400"
              ></div>
              Connected
            </span>
          {:else}
            <span class="text-sm text-slate-500">Not connected</span>
          {/if}
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <TrackingClientIdControl
          service="mal"
          label="MyAnimeList"
          onChanged={model.refreshTrackingAccounts}
        />
        <button
          onclick={() => model.handleTrackingLogin("mal")}
          disabled={model.loading}
          class="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-medium rounded-lg transition-colors border border-blue-500/20 active:scale-95 shrink-0"
        >
          {model.isTrackingConnected("mal")
            ? "Reconnect"
            : "Connect"}
        </button>
      </div>
    </div>

    <div class="h-px bg-white/[0.06] mx-5"></div>

    <!-- AniList -->
    <div data-setting="anilist"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex flex-col">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >AniList</span
        >
        <div class="flex items-center gap-2 mt-1">
          {#if model.isTrackingConnected("anilist")}
            <span
              class="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20"
            >
              <div
                class="w-1.5 h-1.5 rounded-full bg-emerald-400"
              ></div>
              Connected
            </span>
          {:else}
            <span class="text-sm text-slate-500">Not connected</span>
          {/if}
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <TrackingClientIdControl
          service="anilist"
          label="AniList"
          onChanged={model.refreshTrackingAccounts}
        />
        <button
          onclick={() => model.handleTrackingLogin("anilist")}
          disabled={model.loading}
          class="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-medium rounded-lg transition-colors border border-blue-500/20 active:scale-95 shrink-0"
        >
          {model.isTrackingConnected("anilist")
            ? "Reconnect"
            : "Connect"}
        </button>
      </div>
    </div>
  </div>
</section>
