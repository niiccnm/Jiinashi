<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fade } from "svelte/transition";
  import Dialog from "../components/Dialog.svelte";
  import { dragScroll } from "../utils/dragScroll";

  let activeTab = $state<"tags" | "categories" | "types">("tags");

  // Data
  let tags = $state<any[]>([]);
  let categories = $state<any[]>([]);
  let contentTypes = $state<any[]>([]);
  let loading = $state(false);

  // Tag local state
  let searchQuery = $state("");
  let filteredTags = $state<any[]>([]);
  let editingTag = $state<any | null>(null);
  let isCreatingTag = $state(false);

  // Alias State
  let tagAliases = $state<string[]>([]);
  let newAlias = $state("");

  // Category local state
  let editingCategory = $state<any | null>(null);
  let isCreatingCategory = $state(false);
  let categoryAliases = $state<string[]>([]);
  let newCategoryAlias = $state("");
  let categorySearchQuery = $state("");
  let filteredCategories = $state<any[]>([]);

  // Types local state
  let editingType = $state<any | null>(null);
  let isCreatingType = $state(false);
  let typeAliases = $state<string[]>([]);
  let newTypeAlias = $state("");
  let typeSearchQuery = $state("");
  let filteredTypes = $state<any[]>([]);

  // Delete Dialog State
  let showDeleteDialog = $state(false);
  let deleteItemType = $state<"tag" | "category" | "type" | null>(null);
  let itemToDelete = $state<any | null>(null);
  let deleteDialogLoading = $state(false);

  // Category Filter State
  let selectedCategoryIds = $state<number[]>([]);
  let excludedCategoryIds = $state<number[]>([]);
  let showCategoryFilter = $state(false);
  let lastCategoryClickTime = $state(0);
  let lastClickedCategoryId = $state<number | null>(null);

  // Category LIST Filter State (for Category tab)
  let categoryListSelectedIds = $state<number[]>([]); // -1 for Default
  let categoryListExcludedIds = $state<number[]>([]);
  let showCategoryListFilter = $state(false);
  let lastCategoryListClickTime = $state(0);
  let lastClickedCategoryListId = $state<number | null>(null);

  // Type LIST Filter State (for Types tab)
  let typeListSelectedIds = $state<number[]>([]); // -1 for Default
  let typeListExcludedIds = $state<number[]>([]);
  let showTypeListFilter = $state(false);
  let lastTypeListClickTime = $state(0);
  let lastClickedTypeListId = $state<number | null>(null);

  onMount(() => {
    refreshAll();

    const handleClickOutside = () => {
      showCategoryFilter = false;
      showCategoryListFilter = false;
      showTypeListFilter = false;
    };

    window.addEventListener("click", handleClickOutside);
    return () => {
      window.removeEventListener("click", handleClickOutside);
    };
  });

  async function refreshAll() {
    loading = true;
    try {
      const [t, c, ct] = await Promise.all([
        window.electronAPI.tags.getAllWithAliases(),
        window.electronAPI.categories.getAll(),
        window.electronAPI.types.getAllWithAliases(),
      ]);
      tags = t;
      categories = c;
      contentTypes = ct;
      filterTags();
      filterCategories();
      filterTypes();
    } finally {
      loading = false;
    }
  }

  // --- Tag Logic ---

  // Score: 0-3 = name match, 4-6 = alias match, 7 = no match (lower = better)
  function calculateTagScore(tag: any, query: string): number {
    const name = tag.name.toLowerCase();
    const q = query.toLowerCase();
    const aliases: string[] = (tag.aliases || []).map((a: string) =>
      a.toLowerCase(),
    );

    // Name matching
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (new RegExp(`[\\s_\\-\\(]${escapeRegex(q)}`).test(name)) return 2;
    if (name.includes(q)) return 3;

    // Alias matching
    for (const alias of aliases) {
      if (alias === q) return 4;
      if (alias.startsWith(q)) return 5;
      if (alias.includes(q)) return 6;
    }

    return 7;
  }

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function filterTags() {
    let baseTags = tags;

    // Filter by Categories
    if (selectedCategoryIds.length > 0 || excludedCategoryIds.length > 0) {
      baseTags = tags.filter((tag) => {
        const catId = tag.category_id || 0;
        const isDefault = !!tag.is_default;

        // Exclusion rules (Strict NOT)
        if (excludedCategoryIds.includes(-1) && isDefault) return false;
        if (excludedCategoryIds.includes(0) && !tag.category_id) return false;
        if (tag.category_id && excludedCategoryIds.includes(tag.category_id))
          return false;

        // Inclusion rules (Additive OR)
        if (selectedCategoryIds.length > 0) {
          let matches = false;
          if (selectedCategoryIds.includes(-1) && isDefault) matches = true;
          if (selectedCategoryIds.includes(0) && !tag.category_id)
            matches = true;
          if (tag.category_id && selectedCategoryIds.includes(tag.category_id))
            matches = true;

          if (!matches) return false;
        }

        return true;
      });
    }

    if (!searchQuery) {
      filteredTags = baseTags;
    } else {
      const q = searchQuery.toLowerCase();
      const scoredTags = baseTags
        .map((tag) => ({ tag, score: calculateTagScore(tag, q) }))
        .filter((item) => item.score < 7)
        .sort((a, b) =>
          a.score !== b.score
            ? a.score - b.score
            : a.tag.name.localeCompare(b.tag.name),
        );
      filteredTags = scoredTags.map((item) => item.tag);
    }
  }

  function startCreateTag() {
    editingTag = {
      name: "",
      category_id: categories[0]?.id || null,
      description: "",
    };
    isCreatingTag = true;
    tagAliases = [];
    newAlias = "";
  }

  async function editTag(tag: any) {
    editingTag = { ...tag };
    isCreatingTag = false;
    newAlias = "";
    // Load aliases
    try {
      tagAliases = await window.electronAPI.tags.getAliases(tag.id);
    } catch (e: any) {
      console.error(e);
      tagAliases = [];
    }
  }

  async function saveTag() {
    if (!editingTag.name) return;
    try {
      if (isCreatingTag) {
        // Create Tag first
        const newTag = await window.electronAPI.tags.create(
          editingTag.name,
          editingTag.category_id,
          editingTag.description,
        );
        // Then add aliases if any
        if (tagAliases.length > 0) {
          await window.electronAPI.tags.addAliases(newTag.id, tagAliases);
        }
      } else {
        await window.electronAPI.tags.update(editingTag.id, {
          name: editingTag.name,
          category_id: editingTag.category_id,
          description: editingTag.description,
        });
        // Aliases: Deferred on Create, Immediate on Edit (matches backend API granularity).
      }
      editingTag = null;
      await refreshAll();
    } catch (e: any) {
      alert("Error saving tag: " + e.message);
    }
  }

  // Alias Management (Immediate for Edit Mode, Deferred for Create Mode)
  async function addAlias() {
    if (!newAlias.trim()) return;
    if (tagAliases.includes(newAlias.trim())) {
      newAlias = "";
      return;
    }

    const alias = newAlias.trim();

    if (!isCreatingTag && editingTag?.id) {
      try {
        await window.electronAPI.tags.addAliases(editingTag.id, [alias]);
        tagAliases = [...tagAliases, alias];
        newAlias = "";
      } catch (e: any) {
        alert("Failed to add alias: " + e.message);
      }
    } else {
      // Deferred
      tagAliases = [...tagAliases, alias];
      newAlias = "";
    }
  }

  async function removeAlias(alias: string) {
    if (!isCreatingTag && editingTag?.id) {
      try {
        await window.electronAPI.tags.removeAlias(editingTag.id, alias);
        tagAliases = tagAliases.filter((a) => a !== alias);
      } catch (e: any) {
        alert("Failed to remove alias: " + e.message);
      }
    } else {
      // Deferred
      tagAliases = tagAliases.filter((a) => a !== alias);
    }
  }

  async function deleteTag(tag: any) {
    itemToDelete = tag;
    deleteItemType = "tag";
    showDeleteDialog = true;
  }

  async function deleteCategory(cat: any) {
    itemToDelete = cat;
    deleteItemType = "category";
    showDeleteDialog = true;
  }

  async function deleteType(type: any) {
    itemToDelete = type;
    deleteItemType = "type";
    showDeleteDialog = true;
  }

  async function handleConfirmDelete() {
    if (!itemToDelete || !deleteItemType) return;
    deleteDialogLoading = true;
    try {
      if (deleteItemType === "tag") {
        await window.electronAPI.tags.delete(itemToDelete.id);
        editingTag = null;
      } else if (deleteItemType === "category") {
        await window.electronAPI.categories.delete(itemToDelete.id);
        editingCategory = null;
      } else if (deleteItemType === "type") {
        await window.electronAPI.types.delete(itemToDelete.id);
        editingType = null;
      }
      await refreshAll();
      showDeleteDialog = false;
    } catch (e: any) {
      alert(`Error deleting ${deleteItemType}: ` + e.message);
    } finally {
      deleteDialogLoading = false;
      itemToDelete = null;
      deleteItemType = null;
    }
  }

  function handleCancelDelete() {
    showDeleteDialog = false;
    itemToDelete = null;
    deleteItemType = null;
  }

  function handleWindowClick(e: MouseEvent) {
    if (showCategoryFilter) {
      showCategoryFilter = false;
    }
  }

  // --- Category Filter Logic ---

  function toggleCategoryFilter(catId: number) {
    if (selectedCategoryIds.includes(catId)) {
      selectedCategoryIds = selectedCategoryIds.filter((id) => id !== catId);
    } else {
      selectedCategoryIds = [...selectedCategoryIds, catId];
    }
    filterTags();
  }

  function handleCategoryClick(catId: number) {
    const now = Date.now();
    const isDoubleClick =
      lastClickedCategoryId === catId && now - lastCategoryClickTime < 300;

    if (isDoubleClick) {
      if (excludedCategoryIds.includes(catId)) {
        excludedCategoryIds = excludedCategoryIds.filter((id) => id !== catId);
      } else {
        selectedCategoryIds = selectedCategoryIds.filter((id) => id !== catId);
        excludedCategoryIds = [...excludedCategoryIds, catId];
      }
    } else {
      if (excludedCategoryIds.includes(catId)) {
        excludedCategoryIds = excludedCategoryIds.filter((id) => id !== catId);
      } else {
        toggleCategoryFilter(catId);
      }
    }

    lastCategoryClickTime = now;
    lastClickedCategoryId = catId;
    filterTags();
  }

  function clearCategoryFilters() {
    selectedCategoryIds = [];
    excludedCategoryIds = [];
    filterTags();
  }

  function handleCategoryListClick(id: number) {
    const now = Date.now();
    const isDoubleClick =
      lastClickedCategoryListId === id && now - lastCategoryListClickTime < 300;

    if (isDoubleClick) {
      if (categoryListExcludedIds.includes(id)) {
        categoryListExcludedIds = categoryListExcludedIds.filter(
          (x) => x !== id,
        );
      } else {
        categoryListSelectedIds = categoryListSelectedIds.filter(
          (x) => x !== id,
        );
        categoryListExcludedIds = [...categoryListExcludedIds, id];
      }
    } else {
      if (categoryListExcludedIds.includes(id)) {
        categoryListExcludedIds = categoryListExcludedIds.filter(
          (x) => x !== id,
        );
      } else {
        if (categoryListSelectedIds.includes(id)) {
          categoryListSelectedIds = categoryListSelectedIds.filter(
            (x) => x !== id,
          );
        } else {
          categoryListSelectedIds = [...categoryListSelectedIds, id];
        }
      }
    }

    lastCategoryListClickTime = now;
    lastClickedCategoryListId = id;
    filterCategories();
  }

  function clearCategoryListFilters() {
    categoryListSelectedIds = [];
    categoryListExcludedIds = [];
    filterCategories();
  }

  function handleTypeListClick(id: number) {
    const now = Date.now();
    const isDoubleClick =
      lastClickedTypeListId === id && now - lastTypeListClickTime < 300;

    if (isDoubleClick) {
      if (typeListExcludedIds.includes(id)) {
        typeListExcludedIds = typeListExcludedIds.filter((x) => x !== id);
      } else {
        typeListSelectedIds = typeListSelectedIds.filter((x) => x !== id);
        typeListExcludedIds = [...typeListExcludedIds, id];
      }
    } else {
      if (typeListExcludedIds.includes(id)) {
        typeListExcludedIds = typeListExcludedIds.filter((x) => x !== id);
      } else {
        if (typeListSelectedIds.includes(id)) {
          typeListSelectedIds = typeListSelectedIds.filter((x) => x !== id);
        } else {
          typeListSelectedIds = [...typeListSelectedIds, id];
        }
      }
    }

    lastTypeListClickTime = now;
    lastClickedTypeListId = id;
    filterTypes();
  }

  function clearTypeListFilters() {
    typeListSelectedIds = [];
    typeListExcludedIds = [];
    filterTypes();
  }

  // --- Category Logic ---

  // Calculates category relevance score (consistent with tag scoring).
  function calculateCategoryScore(cat: any, query: string): number {
    const name = cat.name.toLowerCase();
    const q = query.toLowerCase();

    if (name === q) return 0; // Exact match
    if (name.startsWith(q)) return 1; // Starts with

    const wordBoundaryPattern = new RegExp(`[\\s_\\-\\(]${escapeRegex(q)}`);
    if (wordBoundaryPattern.test(name)) return 2; // Word boundary

    if (name.includes(q)) return 3; // Contains
    return 4; // No match
  }

  function filterCategories() {
    let baseCategories = categories;

    // Filter by Default/Custom
    if (
      categoryListSelectedIds.length > 0 ||
      categoryListExcludedIds.length > 0
    ) {
      baseCategories = categories.filter((cat) => {
        const isDefault = !!cat.is_default;

        // Exclusion
        if (categoryListExcludedIds.includes(-1) && isDefault) return false;

        // Inclusion
        if (categoryListSelectedIds.length > 0) {
          let matches = false;
          if (categoryListSelectedIds.includes(-1) && isDefault) matches = true;
          if (!matches) return false;
        }

        return true;
      });
    }

    if (!categorySearchQuery) {
      filteredCategories = baseCategories;
    } else {
      const q = categorySearchQuery.toLowerCase();
      const scoredCategories = baseCategories
        .map((cat) => ({ cat, score: calculateCategoryScore(cat, q) }))
        .filter((item) => item.score < 4)
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          return a.cat.name.localeCompare(b.cat.name);
        });

      filteredCategories = scoredCategories.map((item) => item.cat);
    }
  }

  function startCreateCategory() {
    editingCategory = { name: "", description: "" };
    isCreatingCategory = true;
    categoryAliases = [];
    newCategoryAlias = "";
  }

  async function editCategory(cat: any) {
    editingCategory = { ...cat };
    isCreatingCategory = false;
    newCategoryAlias = "";
    try {
      categoryAliases = await window.electronAPI.categories.getAliases(cat.id);
    } catch (e: any) {
      console.error(e);
      categoryAliases = [];
    }
  }

  async function saveCategory() {
    if (!editingCategory.name) return;
    try {
      if (isCreatingCategory) {
        const newCat = await window.electronAPI.categories.create(
          editingCategory.name,
          editingCategory.description,
        );
        if (categoryAliases.length > 0) {
          await window.electronAPI.categories.addAliases(
            newCat.id,
            categoryAliases,
          );
        }
      } else {
        await window.electronAPI.categories.update(editingCategory.id, {
          name: editingCategory.name,
          description: editingCategory.description,
        });
      }
      editingCategory = null;
      await refreshAll();
    } catch (e: any) {
      alert("Error saving category: " + e.message);
    }
  }

  async function addCategoryAlias() {
    if (!newCategoryAlias.trim()) return;
    if (categoryAliases.includes(newCategoryAlias.trim())) {
      newCategoryAlias = "";
      return;
    }

    const alias = newCategoryAlias.trim();

    if (!isCreatingCategory && editingCategory?.id) {
      try {
        await window.electronAPI.categories.addAliases(editingCategory.id, [
          alias,
        ]);
        categoryAliases = [...categoryAliases, alias];
        newCategoryAlias = "";
      } catch (e: any) {
        alert("Failed to add alias: " + e.message);
      }
    } else {
      categoryAliases = [...categoryAliases, alias];
      newCategoryAlias = "";
    }
  }

  async function removeCategoryAlias(alias: string) {
    if (!isCreatingCategory && editingCategory?.id) {
      try {
        await window.electronAPI.categories.removeAlias(
          editingCategory.id,
          alias,
        );
        categoryAliases = categoryAliases.filter((a) => a !== alias);
      } catch (e: any) {
        alert("Failed to remove alias: " + e.message);
      }
    } else {
      categoryAliases = categoryAliases.filter((a) => a !== alias);
    }
  }

  // async function deleteCategory(id: number) { ... } -> Removed and handled by handleConfirmDelete

  // --- Types Logic ---

  function filterTypes() {
    let baseTypes = contentTypes;

    // Filter by Default
    if (typeListSelectedIds.length > 0 || typeListExcludedIds.length > 0) {
      baseTypes = contentTypes.filter((type) => {
        const isDefault = !!type.is_default;

        // Exclusion
        if (typeListExcludedIds.includes(-1) && isDefault) return false;

        // Inclusion
        if (typeListSelectedIds.length > 0) {
          let matches = false;
          if (typeListSelectedIds.includes(-1) && isDefault) matches = true;
          if (!matches) return false;
        }

        return true;
      });
    }

    if (!typeSearchQuery) {
      filteredTypes = baseTypes;
    } else {
      const q = typeSearchQuery.toLowerCase();
      filteredTypes = baseTypes.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.aliases.some((a: string) => a.toLowerCase().includes(q)),
      );
    }
  }

  function editType(type: any) {
    editingType = { ...type };
    typeAliases = [...type.aliases];
    newTypeAlias = "";
    isCreatingType = false;
  }

  function createNewType() {
    editingType = { name: "", description: "" };
    typeAliases = [];
    newTypeAlias = "";
    isCreatingType = true;
  }

  function cancelEditType() {
    editingType = null;
    isCreatingType = false;
  }

  async function saveType() {
    if (!editingType || !editingType.name.trim()) return;

    try {
      if (isCreatingType) {
        const created = await window.electronAPI.types.create(
          editingType.name,
          editingType.description,
        );
        if (typeAliases.length > 0) {
          await window.electronAPI.types.addAliases(created.id, typeAliases);
        }
      } else {
        await window.electronAPI.types.update(editingType.id, {
          name: editingType.name,
          description: editingType.description,
        });
        // Aliases are handled individually in the UI for now, but strictly speaking
        // should be synced. The existing alias functions handle add/remove immediately.
      }
      editingType = null;
      isCreatingType = false;
      await refreshAll();
    } catch (e: any) {
      alert("Error saving type: " + e.message);
    }
  }

  // async function deleteType(id: number) { ... } -> Removed and handled by handleConfirmDelete

  async function addTypeAlias() {
    if (!editingType || !newTypeAlias.trim()) return;
    const alias = newTypeAlias.trim();

    if (!isCreatingType) {
      try {
        await window.electronAPI.types.addAliases(editingType.id, [alias]);
        typeAliases = await window.electronAPI.types.getAliases(editingType.id);
        const idx = contentTypes.findIndex((c) => c.id === editingType.id);
        if (idx !== -1) contentTypes[idx].aliases = typeAliases;
      } catch (e: any) {
        console.error(e);
      }
    } else {
      if (!typeAliases.includes(alias)) {
        typeAliases = [...typeAliases, alias];
      }
    }
    newTypeAlias = "";
  }

  async function removeTypeAlias(alias: string) {
    if (!editingType) return;
    if (!isCreatingType) {
      try {
        await window.electronAPI.types.removeAlias(editingType.id, alias);
        typeAliases = await window.electronAPI.types.getAliases(editingType.id);
        const idx = contentTypes.findIndex((c) => c.id === editingType.id);
        if (idx !== -1) contentTypes[idx].aliases = typeAliases;
      } catch (e: any) {
        console.error(e);
      }
    } else {
      typeAliases = typeAliases.filter((a) => a !== alias);
    }
  }

  const categoryColors: Record<string, string> = {
    artist: "text-red-400 border-red-500/30 bg-red-500/10",
    character: "text-green-400 border-green-500/30 bg-green-500/10",
    copyright: "text-purple-400 border-purple-500/30 bg-purple-500/10",
    meta: "text-orange-400 border-orange-500/30 bg-orange-500/10",
    default: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  };

  function getCategoryStyle(catName: string | null): string {
    return (
      categoryColors[catName?.toLowerCase() ?? ""] || categoryColors["default"]
    );
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="h-full flex flex-col bg-slate-950 overflow-hidden">
  <!-- Header -->
  <header
    class="h-16 flex items-center justify-between px-8 bg-slate-900/50 border-b border-slate-800 backdrop-blur-sm z-10 shrink-0"
  >
    <div class="flex items-center gap-4">
      <h1 class="text-xl font-bold text-white tracking-tight">Tag Manager</h1>
      <div class="h-6 w-px bg-slate-800"></div>
      <div class="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
        <button
          class="px-4 py-1 rounded-md text-xs font-semibold uppercase tracking-wider transition-all {activeTab ===
          'tags'
            ? 'bg-slate-700 text-white shadow-sm'
            : 'text-slate-400 hover:text-slate-200'}"
          onclick={() => {
            activeTab = "tags";
            editingTag = null;
          }}
        >
          Tags
        </button>
        <button
          class="px-4 py-1 rounded-md text-xs font-semibold uppercase tracking-wider transition-all {activeTab ===
          'categories'
            ? 'bg-slate-700 text-white shadow-sm'
            : 'text-slate-400 hover:text-slate-200'}"
          onclick={() => {
            activeTab = "categories";
            editingCategory = null;
          }}
        >
          Categories
        </button>
        <button
          class="px-4 py-1 rounded-md text-xs font-semibold uppercase tracking-wider transition-all {activeTab ===
          'types'
            ? 'bg-slate-700 text-white shadow-sm'
            : 'text-slate-400 hover:text-slate-200'}"
          onclick={() => {
            activeTab = "types";
            editingType = null;
          }}
        >
          Types
        </button>
      </div>
    </div>

    <div class="flex items-center gap-4"></div>
  </header>

  <div class="flex-1 flex overflow-hidden">
    <!-- LEFT PANEL: List -->
    <div
      class="w-80 lg:w-96 flex flex-col border-r border-slate-800 bg-slate-925"
    >
      {#if activeTab === "tags"}
        <div class="p-4 border-b border-slate-800 bg-slate-925/50 space-y-3">
          <div class="flex items-center justify-between px-0.5">
            <span
              class="text-[11px] font-bold text-slate-500 uppercase tracking-widest"
              >Tags</span
            >
            <div class="flex items-baseline gap-1">
              <span class="text-xs font-bold text-blue-400 tabular-nums"
                >{filteredTags.length}</span
              >
              <span class="text-[10px] font-medium text-slate-600">/</span>
              <span class="text-xs font-bold text-slate-500 tabular-nums"
                >{tags.length}</span
              >
            </div>
          </div>
          <div class="flex gap-2">
            <div class="relative flex-1">
              <input
                type="text"
                bind:value={searchQuery}
                oninput={filterTags}
                placeholder="Search tags..."
                class="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-slate-500 outline-none ring-0 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-colors"
              />
              <svg
                class="absolute left-3 top-2.5 w-4 h-4 text-slate-500"
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
              {#if searchQuery}
                <button
                  class="absolute right-2.5 top-2.5 text-slate-500 hover:text-white"
                  onclick={() => {
                    searchQuery = "";
                    filterTags();
                  }}
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
            </div>

            <div class="relative">
              <button
                class="flex items-center justify-center w-10 h-[38px] rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 transition-all duration-200 {selectedCategoryIds.length >
                  0 || excludedCategoryIds.length > 0
                  ? 'border-blue-500/50 text-blue-400 bg-blue-500/5'
                  : ''}"
                onclick={(e) => {
                  e.stopPropagation();
                  showCategoryFilter = !showCategoryFilter;
                }}
                title="Filter by category"
              >
                <div class="relative">
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
                      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                    />
                  </svg>
                  {#if selectedCategoryIds.length > 0 || excludedCategoryIds.length > 0}
                    <span
                      class="absolute -top-2.5 -right-2.5 min-w-[16px] h-[16px] flex items-center justify-center bg-blue-500 text-white text-[9px] font-bold rounded-full px-1 shadow-lg shadow-blue-500/20"
                    >
                      {selectedCategoryIds.length + excludedCategoryIds.length}
                    </span>
                  {/if}
                </div>
              </button>

              {#if showCategoryFilter}
                <div
                  role="menu"
                  tabindex="-1"
                  class="absolute left-0 top-full mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-[60] overflow-hidden p-4"
                  onclick={(e) => e.stopPropagation()}
                  onkeydown={(e) => e.stopPropagation()}
                  transition:fade={{ duration: 150 }}
                >
                  <div class="flex items-center justify-between mb-4">
                    <span
                      class="text-[10px] font-bold text-slate-500 uppercase tracking-wider"
                      >Categories</span
                    >
                    <button
                      class="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase"
                      onclick={clearCategoryFilters}>Clear</button
                    >
                  </div>

                  <div class="grid grid-cols-2 gap-2.5">
                    <!-- Default/Systems option -->
                    <button
                      class="flex items-center px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 {selectedCategoryIds.includes(
                        -1,
                      )
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                        : excludedCategoryIds.includes(-1)
                          ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}"
                      onclick={() => handleCategoryClick(-1)}
                    >
                      Default
                    </button>

                    <!-- Uncategorized option -->
                    <button
                      class="flex items-center px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 {selectedCategoryIds.includes(
                        0,
                      )
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                        : excludedCategoryIds.includes(0)
                          ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}"
                      onclick={() => handleCategoryClick(0)}
                    >
                      Uncategorized
                    </button>

                    {#each categories as cat}
                      {@const isSelected = selectedCategoryIds.includes(cat.id)}
                      {@const isExcluded = excludedCategoryIds.includes(cat.id)}
                      <button
                        class="flex items-center px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 {isSelected
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                          : isExcluded
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}"
                        onclick={() => handleCategoryClick(cat.id)}
                      >
                        <span class="truncate">{cat.name}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          </div>
          <button
            class="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all text-sm font-medium shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
            onclick={startCreateTag}
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
                d="M12 4v16m8-8H4"
              /></svg
            >
            Create New Tag
          </button>
        </div>

        <div
          class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar"
          use:dragScroll={{ axis: "y" }}
        >
          {#each filteredTags as tag}
            <button
              class="w-full text-left px-3 py-2.5 rounded-lg transition-all flex justify-between items-center group {editingTag?.id ===
              tag.id
                ? 'bg-blue-900/20 ring-1 ring-blue-500/30'
                : 'hover:bg-slate-800'}"
              onclick={() => editTag(tag)}
            >
              <span
                class="font-medium text-slate-300 group-hover:text-white transition-colors text-sm"
                >{tag.name}</span
              >
              {#if tag.category_name}
                <span
                  class="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border {getCategoryStyle(
                    tag.category_name,
                  )}"
                >
                  {tag.category_name}
                </span>
              {/if}
            </button>
          {/each}
        </div>
      {:else if activeTab === "categories"}
        <!-- Categories List -->
        <div class="p-4 border-b border-slate-800 bg-slate-925/50 space-y-3">
          <div class="flex items-center justify-between px-0.5">
            <span
              class="text-[11px] font-bold text-slate-500 uppercase tracking-widest"
              >Categories</span
            >
            <div class="flex items-baseline gap-1">
              <span class="text-xs font-bold text-blue-400 tabular-nums"
                >{filteredCategories.length}</span
              >
              <span class="text-[10px] font-medium text-slate-600">/</span>
              <span class="text-xs font-bold text-slate-500 tabular-nums"
                >{categories.length}</span
              >
            </div>
          </div>
          <div class="flex gap-2">
            <div class="relative flex-1">
              <input
                type="text"
                bind:value={categorySearchQuery}
                oninput={filterCategories}
                placeholder="Search categories..."
                class="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-slate-500 outline-none ring-0 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-colors"
              />
              <svg
                class="absolute left-3 top-2.5 w-4 h-4 text-slate-500"
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
              {#if categorySearchQuery}
                <button
                  class="absolute right-2.5 top-2.5 text-slate-500 hover:text-white"
                  onclick={() => {
                    categorySearchQuery = "";
                    filterCategories();
                  }}
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
            </div>

            <div class="relative">
              <button
                class="flex items-center justify-center w-10 h-[38px] rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 transition-all duration-200 {categoryListSelectedIds.length >
                  0 || categoryListExcludedIds.length > 0
                  ? 'border-blue-500/50 text-blue-400 bg-blue-500/5'
                  : ''}"
                onclick={(e) => {
                  e.stopPropagation();
                  showCategoryListFilter = !showCategoryListFilter;
                }}
                title="Filter categories"
              >
                <div class="relative">
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
                      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                    />
                  </svg>
                  {#if categoryListSelectedIds.length > 0 || categoryListExcludedIds.length > 0}
                    <span
                      class="absolute -top-2.5 -right-2.5 min-w-[16px] h-[16px] flex items-center justify-center bg-blue-500 text-white text-[9px] font-bold rounded-full px-1 shadow-lg shadow-blue-500/20"
                    >
                      {categoryListSelectedIds.length +
                        categoryListExcludedIds.length}
                    </span>
                  {/if}
                </div>
              </button>

              {#if showCategoryListFilter}
                <div
                  role="menu"
                  tabindex="-1"
                  class="absolute left-0 top-full mt-2 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-[60] overflow-hidden p-4"
                  onclick={(e) => e.stopPropagation()}
                  onkeydown={(e) => e.stopPropagation()}
                  transition:fade={{ duration: 150 }}
                >
                  <div class="flex items-center justify-between mb-4">
                    <span
                      class="text-[10px] font-bold text-slate-500 uppercase tracking-wider"
                      >Filter</span
                    >
                    <button
                      class="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase"
                      onclick={clearCategoryListFilters}>Clear</button
                    >
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <button
                      class="flex items-center px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 {categoryListSelectedIds.includes(
                        -1,
                      )
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                        : categoryListExcludedIds.includes(-1)
                          ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}"
                      onclick={() => handleCategoryListClick(-1)}
                    >
                      Default
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          </div>
          <button
            class="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all text-sm font-medium shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
            onclick={startCreateCategory}
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
                d="M12 4v16m8-8H4"
              /></svg
            >
            Create New Category
          </button>
        </div>
        <div
          class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar"
          use:dragScroll={{ axis: "y" }}
        >
          {#each filteredCategories as cat}
            <button
              class="w-full text-left px-3 py-2.5 rounded-lg transition-all flex justify-between items-center {editingCategory?.id ===
              cat.id
                ? 'bg-blue-900/20 ring-1 ring-blue-500/30'
                : 'hover:bg-slate-800'}"
              onclick={() => editCategory(cat)}
            >
              <span
                class="font-medium text-slate-300 group-hover:text-white transition-colors text-sm"
                >{cat.name}</span
              >
            </button>
          {/each}
        </div>
      {:else if activeTab === "types"}
        <!-- Types List -->
        <div class="p-4 border-b border-slate-800 bg-slate-925/50 space-y-3">
          <div class="flex items-center justify-between px-0.5">
            <span
              class="text-[11px] font-bold text-slate-500 uppercase tracking-widest"
              >Types</span
            >
            <div class="flex items-baseline gap-1">
              <span class="text-xs font-bold text-blue-400 tabular-nums"
                >{filteredTypes.length}</span
              >
              <span class="text-[10px] font-medium text-slate-600">/</span>
              <span class="text-xs font-bold text-slate-500 tabular-nums"
                >{contentTypes.length}</span
              >
            </div>
          </div>
          <div class="flex gap-2">
            <div class="relative flex-1">
              <input
                type="text"
                bind:value={typeSearchQuery}
                oninput={filterTypes}
                placeholder="Search types..."
                class="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-slate-500 outline-none ring-0 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-colors"
              />
              <svg
                class="absolute left-3 top-2.5 w-4 h-4 text-slate-500"
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
              {#if typeSearchQuery}
                <button
                  class="absolute right-2.5 top-2.5 text-slate-500 hover:text-white"
                  onclick={() => {
                    typeSearchQuery = "";
                    filterTypes();
                  }}
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
            </div>

            <div class="relative">
              <button
                class="flex items-center justify-center w-10 h-[38px] rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 transition-all duration-200 {typeListSelectedIds.length >
                  0 || typeListExcludedIds.length > 0
                  ? 'border-blue-500/50 text-blue-400 bg-blue-500/5'
                  : ''}"
                onclick={(e) => {
                  e.stopPropagation();
                  showTypeListFilter = !showTypeListFilter;
                }}
                title="Filter types"
              >
                <div class="relative">
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
                      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                    />
                  </svg>
                  {#if typeListSelectedIds.length > 0 || typeListExcludedIds.length > 0}
                    <span
                      class="absolute -top-2.5 -right-2.5 min-w-[16px] h-[16px] flex items-center justify-center bg-blue-500 text-white text-[9px] font-bold rounded-full px-1 shadow-lg shadow-blue-500/20"
                    >
                      {typeListSelectedIds.length + typeListExcludedIds.length}
                    </span>
                  {/if}
                </div>
              </button>

              {#if showTypeListFilter}
                <div
                  role="menu"
                  tabindex="-1"
                  class="absolute left-0 top-full mt-2 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-[60] overflow-hidden p-4"
                  onclick={(e) => e.stopPropagation()}
                  onkeydown={(e) => e.stopPropagation()}
                  transition:fade={{ duration: 150 }}
                >
                  <div class="flex items-center justify-between mb-4">
                    <span
                      class="text-[10px] font-bold text-slate-500 uppercase tracking-wider"
                      >Filter</span
                    >
                    <button
                      class="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase"
                      onclick={clearTypeListFilters}>Clear</button
                    >
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <button
                      class="flex items-center px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 {typeListSelectedIds.includes(
                        -1,
                      )
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                        : typeListExcludedIds.includes(-1)
                          ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}"
                      onclick={() => handleTypeListClick(-1)}
                    >
                      Default
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          </div>
          <button
            class="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all text-sm font-medium shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
            onclick={createNewType}
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
                d="M12 4v16m8-8H4"
              /></svg
            >
            Create New Type
          </button>
        </div>
        <div
          class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar"
          use:dragScroll={{ axis: "y" }}
        >
          {#each filteredTypes as type}
            <button
              class="w-full text-left px-3 py-2.5 rounded-lg transition-all flex justify-between items-center group {editingType?.id ===
              type.id
                ? 'bg-blue-900/20 ring-1 ring-blue-500/30'
                : 'hover:bg-slate-800'}"
              onclick={() => editType(type)}
            >
              <div class="flex flex-col">
                <span
                  class="font-medium text-slate-300 group-hover:text-white transition-colors text-sm"
                  >{type.name}</span
                >
                {#if type.description}
                  <span class="text-xs text-slate-500 truncate w-32"
                    >{type.description}</span
                  >
                {/if}
              </div>
              {#if type.is_default}
                <span
                  class="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-400"
                >
                  DEF
                </span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- RIGHT PANEL: Editor -->
    <div
      class="flex-1 bg-slate-950 p-8 flex flex-col overflow-y-auto custom-scrollbar"
      use:dragScroll={{ axis: "y" }}
    >
      {#if activeTab === "tags" && editingTag}
        <div
          class="w-full max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
          <div class="flex justify-between items-start mb-8">
            <div>
              <h2 class="text-2xl font-bold text-white mb-1">
                {isCreatingTag ? "Create New Tag" : "Edit Tag"}
              </h2>
              <p class="text-slate-400 text-sm">
                Configure tag details, category, and aliases.
              </p>
            </div>

            {#if !isCreatingTag}
              <button
                class="text-red-400 hover:text-red-300 hover:bg-red-500/10 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-transparent hover:border-red-500/20"
                onclick={() => deleteTag(editingTag)}
              >
                Delete
              </button>
            {/if}
          </div>

          <div class="space-y-6">
            <!-- Name & Category Row -->
            <div class="grid grid-cols-2 gap-6">
              <div>
                <label
                  class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2"
                  for="tagName">Name</label
                >
                <input
                  id="tagName"
                  type="text"
                  bind:value={editingTag.name}
                  class="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all placeholder-slate-600"
                  placeholder="e.g. 1girl"
                />
              </div>

              <div>
                <label
                  class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2"
                  for="tagCat">Category</label
                >
                <div class="relative">
                  <select
                    id="tagCat"
                    bind:value={editingTag.category_id}
                    class="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all appearance-none cursor-pointer"
                  >
                    <option value={null}>Uncategorized</option>
                    {#each categories as cat}
                      <option value={cat.id}>{cat.name}</option>
                    {/each}
                  </select>
                  <!-- Chevron -->
                  <div
                    class="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500"
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
                        d="M19 9l-7 7-7-7"
                      /></svg
                    >
                  </div>
                </div>
              </div>
            </div>

            <!-- Description -->
            <div>
              <label
                class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2"
                for="tagDesc">Description</label
              >
              <textarea
                id="tagDesc"
                bind:value={editingTag.description}
                rows="3"
                class="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all resize-none placeholder-slate-600"
                placeholder="Optional description for this tag..."
              ></textarea>
            </div>

            <!-- Aliases -->
            <div class="pt-2">
              <label
                class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2"
                for="tagAliases">Aliases (Keywords)</label
              >
              <div
                class="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-4"
              >
                <div class="flex gap-2">
                  <input
                    type="text"
                    bind:value={newAlias}
                    class="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500/50 outline-none"
                    placeholder="Add alias (e.g. 'one_girl')..."
                    onkeydown={(e) => e.key === "Enter" && addAlias()}
                  />
                  <button
                    class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors border border-slate-700"
                    onclick={addAlias}
                  >
                    Add
                  </button>
                </div>

                {#if tagAliases.length > 0}
                  <div class="flex flex-wrap gap-2">
                    {#each tagAliases as alias}
                      <div
                        class="bg-slate-800 text-slate-300 text-sm px-3 py-1 rounded-full border border-slate-700 flex items-center gap-2 group hover:border-slate-600 transition-colors"
                      >
                        <span>{alias}</span>
                        <button
                          class="text-slate-500 hover:text-red-400"
                          onclick={() => removeAlias(alias)}
                          aria-label="Remove alias"
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
                {:else}
                  <p class="text-slate-600 text-sm italic">
                    No aliases added yet.
                  </p>
                {/if}
              </div>
            </div>

            <div class="pt-6 border-t border-slate-800 flex justify-end">
              <button
                class="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5 active:translate-y-0"
                onclick={saveTag}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      {:else if activeTab === "categories" && editingCategory}
        <div
          class="w-full max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
          <div class="flex justify-between items-start mb-8">
            <div>
              <h2 class="text-2xl font-bold text-white mb-1">
                {isCreatingCategory ? "Create Category" : "Edit Category"}
              </h2>
              <p class="text-slate-400 text-sm">
                Define a new classification, description, and aliases.
              </p>
            </div>
            {#if !isCreatingCategory}
              <button
                class="text-red-400 hover:text-red-300 hover:bg-red-500/10 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-transparent hover:border-red-500/20"
                onclick={() => deleteCategory(editingCategory)}
              >
                Delete Use Caution
              </button>
            {/if}
          </div>

          <div class="space-y-6">
            <div>
              <label
                class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2"
                for="catName">Name</label
              >
              <input
                id="catName"
                type="text"
                bind:value={editingCategory.name}
                class="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all placeholder-slate-600"
                placeholder="e.g. Series"
              />
            </div>

            <!-- Description -->
            <div>
              <label
                class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2"
                for="catDesc">Description</label
              >
              <textarea
                id="catDesc"
                bind:value={editingCategory.description}
                rows="3"
                class="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all resize-none placeholder-slate-600"
                placeholder="Optional description for this category..."
              ></textarea>
            </div>

            <!-- Aliases -->
            <div class="pt-2">
              <label
                class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2"
                for="catAliases">Aliases (Keywords)</label
              >
              <div
                class="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-4"
              >
                <div class="flex gap-2">
                  <input
                    type="text"
                    bind:value={newCategoryAlias}
                    class="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500/50 outline-none"
                    placeholder="Add alias (e.g. 'Copyright')..."
                    onkeydown={(e) => e.key === "Enter" && addCategoryAlias()}
                  />
                  <button
                    class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors border border-slate-700"
                    onclick={addCategoryAlias}
                  >
                    Add
                  </button>
                </div>

                {#if categoryAliases.length > 0}
                  <div class="flex flex-wrap gap-2">
                    {#each categoryAliases as alias}
                      <div
                        class="bg-slate-800 text-slate-300 text-sm px-3 py-1 rounded-full border border-slate-700 flex items-center gap-2 group hover:border-slate-600 transition-colors"
                      >
                        <span>{alias}</span>
                        <button
                          class="text-slate-500 hover:text-red-400"
                          onclick={() => removeCategoryAlias(alias)}
                          aria-label="Remove alias"
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
                {:else}
                  <p class="text-slate-600 text-sm italic">
                    No aliases added yet.
                  </p>
                {/if}
              </div>
            </div>

            <div class="pt-6 border-t border-slate-800 flex justify-end">
              <button
                class="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5"
                onclick={saveCategory}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      {:else if activeTab === "types" && editingType}
        <div
          class="w-full max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
          <div class="flex justify-between items-start mb-8">
            <div>
              <h2 class="text-2xl font-bold text-white mb-1">
                {isCreatingType ? "Create Type" : "Edit Type"}
              </h2>
              <p class="text-slate-400 text-sm">
                Manage content type definition and aliases.
              </p>
            </div>
            {#if !isCreatingType}
              <button
                class="text-red-400 hover:text-red-300 hover:bg-red-500/10 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-transparent hover:border-red-500/20"
                onclick={() => deleteType(editingType)}
              >
                Delete
              </button>
            {/if}
          </div>

          <div class="space-y-6">
            <div>
              <label
                class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2"
                for="typeName">Name</label
              >
              <input
                id="typeName"
                type="text"
                bind:value={editingType.name}
                class="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all placeholder-slate-600"
                placeholder="e.g. Manga"
              />
            </div>

            <!-- Description -->
            <div>
              <label
                class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2"
                for="typeDesc">Description</label
              >
              <textarea
                id="typeDesc"
                bind:value={editingType.description}
                rows="3"
                class="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all resize-none placeholder-slate-600"
                placeholder="Optional description for this type..."
              ></textarea>
            </div>

            <!-- Aliases -->
            <div class="pt-2">
              <label
                class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2"
                for="typeAliases">Aliases (Keywords)</label
              >
              <div
                class="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-4"
              >
                <div class="flex gap-2">
                  <input
                    type="text"
                    bind:value={newTypeAlias}
                    class="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500/50 outline-none"
                    placeholder="Add alias (e.g. 'comic')..."
                    onkeydown={(e) => e.key === "Enter" && addTypeAlias()}
                  />
                  <button
                    class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors border border-slate-700"
                    onclick={addTypeAlias}
                  >
                    Add
                  </button>
                </div>

                {#if typeAliases.length > 0}
                  <div class="flex flex-wrap gap-2">
                    {#each typeAliases as alias}
                      <div
                        class="bg-slate-800 text-slate-300 text-sm px-3 py-1 rounded-full border border-slate-700 flex items-center gap-2 group hover:border-slate-600 transition-colors"
                      >
                        <span>{alias}</span>
                        <button
                          class="text-slate-500 hover:text-red-400"
                          onclick={() => removeTypeAlias(alias)}
                          aria-label="Remove alias"
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
                {:else}
                  <p class="text-slate-600 text-sm italic">
                    No aliases added yet.
                  </p>
                {/if}
              </div>
            </div>

            <div class="pt-6 border-t border-slate-800 flex justify-end">
              <button
                class="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5"
                onclick={saveType}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      {:else}
        <div
          class="h-full flex flex-col items-center justify-center text-slate-600"
        >
          <div
            class="w-16 h-16 bg-slate-900/50 rounded-2xl flex items-center justify-center mb-4 border border-slate-800"
          >
            <svg
              class="w-8 h-8 text-slate-700"
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
          </div>
          <p class="text-sm font-medium">
            Select an item from the list to view details.
          </p>
        </div>
      {/if}
    </div>
  </div>
</div>

<Dialog
  open={showDeleteDialog}
  title={deleteItemType === "tag"
    ? "Delete Tag"
    : deleteItemType === "category"
      ? "Delete Category"
      : "Delete Type"}
  description={deleteItemType === "tag"
    ? `Are you sure you want to delete the tag "${itemToDelete?.name}"?`
    : deleteItemType === "category"
      ? `Are you sure you want to delete the category "${itemToDelete?.name}"? All tags in this category will be uncategorized.`
      : `Are you sure you want to delete the type "${itemToDelete?.name}"? Items with this type will have the type assignment removed.`}
  confirmText="Delete"
  variant="danger"
  loading={deleteDialogLoading}
  onConfirm={handleConfirmDelete}
  onCancel={handleCancelDelete}
/>

<style>
  /* Custom Scrollbar for this view */
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: #334155; /* slate-700 */
    border-radius: 9999px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: #475569; /* slate-600 */
  }
</style>
