<script lang="ts">
  import FriendsReadingIndicator from "../FriendsReadingIndicator.svelte";

  let {
    selectedSeries = null,
    selectedShouldShowUnavailable = false,
    refreshSeriesDetail,
    handleTrackingStatusClick,
    isTrackingStatusLoading = false,
    openSource,
    isOpenSourceDisabled = false,
    openSourceDisabledTitle = "No source link available for this provider",
    openInDownloader,
    isOpenInDownloaderResolving = false,
    openAnilist,
    openMal,
    openMangabaka,
    friends = [],
    openFriendProfile,
    selectedIsDetailLoading = false,
    selectedBannerSrc = "",
    getSeriesTitle,
    getSeriesBannerCacheKey,
    cacheImageFromEvent,
    handleBannerError,
    selectedCoverSrc = "",
    getSeriesCoverCacheKey,
    handleSelectedCoverLoad,
    handleCoverError,
    getSecondarySeriesTitle,
    formatMangaStatus,
    getChapterCountInView,
    selectedProviderLabel = "",
    selectedProviderChapterCount = null,
    selectedYear = null,
    selectedReadingFormatLabel = null,
    selectedTrackingStatusVisible = false,
    visibleUserTrackingStatuses = [],
    formatTrackingListStatus,
    formatTrackingChapterProgress,
    trackingStatusError = "",
    openTrackingEditor = () => {},
    handleContinueClick,
    chapterCards = [],
    isContinueResolving = false,
    selectedDescriptionText = "",
    isDescriptionExpanded = false,
    toggleDescriptionExpanded,
    truncateText,
    selectedGenres = [],
  }: {
    selectedSeries?: any;
    selectedShouldShowUnavailable?: boolean;
    refreshSeriesDetail: (seriesItem: any) => void;
    handleTrackingStatusClick: (seriesItem?: any) => Promise<void>;
    isTrackingStatusLoading?: boolean;
    openSource: (seriesItem: any) => void;
    isOpenSourceDisabled?: boolean;
    openSourceDisabledTitle?: string;
    openInDownloader: (seriesItem?: any) => Promise<void>;
    isOpenInDownloaderResolving?: boolean;
    openAnilist: (seriesItem?: any) => void;
    openMal: (seriesItem?: any) => void;
    openMangabaka: (seriesItem?: any) => void;
    friends?: any[];
    openFriendProfile: (friend: any) => void;
    selectedIsDetailLoading?: boolean;
    selectedBannerSrc?: string;
    getSeriesTitle: (item: any) => string;
    getSeriesBannerCacheKey: (item: any) => string;
    cacheImageFromEvent: (cacheKey: string, event: Event) => void;
    handleBannerError: (event: Event) => void;
    selectedCoverSrc?: string;
    getSeriesCoverCacheKey: (item: any) => string;
    handleSelectedCoverLoad: (cacheKey: string, event: Event) => void;
    handleCoverError: (event: Event) => void;
    getSecondarySeriesTitle: (item: any) => string;
    formatMangaStatus: (status: string) => string;
    getChapterCountInView: (seriesId: number) => number;
    selectedProviderLabel?: string;
    selectedProviderChapterCount?: number | null;
    selectedYear?: number | null;
    selectedReadingFormatLabel?: string | null;
    selectedTrackingStatusVisible?: boolean;
    visibleUserTrackingStatuses?: any[];
    formatTrackingListStatus: (status: string) => string;
    formatTrackingChapterProgress: (status: any) => string;
    trackingStatusError?: string;
    openTrackingEditor?: () => void;
    handleContinueClick: () => Promise<void>;
    chapterCards?: any[];
    isContinueResolving?: boolean;
    selectedDescriptionText?: string;
    isDescriptionExpanded?: boolean;
    toggleDescriptionExpanded: () => void;
    truncateText: (value: string, max?: number) => string;
    selectedGenres?: string[];
  } = $props();

  const chapterCountBadge = $derived.by(() =>
    Number(
      selectedProviderChapterCount ??
        getChapterCountInView(Number(selectedSeries?.id || 0)),
    ),
  );

  const providerLabelBadge = $derived.by(() =>
    String(
      selectedProviderLabel ||
        selectedSeries?.source_id?.replace("jiinashi.", "") ||
        "",
    ).trim(),
  );
