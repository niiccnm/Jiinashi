<script lang="ts">
  import type { SettingsModel } from "./createSettingsModel.svelte";
  import { fade } from "svelte/transition";
  let { model }: { model: SettingsModel } = $props();
</script>

<section>
  <h2
    class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
  >
    App Info
  </h2>

  <div
    class="space-y-1 bg-slate-800/[0.28] rounded-2xl border border-slate-700/45 overflow-hidden"
  >
    <!-- Version Info -->
    <div data-setting="version"
      class="flex items-center justify-between p-5 border-b border-white/[0.04]"
    >
      <div class="flex flex-col">
        <span class="text-base font-medium text-slate-200"
          >Application Version</span
        >
        <span class="text-sm text-slate-500"
          >The current version of Jiinashi installed on your system</span
        >
      </div>
      <span
        class="text-sm font-mono text-slate-400 bg-white/[0.04] px-3 py-1 rounded-full"
      >
        v{model.appVersion}
      </span>
    </div>

    <!-- Auto-Update Toggle -->
    <label data-setting="updates"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors cursor-pointer outline-none focus-within:bg-white/[0.03]"
    >
      <div class="flex flex-col">
        <span id="setting-updates-label"
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Automatically Check for Updates</span
        >
        <span class="text-sm text-slate-500"
          >Check for new versions when the app starts</span
        >
      </div>

      <input
        type="checkbox"
        role="switch"
        aria-labelledby="setting-updates-label"
        checked={!model.settings["autoCheckUpdates"] || model.settings["autoCheckUpdates"] === "true"}
        onchange={(e) => model.updateSetting("autoCheckUpdates", String(e.currentTarget.checked))}
        class="sr-only"
      />
      <div
        class={`relative shrink-0 w-12 h-7 rounded-full transition-colors duration-300 ${!model.settings["autoCheckUpdates"] || model.settings["autoCheckUpdates"] === "true" ? "bg-blue-600" : "bg-slate-700"}`}
      >
        <div
          class={`absolute left-1 top-1 bg-white w-5 h-5 rounded-full shadow-sm transition-transform duration-300 ${!model.settings["autoCheckUpdates"] || model.settings["autoCheckUpdates"] === "true" ? "translate-x-5" : "translate-x-0"}`}
        ></div>
      </div>
    </label>

    <div class="h-px bg-white/[0.06] mx-5"></div>

    <!-- Sync Default Data Toggle -->
    <label data-setting="sync"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors cursor-pointer outline-none focus-within:bg-white/[0.03]"
    >
      <div class="flex flex-col">
        <div class="flex items-center gap-2">
          <span id="setting-sync-label"
            class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
            >Sync Default Data on Startup</span
          >
          {#if model.settings["syncDefaultData"] === "false"}
            <span
              class="text-[10px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
              >Manual Mode</span
            >
          {/if}
        </div>
        <span class="text-sm text-slate-500"
          >Keep default tags updated. Turn off to preserve your manual
          edits.</span
        >
      </div>

      <input
        type="checkbox"
        role="switch"
        aria-labelledby="setting-sync-label"
        checked={!model.settings["syncDefaultData"] || model.settings["syncDefaultData"] === "true"}
        onchange={(e) => model.updateSetting("syncDefaultData", String(e.currentTarget.checked))}
        class="sr-only"
      />
      <div
        class={`relative shrink-0 w-12 h-7 rounded-full transition-colors duration-300 ${!model.settings["syncDefaultData"] || model.settings["syncDefaultData"] === "true" ? "bg-blue-600" : "bg-slate-700"}`}
      >
        <div
          class={`absolute left-1 top-1 bg-white w-5 h-5 rounded-full shadow-sm transition-transform duration-300 ${!model.settings["syncDefaultData"] || model.settings["syncDefaultData"] === "true" ? "translate-x-5" : "translate-x-0"}`}
        ></div>
      </div>
    </label>
  </div>
</section>

<section>
  <h2
    class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
  >
    Appearance
  </h2>

  <div
    class="space-y-1 bg-slate-800/[0.28] rounded-2xl border border-slate-700/45 overflow-hidden"
  >
    <!-- Theme -->
    <div data-setting="theme"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex flex-col">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Theme</span
        >
        <span class="text-sm text-slate-500"
          >Choose your preferred visual theme</span
        >
      </div>
      <div class="relative">
        <select
          value={model.settings["theme"] || "dark"}
          onchange={(e) =>
            model.updateSetting("theme", e.currentTarget.value)}
          class="appearance-none bg-slate-900/50 text-slate-200 pl-4 pr-10 py-2 rounded-lg border border-white/10 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none transition-all cursor-pointer hover:bg-slate-900"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
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

    <!-- Background Color -->
    <div data-setting="background"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors"
    >
      <div class="flex flex-col">
        <span
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Background Color</span
        >
        <span class="text-sm text-slate-500"
          >Custom solid background for the reader</span
        >
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs font-mono text-slate-500 uppercase"
          >{model.settings["backgroundColor"] || "#000000"}</span
        >
        <div
          class="relative h-9 w-16 rounded-lg overflow-hidden border border-white/10 shadow-sm ring-2 ring-white/5 transition-transform active:scale-95"
        >
          <input
            type="color"
            value={model.settings["backgroundColor"] || "#000000"}
            onchange={(e) =>
              model.updateSetting("backgroundColor", e.currentTarget.value)}
            class="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] p-0 m-0 cursor-pointer border-none"
          />
        </div>
      </div>
    </div>

    <div class="h-px bg-white/[0.06] mx-5"></div>

    <!-- Animations -->
    <label data-setting="animations"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors cursor-pointer outline-none focus-within:bg-white/[0.03]"
    >
      <div class="flex flex-col">
        <span id="setting-animations-label"
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Animations</span
        >
        <span class="text-sm text-slate-500"
          >Enable smooth transitions and effects</span
        >
      </div>

      <input
        type="checkbox"
        role="switch"
        aria-labelledby="setting-animations-label"
        checked={model.settings["enableAnimations"] === "true"}
        onchange={(e) => model.updateSetting("enableAnimations", String(e.currentTarget.checked))}
        class="sr-only"
      />
      <div
        class={`relative shrink-0 w-12 h-7 rounded-full transition-colors duration-300 ${model.settings["enableAnimations"] === "true" ? "bg-blue-600" : "bg-slate-700"}`}
      >
        <div
          class={`absolute left-1 top-1 bg-white w-5 h-5 rounded-full shadow-sm transition-transform duration-300 ${model.settings["enableAnimations"] === "true" ? "translate-x-5" : "translate-x-0"}`}
        ></div>
      </div>
    </label>

    <div class="h-px bg-white/[0.06] mx-5"></div>

    <!-- Blur R18 -->
    <label data-setting="blur"
      class="group flex items-center justify-between p-5 hover:bg-white/[0.015] transition-colors cursor-pointer outline-none focus-within:bg-white/[0.03]"
    >
      <div class="flex flex-col">
        <span id="setting-blur-label"
          class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
          >Blur R18 Content</span
        >
        <span class="text-sm text-slate-500"
          >Apply a blur effect to covers of R18 items</span
        >
      </div>

      <input
        type="checkbox"
        role="switch"
        aria-labelledby="setting-blur-label"
        checked={model.settings["blurR18"] === "true"}
        onchange={(e) => model.updateSetting("blurR18", String(e.currentTarget.checked))}
        class="sr-only"
      />
      <div
        class={`relative shrink-0 w-12 h-7 rounded-full transition-colors duration-300 ${model.settings["blurR18"] === "true" ? "bg-blue-600" : "bg-slate-700"}`}
      >
        <div
          class={`absolute left-1 top-1 bg-white w-5 h-5 rounded-full shadow-sm transition-transform duration-300 ${model.settings["blurR18"] === "true" ? "translate-x-5" : "translate-x-0"}`}
        ></div>
      </div>
    </label>

    {#if model.settings["blurR18"] === "true"}
      <div transition:fade={{ duration: 200 }}>
        <!-- Separator -->
        <div class="h-px bg-white/[0.06] mx-5"></div>

        <!-- Reveal on Hover -->
        <label data-setting="blur-hover"
          class="group flex items-center justify-between p-5 pl-10 hover:bg-white/[0.015] transition-colors cursor-pointer outline-none focus-within:bg-white/[0.03]"
        >
          <div class="flex flex-col">
            <span id="setting-blur-hover-label"
              class="text-sm font-medium text-slate-300 group-hover:text-white transition-colors"
              >Reveal on Hover</span
            >
            <span class="text-xs text-slate-500"
              >Temporarily remove blur when hovering over the cover</span
            >
          </div>

          <input
            type="checkbox"
            role="switch"
            aria-labelledby="setting-blur-hover-label"
            checked={model.settings["blurR18Hover"] === "true"}
            onchange={(e) => model.updateSetting("blurR18Hover", String(e.currentTarget.checked))}
            class="sr-only"
          />
          <div
            class={`relative shrink-0 w-10 h-6 rounded-full transition-colors duration-300 ${model.settings["blurR18Hover"] === "true" ? "bg-blue-600" : "bg-slate-700"}`}
          >
            <div
              class={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform duration-300 ${model.settings["blurR18Hover"] === "true" ? "translate-x-4" : "translate-x-0"}`}
            ></div>
          </div>
        </label>

        <!-- Separator -->
        <div class="h-px bg-white/[0.06] mx-5"></div>

        <!-- Blur Intensity -->
        <div data-setting="blur-intensity" class="p-5 pl-10 hover:bg-white/[0.015] transition-colors">
          <div class="flex items-center justify-between mb-3">
            <div class="flex flex-col">
              <span class="text-sm font-medium text-slate-300"
                >Blur Intensity</span
              >
              <span class="text-xs text-slate-500"
                >Adjust the strength of the blur effect</span
              >
            </div>
            <span
              class="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-1 rounded"
            >
              {model.settings["blurR18Intensity"] || "12"}px
            </span>
          </div>

          <input
            type="range"
            min="4"
            max="32"
            step="2"
            value={model.settings["blurR18Intensity"] || "12"}
            oninput={(e) =>
              model.updateSetting("blurR18Intensity", e.currentTarget.value)}
            class="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
        </div>
      </div>
    {/if}
  </div>
</section>
