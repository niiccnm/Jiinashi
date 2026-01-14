<script lang="ts">
  import { openLibrary } from "../../stores/app";
  import { fly, fade } from "svelte/transition";

  interface Props {
    title: string;
    currentPage: number;
    totalPages: number;
    show: boolean;
    onPageChange: (page: number) => void;
    onNext: () => void;
    onPrev: () => void;
    onToggleSettings: () => void;
    mangaMode?: boolean;
  }

  let {
    title,
    currentPage,
    totalPages,
    show,
    onPageChange,
    onNext,
    onPrev,
    onToggleSettings,
    mangaMode = false,
  }: Props = $props();

  // Format title if too long
  const displayTitle = $derived(
    title.length > 40 ? title.substring(0, 40) + "..." : title
  );

  function getSliderValue(): number {
    if (totalPages <= 1) return 0;
    const lastIndex = totalPages - 1;
    return mangaMode ? lastIndex - currentPage : currentPage;
  }

  function handleSliderInput(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const raw = parseInt(input.value, 10);
    if (Number.isNaN(raw) || totalPages <= 1) {
      return;
    }
    const lastIndex = totalPages - 1;
    const clamped = Math.min(Math.max(raw, 0), lastIndex);
    const targetIndex = mangaMode ? lastIndex - clamped : clamped;
    onPageChange(targetIndex);
  }

  function getProgress(): number {
    if (totalPages <= 1) return 0;
    const lastIndex = totalPages - 1;
    // Progress is always "how far into the book" regardless of direction.
    // RTL only affects where the bar is anchored visually.
    return currentPage / lastIndex;
  }
</script>

{#if show}
  <!-- Top Bar -->
  <header
    transition:fly={{ y: -20, duration: 200 }}
    class="absolute top-0 left-0 right-0 z-30 bg-gradient-to-b from-black/90 to-transparent pt-4 pb-12 px-6 flex justify-between items-start pointer-events-auto"
  >
    <div class="flex items-center gap-3 text-white/80 px-2">
      <span class="font-medium text-lg drop-shadow-md select-text"
        >{displayTitle}</span
      >
    </div>

    <div class="flex items-center gap-2">
      <!-- Settings Toggle -->
      <button
        onclick={(e) => {
          e.stopPropagation();
          onToggleSettings();
        }}
        ondblclick={(e) => {
          e.stopPropagation();
        }}
        class="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-md"
        title="Reader Settings"
      >
        <svg
          class="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>
    </div>
  </header>

  <!-- Bottom Bar -->
  <footer
    transition:fly={{ y: 20, duration: 200 }}
    class="absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/90 to-transparent pb-6 pt-12 px-8 flex flex-col gap-4 pointer-events-auto opacity-0 hover:opacity-100 transition-opacity duration-300"
  >
    <!-- Scrubber -->
    {#if totalPages > 1}
      <div class="w-full max-w-4xl mx-auto flex items-center gap-4">
        <span class="text-xs text-gray-400 font-mono w-8 text-right"
          >{currentPage + 1}</span
        >

        <div class="relative flex-1 h-8 flex items-center group cursor-pointer">
          <!-- Track -->
          <div class="absolute inset-0 flex items-center">
            <div
              class="w-full h-1 bg-white/20 rounded-full group-hover:bg-white/30 transition-colors"
            ></div>
            <!-- Progress -->
            <div
              class="absolute top-1/2 -translate-y-1/2 h-1 bg-blue-500 rounded-full"
              style={mangaMode
                ? `right: 0; left: auto; width: ${getProgress() * 100}%`
                : `left: 0; right: auto; width: ${getProgress() * 100}%`}
            ></div>
          </div>

          <input
            type="range"
            min="0"
            max={totalPages - 1}
            value={getSliderValue()}
            oninput={handleSliderInput}
            onclick={(e) => {
              e.stopPropagation();
            }}
            ondblclick={(e) => {
              e.stopPropagation();
            }}
            data-reader-scrubber={true}
            class="absolute inset-0 w-full opacity-0 cursor-pointer z-10"
            title="Go to page"
          />

          <!-- Thumb (Visual Only, follows real input) -->
          <div
            class="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-blue-500 rounded-full shadow-lg pointer-events-none transform scale-0 group-hover:scale-100 transition-transform duration-200"
            style={`left: ${getProgress() * 100}%; transform: translate(-50%, -50%) scale(var(--thumb-scale, 0));`}
          ></div>
        </div>

        <span class="text-xs text-gray-400 font-mono w-8">{totalPages}</span>
      </div>
    {/if}

    <!-- Visual Navigation Controls (Optional / Redundant but good for mouse users) -->
    <div class="flex items-center justify-center gap-6 text-white/90">
      <button
        onclick={(e) => {
          e.stopPropagation();
          onPrev();
        }}
        ondblclick={(e) => {
          e.stopPropagation();
        }}
        class="p-2 hover:text-blue-400 transition-colors"
        title="Previous Page"
      >
        <svg
          class="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>

      <div class="flex flex-col items-center">
        <span class="text-sm font-medium tracking-wide"
          >Page {currentPage + 1} of {totalPages}</span
        >
      </div>

      <button
        onclick={(e) => {
          e.stopPropagation();
          onNext();
        }}
        ondblclick={(e) => {
          e.stopPropagation();
        }}
        class="p-2 hover:text-blue-400 transition-colors"
        title="Next Page"
      >
        <svg
          class="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>
    </div>
  </footer>
{/if}

<style>
  /* Custom scrollbar override for range input if needed, though opacity-0 trick works best for styling */
</style>
