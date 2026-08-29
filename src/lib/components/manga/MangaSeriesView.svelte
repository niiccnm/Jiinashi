<script lang="ts">
  import MsvView from "./series-view/msv-view.svelte";

  interface Props {
    manga: any;
    onBack: () => void;
    onSelectManga?: (manga: any) => void;
    onDownloadQueued?: () => void;
  }

  let { manga, onBack, onSelectManga, onDownloadQueued }: Props = $props();
  let viewRef = $state<any>(null);

  export async function reloadCurrentSeries() {
    await viewRef?.reloadCurrentSeries?.();
  }
</script>

<MsvView
  bind:this={viewRef}
  {manga}
  {onBack}
  {onSelectManga}
  {onDownloadQueued}
/>
