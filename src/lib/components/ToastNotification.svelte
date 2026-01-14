<script lang="ts">
  import { toasts, type Toast } from "../stores/toast";
  import { flip } from "svelte/animate";
  import { fly } from "svelte/transition";

  function getTypeStyles(type: Toast["type"]) {
    switch (type) {
      case "success":
        return "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
      case "error":
        return "bg-rose-500/10 border-rose-500/20 text-rose-400";
      case "warning":
        return "bg-amber-500/10 border-amber-500/20 text-amber-400";
      default:
        return "bg-blue-500/10 border-blue-500/20 text-blue-400";
    }
  }

  function getIcon(type: Toast["type"]) {
    switch (type) {
      case "success":
        return '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />';
      case "error":
        return '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />';
      case "warning":
        return '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />';
      default:
        return '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />';
    }
  }
</script>

<div
  class="fixed top-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none"
>
  {#each $toasts as toast (toast.id)}
    <div
      animate:flip={{ duration: 300 }}
      in:fly={{ x: 20, duration: 300 }}
      out:fly={{ x: 20, duration: 300 }}
      class="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-lg shadow-black/20 min-w-[300px] max-w-md {getTypeStyles(
        toast.type,
      )} bg-gray-900/90"
      role="alert"
    >
      <div class="flex-shrink-0">
        <svg
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {@html getIcon(toast.type)}
        </svg>
      </div>
      <p class="text-sm font-medium">{toast.message}</p>
      <button
        class="ml-auto text-current opacity-50 hover:opacity-100 transition-opacity"
        onclick={() => toasts.remove(toast.id)}
        aria-label="Close"
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
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  {/each}
</div>
