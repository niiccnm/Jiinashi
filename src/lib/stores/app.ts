import { writable } from "svelte/store";
import type { MangaPreference, ReaderBootstrapOverrides } from "../utils/manga";

export type View =
  | "library"
  | "manga"
  | "reader"
  | "favorites"
  | "recent"
  | "settings"
  | "tags"
  | "downloader"
  | "download_logs";

export interface LibraryItem {
  id: number;
  path: string;
  title: string;
  type: "book" | "folder";
  page_count: number;
  cover_path: string | null;
  parent_id: number | null;
  is_favorite: boolean;
  reading_status: "unread" | "reading" | "read";
  current_page: number;
  current_page_offset?: number;
  last_read_at: string | null;
  added_at: string;
  tags_list?: string;
  content_type?: string | null;
  types_list?: string;
  _coverVersion?: number;
  manga_series_id?: number | null;
  manga_preference?: MangaPreference;
  readerInit?: ReaderBootstrapOverrides | null;
}

export type DownloaderMangaDeepLink = {
  id?: number | null;
  sourceId?: string;
  sourceUrl?: string;
  title?: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  displayTitle?: string;
};

export type DownloaderNavigationIntent = {
  requestId: number;
  mode: "queue" | "history" | "manga" | "doujinshi";
  manga?: DownloaderMangaDeepLink | null;
};

interface LibraryState {
  currentFolderId: number | null;
  folderPath: LibraryItem[];
  scrollPositions: Record<string, number>;
}

interface AppState {
  currentView: View;
  currentBook: LibraryItem | null;
  libraryState: LibraryState;
  sidebarWidth: number;
  downloaderNavigation: DownloaderNavigationIntent | null;
}

let downloaderNavigationRequestId = 0;

export const appState = writable<AppState>({
  currentView: "library",
  currentBook: null,
  libraryState: {
    currentFolderId: null,
    folderPath: [],
    scrollPositions: {},
  },
  sidebarWidth: 256,
  downloaderNavigation: null,
});

export function openBook(item: LibraryItem) {
  // Open in new window
  window.electronAPI.reader.openWindow(
    item.id,
    undefined,
    item.manga_series_id ?? null,
  );
}

export function openLibrary() {
  appState.update((s) => ({
    ...s,
    currentView: "library",
    currentBook: null,
  }));
}

export function openManga() {
  appState.update((s) => ({
    ...s,
    currentView: "manga",
    currentBook: null,
  }));
}

export function openFavorites() {
  appState.update((s) => ({
    ...s,
    currentView: "favorites",
    currentBook: null,
  }));
}

export function openRecent() {
  appState.update((s) => ({
    ...s,
    currentView: "recent",
    currentBook: null,
  }));
}

export function openSettings() {
  appState.update((s) => ({
    ...s,
    currentView: "settings",
    currentBook: null,
  }));
}

export function openTags() {
  appState.update((s) => ({
    ...s,
    currentView: "tags",
    currentBook: null,
  }));
}

export function openDownloader(
  navigation?: Omit<DownloaderNavigationIntent, "requestId"> | null,
) {
  const nextNavigation =
    navigation && typeof navigation === "object"
      ? ({
          ...navigation,
          requestId: ++downloaderNavigationRequestId,
        } as DownloaderNavigationIntent)
      : null;
  appState.update((s) => ({
    ...s,
    currentView: "downloader",
    currentBook: null,
    downloaderNavigation: nextNavigation,
  }));
}

export function openDownloaderToMangaSeries(
  manga: DownloaderMangaDeepLink,
) {
  openDownloader({
    mode: "manga",
    manga: manga || null,
  });
}

export function clearDownloaderNavigation(requestId?: number) {
  appState.update((s) => {
    if (!s.downloaderNavigation) return s;
    if (
      Number(requestId || 0) > 0 &&
      Number(s.downloaderNavigation.requestId || 0) !== Number(requestId)
    ) {
      return s;
    }
    return {
      ...s,
      downloaderNavigation: null,
    };
  });
}

export function updateLibraryState(state: Partial<LibraryState>) {
  appState.update((s) => ({
    ...s,
    libraryState: {
      ...s.libraryState,
      ...state,
    },
  }));
}

// -- History Management --

interface HistoryEntry {
  view: View;
  book: LibraryItem | null;
  folderId: number | null;
}

const historyStack: HistoryEntry[] = [];
let historyIndex = -1;

// We use this to identify if an incoming state update is just the app "settling"
// into the state we just navigated to.
let pendingHistoryNavigation: HistoryEntry | null = null;

// Initialize history tracking
appState.subscribe((state) => {
  const entry: HistoryEntry = {
    view: state.currentView,
    book: state.currentBook,
    folderId: state.libraryState.currentFolderId,
  };

  // Check if this update matches our pending navigation target
  if (pendingHistoryNavigation) {
    const isTarget =
      entry.view === pendingHistoryNavigation.view &&
      entry.book?.id === pendingHistoryNavigation.book?.id &&
      entry.folderId === pendingHistoryNavigation.folderId;

    if (isTarget) {
      // We reached the target state. Consuming the pending flag.
      // We intentionally do NOT push this to stack because it's already there (at the new index).
      pendingHistoryNavigation = null;
      return;
    }
  }

  // If we are not expecting a specific state (or state drifted), standard history logic applies:

  // If stack is desync'd (e.g. we were at index 2, but received new state that isn't at index 2's value),
  // we assume it's a new user action.

  // First, checking if it's just a duplicate of current head (no-op update)
  const currentHead = historyStack[historyIndex];
  const isSameAsHead =
    currentHead &&
    currentHead.view === entry.view &&
    currentHead.book?.id === entry.book?.id &&
    currentHead.folderId === entry.folderId;

  if (isSameAsHead) {
    return; // Ignore duplicates
  }

  // It is a new distinct state.
  // If we were in the past (historyIndex < length-1), we branch a new timeline.
  if (historyIndex < historyStack.length - 1) {
    historyStack.splice(historyIndex + 1);
  }

  historyStack.push(entry);
  historyIndex++;

  // Limit stack size
  if (historyStack.length > 50) {
    historyStack.shift();
    historyIndex--;
  }
});

export function navigateHistory(direction: number) {
  const newIndex = historyIndex + direction;

  if (newIndex >= 0 && newIndex < historyStack.length) {
    const entry = historyStack[newIndex];

    // Set pending flag BEFORE updating state
    pendingHistoryNavigation = entry;
    historyIndex = newIndex;

    appState.update((s) => ({
      ...s,
      currentView: entry.view,
      currentBook: entry.book,
      libraryState: {
        ...s.libraryState,
        currentFolderId: entry.folderId,
      },
    }));
  }
}

/**
 * Returns to the nearest earlier visit to the requested state.
 * UI Back collapses skipped visits so Forward restores the view being left.
 */
export function tryNavigateBackTo(target: {
  view: View;
  folderId: number | null;
}): boolean {
  for (let index = historyIndex - 1; index >= 0; index--) {
    const entry = historyStack[index];
    if (
      entry.view === target.view &&
      entry.folderId === target.folderId
    ) {
      // Keep the current view and its forward history, but don't replay the detour.
      const skippedEntries = historyIndex - index - 1;
      historyStack.splice(index + 1, skippedEntries);
      historyIndex -= skippedEntries;
      navigateHistory(-1);
      return true;
    }
  }
  return false;
}
