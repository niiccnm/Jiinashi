import path from "path";
import fs from "fs-extra";
import axios from "axios";
import AdmZip from "adm-zip";
import { app, BrowserWindow, nativeImage } from "electron";
import { convertWebpToJpgAsync, isPathInside } from "./utils";
import { USER_AGENT } from "./network/constants";
import { extensionLoader } from "../extensions/loader";
import {
  getSetting,
  setSetting,
  addDownloadHistory,
  updateDownloadHistory,
  updateDownloadProgress,
  saveDownloadLogs,
  hideFromQueue,
  hideFromMangaQueue,
  pruneTerminalDownloadHistory,
  addItemTypes,
  removeItemTypes,
  bulkSetContentType,
  getItemById,
  getItemByPath,
  getTypeByName,
} from "../database/database";
import {
  upsertMangaSeriesBySource,
  upsertMangaChapterBySource,
  updateMangaSeries,
} from "../database/queries/manga";
import type { MangaChapter, MangaSeries } from "../types/manga-types";
import { MangaQueueManager } from "./manga-queue";
import type { MangaDownloadTask, MangaTaskStatus } from "./manga-queue";
import {
  resolveSeriesTitle,
  normalizeSeriesTitleStyle,
  type SeriesTitleStyle,
} from "../library/manga-linker/title-utils";

interface DownloadedPageResult {
  bytes: number;
  filePath: string;
}

export class MangaDownloader {
  private readonly queueManager = new MangaQueueManager();
  private readonly activeTaskIds = new Set<number>();
  private readonly activeTaskPromises = new Map<number, Promise<void>>();
  private readonly logPrefix = "[MangaDL]";
  private readonly defaultUserAgent = USER_AGENT;
  private speedByTaskId = new Map<
    number,
    { lastAt: number; lastBytes: number }
  >();
  private lastPreviewAtByTask = new Map<number, number>();

  constructor() {
    this.enforceHistoryLimit();
    this.queueManager.restoreFromDatabase((series, chapter) =>
      this.buildTaskTitle(series, chapter),
    );
  }

  start() {
    void this.processQueue();
  }

  reloadFromDatabase() {
    this.enforceHistoryLimit();
    this.queueManager.restoreFromDatabase((series, chapter) =>
      this.buildTaskTitle(series, chapter),
    );
    this.notifyProgress();
    void this.processQueue();
  }

  enqueue(series: MangaSeries, chapter: MangaChapter) {
    const normalizedSeries: MangaSeries = {
      ...series,
      source_id: series.source_id || "jiinashi.manga",
      source_url: series.source_url || chapter.source_url,
      title_original: String(series.title_original || ""),
      reading_format: series.reading_format || "manga",
    };
    const persistedSeriesId = upsertMangaSeriesBySource({
      source_id: normalizedSeries.source_id,
      source_url: normalizedSeries.source_url,
      anilist_id: normalizedSeries.anilist_id,
      mal_id: normalizedSeries.mal_id,
      mangabaka_id: normalizedSeries.mangabaka_id,
      title_original: normalizedSeries.title_original,
      title_romaji: normalizedSeries.title_romaji,
      title_english: normalizedSeries.title_english,
      description: normalizedSeries.description,
      cover_url: normalizedSeries.cover_url,
      cover_local_path: normalizedSeries.cover_local_path,
      author: normalizedSeries.author,
      artist: normalizedSeries.artist,
      status: normalizedSeries.status,
      reading_format: normalizedSeries.reading_format,
      mal_score: normalizedSeries.mal_score,
      genres: normalizedSeries.genres,
      last_updated: normalizedSeries.last_updated,
    });
    normalizedSeries.id = persistedSeriesId;

    const normalizedExistingDownloadPath = this.normalizeExistingDownloadPath(
      chapter?.download_path,
    );
    const isPreviouslyDownloaded = Boolean(
      chapter?.is_downloaded && normalizedExistingDownloadPath,
    );
    const normalizedChapter: MangaChapter = {
      ...chapter,
      is_downloaded: isPreviouslyDownloaded,
      download_path: normalizedExistingDownloadPath || undefined,
    };

    const taskTitle = this.buildTaskTitle(normalizedSeries, normalizedChapter);

    const id = addDownloadHistory({
      url: chapter.source_url,
      title: taskTitle,
      status: "pending",
      source: normalizedSeries.source_id || "jiinashi.manga",
      cover_url: normalizedSeries.cover_url || "",
      content_type: "manga",
    });
    // Keep manga queue independent from doujinshi queue manager.
    hideFromQueue(id);

    const task: MangaDownloadTask = {
      id,
      type: "manga",
      url: chapter.source_url,
      source: normalizedSeries.source_id || "jiinashi.manga",
      title: taskTitle,
      cover_url: normalizedSeries.cover_url,
      status: "pending",
      progress: { current: 0, total: 0, percent: 0 },
      totalImages: 0,
      downloadedImages: 0,
      bytesDownloaded: 0,
      speed: "0 KB/s",
      logs: [],
      series: normalizedSeries,
      chapter: normalizedChapter,
    };

    if (persistedSeriesId) {
      upsertMangaChapterBySource({
        ...normalizedChapter,
        series_id: persistedSeriesId,
        is_downloaded: isPreviouslyDownloaded,
        download_path: normalizedChapter.download_path,
      });
    }

    this.appendTaskLog(task, `Queued: ${taskTitle}`);
    this.queueManager.addTask(task);
    this.notifyProgress();
    void this.processQueue();
  }

