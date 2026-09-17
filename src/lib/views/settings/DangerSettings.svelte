<script lang="ts">
  import type { SettingsModel } from "./createSettingsModel.svelte";
  let { model }: { model: SettingsModel } = $props();
</script>

<section>
  <h2
    class="text-sm font-bold text-rose-500 uppercase tracking-widest mb-6 px-2"
  >
    Danger Zone
  </h2>

  <div data-setting="clear"
    class="bg-rose-500/[0.03] rounded-2xl border border-rose-500/10 p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:bg-rose-500/[0.05] transition-colors"
  >
    <div>
      <h3 class="text-rose-200 font-medium mb-1">
        Clear Library Database
      </h3>
      <p class="text-rose-200/50 text-sm max-w-md">
        Permanently removes all imported books and metadata from the
        database. Your physical files will not be touched.
      </p>
    </div>

    <button
      onclick={() => (model.showClearDialog = true)}
      disabled={model.loading}
      class="flex items-center justify-center gap-2 px-6 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-medium rounded-xl transition-all border border-rose-500/20 hover:border-rose-500/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shadow-lg shadow-rose-900/10"
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
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        />
      </svg>
      <span>Clear Library</span>
    </button>
  </div>
</section>
