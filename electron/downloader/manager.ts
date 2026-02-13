import { BrowserWindow, app, nativeImage } from "electron";
import path from "path";
import { getParser } from "./parsers";
import { fetchWithHiddenWindow } from "./network";
import * as db from "../database/database";
import { DownloadTask } from "./types";
import { Fetcher } from "./fetcher";
import { QueueManager } from "./queue";
import { FileSystemManager } from "./filesystem";
import { registerDownloaderIpc } from "./ipc";
import * as utils from "./utils";

export class DownloaderManager {
  public queue: QueueManager = new QueueManager();
  public fetcher: Fetcher = new Fetcher();
  public filesystem: FileSystemManager = new FileSystemManager();

  private mainWindow: BrowserWindow | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private lastNotifyAt = 0;

  private lastPreviewAtByTask = new Map<number, number>();
  private speedByTaskId = new Map<
    number,
    { lastAt: number; lastBytes: number }
  >();

  constructor(mainWindow: BrowserWindow | null) {
    this.mainWindow = mainWindow;
    this.loadSettings();
    registerDownloaderIpc(this);
    // Restore incomplete tasks from database
    this.queue.restoreFromDatabase();
    // Start processing any restored pending tasks
    this.processQueue();
  }

  removeFromQueue(id: number) {
    this.queue.removeTask(id);
    db.hideFromQueue(id);
    this.notifyUpdate(true);
  }

  // --- Initialization & Settings ---

  private loadSettings() {
    const concurrent = db.getSetting("concurrentDownloads");
    if (concurrent) {
      this.queue.setMaxConcurrent(parseInt(concurrent));
    }
    const delay = db.getSetting("downloadDelay");
    if (delay) {
      this.queue.setDelay(parseInt(delay));
    }
  }

  // --- Public Manager API (Delegates & Orchestration) ---

  async addToQueue(url: string) {
    const normUrl = utils.normalizeUrl(url);
    const parser = getParser(normUrl);
    if (!parser) return;

    const inQueue = this.queue.findTaskByUrl(normUrl);
    if (inQueue) {
      if (inQueue.status === "completed")
        return {
          success: false,
          error: "This item has already been downloaded.",
        };
      if (inQueue.status === "cancelled" || inQueue.status === "failed") {
        await this.retryDownload(inQueue.id);
        return { success: true, id: inQueue.id };
      }
      return {
        success: false,
        error: "This item is already in the download queue.",
      };
    }

    const existing = db.getLatestDownloadHistoryByUrl(normUrl);
    if (existing) {
      if (existing.status === "completed")
        return {
          success: false,
          error: "This item has already been downloaded.",
        };

      if (existing.title && existing.title !== "Fetching metadata...") {
        const outPath = this.filesystem.getOutputPath({
          id: existing.id,
          title: existing.title,
        } as DownloadTask);
        if (this.filesystem.exists(outPath))
          return {
            success: false,
            error: "File already exists: " + path.basename(outPath),
          };
      }

      if (existing.status === "cancelled" || existing.status === "failed") {
        await this.retryDownload(existing.id);
        return { success: true, id: existing.id };
      }

      // Handle "ghost" tasks (e.g. status is pending/parsing in DB but task is missing from memory)
      if (!this.queue.findTask(existing.id)) {
        await this.retryDownload(existing.id);
        return { success: true, id: existing.id };
      }

      return { success: true, id: existing.id };
    }

    const id = db.addDownloadHistory({
      url: normUrl,
      title: "Fetching metadata...",
      status: "parsing",
      source: parser.name,
      cover_url: "",
      artist: "",
      parody: "",
    });

    const task: DownloadTask = {
      id,
      url: normUrl,
      title: "Fetching metadata...",
      source: parser.name,
      status: "parsing",
      progress: { current: 0, total: 0, percent: 0 },
      totalImages: 0,
      downloadedImages: 0,
      logs: [],
    } as any;

    this.queue.addTask(task);
    this.notifyUpdate();
    this.startMetadataParsing(task);

    return { success: true, id };
  }

