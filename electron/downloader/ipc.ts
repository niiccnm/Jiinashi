import { ipcMain, app, shell } from "electron";
import path from "path";
import { getParser } from "./parsers";
import * as db from "../database/database";
import { extractCover, getCoverAsDataUrl } from "../coverExtractor";
import { DownloaderManager } from "./manager";

export function registerDownloaderIpc(manager: DownloaderManager) {
  ipcMain.handle("downloader:search", async (_, url: string) => {
    const parser = getParser(url);
    if (!parser) throw new Error("Unsupported site");
    const cookies = await manager.fetcher.getCookiesString(url);
    return await parser.getMetadata(url, cookies);
  });

  ipcMain.handle("downloader:start", async (_, url: string) => {
    return await manager.addToQueue(url);
  });

  ipcMain.handle("downloader:cancel", (_, id: number) => {
    manager.cancelDownload(id);
  });

  ipcMain.handle("downloader:get-queue", () => {
    return manager.getQueueForRenderer();
  });

  ipcMain.handle("downloader:get-task-logs", (_, id: number) => {
    return manager.queue.getLogs(id);
  });

  ipcMain.handle("downloader:get-history", () => {
    const limit = parseInt(db.getSetting("maxHistoryItems") || "50");
    return db.getDownloadHistory(limit);
  });

  ipcMain.handle("downloader:login", async (_, siteKey: string) => {
    return manager.fetcher.openLoginWindow(siteKey);
  });

  ipcMain.handle("downloader:clear-history", () => {
    db.clearDownloadHistory();
    return true;
  });

  ipcMain.handle("downloader:clear-finished", () => {
    manager.clearFinished();
    return true;
  });

  ipcMain.handle("downloader:cancel-all", () => {
    manager.cancelAll();
    return true;
  });

  ipcMain.handle("downloader:retry-all", () => {
    manager.retryAll();
    return true;
  });

  ipcMain.handle("downloader:retry", async (_, id: number) => {
    await manager.retryDownload(id);
    return true;
  });

  ipcMain.handle("downloader:remove-history-item", (_, id: number) => {
    db.removeDownloadHistoryItem(id);
    return true;
  });

  ipcMain.handle("downloader:open-folder", () => {
    const folder =
      db.getSetting("downloadPath") ||
      path.join(app.getPath("documents"), "Jiinashi Downloads");

    if (manager.filesystem.exists(folder)) {
      shell.openPath(folder);
    } else {
      manager.filesystem.ensureDir(folder);
      shell.openPath(folder);
    }
    return true;
  });

  ipcMain.handle("downloader:get-local-cover", async (_, filePath: string) => {
    if (!filePath || !manager.filesystem.exists(filePath)) return null;
    try {
      const coverPath = await extractCover(filePath);
      if (coverPath) {
        return getCoverAsDataUrl(coverPath);
      }
    } catch (e) {
      console.error("Failed to get local cover:", e);
    }
    return null;
  });

  ipcMain.handle(
    "downloader:proxy-image",
    async (_, imageUrl: string, source: string) => {
      return await manager.fetcher.proxyImage(imageUrl, source);
    },
  );

  ipcMain.handle("downloader:remove-from-queue", (_, id: number) => {
    manager.removeFromQueue(id);
    return true;
  });
}
