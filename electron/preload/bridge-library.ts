import { invoke, on } from "./bridge-helpers";
import type {
  ElectronAPI,
  LibraryItem,
  ScanProgressPayload,
} from "./types";

export function createLibraryBridge(): ElectronAPI["library"] {
  return {
    scan: (path: string) => invoke("library:scan", path),
    rescan: () => invoke("library:rescan"),
    getItems: (parentId: number | null = null, rootPath: string = "") =>
      invoke("library:getItems", parentId, rootPath),
    search: (
      query: string,
      options?: {
        folderId?: number | null;
        favoritesOnly?: boolean;
        root?: string;
      },
    ) => invoke("library:searchItems", query, options),
    getItem: (id: number) => invoke("library:getItem", id),
    getFavorites: (rootPath: string = "") => invoke("library:getFavorites", rootPath),
    getRecent: (limit?: number) => invoke("library:getRecent", limit),
    removeFromRecent: (id: number) => invoke("library:removeFromRecent", id),
    toggleFavorite: (id: number) => invoke("library:toggleFavorite", id),
    updateItem: (id: number, updates: Partial<LibraryItem>) =>
      invoke("library:updateItem", id, updates),
    setMangaPreference: (
      itemId: number,
      preference: "auto" | "force_manga" | "force_non_manga",
      options?: {
        recursive?: boolean;
        clearSeriesLinks?: boolean;
        seriesId?: number | null;
      },
    ) => invoke("library:setMangaPreference", itemId, preference, options),
    deleteItem: (id: number) => invoke("library:deleteItem", id),
    showInFolder: (itemPath: string) => invoke("library:showInFolder", itemPath),
    renameItem: (id: number, newName: string) =>
      invoke("library:renameItem", id, newName),
    getCover: (coverPath: string) => invoke("library:getCover", coverPath),
    backup: (options?: {
      includeDownloadHistory?: boolean;
      includeDownloadLogs?: boolean;
    }) => invoke("library:backup", options),
    importBackup: (inputPath?: string) => invoke("library:importBackup", inputPath),
    getRoots: () => invoke("library:getRoots"),
    removeRoot: (rootPath: string) => invoke("library:removeRoot", rootPath),
    onRootsUpdated: (callback: (roots: string[]) => void) =>
      on("library:roots-updated", callback),
    clear: () => invoke("library:clear"),
    getTotalBookCount: (rootPath?: string) =>
      invoke("library:getTotalBookCount", rootPath),
    exportTags: (options: {
      includeDescription: boolean;
      includeKeywords: boolean;
      includeDefaultTags: boolean;
      excludedCategoryIds?: number[];
      includeTypes?: boolean;
      includeDefaultTypes?: boolean;
      excludedTypeIds?: number[];
    }) => invoke("library:exportTags", options),
    importTags: (filePath?: string) => invoke("library:importTags", filePath),
    bulkDeleteItems: (ids: number[]) => invoke("library:bulkDeleteItems", ids),
    bulkToggleFavorite: (ids: number[]) =>
      invoke("library:bulkToggleFavorite", ids),
    bulkSetTags: (itemIds: number[], tagIds: number[], action: "add" | "remove") =>
      invoke("library:bulkSetTags", itemIds, tagIds, action),
    bulkSetContentType: (itemIds: number[], contentType: string | null) =>
      invoke("library:bulkSetContentType", itemIds, contentType),
    onItemsDeleted: (callback: (ids: number[]) => void) =>
      on("library:items-deleted", callback),
    onItemUpdated: (callback: (item: LibraryItem) => void) =>
      on("library:item-updated", callback),
    onItemAdded: (callback: (item: LibraryItem) => void) =>
      on("library:item-added", callback),
    onScanProgress: (callback: (payload: ScanProgressPayload) => void) =>
      on("library:scan-progress", callback),
    onCleared: (callback: () => void) =>
      on("library:cleared", () => callback()),
    onRefreshed: (callback: () => void) =>
      on("library:refreshed", () => callback()),
    onTriggerScan: (callback: (folderPath: string) => void) =>
      on("library:trigger-scan", callback),
    createFolder: (parentId: number | null, name: string, rootPath?: string) =>
      invoke("library:createFolder", parentId, name, rootPath),
    getAllFolders: () => invoke("library:getAllFolders"),
    moveItems: (
      itemIds: number[],
      destinationFolderId: number | string | null,
    ) =>
      invoke("library:moveItems", itemIds, destinationFolderId),
  };
}
