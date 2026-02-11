import { DownloadTask } from "./types";
import * as db from "../database/database";

export class QueueManager {
  private queue: DownloadTask[] = [];
  private activeDownloads: Set<number> = new Set();
  private logsByTaskId = new Map<number, string[]>();
  private MAX_CONCURRENT = 3;
  private delay = 500;

  constructor() {}

  getQueue(): DownloadTask[] {
    return this.queue;
  }

  getActiveIds(): Set<number> {
    return this.activeDownloads;
  }

  isActive(id: number): boolean {
    return this.activeDownloads.has(id);
  }

  addActive(id: number) {
    this.activeDownloads.add(id);
  }

  removeActive(id: number) {
    this.activeDownloads.delete(id);
  }

  addTask(task: DownloadTask) {
    this.queue.push(task);
  }

  findTask(id: number): DownloadTask | undefined {
    return this.queue.find((t) => t.id === id);
  }

  findTaskByUrl(url: string): DownloadTask | undefined {
    return this.queue.find((t) => t.url === url);
  }

  // Phase 2 Improvements
  canStartNewDownload(): boolean {
    return this.activeDownloads.size < this.MAX_CONCURRENT;
  }

  getNextPendingTask(): DownloadTask | undefined {
    if (!this.canStartNewDownload()) return undefined;
    return this.queue.find((t) => t.status === "pending");
  }

  setMaxConcurrent(n: number) {
    this.MAX_CONCURRENT = n;
  }

  setDelay(n: number) {
    this.delay = n;
  }

  getDelay(): number {
    return this.delay;
  }

  markForRetry(taskId: number): void {
    const task = this.findTask(taskId);
    if (task) {
      task.status = "pending";
    }
  }

  setQueue(newQueue: DownloadTask[]) {
    this.queue = newQueue;
  }

  removeTask(id: number) {
    this.queue = this.queue.filter((t) => t.id !== id);
    this.activeDownloads.delete(id);
  }

  getLogs(id: number): string[] {
    const memoryLogs = this.logsByTaskId.get(id);
    if (memoryLogs && memoryLogs.length > 0) return memoryLogs;
    return db.getDownloadLogs(id);
  }

  setLogs(id: number, logs: string[]) {
    this.logsByTaskId.set(id, logs);
  }

  restoreFromDatabase() {
    const downloads = db.getDownloadsForQueue();
    this.queue = downloads.map((row) => {
      // Reset interrupted statuses to pending for reprocessing
      let status = row.status;
      if (
        ["downloading", "parsing", "zipping", "verification"].includes(status)
      ) {
        status = "pending";
      }

      return {
        id: row.id,
        url: row.url,
        title: row.title,
        source: row.source,
        cover_url: row.cover_url,
        status: status as any,
        progress: {
          current: row.downloaded_images || 0,
          total: row.total_images || 0,
          percent: row.progress_percent || 0,
        },
        totalImages: row.total_images || 0,
        downloadedImages: row.downloaded_images || 0,
        artist: row.artist,
        parody: row.parody,
        contentType: row.content_type,
        errorMessage: row.error_message,
        file_path: row.file_path,
        logs: [], // Logs will be loaded on demand via getLogs()
      };
    });
  }

  clearFinished() {
    const activeStates = [
      "pending",
      "parsing",
      "downloading",
      "zipping",
      "verification",
    ];

    const toKeep: DownloadTask[] = [];
    const removedIds: number[] = [];

    for (const t of this.queue) {
      if (activeStates.includes(t.status)) {
        toKeep.push(t);
      } else {
        removedIds.push(t.id);
        this.activeDownloads.delete(t.id); // Ensure removed from active set
      }
    }

    this.queue = toKeep;
    return removedIds;
  }
}
