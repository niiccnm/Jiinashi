import {
  getDownloadLogs,
  getMangaDownloadsForQueue,
} from "../database/database";
import {
  getMangaChapterBySource,
  getMangaSeries,
  getMangaSeriesIdByChapterSourceUrl,
} from "../database/queries/manga";
import type { MangaChapter, MangaSeries } from "../types/manga-types";

export type MangaTaskStatus =
  | "pending"
  | "parsing"
  | "downloading"
  | "zipping"
  | "completed"
  | "failed"
  | "cancelled";

export interface MangaDownloadTask {
  id: number;
  type: "manga";
  url: string;
  source: string;
  title: string;
  cover_url?: string;
  status: MangaTaskStatus;
  progress: {
    current: number;
    total: number;
    percent: number;
  };
  totalImages: number;
  downloadedImages: number;
  bytesDownloaded: number;
  speed?: string;
  preview_data?: string;
  errorMessage?: string;
  error_message?: string;
  outputPath?: string;
  file_path?: string;
  logs: string[];
  series: MangaSeries;
  chapter: MangaChapter;
}

type TaskTitleBuilder = (
  series: Partial<MangaSeries> | null | undefined,
  chapter: Partial<MangaChapter> | null | undefined,
) => string;

export class MangaQueueManager {
  private queue: MangaDownloadTask[] = [];

  getQueue() {
    return this.queue;
  }

  addTask(task: MangaDownloadTask) {
    this.queue.push(task);
  }

  findTask(id: number) {
    return this.queue.find((task) => task.id === id);
  }

  removeTask(id: number) {
    this.queue = this.queue.filter((task) => task.id !== id);
  }

  clearFinished() {
    const removable = new Set<MangaTaskStatus>([
      "completed",
      "failed",
      "cancelled",
    ]);
    const removedIds: number[] = [];
    this.queue = this.queue.filter((task) => {
      if (!removable.has(task.status)) return true;
      removedIds.push(task.id);
      return false;
    });
    return removedIds;
  }

  getNextPendingTask() {
    return this.queue.find((task) => task.status === "pending");
  }

  getLogs(id: number) {
    const inMemoryLogs = this.findTask(id)?.logs;
    if (inMemoryLogs && inMemoryLogs.length > 0) return inMemoryLogs;
    return getDownloadLogs(id);
  }

  restoreFromDatabase(buildTaskTitle: TaskTitleBuilder) {
    const rows = getMangaDownloadsForQueue();
    this.queue = rows
      .map((row) => this.restoreTaskFromHistory(row, buildTaskTitle))
      .filter((task): task is MangaDownloadTask => !!task);
  }

