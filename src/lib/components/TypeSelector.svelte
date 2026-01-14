<script lang="ts">
  import { onMount, tick } from "svelte";

  let { itemId, itemIds, onchange } = $props<{
    itemId?: number;
    itemIds?: number[];
    onchange?: () => void;
  }>();

  interface ContentType {
    id: number;
    name: string;
    description: string | null;
  }

  let availableTypes = $state<ContentType[]>([]);
  let currentTypes = $state<number[]>([]);
  let loading = $state(true);
  let saving = $state(false);

  // Icon mapping for known types
  const ICONS: Record<string, string> = {
    manga: "📖",
    doujinshi: "📚",
    webtoon: "📱",
    r18: "🔞",
  };

  onMount(() => {
    loadData();
  });

  async function loadData() {
    loading = true;
    try {
      // Load all available types
      availableTypes = await window.electronAPI.types.getAll();

      // Load item types
      if (itemId) {
        const types = await window.electronAPI.itemTypes.get(itemId);
        currentTypes = types.map((t) => t.id);
      } else if (itemIds && itemIds.length > 0) {
        // Bulk: Find common types or just show logic
        // For simplicity and performance in bulk, we might just load generic logic or
        // check intersection.
        // Let's emulate previous logic: intersection
        const allItemTypes = await Promise.all(
          itemIds.map((id: number) => window.electronAPI.itemTypes.get(id))
        );

        if (allItemTypes.length > 0) {
          // Find intersection of IDs
          const first = new Set(allItemTypes[0].map((t: any) => t.id));
          for (let i = 1; i < allItemTypes.length; i++) {
            const currentIds = new Set(allItemTypes[i].map((t: any) => t.id));
            for (const id of first) {
              if (!currentIds.has(id)) first.delete(id);
            }
          }
          currentTypes = Array.from(first) as number[];
        } else {
          currentTypes = [];
        }
      }
    } catch (e) {
      console.error("Failed to load types:", e);
    } finally {
      loading = false;
    }
  }

  async function toggleType(type: ContentType) {
    if (!type) return;
    saving = true;

    const isSelected = currentTypes.includes(type.id);

    try {
      if (itemId) {
        if (isSelected) {
          await window.electronAPI.itemTypes.remove(itemId, [type.id]);
          currentTypes = currentTypes.filter((id) => id !== type.id);
        } else {
          await window.electronAPI.itemTypes.add(itemId, [type.id]);
          currentTypes = [...currentTypes, type.id];
        }
      } else if (itemIds && itemIds.length > 0) {
        if (isSelected) {
          await window.electronAPI.itemTypes.bulkRemove(itemIds, [type.id]);
          currentTypes = currentTypes.filter((id) => id !== type.id);
        } else {
          await window.electronAPI.itemTypes.bulkAdd(itemIds, [type.id]);
          currentTypes = [...currentTypes, type.id];
        }
      }

      onchange?.();
    } catch (e) {
      console.error("Failed to update item types:", e);
    } finally {
      saving = false;
    }
  }

  function getIcon(name: string): string {
    return ICONS[name.toLowerCase()] || "📄";
  }
</script>

<div
  class="flex flex-col h-full min-h-0 bg-slate-950/50 cursor-default font-sans"
>
  <!-- Header -->
  <div class="p-4 border-b border-slate-800 bg-slate-900">
    <p class="text-xs text-slate-500 uppercase tracking-widest font-semibold">
      Select Item Types
    </p>
    <p class="text-[11px] text-slate-600 mt-1">
      {#if itemIds && itemIds.length > 0}
        Changes apply to all {itemIds.length} selected items
      {:else}
        Choose types for this item
      {/if}
    </p>
  </div>

  <!-- Types Grid -->
  <div class="flex-1 overflow-y-auto p-4 custom-scrollbar">
    {#if loading}
      <div class="flex items-center justify-center h-20">
        <div
          class="w-6 h-6 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin"
        ></div>
      </div>
    {:else}
      <div class="grid grid-cols-2 gap-3">
        {#each availableTypes as type}
          {@const selected = currentTypes.includes(type.id)}
          <button
            class="group relative p-4 rounded-xl border-2 transition-all duration-200 text-left {selected
              ? 'border-blue-500/50 bg-blue-500/10 shadow-lg'
              : 'bg-slate-900/50 border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/50'}"
            onclick={() => toggleType(type)}
            disabled={saving}
          >
            <!-- Checkbox indicator -->
            <div
              class="absolute top-3 right-3 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 {selected
                ? 'bg-blue-500 border-blue-500'
                : 'border-slate-600 group-hover:border-slate-500'}"
            >
              {#if selected}
                <svg
                  class="w-3 h-3 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="3"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              {/if}
            </div>

            <!-- Icon -->
            <div class="text-2xl mb-2">{getIcon(type.name)}</div>

            <!-- Label -->
            <h3
              class="text-sm font-bold {selected
                ? 'text-blue-100'
                : 'text-slate-300 group-hover:text-white'}"
            >
              {type.name}
            </h3>

            <!-- Description -->
            {#if type.description}
              <p
                class="text-[10px] mt-1 leading-relaxed {selected
                  ? 'text-blue-200/70'
                  : 'text-slate-500 group-hover:text-slate-400'}"
              >
                {type.description}
              </p>
            {/if}
          </button>
        {/each}
      </div>

      <!-- Current Selection Summary -->
      {#if currentTypes.length > 0}
        <div class="mt-4 pt-4 border-t border-slate-800">
          <p class="text-xs text-slate-500 mb-2">Selected:</p>
          <div class="flex flex-wrap gap-2">
            {#each currentTypes as typeId}
              {@const typeInfo = availableTypes.find((t) => t.id === typeId)}
              {#if typeInfo}
                <span
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-blue-500/30 bg-blue-500/10 text-blue-300"
                >
                  <span>{getIcon(typeInfo.name)}</span>
                  {typeInfo.name}
                </span>
              {/if}
            {/each}
          </div>
        </div>
      {/if}
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
