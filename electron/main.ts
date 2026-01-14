import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  shell,
  Menu,
  nativeTheme,
} from "electron";
import { autoUpdater } from "electron-updater";
import { version } from "../package.json";

// Force dark mode
nativeTheme.themeSource = "dark";

// Prevent white flash
app.commandLine.appendSwitch("background-color", "#030712");
app.commandLine.appendSwitch("enable-features", "WebUIDarkMode");
app.commandLine.appendSwitch("force-dark-mode");
if (process.platform === "win32") {
  app.commandLine.appendSwitch(
    "disable-features",
    "CalculateNativeWinOcclusion"
  );
}

// DevTools dark mode workaround (Chromium may still show light mode due to cached preferences)
app.on("browser-window-created", (_, window) => {
  window.webContents.on("devtools-opened", () => {
    nativeTheme.themeSource = "dark";
  });
});

import { pathToFileURL } from "url";
import path from "path";
import fs from "fs";
import StreamZip from "node-stream-zip";
import {
  initCoverCache,
  extractCover,
  extractCoverFromFolder,
  getCoverAsDataUrl,
  clearCoverCache,
} from "./coverExtractor";
import { ArchiveHandler } from "./archives/archive";
import type { IArchiveHandler } from "./archives/archive";

// Archive Cache
interface CachedArchive {
  path: string;
  zip?: any;
  rar?: IArchiveHandler;
  zipImageEntries?: string[];
  rarEntries?: string[];
  lastAccessed: number;
  timer: NodeJS.Timeout;
}

