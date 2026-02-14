<script lang="ts">
  import { tick } from "svelte";
  import { slide } from "svelte/transition";
  import Dialog from "./Dialog.svelte";
  import type { LibraryItem } from "../stores/app";

  interface Props {
    open: boolean;
    itemsToMove: LibraryItem[];
    onClose: () => void;
    onMoved: (destinationId: number | string | null) => void;
  }

  let { open, itemsToMove, onClose, onMoved }: Props = $props();

  interface TreeNode {
    id: number | string;
    type: "root" | "folder";
    title: string;
    path: string;
    children: TreeNode[];
    expanded: boolean;
    level: number;
    parentId: number | string | null;
  }

  let folders = $state<LibraryItem[]>([]);
  let roots = $state<string[]>([]);
  let tree = $state<TreeNode[]>([]);
  let searchQuery = $state("");
  let isLoading = $state(true);
  let selectedId = $state<number | string | null>(null);
  let sourceId = $state<number | null>(null);
  let isMoving = $state(false);
  let error = $state("");

  let showNewFolderInput = $state(false);
  let newFolderName = $state("");
  let isCreatingFolder = $state(false);
  let expandedSnapshot = $state<Set<number | string> | null>(null);
  let scrollContainer: HTMLDivElement;
  let scrollPosSnapshot = $state<number | null>(null);
  let isRestoring = $state(false);

  function autofocus(node: HTMLElement) {
    node.focus();
  }

  $effect(() => {
    if (open) {
      selectedId = null;
      error = "";
      showNewFolderInput = false;
      newFolderName = "";
      searchQuery = "";

      if (itemsToMove.length > 0) {
        const firstParentId = itemsToMove[0].parent_id;
        const allSame = itemsToMove.every((i) => i.parent_id === firstParentId);
        sourceId = allSame ? firstParentId : null;
      } else {
        sourceId = null;
      }

      refreshFolders();
    }
  });

  async function refreshFolders() {
    isLoading = true;
    try {
      const result = await (window.electronAPI.library as any).getAllFolders();
      if (result.success) {
        folders = result.folders || [];
        roots = result.roots || [];
        buildTree();
        if (sourceId) expandNode(sourceId);
      }
    } catch (e: any) {
      error = "Failed to load folders";
    } finally {
      isLoading = false;
    }
  }

  const filteredFolders = $derived(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return [];
    return folders.filter((f) => f.title.toLowerCase().includes(query));
  });

  function buildTree() {
    const nodes: TreeNode[] = [];

    // Create roots
    roots.forEach((rootPath) => {
      nodes.push({
        id: rootPath,
        type: "root",
        title: rootPath.split(/[\\/]/).pop() || rootPath,
        path: rootPath,
        children: [],
        expanded: false,
        level: 0,
        parentId: null,
      });
    });

    const folderMap = new Map<number, TreeNode>();
    const orphanNodes: TreeNode[] = [];

    folders.forEach((folder) => {
      const node: TreeNode = {
        id: folder.id,
        type: "folder",
        title: folder.title,
        path: folder.path,
        children: [],
        expanded: false,
        level: 0,
        parentId: folder.parent_id,
      };
      folderMap.set(folder.id, node);
    });

    folders.forEach((folder) => {
      const node = folderMap.get(folder.id)!;
      if (folder.parent_id && folderMap.has(folder.parent_id)) {
        const parent = folderMap.get(folder.parent_id)!;
        parent.children.push(node);
      } else {
        let assigned = false;
        for (const rootNode of nodes) {
          const nFolderPath = folder.path.replace(/\\/g, "/");
          const nRootPath = rootNode.path.replace(/\\/g, "/");

          if (nFolderPath.startsWith(nRootPath)) {
            rootNode.children.push(node);
            node.parentId = rootNode.id;
            assigned = true;
            break;
          }
        }
        if (!assigned) {
          orphanNodes.push(node);
        }
      }
    });

    // Handle orphans if they don't fit any root

    const sortNodes = (n: TreeNode[]) => {
      n.sort((a, b) => a.title.localeCompare(b.title));
      n.forEach((child) => sortNodes(child.children));
    };

    sortNodes(nodes);

    const setLevel = (node: TreeNode, lvl: number) => {
      node.level = lvl;
      node.children.forEach((c) => setLevel(c, lvl + 1));
    };
    nodes.forEach((n) => setLevel(n, 0));

    tree = nodes;
  }

  function toggleExpand(node: TreeNode, e: MouseEvent) {
    e.stopPropagation();
    node.expanded = !node.expanded;
    tree = [...tree];
  }

  function selectNode(node: TreeNode, e?: MouseEvent) {
    if (e) {
      e.stopPropagation();
    }

    if (!isValidDestination(node.id)) return;

    if (selectedId === node.id) {
      selectedId = null;
    } else {
      selectedId = node.id;
    }
  }

  async function handleMove() {
    if (selectedId === null || isMoving) return;

    isMoving = true;
    error = "";

    try {
      const itemIds = itemsToMove.map((i) => i.id);
      const result = await (window.electronAPI.library as any).moveItems(
        itemIds,
        selectedId as any,
      );

      if (result.success) {
        onMoved(selectedId);
        onClose();
      } else {
        error = result.error || "Failed to move items";
      }
    } catch (e: any) {
      error = e.message || "An unexpected error occurred";
    } finally {
      isMoving = false;
    }
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim() || isCreatingFolder) return;

    isCreatingFolder = true;
    error = "";

    try {
      let parentId: number | null = null;
      let rootPath: string | undefined = undefined;

      let targetId = selectedId || tree[0]?.id;

      if (typeof targetId === "number") {
        parentId = targetId;
      } else if (typeof targetId === "string") {
        rootPath = targetId;
      } else {
        error = "Please select a destination first";
        isCreatingFolder = false;
        return;
      }

      const result = await (window.electronAPI.library as any).createFolder(
        parentId,
        newFolderName,
        rootPath,
      );

      if (result.success && result.item) {
        await refreshFolders();
        selectedId = result.item.id;
        showNewFolderInput = false;
        newFolderName = "";

        // Expand parent
        if (selectedId) expandNode(selectedId);
      } else {
        error = result.error || "Failed to create folder";
      }
    } catch (e: any) {
      error = e.message || "Failed to create folder";
    } finally {
      isCreatingFolder = false;
    }
  }

  function isDescendant(folderId: number, potentialParentId: number): boolean {
    let current = folders.find((f) => f.id === folderId);
    while (current && current.parent_id) {
      if (current.parent_id === potentialParentId) return true;
      current = folders.find((f) => f.id === current?.parent_id);
    }
    return false;
  }

  function isValidDestination(destId: number | string): boolean {
    return !itemsToMove.some((item) => {
      if (item.id === destId) return true;
      if (item.type === "folder") {
        return isDescendant(destId as number, item.id);
      }
      return false;
    });
  }

  function expandNode(id: number | string) {
    function findAndExpand(nodes: TreeNode[]): boolean {
      for (const node of nodes) {
        if (node.id === id) {
          node.expanded = true;
          return true;
        }
        if (node.children.length > 0) {
          if (findAndExpand(node.children)) {
            node.expanded = true;
            return true;
          }
        }
      }
      return false;
    }
    findAndExpand(tree);
    tree = [...tree];
  }

  async function toggleCollapseAll() {
    if (expandedSnapshot) {
      const restore = (nodes: TreeNode[]) => {
        nodes.forEach((n) => {
          if (expandedSnapshot?.has(n.id)) n.expanded = true;
          restore(n.children);
        });
      };
      isRestoring = true;
      restore(tree);
      expandedSnapshot = null;
      tree = [...tree];

      if (scrollPosSnapshot !== null && scrollContainer) {
        await tick();
        scrollContainer.scrollTop = scrollPosSnapshot;
        scrollPosSnapshot = null;
      }

      // Allow a frame for the scroll to apply before re-enabling transitions
      setTimeout(() => {
        isRestoring = false;
      }, 50);
    } else {
      if (scrollContainer) {
        scrollPosSnapshot = scrollContainer.scrollTop;
      }

      const snapshot = new Set<number | string>();
      const collect = (nodes: TreeNode[]) => {
        nodes.forEach((n) => {
          if (n.expanded) snapshot.add(n.id);
          n.expanded = false;
          collect(n.children);
        });
      };
      collect(tree);
      expandedSnapshot = snapshot;
      tree = [...tree];
    }
  }
