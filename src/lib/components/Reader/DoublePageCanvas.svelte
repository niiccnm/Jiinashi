<script lang="ts">
  interface Props {
    imageSrcLeft: string | null;
    imageSrcRight: string | null;
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
    onContextMenu?: (side: "left" | "right", e: MouseEvent) => void;
  }

  let {
    imageSrcLeft,
    imageSrcRight,
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

  let transformTargetEl: HTMLDivElement | null = $state(null);

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

  let filterStyle = $derived.by(() => {
    if (brightness === 100 && contrast === 100) return "";
    return `filter: brightness(${brightness}%) contrast(${contrast}%);`;
  });

  function getFitClass(): string {
    switch (fitMode) {
      case "fill":
        return "w-full h-full object-cover";
      case "width":
        return "w-full h-auto max-h-full object-contain";
      case "height":
        return "h-full w-auto max-w-full object-contain";
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

    const isLeftZone = x <= edgeZone;
    const isRightZone = x >= width - edgeZone;

    if (isLeftZone) {
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
    } else if (isRightZone) {
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
  class="flex-1 flex items-center justify-center overflow-hidden w-full h-full select-none outline-none gap-0"
  class:cursor-grab={zoomLevel > 100 && !isPanning}
  class:cursor-grabbing={isPanning}
  class:cursor-pointer={zoomLevel <= 100}
  onclick={handleClick}
  role="button"
  tabindex="0"
  onkeydown={(e) => {
    if (e.key === "Enter") onToggleUI?.();
  }}
>
  <div
    class="flex items-center justify-center gap-0 w-full h-full"
    style="transform: translate({panX}px, {panY}px) scale({zoomLevel /
      100}); will-change: {isPanning
      ? 'transform'
      : 'auto'}; backface-visibility: hidden; image-rendering: high-quality; {filterStyle}"
    bind:this={transformTargetEl}
  >
    {#if imageSrcLeft}
      <div
        class="w-1/2 h-full flex items-center justify-end"
        oncontextmenu={(e) => onContextMenu?.("left", e)}
        role="presentation"
      >
        <img
          src={imageSrcLeft}
          alt="Left Page"
          class="{getFitClass()} object-right block"
          draggable="false"
        />
      </div>
    {:else if imageSrcRight}
      <div class="w-1/2 h-full"></div>
    {/if}

    {#if imageSrcRight}
      <div
        class="w-1/2 h-full flex items-center justify-start"
        oncontextmenu={(e) => onContextMenu?.("right", e)}
        role="presentation"
      >
        <img
          src={imageSrcRight}
          alt="Right Page"
          class="{getFitClass()} object-left block"
          draggable="false"
        />
      </div>
    {:else if imageSrcLeft}
      <div class="w-1/2 h-full"></div>
    {/if}
  </div>
</div>
