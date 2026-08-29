import { contextBridge, webUtils } from "electron";
import { createLibraryBridge } from "./preload/bridge-library";
import { createMangaBridge } from "./preload/bridge-manga";
import { createMiscBridge } from "./preload/bridge-misc";
import type { ElectronAPI } from "./preload/types";

export type { LibraryItem } from "./preload/types";

const api: ElectronAPI = {
  ...createMiscBridge(webUtils),
  library: createLibraryBridge(),
  manga: createMangaBridge(),
};

contextBridge.exposeInMainWorld("electronAPI", api);
