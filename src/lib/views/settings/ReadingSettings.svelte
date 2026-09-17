<script lang="ts">
  import type { SettingsModel } from "./createSettingsModel.svelte";
  let { model }: { model: SettingsModel } = $props();
</script>

<section>
  <h2
    class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
  >
    Reader Experience
  </h2>

  <div
    class="space-y-1 bg-slate-800/[0.28] rounded-2xl border border-slate-700/45 overflow-hidden"
  >
    <!-- View Mode -->
    <div data-setting="view-mode"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex flex-col">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Default View Mode</span
        >
        <span class="text-sm text-slate-500"
          >How would you like to read by default?</span
        >
      </div>
      <div class="relative">
        <select
          value={model.settings["defaultViewMode"] || "single"}
          onchange={(e) =>
            model.updateSetting("defaultViewMode", e.currentTarget.value)}
          class="appearance-none bg-slate-900/50 text-slate-200 pl-4 pr-10 py-2 rounded-lg border border-white/10 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none transition-all cursor-pointer hover:bg-slate-900"
        >
          <option value="single">Single Page</option>
          <option value="double">Double Page</option>
          <option value="webtoon">Webtoon (Scroll)</option>
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

    <!-- Fit Mode -->
    <div data-setting="scaling"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex flex-col">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Scaling Mode</span
        >
        <span class="text-sm text-slate-500"
          >Default image scaling strategy</span
        >
      </div>
      <div class="relative">
        <select
          value={model.settings["defaultFitMode"] || "contain"}
          onchange={(e) =>
            model.updateSetting("defaultFitMode", e.currentTarget.value)}
          class="appearance-none bg-slate-900/50 text-slate-200 pl-4 pr-10 py-2 rounded-lg border border-white/10 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none transition-all cursor-pointer hover:bg-slate-900"
        >
          <option value="contain">Best Fit</option>
          <option value="cover">Cover Screen</option>
          <option value="width">Fit Width</option>
          <option value="height">Fit Height</option>
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

    <!-- Manga Mode -->
    <label data-setting="direction"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors cursor-pointer outline-none focus-within:bg-white/[0.03]"
    >
      <div class="flex flex-col">
        <span id="setting-direction-label"
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Right-to-Left</span
        >
        <span class="text-sm text-slate-500"
          >Standard manga reading direction</span
        >
      </div>
      <input
        type="checkbox"
        role="switch"
        aria-labelledby="setting-direction-label"
        checked={!model.settings["mangaMode"] || model.settings["mangaMode"] === "true"}
        onchange={(e) => model.updateSetting("mangaMode", String(e.currentTarget.checked))}
        class="sr-only"
      />
      <div
        class={`relative shrink-0 w-12 h-7 rounded-full transition-colors duration-300 ${!model.settings["mangaMode"] || model.settings["mangaMode"] === "true" ? "bg-blue-600" : "bg-slate-700"}`}
      >
        <div
          class={`absolute left-1 top-1 bg-white w-5 h-5 rounded-full shadow-sm transition-transform duration-300 ${!model.settings["mangaMode"] || model.settings["mangaMode"] === "true" ? "translate-x-5" : "translate-x-0"}`}
        ></div>
      </div>
    </label>
  </div>
</section>
