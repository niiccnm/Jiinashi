<script lang="ts">
  import { fade, slide, scale } from "svelte/transition";
  import Dialog from "../../Dialog.svelte";
  import TrackingEditorDialog from "../library-view/mlv-tracking-editor-dialog.svelte";
  import FriendsReadingIndicator from "../FriendsReadingIndicator.svelte";
  import MangaRecommendations from "../MangaRecommendations.svelte";
  import Pagination from "../../Pagination.svelte";
  import {
    createMsvController,
    type MsvControllerInputs,
  } from "./msv-controller.svelte";

  let {
    manga,
    onBack,
    onSelectManga,
    onDownloadQueued,
  }: {
    manga: any;
    onBack: () => void;
    onSelectManga?: (manga: any) => void;
    onDownloadQueued?: () => void;
  } = $props();

  const controller = createMsvController();

  $effect(() => {
    const nextInputs: MsvControllerInputs = {
      manga,
      onBack,
      onSelectManga,
      onDownloadQueued,
    };
    controller.setInputs(nextInputs);
  });

  export async function reloadCurrentSeries() {
    await controller.reloadCurrentSeries();
  }

  const onBackHandler = $derived(controller.onBack);
  const onSelectMangaHandler = $derived(controller.onSelectManga);
  const detail = $derived(controller.detail);
  const chapters = $derived(controller.chapters);
  const friends = $derived(controller.friends);
  const sourceGroups = $derived(controller.sourceGroups);
  const matchedSources = $derived(controller.matchedSources);
  const selectedSourceId = $derived(controller.selectedSourceId);
  const selectedSourceGroupId = $derived(controller.selectedSourceGroupId);
  const scanningByGroup = $derived(controller.scanningByGroup);
  const seriesTitleStyle = $derived(controller.seriesTitleStyle);
  const isLoading = $derived(controller.isLoading);
  const selectedChapters = $derived(controller.selectedChapters);
  const isDescriptionExpanded = $derived(controller.isDescriptionExpanded);
  const currentPage = $derived(controller.currentPage);
  const itemsPerPage = $derived(controller.itemsPerPage);
  const paginatedChapters = $derived(controller.paginatedChapters);
  const totalPages = $derived(controller.totalPages);
  const downloadableChaptersCount = $derived(
    controller.downloadableChaptersCount,
  );
  const downloadedChaptersCount = $derived(controller.downloadedChaptersCount);
  const selectedActionLabel = $derived(controller.selectedActionLabel);
  const areAllDownloadableChaptersSelected = $derived(
    controller.areAllDownloadableChaptersSelected,
  );
  const isScanningSources = $derived(controller.isScanningSources);
  const isSelectedSourceTransitioning = $derived(
    controller.isSelectedSourceTransitioning,
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
  const hasTargetTrackedEntry = $derived(controller.hasTargetTrackedEntry);
  const hasTargetPlanningEntry = $derived(
    controller.hasTargetPlanningEntry,
  );
  const hasTargetNonPlanningTrackedEntry = $derived(
    controller.hasTargetNonPlanningTrackedEntry,
  );
  const isQuickBookmarkLoading = $derived(controller.isQuickBookmarkLoading);
  const isQuickBookmarkRemoveConfirmOpen = $derived(
    controller.isQuickBookmarkRemoveConfirmOpen,
  );
  const quickBookmarkLabel = $derived.by(() =>
    isQuickBookmarkLoading
      ? "Updating list status"
      : hasTargetTrackedEntry
        ? hasTargetNonPlanningTrackedEntry
          ? "Remove from your list"
          : hasTargetPlanningEntry
            ? "Remove from Plan to Read"
            : "Remove from your list"
        : "Add to Plan to Read",
  );

  const hasSeriesSessionCache = controller.hasSeriesSessionCache;
  const hasCachedChaptersForSelectedSource =
    controller.hasCachedChaptersForSelectedSource;
  const getDisplaySeriesTitle = controller.getDisplaySeriesTitle;
  const getTrackingSeriesTitle = (_item: any) => getDisplaySeriesTitle();
  const getSeriesTypeLabel = controller.getSeriesTypeLabel;
  const getDescriptionHtml = controller.getDescriptionHtml;
  const getAnilistEntryUrl = controller.getAnilistEntryUrl;
  const getMalEntryUrl = controller.getMalEntryUrl;
  const getMangabakaEntryUrl = controller.getMangabakaEntryUrl;
  const openFriendProfile = controller.openFriendProfile;
  const resolveSourceId = controller.resolveSourceId;
  const selectSource = controller.selectSource;
  const handleSourceLanguageChange = controller.handleSourceLanguageChange;
  const applyManualSourceUrl = controller.applyManualSourceUrl;
  const forgetManualSourceUrl = controller.forgetManualSourceUrl;
  const getManualSourceUrl = controller.getManualSourceUrl;
  const getExpectedHostForGroup = controller.getExpectedHostForGroup;
  const selectAll = controller.selectAll;
  const handleDownload = controller.handleDownload;
  const toggleChapterSelection = controller.toggleChapterSelection;
  const isChapterDownloadable = controller.isChapterDownloadable;
  const isChapterDownloaded = controller.isChapterDownloaded;
  const getChapterDisplayTitle = controller.getChapterDisplayTitle;
  const getChapterPosterLabel = controller.getChapterPosterLabel;
  const getChapterUnavailableReason = controller.getChapterUnavailableReason;
  const handlePageChange = controller.handlePageChange;
  const handleGlobalKeydown = controller.handleGlobalKeydown;
  const toggleDescriptionExpanded = controller.toggleDescriptionExpanded;
  const formatMangaStatus = controller.formatMangaStatus;
  const handleQuickBookmarkClick = controller.handleQuickBookmarkClick;
  const confirmQuickBookmarkRemoval = controller.confirmQuickBookmarkRemoval;
  const cancelQuickBookmarkRemoval = controller.cancelQuickBookmarkRemoval;

  let descriptionBodyEl = $state<HTMLParagraphElement | null>(null);
  let isDescriptionOverflowing = $state(false);
  let isManualUrlDialogOpen = $state(false);
  let manualUrlDialogGroupId = $state("");
  let manualUrlInput = $state("");
  let manualUrlError = $state("");
  let manualUrlBusy = $state(false);
  const manualUrlForDialogGroup = $derived.by(() =>
    getManualSourceUrl(manualUrlDialogGroupId),
  );
  const expectedHostForDialogGroup = $derived.by(() =>
    getExpectedHostForGroup(manualUrlDialogGroupId),
  );

  $effect(() => {
    controller.setDescriptionBodyEl(descriptionBodyEl);
  });

  $effect(() => {
    const el = descriptionBodyEl;
    const description = detail?.description;
    if (!el || !description) {
      isDescriptionOverflowing = false;
      return;
    }

    const updateOverflowState = () => {
      const fourLines = Number.parseFloat(getComputedStyle(el).lineHeight) * 4;
      isDescriptionOverflowing = el.scrollHeight > fourLines + 1;
    };

    updateOverflowState();
    const resizeObserver = new ResizeObserver(updateOverflowState);
    resizeObserver.observe(el);

    return () => resizeObserver.disconnect();
  });

  function openManualUrlDialog(groupId: string) {
    const normalizedGroupId = String(groupId || "");
    manualUrlDialogGroupId = normalizedGroupId;
    manualUrlInput = getManualSourceUrl(normalizedGroupId);
    manualUrlError = "";
    isManualUrlDialogOpen = true;
  }

  function closeManualUrlDialog(force = false) {
    if (manualUrlBusy && !force) return;
    isManualUrlDialogOpen = false;
    manualUrlDialogGroupId = "";
    manualUrlInput = "";
    manualUrlError = "";
  }

  async function submitManualUrlDialog() {
    if (manualUrlBusy) return;
    manualUrlError = "";
    manualUrlBusy = true;
    try {
      const result = await applyManualSourceUrl(
        manualUrlDialogGroupId,
        manualUrlInput,
      );
      if (!result?.ok) {
        manualUrlError = result?.error || "Could not apply this URL.";
        return;
      }
      closeManualUrlDialog(true);
    } catch (error: any) {
      manualUrlError = error?.message || "Could not apply this URL.";
    } finally {
      manualUrlBusy = false;
    }
  }

  async function handleForgetManualUrl() {
    if (manualUrlBusy) return;
    manualUrlError = "";
    manualUrlBusy = true;
    try {
      const result = await forgetManualSourceUrl(manualUrlDialogGroupId);
      if (!result?.ok) {
        manualUrlError = result?.error || "Could not clear this URL override.";
        return;
      }
      closeManualUrlDialog(true);
    } catch (error: any) {
      manualUrlError = error?.message || "Could not clear this URL override.";
    } finally {
      manualUrlBusy = false;
    }
  }

  function getManualDialogGroupName() {
    const group = sourceGroups.find(
      (entry: any) => entry.id === manualUrlDialogGroupId,
    );
    return String(group?.name || "Source");
  }

  function hasManualUrlForDialogGroup() {
    return Boolean(manualUrlForDialogGroup);
  }

  function openTrackingEditor() {
    void controller.openTrackingEditor();
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
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div
  class="flex flex-col gap-8 pb-20"
  in:fade={{ duration: hasSeriesSessionCache() ? 0 : 120 }}
>
  <!-- Back Button -->
  <div class="flex items-center justify-between">
    <button
      onclick={onBackHandler}
      class="group flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white transition-all hover:bg-slate-800"
    >
      <svg
        class="w-5 h-5 transition-transform group-hover:-translate-x-1"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 19l-7-7m0 0l7-7m-7 7h18"
        />
      </svg>
      <span class="text-sm font-bold uppercase tracking-widest">Back</span>
    </button>
  </div>

  {#if isLoading && !detail && !hasSeriesSessionCache()}
    <div class="flex flex-col items-center justify-center py-40">
      <div
        class="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"
      ></div>
      <p
        class="mt-4 text-slate-500 font-medium tracking-wide font-black uppercase"
      >
        Decrypting metadata...
      </p>
    </div>
  {:else if detail}
    <!-- Hero Section -->
    <section class="flex flex-col md:flex-row gap-10 items-start">
      <div class="relative group shrink-0">
        <div
          class="relative w-64 aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl border border-white/10"
        >
          <img
            src={detail.coverImage?.extraLarge || detail.coverImage?.large}
            alt={getDisplaySeriesTitle()}
            class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div
            class="series-cover-edit-gradient pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 via-black/10 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          ></div>
          <button
            type="button"
            onclick={openTrackingEditor}
            class="series-cover-edit-button absolute bottom-3 right-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white/95 shadow-[0_12px_28px_rgba(0,0,0,0.35)] backdrop-blur-xl opacity-0 translate-y-1 scale-95 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 focus:opacity-100 focus:translate-y-0 focus:scale-100 hover:bg-black/62 disabled:cursor-default disabled:opacity-0 disabled:translate-y-1 disabled:scale-95"
            title="Edit Status"
            aria-label="Edit Status"
            disabled={isTrackingEditorHydrating ||
              isTrackingEditorSaving ||
              isTrackingEditorRemoving}
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
                d="M16.862 3.487a2.25 2.25 0 013.182 3.182L8.25 18.463l-4.5 1.318 1.318-4.5L16.862 3.487z"
              />
            </svg>
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-6 flex-1">
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-3">
            <h1
              class="text-5xl font-black text-white leading-tight tracking-tighter"
            >
              {getDisplaySeriesTitle()}
            </h1>
          </div>
          <div
            class="flex flex-wrap items-center gap-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500"
          >
            {#if detail.status}
              <span
                class="px-3 py-1 bg-blue-500/10 text-blue-300 rounded-full border border-blue-500/20 text-xs font-medium tracking-normal"
                >{formatMangaStatus(detail.status)}</span
              >
            {/if}
            {#if detail.averageScore}
              <span
                class="inline-flex items-center gap-1.5 text-xs font-bold tracking-normal text-amber-400 tabular-nums"
                title={`Average score: ${detail.averageScore / 10} out of 10`}
                aria-label={`Average score: ${detail.averageScore / 10} out of 10`}
              >
                <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"
                  ><path
                    d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                  /></svg
                >
                {detail?.averageScore / 10}
                <span class="text-[9px] font-semibold text-amber-400/60"
                  >/10</span
                >
              </span>
            {/if}
            <span class="text-slate-800">|</span>
            <span
              class="text-[11px] font-semibold uppercase tracking-wide text-slate-400"
              >{detail?.format}</span
            >
            <div class="flex items-center gap-2.5 ml-2 border-l border-slate-800 pl-4">
              <button
                type="button"
                onclick={() => void handleQuickBookmarkClick()}
                class="inline-flex h-5 w-5 shrink-0 items-center justify-center self-center text-white/90 transition-colors duration-150 hover:text-white disabled:cursor-default disabled:opacity-60"
                title={quickBookmarkLabel}
                aria-label={quickBookmarkLabel}
                disabled={isQuickBookmarkLoading ||
                  isTrackingEditorHydrating ||
                  isTrackingEditorSaving ||
                  isTrackingEditorRemoving}
              >
                {#if isQuickBookmarkLoading}
                  <span
                    class="block h-[18px] w-[18px] rounded-full border-2 border-white/25 border-t-white animate-spin"
                    aria-hidden="true"
                  ></span>
                {:else}
                  {#if hasTargetTrackedEntry}
                    <svg
                      class="block h-[18px] w-[18px] translate-y-[0.5px]"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M6.75 3A2.75 2.75 0 004 5.75V21a.75.75 0 001.116.655L12 17.722l6.884 3.933A.75.75 0 0020 21V5.75A2.75 2.75 0 0017.25 3h-10.5z" />
                    </svg>
                  {:else}
                    <svg
                      class="block h-[18px] w-[18px] translate-y-[0.5px]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 4.75A1.75 1.75 0 017.75 3h8.5A1.75 1.75 0 0118 4.75V21l-6-3.5L6 21V4.75z"
                      />
                    </svg>
                  {/if}
                {/if}
              </button>
              <span class="select-none text-slate-700" aria-hidden="true">|</span>
              <button
                onclick={() =>
                  window.electronAPI.utils.openExternal(getAnilistEntryUrl())}
                class="flex items-center"
                title="Open on AniList"
              >
                <img
                  src="https://anilist.co/img/icons/favicon-32x32.png"
                  alt="AniList"
                  class="w-5 h-5"
                />
              </button>
              <button
                onclick={() =>
                  window.electronAPI.utils.openExternal(getMalEntryUrl())}
                class="flex items-center"
                title="Open on MyAnimeList"
              >
                <img
                  src="https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://myanimelist.net&size=32"
                  alt="MAL"
                  class="w-5 h-5 rounded-sm"
                />
              </button>
              <button
                onclick={() =>
                  window.electronAPI.utils.openExternal(getMangabakaEntryUrl())}
                class="flex items-center"
                title="Open on Mangabaka"
                >
                  <img
                    src="https://mangabaka.org/favicon.ico"
                    alt="Mangabaka"
                    class="w-5 h-5 rounded-sm"
                  />
                </button>
            </div>
          </div>
        </div>

        <FriendsReadingIndicator {friends} onFriendClick={openFriendProfile} />

        {#if detail.description}
          <div class="relative group flex flex-col items-start gap-2">
            <div
              class="relative bg-slate-900/40 p-4 rounded-xl border border-white/5 w-full"
            >
              <p
                bind:this={descriptionBodyEl}
                class="series-description text-slate-400 text-sm font-medium leading-[1.75] transition-all duration-500 {isDescriptionExpanded
                  ? ''
                  : 'line-clamp-4'}"
              >
                {@html getDescriptionHtml()}
              </p>
              {#if isDescriptionOverflowing && !isDescriptionExpanded}
                <div
                  class="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-slate-900/60 to-transparent rounded-b-xl pointer-events-none"
                ></div>
              {/if}
              {#if isDescriptionOverflowing}
                <div class="flex justify-center mt-3">
                  <button
                    onclick={toggleDescriptionExpanded}
                    class="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-200 transition-colors px-2"
                  >
                    {isDescriptionExpanded ? "Read Less" : "Read More"}
                  </button>
                </div>
              {/if}
            </div>
          </div>
        {/if}

        {#if detail.genres}
          <div class="flex flex-wrap gap-2">
            {#each detail.genres as genre}
              <span
                class="px-3 py-1.5 bg-slate-950/50 border border-slate-800/50 rounded-xl text-xs font-medium uppercase tracking-normal text-slate-300 hover:text-white hover:border-blue-500/30 transition-all cursor-default"
              >
                {genre}
              </span>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <!-- Source Selection -->
    <section class="flex flex-col gap-4 mt-6">
      <div class="flex items-center justify-between px-2">
        <h2
          class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide"
        >
          Available Sources
        </h2>
        {#if isScanningSources}
          <div
            class="flex items-center gap-2 text-[10px] font-bold text-blue-400 animate-pulse"
          >
            <div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
            Scanning Grid...
          </div>
        {/if}
      </div>
      <div
        class="flex flex-wrap gap-4 p-6 bg-slate-900/30 rounded-3xl border border-white/5"
      >
        {#each sourceGroups as group}
          {@const resolvedSourceId = resolveSourceId(group.id)}
          {@const groupManualUrl = getManualSourceUrl(group.id)}
          {@const hasManualOverride = Boolean(groupManualUrl)}
          {@const groupMatch = resolvedSourceId
            ? matchedSources[resolvedSourceId]
            : null}
          <div
            class="group/card relative flex flex-col gap-2 p-2 rounded-2xl border transition-all duration-300 {selectedSourceGroupId ===
            group.id
              ? 'bg-blue-600/10 border-blue-500 shadow-lg shadow-blue-500/10'
              : 'bg-slate-900/50 border-slate-700/50 hover:border-slate-500'}"
          >
            <button
              onclick={() => selectSource(group.id, resolvedSourceId)}
              class="group flex flex-col items-center gap-3 p-2"
            >
              <div
                class="w-12 h-12 rounded-xl bg-slate-800 overflow-hidden flex items-center justify-center p-2 {!groupMatch &&
                !scanningByGroup[group.id]
                  ? 'grayscale opacity-30'
                  : ''}"
              >
                {#if group.iconUrl}
                  <img
                    src={group.iconUrl}
                    alt={group.name}
                    class="w-full h-full object-contain"
                  />
                {:else}
                  <span class="text-xl font-black text-slate-500"
                    >{group.name[0]}</span
                  >
                {/if}
              </div>
              <span
                class="text-[11px] font-medium uppercase tracking-normal {selectedSourceGroupId ===
                group.id
                  ? 'text-blue-400'
                  : 'text-slate-500 group-hover:text-slate-300'}"
              >
                {group.name}
              </span>
            </button>
            <button
              onclick={() => openManualUrlDialog(group.id)}
              class="absolute top-2 left-2 p-1.5 rounded-lg text-slate-500/40 hover:text-blue-400 hover:bg-blue-500/10 transition-all opacity-0 group-hover/card:opacity-100 focus:opacity-100"
              title="Set series URL manually"
              aria-label="Set series URL manually"
            >
              <svg
                class="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15.232 5.232l3.536 3.536M9 11l7.232-7.232a2.5 2.5 0 113.536 3.536L12.536 14.536a2 2 0 01-.707.464l-3.536 1.179 1.179-3.536A2 2 0 019 11zM7 17h10"
                />
              </svg>
            </button>

            {#if group.variants.length > 1}
              <select
                value={resolvedSourceId}
                onchange={(e) =>
                  handleSourceLanguageChange(
                    group.id,
                    (e.currentTarget as HTMLSelectElement).value,
                  )}
                class="bg-slate-900 border border-slate-700/50 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-300 focus:outline-none focus:border-blue-500/50 transition-all min-w-[110px] mx-auto"
                title="Language"
              >
                {#each group.variants as variant}
                  <option value={variant.id}>{variant.label}</option>
                {/each}
              </select>
            {/if}

            {#if groupMatch}
              <div
                class="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-[#030712] flex items-center justify-center shadow-lg"
                title="Manga Found"
              >
                <svg
                  class="w-2 h-2 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  ><path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="4"
                    d="M5 13l4 4L19 7"
                  /></svg
                >
              </div>
            {:else if scanningByGroup[group.id]}
              <div
                class="absolute -top-1 -right-1 w-4 h-4 bg-blue-500/50 rounded-full border-2 border-[#030712] animate-pulse"
              ></div>
            {/if}
            {#if hasManualOverride}
              <div
                class="absolute bottom-2 right-2 px-2 py-1 rounded bg-slate-950/80 text-[8px] font-black uppercase tracking-widest text-blue-400/80 backdrop-blur-sm shadow-sm z-10"
                title={groupManualUrl}
              >
                URL
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    {#if selectedSourceId}
      <div
        in:slide={{ duration: hasCachedChaptersForSelectedSource() ? 0 : 140 }}
      >
        <!-- Chapter List Header -->
        <div class="flex items-center justify-between mt-12 px-2">
          <div class="flex items-center gap-4">
            <h2
              class="text-sm font-bold text-slate-400 uppercase tracking-widest"
            >
              Chapters ({chapters.length})
            </h2>
            {#if downloadedChaptersCount > 0}
              <span
                class="inline-flex items-center px-2.5 py-1 rounded-lg border border-emerald-500/55 bg-emerald-500/10 text-[10px] font-black uppercase tracking-wider text-emerald-300"
              >
                {downloadedChaptersCount} Saved
              </span>
            {/if}
            <button
              onclick={selectAll}
              class="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-widest"
            >
              {areAllDownloadableChaptersSelected
                ? "Deselect All"
                : "Select All"}
            </button>
          </div>

          {#if selectedChapters.size > 0}
            <button
              onclick={handleDownload}
              in:scale={{ duration: 120, start: 0.97 }}
              class="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 transition-all active:scale-95"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                ><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                /></svg
              >
              {selectedActionLabel}
              {selectedChapters.size}
              {selectedChapters.size === 1 ? "Chapter" : "Chapters"}
            </button>
          {/if}
        </div>
        {#if downloadableChaptersCount < chapters.length}
          <p
            class="mt-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80"
          >
            {chapters.length - downloadableChaptersCount} chapter(s) are external
            or unavailable and cannot be downloaded from this source.
          </p>
        {/if}

        <!-- Keep empty-state hidden until source transition settles. -->
        {#if isSelectedSourceTransitioning}
          <div class="flex flex-col items-center justify-center py-20">
            <div
              class="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"
            ></div>
            <p
              class="mt-4 text-[10px] font-black text-slate-500 uppercase tracking-widest"
            >
              Bridging source...
            </p>
          </div>
        {:else if chapters.length === 0}
          <div
            class="flex flex-col items-center justify-center py-20 text-center"
          >
            <div
              class="w-10 h-10 rounded-xl border border-slate-700/70 bg-slate-900/40 text-slate-500 flex items-center justify-center"
            >
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.6"
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            </div>
            <p
              class="mt-4 text-[10px] font-black text-slate-400 uppercase tracking-widest"
            >
              No available chapters
            </p>
            <p class="mt-2 text-xs text-slate-500 max-w-xl leading-relaxed">
              This source returned no chapter results for this {getSeriesTypeLabel()}.
            </p>
          </div>
        {:else}
          <!-- Chapters Grid -->
          <div
            class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6"
          >
            {#each paginatedChapters as chapter, pageIndex}
              {@const chapterDownloadable = isChapterDownloadable(chapter)}
              {@const chapterDownloaded = isChapterDownloaded(chapter)}
              <button
                onclick={(event) =>
                  toggleChapterSelection(
                    chapter.source_url,
                    event,
                    (currentPage - 1) * itemsPerPage + pageIndex,
                  )}
                disabled={!chapterDownloadable}
                class="group flex items-center justify-between p-5 bg-slate-900/50 border rounded-2xl transition-all duration-300 {selectedChapters.has(
                  chapter.source_url,
                )
                  ? 'border-blue-500 bg-blue-500/5 shadow-lg shadow-blue-500/5'
                  : chapterDownloadable
                    ? 'border-slate-800 hover:border-slate-600 hover:bg-slate-900 shadow-md'
                    : 'border-slate-800/60 opacity-65 cursor-not-allowed'}"
              >
                <div
                  class="flex-1 min-w-0 flex flex-col items-start gap-1 text-left"
                >
                  <span
                    class="text-sm font-bold {selectedChapters.has(
                      chapter.source_url,
                    )
                      ? 'text-blue-400'
                      : chapterDownloadable
                        ? chapterDownloaded
                          ? 'text-slate-100 group-hover:text-blue-400'
                          : 'text-slate-200 group-hover:text-blue-400'
                        : 'text-slate-400'} transition-colors block text-left leading-snug break-words"
                  >
                    {getChapterDisplayTitle(chapter)}
                  </span>
                  {#if getChapterPosterLabel(chapter)}
                    <span
                      class="text-[10px] font-semibold text-slate-500 tracking-wide group-hover:text-slate-400 transition-colors block text-left leading-snug break-words"
                    >
                      {getChapterPosterLabel(chapter)}
                    </span>
                  {/if}
                  {#if chapter.date_uploaded}
                    <span
                      class="text-[10px] font-black text-slate-600 uppercase tracking-wider group-hover:text-slate-500 transition-colors block text-left"
                    >
                      {chapter.date_uploaded}
                    </span>
                  {/if}
                  {#if chapterDownloaded}
                    <span
                      class="mt-1 inline-flex items-center justify-center w-5 h-5 rounded-md border border-emerald-500/40 bg-slate-950/85 text-emerald-400 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]"
                      title="Downloaded"
                      aria-label="Downloaded"
                    >
                      <svg
                        class="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2.6"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </span>
                  {/if}
                  {#if !chapterDownloadable}
                    <span
                      class="text-[10px] font-black uppercase tracking-wider text-amber-400/90"
                    >
                      {getChapterUnavailableReason(chapter)}
                    </span>
                  {/if}
                </div>

                <div
                  class="w-6 h-6 rounded-lg border flex items-center justify-center transition-all duration-300 {selectedChapters.has(
                    chapter.source_url,
                  )
                    ? 'bg-blue-600 border-blue-600'
                    : chapterDownloadable
                      ? 'border-slate-700 bg-slate-950 group-hover:border-slate-500'
                      : 'border-slate-700/80 bg-slate-950/70'}"
                >
                  {#if selectedChapters.has(chapter.source_url)}
                    <svg
                      class="w-4 h-4 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="3"
                        d="M5 13l4 4L19 7"
                      /></svg
                    >
                  {:else if !chapterDownloadable}
                    <svg
                      class="w-3 h-3 text-amber-400/90"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2.5"
                        d="M6 6l12 12M18 6L6 18"
                      />
                    </svg>
                  {/if}
                </div>
              </button>
            {/each}
          </div>

          <!-- Pagination Controls -->
          {#if totalPages > 1}
            <Pagination
              {currentPage}
              {totalPages}
              onPageChange={handlePageChange}
            />
          {/if}
        {/if}
      </div>
    {/if}

    {#if detail?.id}
      <MangaRecommendations
        mediaId={detail.id}
        {seriesTitleStyle}
        onSelectManga={onSelectMangaHandler ?? (() => {})}
      />
    {/if}
  {/if}

  <TrackingEditorDialog
    open={isTrackingEditorOpen}
    selectedSeries={manga}
    getSeriesTitle={getTrackingSeriesTitle}
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

  <Dialog
    open={isQuickBookmarkRemoveConfirmOpen}
    title="Remove from List?"
    description="This title is already on your AniList and/or MAL list with a status other than Plan to Read. Removing it here will delete that entry. You can check the current list status from the edit option on the cover."
    confirmText="Remove Entry"
    cancelText="Keep Entry"
    variant="danger"
    loading={isQuickBookmarkLoading}
    onConfirm={() => void confirmQuickBookmarkRemoval()}
    onCancel={cancelQuickBookmarkRemoval}
  />

  <Dialog
    open={isManualUrlDialogOpen}
    title={`Manual URL • ${getManualDialogGroupName()}`}
    description="Paste the exact series link from this provider. The override is session-only and applies to all language variants in this provider group."
    confirmText=""
    maxWidth="max-w-xl"
    onConfirm={() => {}}
    onCancel={closeManualUrlDialog}
  >
    <div class="mt-1 space-y-5">
      <div
        class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 md:p-5 space-y-4"
      >
        <label class="space-y-2 block">
          <span
            class="text-[11px] font-black uppercase tracking-widest text-slate-400"
          >
            Series URL
          </span>
          <input
            type="url"
            bind:value={manualUrlInput}
            placeholder={`https://${expectedHostForDialogGroup || "provider.site"}/...`}
            class="w-full rounded-xl border border-slate-700/70 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-blue-500/50 focus:outline-none"
            disabled={manualUrlBusy}
            onkeydown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void submitManualUrlDialog();
            }}
          />
        </label>

        {#if manualUrlError}
          <p
            class="text-xs font-bold uppercase tracking-widest text-amber-400/90"
          >
            {manualUrlError}
          </p>
        {:else if expectedHostForDialogGroup}
          <p class="text-[10px] font-medium text-slate-500">
            Expected host: {expectedHostForDialogGroup}
          </p>
        {/if}
      </div>

      <div class="flex items-center justify-end gap-3 pt-1">
        {#if hasManualUrlForDialogGroup()}
          <button
            onclick={handleForgetManualUrl}
            class="mr-auto px-4 py-2 rounded-lg bg-rose-600/85 text-white text-sm font-semibold hover:bg-rose-500 transition-colors disabled:opacity-60 disabled:cursor-default inline-flex items-center gap-2"
            disabled={manualUrlBusy}
          >
            Forget Link
          </button>
        {/if}
        <button
          onclick={() => closeManualUrlDialog()}
          class="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm font-medium hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-default"
          disabled={manualUrlBusy}
        >
          Cancel
        </button>
        <button
          onclick={() => void submitManualUrlDialog()}
          class="px-4 py-2 rounded-lg bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 transition-colors disabled:opacity-60 disabled:cursor-default inline-flex items-center gap-2"
          disabled={manualUrlBusy}
        >
          {#if manualUrlBusy}
            <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="3"
              ></circle>
              <path
                class="opacity-90"
                fill="currentColor"
                d="M22 12a10 10 0 00-10-10v3a7 7 0 017 7h3z"
              ></path>
            </svg>
          {/if}
          Load Chapters
        </button>
      </div>
    </div>
  </Dialog>
</div>

<style>
  .series-description {
    font-family: Tahoma, "Segoe UI", sans-serif;
  }

  @media (hover: none), (pointer: coarse) {
    :global(.series-cover-edit-button) {
      opacity: 1;
      transform: none;
    }

    :global(.series-cover-edit-gradient) {
      opacity: 1;
    }
  }
</style>
