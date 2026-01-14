<script lang="ts">
  interface Props {
    imageSrc: string | null;
    fitMode: "width" | "height" | "contain" | "fill";
    fullscreen?: boolean;
    navCancelNonce?: number;
    brightness?: number;
    contrast?: number;
    gamma?: number;
    zoomLevel?: number;
    panX?: number;
    panY?: number;
    isPanning?: boolean;
    wasPanning?: boolean;
    rtl?: boolean;
    onTransformTargetReady?: (el: HTMLElement | null) => void;
    onNext?: () => void;
    onPrev?: () => void;
    onToggleUI?: () => void;
    onContextMenu?: (e: MouseEvent) => void;
  }

  let {
    imageSrc,
    fitMode,
    fullscreen = false,
    navCancelNonce = 0,
    brightness = 100,
    contrast = 100,
    gamma = 100,
    zoomLevel = 100,
    panX = 0,
    panY = 0,
    isPanning = false,
    wasPanning = false,
    rtl = false,
    onTransformTargetReady,
    onNext,
    onPrev,
    onToggleUI,
    onContextMenu,
  }: Props = $props();

  let transformTargetEl: HTMLImageElement | null = $state(null);

  const EDGE_NAV_DOUBLE_CLICK_GRACE_MS = 180;
  let pendingEdgeNavTimeout: any = null;

  $effect(() => {
    onTransformTargetReady?.(transformTargetEl);
  });

  $effect(() => {
    navCancelNonce;
    if (pendingEdgeNavTimeout) {
      clearTimeout(pendingEdgeNavTimeout);
      pendingEdgeNavTimeout = null;
    }
  });

  function scheduleEdgeNav(action?: () => void) {
    if (!action) return;
    if (pendingEdgeNavTimeout) {
      clearTimeout(pendingEdgeNavTimeout);
      pendingEdgeNavTimeout = null;
    }
    const scheduledNonce = navCancelNonce;
    pendingEdgeNavTimeout = setTimeout(() => {
      pendingEdgeNavTimeout = null;
      if (navCancelNonce !== scheduledNonce) return;
      action();
    }, EDGE_NAV_DOUBLE_CLICK_GRACE_MS);
  }

  function getFitClass(): string {
    switch (fitMode) {
      case "width":
        return "w-full h-auto";
      case "height":
        return "h-full w-auto";
      case "fill":
        return "w-full h-full object-cover";
      default:
        return "max-w-full max-h-full object-contain";
    }
  }

  function getEdgeHotZonePx(viewportWidth: number): number {
    const pct = fullscreen ? 0.4 : 0.2;
    const minPx = 56;
    const maxPx = fullscreen ? 820 : 320;
    return Math.max(minPx, Math.min(maxPx, viewportWidth * pct));
  }

  function handleClick(e: MouseEvent) {
    if (isPanning || wasPanning) return;
    if (Math.abs(zoomLevel - 100) > 0.01) return;
    if (!fullscreen && (Math.abs(panX) > 0.5 || Math.abs(panY) > 0.5)) return;

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;

    const edgeZone = getEdgeHotZonePx(width);

    if (x <= edgeZone) {
      const action = rtl ? onNext : onPrev;
      if (fullscreen) action?.();
      else {
        if (e.detail > 1) {
          if (pendingEdgeNavTimeout) {
            clearTimeout(pendingEdgeNavTimeout);
            pendingEdgeNavTimeout = null;
          }
          return;
        }
        scheduleEdgeNav(action);
      }
    } else if (x >= width - edgeZone) {
      const action = rtl ? onPrev : onNext;
      if (fullscreen) action?.();
      else {
        if (e.detail > 1) {
          if (pendingEdgeNavTimeout) {
            clearTimeout(pendingEdgeNavTimeout);
            pendingEdgeNavTimeout = null;
          }
          return;
        }
        scheduleEdgeNav(action);
      }
    } else {
      onToggleUI?.();
    }
  }
</script>

<div
  class="flex-1 flex items-center justify-center overflow-hidden w-full h-full select-none outline-none"
  class:cursor-grab={zoomLevel > 100 && !isPanning}
  class:cursor-grabbing={isPanning}
  class:cursor-pointer={zoomLevel <= 100}
  onclick={handleClick}
  oncontextmenu={(e) => onContextMenu?.(e)}
  role="button"
  tabindex="0"
  onkeydown={(e) => {
    if (e.key === "Enter") onToggleUI?.();
  }}
>
  {#if imageSrc}
    <img
      src={imageSrc}
      alt="Page"
      class={getFitClass()}
      style="transform: translate({panX}px, {panY}px) scale({zoomLevel /
        100}); filter: brightness({brightness}%) contrast({contrast}%); image-rendering: high-quality; will-change: {isPanning
        ? 'transform'
        : 'auto'}; backface-visibility: hidden;"
      bind:this={transformTargetEl}
      draggable="false"
    />
  {/if}
</div>
