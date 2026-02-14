<script lang="ts">
  import { fade, scale } from "svelte/transition";

  interface Props {
    open: boolean;
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    variant?: "danger" | "info" | "neutral";
    loading?: boolean;
    maxWidth?: string;
    onConfirm: () => void;
    onCancel: () => void;
    children?: import("svelte").Snippet;
  }

  let {
    open,
    title,
    description,
    confirmText = "Confirm",
    cancelText = "Cancel",
    variant = "neutral",
    loading = false,
    maxWidth = "max-w-md",
    onConfirm,
    onCancel,
    children,
  }: Props = $props();

  function getButtonStyles(variant: "danger" | "info" | "neutral") {
    switch (variant) {
      case "danger":
        return "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/20";
      case "info":
        return "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20";
      default:
        return "bg-slate-700 hover:bg-slate-600 text-white";
    }
  }
  let mouseDownTarget: EventTarget | null = null;
</script>

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
    transition:fade={{ duration: 200 }}
    role="presentation"
    onmousedown={(e) => {
      mouseDownTarget = e.target;
    }}
    onclick={(e) => {
      if (e.target === e.currentTarget && mouseDownTarget === e.currentTarget) {
        onCancel();
      }
    }}
  >
    <!-- Modal Container (to hold shadow separate from overflow-hidden content) -->
    <div
      class="relative w-full {maxWidth}"
      transition:scale={{ start: 0.95, duration: 200 }}
    >
      <!-- Stable Shadow Layer -->
      <div
        class="absolute inset-0 bg-black/50 rounded-2xl shadow-2xl blur-xl -z-10 transform-gpu"
      ></div>

      <!-- Actual Modal Content -->
      <div
        class="w-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden relative outline-none transform-gpu"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.key === "Escape" && onCancel()}
      >
        <!-- Close Button -->
        <button
          class="absolute top-4 right-4 p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg transition-colors z-10"
          onclick={onCancel}
          aria-label="Close"
        >
          <svg
            class="w-5 h-5"
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

        <div class="p-6 space-y-4">
          <h3 class="text-xl font-bold text-white pr-8">{title}</h3>
          <p class="text-slate-400 leading-relaxed text-sm">
            {description}
          </p>
          {#if children}
            {@render children()}
          {/if}
        </div>

        {#if confirmText}
          <div
            class="px-6 py-4 bg-slate-950/30 border-t border-slate-800 flex items-center justify-end gap-3 backdrop-blur-sm"
          >
            <button
              class="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/5"
              onclick={onCancel}
              disabled={loading}
            >
              {cancelText}
            </button>
            <button
              class="px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 {getButtonStyles(
                variant,
              )} disabled:opacity-50 disabled:cursor-not-allowed"
              onclick={onConfirm}
              disabled={loading}
            >
              {#if loading}
                <div
                  class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
                ></div>
              {/if}
              {confirmText}
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