function getImageDimensions(
  buffer: Buffer,
  ext: string
): { width: number; height: number } | null {
  try {
    const e = ext.toLowerCase();

    if (e === ".png") {
      if (buffer.length < 24) return null;
      // PNG signature
      if (
        buffer[0] !== 0x89 ||
        buffer[1] !== 0x50 ||
        buffer[2] !== 0x4e ||
        buffer[3] !== 0x47
      ) {
        return null;
      }
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }

    if (e === ".gif") {
      if (buffer.length < 10) return null;
      if (buffer.toString("ascii", 0, 3) !== "GIF") return null;
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }

    if (e === ".webp") {
      if (buffer.length < 30) return null;
      if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
      if (buffer.toString("ascii", 8, 12) !== "WEBP") return null;

      // VP8X chunk
      let offset = 12;
      while (offset + 8 <= buffer.length) {
        const chunkType = buffer.toString("ascii", offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const chunkData = offset + 8;
        if (chunkType === "VP8X") {
          if (chunkData + 10 > buffer.length) return null;
          const widthMinus1 = buffer.readUIntLE(chunkData + 4, 3);
          const heightMinus1 = buffer.readUIntLE(chunkData + 7, 3);
          const width = widthMinus1 + 1;
          const height = heightMinus1 + 1;
          if (width > 0 && height > 0) return { width, height };
          return null;
        }
        // Padded size
        const padded = chunkSize + (chunkSize % 2);
        offset = chunkData + padded;
      }
      return null;
    }

    if (e === ".jpg" || e === ".jpeg") {
      if (buffer.length < 4) return null;
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
      let i = 2;
      while (i + 1 < buffer.length) {
        if (buffer[i] !== 0xff) {
          i += 1;
          continue;
        }
        // Skip fill
        while (i < buffer.length && buffer[i] === 0xff) i += 1;
        if (i >= buffer.length) break;
        const marker = buffer[i];
        i += 1;

        // Stand-alone markers
        if (marker === 0xd9 || marker === 0xda) break;
        if (i + 1 >= buffer.length) break;
        const len = buffer.readUInt16BE(i);
        if (len < 2) return null;

        const isSOF =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);

        if (isSOF) {
          // SOF layout
          if (i + 7 >= buffer.length) return null;
          const height = buffer.readUInt16BE(i + 3);
          const width = buffer.readUInt16BE(i + 5);
          if (width > 0 && height > 0) return { width, height };
          return null;
        }

        i += len;
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

const ARCHIVE_CACHE_TIMEOUT = 60 * 1000; // 1 minute
const archiveCache = new Map<string, CachedArchive>();

function getCachedArchive(archivePath: string): CachedArchive | null {
  const cached = archiveCache.get(archivePath);
  if (cached) {
    // Reset timer
    clearTimeout(cached.timer);
    cached.timer = setTimeout(
      () => closeCachedArchive(archivePath),
      ARCHIVE_CACHE_TIMEOUT
    );
    cached.lastAccessed = Date.now();
    return cached;
  }
  return null;
}

function cacheArchive(
  archivePath: string,
  zip?: any,
  rar?: IArchiveHandler,
  zipImageEntries?: string[],
  rarEntries?: string[]
) {
  // Close existing
  const existing = archiveCache.get(archivePath);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(
    () => closeCachedArchive(archivePath),
    ARCHIVE_CACHE_TIMEOUT
  );

  archiveCache.set(archivePath, {
    path: archivePath,
    zip,
    rar,
    zipImageEntries,
    rarEntries,
    lastAccessed: Date.now(),
    timer,
  });
}

async function getZipImageEntries(zip: any): Promise<string[]> {
  const entries = await zip.entries();
  return Object.values(entries)
    .filter(
      (e) =>
        /\.(jpg|jpeg|png|gif|webp)$/i.test((e as any).name) &&
        !(e as any).isDirectory
    )
    .map((e) => (e as any).name as string)
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
}

async function closeCachedArchive(archivePath: string) {
  const cached = archiveCache.get(archivePath);
  if (cached) {
    if (cached.zip) {
      await cached.zip.close();
    }
    if (cached.rar) {
      // checks if close exists and is a function before calling
      if (typeof cached.rar.close === "function") {
        cached.rar.close();
      }
    }
    archiveCache.delete(archivePath);
  }
}

function clearArchiveCache() {
  for (const path of archiveCache.keys()) {
    closeCachedArchive(path);
  }
}
// Database

import {
  initDatabase,
  getAllItems,
  addItem,
  getItemByPath,
  getItemById,
  updateItem,
  deleteItem,
  getTagExportData,
  clearAllItems,
  getFavorites,
  getRecent,
  removeFromRecent,
  toggleFavorite,
  updateReadingProgress,
  getSetting,
  setSetting,
  getAllSettings,
  searchItems,
  getAllItemsFlat,
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  addCategoryAliases,
  removeCategoryAlias,
  getCategoryAliases,
  getAllTags,
  searchTags,
  createTag,
  updateTag,
  deleteTag,
  addTagAliases,
  removeTagAlias,
  getTagAliases,
  getAllTagsWithAliases,
  addItemTags,
  removeItemTags,
  getItemTags,
  deleteItemsByRoot,
  getTotalBookCount,
  bulkDeleteItems,
  bulkToggleFavorite,
  bulkSetTags,
  getBulkItemTags,
  getHiddenPages,
  getAllHiddenPages,
  setPageVisibility,
  clearPageVisibility,
  bulkSetContentType,
  // Types
  getAllTypes,
  getAllTypesWithAliases,
  createType,
  updateType,
  deleteType,
  addTypeAliases,
  removeTypeAlias,
  getTypeAliases,
  getItemTypes,
  addItemTypes,
  removeItemTypes,
  bulkAddItemTypes,
  bulkRemoveItemTypes,
} from "./database";
import type { LibraryItem, Tag, Category, ContentType } from "./database";

const LIBRARY_ROOTS_SETTING_KEY = "libraryRoots";

function readLibraryRoots(): string[] {
  const raw = getSetting(LIBRARY_ROOTS_SETTING_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is string => typeof p === "string" && p.trim().length > 0
    );
  } catch {
    return [];
  }
}

function writeLibraryRoots(roots: string[]) {
  setSetting(LIBRARY_ROOTS_SETTING_KEY, JSON.stringify(roots));
}

function rememberLibraryRoot(rootPath: string) {
  const resolved = path.resolve(rootPath);
  const existing = readLibraryRoots();
  const exists = existing.some(
    (p) => path.resolve(p).toLowerCase() === resolved.toLowerCase()
  );

  if (!exists) {
    const newRoots = [...existing, resolved];
    writeLibraryRoots(newRoots);
    if (mainWindow) {
      mainWindow.webContents.send("library:roots-updated", newRoots);
    }
  } else {
    // Ensure UI is in sync
    if (mainWindow) {
      mainWindow.webContents.send("library:roots-updated", existing);
    }
  }
}

function inferLibraryRootsFromDb(): string[] {
  const topLevel = getAllItems(null);
  const roots = new Map<string, string>();
  for (const item of topLevel) {
    const candidate = path.dirname(item.path);
    const resolved = path.resolve(candidate);
    const key = resolved.toLowerCase();
    // ONLY infer roots that actually still exist on disk
    if (!roots.has(key) && fs.existsSync(resolved)) {
      roots.set(key, resolved);
    }
  }
  return Array.from(roots.values());
}

function isValidLibraryPath(targetPath: string): boolean {
  if (!targetPath) return false;
  // Normalize target
  const normalizedTarget = path.resolve(targetPath).toLowerCase();

  // 1. Check against Library Roots
  const roots = readLibraryRoots();
  const isInDataRoot = roots.some((root) => {
    const normalizedRoot = path.resolve(root).toLowerCase();
    // Use startsWith but ensure it's a directory boundary to prevent C:/Lib matching C:/Library2
    return (
      normalizedTarget.startsWith(normalizedRoot + path.sep) ||
      normalizedTarget === normalizedRoot
    );
  });

  if (isInDataRoot) return true;

  // 2. Cover Cache is managed internally and assumed safe; items like Books/Folders MUST be in library roots.

  return false;
}

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: "#030712", // Matches bg-gray-950
    icon: path.join(
      __dirname,
      isDev ? "../public/icon.ico" : "../dist/icon.ico"
    ),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // @ts-ignore
      paintWhenInitiallyHidden: true,
    },
  });

  // DevTools toggle
  // mainWindow.webContents.openDevTools()
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (
      isDev &&
      ((input.control && input.shift && input.key.toLowerCase() === "i") ||
        (!input.control && !input.shift && !input.alt && input.key === "F12"))
    ) {
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Register media protocol for specialized handling of local images
  protocol.handle("media", (request) => {
    // Expected: media:///C:/path
    let filePath: string;
    try {
      const parsedUrl = new URL(request.url);
      filePath = decodeURIComponent(parsedUrl.pathname);

      // On Windows, pathname might start with /C:/, we want C:/
      if (
        process.platform === "win32" &&
        filePath.startsWith("/") &&
        /^[a-zA-Z]:/.test(filePath.slice(1))
      ) {
        filePath = filePath.slice(1);
      }
    } catch (e) {
      // Fallback or error
      console.error("Failed to parse media URL:", request.url, e);
      return new Response("Bad Request", { status: 400 });
    }

    console.log("Media Request:", request.url);
    console.log("Processed Path:", filePath);

    try {
      const url = pathToFileURL(filePath).toString();
      // console.log('Resolved File URL:', url)
      return net.fetch(url);
    } catch (e) {
      console.error("Failed to fetch media:", filePath, e);
      return new Response("Not Found", { status: 404 });
    }
  });

  ipcMain.handle("window:toggle-fullscreen", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.setFullScreen(!win.isFullScreen());
    }
  });

  ipcMain.handle("window:resize", (event, width: number, height: number) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      // Check if maximized or full screen, if so, ignore resize
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

  ipcMain.handle("window:show", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.show();
    }
  });

  initAutoUpdater();

  initDatabase();
  initCoverCache();

  // Register IPC handlers
  registerIpcHandlers();

  ipcMain.on("env:is-packaged", (event) => {
    event.returnValue = app.isPackaged;
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function initAutoUpdater() {
  if (!mainWindow) return;

  // Auto Updater Configuration
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Check for updates on startup if enabled
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
    }, 5000); // 5s to ensure everything is loaded
  }

  // IPC Handlers for Update Management
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
      // Trigger the downloading simulation
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

  // Listener relay from electron-updater to renderer
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

// Store references to reader windows to prevent garbage collection
const readerWindows = new Set<BrowserWindow>();

function createReaderWindow(bookId: number, pageIndex?: number) {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    show: false,
    title: "Reader",
    icon: path.join(
      __dirname,
      isDev ? "../public/icon.ico" : "../dist/icon.ico"
    ),
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // @ts-ignore
      paintWhenInitiallyHidden: true,
    },
  });

  // DevTools toggle
  // win.webContents.openDevTools()
  win.webContents.on("before-input-event", (event, input) => {
    if (
      isDev &&
      ((input.control && input.shift && input.key.toLowerCase() === "i") ||
        (!input.control && !input.shift && !input.alt && input.key === "F12"))
    ) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  const query: any = { view: "reader", bookId: bookId.toString() };
  if (pageIndex !== undefined) {
    query.page = pageIndex.toString();
  }

  // Load view
  if (isDev) {
    const queryStr = new URLSearchParams(query).toString();
    win.loadURL(`http://localhost:5173?${queryStr}`);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"), {
      query: query,
    });
  }

  readerWindows.add(win);

  win.on("enter-full-screen", () => {
    win.webContents.send("window:fullscreen-change", true);
  });
  win.on("leave-full-screen", () => {
    win.webContents.send("window:fullscreen-change", false);
  });

  win.on("closed", () => {
    readerWindows.delete(win);
  });

  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    require("electron").shell.openExternal(url);
    return { action: "deny" };
  });
}