  private restoreTaskFromHistory(
    row: any,
    buildTaskTitle: TaskTitleBuilder,
  ): MangaDownloadTask | null {
    const id = Number(row?.id || 0);
    if (!Number.isFinite(id) || id <= 0) return null;

    const url = String(row?.url || "").trim();
    if (!url) return null;

    const seriesId = getMangaSeriesIdByChapterSourceUrl(url);
    const persistedSeries =
      seriesId && seriesId > 0 ? getMangaSeries(seriesId) : null;
    const persistedChapter =
      seriesId && seriesId > 0 ? getMangaChapterBySource(seriesId, url) : null;

    const parsedTitle = this.parseTaskTitle(String(row?.title || ""));

    const normalizedSeries: MangaSeries = {
      id: persistedSeries?.id,
      source_id: String(
        persistedSeries?.source_id || row?.source || "jiinashi.manga",
      ),
      source_url: String(persistedSeries?.source_url || url),
      anilist_id: persistedSeries?.anilist_id,
      mal_id: persistedSeries?.mal_id,
      title_original: String(persistedSeries?.title_original || parsedTitle.seriesTitle || ""),
      title_romaji: persistedSeries?.title_romaji,
      title_english: persistedSeries?.title_english,
      description: persistedSeries?.description,
      cover_url: persistedSeries?.cover_url || row?.cover_url || undefined,
      cover_local_path: persistedSeries?.cover_local_path,
      author: persistedSeries?.author,
      artist: persistedSeries?.artist,
      status: persistedSeries?.status,
      reading_format: persistedSeries?.reading_format || "manga",
      mal_score: persistedSeries?.mal_score,
      genres: persistedSeries?.genres,
      last_updated: persistedSeries?.last_updated,
    };

    const parsedChapterNumber = Number(parsedTitle.chapterNumber || 0);
    const chapterNumberFromDb = Number(persistedChapter?.chapter_number || 0);
    const chapterNumber =
      Number.isFinite(chapterNumberFromDb) && chapterNumberFromDb > 0
        ? chapterNumberFromDb
        : Number.isFinite(parsedChapterNumber) && parsedChapterNumber > 0
          ? parsedChapterNumber
          : 0;

    const chapterTitle = String(
      persistedChapter?.title || parsedTitle.chapterTitle || "",
    ).trim();

    const normalizedChapter: MangaChapter = {
      id: persistedChapter?.id,
      series_id: persistedChapter?.series_id || persistedSeries?.id,
      chapter_number: chapterNumber,
      volume_number: persistedChapter?.volume_number,
      title: chapterTitle || undefined,
      source_url: url,
      scanlator: persistedChapter?.scanlator,
      date_uploaded: persistedChapter?.date_uploaded,
      is_downloaded: !!persistedChapter?.is_downloaded,
      download_path: persistedChapter?.download_path || row?.file_path || undefined,
      is_read: !!persistedChapter?.is_read,
      current_page: Number(persistedChapter?.current_page || 0),
      page_count: Number(persistedChapter?.page_count || row?.total_images || 0),
      last_read_at: persistedChapter?.last_read_at,
    };

    let status = String(row?.status || "pending").toLowerCase();
    if (["parsing", "downloading", "zipping"].includes(status)) {
      status = "pending";
    }
    if (
      ![
        "pending",
        "parsing",
        "downloading",
        "zipping",
        "completed",
        "failed",
        "cancelled",
      ].includes(status)
    ) {
      status = "pending";
    }

    const totalImages = Number(row?.total_images || 0);
    const downloadedImages = Number(row?.downloaded_images || 0);
    const progressPercent = Number(row?.progress_percent || 0);

    const taskTitle =
      String(row?.title || "").trim() ||
      buildTaskTitle(normalizedSeries, normalizedChapter);

    return {
      id,
      type: "manga",
      url,
      source: String(row?.source || normalizedSeries.source_id || "jiinashi.manga"),
      title: taskTitle,
      cover_url: normalizedSeries.cover_url,
      status: status as MangaTaskStatus,
      progress: {
        current: downloadedImages,
        total: totalImages,
        percent: progressPercent,
      },
      totalImages,
      downloadedImages,
      bytesDownloaded: 0,
      speed: undefined,
      errorMessage: row?.error_message || undefined,
      error_message: row?.error_message || undefined,
      outputPath: row?.file_path || undefined,
      file_path: row?.file_path || undefined,
      logs: [],
      series: normalizedSeries,
      chapter: normalizedChapter,
    };
  }

  private parseTaskTitle(title: string) {
    const normalized = String(title || "").trim();
    if (!normalized) {
      return { seriesTitle: "", chapterNumber: "", chapterTitle: "" };
    }

    const seriesMatch = normalized.match(/^(.*?)\s+-\s+Ch(?:apter)?\.?\s+/i);
    const seriesTitle = String(seriesMatch?.[1] || "").trim();

    const chapterMatch = normalized.match(
      /Ch(?:apter)?\.?\s+([0-9]+(?:\.[0-9]+)?)\s*(?:-\s*(.+))?$/i,
    );
    const chapterNumber = String(chapterMatch?.[1] || "").trim();
    const chapterTitle = String(chapterMatch?.[2] || "").trim();

    return { seriesTitle, chapterNumber, chapterTitle };
  }
}
