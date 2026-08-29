<script lang="ts">
  let { lastScannedCover, totalScanned, lastScannedItem } = $props<{
    lastScannedCover: string | null;
    totalScanned: number;
    lastScannedItem: { path: string } | null;
  }>();
</script>

<div class="h-full relative overflow-hidden flex flex-col items-center justify-center">
  <div class="absolute inset-0 z-0">
    {#if lastScannedCover}
      <img
        src={lastScannedCover}
        alt=""
        draggable="false"
        class="w-full h-full object-cover blur-2xl opacity-40 brightness-50 transition-all duration-500"
      />
    {/if}
    <div class="absolute inset-0 bg-slate-900/60"></div>
  </div>

  <div class="relative z-10 flex flex-col items-center gap-6 p-8 w-full max-w-4xl">
    <div
      class="relative h-[60vh] aspect-[2/3] rounded-lg overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] bg-slate-800"
    >
      {#if lastScannedCover}
        <img
          src={lastScannedCover}
          alt="Scanning..."
          draggable="false"
          class="w-full h-full object-cover"
        />
      {:else}
        <div class="w-full h-full flex items-center justify-center text-slate-600 bg-slate-800">
          <svg class="w-24 h-24 opacity-20" fill="currentColor" viewBox="0 0 24 24">
            <path
              d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5-7l-3 3.72M9 11l-3 4h12l-4-5z"
            />
          </svg>
        </div>
      {/if}
    </div>

    <div class="text-center space-y-4">
      <div class="flex flex-col items-center">
        <span class="text-6xl font-bold text-white drop-shadow-lg tracking-tighter"
          >{totalScanned}</span
        >
        <span class="text-slate-300 font-medium tracking-wide text-lg uppercase opacity-80"
          >Items Scanned</span
        >
      </div>

      {#if lastScannedItem}
        <p
          class="text-slate-300 font-mono text-sm max-w-2xl truncate bg-black/30 px-4 py-2 rounded-lg backdrop-blur-sm border border-white/5"
        >
          {lastScannedItem.path}
        </p>
      {/if}
    </div>
  </div>
</div>
