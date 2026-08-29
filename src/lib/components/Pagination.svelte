<script lang="ts">
  interface Props {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  }

  let { currentPage, totalPages, onPageChange }: Props = $props();

  const SIBLING_COUNT = 2;
  const MIN_COUNT = 5;

  function generatePagination(current: number, total: number) {
    if (total <= 1) return [1];

    // 1. Calculate Initial Window
    let start = Math.max(current - SIBLING_COUNT, 1);
    let end = Math.min(current + SIBLING_COUNT, total);

    // 2. Adjust Window Size
    const windowSize = end - start + 1;
    if (windowSize < MIN_COUNT) {
      if (start === 1) {
        end = Math.min(MIN_COUNT, total);
      } else if (end === total) {
        start = Math.max(total - MIN_COUNT + 1, 1);
      }
    }

    // 3. Apply "Smart Ellipses" (Gap Filling)
    if (start === 3) {
      start = 2;
    }
    if (end === total - 2) {
      end = total - 1;
    }

    // 4. Construct Display List
    const pages: (number | string)[] = [];

    // Always include Page 1
    pages.push(1);

    if (start > 2) {
      pages.push("...");
    }

    for (let i = start; i <= end; i++) {
      if (i > 1 && i < total) {
        pages.push(i);
      }
    }

    if (end < total - 1) {
      pages.push("...");
    }

    if (total > 1) {
      pages.push(total);
    }

    return pages;
  }

  const pages = $derived(generatePagination(currentPage, totalPages));
</script>

{#if totalPages > 1}
  <div class="flex flex-col items-center gap-5 mt-10 py-4">
    <!-- Main Pagination Strip -->
    <div
      class="flex items-center gap-1 p-1.5 bg-[#0d1525] rounded-full border border-slate-800/40 shadow-2xl"
    >
      <!-- Previous -->
      <button
        onclick={() => currentPage > 1 && onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        class="w-10 h-10 flex items-center justify-center rounded-full text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
        aria-label="Previous Page"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2.5"
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>

      <!-- Pages -->
      <div class="flex items-center gap-1">
        {#each pages as page}
          {#if page === "..."}
            <span
              class="w-10 h-10 flex items-center justify-center text-slate-500 font-bold select-none text-sm tracking-widest"
              >...</span
            >
          {:else}
            <button
              onclick={() => typeof page === "number" && onPageChange(page)}
              class="w-10 h-10 flex items-center justify-center rounded-full text-sm font-bold transition-all duration-300 {currentPage ===
              page
                ? 'bg-blue-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.3)] ring-1 ring-blue-400/20'
                : 'text-slate-400 hover:text-white hover:bg-white/5'}"
            >
              {page}
            </button>
          {/if}
        {/each}
      </div>

      <!-- Next -->
      <button
        onclick={() =>
          currentPage < totalPages && onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        class="w-10 h-10 flex items-center justify-center rounded-full text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
        aria-label="Next Page"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2.5"
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>
    </div>

    <div
      class="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] flex items-center gap-2"
    >
      PAGE <span class="text-blue-400">{currentPage}</span> OF
      <span class="text-slate-300">{totalPages}</span>
    </div>
  </div>
{/if}
