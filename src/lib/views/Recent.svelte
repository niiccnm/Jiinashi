<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { openBook } from "../stores/app";
  import type { LibraryItem } from "../stores/app";
  import { dragScroll } from "../utils/dragScroll";
  import Dialog from "../components/Dialog.svelte";
  import ArchiveManager from "../components/ArchiveManager.svelte";
  import MoveToFolderDialog from "../components/MoveToFolderDialog.svelte";
  import LibraryMetadataDialogs from "../components/Library/LibraryMetadataDialogs.svelte";
  import { toasts } from "../stores/toast";

  let items = $state<LibraryItem[]>([]);
  let loading = $state(true);
  let coverCache = $state<Record<number, string>>({});
  let loadingCovers = $state<Set<number>>(new Set());
  let refreshTimer: any = null;
  let blurR18 = $state(false);
  let blurR18Hover = $state(false);
  let blurR18Intensity = $state(12);
  let activeMenuId = $state<number | null>(null);
  let managingArchiveItem = $state<LibraryItem | null>(null);
  let moveItem = $state<LibraryItem | null>(null);

  let pendingDeleteItem = $state<LibraryItem | null>(null);
  let deleteDialogLoading = $state(false);
  let renameItem = $state<LibraryItem | null>(null);
  let renameValue = $state("");
  let renameLoading = $state(false);
  let renameError = $state("");

  let tagEditorItem = $state<LibraryItem | null>(null);
  let typeEditorItem = $state<LibraryItem | null>(null);

  type MenuActionKey =
    | "tags"
    | "type"
    | "content"
    | "move"
    | "rename"
    | "location"
    | "delete";

  type MenuAction = {
    key: MenuActionKey;
    label: string;
    icon: string;
    danger?: boolean;
  };

  const MENU_ICONS = {
    tags: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
    type: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
    move: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
    rename: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
    location: "M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z",
    delete: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  };

  const MENU_ACTIONS = [
    { key: "tags", label: "Edit Tags", icon: MENU_ICONS.tags },
    { key: "type", label: "Set Type", icon: MENU_ICONS.type },
    { key: "content", label: "Manage Content", icon: MENU_ICONS.type },
    { key: "move", label: "Move Item", icon: MENU_ICONS.move },
    { key: "rename", label: "Rename", icon: MENU_ICONS.rename },
    { key: "location", label: "Open Location", icon: MENU_ICONS.location },
    { key: "delete", label: "Delete", icon: MENU_ICONS.delete, danger: true },
  ] satisfies MenuAction[];

  function runMenuAction(key: MenuActionKey, item: LibraryItem) {
    switch (key) {
      case "tags":
        tagEditorItem = item;
        return;
      case "type":
        typeEditorItem = item;
        return;
      case "content":
        managingArchiveItem = item;
        return;
      case "move":
        moveItem = item;
        return;
      case "rename":
        openRenameDialog(item);
        return;
      case "location":
        void window.electronAPI.library.showInFolder(item.path);
        return;
      case "delete":
        pendingDeleteItem = item;
    }
  }

  async function refreshSettings() {
    try {
      const all = await window.electronAPI.settings.getAll();
      if (all) {
        blurR18 = all.blurR18 === "true";
        blurR18Hover = all.blurR18Hover === "true";
        blurR18Intensity = all.blurR18Intensity
          ? parseInt(all.blurR18Intensity)
          : 12;
      }
    } catch (e) {
      console.error("Failed to refresh settings", e);
    }
  }

  // Dialog state
  let removeDialogOpen = $state(false);
  let itemToRemove = $state<LibraryItem | null>(null);

  async function openRemoveDialog(item: LibraryItem, event: Event) {
    event.stopPropagation();
    itemToRemove = item;
    removeDialogOpen = true;
  }

  function closeRemoveDialog() {
    removeDialogOpen = false;
    itemToRemove = null;
  }

  async function confirmRemove() {
    if (!itemToRemove) return;

    try {
      await window.electronAPI.library.removeFromRecent(itemToRemove.id);
      items = items.filter((i) => i.id !== itemToRemove!.id);
      closeRemoveDialog();
    } catch (e) {
      console.error("Failed to remove from recent:", e);
    }
  }

  function toggleMenu(id: number, event: MouseEvent) {
    event.stopPropagation();
    activeMenuId = activeMenuId === id ? null : id;
  }

  function closeMenu() {
    activeMenuId = null;
  }

  function openRenameDialog(item: LibraryItem) {
    renameItem = item;
    renameValue = item.title;
    renameError = "";
  }

  async function handleRename() {
    if (!renameItem || !renameValue.trim() || renameLoading) return;
    renameLoading = true;
    renameError = "";

    try {
      const result = await window.electronAPI.library.renameItem(
        renameItem.id,
        renameValue.trim(),
      );
      if (!result.success) {
        renameError = result.error || "Failed to rename";
        return;
      }

      renameItem = null;
    } catch (error: any) {
      renameError = error?.message || "Failed to rename";
    } finally {
      renameLoading = false;
    }
  }

  async function refreshItem(id: number | undefined) {
    if (!id) return;
    try {
      const updatedItem = await window.electronAPI.library.getItem(id);
      if (updatedItem) {
        items = items.map((item) =>
          item.id === updatedItem.id ? { ...item, ...updatedItem } : item,
        );
      }
    } catch (error) {
      console.error("Failed to refresh recent item metadata:", error);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteItem) return;
    const itemToDelete = pendingDeleteItem;
    deleteDialogLoading = true;
    try {
      await window.electronAPI.library.deleteItem(itemToDelete.id);
      items = items.filter((item) => item.id !== itemToDelete.id);
      pendingDeleteItem = null;
    } catch (error) {
      console.error("Failed to delete recent item:", error);
      toasts.add(
        "The item could not be moved to the Recycle Bin.",
        "error",
        6000,
      );
    } finally {
      deleteDialogLoading = false;
    }
  }

  async function loadRecent(silent: boolean = false) {
    if (!silent) loading = true;
    try {
      items = await window.electronAPI.library.getRecent(50);
      loadCoversForItems(items);
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) loading = false;
    }
  }

  async function loadCoversForItems(itemList: LibraryItem[]) {
    for (const item of itemList) {
      if (
        item.cover_path &&
        !coverCache[item.id] &&
        !loadingCovers.has(item.id)
      ) {
        loadingCovers.add(item.id);
        loadingCovers = new Set(loadingCovers);

        try {
          const dataUrl = await window.electronAPI.library.getCover(
            item.cover_path,
          );
          if (dataUrl) {
            coverCache[item.id] = dataUrl;
            coverCache = { ...coverCache };
          }
        } catch (e) {
          console.error("Failed to load cover:", e);
        } finally {
          loadingCovers.delete(item.id);
          loadingCovers = new Set(loadingCovers);
        }
      }
    }
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  function getProgressPercent(item: LibraryItem): number {
    if (item.page_count === 0) return 0;
    return Math.round((item.current_page / item.page_count) * 100);
  }

  onMount(() => {
    loadRecent();
    refreshSettings();
    const unsubscribe = window.electronAPI.library.onItemUpdated(
      async (payload) => {
        const existingIndex = items.findIndex((i) => i.id === payload.id);
        if (existingIndex !== -1) {
          const timestampChanged =
            Boolean(payload.last_read_at) &&
            payload.last_read_at !== items[existingIndex].last_read_at;
          const updated = {
            ...items[existingIndex],
            current_page: payload.current_page,
            last_read_at:
              payload.last_read_at ?? items[existingIndex].last_read_at,
          };
          if (timestampChanged) {
            items = [
              updated,
              ...items.slice(0, existingIndex),
              ...items.slice(existingIndex + 1),
            ];
          } else {
            items = [
              ...items.slice(0, existingIndex),
              updated,
              ...items.slice(existingIndex + 1),
            ];
          }
          loadCoversForItems([updated]);
        } else {
          try {
            const fetched = await window.electronAPI.library.getItem(
              payload.id,
            );
            if (fetched && fetched.last_read_at) {
              items = [fetched, ...items];
              loadCoversForItems([fetched]);
            }
          } catch (e) {
            console.error(e);
          }
        }

        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          loadRecent(true);
        }, 300);
      },
    );
    const unsubscribeRefreshed = window.electronAPI.library.onRefreshed(() => {
      loadRecent(true);
    });
    const unsubscribeCleared = window.electronAPI.library.onCleared(() => {
      loadRecent(true);
    });
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
      unsubscribeRefreshed();
      unsubscribeCleared();
    };
  });
