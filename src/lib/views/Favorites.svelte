<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { openBook, appState } from "../stores/app";
  import { fade, fly } from "svelte/transition";
  import Dialog from "../components/Dialog.svelte";
  import TagSelector from "../components/TagSelector.svelte";
  import TypeSelector from "../components/TypeSelector.svelte";
  import BulkSelection from "../components/BulkSelection.svelte";
  import ArchiveManager from "../components/ArchiveManager.svelte";
  import { SelectionModel } from "../state/selection.svelte";
  import { dragScroll } from "../utils/dragScroll";
  import FolderSwitcher from "../components/FolderSwitcher.svelte";
  import type { LibraryItem } from "../stores/app";

  let items = $state<LibraryItem[]>([]);
  let loading = $state(false);
  let gridSize = $state<"small" | "medium" | "large">(
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem("favoritesGridSize") as any)) ||
      "medium",
  );
  let searchQuery = $state("");
  let searchResults = $state<LibraryItem[]>([]);
  let isSearching = $state(false);

  let itemCountHovered = $state(false);
  let managingArchiveItem = $state<LibraryItem | null>(null);

  let selectedRoot = $state(
    localStorage.getItem("favoritesSelectedRoot") || "",
  );
  let librarySortOrder = $state<"alphabetical" | "imported">("alphabetical");
  let skipItemAnimation = $state(false);

  $effect(() => {
    localStorage.setItem("favoritesSelectedRoot", selectedRoot);
    loadFavorites(true);
  });

  // Debounced search effect
  let searchTimeout: ReturnType<typeof setTimeout>;

  // Combined params for effect reactivity
  let searchParamsForEffect = $derived({
    q: searchQuery,
    r: selectedRoot,
  });

  $effect(() => {
    const { q, r } = searchParamsForEffect;

    if (q.trim()) {
      clearTimeout(searchTimeout);

      // Slower for typing, faster for scope switch
      const isNavOnly = untrack(() => lastProcessedQuery) === q;
      const delay = isNavOnly ? 50 : 300;
      lastProcessedQuery = q;

      searchTimeout = setTimeout(async () => {
        isSearching = true;
        try {
          const results = await window.electronAPI.library.search(q, {
            favoritesOnly: true,
            root: r,
          });
          if (q === searchQuery) {
            searchResults = results;
          }
        } finally {
          isSearching = false;
        }
      }, delay);
    } else {
      searchResults = [];
      lastProcessedQuery = "";
    }
  });

  let lastProcessedQuery = "";

  // Pagination/Incremental Rendering
  let renderLimit = $state(50);
  let loaderRef = $state<HTMLElement | null>(null);

  const LANGUAGE_CODES: Record<string, string> = {
    English: "EN",
    Japanese: "JP",
    Korean: "KR",
    Chinese: "CN",
    Spanish: "ES",
  };

  const TAG_MARKER = "\u200B";

  function getLanguageCodes(tagsList: string | undefined): string[] {
    if (!tagsList) return [];
    const codes: string[] = [];
    const tags = tagsList.split(",").map((t) => t.trim());

    for (const tag of tags) {
      if (LANGUAGE_CODES[tag]) codes.push(LANGUAGE_CODES[tag]);
    }
    return codes;
  }

  // Selection State
  const selection = new SelectionModel();

  // Watch for visibility changes to refresh data
  let lastActiveView = $state<string | null>(null);

  $effect(() => {
    const currentView = $appState.currentView;
    if (currentView === "favorites" && lastActiveView !== "favorites") {
      refreshSettings();
    }
    lastActiveView = currentView;
  });

  let filteredItems = $derived.by(() => {
    let currentItems = searchQuery.trim() ? searchResults : items;

    const matchItem = (item: LibraryItem) => {
      // 1. Filter by Selected/Excluded Types
      const itemTypes = item.types_list
        ? item.types_list.split(",").map((t) => t.trim().toLowerCase())
        : [];

      // Exclusion check (priority)
      if (excludedTypeIds.length > 0) {
        const hasExcludedType = excludedTypeIds.some((id) => {
          const type = availableTypes.find((t) => t.id === id);
          return type && itemTypes.includes(type.name.toLowerCase());
        });
        if (hasExcludedType) return false;
      }

      // Inclusion check
      if (selectedTypeIds.length > 0) {
        const hasSelectedType = selectedTypeIds.some((id) => {
          const type = availableTypes.find((t) => t.id === id);
          return type && itemTypes.includes(type.name.toLowerCase());
        });

        if (!hasSelectedType) return false;
      }

      // 2. Client-side Search Refining (for robustness during debouncing/caching)
      if (!searchQuery) return true;

      const title = item.title.toLowerCase();
      const itemTags = (item.tags_list || "")
        .toLowerCase()
        .split(",")
        .map((t) => t.trim());

      const terms = searchQuery
        .toLowerCase()
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      return terms.every((term) => {
        const isExclusion = term.startsWith("-");
        let checkTerm = isExclusion ? term.slice(1) : term;

        const isTagSearch = checkTerm.startsWith(TAG_MARKER);
        if (isTagSearch) {
          checkTerm = checkTerm.slice(TAG_MARKER.length);
        }

        if (!checkTerm) return true;

        let match = false;
        if (isTagSearch) {
          match = itemTags.includes(checkTerm);
        } else {
          match = title.includes(checkTerm) || itemTags.includes(checkTerm);
        }

        return isExclusion ? !match : match;
      });
    };

    return currentItems.filter(matchItem);
  });

  let visibleItems = $derived(filteredItems.slice(0, renderLimit));

  // Items are already filtered by favorites backend, but filteredItems handles search
  let totalCount = $derived(filteredItems.length);
  let fileCount = $derived(
    filteredItems.filter((i) => {
      return String(i.type).toLowerCase() !== "folder";
    }).length,
  );
  let stabilizedAllIds = $derived(filteredItems.map((i) => i.id));

  function sortFavorites(list: LibraryItem[]): LibraryItem[] {
    return [...list].sort((a, b) => {
      // Folders first, then standard title sort (matches backend)
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;

      if (a.title < b.title) return -1;
      if (a.title > b.title) return 1;
      return 0;
    });
  }

  async function loadFavorites(silent = false) {
    if (!silent) loading = true;
    try {
      if (silent) {
        skipItemAnimation = true;
      }
      const getFavorites = window.electronAPI.library.getFavorites as any;
      const fetchedItems = await getFavorites(selectedRoot);
      items = sortFavorites(fetchedItems);
      await tick();
      if (silent) {
        setTimeout(() => {
          skipItemAnimation = false;
        }, 50);
      }
    } catch (e) {
      console.error(e);
      if (silent) skipItemAnimation = false;
    } finally {
      loading = false;
    }
  }

  async function removeFavorite(id: number, event: MouseEvent) {
    event.stopPropagation();
    await window.electronAPI.library.toggleFavorite(id);
    items = items.filter((item) => item.id !== id);
  }

  function handleItemClick(
    item: LibraryItem,
    event?: MouseEvent | KeyboardEvent,
  ) {
    if (selection.selectionMode || (event && event.ctrlKey)) {
      selection.toggle(item.id, filteredItems, event);
    } else {
      // Only open if double click OR triggered by Enter key
      if (
        !event ||
        event.type === "dblclick" ||
        (event instanceof KeyboardEvent && event.key === "Enter")
      ) {
        openBook(item);
      }
    }
  }

  function clearSelection() {
    selection.clear();
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if ($appState.currentView !== "favorites") return;

    if (e.key === "Escape") {
      if (showTagEditor) {
        closeTagEditor();
        return;
      }
      if (showTypeEditor) {
        closeTypeEditor();
        return;
      }

      // Blur focused grid items
      if (document.activeElement?.hasAttribute("data-nav-index")) {
        (document.activeElement as HTMLElement).blur();
      }
    }
    // Global Grid Navigation
    if (e.key.startsWith("Arrow") || e.key === "Enter" || e.key === " ") {
      if (e.target instanceof HTMLInputElement) return;

      // 1. Native scroll throttle
      if (e.repeat && (e.key === "ArrowUp" || e.key === "ArrowDown")) return;

      const items = visibleItems;
      if (items.length === 0) return;

      const focusedEl = document.activeElement as HTMLElement;
      let currentIndex = -1;
      let scanSuccess = false;

      // 2. Identify selection
      if (focusedEl?.hasAttribute("data-nav-index")) {
        const container =
          document.querySelector(".favorites-grid")?.parentElement;
        if (container) {
          const containerRect = container.getBoundingClientRect();
          const itemRect = focusedEl.getBoundingClientRect();

          const isVisible =
            itemRect.bottom > containerRect.top &&
            itemRect.top < containerRect.bottom;
          const isHorizontalRepetition =
            e.repeat && (e.key === "ArrowLeft" || e.key === "ArrowRight");

          if (isHorizontalRepetition || isVisible) {
            currentIndex = parseInt(
              focusedEl.getAttribute("data-nav-index") || "-1",
            );
          } else {
            // 3. Recovery logic
            const viewportCenterY =
              containerRect.top + containerRect.height / 2;
            const isAtBottom =
              container.scrollTop + container.clientHeight >=
              container.scrollHeight - 50;
            const isAtTop = container.scrollTop < 50;

            let probeY = viewportCenterY;
            if (isAtBottom) probeY = containerRect.bottom - 60;
            if (isAtTop) probeY = containerRect.top + 60;

            // a. Entry point
            let probeX;
            if (e.key === "ArrowLeft") {
              probeX = containerRect.right - 40;
            } else if (e.key === "ArrowRight") {
              probeX = containerRect.left + 40;
            } else {
              probeX = itemRect.left + itemRect.width / 2;
              if (probeX < containerRect.left || probeX > containerRect.right) {
                probeX = containerRect.left + containerRect.width / 2;
              }
            }

            // b. Row grouping
            const allVisibleEl = Array.from(
              container.querySelectorAll("[data-nav-index]"),
            );
            let anchorItem: {
              index: number;
              top: number;
              bottom: number;
            } | null = null;
            let minDist = Infinity;

            const candidates: { index: number; rect: DOMRect }[] = [];
            for (const el of allVisibleEl) {
              const rect = el.getBoundingClientRect();
              const center = rect.top + rect.height / 2;
              const dist = Math.abs(center - probeY);

              if (dist < minDist) {
                minDist = dist;
                anchorItem = {
                  index: parseInt(el.getAttribute("data-nav-index") || "-1"),
                  top: rect.top,
                  bottom: rect.bottom,
                };
              }
              candidates.push({
                index: parseInt(el.getAttribute("data-nav-index") || "-1"),
                rect,
              });
            }

            let bestRow: { index: number; left: number }[] = [];
            if (anchorItem) {
              const rowThreshold = (anchorItem.bottom - anchorItem.top) * 0.5;
              for (const c of candidates) {
                const overlap =
                  Math.min(anchorItem.bottom, c.rect.bottom) -
                  Math.max(anchorItem.top, c.rect.top);
                if (overlap > rowThreshold) {
                  bestRow.push({ index: c.index, left: c.rect.left });
                }
              }
            }

            if (bestRow && bestRow.length > 0) {
              bestRow.sort((a, b) => a.left - b.left);
              if (e.key === "ArrowLeft") {
                currentIndex = bestRow[bestRow.length - 1].index;
              } else if (e.key === "ArrowRight") {
                currentIndex = bestRow[0].index;
              } else {
                const centerIdx = Math.floor((bestRow.length - 1) / 2);
                currentIndex = bestRow[centerIdx].index;
              }
              scanSuccess = true;
            }

            if (!scanSuccess) {
              if (isAtBottom) currentIndex = items.length - 1;
              else currentIndex = 0;
            }
          }
        }
      }

      let nextIndex = -1;

      // 4. Calculate move
      if (scanSuccess) {
        nextIndex = currentIndex;
      } else {
        if (currentIndex === -1 && items.length > 0) {
          nextIndex = 0;
        } else if (currentIndex !== -1) {
          const cols = calculateGridColumns();
          if (e.key === "ArrowRight") nextIndex = currentIndex + 1;
          else if (e.key === "ArrowLeft") nextIndex = currentIndex - 1;
          else if (e.key === "ArrowDown") nextIndex = currentIndex + cols;
          else if (e.key === "ArrowUp") nextIndex = currentIndex - cols;
        }
      }

      if (currentIndex === -1 && nextIndex === -1 && items.length > 0) {
        nextIndex = 0;
      }

      // 5. Apply move
      if (nextIndex >= 0 && nextIndex < items.length) {
        e.preventDefault();
        const nextEl = document.querySelector(
          `.favorites-grid [data-nav-index="${nextIndex}"]`,
        ) as HTMLElement;
        if (nextEl) {
          nextEl.focus({ preventScroll: true });
          nextEl.scrollIntoView({ behavior: "auto", block: "nearest" });
        }
      }
    }
  }

  // Get grid columns based on breakpoints
  function calculateGridColumns() {
    const width = window.innerWidth;
    if (gridSize === "small") {
      if (width >= 1536) return 12;
      if (width >= 1280) return 10;
      if (width >= 1024) return 8;
      if (width >= 768) return 6;
      if (width >= 640) return 4;
      return 3;
    } else if (gridSize === "large") {
      if (width >= 1536) return 6;
      if (width >= 1280) return 5;
      if (width >= 1024) return 4;
      if (width >= 768) return 3;
      return 2;
    } else {
      if (width >= 1536) return 8;
      if (width >= 1280) return 6;
      if (width >= 1024) return 5;
      if (width >= 768) return 4;
      if (width >= 640) return 3;
      return 2;
    }
  }

  async function handleBulkRefresh(
    action: "favorite" | "delete" | "tags" | "move",
  ) {
    if (action === "delete") {
      // Reload favorites to reflect deletions
      await loadFavorites();
      selection.clear();
    } else {
      // Surgical update for tags or favorite toggle to prevent full list reset
      const updatedItems = await Promise.all(
        selection.ids.map((id) => window.electronAPI.library.getItem(id)),
      );
      const itemsMap = new Map(
        updatedItems.filter(Boolean).map((i) => [i!.id, i!]),
      );

      if (action === "favorite") {
        // In Favorites view, remove items that are no longer favorites
        items = items
          .filter((i) => {
            const updated = itemsMap.get(i.id);
            if (updated) return updated.is_favorite;
            return true; // Keep if not in the updated set
          })
          .map((i) =>
            itemsMap.get(i.id) ? { ...i, ...itemsMap.get(i.id) } : i,
          );
      } else {
        // Just update metadata for tags
        items = sortFavorites(
          items.map((i) =>
            itemsMap.get(i.id) ? { ...i, ...itemsMap.get(i.id) } : i,
          ),
        );
      }
    }
  }

  // Get grid CSS classes
  function getGridClass(): string {
    switch (gridSize) {
      case "small":
        return "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12";
      case "large":
        return "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";
      default:
        return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8";
    }
  }

  let blurR18 = $state(false);
  let blurR18Hover = $state(false);
  let blurR18Intensity = $state(12);

  let lastResetSearchQuery = $state("");

  $effect(() => {
    // Only reset limit when search actually changes
    if (searchQuery !== lastResetSearchQuery) {
      renderLimit = 50;
      lastResetSearchQuery = searchQuery;
    }
  });

  $effect(() => {
    if (!loaderRef) return;
    // Track dependencies to re-run effect and re-trigger observer when more items are needed
    renderLimit;
    filteredItems.length;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && renderLimit < filteredItems.length) {
          // Incrementally load more items as user scrolls
          renderLimit += 50;
        }
      },
      { rootMargin: "500px" },
    );
    observer.observe(loaderRef);
    return () => observer.disconnect();
  });

  async function refreshSettings() {
    try {
      const all = await window.electronAPI.settings.getAll();
      if (all) {
        const newBlurR18 = all.blurR18 === "true";
        const newBlurR18Hover = all.blurR18Hover === "true";
        const newBlurR18Intensity = all.blurR18Intensity
          ? parseInt(all.blurR18Intensity)
          : 12;

        // Surgical updates to avoid unnecessary item card re-renders
        if (blurR18 !== newBlurR18) blurR18 = newBlurR18;
        if (blurR18Hover !== newBlurR18Hover) blurR18Hover = newBlurR18Hover;
        if (blurR18Intensity !== newBlurR18Intensity)
          blurR18Intensity = newBlurR18Intensity;

        if (
          all.librarySortOrder === "alphabetical" ||
          all.librarySortOrder === "imported"
        ) {
          librarySortOrder = all.librarySortOrder as any;
        }
      }
    } catch (e) {
      console.error("Failed to refresh settings", e);
    }
  }

  onMount(() => {
    loadFavorites();

    // Fetch persisted grid size from backend
    window.electronAPI.settings.get("favoritesGridSize").then((val) => {
      if (val && ["small", "medium", "large"].includes(val)) {
        gridSize = val as any;
        localStorage.setItem("favoritesGridSize", val);
      }
    });

    refreshSettings();
    loadAvailableTypes();
  });

  // -- Search Autocomplete Logic --
  let searchInputRef = $state<HTMLInputElement | null>(null);
  let showSearchSuggestions = $state(false);
  let searchSuggestions = $state<any[]>([]);
  let selectedSearchIndex = $state(-1);

  let searchRequestId = 0;
  let autocompleteTimeout: ReturnType<typeof setTimeout>;

  async function handleSearchInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    searchQuery = val;

    // Increment ID to prevent race conditions
    searchRequestId++;
    const currentRequestId = searchRequestId;

    clearTimeout(autocompleteTimeout);
    autocompleteTimeout = setTimeout(async () => {
      const terms = val.split(/,\s*/);
      const currentTerm = terms[terms.length - 1].trim();

      if (currentTerm.length > 0 && currentTerm !== "-") {
        let cleanTerm = currentTerm.replace(/\u200B/g, "");
        if (cleanTerm.startsWith("-")) cleanTerm = cleanTerm.slice(1);

        const tags = await window.electronAPI.tags.search(cleanTerm);

        // Ensure response matches latest request
        if (searchRequestId === currentRequestId) {
          searchSuggestions = tags;
          showSearchSuggestions = tags.length > 0;
          selectedSearchIndex = -1;
        }
      } else {
        if (searchRequestId === currentRequestId) {
          searchSuggestions = [];
          showSearchSuggestions = false;
        }
      }
    }, 100);
  }

  function applySuggestion(tag: any) {
    const terms = searchQuery.split(",");
    const currentTerm = terms.pop()?.trim() || "";
    const isExclusion = currentTerm.startsWith("-");

    const prefix = isExclusion ? `-${TAG_MARKER}` : TAG_MARKER;

    terms.push(prefix + tag.name);
    searchQuery = terms.join(", ") + ", ";
    showSearchSuggestions = false;
    searchInputRef?.focus();
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (!showSearchSuggestions || searchSuggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (selectedSearchIndex === -1) {
        selectedSearchIndex = 0;
      } else {
        selectedSearchIndex =
          (selectedSearchIndex + 1) % searchSuggestions.length;
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (selectedSearchIndex === -1) {
        selectedSearchIndex = searchSuggestions.length - 1;
      } else {
        selectedSearchIndex =
          (selectedSearchIndex - 1 + searchSuggestions.length) %
          searchSuggestions.length;
      }
    } else if (e.key === "Enter") {
      if (selectedSearchIndex >= 0) {
        e.preventDefault();
        applySuggestion(searchSuggestions[selectedSearchIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      showSearchSuggestions = false;
      selectedSearchIndex = -1;
    }
  }

  // -- Menu & Dialog State --
  let activeMenuId = $state<number | null>(null);
  let showDeleteDialog = $state(false);
  let pendingDeleteItem = $state<LibraryItem | null>(null);
  let deleteDialogLoading = $state(false);

  // Tag Editor State
  let showTagEditor = $state(false);
  let tagEditorItemId = $state<number | null>(null);
  let tagEditorItemTitle = $state<string>("");

  // Type Editor State
  let showTypeEditor = $state(false);
  let typeEditorItemId = $state<number | null>(null);
  let typeEditorItemTitle = $state<string>("");

  // Filter State
  interface ContentType {
    id: number;
    name: string;
    description: string | null;
  }
  let availableTypes = $state<ContentType[]>([]);
  let selectedTypeIds = $state<number[]>([]);
  let excludedTypeIds = $state<number[]>([]);
  let lastClickTime = $state(0);
  let lastClickedId = $state<number | null>(null);
  let showTypeFilter = $state(false);

  const ICONS: Record<string, string> = {
    manga: "📖",
    doujinshi: "📚",
    webtoon: "📱",
    r18: "🔞",
    "image set": "📁",
    "artist cg": "🎨",
  };

  async function loadAvailableTypes() {
    try {
      availableTypes = await window.electronAPI.types.getAll();
    } catch (e) {
      console.error("Failed to load types:", e);
    }
  }

  function getIcon(name: string): string {
    return ICONS[name.toLowerCase()] || "📄";
  }

  function toggleTypeFilter(typeId: number) {
    if (selectedTypeIds.includes(typeId)) {
      selectedTypeIds = selectedTypeIds.filter((id) => id !== typeId);
    } else {
      selectedTypeIds = [...selectedTypeIds, typeId];
    }
  }

  // Toggle type inclusion (click) or exclusion (double-click)
  function handleTypeClick(typeId: number) {
    const now = Date.now();
    const isDoubleClick = lastClickedId === typeId && now - lastClickTime < 300;

    if (isDoubleClick) {
      if (excludedTypeIds.includes(typeId)) {
        excludedTypeIds = excludedTypeIds.filter((id) => id !== typeId);
      } else {
        selectedTypeIds = selectedTypeIds.filter((id) => id !== typeId);
        excludedTypeIds = [...excludedTypeIds, typeId];
      }
    } else {
      if (excludedTypeIds.includes(typeId)) {
        excludedTypeIds = excludedTypeIds.filter((id) => id !== typeId);
      } else {
        toggleTypeFilter(typeId);
      }
    }

    lastClickTime = now;
    lastClickedId = typeId;
  }

  function clearTypeFilters() {
    selectedTypeIds = [];
    excludedTypeIds = [];
  }

  function toggleMenu(id: number, event: MouseEvent) {
    event.stopPropagation();
    if (activeMenuId === id) {
      activeMenuId = null;
    } else {
      activeMenuId = id;
    }
  }

  function closeMenu() {
    activeMenuId = null;
  }

  function openTagEditor(item: LibraryItem, event: MouseEvent) {
    event.stopPropagation();
    closeMenu(); // Ensure menu closes
    tagEditorItemId = item.id;
    tagEditorItemTitle = item.title;
    showTagEditor = true;
  }

  async function handleTagChange() {
    if (!tagEditorItemId) return;
    try {
      const updatedItem =
        await window.electronAPI.library.getItem(tagEditorItemId);
      if (updatedItem) {
        items = items.map((i) =>
          i.id === updatedItem.id ? { ...i, ...updatedItem } : i,
        );
      }
    } catch (e) {
      console.error("Failed to refresh item after tag change", e);
    }
  }

  function closeTagEditor() {
    showTagEditor = false;
    tagEditorItemId = null;
  }

  function openTypeEditor(item: LibraryItem, event: MouseEvent) {
    event.stopPropagation();
    closeMenu(); // Ensure menu closes
    typeEditorItemId = item.id;
    typeEditorItemTitle = item.title;
    showTypeEditor = true;
  }

  async function handleTypeChange() {
    if (!typeEditorItemId) return;
    try {
      const updatedItem =
        await window.electronAPI.library.getItem(typeEditorItemId);
      if (updatedItem) {
        items = items.map((i) =>
          i.id === updatedItem.id ? { ...i, ...updatedItem } : i,
        );
      }
    } catch (e) {
      console.error("Failed to refresh item after type change", e);
    }
  }

  function closeTypeEditor() {
    showTypeEditor = false;
    typeEditorItemId = null;
  }

  function deleteItem(item: LibraryItem, event: MouseEvent) {
    event.stopPropagation();
    closeMenu();
    pendingDeleteItem = item;
    showDeleteDialog = true;
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteItem) return;
    const itemToDelete = pendingDeleteItem;
    deleteDialogLoading = true;
    try {
      await window.electronAPI.library.deleteItem(itemToDelete.id);
      items = items.filter((i) => i.id !== itemToDelete.id);
      showDeleteDialog = false;
      pendingDeleteItem = null;
    } finally {
      deleteDialogLoading = false;
    }
  }

  function handleCancelDelete() {
    showDeleteDialog = false;
    pendingDeleteItem = null;
  }

  function getReadingProgress(item: LibraryItem): number {
    if (!item.page_count || item.page_count === 0) return 0;
    return Math.round((item.current_page / item.page_count) * 100);
  }

  function getStatusColor(status: LibraryItem["reading_status"]) {
    switch (status) {
      case "reading":
        return "bg-blue-500";
      case "read":
        return "bg-green-500";
      default:
        return "bg-gray-500";
    }
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case "read":
        return "Read";
      case "reading":
        return "Reading";
      default:
        return "Unread";
    }
  }

  function getBreadcrumbPath(item: LibraryItem): string {
    if (!item.path) return "Library";

    // Get the parent folder name, ignoring drive letters and empty segments
    const parts = item.path
      .split(/[/\\]/)
      .filter((p: string) => p && !p.includes(":"));

    if (parts.length > 1) {
      return parts[parts.length - 2];
    }

    return "Library";
  }

  $effect(() => {
    const unsubscribeUpdated = window.electronAPI.library.onItemUpdated(
      (updatedItem) => {
        const index = items.findIndex((i) => i.id === updatedItem.id);

        if (updatedItem.is_favorite !== undefined) {
          if (updatedItem.is_favorite) {
            if (index !== -1) {
              // Update existing item
              items = sortFavorites(
                items.map((i) =>
                  i.id === updatedItem.id ? { ...i, ...updatedItem } : i,
                ),
              );
            } else {
              // Add new favorite to the list
              items = sortFavorites([...items, updatedItem]);
            }
          } else {
            if (index !== -1) {
              // Remove from favorites if it's explicitly no longer a favorite
              items = items.filter((i) => i.id !== updatedItem.id);
            }
          }
        } else if (index !== -1) {
          // Partial update (e.g. from reader), but item is already in favorites list.
          // Just merge the new fields.
          items = sortFavorites(
            items.map((i) =>
              i.id === updatedItem.id ? { ...i, ...updatedItem } : i,
            ),
          );
        }
      },
    );

    const unsubscribeRefreshed = window.electronAPI.library.onRefreshed(() => {
      loadFavorites(true);
    });

    const unsubscribeCleared = window.electronAPI.library.onCleared(() => {
      loadFavorites(true);
    });

    return () => {
      unsubscribeUpdated();
      unsubscribeRefreshed();
      unsubscribeCleared();
    };
  });

  function handleSearchFocus() {
    if (searchQuery.trim().length > 0) {
      const val = searchInputRef?.value || "";
      if (val.trim().length > 0) {
        const terms = val.split(/,\s*/);
        const currentTerm = terms[terms.length - 1].trim();
        if (currentTerm.length > 0 && currentTerm !== "-") {
          let cleanTerm = currentTerm.replace(/\u200B/g, "");
          if (cleanTerm.startsWith("-")) cleanTerm = cleanTerm.slice(1);

          window.electronAPI.tags.search(cleanTerm).then((tags) => {
            searchSuggestions = tags;
            showSearchSuggestions = tags.length > 0;
          });
        }
      }
    }
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as Node;

    // Handle Search Suggestions
    if (showSearchSuggestions) {
      const searchContainer = searchInputRef?.parentElement;
      if (searchContainer && !searchContainer.contains(target)) {
        showSearchSuggestions = false;
      }
    }

    // Handle Type Filter
    if (showTypeFilter) {
      showTypeFilter = false;
    }

    // Handle Active Menu
    if (activeMenuId !== null) {
      activeMenuId = null;
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} onclick={handleWindowClick} />

<Dialog
  open={showDeleteDialog}
  title={pendingDeleteItem?.type === "folder" ? "Remove Folder" : "Remove File"}
  description={`Are you sure you want to move "${pendingDeleteItem?.title ?? ""}" to the Trash/Recycle Bin?`}
  confirmText="Move to Trash"
  variant="danger"
  loading={deleteDialogLoading}
  onConfirm={handleConfirmDelete}
  onCancel={handleCancelDelete}
/>

<!-- Tag Editor Dialog -->
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
      <!-- Close Button -->
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

<!-- Type Editor Dialog -->
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
      <!-- Close Button -->
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
        <h2 class="text-xl font-bold text-white mb-1">Set Types</h2>
        <p class="text-sm text-slate-400 truncate">{typeEditorItemTitle}</p>
      </div>

      <div class="flex-1 min-h-0 relative flex flex-col">
        <TypeSelector itemId={typeEditorItemId} onchange={handleTypeChange} />
      </div>
    </div>
  </div>
{/if}

<header
  class="h-16 bg-slate-900/80 border-b border-slate-700/50 flex items-center justify-between px-6 backdrop-blur-md gap-4 relative z-30"
>
  <div class="flex items-center flex-shrink-0">
    <svg
      class="w-6 h-6 text-rose-400 mr-3"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
      />
    </svg>
    <h1 class="text-2xl font-bold text-white mr-4">Favorites</h1>

    <FolderSwitcher
      currentRoot={selectedRoot}
      sortOrder={librarySortOrder}
      onSelect={(root) => {
        selectedRoot = root;
        loadFavorites(true);
      }}
    />
    <span
      role="status"
      title={itemCountHovered ? "Total files" : "Total items"}
      class="ml-3 px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-sm cursor-default select-none transition-all duration-200 hover:bg-slate-700 hover:text-white"
      onmouseenter={() => (itemCountHovered = true)}
      onmouseleave={() => (itemCountHovered = false)}
    >
      {itemCountHovered ? fileCount : totalCount}
    </span>
  </div>

  <div class="flex items-center gap-3">
    <!-- Search Bar -->
    <div class="w-64 md:w-80 lg:w-96 hidden md:block">
      <div class="relative group">
        <svg
          class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-blue-400 transition-colors"
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
          placeholder="Search favorites..."
          bind:this={searchInputRef}
          bind:value={searchQuery}
          oninput={handleSearchInput}
          onkeydown={handleSearchKeydown}
          onfocus={handleSearchFocus}
          class="w-full pl-10 pr-10 py-2.5 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:bg-slate-800 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-colors duration-200 shadow-sm"
        />
        {#if searchQuery}
          <button
            onclick={() => {
              searchQuery = "";
              showSearchSuggestions = false;
            }}
            class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-white rounded-full hover:bg-slate-700/50 transition-colors"
            aria-label="Clear search"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        {/if}

        <!-- Suggestions Dropdown -->
        {#if showSearchSuggestions}
          <div
            class="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50"
          >
            {#each searchSuggestions as tag, i}
              <button
                class="w-full text-left px-4 py-2 hover:bg-slate-700 flex justify-between items-center group transition-colors {i ===
                selectedSearchIndex
                  ? 'bg-slate-700 ring-1 ring-inset ring-blue-500/50'
                  : ''}"
                onmousedown={(e) => {
                  e.preventDefault();
                  applySuggestion(tag);
                }}
              >
                <div class="flex items-center gap-2">
                  <span class="text-white font-medium">{tag.name}</span>
                  <span
                    class="text-xs text-slate-500 group-hover:text-slate-300 transition-colors"
                    >{tag.alias ? `(${tag.alias})` : ""}</span
                  >
                </div>
                {#if tag.category_name}
                  <span
                    class="text-[10px] uppercase font-bold tracking-wider text-slate-400 bg-slate-900/50 px-1.5 py-0.5 rounded border border-slate-700 group-hover:border-slate-500 transition-colors"
                  >
                    {tag.category_name}
                  </span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Filter Button -->
    <div class="relative">
      <button
        class="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-800/50 border border-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-800 transition-all duration-200 {selectedTypeIds.length >
          0 || excludedTypeIds.length > 0
          ? 'border-blue-500/50 text-blue-400 bg-blue-500/5'
          : ''}"
        onclick={(e) => {
          e.stopPropagation();
          showTypeFilter = !showTypeFilter;
        }}
        title="Filter by content type"
      >
        <div class="relative">
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
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
            />
          </svg>
          {#if selectedTypeIds.length > 0 || excludedTypeIds.length > 0}
            <span
              class="absolute -top-2 -right-2 min-w-[18px] h-[18px] flex items-center justify-center bg-blue-500 text-white text-[10px] font-bold rounded-full px-1 shadow-lg shadow-blue-500/20"
            >
              {selectedTypeIds.length + excludedTypeIds.length}
            </span>
          {/if}
        </div>
      </button>

      {#if showTypeFilter}
        <div
          role="menu"
          tabindex="-1"
          class="absolute right-0 top-full mt-3 w-80 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl z-[60] overflow-hidden p-5"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
          transition:fade={{ duration: 150 }}
        >
          <div class="flex items-center justify-between mb-5">
            <span
              class="text-[11px] font-bold text-slate-500 uppercase tracking-[0.1em]"
              >Filter by Type</span
            >
            <button
              class="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-wider"
              onclick={clearTypeFilters}
            >
              Clear All
            </button>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            {#each availableTypes as type}
              {@const isSelected = selectedTypeIds.includes(type.id)}
              {@const isExcluded = excludedTypeIds.includes(type.id)}
              <button
                class="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 {isSelected
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : isExcluded
                    ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}"
                onclick={() => handleTypeClick(type.id)}
              >
                <span class="text-base leading-none">
                  {getIcon(type.name)}
                </span>
                <span class="truncate">{type.name}</span>
                {#if isExcluded}
                  <svg
                    class="w-3 h-3 ml-auto opacity-70"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="3"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- Grid Size Controls -->
    <div
      class="hidden sm:flex items-center gap-1 bg-slate-800/50 rounded-lg p-1 border border-slate-700/30 flex-shrink-0"
    >
      <!-- Small Grid -->
      <button
        class="p-1.5 rounded-md transition-colors {gridSize === 'small'
          ? 'bg-slate-700 text-white shadow-sm'
          : 'text-slate-400 hover:text-white'}"
        onclick={() => {
          gridSize = "small";
          localStorage.setItem("favoritesGridSize", "small");
          window.electronAPI.settings.set("favoritesGridSize", "small");
        }}
        title="Small Grid"
        aria-label="Small Grid"
      >
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
          <path
            d="M1 1h3v3H1V1zm4.5 0h3v3h-3V1zM10 1h3v3h-3V1zM14.5 1h.5a1 1 0 0 1 1 1v2h-1.5V1zM1 5.5h3v3H1v-3zm4.5 0h3v3h-3v-3zM10 5.5h3v3h-3v-3zm4.5 0h1.5v3h-1.5v-3zM1 10h3v3H1v-3zm4.5 0h3v3h-3v-3zM10 10h3v3h-3v-3zm4.5 0h1.5v3h-1.5v-3zM1 14.5h3v.5a1 1 0 0 0 1-1h-4z"
          />
          <path
            d="M0 0h3v3H0V0zm4.33 0h3v3h-3V0zm4.33 0h3v3h-3V0zm4.34 0h3v3h-3V0zM0 4.33h3v3H0v-3zm4.33 0h3v3h-3v-3zm4.33 0h3v3h-3v-3zm4.34 0h3v3h-3v-3zM0 8.66h3v3H0v-3zm4.33 0h3v3h-3v-3zm4.33 0h3v3h-3v-3zm4.34 0h3v3h-3v-3zM0 13h3v3H0v-3zm4.33 0h3v3h-3v-3zm4.33 0h3v3h-3v-3zm4.34 0h3v3h-3v-3z"
          />
        </svg>
      </button>

      <!-- Medium Grid -->
      <button
        class="p-1.5 rounded-md transition-colors {gridSize === 'medium'
          ? 'bg-slate-700 text-white shadow-sm'
          : 'text-slate-400 hover:text-white'}"
        onclick={() => {
          gridSize = "medium";
          localStorage.setItem("favoritesGridSize", "medium");
          window.electronAPI.settings.set("favoritesGridSize", "medium");
        }}
        title="Medium Grid"
        aria-label="Medium Grid"
      >
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
          <path
            d="M1 1h4v4H1V1zm5 0h4v4H6V1zm5 0h4v4h-4V1zM1 6h4v4H1V6zm5 0h4v4H6V6zm5 0h4v4h-4V6zM1 11h4v4H1v-4zm5 0h4v4H6v-4zm5 0h4v4h-4v-4z"
          />
        </svg>
      </button>

      <!-- Large Grid -->
      <button
        class="p-1.5 rounded-md transition-colors {gridSize === 'large'
          ? 'bg-slate-700 text-white shadow-sm'
          : 'text-slate-400 hover:text-white'}"
        onclick={() => {
          gridSize = "large";
          localStorage.setItem("favoritesGridSize", "large");
          window.electronAPI.settings.set("favoritesGridSize", "large");
        }}
        title="Large Grid"
        aria-label="Large Grid"
      >
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
          <path d="M0 0h7v7H0V0zm9 0h7v7H9V0zM0 9h7v7H0V9zm9 0h7v7H9V9z" />
        </svg>
      </button>
    </div>
  </div>
</header>

<!-- Added bg-slate-900 to ensure solid background and prevent flash -->
<div
  class="flex-1 overflow-auto p-6 scroll-smooth bg-slate-900"
  use:dragScroll={{ axis: "y" }}
  onscroll={() => {
    if (activeMenuId !== null) closeMenu();
    if (showTypeFilter) showTypeFilter = false;
    if (showSearchSuggestions) showSearchSuggestions = false;
  }}
>
  {#if loading}
    <div class="flex items-center justify-center h-full">
      <div
        class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
      ></div>
    </div>
  {:else if filteredItems.length === 0}
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
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </svg>
      </div>
      <h2 class="text-2xl font-bold text-white mb-2">No Favorites Yet</h2>
      <p class="text-slate-400 max-w-md">
        Add items to your favorites by clicking the heart icon in your library.
      </p>
    </div>
  {:else}
    <div class="grid {getGridClass()} gap-4 favorites-grid scroll-smooth">
      {#each visibleItems as item, idx (item.id)}
        <div
          role="button"
          tabindex="0"
          data-nav-index={idx}
          data-type={item.type}
          data-item-id={item.id}
          class="flex flex-col group relative rounded-xl transition-[transform,shadow,border-color] duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-rose-500/10 hover:border-rose-500/50 text-left cursor-pointer bg-slate-900 border border-slate-700/50 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 select-none outline-none ring-0 overflow-hidden"
          in:fly|local={{
            y: skipItemAnimation ? 0 : 10,
            duration: skipItemAnimation ? 0 : 300,
          }}
          style="z-index: {activeMenuId === item.id ? 50 : 'auto'}"
          onclick={(e: MouseEvent) => handleItemClick(item, e)}
          onmousedown={(e: MouseEvent) => e.shiftKey && e.preventDefault()}
          ondblclick={(e: MouseEvent) => handleItemClick(item, e)}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleItemClick(item, e);
            }
          }}
        >
          <!-- Selection Overlay -->
          {#if selection.selectionMode || selection.has(item.id)}
            <div
              class="absolute inset-0 z-40 rounded-xl transition-all duration-200 pointer-events-none {selection.has(
                item.id,
              )
                ? 'bg-blue-500/10 border-2 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.2)]'
                : 'bg-blue-500/0 border-0'}"
              onclick={(e) => selection.toggle(item.id, filteredItems, e)}
              onkeydown={(e) =>
                e.key === "Enter" &&
                selection.toggle(item.id, filteredItems, e)}
              role="button"
              tabindex="0"
              aria-label="Toggle selection"
            >
              <div class="absolute top-2 left-2 p-1">
                <div
                  class="w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 {selection.has(
                    item.id,
                  )
                    ? 'bg-blue-500 border-blue-500'
                    : 'bg-black/40 border-slate-400 group-hover:border-blue-400'}"
                >
                  {#if selection.has(item.id)}
                    <svg
                      class="w-4 h-4 text-white"
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
              </div>
            </div>
          {/if}
          <!-- Top-Left Actions (Menu) -->
          <div
            class="absolute top-2 left-2 {activeMenuId === item.id
              ? 'z-[70]'
              : 'z-20'}"
          >
            <div class="relative">
              <button
                aria-label="Options"
                class="p-1.5 rounded-full transition-all duration-200 {activeMenuId ===
                item.id
                  ? 'bg-black/60 text-white opacity-100'
                  : 'bg-black/40 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-black/60'}"
                onclick={(e) => toggleMenu(item.id, e)}
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
                  class="absolute left-0 top-full mt-1 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden text-left"
                  role="menu"
                  tabindex="-1"
                  onclick={(e) => e.stopPropagation()}
                  onkeydown={(e) => e.stopPropagation()}
                  transition:fade={{ duration: 100 }}
                >
                  <div class="p-1">
                    <button
                      class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
                      onclick={(e) => {
                        closeMenu();
                        openTagEditor(item, e);
                      }}
                    >
                      <svg
                        class="w-4 h-4 text-blue-400 opacity-70"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        ><path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                        /></svg
                      >
                      Edit Tags
                    </button>

                    <button
                      class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
                      onclick={(e) => {
                        closeMenu();
                        openTypeEditor(item, e);
                      }}
                    >
                      <svg
                        class="w-4 h-4 text-indigo-400 opacity-70"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        ><path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                        /></svg
                      >
                      Set Types
                    </button>

                    {#if item.type === "book"}
                      <button
                        class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
                        onclick={(e) => {
                          closeMenu();
                          managingArchiveItem = item;
                        }}
                      >
                        <svg
                          class="w-4 h-4 text-emerald-400 opacity-70"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                          /></svg
                        >
                        Manage Content
                      </button>
                    {/if}

                    <button
                      class="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
                      onclick={(e) => {
                        closeMenu();
                        deleteItem(item, e);
                      }}
                    >
                      <svg
                        class="w-4 h-4 text-red-400 opacity-70"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        ><path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        /></svg
                      >
                      Delete
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          </div>
          <!-- Remove favorite button -->
          <button
            aria-label="Remove from favorites"
            class="group/btn absolute top-2 right-2 z-10 p-1.5 rounded-full transition-all duration-300 bg-rose-500 text-white shadow-lg shadow-rose-500/50 hover:bg-rose-600 hover:scale-110"
            onclick={(e) => removeFavorite(item.id, e)}
          >
            <div class="relative w-4 h-4 flex items-center justify-center">
              <!-- Heart Icon (Default) -->
              <svg
                class="w-4 h-4 absolute transition-all duration-300 opacity-100 group-hover/btn:opacity-0 group-hover/btn:rotate-90 group-hover/btn:scale-50"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                />
              </svg>

              <!-- X Icon (Hover) -->
              <svg
                class="w-4 h-4 absolute transition-all duration-300 opacity-0 group-hover/btn:opacity-100 group-hover/btn:rotate-0 -rotate-90 scale-50 group-hover/btn:scale-100"
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
            </div>
          </button>

          <!-- Cover -->
          <div
            class="aspect-[2/3] bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center relative overflow-hidden rounded-t-xl"
          >
            {#if item.cover_path}
              <img
                src={`media:///${item.cover_path.replace(/\\/g, "/")}${item._coverVersion ? `?v=${item._coverVersion}` : ""}`}
                alt={item.title}
                draggable="false"
                loading="eager"
                style="--r18-blur: {blurR18Intensity}px"
                class="w-full h-full object-cover transition-all duration-300 group-hover:scale-105 {item.types_list
                  ?.toLowerCase()
                  .includes('r18') && blurR18
                  ? `blur-[var(--r18-blur)] ${blurR18Hover ? 'group-hover:blur-0' : ''}`
                  : ''}"
              />
            {:else}
              <svg
                class="w-12 h-12 text-slate-500"
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

            <!-- Badges Layer -->
            <div
              class="absolute bottom-2 left-2 z-10 flex flex-col gap-1 items-start"
            >
              {#each getLanguageCodes(item.tags_list) as code}
                <div
                  class="px-1.5 py-0.5 text-[9px] font-bold bg-black/60 text-white rounded backdrop-blur-md border border-white/10 shadow-sm"
                >
                  {code}
                </div>
              {/each}
            </div>

            <!-- Reading Badge -->
            {#if item.reading_status !== "unread"}
              <div class="absolute top-0 left-0 z-20">
                <div
                  class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white {getStatusColor(
                    item.reading_status,
                  )} rounded-br-lg shadow-lg"
                >
                  {getStatusLabel(item.reading_status)}
                </div>
              </div>
            {/if}

            {#if item.types_list?.toLowerCase().includes("r18")}
              <div
                class="absolute bottom-0 right-0 z-20 flex flex-col gap-1 items-end"
              >
                <div
                  class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white bg-red-600 rounded-tl-lg shadow-lg"
                >
                  R18
                </div>
              </div>
            {/if}

            <!-- Reading progress bar -->
            {#if item.type === "book" && item.current_page > 0 && item.page_count > 0}
              <div
                class="absolute bottom-0 left-0 right-0 h-1 bg-black/50 z-20"
              >
                <div
                  class="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300"
                  style="width: {getReadingProgress(item)}%"
                ></div>
              </div>
            {/if}
          </div>

          <div class="p-3 bg-slate-800 rounded-b-xl flex-1 flex flex-col">
            <p
              class="text-sm font-medium text-white truncate group-hover:text-rose-400 transition-colors"
              title={item.title}
            >
              {item.title}
            </p>

            {#if item.types_list}
              {@const displayTypes = item.types_list
                .split(",")
                .filter((t) => t.trim().toLowerCase() !== "r18")}
              {#if displayTypes.length > 0}
                <div class="flex flex-wrap gap-1 mt-2 mb-1">
                  {#each displayTypes as type}
                    <span
                      class="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-300 bg-slate-700/50 rounded border border-slate-600/50"
                    >
                      {type}
                    </span>
                  {/each}
                </div>
              {/if}
            {/if}

            {#if searchQuery}
              <div
                class="flex items-center gap-1.5 mt-1.5 text-xs text-slate-500 mb-1"
              >
                <svg
                  class="w-3.5 h-3.5 flex-shrink-0 opacity-70"
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
                <span class="truncate opacity-80">
                  {getBreadcrumbPath(item)}
                </span>
              </div>
            {/if}
            <div class="flex items-center justify-between mt-auto pt-1.5">
              <p class="text-xs text-slate-500">
                {item.page_count || 0} pages
              </p>
              {#if item.type === "book" && item.current_page > 0}
                <p class="text-xs text-blue-400 font-medium">
                  p.{item.current_page + 1}
                </p>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>

    <!-- Loading Trigger -->
    {#if renderLimit < filteredItems.length}
      <div
        bind:this={loaderRef}
        class="h-20 flex items-center justify-center mt-8"
      >
        <div
          class="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"
        ></div>
      </div>
    {/if}
  {/if}
</div>

<BulkSelection
  {selection}
  allIds={stabilizedAllIds}
  view="favorites"
  onRefresh={handleBulkRefresh}
  onMove={() => {}}
/>

{#if managingArchiveItem}
  <ArchiveManager
    item={managingArchiveItem}
    onClose={() => (managingArchiveItem = null)}
  />
{/if}

<style>
  /* Aggressively nuke focus outlines for general elements to keep clean UI */
  :global(*:focus),
  :global(*:focus-visible) {
    outline: none !important;
  }

  /* High-visibility selector for Grid Items (Keyboard Only) - Unified Blue Theme */
  [role="button"]:focus-visible {
    outline: 2px solid #3b82f6 !important;
    outline-offset: 2px !important;
    box-shadow: 0 0 15px rgba(59, 130, 246, 0.4) !important;
    z-index: 60;
  }

  :global(input:focus),
  :global(textarea:focus) {
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2) !important;
  }

  :global(.select-none) {
    -webkit-user-select: none !important;
    user-select: none !important;
  }
</style>
