<script lang="ts">
  import { fade } from "svelte/transition";

  interface Props {
    title: string;
    coverUrl: string | null;
    subtitle?: string;
    sourceName?: string;
    imageLoading?: "lazy" | "eager";
    onClick?: () => void;
  }

  let {
    title,
    coverUrl,
    subtitle,
    sourceName,
    imageLoading = "lazy",
    onClick,
  }: Props = $props();
</script>

<button
  class="group relative flex flex-col gap-3 text-left transition-transform active:scale-[0.98] outline-none"
  onclick={onClick}
>
  <div
    class="relative aspect-[3/4] rounded-2xl overflow-hidden bg-slate-900 border border-white/5 ring-4 ring-transparent group-hover:ring-blue-500/10 group-focus:ring-blue-500/10 transition-shadow shadow-lg"
  >
    {#if coverUrl}
      <img
        src={coverUrl}
        alt={title}
        class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
        loading={imageLoading}
        referrerpolicy="no-referrer"
      />
    {:else}
      <div class="w-full h-full flex items-center justify-center bg-slate-800">
        <svg
          class="w-10 h-10 text-slate-700"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </div>
    {/if}

    <!-- Overlay Gradient -->
    <div
      class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
    ></div>

    {#if sourceName}
      <div
        class="absolute top-2 right-2 px-2 py-1 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 text-[10px] font-bold text-white/90 uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {sourceName}
      </div>
    {/if}
  </div>

  <div class="flex flex-col gap-1 px-1">
    <h3
      class="text-sm font-bold text-slate-200 group-hover:text-blue-400 transition-colors line-clamp-2 leading-tight"
    >
      {title}
    </h3>
    {#if subtitle}
      <span class="text-[11px] text-slate-500 font-medium line-clamp-1">
        {subtitle}
      </span>
    {/if}
  </div>
</button>