</script>

<svelte:window onclick={closeMenu} />

<header
  class="h-16 bg-slate-900/80 border-b border-slate-700/50 flex items-center px-6"
>
  <svg
    class="w-6 h-6 text-blue-400 mr-3"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
  <h1 class="text-2xl font-bold text-white">Recent</h1>
  <span
    class="ml-3 px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-sm"
    >{items.length}</span
  >
</header>

<div
  class="flex-1 overflow-auto p-6"
  use:dragScroll={{ axis: "y" }}
  onscroll={closeMenu}
>
  {#if loading}
    <div class="flex items-center justify-center h-full">
      <div
        class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
      ></div>
    </div>
  {:else if items.length === 0}
    <div class="flex flex-col items-center justify-center h-full text-center">
      <div
        class="w-32 h-32 mb-6 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center"
      >
        <svg
          class="w-16 h-16 text-slate-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h2 class="text-2xl font-bold text-white mb-2">No Recent Items</h2>
      <p class="text-slate-400 max-w-md">
        Start reading something to see it here.
      </p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each items as item (item.id)}
        <div
          role="button"
          tabindex="0"
          class="w-full flex items-center gap-4 p-4 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-blue-500/50 rounded-xl transition-all duration-200 text-left group relative cursor-pointer"
          style="z-index: {activeMenuId === item.id ? 50 : 'auto'}"
          ondblclick={() => openBook(item)}
          onkeydown={(e) => e.key === "Enter" && openBook(item)}
        >
          <div
            class="absolute top-2 right-2 {activeMenuId === item.id
              ? 'z-[70]'
              : 'z-20'}"
          >
            <button
              aria-label={`Options for ${item.title}`}
              title="Options"
              class="p-1.5 rounded-full transition-all duration-200 {activeMenuId ===
              item.id
                ? 'bg-black/60 text-white opacity-100'
                : 'bg-black/40 text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-white hover:bg-black/60'}"
              onclick={(event) => toggleMenu(item.id, event)}
              onkeydown={(event) => event.stopPropagation()}
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
                  d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                />
              </svg>
            </button>

            {#if activeMenuId === item.id}
              <div
                class="absolute right-0 top-full mt-1 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden text-left"
                role="menu"
                tabindex="-1"
                onclick={(event) => event.stopPropagation()}
                onkeydown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Escape") closeMenu();
                }}
                transition:fade={{ duration: 100 }}
              >
                <div class="p-1">
                  {#each MENU_ACTIONS as action (action.key)}
                    {#if action.key !== "content" || item.type === "book"}
                      <button
                        class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
                        onclick={() => {
                          closeMenu();
                          runMenuAction(action.key, item);
                        }}
                      >
                        <svg
                          class="w-4 h-4 {action.danger
                            ? 'text-rose-500 opacity-90'
                            : 'text-sky-400 opacity-80'}"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d={action.icon}
                          />
                        </svg>
                        {action.label}
                      </button>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <!-- Thumbnail -->
          <div
            class="relative w-16 h-24 bg-slate-700 rounded-lg flex-shrink-0 flex items-center justify-center overflow-hidden group/thumb"
          >
            {#if coverCache[item.id]}
              <img
                src={coverCache[item.id]}
                alt=""
                draggable="false"
                style="--r18-blur: {blurR18Intensity}px"
                class="w-full h-full object-cover transition-all duration-300 group-hover/thumb:scale-105 {item.types_list
                  ?.toLowerCase()
                  .includes('r18') && blurR18
                  ? `blur-[var(--r18-blur)] ${blurR18Hover ? 'group-hover/thumb:blur-0' : ''}`
                  : ''}"
              />
            {:else if loadingCovers.has(item.id)}
              <div
                class="w-6 h-6 border-2 border-slate-500 border-t-blue-500 rounded-full animate-spin"
              ></div>
            {:else}
              <svg
                class="w-8 h-8 text-slate-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            {/if}

            {#if item.types_list?.toLowerCase().includes("r18")}
              <div class="absolute bottom-0 right-0 z-10">
                <div
                  class="px-1 py-0.5 text-[8px] font-bold uppercase text-white bg-red-600 rounded-tl shadow-sm"
                >
                  R18
                </div>
              </div>
            {/if}

            <button
              class="absolute top-0 right-0 w-5 h-5 flex items-center justify-center bg-black/40 hover:bg-rose-500 text-white/90 hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-md shadow-sm hover:scale-110"
              onclick={(e) => openRemoveDialog(item, e)}
              title="Remove from Recent"
            >
              <svg
                class="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <!-- Info -->
          <div class="flex-1 min-w-0">
            <p
              class="text-white font-medium truncate group-hover:text-blue-400 transition-colors"
            >
              {item.title}
            </p>
            {#if item.types_list}
              {@const displayTypes = item.types_list
                .split(",")
                .filter((t) => t.trim().toLowerCase() !== "r18")}
              {#if displayTypes.length > 0}
                <div class="flex flex-wrap gap-1 mt-1 mb-1">
                  {#each displayTypes as type}
                    <span
                      class="px-1.5 py-0.5 text-[10px] font-medium text-slate-300 bg-slate-700/50 rounded border border-slate-600/50"
                    >
                      {type}
                    </span>
                  {/each}
                </div>
              {/if}
            {/if}
            <p class="text-sm text-slate-400 mt-1">
              Page {item.current_page + 1} of {item.page_count}
            </p>
            <!-- Progress bar -->
            <div class="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                class="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all"
                style="width: {getProgressPercent(item)}%"
              ></div>
            </div>
          </div>

          <!-- Time and Status -->
          <div class="text-right flex-shrink-0 pr-7">
            <p class="text-sm text-slate-400">
              {formatDate(item.last_read_at)}
            </p>
            <span
              class="inline-block mt-2 px-2.5 py-1 text-xs font-medium rounded-full {item.reading_status ===
              'read'
                ? 'bg-emerald-500/20 text-emerald-400'
                : item.reading_status === 'reading'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-slate-700 text-slate-400'}"
            >
              {item.reading_status === "read"
                ? "Completed"
                : item.reading_status === "reading"
                  ? "Reading"
                  : "Unread"}
            </span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<Dialog
  open={removeDialogOpen}
  title="Remove from Recent"
  description="Are you sure you want to remove '{itemToRemove?.title}' from your recent list? This will not delete the file."
  confirmText="Remove"
  variant="danger"
  onConfirm={confirmRemove}
  onCancel={closeRemoveDialog}
/>

<Dialog
  open={pendingDeleteItem !== null}
  title={pendingDeleteItem?.type === "folder" ? "Remove Folder" : "Remove File"}
  description={`Are you sure you want to move "${pendingDeleteItem?.title ?? ""}" to the Trash/Recycle Bin?`}
  confirmText="Move to Trash"
  variant="danger"
  loading={deleteDialogLoading}
  onConfirm={handleConfirmDelete}
  onCancel={() => (pendingDeleteItem = null)}
/>

<Dialog
  open={renameItem !== null}
  title="Rename File"
  description={`Enter a new name for "${renameItem?.title ?? ""}".`}
  confirmText="Rename"
  variant="neutral"
  loading={renameLoading}
  onConfirm={handleRename}
  onCancel={() => {
    renameItem = null;
    renameError = "";
  }}
>
  <div class="space-y-4">
    <input
      type="text"
      bind:value={renameValue}
      class="w-full px-4 py-2.5 bg-slate-950/20 border border-slate-700/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/10 transition-[border-color,background-color,ring-color] duration-200"
      placeholder="Enter new name..."
      onkeydown={(e) => e.key === "Enter" && handleRename()}
    />
    {#if renameError}
      <p class="text-sm text-red-400">{renameError}</p>
    {/if}
  </div>
</Dialog>

<LibraryMetadataDialogs
  showTagEditor={tagEditorItem !== null}
  tagEditorItemId={tagEditorItem?.id ?? null}
  tagEditorItemTitle={tagEditorItem?.title ?? ""}
  closeTagEditor={() => (tagEditorItem = null)}
  handleTagChange={() => refreshItem(tagEditorItem?.id)}
  showTypeEditor={typeEditorItem !== null}
  typeEditorItemId={typeEditorItem?.id ?? null}
  typeEditorItemTitle={typeEditorItem?.title ?? ""}
  closeTypeEditor={() => (typeEditorItem = null)}
  handleTypeChange={() => refreshItem(typeEditorItem?.id)}
/>

{#if managingArchiveItem}
  <ArchiveManager
    item={managingArchiveItem}
    onClose={() => (managingArchiveItem = null)}
  />
{/if}

<MoveToFolderDialog
  open={moveItem !== null}
  itemsToMove={moveItem ? [moveItem] : []}
  onClose={() => (moveItem = null)}
  onMoved={async () => {
    await loadRecent(true);
    toasts.add("Item moved successfully", "success");
  }}
/>