  cancelDownload(id: number, notifyUser = true) {
    const task = this.queueManager.findTask(id);
    if (!task) return;
    if (["completed", "failed", "cancelled"].includes(task.status)) return;

    task.status = "cancelled";
    task.errorMessage = "Cancelled by user";
    task.error_message = "Cancelled by user";
    this.appendTaskLog(task, "Cancelled by user");
    updateDownloadHistory(task.id, {
      status: "cancelled",
      error_message: "Cancelled by user",
    });
    saveDownloadLogs(task.id, task.logs);
    this.enforceHistoryLimit();
    if (notifyUser) {
      this.notifyToast(`Cancelled: ${task.title}`, "info");
    }
    this.notifyProgress();
  }

  cancelAll() {
    for (const task of this.queueManager.getQueue()) {
      this.cancelDownload(task.id);
    }
  }

  async cancelDownloadsForPath(targetPath: string) {
    const matchingTasks = this.queueManager.getQueue().filter((task) => {
      if (["completed", "failed", "cancelled"].includes(task.status)) {
        return false;
      }

      const knownOutputPath = String(
        task.outputPath || task.file_path || task.chapter.download_path || "",
      ).trim();
      if (
        knownOutputPath &&
        isPathInside(knownOutputPath, targetPath)
      ) {
        return true;
      }

      const plannedSeriesPath = path.join(
        this.resolveRootPath(),
        this.sanitizePathSegment(
          this.resolveSeriesTitle(task.series),
          "Unknown Series",
        ),
      );
      return isPathInside(plannedSeriesPath, targetPath);
    });

    for (const task of matchingTasks) {
      this.cancelDownload(task.id, false);
    }

    const activePromises = matchingTasks
      .map((task) => this.activeTaskPromises.get(task.id))
      .filter((promise): promise is Promise<void> => Boolean(promise));
    await Promise.allSettled(activePromises);
  }

  retryDownload(id: number) {
    const task = this.queueManager.findTask(id);
    if (!task) return;
    if (!["failed", "cancelled"].includes(task.status)) return;

    task.status = "pending";
    task.errorMessage = undefined;
    task.error_message = undefined;
    task.downloadedImages = 0;
    task.totalImages = 0;
    task.bytesDownloaded = 0;
    task.speed = "0 KB/s";
    task.progress = { current: 0, total: 0, percent: 0 };
    this.appendTaskLog(task, "Retry requested");
    updateDownloadHistory(task.id, {
      status: "pending",
      error_message: undefined,
    });
    this.notifyProgress();
    void this.processQueue();
  }

  clearFinished() {
    const removedIds = this.queueManager.clearFinished();
    for (const id of removedIds) {
      hideFromMangaQueue(id);
    }
    this.notifyProgress();
  }

  removeFromQueue(id: number) {
    const task = this.queueManager.findTask(id);
    if (!task) return;

    if (
      ["parsing", "downloading", "zipping", "pending"].includes(task.status)
    ) {
      this.cancelDownload(id);
      return;
    }

    this.queueManager.removeTask(id);
    hideFromMangaQueue(id);
    this.notifyProgress();
  }

  getQueue() {
    return this.queueManager.getQueue().map((task) => {
      const dynamicTitle = this.buildTaskTitle(task.series, task.chapter);
      if (task.title !== dynamicTitle && !dynamicTitle.startsWith("Unknown Series -")) {
        task.title = dynamicTitle;
      }
      const { logs, series, chapter, ...rest } = task;
      return {
        ...rest,
        title: task.title,
        series,
        chapter,
      };
    });
  }

  getTaskLogs(id: number) {
    return this.queueManager.getLogs(id);
  }

  refreshRuntimeSettings() {
    void this.processQueue();
  }

