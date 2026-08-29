import { toasts } from "../../../stores/toast";
import { resolveReadingFormatFromMetadata } from "../../../utils/manga";
import {
  normalizeChapterSourceUrl,
  resolveChapterNumberForDownload,
} from "./msv-domain-core";
import { msvApi } from "./msv-runtime";

export function createMsvChapterSlice(ctx: any) {
  async function fetchLocalChapterStates(chapterList: any[]) {
    const sourceUrls = Array.from(
      new Set(
        (chapterList || [])
          .map((chapter) => normalizeChapterSourceUrl(chapter?.source_url))
          .filter(Boolean),
      ),
    );
    if (sourceUrls.length === 0) return {} as Record<string, any>;

    try {
      const states = await msvApi.manga.getChapterLocalStates(sourceUrls);
      if (!states || typeof states !== "object") {
        return {} as Record<string, any>;
      }
      return states as Record<string, any>;
    } catch (error) {
      console.warn("Failed to resolve local chapter states:", error);
      return {} as Record<string, any>;
    }
  }

  async function mergeLocalChapterStates(chapterList: any[]) {
    if (!Array.isArray(chapterList) || chapterList.length === 0) {
      return chapterList;
    }
    const states = await fetchLocalChapterStates(chapterList);
    if (!states || Object.keys(states).length === 0) return chapterList;

    let changed = false;
    const merged = chapterList.map((chapter) => {
      const sourceUrl = normalizeChapterSourceUrl(chapter?.source_url);
      const local = sourceUrl ? states[sourceUrl] : undefined;
      if (!local) return chapter;

      const nextIsDownloaded = Boolean(local?.is_downloaded);
      const nextIsRead =
        local?.is_read === undefined
          ? Boolean(chapter?.is_read)
          : Boolean(local.is_read);
      const parsedCurrentPage = Number(
        local?.current_page === undefined
          ? Number(chapter?.current_page || 0)
          : Number(local.current_page || 0),
      );
      const parsedPageCount = Number(
        local?.page_count === undefined
          ? Number(chapter?.page_count || 0)
          : Number(local.page_count || 0),
      );
      const nextCurrentPage = Number.isFinite(parsedCurrentPage)
        ? parsedCurrentPage
        : Number(chapter?.current_page || 0);
      const nextPageCount = Number.isFinite(parsedPageCount)
        ? parsedPageCount
        : Number(chapter?.page_count || 0);
      const nextDownloadPath = local?.download_path
        ? String(local.download_path)
        : undefined;
      const nextLastReadAt = local?.last_read_at
        ? String(local.last_read_at)
        : chapter?.last_read_at;
      const nextId =
        local?.id !== undefined && local?.id !== null
          ? Number(local.id)
          : chapter?.id;
      const nextSeriesId =
        local?.series_id !== undefined && local?.series_id !== null
          ? Number(local.series_id)
          : chapter?.series_id;

      const chapterChanged =
        nextIsDownloaded !== Boolean(chapter?.is_downloaded) ||
        nextIsRead !== Boolean(chapter?.is_read) ||
        nextCurrentPage !== Number(chapter?.current_page || 0) ||
        nextPageCount !== Number(chapter?.page_count || 0) ||
        nextDownloadPath !== chapter?.download_path ||
        nextLastReadAt !== chapter?.last_read_at ||
        nextId !== chapter?.id ||
        nextSeriesId !== chapter?.series_id;
      if (!chapterChanged) return chapter;
      changed = true;

      return {
        ...chapter,
        id: nextId,
        series_id: nextSeriesId,
        is_downloaded: nextIsDownloaded,
        download_path: nextDownloadPath,
        is_read: nextIsRead,
        current_page: nextCurrentPage,
        page_count: nextPageCount,
        last_read_at: nextLastReadAt,
      };
    });

    return changed ? merged : chapterList;
  }

  async function refreshLocalStatesForSource(
    sourceId: string,
    requestToken: number,
    candidateChapters: any[],
  ) {
    const mergedChapters = await mergeLocalChapterStates(candidateChapters);
    if (!ctx.isMounted || requestToken !== ctx.chapterLoadToken) return;
    if (ctx.selectedSourceId !== sourceId) return;
    if (mergedChapters === candidateChapters) return;

    ctx.chapters = [...mergedChapters];
    const bySource = { ...ctx.chaptersBySource, [sourceId]: [...mergedChapters] };
    ctx.chaptersBySource = bySource;
    ctx.persistSeriesSessionCache();
  }

  function handleDownloaderProgress(queue: any[]) {
    const newlyCompletedChapterUrls = new Set<string>();
    for (const task of queue || []) {
      if (String(task?.status || "").toLowerCase() !== "completed") continue;
      const sourceUrl = normalizeChapterSourceUrl(
        task?.chapter?.source_url || task?.url,
      );
      if (!sourceUrl) continue;
      if (ctx.knownCompletedChapterUrls.has(sourceUrl)) continue;
      ctx.knownCompletedChapterUrls.add(sourceUrl);
      newlyCompletedChapterUrls.add(sourceUrl);
    }

    if (newlyCompletedChapterUrls.size === 0) return;
    const activeSourceId = String(ctx.selectedSourceId || "").trim();
    if (!activeSourceId || ctx.chapters.length === 0) return;

    const hasVisibleCompletedChapter = ctx.chapters.some((chapter: any) =>
      newlyCompletedChapterUrls.has(normalizeChapterSourceUrl(chapter?.source_url)),
    );
    if (!hasVisibleCompletedChapter) return;

    void refreshLocalStatesForSource(activeSourceId, ctx.chapterLoadToken, [
      ...ctx.chapters,
    ]);
  }

  function resetKnownCompletedChapters() {
    ctx.knownCompletedChapterUrls = new Set();
  }

  function clearKnownCompletedChaptersFromQueue(queue: any[]) {
    if (!Array.isArray(queue) || queue.length === 0) {
      resetKnownCompletedChapters();
      return;
    }
    const nextKnown = new Set<string>();
    for (const task of queue) {
      if (String(task?.status || "").toLowerCase() !== "completed") continue;
      const sourceUrl = normalizeChapterSourceUrl(
        task?.chapter?.source_url || task?.url,
      );
      if (!sourceUrl) continue;
      nextKnown.add(sourceUrl);
    }
    ctx.knownCompletedChapterUrls = nextKnown;
  }

  function handlePageChange(page: number) {
    ctx.currentPage = page;
    ctx.persistSeriesSessionCache();
  }

  function clearChapterSelection() {
    ctx.selectedChapters = new Set();
    ctx.lastSelectedChapterIndex = null;
  }

  function toggleChapterSelection(
    chapterUrl: string,
    event?: MouseEvent,
    chapterIndex?: number,
  ) {
    const chapter =
      chapterIndex !== undefined
        ? ctx.chapters[chapterIndex]
        : ctx.chapters.find((c: any) => c.source_url === chapterUrl);
    if (chapter && chapter.is_downloadable === false) {
      return;
    }

    const anchorIndex = ctx.lastSelectedChapterIndex;
    const canRangeSelect =
      event?.shiftKey &&
      anchorIndex !== null &&
      chapterIndex !== undefined &&
      chapterIndex >= 0 &&
      chapterIndex < ctx.chapters.length;

    if (canRangeSelect && anchorIndex !== null && chapterIndex !== undefined) {
      const shouldSelectRange = !ctx.selectedChapters.has(chapterUrl);
      const start = Math.min(anchorIndex, chapterIndex);
      const end = Math.max(anchorIndex, chapterIndex);
      const nextSelection = new Set(ctx.selectedChapters);

      for (let i = start; i <= end; i++) {
        const rangeChapter = ctx.chapters[i];
        if (!rangeChapter || rangeChapter.is_downloadable === false) continue;
        if (shouldSelectRange) {
          nextSelection.add(rangeChapter.source_url);
        } else {
          nextSelection.delete(rangeChapter.source_url);
        }
      }

      ctx.selectedChapters = nextSelection;
      ctx.lastSelectedChapterIndex = chapterIndex;
      return;
    }

    if (ctx.selectedChapters.has(chapterUrl)) {
      ctx.selectedChapters.delete(chapterUrl);
    } else {
      ctx.selectedChapters.add(chapterUrl);
    }
    ctx.selectedChapters = new Set(ctx.selectedChapters);
    if (chapterIndex !== undefined) {
      ctx.lastSelectedChapterIndex = chapterIndex;
    }
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || ctx.selectedChapters.size === 0) return;

    const target = event.target as HTMLElement | null;
    const tagName = target?.tagName?.toLowerCase() || "";
    const isTypingContext =
      target?.isContentEditable ||
      tagName === "input" ||
      tagName === "textarea" ||
      tagName === "select";
    if (isTypingContext) return;

    clearChapterSelection();
    event.preventDefault();
  }

  function selectAll() {
    if (ctx.areAllDownloadableChaptersSelected) {
      clearChapterSelection();
    } else {
      const selectableChapters = ctx.chapters.filter(
        (chapter: any) => chapter.is_downloadable !== false,
      );
      ctx.selectedChapters = new Set(selectableChapters.map((c: any) => c.source_url));
      ctx.lastSelectedChapterIndex = null;
    }
  }

  async function handleDownload() {
    if (ctx.selectedChapters.size === 0 || !ctx.selectedSourceId) return;

    try {
      let didNotifyDownloadQueued = false;
      const chaptersToDownload = [...ctx.selectedDownloadableChapters].sort(
        (left: any, right: any) => {
          const leftChapter = Number(left?.chapter_number);
          const rightChapter = Number(right?.chapter_number);
          const leftHasChapter = Number.isFinite(leftChapter) && leftChapter > 0;
          const rightHasChapter = Number.isFinite(rightChapter) && rightChapter > 0;
          if (leftHasChapter && rightHasChapter && leftChapter !== rightChapter) {
            return leftChapter - rightChapter;
          }

          const leftDate = Date.parse(String(left?.date_uploaded || ""));
          const rightDate = Date.parse(String(right?.date_uploaded || ""));
          const leftHasDate = Number.isFinite(leftDate);
          const rightHasDate = Number.isFinite(rightDate);
          if (leftHasDate && rightHasDate && leftDate !== rightDate) {
            return leftDate - rightDate;
          }

          return 0;
        },
      );
      if (chaptersToDownload.length === 0) {
        toasts.add("No downloadable chapters selected", "info");
        return;
      }
      const matchedManga = ctx.matchedSources[ctx.selectedSourceId];
      if (!matchedManga) {
        toasts.add("Selected source is not mapped to this manga", "error");
        return;
      }

      const stableSeriesSourceUrl = String(
        matchedManga?.source_url ||
          chaptersToDownload[0]?.source_url ||
          matchedManga?.id ||
          "",
      ).trim();
      if (!stableSeriesSourceUrl) {
        toasts.add("Could not resolve a stable series URL for this source", "error");
        return;
      }
      if (String(matchedManga?.source_url || "").trim() !== stableSeriesSourceUrl) {
        ctx.matchedSources = {
          ...ctx.matchedSources,
          [ctx.selectedSourceId]: {
            ...matchedManga,
            source_url: stableSeriesSourceUrl,
          },
        };
      }

      const seriesPayload = {
        source_id: String(ctx.selectedSourceId),
        source_url: stableSeriesSourceUrl,
        title_original: String(ctx.detail?.title?.native || ""),
        title_romaji: ctx.detail?.title?.romaji
          ? String(ctx.detail.title.romaji)
          : undefined,
        title_english: ctx.detail?.title?.english
          ? String(ctx.detail.title.english)
          : matchedManga?.title
            ? String(matchedManga.title)
            : undefined,
        description: ctx.detail?.description ? String(ctx.detail.description) : undefined,
        cover_url: ctx.detail?.coverImage?.extraLarge
          ? String(ctx.detail.coverImage.extraLarge)
          : undefined,
        status: ctx.detail?.status ? String(ctx.detail.status) : undefined,
        mal_score:
          Number.isFinite(Number(ctx.detail?.averageScore || 0)) &&
          Number(ctx.detail?.averageScore || 0) > 0
            ? Number(ctx.detail.averageScore) / 10
            : undefined,
        genres: Array.isArray(ctx.detail?.genres)
          ? ctx.detail.genres.map((genre: any) => String(genre))
          : undefined,
        reading_format:
          resolveReadingFormatFromMetadata(
            ctx.detail?.format || ctx.manga?.format,
            ctx.detail?.countryOfOrigin || ctx.manga?.countryOfOrigin,
            ctx.detail?.reading_format || ctx.manga?.reading_format,
          ) || "manga",
        anilist_id: Number(ctx.detail?.id || 0) || undefined,
        mal_id: Number(ctx.detail?.idMal || 0) || undefined,
        mangabaka_id:
          Number(ctx.detail?.idMangabaka || ctx.manga?.mangabaka_id || 0) || undefined,
      };

      for (const chapter of chaptersToDownload) {
        const chapterPayload = {
          chapter_number: resolveChapterNumberForDownload(chapter),
          volume_number: Number(chapter?.volume_number || 0) || undefined,
          title: chapter?.title ? String(chapter.title) : undefined,
          source_url: String(chapter?.source_url || ""),
          scanlator: chapter?.scanlator ? String(chapter.scanlator) : undefined,
          date_uploaded: chapter?.date_uploaded
            ? String(chapter.date_uploaded)
            : undefined,
          is_downloaded: Boolean(chapter?.is_downloaded),
          is_downloadable:
            chapter?.is_downloadable === undefined
              ? undefined
              : Boolean(chapter.is_downloadable),
          unavailable_reason: chapter?.unavailable_reason
            ? String(chapter.unavailable_reason)
            : undefined,
          is_read: Boolean(chapter?.is_read),
          current_page: Number(chapter?.current_page || 0),
          page_count: Number(chapter?.page_count || 0),
          download_path: chapter?.download_path
            ? String(chapter.download_path)
            : undefined,
        };

        await msvApi.manga.downloadChapter(seriesPayload, chapterPayload);
        if (!didNotifyDownloadQueued) {
          didNotifyDownloadQueued = true;
          ctx.onDownloadQueued?.();
        }
      }
      toasts.add(`Added ${chaptersToDownload.length} chapters to queue`, "success");
      ctx.selectedChapters = new Set();
      ctx.lastSelectedChapterIndex = null;
    } catch (e) {
      console.error("Failed to start download:", e);
      toasts.add("Failed to start download", "error");
    }
  }

  return {
    fetchLocalChapterStates,
    mergeLocalChapterStates,
    refreshLocalStatesForSource,
    handleDownloaderProgress,
    resetKnownCompletedChapters,
    clearKnownCompletedChaptersFromQueue,
    handlePageChange,
    toggleChapterSelection,
    clearChapterSelection,
    handleGlobalKeydown,
    selectAll,
    handleDownload,
  };
}
