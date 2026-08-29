<script lang="ts">
  import MlvChapterSection from "./mlv-chapter-section.svelte";
  import MlvSeriesPanel from "./mlv-series-panel.svelte";
  import MlvTrackingEditorDialog from "./mlv-tracking-editor-dialog.svelte";
  import {
    extractProviderLabelFromChapterItem,
    getProviderKeyFromSourceId,
    normalizeProviderKey,
  } from "./mlv-domain-provider";
  import {
    createMlvController,
    type MlvControllerInputs,
  } from "./mlv-controller.svelte";
  import type { LibraryItem } from "../../../stores/app";
  import type { MlvChapterActions, MlvSelectionContext } from "./mlv-types";

  let {
    seriesIds: propSeriesIds = [],
    chapterItems: propChapterItems = [],
    gridSize: propGridSize = "medium",
    onBack: propOnBack,
    chapterActions: propChapterActions = null,
    selectionContext: propSelectionContext = null,
    menuCloseEpoch: propMenuCloseEpoch = 0,
  }: {
    seriesIds?: number[];
    chapterItems?: LibraryItem[];
    gridSize?: "small" | "medium" | "large";
    onBack?: (() => void) | null;
    chapterActions?: MlvChapterActions | null;
    selectionContext?: MlvSelectionContext | null;
    menuCloseEpoch?: number;
  } = $props();

  const controller = createMlvController();

  $effect(() => {
    const nextInputs: MlvControllerInputs = {
      seriesIds: propSeriesIds,
      chapterItems: propChapterItems,
      gridSize: propGridSize,
      onBack: propOnBack,
    };
    controller.setInputs(nextInputs);
  });

  const onBack = $derived(controller.onBack);
  const series = $derived(controller.series);
  const isLoading = $derived(controller.isLoading);
  const isRefreshing = $derived(controller.isRefreshing);
  const viewMode = $derived(controller.viewMode);
  const selectedSeries = $derived(controller.selectedSeries);
  const selectedShouldShowUnavailable = $derived(
    controller.selectedShouldShowUnavailable,
  );
  const friends = $derived(controller.friends);
  const selectedIsDetailLoading = $derived(controller.selectedIsDetailLoading);
  const selectedBannerSrc = $derived(controller.selectedBannerSrc);
  const selectedCoverSrc = $derived(controller.selectedCoverSrc);
  const selectedYear = $derived(controller.selectedYear);
  const selectedTrackingStatusVisible = $derived(
    controller.selectedTrackingStatusVisible,
  );
  const visibleUserTrackingStatuses = $derived(
    controller.visibleUserTrackingStatuses,
  );
  const trackingStatusError = $derived(controller.trackingStatusError);
  const isContinueResolving = $derived(controller.isContinueResolving);
  const isOpenInDownloaderResolving = $derived(
    controller.isOpenInDownloaderResolving,
  );
  const isTrackingStatusLoading = $derived(controller.isTrackingStatusLoading);
  const selectedDescriptionText = $derived(controller.selectedDescriptionText);
  const isDescriptionExpanded = $derived(controller.isDescriptionExpanded);
  const selectedGenres = $derived(controller.selectedGenres);
  const selectedReadingFormatLabel = $derived(
    controller.selectedReadingFormatLabel,
  );
  const isTrackingEditorOpen = $derived(controller.isTrackingEditorOpen);
  const isTrackingEditorSaving = $derived(controller.isTrackingEditorSaving);
  const isTrackingEditorRemoving = $derived(controller.isTrackingEditorRemoving);
  const isTrackingEditorHydrating = $derived(
    controller.isTrackingEditorHydrating,
  );
  const trackingEditorError = $derived(controller.trackingEditorError);
  const trackingEditorServices = $derived(controller.trackingEditorServices);
  const showTrackingEditorSyncBothSitesToggle = $derived(
    controller.showTrackingEditorSyncBothSitesToggle,
  );
  const trackingEditorSyncBothSitesEnabled = $derived(
    controller.trackingEditorSyncBothSitesEnabled,
  );
  const trackingEditorActiveService = $derived(
    controller.trackingEditorActiveService,
  );

  const formatMangaStatus = controller.formatMangaStatus;
  const formatTrackingListStatus = controller.formatTrackingListStatus;
  const formatTrackingChapterProgress =
    controller.formatTrackingChapterProgress;
  const truncateText = controller.truncateText;
  const getSeriesTitle = controller.getSeriesTitle;
  const getSecondarySeriesTitle = controller.getSecondarySeriesTitle;
  const getSeriesBannerCacheKey = controller.getSeriesBannerCacheKey;
  const getSeriesCoverCacheKey = controller.getSeriesCoverCacheKey;
  const getChapterCountInView = controller.getChapterCountInView;
  const getChapterGridClass = controller.getChapterGridClass;
  const getChapterCoverCacheKey = controller.getChapterCoverCacheKey;
  const getChapterCoverSrc = controller.getChapterCoverSrc;
  const canOpenSource = controller.canOpenSource;
  let selectedProviderKey = $state("");

  const providerSourceItems = $derived.by(() => {
    const items = Array.isArray(propChapterItems) ? propChapterItems : [];
    return items.filter((item) => String(item?.type || "") !== "folder");
  });

  function getSeriesSourceComparable(seriesItem: any): string {
    return getProviderKeyFromSourceId(seriesItem?.source_id);
  }

  const providerTabs = $derived.by(() => {
    const counts = new Map<string, { provider: string; count: number }>();
    for (const item of providerSourceItems) {
      const provider = extractProviderLabelFromChapterItem(item);
      const key = normalizeProviderKey(provider);
      if (!key) continue;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { provider, count: 1 });
      }
    }
    const tabs = [...counts.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.provider.localeCompare(b.provider, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
    return tabs;
  });

  $effect(() => {
    if (providerTabs.length === 0) {
      selectedProviderKey = "";
      return;
    }
    if (
      !providerTabs.some(
        (tab) => normalizeProviderKey(tab.provider) === selectedProviderKey,
      )
    ) {
      selectedProviderKey = normalizeProviderKey(providerTabs[0].provider);
    }
  });

  const visibleChapterCards = $derived.by(() => {
    const sourceItems =
      selectedProviderKey.length > 0
        ? providerSourceItems.filter(
            (item) =>
              normalizeProviderKey(extractProviderLabelFromChapterItem(item)) ===
              selectedProviderKey,
          )
        : providerSourceItems;

    return [...sourceItems].sort((a, b) =>
      String(b?.title || "").localeCompare(String(a?.title || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  });

  const chapterCardsByProvider = $derived.by(() => {
    const grouped: Record<string, any[]> = {};
    for (const item of providerSourceItems) {
      const providerKey = normalizeProviderKey(
        extractProviderLabelFromChapterItem(item),
      );
      if (!providerKey) continue;
      if (!grouped[providerKey]) {
        grouped[providerKey] = [];
      }
      grouped[providerKey].push(item);
    }

    const sorted: Record<string, any[]> = {};
    for (const [providerKey, items] of Object.entries(grouped)) {
      sorted[providerKey] = [...items].sort((a, b) =>
        String(b?.title || "").localeCompare(String(a?.title || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
    }
    return sorted;
  });

  const activeProviderKey = $derived.by(() => {
    if (selectedProviderKey.length > 0) return selectedProviderKey;
    const firstTab = providerTabs[0];
    return firstTab ? normalizeProviderKey(firstTab.provider) : "";
  });

  const activeProviderTab = $derived.by(() => {
    if (!activeProviderKey) return null;
    return (
      providerTabs.find(
        (tab) => normalizeProviderKey(tab.provider) === activeProviderKey,
      ) || null
    );
  });

  const activeContinueChapterCards = $derived.by(() => {
    if (providerTabs.length > 1) {
      if (!activeProviderKey) return [];
      return chapterCardsByProvider[activeProviderKey] || [];
    }
    return visibleChapterCards;
  });
  let lastVisibleChapterIdsSignature = $state("");

  $effect(() => {
    const callback = propSelectionContext?.onVisibleChapterIdsChange;
    if (typeof callback !== "function") return;

    const visibleIds = activeContinueChapterCards
      .map((item) => Number(item?.id || 0))
      .filter((id) => Number.isFinite(id) && id > 0);
    const signature = visibleIds.join(",");
    if (signature === lastVisibleChapterIdsSignature) return;
    lastVisibleChapterIdsSignature = signature;
    callback(visibleIds);
  });

  const activeProviderSeries = $derived.by(() => {
    if (!activeProviderKey) return null;
    const providerComparable = normalizeProviderKey(
      String(activeProviderTab?.provider || ""),
    );
    if (!providerComparable) return null;
    return (
      series.find(
        (item) => getSeriesSourceComparable(item) === providerComparable,
      ) || null
    );
  });

  const openSourceTargetSeries = $derived.by(() => {
    if (providerTabs.length > 0) {
      return activeProviderSeries || selectedSeries;
    }
    return selectedSeries;
  });

  const isOpenSourceDisabled = $derived.by(() => {
    const providerHint =
      providerTabs.length > 0 ? String(activeProviderTab?.provider || "") : "";
    return !canOpenSource(openSourceTargetSeries, providerHint);
  });

  function getSeriesTitleForProvider(provider: string) {
    const providerComparable = normalizeProviderKey(provider);
    if (providerComparable) {
      const matchingSeries =
        series.find(
          (item) => getSeriesSourceComparable(item) === providerComparable,
        ) || null;
      if (matchingSeries) return getSeriesTitle(matchingSeries);
    }
    return selectedSeries ? getSeriesTitle(selectedSeries) : "";
  }

  let mountedProviderKeys = $state<string[]>([]);

  $effect(() => {
    const availableKeys = providerTabs.map((tab) =>
      normalizeProviderKey(tab.provider),
    );
    if (availableKeys.length <= 1) {
      if (mountedProviderKeys.length > 0) {
        mountedProviderKeys = [];
      }
      return;
    }

    let nextMounted = mountedProviderKeys.filter((key) =>
      availableKeys.includes(key),
    );
    const currentKey = activeProviderKey;
    if (currentKey && availableKeys.includes(currentKey) && !nextMounted.includes(currentKey)) {
      nextMounted = [...nextMounted, currentKey];
    }

    if (
      nextMounted.length !== mountedProviderKeys.length ||
      nextMounted.some((key, index) => key !== mountedProviderKeys[index])
    ) {
      mountedProviderKeys = nextMounted;
    }
  });

  function toggleViewMode() {
    controller.toggleViewMode();
  }

  function handleBackClick() {
    controller.handleBackClick();
  }

  function loadLibrarySeries(initial = false, forceFetch = false) {
    return controller.loadLibrarySeries(initial, forceFetch);
  }

  function refreshSeriesDetail(seriesItem: any) {
    controller.refreshSeriesDetail(seriesItem);
  }

  async function handleTrackingStatusClick(seriesItem?: any) {
    await controller.handleTrackingStatusClick(seriesItem);
  }

  async function handleContinueClick() {
    await controller.handleContinueClick(activeContinueChapterCards);
  }

  function openTrackingEditor() {
    controller.openTrackingEditor();
  }

  function closeTrackingEditor() {
    controller.closeTrackingEditor();
  }

  function setTrackingEditorActiveService(service: "anilist" | "mal") {
    controller.setTrackingEditorActiveService(service);
  }

  function setTrackingEditorSyncBothSitesEnabled(enabled: boolean) {
    controller.setTrackingEditorSyncBothSitesEnabled(enabled);
  }

  function updateTrackingEditorField(
    service: "anilist" | "mal",
    field: "status" | "progress" | "volumes" | "score",
    value: string,
  ) {
    controller.updateTrackingEditorField(service, field, value);
  }

  async function saveTrackingEditor() {
    await controller.saveTrackingEditor();
  }

  async function removeTrackingEditorEntry() {
    await controller.removeTrackingEditorEntry();
  }

  function selectSeries(seriesItem: any) {
    controller.selectSeries(seriesItem);
  }

  function openSource(seriesItem: any) {
    const targetSeries =
      providerTabs.length > 0
        ? openSourceTargetSeries
        : seriesItem || selectedSeries;
    const providerHint =
      providerTabs.length > 0 ? String(activeProviderTab?.provider || "") : "";
    return controller.openSource(targetSeries, providerHint);
  }

  async function openInDownloader(seriesItem?: any) {
    await controller.openInDownloader(seriesItem);
  }

  function openAnilist(seriesItem?: any) {
    controller.openAnilist(seriesItem);
  }

  function openMal(seriesItem?: any) {
    controller.openMal(seriesItem);
  }

  function openMangabaka(seriesItem?: any) {
    controller.openMangabaka(seriesItem);
  }

  function openFriendProfile(friend: any) {
    controller.openFriendProfile(friend);
  }

  function cacheImageFromEvent(cacheKey: string, event: Event) {
    controller.cacheImageFromEvent(cacheKey, event);
  }

  function handleBannerError(event: Event) {
    controller.handleBannerError(event);
  }

  function handleSelectedCoverLoad(cacheKey: string, event: Event) {
    controller.handleSelectedCoverLoad(cacheKey, event);
  }

  function handleCoverError(event: Event) {
    controller.handleCoverError(event);
  }

  function openChapter(item: any) {
    controller.openChapter(item);
  }

  function toggleDescriptionExpanded() {
    controller.toggleDescriptionExpanded();
  }
</script>

<div class="flex w-full flex-col gap-6">
  <header
    class="flex items-center justify-between gap-4 bg-slate-950/40 px-2 py-4 border-b border-slate-800"
  >
    <div class="flex items-center gap-4">
      {#if onBack}
        <button
          onclick={handleBackClick}
          class="group flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-300 hover:text-white hover:border-slate-600 transition-all"
          title="Back to normal library view"
        >
          <svg
            class="w-4 h-4 transition-transform duration-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2.5"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          <span class="text-[11px] font-black uppercase tracking-widest">
            Back
          </span>
        </button>
      {/if}
      <div
        class="p-2.5 bg-gradient-to-br from-blue-500/20 to-blue-600/5 rounded-xl border border-blue-500/30 shadow-inner"
      >
        <svg
          class="w-6 h-6 text-blue-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.247 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
      </div>
      <div class="flex flex-col">
        <h1 class="text-2xl font-black text-white tracking-tight">
          Manga Library
        </h1>
        <p
          class="flex items-center gap-2.5 text-[10px] text-slate-500 font-bold uppercase tracking-[0.1em]"
        >
          <span>{series.length} Series</span>
          <span class="w-1 h-1 rounded-full bg-slate-800"></span>
          <span class="flex items-center gap-1.5 opacity-80">
            <kbd
              class="px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded text-[9px] font-black tracking-normal text-slate-400"
              >Ctrl+Shift+V</kbd
            >
            <span class="text-slate-500">Toggle View Mode</span>
          </span>
        </p>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <button
        onclick={() => loadLibrarySeries(false, true)}
        disabled={isRefreshing}
        class="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white transition-all hover:bg-slate-800 disabled:opacity-50"
      >
        <svg
          class="w-4 h-4 {isRefreshing ? 'animate-spin' : ''}"
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
        <span class="text-[11px] font-black uppercase tracking-wider"
          >Refresh</span
        >
      </button>
      <button
        onclick={toggleViewMode}
        class="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white transition-all hover:bg-slate-800"
      >
        {#if viewMode === "grid"}
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
              d="M4 6h16M4 10h16M4 14h16M4 18h16"
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
              d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
            />
          </svg>
        {/if}
        <span class="text-[11px] font-black uppercase tracking-wider">View</span
        >
      </button>
    </div>
  </header>

  <div class="pr-1">
    {#if series.length === 0}
      {#if isLoading}
        <div class="h-1"></div>
      {:else if providerSourceItems.length === 0}
        <div
          class="flex flex-col items-center justify-center py-20 bg-slate-900/20 rounded-3xl border border-dashed border-slate-800"
        >
          <p class="text-slate-500 font-medium">Your manga library is empty</p>
          <p class="text-slate-600 text-sm mt-1">
            Downloaded or linked manga will appear here
          </p>
        </div>
      {:else}
        {#if providerTabs.length > 1}
          <section
            class="mb-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
          >
            <p
              class="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2"
            >
              Series In This Folder
            </p>
            <div class="flex flex-wrap gap-2">
              {#each providerTabs as tab (tab.provider)}
                {@const tabKey = normalizeProviderKey(tab.provider)}
                <button
                  onclick={() => (selectedProviderKey = tabKey)}
                  class="px-3 py-1.5 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-colors {activeProviderKey ===
                  tabKey
                    ? 'border-blue-500/50 bg-blue-500/15 text-blue-200'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white'}"
                >
                  {tab.provider} • {tab.count}
                </button>
              {/each}
            </div>
          </section>
        {/if}

        {#if providerTabs.length > 1}
          {#each providerTabs as tab (tab.provider)}
            {@const tabKey = normalizeProviderKey(tab.provider)}
            {#if mountedProviderKeys.includes(tabKey) || activeProviderKey === tabKey}
              <div
                class={activeProviderKey === tabKey ? "block" : "hidden"}
                aria-hidden={activeProviderKey === tabKey ? "false" : "true"}
              >
                <MlvChapterSection
                  chapterCards={chapterCardsByProvider[tabKey] || []}
                  seriesTitle=""
                  {viewMode}
                  chapterGridClass={getChapterGridClass()}
                  chapterActions={propChapterActions}
                  selectionContext={propSelectionContext}
                  menuCloseEpoch={propMenuCloseEpoch}
                  isActive={activeProviderKey === tabKey}
                  {getChapterCoverCacheKey}
                  {getChapterCoverSrc}
                  {openChapter}
                  {cacheImageFromEvent}
                  {handleCoverError}
                />
              </div>
            {/if}
          {/each}
        {:else}
          <MlvChapterSection
            chapterCards={visibleChapterCards}
            seriesTitle=""
            {viewMode}
            chapterGridClass={getChapterGridClass()}
            chapterActions={propChapterActions}
            selectionContext={propSelectionContext}
            menuCloseEpoch={propMenuCloseEpoch}
            isActive={true}
            {getChapterCoverCacheKey}
            {getChapterCoverSrc}
            {openChapter}
            {cacheImageFromEvent}
            {handleCoverError}
          />
        {/if}
      {/if}
    {:else}
      <MlvSeriesPanel
        {selectedSeries}
        {selectedShouldShowUnavailable}
        {refreshSeriesDetail}
        {handleTrackingStatusClick}
        {isTrackingStatusLoading}
        {openSource}
        {isOpenSourceDisabled}
        openSourceDisabledTitle={providerTabs.length > 1
          ? "No source link available for the selected provider"
          : "No source link available for this series"}
        {openInDownloader}
        {isOpenInDownloaderResolving}
        {openAnilist}
        {openMal}
        {openMangabaka}
        {friends}
        {openFriendProfile}
        {selectedIsDetailLoading}
        {selectedBannerSrc}
        {getSeriesTitle}
        {getSeriesBannerCacheKey}
        {cacheImageFromEvent}
        {handleBannerError}
        {selectedCoverSrc}
        {getSeriesCoverCacheKey}
        {handleSelectedCoverLoad}
        {handleCoverError}
        {getSecondarySeriesTitle}
        {formatMangaStatus}
        {getChapterCountInView}
        selectedProviderLabel={activeProviderTab?.provider || ""}
        selectedProviderChapterCount={Number(activeProviderTab?.count || 0)}
        {selectedYear}
        {selectedReadingFormatLabel}
        {selectedTrackingStatusVisible}
        {visibleUserTrackingStatuses}
        {formatTrackingListStatus}
        {formatTrackingChapterProgress}
        {trackingStatusError}
        {openTrackingEditor}
        {handleContinueClick}
        chapterCards={activeContinueChapterCards}
        {isContinueResolving}
        {selectedDescriptionText}
        {isDescriptionExpanded}
        {toggleDescriptionExpanded}
        {truncateText}
        {selectedGenres}
      />
      {#if providerTabs.length > 1}
        <section
          class="mb-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
        >
          <p
            class="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2"
          >
            Series In This Folder
          </p>
          <div class="flex flex-wrap gap-2">
            {#each providerTabs as tab (tab.provider)}
              {@const tabKey = normalizeProviderKey(tab.provider)}
              <button
                onclick={() => (selectedProviderKey = tabKey)}
                class="px-3 py-1.5 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-colors {activeProviderKey ===
                tabKey
                  ? 'border-blue-500/50 bg-blue-500/15 text-blue-200'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white'}"
              >
                {tab.provider} • {tab.count}
              </button>
            {/each}
          </div>
        </section>
      {/if}

      {#if providerTabs.length > 1}
        {#each providerTabs as tab (tab.provider)}
          {@const tabKey = normalizeProviderKey(tab.provider)}
          {#if mountedProviderKeys.includes(tabKey) || activeProviderKey === tabKey}
            <div
              class={activeProviderKey === tabKey ? "block" : "hidden"}
              aria-hidden={activeProviderKey === tabKey ? "false" : "true"}
            >
              <MlvChapterSection
                chapterCards={chapterCardsByProvider[tabKey] || []}
                seriesTitle={getSeriesTitleForProvider(tab.provider)}
                {viewMode}
                chapterGridClass={getChapterGridClass()}
                chapterActions={propChapterActions}
                selectionContext={propSelectionContext}
                menuCloseEpoch={propMenuCloseEpoch}
                isActive={activeProviderKey === tabKey}
                {getChapterCoverCacheKey}
                {getChapterCoverSrc}
                {openChapter}
                {cacheImageFromEvent}
                {handleCoverError}
              />
            </div>
          {/if}
        {/each}
      {:else}
        <MlvChapterSection
          chapterCards={visibleChapterCards}
          seriesTitle={selectedSeries ? getSeriesTitle(selectedSeries) : ""}
          {viewMode}
          chapterGridClass={getChapterGridClass()}
          chapterActions={propChapterActions}
          selectionContext={propSelectionContext}
          menuCloseEpoch={propMenuCloseEpoch}
          isActive={true}
          {getChapterCoverCacheKey}
          {getChapterCoverSrc}
          {openChapter}
          {cacheImageFromEvent}
          {handleCoverError}
        />
      {/if}

      <MlvTrackingEditorDialog
        open={isTrackingEditorOpen}
        {selectedSeries}
        {getSeriesTitle}
        {isTrackingEditorSaving}
        {isTrackingEditorRemoving}
        {isTrackingEditorHydrating}
        trackingEditorError={trackingEditorError}
        trackingEditorServices={trackingEditorServices}
        showSyncBothSitesToggle={showTrackingEditorSyncBothSitesToggle}
        syncBothSitesEnabled={trackingEditorSyncBothSitesEnabled}
        trackingEditorActiveService={trackingEditorActiveService}
        {closeTrackingEditor}
        {setTrackingEditorActiveService}
        {setTrackingEditorSyncBothSitesEnabled}
        {updateTrackingEditorField}
        {saveTrackingEditor}
        {removeTrackingEditorEntry}
      />
    {/if}
  </div>
</div>
