import { BrowserWindow, shell } from "electron";
import path from "path";
import type { ReaderBootstrapOverrides } from "../src/lib/utils/manga";

function getIconPath(isDev: boolean): string {
  return path.join(__dirname, isDev ? "../public/icon.ico" : "../dist/icon.ico");
}

function attachDevtoolsToggle(win: BrowserWindow, isDev: boolean) {
  win.webContents.on("before-input-event", (event, input) => {
    if (
      isDev &&
      ((input.control && input.shift && input.key.toLowerCase() === "j") ||
        (!input.control && !input.shift && !input.alt && input.key === "F12"))
    ) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

function attachReaderShortcuts(win: BrowserWindow) {
  win.webContents.on("before-input-event", (event, input) => {
    const isGreyscaleShortcut =
      input.control &&
      input.shift &&
      !input.alt &&
      input.key.toLowerCase() === "c";

    if (!isGreyscaleShortcut) return;

    event.preventDefault();
    if (input.type === "keyDown" && !input.isAutoRepeat) {
      win.webContents.send("reader:toggle-greyscale");
    }
  });
}

function loadWindow(win: BrowserWindow, isDev: boolean, query?: Record<string, string>) {
  if (isDev) {
    if (!query) {
      win.loadURL("http://localhost:5173");
      return;
    }
    const queryStr = new URLSearchParams(query).toString();
    win.loadURL(`http://localhost:5173?${queryStr}`);
    return;
  }

  if (!query) {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
    return;
  }

  win.loadFile(path.join(__dirname, "../dist/index.html"), { query });
}

export function createMainWindow(isDev: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: "#030712",
    icon: getIconPath(isDev),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // @ts-ignore
      paintWhenInitiallyHidden: true,
    },
  });

  attachDevtoolsToggle(win, isDev);
  return win;
}

export function loadMainWindow(win: BrowserWindow, isDev: boolean) {
  loadWindow(win, isDev);
}

export function createDownloadLogsWindow(
  isDev: boolean,
  taskId: number,
): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    title: `Download Logs - ${taskId}`,
    icon: getIconPath(isDev),
    backgroundColor: "#030712",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // @ts-ignore
      paintWhenInitiallyHidden: true,
    },
  });

  loadWindow(win, isDev, { view: "download_logs", taskId: taskId.toString() });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

export function createReaderWindow(
  isDev: boolean,
  bookId: number,
  pageIndex?: number,
  options?: ReaderBootstrapOverrides,
): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    show: false,
    opacity: 0,
    title: "Reader",
    icon: getIconPath(isDev),
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // @ts-ignore
      paintWhenInitiallyHidden: true,
    },
  });

  attachDevtoolsToggle(win, isDev);
  attachReaderShortcuts(win);

  const query: Record<string, string> = {
    view: "reader",
    bookId: bookId.toString(),
  };
  if (pageIndex !== undefined) {
    query.page = pageIndex.toString();
  }
  if (options?.initialViewMode) {
    query.initialViewMode = options.initialViewMode;
  }
  if (typeof options?.initialMangaMode === "boolean") {
    query.initialMangaMode = options.initialMangaMode ? "true" : "false";
  }
  loadWindow(win, isDev, query);

  win.on("enter-full-screen", () => {
    win.webContents.send("window:fullscreen-change", true);
  });
  win.on("leave-full-screen", () => {
    win.webContents.send("window:fullscreen-change", false);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}
