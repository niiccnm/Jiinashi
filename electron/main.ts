import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  Menu,
  session,
  globalShortcut,
} from "electron";
import { autoUpdater } from "electron-updater";

import { pathToFileURL } from "url";
import path from "path";
import fs from "fs";
import { initCoverCache } from "./coverExtractor";
import { DownloaderManager } from "./downloader/manager";
import { mangaDownloader } from "./downloader/manga-downloader";
import { extensionLoader } from "./extensions/loader";
import {
  incognitoManager,
  registerIncognitoHandlers,
} from "./tracking/incognito-manager";
import { mangaScanner } from "./scanner/manga-scanner";
import { configureAppRuntime, GHOST_UA } from "./app-runtime";
import { registerAppIpcHandlers } from "./app-ipc";
import {
  createMainWindow,
  loadMainWindow,
  createReaderWindow as buildReaderWindow,
  createDownloadLogsWindow as buildDownloadLogsWindow,
} from "./app-windows";
import { clearReaderArchiveCache } from "./reader-archive";
import { runIntegrityCheck } from "./library/scanner";
import { getSetting, initDatabase } from "./database/database";
import { trackingService } from "./tracking/tracking-service";
import type { ReaderBootstrapOverrides } from "../src/lib/utils/manga";

let downloaderManager: DownloaderManager | null = null;

configureAppRuntime();

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let autoUpdaterInitialized = false;

async function createWindow() {
  session.defaultSession.setUserAgent(GHOST_UA);

  mainWindow = createMainWindow(isDev);
  downloaderManager = new DownloaderManager(mainWindow);

  const missingMediaPathLogs = new Set<string>();

  protocol.handle("media", async (request) => {
    console.log("Media Request:", request.url);
    let filePath: string;
    let coverVersion = "";
    try {
      const parsedUrl = new URL(request.url);
      filePath = decodeURIComponent(parsedUrl.pathname);
      coverVersion = String(parsedUrl.searchParams.get("v") || "");

      if (
        process.platform === "win32" &&
        filePath.startsWith("/") &&
        /^[a-zA-Z]:/.test(filePath.slice(1))
      ) {
        filePath = filePath.slice(1);
      }
      console.log("Processed Path:", filePath);
    } catch (e) {
      console.error("Failed to parse media URL:", request.url, e);
      return new Response("Bad Request", { status: 400 });
    }

    try {
      const url = pathToFileURL(filePath).toString();
      const response = await net.fetch(url);

      if (coverVersion) {
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: {
            ...Object.fromEntries(response.headers.entries()),
            // Versioned media URLs are safe to cache aggressively.
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }

      return response;
    } catch (e) {
      if (!missingMediaPathLogs.has(filePath)) {
        missingMediaPathLogs.add(filePath);
        console.error("Failed to fetch media:", filePath, e);
      }
      return new Response("Not Found", { status: 404 });
    }
  });

  ipcMain.handle("window:toggle-fullscreen", (event, concealExit = false) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (concealExit && win.isFullScreen()) {
        const concealOnResize = () => {
          if (!win.isDestroyed()) win.setOpacity(0);
        };
        win.once("resize", concealOnResize);
        win.once("leave-full-screen", () =>
          win.removeListener("resize", concealOnResize),
        );
      }
      win.setFullScreen(!win.isFullScreen());
    }
  });

  ipcMain.handle("window:resize", (event, width: number, height: number) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized() || win.isFullScreen()) return false;

      win.setContentSize(Math.round(width), Math.round(height), true);
      win.center();
      return true;
    }
    return false;
  });

  ipcMain.on("window:move", (event, x: number, y: number) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isMaximized() && !win.isFullScreen()) {
      win.setPosition(Math.round(x), Math.round(y));
    }
  });

  ipcMain.handle("window:show", (event, concealed = false) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (!concealed) win.setOpacity(1);
      win.show();
    }
  });

  ipcMain.handle("window:reveal", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    try {
      await win.capturePage();
    } finally {
      if (!win.isDestroyed()) win.setOpacity(1);
    }
  });

  initDatabase();
  initAutoUpdater();
  trackingService.initializeClientIds();
  initCoverCache();
  await extensionLoader.init();
  mangaDownloader.start();
  await runIntegrityCheck();

  // Legacy compatibility handlers still consumed by the preload manga bridge.
  ipcMain.handle("manga:scan-for-manga", (_, itemId: number, query: string) => {
    return mangaScanner.searchAnimeList(query);
  });

  ipcMain.handle("manga:search-match", (_, query: string) =>
    mangaScanner.searchAnimeList(query),
  );

  ipcMain.handle(
    "manga:set-as-manga",
    async (_, itemId: number, match: any) => {
      return mangaScanner.setAsManga(itemId, match);
    },
  );

  registerIncognitoHandlers();

  globalShortcut.register("CommandOrControl+Shift+I", () => {
    const newVal = !incognitoManager.getIncognito();
    incognitoManager.setIncognito(newVal);
    if (mainWindow) {
      mainWindow.webContents.send(
        "downloader:toast",
        `Incognito Mode: ${newVal ? "ON" : "OFF"}`,
        "info",
      );
    }
  });

  registerIpcHandlers();

  ipcMain.on("env:is-packaged", (event) => {
    event.returnValue = app.isPackaged;
  });

  loadMainWindow(mainWindow, isDev);
}

