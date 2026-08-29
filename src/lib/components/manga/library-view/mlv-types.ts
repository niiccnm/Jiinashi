import type { LibraryItem } from "../../../stores/app";
import type { SelectionModel } from "../../../state/selection.svelte";

export type MlvChapterActions = {
  editTags?: (item: LibraryItem) => void | Promise<void>;
  setType?: (item: LibraryItem) => void | Promise<void>;
  manageContent?: (item: LibraryItem) => void | Promise<void>;
  moveItem?: (item: LibraryItem) => void | Promise<void>;
  rename?: (item: LibraryItem) => void | Promise<void>;
  openLocation?: (item: LibraryItem) => void | Promise<void>;
  deleteItem?: (item: LibraryItem) => void | Promise<void>;
};

export type MlvSelectionContext = {
  selection?: SelectionModel | null;
  onVisibleChapterIdsChange?: (ids: number[]) => void;
};