  private async processQueue() {
    const maxConcurrent = this.resolveConcurrentDownloads();
    if (!Number.isFinite(maxConcurrent) || maxConcurrent <= 0) return;

    while (this.activeTaskIds.size < maxConcurrent) {
      const nextTask = this.queueManager
        .getQueue()
        .find(
          (task) =>
            task.status === "pending" && !this.activeTaskIds.has(task.id),
        );
      if (!nextTask) {
        return;
      }

      this.activeTaskIds.add(nextTask.id);
      const activePromise = this.downloadChapter(nextTask).finally(() => {
        this.activeTaskIds.delete(nextTask.id);
        this.activeTaskPromises.delete(nextTask.id);
        this.notifyProgress();
        void this.processQueue();
      });
      this.activeTaskPromises.set(nextTask.id, activePromise);
      void activePromise;
    }
  }

  private async downloadChapter(task: MangaDownloadTask) {
    const tempDir = path.join(app.getPath("temp"), `jiinashi_manga_${task.id}`);
    await fs.remove(tempDir);

    try {
      task.title = this.buildTaskTitle(task.series, task.chapter);
      this.setStatus(task, "parsing");
      const source = this.resolveSource(task.series.source_id);
      if (!source) {
        throw new Error(`Source not found: ${task.series.source_id}`);
      }

      this.appendTaskLog(task, `Source: ${source.name} (${source.id})`);
      this.appendTaskLog(task, `Chapter URL: ${task.chapter.source_url}`);

      const pages = await source.getChapterPages(task.chapter.source_url);
      if (this.isCancelled(task)) {
        throw new Error("Cancelled by user");
      }
      if (!pages || pages.length === 0) {
        throw new Error("No pages were returned for this chapter");
      }

      task.totalImages = pages.length;
      task.progress.total = pages.length;
      task.progress.current = 0;
      task.progress.percent = 0;
      task.downloadedImages = 0;
      task.bytesDownloaded = 0;
      task.speed = "0 KB/s";
      this.speedByTaskId.set(task.id, {
        lastAt: Date.now(),
        lastBytes: 0,
      });

      this.appendTaskLog(task, `Resolved ${pages.length} pages`);
      this.setStatus(task, "downloading");

      const rootPath = this.resolveRootPath();
      const seriesFolderName = this.sanitizePathSegment(
        this.resolveSeriesTitle(task.series),
        "Unknown Series",
      );
      const chapterName = this.sanitizePathSegment(
        this.buildDownloadChapterFilenameTitle(
          task.series,
          task.chapter,
          task.series.source_id,
          source.name,
        ),
        "Chapter",
      );
      const seriesDir = path.join(rootPath, seriesFolderName);
      const reusableDownloadPath = this.normalizeExistingDownloadPath(
        task.chapter.download_path,
      );
      const shouldOverwriteExistingFile = Boolean(
        task.chapter.is_downloaded && reusableDownloadPath,
      );
      const outputPath = shouldOverwriteExistingFile
        ? reusableDownloadPath
        : this.getUniqueOutputPath(path.join(seriesDir, `${chapterName}.cbz`));
      task.outputPath = outputPath;
      task.file_path = outputPath;

      this.appendTaskLog(task, `Root: ${rootPath}`);
      this.appendTaskLog(task, `Output: ${outputPath}`);
      if (shouldOverwriteExistingFile) {
        this.appendTaskLog(
          task,
          "Mode: redownload (replacing previously downloaded file)",
        );
      }

      await fs.ensureDir(tempDir);
      const delayMs = this.resolveDownloadDelayMs();

      for (let index = 0; index < pages.length; index++) {
        if (this.isCancelled(task)) {
          throw new Error("Cancelled by user");
        }

        const page = pages[index];
        const pageName = (index + 1).toString().padStart(3, "0");
        const requestHeaders: Record<string, string> = {
          Referer: task.chapter.source_url || source.baseUrl,
          ...(page.headers || {}),
        };
        const result = await this.downloadFile(
          page.url,
          tempDir,
          pageName,
          requestHeaders,
          page.xor_key,
          task.series.source_id || task.source,
        );

        task.downloadedImages += 1;
        task.progress.current = task.downloadedImages;
        task.progress.percent = Math.round(
          (task.progress.current / task.progress.total) * 100,
        );
        task.bytesDownloaded += result.bytes;
        this.updateSpeed(task);
        this.updatePreview(task, result.filePath);

        if (
          task.downloadedImages % 5 === 0 ||
          task.downloadedImages === task.totalImages
        ) {
          updateDownloadProgress(
            task.id,
            task.downloadedImages,
            task.totalImages,
            task.progress.percent,
          );
        }

        if (
          index === 0 ||
          index === pages.length - 1 ||
          (index + 1) % 10 === 0
        ) {
          this.appendTaskLog(
            task,
            `Page ${index + 1}/${pages.length} downloaded (${this.formatBytes(
              result.bytes,
            )})`,
          );
        }
        this.notifyProgress();

        if (delayMs > 0 && index < pages.length - 1) {
          await this.sleep(delayMs);
        }
      }

      if (this.isCancelled(task)) {
        throw new Error("Cancelled by user");
      }

      this.setStatus(task, "zipping");
      await fs.ensureDir(path.dirname(outputPath));
      if (shouldOverwriteExistingFile && fs.existsSync(outputPath)) {
        await fs.remove(outputPath);
      }
      await this.createCbz(tempDir, outputPath);
      if (this.isCancelled(task)) {
        await fs.remove(outputPath);
        throw new Error("Cancelled by user");
      }
      await fs.remove(tempDir);

      task.status = "completed";
      task.progress.percent = 100;
      task.speed = undefined;
      task.chapter.is_downloaded = true;
      task.chapter.download_path = outputPath;
      this.appendTaskLog(task, `Completed: ${outputPath}`);
      if (task.series.id) {
        upsertMangaChapterBySource({
          ...task.chapter,
          series_id: task.series.id,
          is_downloaded: true,
          download_path: outputPath,
        });
      }
      updateDownloadHistory(task.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
        file_path: outputPath,
        title: task.title,
        source: task.source,
        cover_url: task.cover_url || "",
        error_message: undefined,
        content_type: "manga",
      });
      saveDownloadLogs(task.id, task.logs);
      this.enforceHistoryLimit();

      if (task.series.id) {
        const updates: Partial<MangaSeries> = {
          last_updated: new Date().toISOString(),
        };
        await updateMangaSeries(task.series.id, updates);
      }

      const seriesFolderPath = path.dirname(outputPath);
      const folderContentType =
        task.series.reading_format === "manga"
          ? "Manga"
          : task.series.reading_format === "manhwa" ||
              task.series.reading_format === "manhua"
            ? "Webtoon"
            : undefined;
      this.autoImportRoot(rootPath, seriesFolderPath);
      void this.applyDownloadedSeriesFolderType(
        seriesFolderPath,
        outputPath,
        folderContentType,
      ).catch((error) => {
        this.log(
          `${this.logPrefix} Failed to apply downloaded series type: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      this.notifyToast(`Downloaded ${task.title}`, "success");
      this.notifyProgress();
    } catch (error: any) {
      const message = error?.message || "Unknown download error";
      if (message === "Cancelled by user" || task.status === "cancelled") {
        task.status = "cancelled";
        task.errorMessage = "Cancelled by user";
        task.error_message = "Cancelled by user";
        updateDownloadHistory(task.id, {
          status: "cancelled",
          error_message: "Cancelled by user",
        });
      } else {
        task.status = "failed";
        task.errorMessage = message;
        task.error_message = message;
        this.appendTaskLog(task, `ERROR: ${message}`);
        updateDownloadHistory(task.id, {
          status: "failed",
          error_message: message,
        });
        this.notifyToast(`Manga download failed: ${message}`, "error");
      }
      saveDownloadLogs(task.id, task.logs);
      if (task.status !== "cancelled") {
        this.enforceHistoryLimit();
      }
      this.notifyProgress();
    } finally {
      this.speedByTaskId.delete(task.id);
      this.lastPreviewAtByTask.delete(task.id);
      await fs.remove(tempDir);
    }
  }

  private resolveConcurrentDownloads() {
    const parsed = Number.parseInt(
      String(getSetting("concurrentDownloads") || "2"),
      10,
    );
    if (!Number.isFinite(parsed)) return 2;
    return Math.min(10, Math.max(1, parsed));
  }

  private resolveMaxHistoryItems() {
    const parsed = Number.parseInt(String(getSetting("maxHistoryItems") || "50"), 10);
    if (!Number.isFinite(parsed)) return 50;
    return Math.min(500, Math.max(10, parsed));
  }

  private enforceHistoryLimit() {
    pruneTerminalDownloadHistory(this.resolveMaxHistoryItems());
  }

  private resolveDownloadDelayMs() {
    const parsed = Number.parseInt(
      String(getSetting("downloadDelay") || "500"),
      10,
    );
    if (!Number.isFinite(parsed)) return 500;
    return Math.min(10_000, Math.max(0, parsed));
  }

  private async sleep(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private async downloadFile(
    url: string,
    targetDir: string,
    baseName: string,
    extraHeaders?: Record<string, string>,
    xorKey?: string,
    sourceId?: string,
  ): Promise<DownloadedPageResult> {
    const dataUri = url.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
    if (dataUri) {
      const contentType = dataUri[1].toLowerCase();
      const imageBuffer = Buffer.from(dataUri[2], "base64");
      if (imageBuffer.length === 0) {
        throw new Error("Decoded image data was empty");
      }
      const ext = this.resolveImageExtension("", contentType);
      const filePath = path.join(targetDir, `${baseName}${ext}`);
      await fs.writeFile(filePath, imageBuffer);
      return this.maybeConvertDownloadedImage(
        filePath,
        imageBuffer.length,
        sourceId,
      );
    }

    if (xorKey) {
      this.log(`${this.logPrefix} [xor] ${url}`);
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000,
        validateStatus: (status: number) => status >= 200 && status < 300,
        headers: {
          "User-Agent": this.defaultUserAgent,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          ...extraHeaders,
        },
      });

      const ext = this.resolveImageExtension(
        url,
        response.headers?.["content-type"],
      );
      const filePath = path.join(targetDir, `${baseName}${ext}`);
      const encryptedBuffer = Buffer.from(response.data);
      const imageBuffer = this.decryptXorBuffer(encryptedBuffer, xorKey);
      await fs.writeFile(filePath, imageBuffer);
      return this.maybeConvertDownloadedImage(
        filePath,
        imageBuffer.length,
        sourceId,
      );
    }

    try {
      this.log(`${this.logPrefix} [stream] ${url}`);
      const response = await axios.get(url, {
        responseType: "stream",
        timeout: 30000,
        validateStatus: (status: number) => status >= 200 && status < 300,
        headers: {
          "User-Agent": this.defaultUserAgent,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          ...extraHeaders,
        },
      });

      const ext = this.resolveImageExtension(
        url,
        response.headers?.["content-type"],
      );
      const filePath = path.join(targetDir, `${baseName}${ext}`);
      const writer = fs.createWriteStream(filePath);

      const bytes = await new Promise<number>((resolve, reject) => {
        let downloaded = 0;
        response.data.on("data", (chunk: Buffer | string) => {
          downloaded += Buffer.isBuffer(chunk)
            ? chunk.length
            : Buffer.byteLength(chunk);
        });
        response.data.on("error", reject);
        writer.on("error", reject);
        writer.on("finish", () => resolve(downloaded));
        response.data.pipe(writer);
      });

      return this.maybeConvertDownloadedImage(filePath, bytes, sourceId);
    } catch (streamError) {
      this.log(
        `${this.logPrefix} [stream-fallback] ${url} :: ${
          streamError instanceof Error
            ? streamError.message
            : String(streamError)
        }`,
      );
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000,
        validateStatus: (status: number) => status >= 200 && status < 300,
        headers: {
          "User-Agent": this.defaultUserAgent,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          ...extraHeaders,
        },
      });

      const ext = this.resolveImageExtension(
        url,
        response.headers?.["content-type"],
      );
      const filePath = path.join(targetDir, `${baseName}${ext}`);
      const buffer = Buffer.from(response.data);
      await fs.writeFile(filePath, buffer);
      return this.maybeConvertDownloadedImage(
        filePath,
        buffer.length,
        sourceId,
      );
    }
  }

  private async maybeConvertDownloadedImage(
    filePath: string,
    bytes: number,
    sourceId?: string,
  ): Promise<DownloadedPageResult> {
    if (!this.shouldConvertToJpg(filePath, sourceId)) {
      return { bytes, filePath };
    }

    const convertedPath = await convertWebpToJpgAsync(filePath);
    if (!convertedPath) {
      return { bytes, filePath };
    }

    try {
      const stats = await fs.stat(convertedPath);
      return {
        bytes: Number.isFinite(stats.size) ? stats.size : bytes,
        filePath: convertedPath,
      };
    } catch {
      return { bytes, filePath: convertedPath };
    }
  }

  private shouldConvertToJpg(filePath: string, sourceId?: string) {
    const ext = path.extname(filePath).toLowerCase();
    return ext === ".webp";
  }

  private async createCbz(sourceDir: string, outputPath: string) {
    const zip = new AdmZip();
    zip.addLocalFolder(sourceDir);
    await new Promise<void>((resolve, reject) => {
      zip.writeZip(outputPath, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private setStatus(task: MangaDownloadTask, status: MangaTaskStatus) {
    task.status = status;
    updateDownloadHistory(task.id, { status });
    this.appendTaskLog(task, `Status: ${status}`);
    this.notifyProgress();
  }

  private isCancelled(task: MangaDownloadTask) {
    return task.status === "cancelled";
  }

  private appendTaskLog(task: MangaDownloadTask, message: string) {
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    const line = `[${ts}] ${message}`;
    task.logs.push(line);
    if (task.logs.length > 2000) {
      task.logs = task.logs.slice(-2000);
    }
    this.log(`${this.logPrefix} [task:${task.id}] ${message}`);
  }

  private updatePreview(task: MangaDownloadTask, imagePath: string) {
    try {
      const now = Date.now();
      const last = this.lastPreviewAtByTask.get(task.id) || 0;
      if (now - last < 1500) return;

      const image = nativeImage.createFromPath(imagePath);
      if (image.isEmpty()) return;

      const size = image.getSize();
      if (!size.height || !size.width) return;

      const targetHeight = 300;
      const targetWidth = Math.round(size.width * (targetHeight / size.height));
      task.preview_data = image
        .resize({ height: targetHeight, width: targetWidth })
        .toDataURL();
      this.lastPreviewAtByTask.set(task.id, now);
    } catch {
      // Preview updates are best-effort and should not interrupt download flow.
    }
  }

  private updateSpeed(task: MangaDownloadTask) {
    const existing = this.speedByTaskId.get(task.id);
    if (!existing) {
      this.speedByTaskId.set(task.id, {
        lastAt: Date.now(),
        lastBytes: task.bytesDownloaded,
      });
      return;
    }

    const now = Date.now();
    const elapsed = now - existing.lastAt;
    if (elapsed < 1000) return;

    const deltaBytes = task.bytesDownloaded - existing.lastBytes;
    const bytesPerSecond = (deltaBytes / elapsed) * 1000;
    task.speed = this.formatSpeed(bytesPerSecond);
    this.speedByTaskId.set(task.id, {
      lastAt: now,
      lastBytes: task.bytesDownloaded,
    });
  }

  private autoImportRoot(rootPath: string, scanPath?: string) {
    const normalizedRoot = path.resolve(rootPath);
    const normalizedScanPath = path.resolve(scanPath || rootPath);
    let roots: string[] = [];
    try {
      roots = JSON.parse(getSetting("libraryRoots") || "[]");
      if (!Array.isArray(roots)) roots = [];
    } catch {
      roots = [];
    }
    const resolvedRoots = Array.from(
      new Map(
        roots
          .map((entry) => path.resolve(String(entry)))
          .filter(
            (entry) => typeof entry === "string" && entry.trim().length > 0,
          )
          .map((entry) => [entry.toLowerCase(), entry] as const),
      ).values(),
    );

    const rootKey = normalizedRoot.toLowerCase();
    const hasCoveringRoot = resolvedRoots.some((entry) => {
      const entryKey = entry.toLowerCase();
      return rootKey === entryKey || rootKey.startsWith(entryKey + path.sep);
    });

    let nextRoots = resolvedRoots;
    let addedRoot = false;

    if (!hasCoveringRoot) {
      // If adding a parent root, remove nested children to avoid overlap scans.
      nextRoots = resolvedRoots.filter((entry) => {
        const entryKey = entry.toLowerCase();
        return !entryKey.startsWith(rootKey + path.sep);
      });
      nextRoots.push(normalizedRoot);
      setSetting("libraryRoots", JSON.stringify(nextRoots));
      addedRoot = true;
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      if (addedRoot) {
        window.webContents.send("library:roots-updated", nextRoots);
      }
      window.webContents.send("library:trigger-scan", normalizedScanPath);
    }
  }

  private async applyDownloadedSeriesFolderType(
    seriesFolderPath: string,
    chapterPath: string,
    folderContentType?: "Manga" | "Webtoon",
  ) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const folderItem = getItemByPath(seriesFolderPath);
      const chapterItem = getItemByPath(chapterPath);
      if (folderItem?.type === "folder" && chapterItem) {
        if (folderContentType) {
          const folderType = getTypeByName(folderContentType);
          if (folderType) {
            addItemTypes(folderItem.id, [folderType.id]);
            const oppositeType = getTypeByName(
              folderContentType === "Manga" ? "Webtoon" : "Manga",
            );
            if (oppositeType) {
              removeItemTypes(folderItem.id, [oppositeType.id]);
            }
          } else {
            this.log(
              `${this.logPrefix} Content type not found: ${folderContentType}`,
            );
          }
        }

        const mangaType = getTypeByName("Manga");
        if (
          mangaType &&
          String(chapterItem.content_type || "")
            .trim()
            .toLowerCase() === "manga"
        ) {
          removeItemTypes(chapterItem.id, [mangaType.id]);
          bulkSetContentType([chapterItem.id], null);
        }

        const updatedItems = [folderItem.id, chapterItem.id]
          .map((itemId) => getItemById(itemId))
          .filter((item) => Boolean(item));
        for (const window of BrowserWindow.getAllWindows()) {
          if (window.isDestroyed()) continue;
          for (const updatedItem of updatedItems) {
            window.webContents.send("library:item-updated", updatedItem);
          }
        }
        return;
      }

      await this.sleep(1000);
    }

    this.log(
      `${this.logPrefix} Library import timed out for series folder: ${seriesFolderPath}`,
    );
  }

  private resolveSource(sourceId: string) {
    return extensionLoader.getSource(sourceId);
  }

  private resolveRootPath() {
    const configuredRoot = String(getSetting("downloadPath") || "").trim();
    const baseRoot = configuredRoot
      ? path.resolve(configuredRoot)
      : path.join(app.getPath("documents"), "Jiinashi Downloads");
    return path.join(baseRoot, "Manga");
  }

  private getUniqueOutputPath(initialPath: string) {
    if (!fs.existsSync(initialPath)) return initialPath;

    const dir = path.dirname(initialPath);
    const ext = path.extname(initialPath);
    const base = path.basename(initialPath, ext);
    let index = 1;
    while (true) {
      const candidate = path.join(dir, `${base} (${index})${ext}`);
      if (!fs.existsSync(candidate)) return candidate;
      index += 1;
    }
  }

  private normalizeExistingDownloadPath(value: unknown) {
    const rawPath = String(value || "").trim();
    if (!rawPath) return "";

    const normalizedPath = path.normalize(rawPath);
    if (!path.isAbsolute(normalizedPath)) return "";
    return normalizedPath;
  }

  private decryptXorBuffer(data: Buffer, keyHex: string) {
    const key = this.parseXorKey(keyHex);
    if (!key.length) {
      throw new Error("Empty XOR key for encrypted chapter page");
    }

    const output = Buffer.allocUnsafe(data.length);
    for (let i = 0; i < data.length; i++) {
      output[i] = data[i] ^ key[i % key.length];
    }
    return output;
  }

  private parseXorKey(keyHex: string) {
    const normalized = String(keyHex || "")
      .trim()
      .replace(/^0x/i, "")
      .replace(/\s+/g, "");
    if (
      !normalized ||
      normalized.length % 2 !== 0 ||
      !/^[0-9a-f]+$/i.test(normalized)
    ) {
      throw new Error("Invalid XOR key format in chapter page metadata");
    }
    return Buffer.from(normalized, "hex");
  }

  private sanitizePathSegment(value: string, fallback: string) {
    const cleaned = String(value || "")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim();
    return cleaned || fallback;
  }

  private normalizeChapterSubtitle(rawTitle: string, chapterNumber: number) {
    let normalized = String(rawTitle || "").trim();
    if (!normalized) return "";

    const labelPattern =
      "(?:chapters?|ch\\.?|episodes?|ep\\.?|iterations?|iter\\.?|parts?|acts?|volumes?|vol\\.?|books?|bk\\.?)";
    const genericPrefixPattern = new RegExp(
      `^${labelPattern}\\b\\s*(?:[#:._\\-\\s]*\\d+(?:\\.\\d+)?)?\\s*(?:[-:|._]+\\s*)?`,
      "i",
    );

    for (let index = 0; index < 3; index += 1) {
      const next = normalized
        .replace(genericPrefixPattern, "")
        .replace(/^[-:|._\s]+/, "")
        .trim();
      if (next === normalized) break;
      normalized = next;
    }

    const numericOnly = normalized.replace(/^#/, "").trim();
    const parsed = Number(numericOnly);
    if (
      Number.isFinite(chapterNumber) &&
      Number.isFinite(parsed) &&
      Math.abs(parsed - chapterNumber) < 1e-9
    ) {
      return "";
    }

    return normalized;
  }

  private isStandaloneParentheticalQualifier(value: string) {
    return /^(?:(?:\([^()\r\n]+\)|（[^（）\r\n]+）)\s*)+$/.test(
      String(value || "").trim(),
    );
  }

  private buildChapterTitle(chapter: Partial<MangaChapter> | null | undefined) {
    const rawTitle = String(chapter?.title || "").trim();
    const standaloneVolumeNumber = this.resolveStandaloneVolumeNumber(chapter);
    if (Number.isFinite(standaloneVolumeNumber)) {
      return `Vol. ${this.formatChapterNumber(standaloneVolumeNumber)}`;
    }

    const chapterNumberValue = this.resolveChapterNumberForTask(chapter);
    const chapterNumber = this.formatChapterNumber(chapterNumberValue);
    const chapterSubtitle = this.normalizeChapterSubtitle(
      rawTitle,
      chapterNumberValue,
    );
    if (chapterNumber && chapterSubtitle) {
      const separator = this.isStandaloneParentheticalQualifier(chapterSubtitle)
        ? " "
        : " - ";
      return `Ch. ${chapterNumber}${separator}${chapterSubtitle}`;
    }
    if (chapterNumber) {
      return `Ch. ${chapterNumber}`;
    }
    return chapterSubtitle || rawTitle || "Chapter";
  }

  private resolveStandaloneVolumeNumber(
    chapter: Partial<MangaChapter> | null | undefined,
  ) {
    const rawTitle = String(chapter?.title || "").trim();
    const titleMatch = rawTitle.match(
      /^(?:volume|vol)\b\s*[#:.\-\s]*([0-9]+(?:\.[0-9]+)?)\s*$/i,
    );
    if (!titleMatch) return NaN;

    const direct = Number(chapter?.volume_number);
    if (Number.isFinite(direct) && direct > 0) {
      return direct;
    }

    const parsed = Number.parseFloat(titleMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
  }

  private resolveChapterNumberForTask(
    chapter: Partial<MangaChapter> | null | undefined,
  ) {
    const direct = Number(chapter?.chapter_number);
    if (Number.isFinite(direct) && direct > 0) {
      return direct;
    }

    const title = String(chapter?.title || "");
    const match = title.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!match) return NaN;

    const parsed = Number.parseFloat(match[1]);
    if (!Number.isFinite(parsed) || parsed <= 0) return NaN;
    return parsed;
  }

  private buildDownloadChapterFilenameTitle(
    series: Partial<MangaSeries> | null | undefined,
    chapter: Partial<MangaChapter> | null | undefined,
    sourceId: string | null | undefined,
    sourceName?: string,
  ) {
    const seriesTitle = this.resolveSeriesTitle(series);
    const chapterTitle = this.buildChapterTitle(chapter);
    const siteName = this.resolveDownloadSiteName(sourceId, sourceName);
    const languageTag = this.resolveDownloadLanguageTag(sourceId);
    const chapterTitleWithLanguage = languageTag
      ? `${chapterTitle} (${languageTag})`
      : chapterTitle;
    const scanlator = String(chapter?.scanlator || "")
      .replace(/\[|\]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (scanlator) {
      return `[${siteName}] ${seriesTitle} - ${chapterTitleWithLanguage} [${scanlator}]`;
    }
    return `[${siteName}] ${seriesTitle} - ${chapterTitleWithLanguage}`;
  }

  private resolveDownloadLanguageTag(sourceId: string | null | undefined) {
    const language = String(
      extensionLoader.getSource(String(sourceId || ""))?.lang || "",
    ).toLowerCase();
    if (!language) return "";
    const labels: Record<string, string> = {
      en: "",
      ja: "日本語",
      jp: "日本語",
      ko: "한국어",
      kr: "한국어",
      zh: "中文",
      "zh-hk": "中文（香港）",
      es: "ES",
      "es-la": "ES-LA",
      "es-419": "ES-LA",
      fr: "FR",
      de: "DE",
      it: "IT",
      pt: "PT",
      "pt-br": "PT-BR",
      ru: "RU",
      vi: "VI",
      id: "ID",
      th: "TH",
      any: "",
    };
    return labels[language] || language.toUpperCase();
  }

  private resolveDownloadSiteName(
    sourceId: string | null | undefined,
    sourceName?: string,
  ) {
    const trimmedName = String(
      sourceName || extensionLoader.getSource(String(sourceId || ""))?.name || "",
    ).trim();
    if (trimmedName) {
      return trimmedName.replace(/\s*\([^)]+\)\s*$/g, "").trim();
    }

    const lastSegment = String(sourceId || "").trim().split(".").filter(Boolean).pop();
    return lastSegment || "Unknown Source";
  }

  private resolveSeriesTitleStyle(): SeriesTitleStyle {
    return normalizeSeriesTitleStyle(getSetting("seriesTitleStyle"));
  }

  private resolveSeriesTitle(
    series: Partial<MangaSeries> | null | undefined,
    style: SeriesTitleStyle = this.resolveSeriesTitleStyle(),
  ) {
    return resolveSeriesTitle(series, style, "Unknown Series");
  }

  private buildTaskTitle(
    series: Partial<MangaSeries> | null | undefined,
    chapter: Partial<MangaChapter> | null | undefined,
    style: SeriesTitleStyle = this.resolveSeriesTitleStyle(),
  ) {
    const seriesTitle = this.resolveSeriesTitle(series, style);
    const chapterTitle = this.buildChapterTitle(chapter);
    return `${seriesTitle} - ${chapterTitle}`;
  }

  private formatChapterNumber(value: number) {
    if (!Number.isFinite(value) || value <= 0) return "";
    return String(value).replace(/\.0+$/g, "");
  }

  private resolveImageExtension(url: string, contentType?: unknown) {
    const normalizedType = String(contentType || "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    const contentTypeExtMap: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "image/bmp": ".bmp",
      "image/avif": ".avif",
    };

    if (contentTypeExtMap[normalizedType]) {
      return contentTypeExtMap[normalizedType];
    }

    try {
      const pathname = new URL(url).pathname;
      const ext = path.extname(pathname).toLowerCase();
      if (
        [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"].includes(
          ext,
        )
      ) {
        return ext === ".jpeg" ? ".jpg" : ext;
      }
    } catch {
      // keep default below
    }

    return ".jpg";
  }

  private notifyProgress() {
    const queuePayload = this.getQueue();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("manga:downloader-progress", queuePayload);
      }
    }
  }

  private notifyToast(message: string, type: "success" | "error" | "info") {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("downloader:toast", message, type);
      }
    }
  }

  private formatSpeed(bytesPerSecond: number) {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
      return "0 KB/s";
    }
    return `${this.formatBytes(bytesPerSecond)}/s`;
  }

  private formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
  }

  private log(message: string) {
    console.log(message);
  }
}

export const mangaDownloader = new MangaDownloader();