  cancelDownload(id: number) {
    this.queue.removeActive(id);
    const task = this.queue.findTask(id);
    if (task) {
      task.status = "cancelled";
      task.errorMessage = "Cancelled by user";
      db.updateDownloadHistory(id, {
        status: "cancelled",
        error_message: "Cancelled by user",
      });

      // Save logs on cancellation
      if (task.logs && task.logs.length > 0) {
        db.saveDownloadLogs(task.id, task.logs);
      }

      const tempDir = path.join(app.getPath("temp"), `jiinashi_${task.id}`);
      this.filesystem.cleanup(tempDir);

      this.notifyUpdate(true);
      this.processQueue();
    }
  }

  cancelAll() {
    this.queue.getQueue().forEach((t) => {
      if (
        t.status === "pending" ||
        t.status === "downloading" ||
        t.status === "parsing" ||
        t.status === "verification"
      ) {
        this.cancelDownload(t.id);
      }
    });
  }

  retryAll() {
    this.queue.getQueue().forEach((t) => {
      if (t.status === "failed" || t.status === "cancelled") {
        this.retryDownload(t.id);
      }
    });
    this.notifyUpdate();
  }

  async retryDownload(id: number) {
    let task = this.queue.findTask(id);
    if (!task) {
      task = this.reconstructTaskFromHistory(id);
    }

    if (task) {
      task.status = "parsing";
      task.errorMessage = undefined;
      task.progress = { current: 0, total: 0, percent: 0 };
      task.downloadedImages = 0;

      db.updateDownloadHistory(task.id, {
        status: "parsing",
        error_message: undefined,
      });

      this.startMetadataParsing(task);
      this.notifyUpdate();
      this.processQueue();
    }
  }

  private reconstructTaskFromHistory(id: number): DownloadTask | undefined {
    const item = db.getDownloadHistoryItem(id);
    if (!item) return undefined;
    const task: DownloadTask = {
      id: item.id,
      url: item.url,
      title: item.title,
      source: item.source || "",
      cover_url: item.cover_url || "",
      status: "parsing",
      progress: { current: 0, total: 0, percent: 0 },
      totalImages: 0,
      downloadedImages: 0,
      logs: db.getDownloadLogs(id),
      artist: item.artist || "",
      parody: item.parody || "",
      contentType: item.content_type || "",
    };
    this.queue.addTask(task);
    return task;
  }

  clearFinished() {
    const removedIds = this.queue.clearFinished();
    for (const id of removedIds) {
      db.hideFromQueue(id);
    }
    this.notifyUpdate(true);
  }

  // --- Orchestration ---

