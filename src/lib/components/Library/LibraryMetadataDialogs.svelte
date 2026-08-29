<script lang="ts">
  import TagSelector from "../TagSelector.svelte";
  import TypeSelector from "../TypeSelector.svelte";

  let {
    showTagEditor,
    tagEditorItemId,
    tagEditorItemTitle,
    closeTagEditor,
    handleTagChange,
    showTypeEditor,
    typeEditorItemId,
    typeEditorItemTitle,
    closeTypeEditor,
    handleTypeChange,
  } = $props<{
    showTagEditor: boolean;
    tagEditorItemId: number | null;
    tagEditorItemTitle: string;
    closeTagEditor: () => void;
    handleTagChange: () => void;
    showTypeEditor: boolean;
    typeEditorItemId: number | null;
    typeEditorItemTitle: string;
    closeTypeEditor: () => void;
    handleTypeChange: () => void;
  }>();
</script>

{#if showTagEditor && tagEditorItemId}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 cursor-default"
    onclick={(e) => {
      if (e.target === e.currentTarget) {
        closeTagEditor();
      }
    }}
    role="button"
    tabindex="-1"
    onkeydown={(e) => e.key === "Escape" && closeTagEditor()}
  >
    <div
      class="bg-slate-900 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl border border-slate-800 relative overflow-hidden cursor-default"
      onclick={() => {}}
      onkeydown={(e) => {
        if (e.key !== "Escape") {
          e.stopPropagation();
        }
      }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <button
        class="absolute top-4 right-4 text-slate-500 hover:text-white z-50"
        onclick={closeTagEditor}
        aria-label="Close"
      >
        <svg
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          /></svg
        >
      </button>

      <div class="p-6 pb-2 shrink-0">
        <h2 class="text-xl font-bold text-white mb-1">Edit Tags</h2>
        <p class="text-sm text-slate-400 truncate">{tagEditorItemTitle}</p>
      </div>

      <div class="flex-1 min-h-0 relative flex flex-col">
        <TagSelector itemId={tagEditorItemId} onchange={handleTagChange} />
      </div>
    </div>
  </div>
{/if}

{#if showTypeEditor && typeEditorItemId}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 cursor-default"
    onclick={(e) => {
      if (e.target === e.currentTarget) {
        closeTypeEditor();
      }
    }}
    role="button"
    tabindex="-1"
    onkeydown={(e) => e.key === "Escape" && closeTypeEditor()}
  >
    <div
      class="bg-slate-900 rounded-2xl w-full max-w-md max-h-[70vh] flex flex-col shadow-2xl border border-slate-800 relative overflow-hidden cursor-default"
      onclick={() => {}}
      onkeydown={(e) => {
        if (e.key !== "Escape") {
          e.stopPropagation();
        }
      }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <button
        class="absolute top-4 right-4 text-slate-500 hover:text-white z-50"
        onclick={closeTypeEditor}
        aria-label="Close"
      >
        <svg
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          /></svg
        >
      </button>

      <div class="p-6 pb-2 shrink-0">
        <h2 class="text-xl font-bold text-white mb-1">Set Type</h2>
        <p class="text-sm text-slate-400 truncate">{typeEditorItemTitle}</p>
      </div>

      <div class="flex-1 min-h-0 relative flex flex-col">
        <TypeSelector itemId={typeEditorItemId} onchange={handleTypeChange} />
      </div>
    </div>
  </div>
{/if}
