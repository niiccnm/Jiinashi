<script lang="ts">
  import TrackingSettings from "./TrackingSettings.svelte";
  import type { SettingsModel } from "./createSettingsModel.svelte";
  let { model }: { model: SettingsModel } = $props();
</script>

<section>
  <h2
    class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
  >
    Manga preferences
  </h2>

  <div
    class="space-y-1 bg-slate-800/[0.28] rounded-2xl border border-slate-700/45 overflow-hidden"
  >
    <!-- Incognito Mode -->
    <label data-setting="incognito"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors cursor-pointer outline-none focus-within:bg-white/[0.03]"
    >
      <div class="flex flex-col">
        <div class="flex items-center gap-2">
          <span id="setting-incognito-label"
            class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
            >Incognito Mode</span
          >
          {#if model.incognitoMode}
            <span
              class="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
              >Active</span
            >
          {/if}
        </div>
        <span class="text-sm text-slate-500"
          >Prevent automatic tracker updates while reading; manual edits
          still sync (Ctrl+Shift+I)</span
        >
      </div>

      <input
        type="checkbox"
        role="switch"
        aria-labelledby="setting-incognito-label"
        checked={model.incognitoMode}
        onchange={model.toggleIncognito}
        class="sr-only"
      />
      <div
        class={`relative shrink-0 w-12 h-7 rounded-full transition-colors duration-300 ${model.incognitoMode ? "bg-purple-600" : "bg-slate-700"}`}
      >
        <div
          class={`absolute left-1 top-1 bg-white w-5 h-5 rounded-full shadow-sm transition-transform duration-300 ${model.incognitoMode ? "translate-x-5" : "translate-x-0"}`}
        ></div>
      </div>
    </label>

    <div class="h-px bg-white/[0.06] mx-5"></div>

    <!-- Series Title Style -->
    <div data-setting="series-title"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex flex-col">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Series Title Language</span
        >
        <span class="text-sm text-slate-500"
          >Choose how manga titles are displayed throughout the app</span
        >
      </div>
      <div class="relative">
        <select
          value={model.seriesTitleStyle}
          onchange={(e) => {
            model.seriesTitleStyle = e.currentTarget.value;
            model.updateSetting("seriesTitleStyle", model.seriesTitleStyle);
          }}
          class="appearance-none bg-slate-900/50 text-slate-200 pl-4 pr-10 py-2 rounded-lg border border-white/10 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none transition-all cursor-pointer hover:bg-slate-900"
        >
          <option value="original">Original / Native</option>
          <option value="romaji">Romaji</option>
          <option value="english">English</option>
        </select>
        <div
          class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500"
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
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>
    </div>
  </div>
</section>

<TrackingSettings {model} />