  private async startMetadataParsing(task: DownloadTask) {
    // Early disk check if title is already known (from history or retry)
    if (task.title && task.title !== "Fetching metadata...") {
      const outPath = this.filesystem.getOutputPath(task);
      if (this.filesystem.exists(outPath)) {
        const errorMsg = `File already exists: ${path.basename(outPath)}`;
        this.sendToast(errorMsg, "error");
        this.failTask(task, errorMsg);
        return;
      }
    }

    const parser = getParser(task.url);
    if (!parser) {
      this.failTask(task, "No parser found for URL");
      return;
    }

    try {
      // Preliminary check for ExHentai cookies
      if (task.url.includes("exhentai.org")) {
        const hasCookies = db.getSetting("cookies:exhentai") === "true";
        if (!hasCookies) {
          this.appendTaskLog(
            task,
            "ExHentai cookies missing. Prompting for login...",
          );
          task.status = "verification";
          this.notifyUpdate();
          await this.fetcher.openLoginWindow("exhentai");

          // Re-check after window close
          const nowHasCookies = db.getSetting("cookies:exhentai") === "true";
          if (!nowHasCookies) {
            this.appendTaskLog(
              task,
              "ExHentai login check failed. Ensure session (igneous cookie) is active.",
            );
            this.failTask(task, "ExHentai verification failed");
            return;
          }
        }
      }

      this.appendTaskLog(task, `[Parsing] Using parser: ${parser.name}`);
      const meta = await parser.getMetadata(
        task.url,
        undefined,
        undefined,
        () => !this.queue.findTask(task.id),
      );

      const title = meta.title?.trim() || task.title;
      const outPath = this.filesystem.getOutputPath({ ...task, title } as any);

      if (this.filesystem.exists(outPath)) {
        const errorMsg = `File already exists: ${path.basename(outPath)}`;
        this.appendTaskLog(task, `[Parsing] Aborting. ${errorMsg}`);
        this.sendToast(errorMsg, "error");
        this.failTask(task, errorMsg);
        return;
      }

      Object.assign(task, {
        title,
        source: meta.source || parser.name,
        cover_url: meta.coverUrl || "",
        totalImages: meta.pageCount || 0,
        status: "pending",
        artist: meta.artist || "",
        parody: meta.parody || "",
        tags: meta.tags || [],
        contentType: meta.contentType,
        progress: { current: 0, total: meta.pageCount || 0, percent: 0 },
      });

      db.updateDownloadHistory(task.id, {
        title: task.title,
        status: "pending",
        cover_url: task.cover_url,
        artist: task.artist,
        parody: task.parody,
        content_type: task.contentType,
      });

      this.appendTaskLog(
        task,
        `[Parsing] Metadata OK. Artist: ${task.artist}, Tags: ${
          task.tags?.length || 0
        }`,
      );
      this.notifyUpdate();
      this.processQueue();
    } catch (e: any) {
      this.appendTaskLog(task, `[Parsing] Failed: ${e?.message || e}`);
      this.failTask(task, e.message || "Metadata fetch failed");
      this.processQueue();
    }
  }

  private processQueue() {
    // 1. Clear any zombie active tasks (tasks that are active but status isn't downloading/parsing)
    this.queue.getQueue().forEach((t) => {
      if (this.queue.isActive(t.id)) {
        if (
          t.status !== "downloading" &&
          t.status !== "parsing" &&
          t.status !== "verification"
        ) {
          this.queue.removeActive(t.id);
        }
      }
    });

    // 2. Start downloads until we hit MAX_CONCURRENT or run out of pending tasks
    if (this.queue.canStartNewDownload()) {
      const task = this.queue.getNextPendingTask();
      if (task) {
        this.runDownload(task).catch((err) => {
          console.error(`Failed to start download ${task.id}:`, err);
        });

        const delay = this.queue.getDelay();
        if (delay > 0) {
          setTimeout(() => this.processQueue(), delay);
        } else {
          this.processQueue();
        }
      }
    }
  }

  private async runDownload(task: DownloadTask) {
    this.queue.addActive(task.id);
    task.status = "parsing"; // Keep as parsing until image list is resolved
    this.notifyUpdate();

    try {
      let retryCount = 0;
      const maxRetries = 2;

      while (retryCount <= maxRetries) {
        try {
          const startedAt = Date.now();
          this.logHeader(task);
          const parser = getParser(task.url);
          if (!parser) throw new Error("Parser lost");
          this.appendTaskLog(task, `Parser: ${parser.name}`);

          const tempDir = path.join(app.getPath("temp"), `jiinashi_${task.id}`);
          this.filesystem.ensureDir(tempDir);

          // 1. Download Cover (EH/EX only)
          if (task.source === "e-hentai" || task.source === "exhentai") {
            await this.downloadCover(task, tempDir);
          }

          const images = await this.resolveGalleryImages(
            task,
            parser,
            () => !this.queue.isActive(task.id),
          );
          if (!this.queue.isActive(task.id)) return;

          task.status = "downloading";
          task.totalImages = images.length;
          task.progress = { current: 0, total: images.length, percent: 0 };
          this.appendTaskLog(task, `Downloading ${images.length} images...`);
          this.notifyUpdate();

          // 3. Download Loop
          await this.downloadImagesLoop(task, images, tempDir);
          if (!this.queue.isActive(task.id)) return;

          // 4. Finalize
          await this.finalizeDownload(task, tempDir, startedAt);
          return; // Success!
        } catch (e: any) {
          const action = await this.handleDownloadError(
            task,
            e,
            retryCount,
            maxRetries,
          );
          if (action === "fail") return;
          retryCount++;
          this.appendTaskLog(
            task,
            `Retrying download (Attempt ${retryCount}/${maxRetries})...`,
          );
        }
      }
    } finally {
      this.queue.removeActive(task.id);
      this.processQueue();
    }
  }

