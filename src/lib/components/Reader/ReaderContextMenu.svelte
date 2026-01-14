<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";

  interface Props {
    x: number;
    y: number;
    visible: boolean;
    viewMode: "single" | "double" | "webtoon";
    fitMode: "width" | "height" | "contain" | "fill";
    mangaMode: boolean;
    onClose: () => void;
    onHidePage: () => void;
    onUpdateSettings: (settings: any) => void;
  }

  let {
    x,
    y,
    visible,
    viewMode,
    fitMode,
    mangaMode,
    onClose,
    onHidePage,
    onUpdateSettings,
  }: Props = $props();

  let menuElement: HTMLElement | null = $state(null);
  let adjustedX = $state(0);
  let adjustedY = $state(0);

  $effect(() => {
    if (visible) {
      let nextX = x;
      let nextY = y;

      if (menuElement) {
        const rect = menuElement.getBoundingClientRect();
        const padding = 10;

        if (x + rect.width > window.innerWidth - padding) {
          nextX = window.innerWidth - rect.width - padding;
        }
        if (y + rect.height > window.innerHeight - padding) {
          nextY = window.innerHeight - rect.height - padding;
        }

        nextX = Math.max(padding, nextX);
        nextY = Math.max(padding, nextY);
      }

      adjustedX = nextX;
      adjustedY = nextY;
    }
  });

  function update(key: string, value: any) {
    onUpdateSettings({ [key]: value });
    onClose();
  }

  function handleHide() {
    onHidePage();
    onClose();
  }

  // Snippet for Checkmark icon
  const checkmark = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
</script>

{#if visible}
  <div
    bind:this={menuElement}
    class="fixed z-[10001] bg-gray-900 border border-gray-800 rounded-lg shadow-2xl py-1.5 min-w-[200px] overflow-hidden select-none"
    style="left: {adjustedX}px; top: {adjustedY}px;"
    transition:fade={{ duration: 70 }}
    oncontextmenu={(e) => e.preventDefault()}
    role="presentation"
  >
    <!-- View Mode Group -->
    <div
      class="px-4 pt-1.5 pb-1 text-[9px] font-bold text-gray-500 uppercase tracking-[0.2em]"
    >
      View Mode
    </div>
    <button
      onclick={() => update("viewMode", "single")}
      class="w-full h-8 px-4 flex items-center justify-between text-[12px] transition-colors hover:bg-white/5 active:bg-white/10 group {viewMode ===
      'single'
        ? 'text-blue-400'
        : 'text-gray-300'}"
    >
      <span>Single Page</span>
      {#if viewMode === "single"}
        <div class="text-blue-400">{@html checkmark}</div>
      {/if}
    </button>
    <button
      onclick={() => update("viewMode", "double")}
      class="w-full h-8 px-4 flex items-center justify-between text-[12px] transition-colors hover:bg-white/5 active:bg-white/10 group {viewMode ===
      'double'
        ? 'text-blue-400'
        : 'text-gray-300'}"
    >
      <span>Double Page</span>
      {#if viewMode === "double"}
        <div class="text-blue-400">{@html checkmark}</div>
      {/if}
    </button>
    <button
      onclick={() => update("viewMode", "webtoon")}
      class="w-full h-8 px-4 flex items-center justify-between text-[12px] transition-colors hover:bg-white/5 active:bg-white/10 group {viewMode ===
      'webtoon'
        ? 'text-blue-400'
        : 'text-gray-300'}"
    >
      <span>Webtoon</span>
      {#if viewMode === "webtoon"}
        <div class="text-blue-400">{@html checkmark}</div>
      {/if}
    </button>

    {#if viewMode !== "webtoon"}
      <div class="my-1 border-t border-gray-800/50 mx-1"></div>

      <!-- Scale Mode Group -->
      <div
        class="px-4 pt-1.5 pb-1 text-[9px] font-bold text-gray-500 uppercase tracking-[0.2em]"
      >
        Scale Mode
      </div>
      <button
        onclick={() => update("fitMode", "contain")}
        class="w-full h-8 px-4 flex items-center justify-between text-[12px] transition-colors hover:bg-white/5 active:bg-white/10 group {fitMode ===
        'contain'
          ? 'text-blue-400'
          : 'text-gray-300'}"
      >
        <span>Best Fit</span>
        {#if fitMode === "contain"}
          <div class="text-blue-400">{@html checkmark}</div>
        {/if}
      </button>
      <button
        onclick={() => update("fitMode", "width")}
        class="w-full h-8 px-4 flex items-center justify-between text-[12px] transition-colors hover:bg-white/5 active:bg-white/10 group {fitMode ===
        'width'
          ? 'text-blue-400'
          : 'text-gray-300'}"
      >
        <span>Fit Width</span>
        {#if fitMode === "width"}
          <div class="text-blue-400">{@html checkmark}</div>
        {/if}
      </button>
      <button
        onclick={() => update("fitMode", "height")}
        class="w-full h-8 px-4 flex items-center justify-between text-[12px] transition-colors hover:bg-white/5 active:bg-white/10 group {fitMode ===
        'height'
          ? 'text-blue-400'
          : 'text-gray-300'}"
      >
        <span>Fit Height</span>
        {#if fitMode === "height"}
          <div class="text-blue-400">{@html checkmark}</div>
        {/if}
      </button>
      <button
        onclick={() => update("fitMode", "fill")}
        class="w-full h-8 px-4 flex items-center justify-between text-[12px] transition-colors hover:bg-white/5 active:bg-white/10 group {fitMode ===
        'fill'
          ? 'text-blue-400'
          : 'text-gray-300'}"
      >
        <span>Stretch</span>
        {#if fitMode === "fill"}
          <div class="text-blue-400">{@html checkmark}</div>
        {/if}
      </button>

      <div class="my-1 border-t border-gray-800/50 mx-1"></div>

      <!-- Manga Mode -->
      <button
        onclick={() => update("mangaMode", !mangaMode)}
        class="w-full h-8 px-4 flex items-center justify-between text-[12px] transition-colors hover:bg-white/5 active:bg-white/10 group {mangaMode
          ? 'text-blue-400'
          : 'text-gray-300'}"
      >
        <span>RTL (Manga Mode)</span>
        {#if mangaMode}
          <div class="text-blue-400">{@html checkmark}</div>
        {/if}
      </button>
    {/if}

    <div class="my-1 border-t border-gray-800/50 mx-1"></div>

    <!-- Actions -->
    <button
      onclick={handleHide}
      class="w-full h-10 px-4 flex items-center gap-3 text-[12px] transition-colors hover:bg-red-500/10 text-red-500/80 hover:text-red-500"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-4 w-4 opacity-70"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 01-1.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268-2.943-9.543-7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
        />
      </svg>
      <span>Hide this image</span>
    </button>
  </div>
{/if}

<style>
  button {
    -webkit-app-region: no-drag;
    cursor: default;
  }
</style>