</script>

{#if selectedSeries}
  <section
    class="mb-8 rounded-3xl border border-slate-800 overflow-hidden bg-slate-950/70"
  >
    {#if selectedShouldShowUnavailable}
      <div class="p-6 md:p-8">
        <p
          class="text-xs font-black uppercase tracking-widest text-amber-400 mb-2"
        >
          AniList Metadata Unavailable
        </p>
        <p class="text-sm text-slate-300 leading-relaxed">
          This series is linked as manga, but AniList metadata could not be
          resolved yet. Retry metadata sync from AniList before using series
          view.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            onclick={() => refreshSeriesDetail(selectedSeries)}
            class="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-bold uppercase tracking-wider hover:border-blue-500/40 hover:text-white transition-colors"
          >
            Retry AniList Sync
          </button>
          <button
            onclick={() => void handleTrackingStatusClick(selectedSeries)}
            class="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-bold uppercase tracking-wider hover:border-blue-500/40 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-default"
            disabled={isTrackingStatusLoading}
          >
            {isTrackingStatusLoading ? "Syncing Status..." : "Fetch Status"}
          </button>
          <button
            onclick={() => openSource(selectedSeries)}
            class="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-bold uppercase tracking-wider hover:border-blue-500/40 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-default disabled:hover:border-slate-700 disabled:hover:text-slate-200"
            title={isOpenSourceDisabled
              ? openSourceDisabledTitle
              : "Open Source"}
            disabled={isOpenSourceDisabled}
          >
            Open Source
          </button>
          <button
            onclick={() => void openInDownloader(selectedSeries)}
            class="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-bold uppercase tracking-wider hover:border-blue-500/40 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-default"
            disabled={isOpenInDownloaderResolving}
          >
            {isOpenInDownloaderResolving ? "Opening Downloader..." : "Get Chapters"}
          </button>
          <button
            onclick={() => openAnilist(selectedSeries)}
            class="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-bold uppercase tracking-wider hover:border-blue-500/40 hover:text-white transition-colors"
          >
            Open AniList
          </button>
          <button
            onclick={() => openMal(selectedSeries)}
            class="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-bold uppercase tracking-wider hover:border-blue-500/40 hover:text-white transition-colors"
          >
            Open MAL
          </button>
          <button
            onclick={() => openMangabaka(selectedSeries)}
            class="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-bold uppercase tracking-wider hover:border-blue-500/40 hover:text-white transition-colors"
          >
            Open Mangabaka
          </button>
        </div>
        <div class="mt-6 pt-6 border-t border-slate-800">
          <p
            class="text-xs font-black uppercase tracking-widest text-slate-500 mb-2"
          >
            Friends
          </p>
          {#if friends.length > 0}
            <FriendsReadingIndicator
              {friends}
              onFriendClick={openFriendProfile}
            />
          {:else if selectedIsDetailLoading}
            <p class="text-xs text-slate-500 uppercase tracking-wider">
              Loading activity...
            </p>
          {:else}
            <p class="text-xs text-slate-500 uppercase tracking-wider">
              No friends currently reading this title
            </p>
          {/if}
        </div>
      </div>
    {:else}
      <div class="relative w-full overflow-hidden">
        <div class="absolute inset-0 z-0 h-[300px] md:h-[400px]">
          {#if selectedBannerSrc}
            <img
              src={selectedBannerSrc}
              alt={getSeriesTitle(selectedSeries)}
              data-cache-key={getSeriesBannerCacheKey(selectedSeries)}
              class="h-full w-full object-cover"
              style="mask-image: linear-gradient(to bottom, black 0%, rgba(0,0,0,0.4) 60%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 0%, rgba(0,0,0,0.4) 60%, transparent 100%);"
              onload={(e) =>
                cacheImageFromEvent(getSeriesBannerCacheKey(selectedSeries), e)}
              onerror={handleBannerError}
            />
          {:else}
            <div
              class="h-full w-full bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900"
            ></div>
          {/if}
          <div
            class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent"
          ></div>
        </div>

        <div
          class="relative z-10 p-6 md:p-10 flex flex-col md:flex-row gap-8 mt-[60px] md:mt-[100px]"
        >
          <div
            class="shrink-0 w-40 md:w-56 aspect-[3/4.5] rounded-2xl overflow-hidden border-2 border-white/10 bg-slate-800 shadow-2xl transform transition-transform hover:scale-[1.02] duration-500"
          >
            {#if selectedCoverSrc}
              <img
                src={selectedCoverSrc}
                alt={getSeriesTitle(selectedSeries)}
                data-cache-key={getSeriesCoverCacheKey(selectedSeries)}
                class="w-full h-full object-cover"
                onload={(e) =>
                  handleSelectedCoverLoad(
                    getSeriesCoverCacheKey(selectedSeries),
                    e,
                  )}
                onerror={handleCoverError}
              />
            {:else}
              <div
                class="w-full h-full flex items-center justify-center text-slate-500"
              >
                <svg
                  class="w-16 h-16"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1"
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
              </div>
            {/if}
          </div>

          <div class="flex-1 min-w-0 flex flex-col justify-end gap-5">
            <div class="flex flex-col gap-1">
              {#if getSecondarySeriesTitle(selectedSeries)}
                <p
                  class="text-sm md:text-base font-medium text-slate-400/80 tracking-wide line-clamp-1"
                >
                  {getSecondarySeriesTitle(selectedSeries)}
                </p>
              {/if}
              <h2
                class="text-3xl md:text-5xl font-black text-white leading-tight tracking-tight drop-shadow-lg"
              >
                {getSeriesTitle(selectedSeries)}
              </h2>
            </div>

            <div class="flex flex-wrap items-center gap-2.5">
              {#if selectedSeries.status}
                <span
                  class="px-3 py-1.5 rounded-lg bg-orange-500/20 border border-orange-500/30 text-orange-200 text-xs font-bold uppercase tracking-wider shadow-sm"
                >
                  {formatMangaStatus(selectedSeries.status)}
                </span>
              {/if}
              <span
                class="px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-200 text-xs font-bold uppercase tracking-wider shadow-sm"
              >
                {chapterCountBadge} Chapters
              </span>
              {#if selectedSeries.mal_score}
                <span
                  class="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 text-xs font-bold uppercase tracking-wider shadow-sm"
                >
                  {selectedSeries.mal_score}
                </span>
              {/if}
              {#if selectedYear}
                <span
                  class="px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-200 text-xs font-bold uppercase tracking-wider shadow-sm"
                >
                  {selectedYear}
                </span>
              {/if}
              {#if selectedReadingFormatLabel}
                <span
                  class="px-3 py-1.5 rounded-lg bg-fuchsia-500/15 border border-fuchsia-400/25 text-fuchsia-100 text-xs font-bold uppercase tracking-wider shadow-sm"
                >
                  {selectedReadingFormatLabel}
                </span>
              {/if}
              {#if providerLabelBadge}
                <span
                  class="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50 text-slate-300 text-xs font-bold uppercase tracking-wider shadow-sm"
                >
                  {providerLabelBadge}
                </span>
              {/if}
            </div>

            {#if selectedTrackingStatusVisible && visibleUserTrackingStatuses.length > 0}
              <div class="flex flex-wrap items-center gap-3">
                {#each visibleUserTrackingStatuses as trackingStatus (trackingStatus.service)}
                  <div
                    class="group flex items-center gap-3 px-3.5 py-2 rounded-xl bg-slate-900/50 border border-slate-800 hover:border-slate-600 transition-all shadow-sm backdrop-blur-sm"
                  >
                    <div class="relative shrink-0 flex items-center">
                      {#if trackingStatus.service === "anilist"}
                        <img
                          src="https://anilist.co/img/icons/favicon-32x32.png"
                          class="w-4 h-4 rounded-sm opacity-90 group-hover:opacity-100 transition-opacity"
                          alt="AL"
                        />
                      {:else}
                        <img
                          src="https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://myanimelist.net&size=32"
                          class="w-4 h-4 rounded-sm opacity-90 group-hover:opacity-100 transition-opacity"
                          alt="MAL"
                        />
                      {/if}
                    </div>

                    <div class="w-px h-3 bg-slate-800"></div>

                    <div class="flex items-center gap-2">
                      {#if trackingStatus.hasEntry}
                        <span
                          class="text-[10px] font-black uppercase tracking-widest text-blue-300"
                        >
                          {formatTrackingListStatus(trackingStatus.status)}
                        </span>
                        {#if trackingStatus.chaptersRead > 0 || trackingStatus.totalChapters}
                          <span class="text-[10px] font-medium text-slate-700"
                            >|</span
                          >
                          <span
                            class="text-[10px] font-bold tracking-widest text-slate-200 tabular-nums"
                          >
                            {formatTrackingChapterProgress(trackingStatus)}
                          </span>
                        {/if}
                      {:else}
                        <span
                          class="text-[10px] font-bold text-slate-500 uppercase tracking-widest"
                        >
                          Add to List
                        </span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
              {#if trackingStatusError}
                <p
                  class="mt-1 text-[10px] font-bold uppercase tracking-widest text-amber-500/80"
                >
                  {trackingStatusError}
                </p>
              {/if}
            {:else if selectedTrackingStatusVisible && trackingStatusError}
              <p
                class="text-[10px] font-bold uppercase tracking-widest text-amber-500/80"
              >
                {trackingStatusError}
              </p>
            {/if}

            <div class="flex flex-wrap items-center gap-3 mt-2">
              <div
                class="inline-flex items-stretch overflow-hidden rounded-lg shadow-xl ring-1 ring-white/10"
              >
                <button
                  onclick={() => void handleContinueClick()}
                  class="flex items-center gap-2.5 px-6 py-2.5 bg-white hover:bg-slate-200 text-slate-950 transition-all transform hover:scale-[1.02] active:scale-95 font-bold uppercase tracking-wider text-sm disabled:opacity-60 disabled:cursor-default disabled:hover:bg-white disabled:hover:scale-100 disabled:hover:scale-[1]"
                  disabled={chapterCards.length === 0 || isContinueResolving}
                >
                  <svg class="w-5 h-5 fill-current" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Continue
                </button>
                <button
                  onclick={() => void openTrackingEditor()}
                  class="px-3.5 bg-white/95 hover:bg-slate-200 text-slate-950 border-l border-slate-300/70 transition-colors disabled:opacity-60 disabled:cursor-default disabled:hover:bg-white/95"
                  title="Edit tracking status"
                  disabled={isTrackingStatusLoading}
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

              <div class="flex items-center gap-2">
                <button
                  onclick={() => void handleTrackingStatusClick(selectedSeries)}
                  class="flex items-center gap-2 px-3 py-2.5 bg-slate-900/80 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white rounded-lg transition-all disabled:opacity-60 disabled:cursor-default"
                  title="Fetch current tracking status"
                  disabled={isTrackingStatusLoading}
                >
                  {#if isTrackingStatusLoading}
                    <svg
                      class="w-4 h-4 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
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
                        d="M5 5v5h.7m12.6 1.4A8 8 0 005.7 10M5.7 10H10m9 9v-5h-.7m0 0A8 8 0 016.3 14M18.3 14H14"
                      />
                    </svg>
                  {/if}
                  <span
                    class="text-[10px] font-black uppercase tracking-widest"
                  >
                    Status
                  </span>
                </button>
                <button
                  onclick={() => refreshSeriesDetail(selectedSeries)}
                  class="p-2.5 bg-slate-900/80 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white rounded-lg transition-all"
                  title="Refresh Metadata"
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
                      stroke-width="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
                <button
                  onclick={() => openSource(selectedSeries)}
                  class="p-2.5 bg-slate-900/80 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white rounded-lg transition-all disabled:opacity-60 disabled:cursor-default disabled:hover:border-slate-700 disabled:hover:text-slate-300"
                  title={isOpenSourceDisabled
                    ? openSourceDisabledTitle
                    : "Open Source"}
                  disabled={isOpenSourceDisabled}
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
                      stroke-width="2"
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </button>
                <button
                  onclick={() => void openInDownloader(selectedSeries)}
                  class="p-2.5 bg-slate-900/80 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white rounded-lg transition-all disabled:opacity-60 disabled:cursor-default flex items-center justify-center min-w-[42px]"
                  title="Open in Downloader"
                  aria-label="Open in Downloader"
                  disabled={isOpenInDownloaderResolving}
                >
                  {#if isOpenInDownloaderResolving}
                    <svg
                      class="w-4 h-4 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
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
                        d="M12 5v10m0 0l4-4m-4 4l-4-4m-3 8h14"
                      />
                    </svg>
                  {/if}
                </button>
                <button
                  onclick={() => openAnilist(selectedSeries)}
                  class="p-2.5 bg-slate-900/80 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white rounded-lg transition-all flex items-center justify-center min-w-[42px] group"
                  title="AniList"
                >
                  <img
                    src="https://anilist.co/img/icons/favicon-32x32.png"
                    alt="AL"
                    class="w-5 h-5 rounded-sm opacity-80 group-hover:opacity-100 transition-opacity"
                  />
                </button>
                <button
                  onclick={() => openMal(selectedSeries)}
                  class="p-2.5 bg-slate-900/80 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white rounded-lg transition-all flex items-center justify-center min-w-[42px] group"
                  title="MyAnimeList"
                >
                  <img
                    src="https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://myanimelist.net&size=32"
                    alt="Mal"
                    class="w-5 h-5 rounded-sm opacity-80 group-hover:opacity-100 transition-opacity"
                  />
                </button>
                <button
                  onclick={() => openMangabaka(selectedSeries)}
                  class="p-2.5 bg-slate-900/80 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white rounded-lg transition-all flex items-center justify-center min-w-[42px] group"
                  title="Mangabaka"
                >
                  <img
                    src="https://mangabaka.org/favicon.ico"
                    alt="Mangabaka"
                    class="w-5 h-5 rounded-sm opacity-80 group-hover:opacity-100 transition-opacity"
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="px-6 md:px-10 py-8 bg-slate-950/20 border-t border-white/5">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div class="lg:col-span-12 xl:col-span-8 flex flex-col gap-6">
            <div>
              <h3
                class="text-xs font-black uppercase tracking-[0.2em] text-slate-500 mb-4"
              >
                Description
              </h3>
              {#if selectedDescriptionText}
                <div class="relative group">
                  <p
                    class="whitespace-pre-line text-sm md:text-base leading-relaxed text-slate-400 font-medium"
                  >
                    {isDescriptionExpanded
                      ? selectedDescriptionText
                      : truncateText(selectedDescriptionText, 380)}
                  </p>
                  {#if selectedDescriptionText.length > 380}
                    <button
                      class="mt-3 text-[11px] font-black uppercase tracking-widest text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1.5"
                      onclick={toggleDescriptionExpanded}
                    >
                      <span
                        >{isDescriptionExpanded
                          ? "Read Less"
                          : "Read More"}</span
                      >
                      <svg
                        class="w-3 h-3 transition-transform {isDescriptionExpanded
                          ? 'rotate-180'
                          : ''}"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </button>
                  {/if}
                </div>
              {:else}
                <p class="text-sm italic text-slate-600">
                  No description available.
                </p>
              {/if}
            </div>

            {#if selectedGenres.length > 0}
              <div class="flex flex-wrap gap-2">
                {#each selectedGenres as genre}
                  <span
                    class="px-4 py-1.5 bg-slate-900 border border-slate-800 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:border-slate-600 transition-all cursor-default"
                  >
                    {genre}
                  </span>
                {/each}
              </div>
            {/if}
          </div>

          <div class="lg:col-span-12 xl:col-span-4 flex flex-col gap-4">
            <h3
              class="text-xs font-black uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2"
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
                  d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
              Activity
            </h3>
            <div class="bg-slate-900/40 p-5 rounded-2xl border border-white/5">
              {#if friends.length > 0}
                <FriendsReadingIndicator
                  {friends}
                  onFriendClick={openFriendProfile}
                />
              {:else if selectedIsDetailLoading}
                <p
                  class="text-[11px] font-bold text-slate-600 uppercase tracking-widest text-center py-2"
                >
                  Loading activity...
                </p>
              {:else}
                <p
                  class="text-[11px] font-bold text-slate-600 uppercase tracking-widest text-center py-2"
                >
                  No active friends
                </p>
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/if}
  </section>
{/if}