  private async downloadCover(task: DownloadTask, tempDir: string) {
    if (!task.cover_url || task.source === "nhentai") return;
    try {
      let coverExt = "jpg";
      try {
        const u = new URL(task.cover_url);
        coverExt = path.extname(u.pathname).replace(".", "") || "jpg";
      } catch (e) {
        const cleaned = task.cover_url.split("?")[0];
        coverExt = path.extname(cleaned).replace(".", "") || "jpg";
      }
      const coverPath = path.join(tempDir, `cover.${coverExt}`);
      const referer = task.url.includes("exhentai.org")
        ? "https://exhentai.org/"
        : "https://e-hentai.org/";
      await this.fetcher.downloadImageToFile(task.cover_url, coverPath, {
        Referer: referer,
      });
    } catch (e) {
      console.error("Failed to download cover", e);
    }
  }

  private async resolveGalleryImages(
    task: DownloadTask,
    parser: any,
    checkCancel: () => boolean,
  ): Promise<any[]> {
    const isEhEx =
      task.url.includes("e-hentai.org") || task.url.includes("exhentai.org");

    if (isEhEx) {
      const gidMatch = task.url.match(/\/g\/(\d+)\//);
      const galleryId = gidMatch?.[1];
      if (galleryId) {
        try {
          return await this.getMergedEhHitomiImages(
            task,
            galleryId,
            parser,
            checkCancel,
          );
        } catch (e: any) {
          this.appendTaskLog(
            task,
            `Per-image comparison fallback: ${e?.message || e}`,
          );
        }
      }
    }

    const images = await parser.getImages(task.url, checkCancel);
    if (!images || images.length === 0) {
      throw new Error("No images found. Check authentication/cookies.");
    }
    return images;
  }

  private async getMergedEhHitomiImages(
    task: DownloadTask,
    galleryId: string,
    ehParser: any,
    checkCancel: () => boolean,
  ): Promise<any[]> {
    this.appendTaskLog(task, `Fetching E-Hentai images...`);
    const ehImages = await ehParser.getImages(task.url, checkCancel);
    if (checkCancel()) return [];

    this.appendTaskLog(task, `Fetching Hitomi images for comparison...`);
    const { HitomiParser } = await import("./parsers/hitomi");
    const hitomiParser = new HitomiParser();
    const hitomiUrl = `https://hitomi.la/reader/${galleryId}.html`;
    const hitomiImages = await hitomiParser.getImages(hitomiUrl, checkCancel);
    if (checkCancel()) return [];

    const merged: any[] = [];
    let ehCount = 0;
    let hitomiCount = 0;

    for (let i = 0; i < ehImages.length; i++) {
      if (!this.queue.isActive(task.id)) return []; // Added cancel check
      const ehImg = ehImages[i];
      const hitomiImg = hitomiImages[i];

      if (!hitomiImg) {
        merged.push(ehImg);
        ehCount++;
        continue;
      }

      const ehDim = this.getEffectiveDimension(ehImg);
      const hitomiDim = Math.max(hitomiImg.width || 0, hitomiImg.height || 0);

      // Use Hitomi if quality is same or better (faster)
      if (hitomiDim > 0 && hitomiDim >= ehDim) {
        const img = { ...hitomiImg };
        img.filename = `${(i + 1).toString().padStart(3, "0")}.webp`;
        img.index = i;
        merged.push(img);
        hitomiCount++;
      } else {
        merged.push(ehImg);
        ehCount++;
      }
    }

    this.appendTaskLog(
      task,
      `Merge Result: EH=${ehCount}, Hitomi=${hitomiCount}`,
    );
    return merged;
  }

  private getEffectiveDimension(img: any): number {
    let dim = Math.max(img.width || 0, img.height || 0);
    if (!dim && img.url) {
      const dimMatch =
        img.url.match(/-(\d+)-(\d+)-/) || img.url.match(/(\d{3,5})x(\d{3,5})/);
      if (dimMatch) {
        dim = Math.max(parseInt(dimMatch[1], 10), parseInt(dimMatch[2], 10));
      }
    }
    return dim;
  }

  private async downloadImagesLoop(
    task: DownloadTask,
    images: any[],
    tempDir: string,
  ) {
    task.progress = { current: 0, total: images.length, percent: 0 };
    task.downloadedImages = 0;
    task.bytesDownloaded = 0;
    task.speed = "0 KB/s";
    this.speedByTaskId.set(task.id, { lastAt: Date.now(), lastBytes: 0 });

    const isEhEx =
      task.url.includes("e-hentai.org") || task.url.includes("exhentai.org");
    const poolSize = isEhEx ? 4 : 5;
    this.appendTaskLog(task, `Concurrency: ${poolSize}`);
    const pool = [...images];
    const active = new Set<Promise<void>>();

    const checkCancel = () => !this.queue.isActive(task.id);

    while (pool.length > 0 || active.size > 0) {
      if (checkCancel()) {
        throw new Error("Cancelled by user");
      }

      while (pool.length > 0 && active.size < poolSize) {
        const img = pool.shift();
        if (!img) continue;
        const p = this.downloadSingleImage(
          task,
          img,
          tempDir,
          checkCancel,
          images.length,
        ).finally(() => active.delete(p));
        active.add(p);
      }
      if (active.size > 0) await Promise.race(active);
    }
  }

  private async downloadSingleImage(
    task: DownloadTask,
    img: any,
    tempDir: string,
    checkCancel: () => boolean,
    total: number,
  ) {
    let dest = path.join(tempDir, img.filename);
    const onBytes = (n: number) => {
      task.bytesDownloaded = (task.bytesDownloaded || 0) + n;
      this.updateSpeed(task.id, task.bytesDownloaded);
      this.notifyUpdate();
    };

    const idxStr = (img.index !== undefined ? img.index + 1 : 0)
      .toString()
      .padStart(3, "0");
    const t0 = Date.now();

    try {
      let bytes = 0;
      try {
        bytes = await this.fetcher.downloadImageToFile(
          img.url,
          dest,
          img.headers,
          onBytes,
          checkCancel,
        );
      } catch (e1: any) {
        if (img.fallbackUrl) {
          this.appendTaskLog(
            task,
            `Primary failed, trying fallback: ${img.filename}`,
          );
          bytes = await this.fetcher.downloadImageToFile(
            img.fallbackUrl,
            dest,
            img.headers,
            onBytes,
            checkCancel,
          );
        } else {
          const parser = getParser(task.url);
          if (
            img.pageUrl &&
            parser &&
            typeof (parser as any).refreshImage === "function"
          ) {
            this.appendTaskLog(task, `Refreshing image URL: ${img.filename}`);
            const refreshed = await (parser as any).refreshImage(
              img.pageUrl,
              checkCancel,
            );
            if (refreshed?.url) {
              bytes = await this.fetcher.downloadImageToFile(
                refreshed.url,
                dest,
                refreshed.headers || img.headers,
                onBytes,
                checkCancel,
              );
            } else {
              throw e1;
            }
          } else {
            throw e1;
          }
        }
      }

      const dims = utils.getImageDimsSafe(dest);
      const host = new URL(img.url).host;
      const ext = img.filename.split(".").pop() || "?";
      this.appendTaskLog(
        task,
        `[${idxStr}/${total}] ${img.filename} [${ext}] OK host=${host} size=${utils.formatBytes(bytes)} time=${utils.formatMs(Date.now() - t0)} dim=${dims}`,
      );

      if (
        dest.endsWith(".webp") &&
        (img.url?.includes("gold-usergeneratedcontent") ||
          img.url?.includes("hitomi.la"))
      ) {
        const jpgPath = await utils.convertWebpToJpgAsync(dest);
        if (jpgPath) dest = jpgPath;
      }

      task.downloadedImages++;
      this.updatePreview(task, dest);
      this.updateProgress(task);
      this.notifyUpdate();
    } catch (e: any) {
      this.appendTaskLog(
        task,
        `Failed to download ${img.filename}: ${e.message}`,
      );
      throw e;
    }
  }

  private updatePreview(task: DownloadTask, imgPath: string) {
    try {
      const now = Date.now();
      const last = this.lastPreviewAtByTask.get(task.id) || 0;
      if (now - last < 1500) return;

      const img = nativeImage.createFromPath(imgPath);
      if (!img.isEmpty()) {
        const size = img.getSize();
        const ph = 300;
        const pw = Math.round(size.width * (ph / size.height));
        task.preview_data = img.resize({ height: ph, width: pw }).toDataURL();
        this.lastPreviewAtByTask.set(task.id, now);
      }
    } catch (e) {}
  }

  private async finalizeDownload(
    task: DownloadTask,
    tempDir: string,
    startedAt: number,
  ) {
    task.status = "zipping";
    this.notifyUpdate(true);

    // Tag matching
    const { matched: filteredTags, unmatched: unmatchedTags } =
      this.resolveTags(task);
    if (filteredTags.length > 0) {
      this.appendTaskLog(task, `Matched ${filteredTags.length} local tags.`);
    }

    if (unmatchedTags.length > 0) {
      this.appendTaskLog(task, "Ignored tags (no match):");
      unmatchedTags.forEach((t) => this.appendTaskLog(task, `  - ${t}`));
    }

    const outPath = this.filesystem.getOutputPath(task);
    this.filesystem.ensureDir(path.dirname(outPath));

    await this.filesystem.createCBZ(tempDir, outPath);
    this.filesystem.cleanup(tempDir);

    task.status = "completed";
    task.outputPath = outPath;

    const duration = Date.now() - startedAt;
    this.appendTaskLog(task, `Total time: ${utils.formatMs(duration)}`);
    this.appendTaskLog(task, `Output: ${outPath}`);

    db.updateDownloadHistory(task.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      file_path: outPath,
      artist: task.artist,
      parody: task.parody,
      content_type: task.contentType,
    });

    // Save final logs to database
    if (task.logs && task.logs.length > 0) {
      db.saveDownloadLogs(task.id, task.logs);
    }

    // Auto-import
    this.autoImport(
      path.dirname(outPath),
      outPath,
      filteredTags,
      task.contentType,
    );

    this.notifyUpdate(true);
    this.processQueue();
  }