</script>

{#snippet newFolderInput(level: number)}
  <div class="flex flex-col mb-1">
    <div
      class="flex items-center py-1 px-2 rounded-md group bg-slate-800/50 border border-blue-500/30"
      style="padding-left: {level * 16 + 8}px"
      transition:slide|local={{ duration: isRestoring ? 0 : 150 }}
    >
      <div class="mr-2 text-amber-500">
        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"
          ><path
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          /></svg
        >
      </div>

      <div class="flex items-center gap-1 flex-1 min-w-0">
        <input
          type="text"
          placeholder="Folder name..."
          bind:value={newFolderName}
          use:autofocus
          onkeydown={(e) => {
            if (e.key === "Enter") handleCreateFolder();
            if (e.key === "Escape") {
              showNewFolderInput = false;
              e.stopPropagation();
            }
          }}
          onclick={(e) => e.stopPropagation()}
          class="w-full bg-transparent border-none text-sm text-white focus:ring-0 placeholder-slate-500 p-0 focus:outline-none"
        />

        <button
          class="p-1 hover:bg-slate-700 text-slate-400 hover:text-white rounded transition-colors"
          onclick={(e) => {
            e.stopPropagation();
            showNewFolderInput = false;
          }}
          title="Cancel"
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
    </div>
  </div>
{/snippet}

{#snippet treeNode(node: TreeNode)}
  <div class="flex flex-col">
    <div
      class="flex items-center py-1 px-2 cursor-pointer transition-colors rounded-md group border border-transparent outline-none
                 {selectedId === node.id
        ? 'bg-blue-600 text-white border-blue-600'
        : sourceId === node.id && selectedId === null
          ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}
               {!isValidDestination(node.id)
        ? 'opacity-40 cursor-not-allowed grayscale'
        : ''}"
      style="padding-left: {node.level * 16 + 8}px"
      onclick={(e) => selectNode(node, e)}
      role="button"
      tabindex="0"
      onkeydown={(e) => e.key === "Enter" && selectNode(node)}
    >
      <button
        class="p-0.5 rounded-sm hover:bg-white/10 mr-1 {node.children.length ===
          0 && !(showNewFolderInput && selectedId === node.id)
          ? 'invisible'
          : ''}"
        onclick={(e) => toggleExpand(node, e)}
        aria-label={node.expanded ? "Collapse" : "Expand"}
        title={node.expanded ? "Collapse" : "Expand"}
      >
        <svg
          class="w-3.5 h-3.5 transition-transform duration-200 {node.expanded
            ? 'rotate-90'
            : ''}"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>

      <div
        class="mr-2 {selectedId === node.id
          ? 'text-white'
          : node.type === 'root'
            ? 'text-blue-400'
            : sourceId === node.id && selectedId === null
              ? 'text-blue-400'
              : 'text-amber-500'}"
      >
        {#if node.type === "root"}
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            /></svg
          >
        {:else}
          <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"
            ><path
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            /></svg
          >
        {/if}
      </div>

      <span class="text-sm truncate select-none flex-1"
        >{node.title}
        {#if sourceId === node.id && selectedId === null}
          <span
            class="ml-2 text-[10px] opacity-70 font-bold uppercase tracking-wider"
            >(Current)</span
          >
        {/if}
      </span>
    </div>

    {#if node.expanded && (node.children.length > 0 || (showNewFolderInput && selectedId === node.id))}
      <div transition:slide|local={{ duration: isRestoring ? 0 : 150 }}>
        {#if showNewFolderInput && selectedId === node.id}
          {@render newFolderInput(node.level + 1)}
        {/if}
        {#each node.children as child (child.id)}
          {@render treeNode(child)}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<Dialog
  {open}
  title={`Move ${itemsToMove.length === 1 ? "Item" : "Items"}`}
  description={`Select a destination for ${itemsToMove.length} item${itemsToMove.length > 1 ? "s" : ""}`}
  confirmText=""
  onConfirm={() => {}}
  onCancel={onClose}
  maxWidth="max-w-2xl"
>
  <div class="flex flex-col h-[500px] -mx-6 -mb-6 bg-slate-950">
    <div
      class="px-4 py-3 border-b border-slate-800 bg-slate-900/50 flex flex-col gap-2"
    >
      <div class="flex items-center gap-2">
        <div class="relative group flex-1">
          <svg
            class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-blue-400 transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search folders..."
            bind:value={searchQuery}
            use:autofocus
            class="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700/50 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:bg-slate-800 transition-all"
          />
        </div>

        <button
          class="p-2 rounded-lg bg-slate-800 border border-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700 hover:border-slate-600 transition-all group/btn"
          onclick={toggleCollapseAll}
          title={expandedSnapshot
            ? "Restore previous expansion"
            : "Collapse all folders"}
        >
          {#if expandedSnapshot}
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
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          {:else}
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
                d="M5 11l7-7 7 7M5 19l7-7 7 7"
              />
            </svg>
          {/if}
        </button>
      </div>

      {#if !searchQuery}
        <div class="flex items-center justify-between px-1">
          <div
            class="text-[10px] text-slate-500 font-medium tracking-wider uppercase"
          >
            File System
          </div>
          <div class="text-[10px] text-slate-500">
            {folders.length} known folders
          </div>
        </div>
      {/if}
    </div>

    <div
      bind:this={scrollContainer}
      class="flex-1 overflow-y-auto min-h-0 py-2 custom-scrollbar bg-slate-950 cursor-default"
      onclick={() => (selectedId = null)}
      role="button"
      tabindex="-1"
      onkeydown={() => {}}
    >
      {#if isLoading}
        <div
          class="flex flex-col items-center justify-center h-full text-slate-500 gap-3"
        >
          <div
            class="w-6 h-6 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"
          ></div>
          <span class="text-xs font-medium">Loading folders...</span>
        </div>
      {:else if searchQuery}
        <div class="px-2 pb-4 space-y-0.5">
          <div
            class="px-2 py-1.5 text-[10px] uppercase font-bold text-slate-500 tracking-wider"
          >
            Search Results
          </div>

          {#if !isCreatingFolder && !filteredFolders().some((f) => f.title.toLowerCase() === searchQuery.toLowerCase())}
            <button
              class="w-full text-left px-3 py-2 rounded-lg transition-all flex items-center gap-3 text-blue-400 hover:bg-blue-500/10 group border border-dashed border-blue-500/20 hover:border-blue-500/40 mb-2"
              onclick={(e) => {
                e.stopPropagation();
                newFolderName = searchQuery;
                handleCreateFolder();
              }}
            >
              <div
                class="p-1 rounded-md bg-blue-500/20 text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition-colors"
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
                    d="M12 4v16m8-8H4"
                  /></svg
                >
              </div>
              <span class="text-sm font-medium">Create "{searchQuery}"</span>
            </button>
          {/if}

          {#each filteredFolders() as folder}
            {@const isValid = isValidDestination(folder.id)}
            <button
              class="w-full text-left px-3 py-2 rounded-lg transition-all flex items-center gap-3 group border border-transparent outline-none
                      {selectedId === folder.id
                ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-500/20'
                : sourceId === folder.id && selectedId === null
                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'} 
                      {!isValid
                ? 'opacity-40 cursor-not-allowed grayscale'
                : ''}"
              disabled={!isValid}
              onclick={(e) => {
                e.stopPropagation();
                selectedId = folder.id;
              }}
            >
              <div
                class="{selectedId === folder.id
                  ? 'text-blue-200'
                  : sourceId === folder.id && selectedId === null
                    ? 'text-blue-400'
                    : 'text-amber-500/80 group-hover:text-amber-400'} transition-colors"
              >
                <svg
                  class="w-5 h-5 fill-current opacity-80"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
              </div>
              <div class="flex flex-col min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium truncate"
                    >{folder.title}</span
                  >
                  {#if sourceId === folder.id && selectedId === null}
                    <span
                      class="text-[10px] opacity-70 font-bold uppercase tracking-wider"
                      >(Current)</span
                    >
                  {/if}
                </div>
                {#if folder.path}
                  <span class="text-[10px] opacity-60 truncate font-mono"
                    >{folder.path}</span
                  >
                {/if}
              </div>
              {#if selectedId === folder.id}
                <svg
                  class="w-4 h-4 ml-auto opacity-60"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  ><path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5 13l4 4L19 7"
                  /></svg
                >
              {/if}
            </button>
          {:else}
            <div
              class="px-3 py-10 text-center text-slate-500 text-sm flex flex-col items-center gap-2"
            >
              <svg
                class="w-8 h-8 opacity-20"
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
              <span>No folders found matching "{searchQuery}"</span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="px-2 pb-4">
          {#if showNewFolderInput && selectedId === null}
            {@render newFolderInput(0)}
          {/if}
          {#each tree as node (node.id)}
            {@render treeNode(node)}
          {/each}
        </div>
      {/if}
    </div>

    <div
      class="p-4 border-t border-slate-800 bg-slate-900 flex items-center justify-between gap-4"
    >
      <button
        class="flex items-center gap-2 text-slate-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-slate-800 transition-colors text-xs font-medium"
        onclick={() => {
          showNewFolderInput = true;
          newFolderName = "";
          if (selectedId) {
            expandNode(selectedId);
          } else if (tree.length > 0) {
            // Default to selecting first root if nothing selected, to avoid ambiguity
            selectedId = tree[0].id;
            expandNode(selectedId);
          }
        }}
        disabled={showNewFolderInput}
        style={showNewFolderInput ? "opacity: 0.5; cursor: default" : ""}
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
        New Folder
      </button>

      <div class="flex items-center gap-3 ml-auto">
        {#if error}
          <span class="text-xs text-rose-400 font-medium">{error}</span>
        {/if}

        <button
          class="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
          onclick={onClose}
        >
          Cancel
        </button>
        <button
          class="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-blue-600/20 transition-all disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed flex items-center gap-2"
          disabled={selectedId === null || isMoving}
          onclick={handleMove}
        >
          {#if isMoving}
            <div
              class="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin"
            ></div>
          {/if}
          {isMoving
            ? "Moving..."
            : `Move ${itemsToMove.length} Item${itemsToMove.length > 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  </div>
</Dialog>

<style>
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
