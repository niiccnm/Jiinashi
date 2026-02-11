<script lang="ts">
  import { onMount } from "svelte";
  import { slide, fade } from "svelte/transition";

  let {
    currentRoot,
    onSelect,
    sortOrder = "alphabetical",
  } = $props<{
    currentRoot: string;
    onSelect: (root: string) => void;
    sortOrder?: "alphabetical" | "imported";
  }>();

  let roots = $state<string[]>([]);
  let isOpen = $state(false);

  onMount(() => {
    window.electronAPI.library.getRoots().then((r) => (roots = r));

    const unsubscribe = window.electronAPI.library.onRootsUpdated(
      (newRoots) => {
        roots = newRoots;
      },
    );

    return () => unsubscribe();
  });

  const displayRoots = $derived.by(() => {
    const mapped = roots.map((p) => ({
      path: p,
      label: p.split(/[\\/]/).pop() || p,
      icon: "folder",
    }));

    if (sortOrder === "alphabetical") {
      mapped.sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      );
    }

    return [{ path: "", label: "All Collections", icon: "globe" }, ...mapped];
  });

  const currentLabel = $derived(
    displayRoots.find((r) => r.path === currentRoot)?.label ||
      "All Collections",
  );

  let container = $state<HTMLElement | null>(null);

  function select(path: string) {
    onSelect(path);
    isOpen = false;
  }
</script>

<svelte:window
  onpointerdown={(e) => {
    if (isOpen && container && !container.contains(e.target as Node)) {
      isOpen = false;
    }
  }}
/>

{#if roots.length > 1}
  <div bind:this={container} class="relative inline-block text-left z-50">
    <button
      type="button"
      class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/50 border border-slate-800 hover:border-slate-700 hover:bg-slate-800/50 transition-all duration-200 group"
      onclick={() => (isOpen = !isOpen)}
    >
      <svg
        class="w-4 h-4 text-slate-400 group-hover:text-indigo-400 transition-colors"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
      <span class="text-sm font-medium text-slate-200">{currentLabel}</span>
      <svg
        class="w-4 h-4 text-slate-500 group-hover:text-slate-300 transition-transform duration-200 {isOpen
          ? 'rotate-180'
          : ''}"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </button>

    {#if isOpen}
      <div
        class="absolute left-0 mt-2 w-64 origin-top-left rounded-xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden ring-1 ring-black ring-opacity-5"
        transition:slide={{ duration: 200 }}
      >
        <div class="p-1.5 space-y-1">
          {#each displayRoots as root}
            <button
              class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors {currentRoot ===
              root.path
                ? 'bg-indigo-600/10 text-indigo-400'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}"
              onclick={() => select(root.path)}
            >
              {#if root.icon === "globe"}
                <svg
                  class="w-4 h-4 {currentRoot === root.path
                    ? 'text-indigo-400'
                    : 'text-slate-500'}"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                  />
                </svg>
              {:else}
                <svg
                  class="w-4 h-4 {currentRoot === root.path
                    ? 'text-indigo-400'
                    : 'text-slate-500'}"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
              {/if}
              <div class="flex flex-col">
                <span class="text-sm font-medium truncate">{root.label}</span>
                {#if root.path}
                  <span class="text-[10px] text-slate-500 truncate mt-0.5"
                    >{root.path}</span
                  >
                {/if}
              </div>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Custom glassmorphism-like feel */
  button {
    backdrop-filter: blur(8px);
  }
</style>