  // --- Helpers ---

  private updateProgress(task: DownloadTask) {
    if (!task.progress) return;
    task.progress.current = task.downloadedImages;
    task.progress.percent = Math.round(
      (task.progress.current / task.progress.total) * 100,
    );

    // Persist progress periodically to avoid too many writes
    if (
      task.downloadedImages % 5 === 0 ||
      task.downloadedImages === task.totalImages
    ) {
      db.updateDownloadProgress(
        task.id,
        task.downloadedImages,
        task.totalImages,
        task.progress.percent,
      );
    }
  }

  private updateSpeed(taskId: number, bytesDownloaded: number) {
    const now = Date.now();
    const data = this.speedByTaskId.get(taskId);

    if (!data) {
      this.speedByTaskId.set(taskId, {
        lastAt: now,
        lastBytes: bytesDownloaded,
      });
      return;
    }

    const timeDelta = now - data.lastAt;
    if (timeDelta >= 1000) {
      // Update every second
      const bytesDelta = bytesDownloaded - data.lastBytes;
      const bps = (bytesDelta / timeDelta) * 1000;

      const task = this.queue.findTask(taskId);
      if (task) {
        task.speed = utils.formatSpeed(bps);
      }

      this.speedByTaskId.set(taskId, {
        lastAt: now,
        lastBytes: bytesDownloaded,
      });
    }
  }

