/// <reference types="svelte" />
/// <reference types="vite/client" />

import type { ElectronAPI as PreloadElectronAPI } from "../electron/preload/types";

declare global {
  interface Window {
    electronAPI: PreloadElectronAPI;
  }
}

export {};