function initAutoUpdater() {
  if (!mainWindow || autoUpdaterInitialized) return;
  autoUpdaterInitialized = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const autoCheck = getSetting("autoCheckUpdates");
  if (!autoCheck || autoCheck === "true") {
    setTimeout(() => {
      if (isDev) {
        console.log("[Update] Dev Mode: Simulating startup update check");
        mainWindow?.webContents.send("update:status", {
          status: "available",
          version: "1.2.3-dev-test",
        });
      } else {
        autoUpdater
          .checkForUpdates()
          .catch((err) => console.error("Auto-check failed:", err));
      }
    }, 5000);
  }

  ipcMain.handle("update:test-event", (event, type) => {
    console.log(`[Update] Received test event: ${type}`);
    if (!isDev) return;
    if (!mainWindow) return;

    switch (type) {
      case "available":
        mainWindow.webContents.send("update:status", {
          status: "available",
          version: "1.0.0-test",
        });
        break;
      case "downloading":
        let currentProgress = 0;
        const interval = setInterval(() => {
          currentProgress += 5;
          if (mainWindow) {
            mainWindow.webContents.send("update:status", {
              status: "downloading",
              progress: currentProgress,
            });
          }
          if (currentProgress >= 100) {
            clearInterval(interval);
            if (mainWindow) {
              mainWindow.webContents.send("update:status", {
                status: "downloaded",
                version: "1.0.0-test",
              });
            }
          }
        }, 100);
        break;
      case "not-available":
        mainWindow.webContents.send("update:status", {
          status: "not-available",
        });
        break;
      case "error":
        mainWindow.webContents.send("update:status", {
          status: "error",
          error: "Simulated Error",
        });
        break;
    }
  });

  ipcMain.handle("update:check", () => {
    if (isDev) {
      console.log("[Update] Manual check in Dev Mode: Simulating available");
      mainWindow?.webContents.send("update:status", {
        status: "available",
        version: "1.0.0-manual-test",
      });
      return Promise.resolve();
    }
    return autoUpdater.checkForUpdates();
  });

  ipcMain.handle("update:download", () => {
    if (isDev) {
      console.log("[Update] Manual download in Dev Mode: Starting simulation");
      let progress = 0;
      const interval = setInterval(() => {
        progress += 5;
        mainWindow?.webContents.send("update:status", {
          status: "downloading",
          progress,
        });
        if (progress >= 100) {
          clearInterval(interval);
          mainWindow?.webContents.send("update:status", {
            status: "downloaded",
            version: "1.0.0-manual-test",
          });
        }
      }, 100);
      return Promise.resolve();
    }
    return autoUpdater.downloadUpdate();
  });

  ipcMain.handle("update:install", () => {
    if (isDev) {
      console.log("[Update] Manual install in Dev Mode: Simulation complete");
      dialog.showMessageBox({
        type: "info",
        title: "Update Simulation",
        message:
          "In a real release, the app would restart now to install the update.",
      });
      return;
    }
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on("checking-for-update", () => {
    mainWindow?.webContents.send("update:status", { status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("update:status", {
      status: "available",
      version: info.version,
    });
  });

  autoUpdater.on("update-not-available", () => {
    mainWindow?.webContents.send("update:status", { status: "not-available" });
  });

  autoUpdater.on("error", (err) => {
    let message = err.message;
    if (message.includes("404") && message.includes("github")) {
      message = "Update server unreachable (Repository not found or private)";
    } else if (message.includes("net::ERR_INTERNET_DISCONNECTED")) {
      message = "No internet connection";
    }

    mainWindow?.webContents.send("update:status", {
      status: "error",
      error: message,
    });
  });

  autoUpdater.on("download-progress", (progressObj) => {
    mainWindow?.webContents.send("update:status", {
      status: "downloading",
      progress: progressObj.percent,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    mainWindow?.webContents.send("update:status", {
      status: "downloaded",
      version: info.version,
    });
  });
}

const readerWindows = new Set<BrowserWindow>();
const downloadLogsWindows = new Set<BrowserWindow>();

function createDownloadLogsWindow(taskId: number) {
  const win = buildDownloadLogsWindow(isDev, taskId);
  downloadLogsWindows.add(win);
  win.on("closed", () => {
    downloadLogsWindows.delete(win);
  });
}

function createReaderWindow(
  bookId: number,
  pageIndex?: number,
  options?: ReaderBootstrapOverrides,
) {
  const win = buildReaderWindow(isDev, bookId, pageIndex, options);
  readerWindows.add(win);
  win.on("closed", () => {
    readerWindows.delete(win);
  });
}

// IPC registration is delegated to app-ipc.ts to keep main.ts thin.
function registerIpcHandlers() {
  registerAppIpcHandlers({
    createDownloadLogsWindow,
    createReaderWindow,
    downloaderManager,
    mainWindow,
  });
}

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  clearReaderArchiveCache();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
