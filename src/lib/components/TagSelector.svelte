<script lang="ts">
  import { tagClipboard } from "../stores/tagClipboard";
  import { onMount, untrack } from "svelte";

  let { itemId, itemIds, onchange } = $props<{
    itemId?: number;
    itemIds?: number[];
    onchange?: () => void;
  }>();

  let tags = $state<any[]>([]);
  let groupedTags = $state<Record<string, any[]>>({});
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Clipboard State
  let showCopiedFeedback = $state(false);
  let clipboardTags = $state<any[]>([]);

  // Dynamic subscription for clipboard
  $effect(() => {
    const unsub = tagClipboard.subscribe((v) => {
      clipboardTags = v;
    });
    return unsub;
  });

  // Autocomplete State
  let query = $state("");
  let suggestions = $state<any[]>([]);
  let showSuggestions = $state(false);
  let inputRef = $state<HTMLInputElement | null>(null);
  let selectedIndex = $state(-1);

  // Stabilize itemIds trigger to prevent flashes on setiap tag change
  let idsTrigger = $derived(JSON.stringify(itemIds));

  onMount(() => {
    loadTags();
    // Auto-focus when opened
    setTimeout(() => inputRef?.focus(), 50);
  });

  $effect(() => {
    // Only re-run loadTags if IDs actually change (not just the array reference)
    idsTrigger;
    itemId;
    untrack(() => loadTags());
  });

  async function loadTags(silent = false) {
    if (!itemId && (!itemIds || itemIds.length === 0)) return;
    if (!silent) loading = true;
    error = null;
    try {
      if (itemId) {
        tags = await window.electronAPI.itemTags.get(itemId);
      } else if (itemIds) {
        tags = await window.electronAPI.itemTags.getBulk(itemIds);
      }
      groupTags();
    } catch (e: any) {
      error = e.message;
    } finally {
      if (!silent) loading = false;
    }
  }

  function groupTags() {
    const grouped: Record<string, any[]> = {};
    for (const tag of tags) {
      const cat = tag.category_name || "Uncategorized";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(tag);
    }
    groupedTags = grouped;
  }

  // --- Actions ---

  async function addTag(tag: any) {
    if (itemId && tags.find((t) => t.id === tag.id)) {
      clearInput();
      return;
    }

    try {
      // Optimistic update for suggestions so it feels instant
      suggestions = suggestions.filter((t) => t.id !== tag.id);

      if (itemId) {
        await window.electronAPI.itemTags.add(itemId, [tag.id]);
        await loadTags(true);
      } else if (itemIds) {
        await window.electronAPI.library.bulkSetTags(itemIds, [tag.id], "add");
        await loadTags(true);
      }

      onchange?.();

      // Keep focus for rapid entry
      inputRef?.focus();
    } catch (e) {
      console.error("Failed to add tag:", e);
    }
  }

  async function removeTag(tagId: number) {
    try {
      if (itemId) {
        await window.electronAPI.itemTags.remove(itemId, [tagId]);
        await loadTags(true);
      } else if (itemIds) {
        await window.electronAPI.library.bulkSetTags(
          itemIds,
          [tagId],
          "remove"
        );
        await loadTags(true);
      }
      onchange?.();
    } catch (e) {
      console.error("Failed to remove tag:", e);
    }
  }

  // --- Clipboard Actions ---

  function copyTags() {
    if (tags.length === 0) return;
    tagClipboard.set([...tags]);

    // Also copy to system clipboard as text
    const textToCopy = tags.map((t) => t.name).join(", ");
    navigator.clipboard.writeText(textToCopy).catch((err) => {
      console.error("Failed to copy to system clipboard:", err);
    });

    showCopiedFeedback = true;
    setTimeout(() => {
      showCopiedFeedback = false;
    }, 2000);
  }

  async function pasteTags() {
    if (clipboardTags.length === 0) return;

    // Filter out tags that are already present
    const tagsToAdd = clipboardTags.filter(
      (ct) => !tags.some((t) => t.id === ct.id)
    );
    if (tagsToAdd.length === 0) return;

    try {
      const tagIds = tagsToAdd.map((t) => t.id);

      if (itemId) {
        await window.electronAPI.itemTags.add(itemId, tagIds);
        await loadTags(true);
      } else if (itemIds) {
        await window.electronAPI.library.bulkSetTags(itemIds, tagIds, "add");
        await loadTags(true);
      }

      onchange?.();
    } catch (e) {
      console.error("Failed to paste tags:", e);
    }
  }

  // --- Autocomplete ---

  let searchRequestId = 0;

  async function handleInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    query = val;

    searchRequestId++;
    const currentRequestId = searchRequestId;

    if (val.trim().length === 0) {
      if (searchRequestId === currentRequestId) {
        suggestions = [];
        showSuggestions = false;
      }
      return;
    }

    // Debounce to improve performance and consistency
    setTimeout(async () => {
      // Re-check empty just in case (though handleInput handles it, this is async)
      if (val.trim().length === 0) return;

      const results = await window.electronAPI.tags.search(val);

      if (searchRequestId === currentRequestId) {
        // Filter out already assigned tags
        suggestions = results.filter(
          (t) => !tags.some((existing) => existing.id === t.id)
        );
        showSuggestions = suggestions.length > 0;
        selectedIndex = -1;
      }
    }, 100);
  }

  function handleKeydown(e: KeyboardEvent) {
    // Handle Arrow Navigation
    if (
      suggestions.length > 0 &&
      (e.key === "ArrowDown" || e.key === "ArrowUp")
    ) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (e.key === "ArrowDown") {
        selectedIndex =
          selectedIndex === -1 ? 0 : (selectedIndex + 1) % suggestions.length;
      } else {
        selectedIndex =
          selectedIndex === -1
            ? suggestions.length - 1
            : (selectedIndex - 1 + suggestions.length) % suggestions.length;
      }
      scrollToSelected();
      return;
    }

    // Handle Selection
    if (e.key === "Enter") {
      if (suggestions.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        addTag(suggestions[selectedIndex >= 0 ? selectedIndex : 0]);
        return;
      }
    }

    // Handle Escape
    if (e.key === "Escape") {
      if (showSuggestions) {
        e.preventDefault();
        e.stopPropagation();
        showSuggestions = false;
        selectedIndex = -1;
        return;
      }
    }
  }

  function handleFocus() {
    if (query.trim().length > 0 && suggestions.length > 0) {
      showSuggestions = true;
    } else if (query.trim().length > 0) {
      window.electronAPI.tags.search(query).then((results) => {
        suggestions = results.filter(
          (t) => !tags.some((existing) => existing.id === t.id)
        );
        showSuggestions = suggestions.length > 0;
      });
    }
  }

  function handleWindowClick(e: MouseEvent) {
    if (!showSuggestions) return;
    const target = e.target as Node;
    const container = document.getElementById("suggestions-container");

    if (
      inputRef &&
      !inputRef.contains(target) &&
      container &&
      !container.contains(target)
    ) {
      showSuggestions = false;
    }
  }

  function scrollToSelected() {
    // Small delay to allow DOM update
    setTimeout(() => {
      const container = document.getElementById("suggestions-container");
      const item = document.getElementById(`suggestion-${selectedIndex}`);
      if (container && item) {
        item.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }, 0);
  }

  function clearInput() {
    query = "";
    suggestions = [];
    showSuggestions = false;
    inputRef?.focus();
  }

  // --- Styling ---

  function getCategoryStyle(cat: string): string {
    const c = cat?.toLowerCase();
    if (c === "artist") return "text-red-400 border-red-500/30 bg-red-500/10";
    if (c === "character")
      return "text-green-400 border-green-500/30 bg-green-500/10";
    if (c === "copyright")
      return "text-purple-400 border-purple-500/30 bg-purple-500/10";
    if (c === "meta")
      return "text-orange-400 border-orange-500/30 bg-orange-500/10";
    return "text-blue-400 border-blue-500/30 bg-blue-500/10";
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div
  class="flex flex-col h-full min-h-0 bg-slate-950/50 cursor-default font-sans"
>
  <!-- Input Header -->
  <div class="p-4 border-b border-slate-800 bg-slate-900 relative z-20">
    <div class="relative">
      <svg
        class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        ><path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        /></svg
      >
      <input
        bind:this={inputRef}
        type="text"
        bind:value={query}
        oninput={handleInput}
        onkeydown={handleKeydown}
        onfocus={handleFocus}
        placeholder="Add a tag..."
        class="w-full bg-slate-950/50 border border-slate-700/0 rounded-xl pl-10 pr-10 py-3 text-white placeholder-slate-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-[border-color,background-color,box-shadow] duration-200 shadow-inner font-medium"
      />

      {#if query}
        <button
          onclick={clearInput}
          class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-white rounded-full hover:bg-slate-700/50 transition-colors"
          aria-label="Clear search"
        >
          <svg
            class="w-4 h-4"
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
      {/if}

      <!-- Dropdown -->
      {#if showSuggestions}
        <div
          id="suggestions-container"
          class="absolute left-0 right-0 top-full mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto z-50 animate-in fade-in zoom-in-95 duration-100"
        >
          {#each suggestions as tag, i}
            <button
              id={`suggestion-${i}`}
              class="w-full text-left px-4 py-2.5 hover:bg-slate-700 flex justify-between items-center group transition-colors {i ===
              selectedIndex
                ? 'bg-slate-700'
                : ''}"
              onclick={() => addTag(tag)}
            >
              <span class="text-white font-medium text-sm">{tag.name}</span>
              {#if tag.category_name}
                <span
                  class="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border {getCategoryStyle(
                    tag.category_name
                  )}"
                >
                  {tag.category_name}
                </span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Toolbar -->
    <div class="flex items-center gap-2 mt-3">
      <button
        onclick={copyTags}
        disabled={tags.length === 0}
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950/40 text-xs font-bold uppercase tracking-wider transition-all border border-slate-700/50 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:pointer-events-none group active:scale-95 {showCopiedFeedback
          ? 'text-green-400 border-green-500/30'
          : 'text-slate-400'}"
      >
        {#if showCopiedFeedback}
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2.5"
              d="M5 13l4 4L19 7"
            />
          </svg>
          Copied!
        {:else}
          <svg
            class="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
            />
          </svg>
          Copy Tags
        {/if}
      </button>

      <button
        onclick={pasteTags}
        disabled={clipboardTags.length === 0}
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950/40 text-xs font-bold uppercase tracking-wider transition-all border border-slate-700/50 hover:bg-blue-500/20 hover:text-blue-400 hover:border-blue-500/30 disabled:opacity-20 disabled:pointer-events-none group active:scale-95 text-slate-400"
      >
        <svg
          class="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        Paste Tags ({clipboardTags.length})
      </button>

      <div
        class="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950/20 border border-slate-800/50"
      >
        <span
          class="text-xs font-bold text-slate-400 uppercase tracking-widest"
        >
          {itemIds && itemIds.length > 0 ? "Shared" : "Total"}
        </span>
        <span
          class="text-sm font-mono font-bold text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20"
        >
          {tags.length}
        </span>
      </div>
    </div>
  </div>

  <!-- Tags List -->
  <div
    class="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar z-10 bg-slate-900/30"
  >
    {#if loading}
      <div class="flex items-center justify-center h-20">
        <div
          class="w-6 h-6 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin"
        ></div>
      </div>
    {:else if Object.keys(groupedTags).length === 0}
      <div
        class="flex flex-col items-center justify-center py-10 text-slate-500 text-center px-4"
      >
        <svg
          class="w-12 h-12 mb-3 opacity-30 {itemIds?.length
            ? 'text-blue-400'
            : ''}"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
          /></svg
        >
        {#if itemIds && itemIds.length > 0}
          <p class="text-sm font-medium text-slate-400">
            Add tags to all {itemIds.length} items.
          </p>
          <p class="text-xs mt-1 text-slate-500">
            Selected items share no common tags.
          </p>
        {:else}
          <p class="text-sm">No tags assigned yet.</p>
        {/if}
      </div>
    {:else}
      {#if itemIds && itemIds.length > 0}
        <div class="px-1 mb-4">
          <p
            class="text-xs font-bold text-blue-400 uppercase tracking-widest mb-1"
          >
            Shared Tags
          </p>
          <p class="text-[10px] text-slate-500">
            These tags are common to all {itemIds.length} selected items.
          </p>
        </div>
      {/if}
      {#each Object.entries(groupedTags) as [category, categoryTags]}
        <div class="animate-in fade-in slide-in-from-bottom-2 duration-500">
          <h4
            class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 px-1"
          >
            {category}
          </h4>
          <div class="flex flex-wrap gap-2">
            {#each categoryTags as tag}
              <div
                class="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-lg border bg-slate-900/80 transition-[border-color,background-color,transform] duration-200 hover:bg-slate-800 group {getCategoryStyle(
                  category
                )} border-opacity-0 hover:border-opacity-40"
              >
                <span
                  class="text-sm font-medium text-slate-300 group-hover:text-white"
                  >{tag.name}</span
                >
                <button
                  class="p-0.5 text-slate-500 hover:text-red-400 rounded-md transition-colors opacity-60 group-hover:opacity-100"
                  onclick={() => removeTag(tag.id)}
                  title="Remove tag"
                >
                  <svg
                    class="w-3.5 h-3.5"
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
              </div>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: #334155;
    border-radius: 9999px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: #475569;
  }
</style>
