<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let placeholder = "Search tags...";
  export let value = "";
  export let excludeTags: string[] = [];
  export let autofocus = false;

  const dispatch = createEventDispatcher();

  let query = "";
  let suggestions: any[] = [];
  let showSuggestions = false;
  let inputElement: HTMLInputElement;
  let selectedIndex = -1;

  $: if (value !== query) {
    query = value;
  }

  // Search when query changes
  $: search(query);

  // Debounced search
  let searchTimeout: any;
  let searchRequestId = 0;

  async function handleInput() {
    value = query;
    dispatch("input", query);
  }

  function search(q: string) {
    searchRequestId++;
    const currentRequestId = searchRequestId;

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      if (q.trim().length < 1) {
        if (searchRequestId === currentRequestId) {
          suggestions = [];
          showSuggestions = false;
        }
        return;
      }

      const results = await window.electronAPI.tags.search(q);

      if (searchRequestId === currentRequestId) {
        suggestions = results.filter((t) => !excludeTags.includes(t.name));
        showSuggestions = suggestions.length > 0;
        selectedIndex = -1;
      }
    }, 200);
  }

  function select(tag: any) {
    query = tag.name;
    value = tag.name;
    showSuggestions = false;
    dispatch("select", tag);
    inputElement.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!showSuggestions) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % suggestions.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex =
        (selectedIndex - 1 + suggestions.length) % suggestions.length;
    } else if (e.key === "Enter") {
      if (selectedIndex >= 0) {
        e.preventDefault();
        select(suggestions[selectedIndex]);
      } else if (suggestions.length > 0) {
        // Optionally select top result? No, explicit selection is better.
      }
    } else if (e.key === "Escape") {
      showSuggestions = false;
    }
  }

  function handleBlur() {
    // Delay hiding to allow click event to fire
    setTimeout(() => {
      showSuggestions = false;
    }, 200);
  }
</script>

<div class="relative w-full">
  <!-- svelte-ignore a11y-autofocus -->
  <input
    bind:this={inputElement}
    type="text"
    bind:value={query}
    on:input={handleInput}
    on:keydown={handleKeydown}
    on:blur={handleBlur}
    {placeholder}
    class="w-full bg-neutral-800 border-2 border-transparent focus:border-cyan-400 focus:outline-none rounded-lg px-4 py-2 text-white placeholder-neutral-500 transition-colors"
    {autofocus}
  />

  {#if showSuggestions}
    <div
      class="absolute z-50 w-full mt-1 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl max-h-60 overflow-y-auto"
    >
      {#each suggestions as tag, i}
        <button
          class="w-full text-left px-4 py-2 hover:bg-neutral-800 flex justify-between items-center group {i ===
          selectedIndex
            ? 'bg-neutral-800'
            : ''}"
          on:click={() => select(tag)}
        >
          <span class="text-white font-medium">{tag.name}</span>
          {#if tag.category_name}
            <span
              class="text-xs text-neutral-400 px-2 py-0.5 rounded bg-neutral-800 group-hover:bg-neutral-700"
            >
              {tag.category_name}
            </span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Scrollbar styles matching the app theme */
  ::-webkit-scrollbar {
    width: 8px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: #404040;
    border-radius: 4px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: #505050;
  }
</style>