  private autoImport(
    folder: string,
    cbz?: string,
    tags?: string[],
    type?: string,
  ) {
    const roots: string[] = JSON.parse(db.getSetting("libraryRoots") || "[]");
    if (!roots.includes(folder)) {
      roots.push(folder);
      db.setSetting("libraryRoots", JSON.stringify(roots));
      this.mainWindow?.webContents.send("library:roots-updated", roots);
    }
    this.mainWindow?.webContents.send("library:trigger-scan", folder);

    if (cbz && ((tags && tags.length > 0) || type)) {
      const apply = async () => {
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const item = db.getItemByPath(cbz);
          if (item) {
            if (tags?.length) {
              const ids = tags
                .map((n) => db.getTagByName(n))
                .filter((t) => !!t)
                .map((t) => t!.id);
              if (ids.length) db.addItemTags(item.id, ids);
            }
            if (type) {
              const strict = db.getSetting("strictImport") !== "false"; // Default to true
              if (strict) {
                // strict mode: only use type if it exists
                const existingType = db.getTypeByName(type);
                if (existingType) {
                  db.bulkSetContentType([item.id], existingType.name);
                  db.bulkAddItemTypes([item.id], [existingType.id]);
                }
              } else {
                // lax mode: create if missing
                db.bulkSetContentType([item.id], type);
                const tid = db.ensureContentType(type);
                if (tid) db.bulkAddItemTypes([item.id], [tid]);
              }
            }

            // Refetch and notify frontend to update UI (tags, languages, etc)
            const updatedItem = db.getItemById(item.id);
            if (updatedItem) {
              this.mainWindow?.webContents.send(
                "library:item-updated",
                updatedItem,
              );
            }
            return;
          }
        }
      };
      apply();
    }
  }

  private resolveTags(task: DownloadTask): {
    matched: string[];
    unmatched: string[];
  } {
    if (!task.tags || task.tags.length === 0)
      return { matched: [], unmatched: [] };
    try {
      const localTags = db.getAllTagsWithAliases();
      const matched: string[] = [];
      const unmatched: string[] = [];
      const normalize = (s: string) =>
        s.toLowerCase().replace(/[\_\-\s]+/g, "");

      for (const sTag of task.tags) {
        const cleanSTag = sTag.toLowerCase().trim();
        const parts = cleanSTag.split(":");
        const tagOnly = parts.length > 1 ? parts[1].trim() : parts[0].trim();
        const normSTag = normalize(cleanSTag);
        const normTagOnly = normalize(tagOnly);

        const match = localTags.find((lt) => {
          const ln = lt.name.toLowerCase();
          const nln = normalize(ln);
          const la = (lt.aliases || []).map((a) => a.toLowerCase());
          return (
            ln === cleanSTag ||
            ln === tagOnly ||
            la.includes(cleanSTag) ||
            la.includes(tagOnly) ||
            nln === normSTag ||
            nln === normTagOnly ||
            la.some(
              (a) => normalize(a) === normSTag || normalize(a) === normTagOnly,
            )
          );
        });

        if (match) {
          if (!matched.includes(match.name)) matched.push(match.name);
        } else {
          if (!unmatched.includes(sTag)) unmatched.push(sTag);
        }
      }
      return { matched, unmatched };
    } catch (e) {
      console.error("Tag resolution error:", e);
      return { matched: [], unmatched: [] };
    }
  }

  private appendTaskLog(task: DownloadTask, line: string) {
    const trimmed = (line || "").toString().trim();
    if (!trimmed) return;
    if (!task.logs) task.logs = [];

    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

    const message =
      trimmed.length > 800 ? trimmed.slice(0, 800) + "..." : trimmed;
    task.logs.push(`[${ts}] ${message}`);

    if (task.logs.length > 2000) {
      task.logs = task.logs.slice(-2000);
    }

    this.queue.setLogs(task.id, task.logs);
  }

  private logHeader(task: DownloadTask) {
    this.appendTaskLog(task, "==============================");
    this.appendTaskLog(task, "Jiinashi Downloader - Logs");
    this.appendTaskLog(task, `Version: ${app.getVersion() || "?"}`);
    this.appendTaskLog(task, `Platform: ${process.platform} ${process.arch}`);
    try {
      const locale = Intl.DateTimeFormat().resolvedOptions().locale;
      this.appendTaskLog(task, `Locale: ${locale}`);
    } catch (e) {}
    this.appendTaskLog(task, "==============================");
    this.appendTaskLog(task, `Input URL: ${task.url}`);
  }

  private failTask(task: DownloadTask, reason: string) {
    task.status = "failed";
    task.errorMessage = reason;
    this.appendTaskLog(task, `ERROR: ${reason}`);
    db.updateDownloadHistory(task.id, {
      status: "failed",
      error_message: reason,
    });
    // Save logs on failure
    if (task.logs && task.logs.length > 0) {
      db.saveDownloadLogs(task.id, task.logs);
    }
    this.notifyUpdate(true);
  }

  private async handleDownloadError(
    task: DownloadTask,
    e: any,
    retryCount: number,
    maxRetries: number,
  ): Promise<"retry" | "fail"> {
    const isRetryable = retryCount < maxRetries;
    const msg = e.message || "";

    // Specific Handling for EH/EX
    if (msg.includes("AUTH_REQUIRED")) {
      const siteKey = msg.includes("exhentai") ? "exhentai" : "e-hentai";
      this.appendTaskLog(
        task,
        `Authentication required for ${siteKey}. Opening login window...`,
      );
      task.status = "verification";
      this.notifyUpdate();
      await this.fetcher.openLoginWindow(siteKey);
      return "retry";
    }

    if (
      task.url.includes("exhentai.org") &&
      msg.includes("Auth Required") &&
      isRetryable
    ) {
      this.appendTaskLog(
        task,
        "Verification required (Auth Required). Checking cookies...",
      );
      task.status = "verification";
      this.notifyUpdate();
      await fetchWithHiddenWindow(task.url, "https://exhentai.org/");
      return "retry";
    }

    if (
      isRetryable &&
      (msg.includes("Cloudflare") || e.response?.status === 503)
    ) {
      this.appendTaskLog(task, "Cloudflare/Rate Limit detected. Verifying...");
      task.status = "verification";
      this.notifyUpdate();
      await fetchWithHiddenWindow(task.url);
      return "retry";
    }

    if (msg === "Cancelled by user" || task.status === "cancelled") {
      this.notifyUpdate();
      return "fail";
    }

    console.error("Download failed:", e);
    this.failTask(task, msg);
    return "fail";
  }

  public notifyUpdate(forceLog = false) {
    if (this.mainWindow) {
      this.mainWindow.webContents.send(
        "downloader:queue-update",
        this.queue.getQueue(),
      );
    }
    // Only log every 2 seconds to avoid spam
    if (forceLog || Date.now() - this.lastNotifyAt > 2000) {
      if (forceLog) {
        // console.log("Queue Update:", this.queue.getQueue().length, "items");
      }
      this.lastNotifyAt = Date.now();
    }
  }

  // Exposed for IPC via manager delegates (though IPC should call components directly where possible)
  getQueueForRenderer() {
    return this.queue.getQueue().map(({ logs, ...rest }) => rest);
  }
  getTaskLogs(id: number) {
    return this.queue.getLogs(id);
  }
  async proxyImage(imageUrl: string, source: string) {
    return this.fetcher.proxyImage(imageUrl, source);
  }
  async openLoginWindow(siteKey: string) {
    return this.fetcher.openLoginWindow(siteKey);
  }

  sendToast(message: string, type: "success" | "error" | "info") {
    BrowserWindow.getAllWindows().forEach((w) => {
      try {
        w.webContents.send("downloader:toast", message, type);
      } catch (e) {}
    });
  }
}