// Helper function for scanning (extracted from IPC handler)
type ScanProgressPayload = { count: number; item: LibraryItem | null };

function createScanProgressEmitter() {
  let totalAdded = 0;
  let lastEmittedAt = 0;
  let lastItem: LibraryItem | null = null;

  function sendProgress(force: boolean) {
    if (!mainWindow) return;
    const now = Date.now();
    if (!force && now - lastEmittedAt < 120) return;
    lastEmittedAt = now;
    const payload: ScanProgressPayload = { count: totalAdded, item: lastItem };
    mainWindow.webContents.send("library:scan-progress", payload);
  }

  return {
    onAdded: (item: LibraryItem) => {
      totalAdded += 1;
      lastItem = item;
      sendProgress(false);
    },
    flush: () => {
      sendProgress(true);
    },
    getCount: () => totalAdded,
  };
}

async function scanLibraryFolder(
  dirPath: string,
  parentItemId: number | null,
  progress?: ReturnType<typeof createScanProgressEmitter>
): Promise<number> {
  const supportedExtensions = [
    ".cbz",
    ".zip",
    ".cbr",
    ".rar",
    ".cb7",
    ".7z",
    ".pdf",
  ];
  const imageExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".tiff",
  ];
  let addedCount = 0;

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    // Sort files naturally
    const sortedEntries = entries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );

    for (const entry of sortedEntries) {
      const file = entry.name;
      const filePath = path.join(dirPath, file);

      // Skip specific files
      if (
        file.startsWith(".") ||
        file === "Thumbs.db" ||
        file === "__MACOSX" ||
        file === "$RECYCLE.BIN" ||
        file === "System Volume Information"
      ) {
        continue;
      }

      try {
        if (entry.isFile()) {
          const ext = path.extname(file).toLowerCase();

          // Ignore specific file types or known junk
          if (ext === ".file" || ext === ".ini" || ext === ".db") continue;

          // Check if already exists
          const existingItem = getItemByPath(filePath);
          if (existingItem) {
            // Scan/rescan should only process items that are not already in the database.
            // Skipping existing items also prevents expensive cover extraction from making rescans feel frozen.
            continue;
          }

          if (supportedExtensions.includes(ext)) {
            let pageCount = 0;
            let coverPath: string | null = null;

            // Archive info
            if (ext === ".cbz" || ext === ".zip") {
              try {
                const zip = new StreamZip.async({ file: filePath });
                const entries = await zip.entries();
                const imageEntries = Object.values(entries).filter(
                  (e) =>
                    /\.(jpg|jpeg|png|gif|webp)$/i.test(e.name) && !e.isDirectory
                );
                pageCount = imageEntries.length;
                await zip.close();

                // Extract cover image
                coverPath = await extractCover(filePath);
              } catch (e) {
                console.error("Failed to read zip archive:", filePath, e);
              }
            } else if (ext === ".rar" || ext === ".cbr") {
              // RAR/CBR handling via ArchiveHandler (node-unrar-js)
              try {
                const handler = await ArchiveHandler.open(filePath);
                const entries = await handler.getEntries();
                pageCount = entries.length;
                handler.close();

                // Extract cover image
                coverPath = await extractCover(filePath);
              } catch (e) {
                console.error("Failed to read rar archive:", filePath, e);
              }
            }

            const newItemId = addItem({
              path: filePath,
              title: path.basename(file, ext),
              type: "book",
              page_count: pageCount,
              cover_path: coverPath,
              parent_id: parentItemId,
              is_favorite: false,
              reading_status: "unread",
              current_page: 0,
              last_read_at: null,
            });
            addedCount++;
            const newItem = getItemById(newItemId) ?? getItemByPath(filePath);
            if (newItem && progress) {
              progress.onAdded(newItem);
            }

            // Small delay to allow UI updates
            await new Promise((resolve) => setTimeout(resolve, 0));
          } else if (imageExtensions.includes(ext)) {
            // Individual image file - the file itself is the cover
            addItem({
              path: filePath,
              title: path.basename(file, ext),
              type: "book",
              page_count: 1,
              cover_path: filePath,
              parent_id: parentItemId,
              is_favorite: false,
              reading_status: "unread",
              current_page: 0,
              last_read_at: null,
            });
            addedCount++;
            const newItem = getItemByPath(filePath);
            if (newItem && progress) {
              progress.onAdded(newItem);
            }
            // Small delay to allow UI updates
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        } else if (entry.isDirectory()) {
          // Check if already exists
          let existingFolder = getItemByPath(filePath);
          let folderId: number;

          if (!existingFolder) {
            // Folder cover
            const folderCover = await extractCoverFromFolder(filePath);

            folderId = addItem({
              path: filePath,
              title: file,
              type: "folder",
              page_count: 0,
              cover_path: folderCover,
              parent_id: parentItemId,
              is_favorite: false,
              reading_status: "unread",
              current_page: 0,
              last_read_at: null,
            });
            console.log(`  -> Folder added with ID: ${folderId}`);
            addedCount++;

            const newFolder = getItemById(folderId) ?? getItemByPath(filePath);
            if (newFolder && progress) {
              progress.onAdded(newFolder);
            }

            // Small delay to allow UI updates
            await new Promise((resolve) => setTimeout(resolve, 0));
          } else {
            console.log("  -> Folder exists in DB:", existingFolder.id);
            folderId = existingFolder.id;
          }

          // Recursion
          console.log(
            `  -> Recursing into "${file}" with Parent ID: ${folderId}`
          );
          addedCount += await scanLibraryFolder(filePath, folderId, progress);
        }
      } catch (fileErr) {
        console.error("Error processing file:", filePath, fileErr);
      }
    }
  } catch (dirErr) {
    console.error("Error reading directory:", dirPath, dirErr);
  }

  return addedCount;
}

