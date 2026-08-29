<script lang="ts">
  import MlvView from "./library-view/mlv-view.svelte";
  import type { LibraryItem } from "../../stores/app";
  import type {
    MlvChapterActions,
    MlvSelectionContext,
  } from "./library-view/mlv-types";

  let {
    seriesIds = [],
    chapterItems = [],
    gridSize = "medium",
    onBack,
    chapterActions = null,
    selectionContext = null,
    menuCloseEpoch = 0,
  }: {
    seriesIds?: number[];
    chapterItems?: LibraryItem[];
    gridSize?: "small" | "medium" | "large";
    onBack?: (() => void) | null;
    chapterActions?: MlvChapterActions | null;
    selectionContext?: MlvSelectionContext | null;
    menuCloseEpoch?: number;
  } = $props();
</script>

<MlvView
  {seriesIds}
  {chapterItems}
  {gridSize}
  {onBack}
  {chapterActions}
  {selectionContext}
  {menuCloseEpoch}
/>