function broadcastItemUpdate(id: number) {
  const updatedItem = getItemById(id);
  if (!updatedItem) return;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("library:item-updated", updatedItem);
  }
}

function registerIpcHandlers() {
  // Dialog handlers
  ipcMain.handle("dialog:selectFolder", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select your manga/doujinshi folder",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // Library handlers
  ipcMain.handle(
    "library:scan",
    async (_, folderPath: string, parentId: number | null = null) => {
      try {
        if (parentId === null) {
          rememberLibraryRoot(folderPath);
        }

        const progress = createScanProgressEmitter();
        const count = await scanLibraryFolder(folderPath, parentId, progress);
        progress.flush();
        return { success: true, count };
      } catch (e: any) {
        console.error("Scan error:", e);
        return { success: false, error: e.message };
      }
    }
  );

  ipcMain.handle("library:rescan", async () => {
    try {
      let roots = readLibraryRoots();
      if (roots.length === 0) {
        roots = inferLibraryRootsFromDb();
        if (roots.length > 0) writeLibraryRoots(roots);
      }

      console.log("Rescanning library roots:", roots);

      const progress = createScanProgressEmitter();
      let totalAdded = 0;
      for (const rootPath of roots) {
        if (!fs.existsSync(rootPath)) continue;
        totalAdded += await scanLibraryFolder(rootPath, null, progress);
      }
      progress.flush();
      return { success: true, count: totalAdded };
    } catch (e: any) {
      console.error("Rescan error:", e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("library:getItems", (_, parentId: number | null = null) => {
    return getAllItems(parentId);
  });

  ipcMain.handle("library:searchItems", (_, query: string) => {
    return searchItems(query);
  });

  ipcMain.handle("library:getItem", (_, id: number) => {
    return getItemById(id);
  });

  ipcMain.handle("reader:openWindow", (_, id: number, pageIndex?: number) => {
    createReaderWindow(id, pageIndex);
  });

  ipcMain.handle("library:clear", () => {
    clearAllItems();
    clearCoverCache();
    // Also clear roots for a total "fresh start"
    writeLibraryRoots([]);
    console.log("Library cleared!");
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("library:cleared");
      win.webContents.send("library:roots-updated", []);
    }
    return true;
  });

  ipcMain.handle("library:getFavorites", () => {
    return getFavorites();
  });

  ipcMain.handle("library:getRecent", (_, limit: number = 20) => {
    return getRecent(limit);
  });

  ipcMain.handle("library:removeFromRecent", (_, id: number) => {
    removeFromRecent(id);
    broadcastItemUpdate(id);
    return true;
  });

  ipcMain.handle("library:toggleFavorite", (_, id: number) => {
    const isFavorite = toggleFavorite(id);
    broadcastItemUpdate(id);
    return isFavorite;
  });

  ipcMain.handle(
    "library:updateItem",
    (_, id: number, updates: Partial<LibraryItem>) => {
      updateItem(id, updates);
      return true;
    }
  );

  ipcMain.handle("library:deleteItem", async (_, id: number) => {
    const item = getItemById(id);
    if (!item) return false;

    // Persist parent as root if deleting root item
    if (item.parent_id === null) {
      try {
        rememberLibraryRoot(path.dirname(item.path));
      } catch (e) {
        console.error(
          "Failed to remember library root during delete:",
          item.path,
          e
        );
      }
    }

    if (item.path && fs.existsSync(item.path)) {
      try {
        await shell.trashItem(path.resolve(item.path));
      } catch (err) {
        console.error("Failed to trash item:", item.path, err);
      }
    }

    deleteItem(id);
    return true;
  });

  // Open file/folder location in File Explorer
  ipcMain.handle("library:showInFolder", (_, itemPath: string) => {
    if (itemPath && fs.existsSync(itemPath)) {
      if (!isValidLibraryPath(itemPath)) {
        console.error("Blocked access to path outside library:", itemPath);
        return false;
      }
      shell.showItemInFolder(path.resolve(itemPath));
      return true;
    }
    return false;
  });

  // Rename file/folder
  ipcMain.handle(
    "library:renameItem",
    async (_, id: number, newName: string) => {
      const item = getItemById(id);
      if (!item || !item.path || !fs.existsSync(item.path)) {
        return { success: false, error: "Item not found" };
      }

      const dir = path.dirname(item.path);
      const ext = item.type === "folder" ? "" : path.extname(item.path);
      const newPath = path.join(dir, newName + ext);

      // Check if target already exists
      if (fs.existsSync(newPath)) {
        return {
          success: false,
          error: "A file with that name already exists",
        };
      }

      try {
        await fs.promises.rename(item.path, newPath);

        // Update database
        updateItem(id, {
          path: newPath,
          title: newName,
        });

        // Broadcast update
        broadcastItemUpdate(id);

        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }
  );

  ipcMain.handle("library:getCover", (_, coverPath: string) => {
    if (!coverPath) return null;
    return getCoverAsDataUrl(coverPath);
  });

  // Tag Handlers
  ipcMain.handle("tags:getAll", () => getAllTags());
  ipcMain.handle("tags:getAllWithAliases", () => getAllTagsWithAliases());
  ipcMain.handle("tags:search", (_, query: string) => searchTags(query));
  ipcMain.handle(
    "tags:create",
    (_, name: string, categoryId: number | null, description: string | null) =>
      createTag(name, categoryId, description)
  );
  ipcMain.handle("tags:update", (_, id: number, updates: Partial<Tag>) => {
    updateTag(id, updates);
    return true;
  });
  ipcMain.handle("tags:delete", (_, id: number) => {
    deleteTag(id);
    return true;
  });
  ipcMain.handle("tags:addAliases", (_, tagId: number, aliases: string[]) => {
    addTagAliases(tagId, aliases);
    return true;
  });
  ipcMain.handle("tags:removeAlias", (_, tagId: number, alias: string) => {
    removeTagAlias(tagId, alias);
    return true;
  });
  ipcMain.handle("tags:getAliases", (_, tagId: number) => {
    return getTagAliases(tagId);
  });

  // Category Handlers
  ipcMain.handle("categories:getAll", () => getAllCategories());
  ipcMain.handle(
    "categories:create",
    (_, name: string, description: string | null) =>
      createCategory(name, description)
  );
  ipcMain.handle(
    "categories:update",
    (_, id: number, updates: Partial<Category>) => {
      updateCategory(id, updates);
      return true;
    }
  );
  ipcMain.handle("categories:delete", (_, id: number) => {
    deleteCategory(id);
    return true;
  });
  ipcMain.handle(
    "categories:addAliases",
    (_, catId: number, aliases: string[]) => {
      addCategoryAliases(catId, aliases);
      return true;
    }
  );
  ipcMain.handle(
    "categories:removeAlias",
    (_, catId: number, alias: string) => {
      removeCategoryAlias(catId, alias);
      return true;
    }
  );
  ipcMain.handle("categories:getAliases", (_, catId: number) => {
    return getCategoryAliases(catId);
  });

  // Item Tag Handlers
  ipcMain.handle(
    "library:addItemTags",
    (_, itemId: number, tagIds: number[]) => {
      addItemTags(itemId, tagIds);
      broadcastItemUpdate(itemId);
      return true;
    }
  );
  ipcMain.handle(
    "library:removeItemTags",
    (_, itemId: number, tagIds: number[]) => {
      removeItemTags(itemId, tagIds);
      broadcastItemUpdate(itemId);
      return true;
    }
  );
  ipcMain.handle("library:getItemTags", (_, itemId: number) => {
    return getItemTags(itemId);
  });

  // Library Roots
  ipcMain.handle("library:getRoots", () => {
    return readLibraryRoots();
  });

  ipcMain.handle("library:removeRoot", (_, rootPath: string) => {
    try {
      const current = readLibraryRoots();
      const normalizedPath = path.resolve(rootPath).toLowerCase();
      const newRoots = current.filter(
        (r) => path.resolve(r).toLowerCase() !== normalizedPath
      );

      if (newRoots.length !== current.length) {
        // Cleanup DB first; if it fails, keep the root
        deleteItemsByRoot(rootPath);

        writeLibraryRoots(newRoots);

        if (mainWindow) {
          mainWindow.webContents.send("library:refreshed");
        }

        return { success: true };
      }
      return { success: false, error: "Root not found" };
    } catch (e: any) {
      console.error("Error removing library root:", e);
      return { success: false, error: e.message };
    }
  });

  // Backup
  ipcMain.handle("library:backup", async () => {
    if (!mainWindow) return null;

    // Save location
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Save Library Backup",
      defaultPath: `jiinashi-backup-${
        new Date().toISOString().split("T")[0]
      }.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (canceled || !filePath) return { success: false, error: "Cancelled" };

    try {
      // Gather data
      const roots = readLibraryRoots();
      const allItems = getAllItemsFlat();

      const allHiddenPages = getAllHiddenPages();

      const backupItems = allItems
        .filter(
          (item) =>
            item.reading_status !== "unread" ||
            item.is_favorite ||
            item.current_page > 0 ||
            (allHiddenPages[item.id] && allHiddenPages[item.id].length > 0)
        )
        .map((item) => {
          // Relative path
          let relativePath = item.path;
          let matchedRoot = false;

          const allRoots = roots.map((r) => ({
            original: r,
            norm: r.toLowerCase().replace(/\\/g, "/"),
          }));
          // Sort roots by length descending to match deepest possible root first
          allRoots.sort((a, b) => b.norm.length - a.norm.length);

          const normP = item.path.toLowerCase().replace(/\\/g, "/");
          for (const root of allRoots) {
            if (normP.startsWith(root.norm)) {
              const rel = path
                .relative(root.original, item.path)
                .replace(/\\/g, "/");
              // Ensure it's not a sibling match (e.g. Manga vs MangaVids)
              if (!rel.startsWith("..")) {
                relativePath = rel;
                matchedRoot = true;
                break;
              }
            }
          }

          if (!matchedRoot) {
            // Fallback for unknown root
            console.warn(`Item ${item.path} not under any known library root.`);
          }

          return {
            relativePath,
            isFavorite: item.is_favorite,
            readingStatus: item.reading_status,
            currentPage: item.current_page,
            lastReadAt: item.last_read_at,
            hiddenPages: allHiddenPages[item.id] || [],
          };
        });

      // Gather settings to include in backup
      const blurSettings: Record<string, string | null> = {
        blurR18: getSetting("blurR18"),
        blurR18Hover: getSetting("blurR18Hover"),
        blurR18Intensity: getSetting("blurR18Intensity"),
      };

      const backupData = {
        version: 1,
        createdAt: new Date().toISOString(),
        items: backupItems,
        settings: blurSettings,
      };

      await fs.promises.writeFile(
        filePath,
        JSON.stringify(backupData, null, 2),
        "utf-8"
      );
      return { success: true, count: backupItems.length };
    } catch (e: any) {
      console.error("Backup error:", e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("library:exportTags", async (_, options) => {
    if (!mainWindow) return null;

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Export Tags and Categories",
      defaultPath: `jiinashi-tags-${
        new Date().toISOString().split("T")[0]
      }.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (canceled || !filePath) return { success: false, error: "Cancelled" };

    try {
      const exportData = getTagExportData(options);
      if (!exportData) throw new Error("Failed to collect export data");

      const roots = readLibraryRoots();

      // Normalize paths for portability
      const normalizedTagItems: Record<string, string[]> = {};
      for (const [tag, paths] of Object.entries(
        exportData.tagItems as Record<string, string[]>
      )) {
        normalizedTagItems[tag] = paths.map((p: string) => {
          let relative = p;
          const normP = p.toLowerCase().replace(/\\/g, "/");
          const sortedRoots = roots
            .map((r) => ({
              original: r,
              norm: r.toLowerCase().replace(/\\/g, "/"),
            }))
            .sort((a, b) => b.norm.length - a.norm.length);

          for (const root of sortedRoots) {
            if (normP.startsWith(root.norm)) {
              const rel = path.relative(root.original, p).replace(/\\/g, "/");
              if (!rel.startsWith("..")) {
                relative = rel;
                break;
              }
            }
          }
          return relative;
        });
      }

      // Normalize typeItems paths for portability
      const normalizedTypeItems: Record<string, string[]> = {};
      if (exportData.typeItems) {
        for (const [typeName, paths] of Object.entries(
          exportData.typeItems as Record<string, string[]>
        )) {
          normalizedTypeItems[typeName] = paths.map((p: string) => {
            let relative = p;
            const normP = p.toLowerCase().replace(/\\/g, "/");
            const sortedRoots = roots
              .map((r) => ({
                original: r,
                norm: r.toLowerCase().replace(/\\/g, "/"),
              }))
              .sort((a, b) => b.norm.length - a.norm.length);

            for (const root of sortedRoots) {
              if (normP.startsWith(root.norm)) {
                const rel = path.relative(root.original, p).replace(/\\/g, "/");
                if (!rel.startsWith("..")) {
                  relative = rel;
                  break;
                }
              }
            }
            return relative;
          });
        }
      }

      const finalData = {
        version: 1,
        createdAt: new Date().toISOString(),
        categories: exportData.categories,
        tags: exportData.tags,
        tagItems: normalizedTagItems,
        types: exportData.types,
        typeItems: normalizedTypeItems,
      };

      await fs.promises.writeFile(
        filePath,
        JSON.stringify(finalData, null, 2),
        "utf-8"
      );
      return { success: true };
    } catch (e: any) {
      console.error("Export error:", e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("library:importTags", async (_, inputPath?: string) => {
    if (!mainWindow) return null;

    let filePathToUse = inputPath;
    if (!filePathToUse) {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: "Select Tag Export File",
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["openFile"],
      });
      if (canceled || filePaths.length === 0)
        return { success: false, error: "Cancelled" };
      filePathToUse = filePaths[0];
    }

    try {
      const content = await fs.promises.readFile(filePathToUse, "utf-8");
      const data = JSON.parse(content) as {
        version: number;
        categories?: any[];
        tags?: any[];
        tagItems?: Record<string, string[]>;
        types?: any[];
        typeItems?: Record<string, string[]>;
      };

      if (
        !data.version ||
        (!data.categories &&
          !data.tags &&
          !data.tagItems &&
          !data.types &&
          !data.typeItems)
      ) {
        return { success: false, error: "Invalid export file format" };
      }

      const roots = readLibraryRoots();

      // 1. Merge Categories
      const categoryMap: Record<string, number> = {}; // Name -> Local ID
      if (data.categories) {
        for (const cat of data.categories) {
          const existing = getAllCategories().find((c) => c.name === cat.name);
          if (existing) {
            categoryMap[cat.name] = existing.id;
          } else {
            const newCat = createCategory(cat.name, cat.description);
            categoryMap[cat.name] = newCat.id;
          }
        }
      }

      // 2. Merge Tags
      const tagMap: Record<string, number> = {}; // Name -> Local ID
      if (data.tags) {
        for (const tag of data.tags) {
          const localCatId = tag.categoryName
            ? categoryMap[tag.categoryName]
            : null;
          const existing = getAllTags().find((t) => t.name === tag.name);
          if (existing) {
            tagMap[tag.name] = existing.id;
            if (tag.keywords) {
              addTagAliases(existing.id, tag.keywords);
            }
            // Update category if it was null before? Optional.
          } else {
            const newTag = createTag(tag.name, localCatId, tag.description);
            tagMap[tag.name] = newTag.id;
            if (tag.keywords) {
              addTagAliases(newTag.id, tag.keywords);
            }
          }
        }
      }

      // 3. Map Tags to Items
      let mappedCount = 0;
      if (data.tagItems) {
        for (const [tagName, relPaths] of Object.entries(data.tagItems)) {
          const localTagId =
            tagMap[tagName] || getAllTags().find((t) => t.name === tagName)?.id;
          if (!localTagId) continue;

          for (const relPath of relPaths) {
            const platformRelative = relPath.replace(/\//g, path.sep);

            // Prioritize items that actually exist on disk (Fix for Relocation duplicates)
            let itemToUpdate: LibraryItem | null = null;

            for (const root of roots) {
              const candidatePath = path.join(root, platformRelative);
              const item = getItemByPath(candidatePath);
              if (item) {
                if (fs.existsSync(item.path)) {
                  itemToUpdate = item;
                  break; // Found the live one
                } else if (!itemToUpdate) {
                  itemToUpdate = item; // Fallback to ghost record
                }
              }
            }

            if (itemToUpdate) {
              addItemTags(itemToUpdate.id, [localTagId]);
              mappedCount++;
            }
          }
        }
      }

      // 4. Merge Types
      const typeMap: Record<string, number> = {}; // Name -> Local ID
      if (data.types) {
        for (const type of data.types) {
          const existing = getAllTypes().find((t) => t.name === type.name);
          if (existing) {
            typeMap[type.name] = existing.id;
            if (type.keywords) {
              addTypeAliases(existing.id, type.keywords);
            }
          } else {
            const newType = createType(type.name, type.description);
            typeMap[type.name] = newType.id;
            if (type.keywords) {
              addTypeAliases(newType.id, type.keywords);
            }
          }
        }
      }

      // 5. Map Types to Items
      let typeMappedCount = 0;
      if (data.typeItems) {
        for (const [typeName, relPaths] of Object.entries(data.typeItems)) {
          const localTypeId =
            typeMap[typeName] ||
            getAllTypes().find((t) => t.name === typeName)?.id;
          if (!localTypeId) continue;

          for (const relPath of relPaths) {
            const platformRelative = relPath.replace(/\//g, path.sep);

            let itemToUpdate: LibraryItem | null = null;

            for (const root of roots) {
              const candidatePath = path.join(root, platformRelative);
              const item = getItemByPath(candidatePath);
              if (item) {
                if (fs.existsSync(item.path)) {
                  itemToUpdate = item;
                  break;
                } else if (!itemToUpdate) {
                  itemToUpdate = item;
                }
              }
            }

            if (itemToUpdate) {
              addItemTypes(itemToUpdate.id, [localTypeId]);
              typeMappedCount++;
            }
          }
        }
      }

      return { success: true, count: mappedCount, typeCount: typeMappedCount };
    } catch (e: any) {
      console.error("Import tags error:", e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("library:importBackup", async (_, inputPath?: string) => {
    if (!mainWindow) return null;

    let filePathToUse = inputPath;

    if (!filePathToUse) {
      // Select file
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: "Select Backup File",
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["openFile"],
      });

      if (canceled || filePaths.length === 0)
        return { success: false, error: "Cancelled" };
      filePathToUse = filePaths[0];
    }

    try {
      const content = await fs.promises.readFile(filePathToUse, "utf-8");
      const data = JSON.parse(content) as {
        version: number;
        items: any[];
        settings?: Record<string, string | null>;
      };

      if (!data.version || !Array.isArray(data.items)) {
        return { success: false, error: "Invalid backup file format" };
      }

      const roots = readLibraryRoots();
      let updatedCount = 0;

      for (const item of data.items) {
        const {
          relativePath,
          isFavorite,
          readingStatus,
          currentPage,
          lastReadAt,
        } = item as {
          relativePath: string;
          isFavorite: boolean;
          readingStatus: "unread" | "reading" | "read";
          currentPage: number;
          lastReadAt: string | null;
        };
        if (!relativePath) continue;

        // Try to match this relative path against ALL current library roots
        let itemToUpdate: LibraryItem | null = null;

        for (const root of roots) {
          // Absolute path
          const platformRelative = relativePath.replace(/\//g, path.sep);
          const candidatePath = path.join(root, platformRelative);

          const existingItem = getItemByPath(candidatePath);
          if (existingItem) {
            // Prioritize items that actually exist on disk (Relocation safety)
            if (fs.existsSync(existingItem.path)) {
              itemToUpdate = existingItem;
              break; // Found the live one, stop searching
            } else if (!itemToUpdate) {
              itemToUpdate = existingItem; // Remember ghost record but keep looking for a live one
            }
          }
        }

        if (itemToUpdate) {
          // Apply metadata
          updateItem(itemToUpdate.id, {
            is_favorite: isFavorite,
            reading_status: readingStatus,
            current_page: currentPage,
            last_read_at: lastReadAt,
          });

          // Restore hidden pages
          if (item.hiddenPages && Array.isArray(item.hiddenPages)) {
            // First clear existing visibility settings for this item to ensure exact match with backup
            clearPageVisibility(itemToUpdate.id);
            // Then apply hidden pages from backup
            for (const pageName of item.hiddenPages) {
              setPageVisibility(itemToUpdate.id, pageName, true);
            }
          }

          updatedCount++;
        }
      }

      // Restore settings from backup
      if (data.settings && typeof data.settings === "object") {
        for (const [key, value] of Object.entries(data.settings)) {
          if (value !== null && value !== undefined) {
            setSetting(key, String(value));
          }
        }
      }

      if (mainWindow) {
        mainWindow.webContents.send("library:refreshed");
      }

      return { success: true, count: updatedCount };
    } catch (e: any) {
      console.error("Import error:", e);
      return { success: false, error: e.message };
    }
  });

  // Reader handlers
  ipcMain.handle(
    "reader:getPage",
    async (
      _,
      archivePath: string,
      pageIndex: number,
      includeHidden: boolean = false
    ) => {
      try {
        if (!isValidLibraryPath(archivePath)) {
          console.error("Blocked access to path outside library:", archivePath);
          return null;
        }

        const ext = path.extname(archivePath).toLowerCase();

        // Cache check
        const cached = getCachedArchive(archivePath);
        const item = getItemByPath(archivePath);
        const hiddenPages = item ? getHiddenPages(item.id) : [];

        if (ext === ".cbz" || ext === ".zip") {
          let zip;
          if (cached && cached.zip) {
            zip = cached.zip;
          } else {
            // Open new
            zip = new StreamZip.async({ file: archivePath });
            // Cache
            cacheArchive(archivePath, zip, undefined);
          }

          let imageEntries: string[];
          const cachedAfterOpen = getCachedArchive(archivePath);
          if (cachedAfterOpen?.zipImageEntries) {
            imageEntries = cachedAfterOpen.zipImageEntries;
          } else {
            imageEntries = await getZipImageEntries(zip);
            if (cachedAfterOpen) {
              cachedAfterOpen.zipImageEntries = imageEntries;
            }
          }

          // Filter hidden pages
          const visibleEntries = includeHidden
            ? imageEntries
            : imageEntries.filter((entry) => !hiddenPages.includes(entry));

          if (pageIndex >= 0 && pageIndex < visibleEntries.length) {
            const buffer = await zip.entryData(visibleEntries[pageIndex]);
            const dims = getImageDimensions(
              buffer,
              path.extname(visibleEntries[pageIndex])
            );
            // Keep open if cached
            return {
              data: buffer,
              totalPages: visibleEntries.length,
              width: dims?.width,
              height: dims?.height,
              name: visibleEntries[pageIndex],
            };
          }
          // return null if out of bounds
        } else if ([".cbr", ".rar"].includes(ext)) {
          try {
            let handler;
            if (cached && cached.rar) {
              handler = cached.rar;
            } else {
              handler = await ArchiveHandler.open(archivePath);
              cacheArchive(archivePath, undefined, handler);
            }

            let entries: string[];
            const cachedAfterOpen = getCachedArchive(archivePath);
            if (cachedAfterOpen?.rarEntries) {
              entries = cachedAfterOpen.rarEntries;
            } else {
              entries = await handler.getEntries();
              if (cachedAfterOpen) {
                cachedAfterOpen.rarEntries = entries;
              }
            }

            // Filter hidden pages
            const visibleEntries = includeHidden
              ? entries
              : entries.filter((entry) => !hiddenPages.includes(entry));

            if (pageIndex >= 0 && pageIndex < visibleEntries.length) {
              const buffer = await handler.getFile(visibleEntries[pageIndex]);
              const dims = getImageDimensions(
                buffer,
                path.extname(visibleEntries[pageIndex])
              );
              // Keep open
              return {
                data: buffer,
                totalPages: visibleEntries.length,
                width: dims?.width,
                height: dims?.height,
                name: visibleEntries[pageIndex],
              };
            }
          } catch (e) {
            console.error("Archive read error:", e);
            return null;
          }
        } else if (
          [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext)
        ) {
          // Image file
          const buffer = fs.readFileSync(archivePath);
          const dims = getImageDimensions(buffer, ext);
          return {
            data: buffer,
            totalPages: 1,
            width: dims?.width,
            height: dims?.height,
          };
        }

        return null;
      } catch (e) {
        console.error("Failed to read page:", e);
        return null;
      }
    }
  );

  ipcMain.handle("reader:getArchiveContent", async (_, archivePath: string) => {
    try {
      if (!isValidLibraryPath(archivePath)) {
        console.error("Blocked access to path outside library:", archivePath);
        return [];
      }

      const ext = path.extname(archivePath).toLowerCase();
      if (ext === ".cbz" || ext === ".zip") {
        const zip = new StreamZip.async({ file: archivePath });
        const entries = await zip.entries();
        const imageEntries = Object.values(entries)
          .filter(
            (e) => /\.(jpg|jpeg|png|gif|webp)$/i.test(e.name) && !e.isDirectory
          )
          .map((e) => e.name)
          .sort((a, b) =>
            a.localeCompare(b, undefined, {
              numeric: true,
              sensitivity: "base",
            })
          );
        await zip.close();
        return imageEntries;
      } else if ([".cbr", ".rar"].includes(ext)) {
        const handler = await ArchiveHandler.open(archivePath);
        const entries = await handler.getEntries();
        entries.sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
        );
        handler.close();
        return entries;
      }
      return [];
    } catch (e) {
      console.error("Failed to get archive content:", e);
      return [];
    }
  });

  ipcMain.handle("reader:getPageVisibility", async (_, itemId: number) => {
    return getHiddenPages(itemId);
  });

  ipcMain.handle(
    "reader:setPageVisibility",
    async (_, itemId: number, pageName: string, hidden: boolean) => {
      setPageVisibility(itemId, pageName, hidden);
      return true;
    }
  );

  ipcMain.handle("reader:getPageCount", async (_, archivePath: string) => {
    try {
      if (!isValidLibraryPath(archivePath)) return 0;

      const ext = path.extname(archivePath).toLowerCase();
      const item = getItemByPath(archivePath);
      const hiddenPages = item ? getHiddenPages(item.id) : [];

      if (ext === ".cbz" || ext === ".zip") {
        const zip = new StreamZip.async({ file: archivePath });
        const entries = await zip.entries();
        const visibleCount = Object.values(entries).filter(
          (e) =>
            /\.(jpg|jpeg|png|gif|webp)$/i.test((e as any).name) &&
            !(e as any).isDirectory &&
            !hiddenPages.includes((e as any).name)
        ).length;
        await zip.close();
        return visibleCount;
      } else if ([".cbr", ".rar"].includes(ext)) {
        const handler = await ArchiveHandler.open(archivePath);
        const entries = await handler.getEntries();
        const visibleCount = entries.filter(
          (entry) => !hiddenPages.includes(entry)
        ).length;
        handler.close();
        return visibleCount;
      }
      return 1;
    } catch (e) {
      return 0;
    }
  });

  ipcMain.handle(
    "reader:updateProgress",
    async (
      _,
      id: number,
      currentPage: number,
      status?: "unread" | "reading" | "read",
      updateTimestamp?: boolean
    ) => {
      updateReadingProgress(id, currentPage, status, updateTimestamp);
      broadcastItemUpdate(id);
      return true;
    }
  );

  // Settings handlers
  ipcMain.handle("settings:get", (_, key: string) => {
    return getSetting(key);
  });

  ipcMain.handle("settings:set", (_, key: string, value: string) => {
    setSetting(key, value);
    return true;
  });

  ipcMain.handle("settings:getAll", () => {
    return getAllSettings();
  });

  ipcMain.handle("library:getTotalBookCount", () => {
    return getTotalBookCount();
  });

  ipcMain.handle("library:bulkDeleteItems", async (_, ids: number[]) => {
    for (const id of ids) {
      try {
        const item = getItemById(id);
        if (!item) continue;

        if (item.path && fs.existsSync(item.path)) {
          await shell.trashItem(path.resolve(item.path));
        }
      } catch (err) {
        console.error(`Error processing bulk delete item ${id}:`, err);
      }
    }

    try {
      await bulkDeleteItems(ids);
    } catch (err) {
      console.error("Database bulk deletion failed:", err);
      throw err;
    }
    return true;
  });

  ipcMain.handle("library:bulkToggleFavorite", (_, ids: number[]) => {
    const result = bulkToggleFavorite(ids);
    for (const id of ids) {
      broadcastItemUpdate(id);
    }
    return result;
  });

  ipcMain.handle(
    "library:bulkSetTags",
    (_, itemIds: number[], tagIds: number[], action: "add" | "remove") => {
      bulkSetTags(itemIds, tagIds, action);
      for (const id of itemIds) {
        broadcastItemUpdate(id);
      }
      return true;
    }
  );

  ipcMain.handle("library:getBulkItemTags", (_, itemIds: number[]) => {
    return getBulkItemTags(itemIds);
  });

  ipcMain.handle(
    "library:bulkSetContentType",
    (_, itemIds: number[], contentType: string | null) => {
      bulkSetContentType(itemIds, contentType);
      for (const id of itemIds) {
        broadcastItemUpdate(id);
      }
      return true;
    }
  );

  // Content Types Handlers
  ipcMain.handle("types:getAll", () => getAllTypes());
  ipcMain.handle("types:getAllWithAliases", () => getAllTypesWithAliases());
  ipcMain.handle(
    "types:create",
    (_, name: string, description: string | null) =>
      createType(name, description)
  );
  ipcMain.handle(
    "types:update",
    (_, id: number, updates: Partial<ContentType>) => {
      updateType(id, updates);
      return true;
    }
  );
  ipcMain.handle("types:delete", (_, id: number) => {
    deleteType(id);
    return true;
  });
  ipcMain.handle("types:addAliases", (_, typeId: number, aliases: string[]) => {
    addTypeAliases(typeId, aliases);
    return true;
  });
  ipcMain.handle("types:removeAlias", (_, typeId: number, alias: string) => {
    removeTypeAlias(typeId, alias);
    return true;
  });
  ipcMain.handle("types:getAliases", (_, typeId: number) => {
    return getTypeAliases(typeId);
  });

  // Item Types Handlers
  ipcMain.handle("library:getItemTypes", (_, itemId: number) => {
    return getItemTypes(itemId);
  });
  ipcMain.handle(
    "library:addItemTypes",
    (_, itemId: number, typeIds: number[]) => {
      addItemTypes(itemId, typeIds);
      broadcastItemUpdate(itemId);
      return true;
    }
  );
  ipcMain.handle(
    "library:removeItemTypes",
    (_, itemId: number, typeIds: number[]) => {
      removeItemTypes(itemId, typeIds);
      broadcastItemUpdate(itemId);
      return true;
    }
  );
  ipcMain.handle(
    "library:bulkAddItemTypes",
    (_, itemIds: number[], typeIds: number[]) => {
      bulkAddItemTypes(itemIds, typeIds);
      for (const id of itemIds) {
        broadcastItemUpdate(id);
      }
      return true;
    }
  );
  ipcMain.handle(
    "library:bulkRemoveItemTypes",
    (_, itemIds: number[], typeIds: number[]) => {
      bulkRemoveItemTypes(itemIds, typeIds);
      for (const id of itemIds) {
        broadcastItemUpdate(id);
      }
      return true;
    }
  );

  ipcMain.handle("utils:openExternal", (_, url) => {
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        shell.openExternal(url);
      } else {
        console.error("Blocked opening non-http/https URL:", url);
      }
    } catch {
      console.error("Blocked opening invalid URL:", url);
    }
  });
  ipcMain.handle("utils:getVersion", () => version);
}

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  clearArchiveCache();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
