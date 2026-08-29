import { ipcMain } from "electron";
import { getSetting, setSetting } from "../database/database";

const INCOGNITO_SETTING_KEY = "incognitoMode";

export class IncognitoManager {
  private static instance: IncognitoManager;
  private isIncognito: boolean = false;

  private constructor() {}

  public static getInstance(): IncognitoManager {
    if (!IncognitoManager.instance) {
      IncognitoManager.instance = new IncognitoManager();
    }
    return IncognitoManager.instance;
  }

  public initialize(): void {
    this.isIncognito = getSetting(INCOGNITO_SETTING_KEY) === "true";
  }

  public setIncognito(value: boolean): void {
    const nextValue = value === true;
    setSetting(INCOGNITO_SETTING_KEY, String(nextValue));
    this.isIncognito = nextValue;
    // Broadcast to all windows if needed, but primarily used in main process
  }

  public getIncognito(): boolean {
    return this.isIncognito;
  }
}

export const incognitoManager = IncognitoManager.getInstance();

export function registerIncognitoHandlers() {
  incognitoManager.initialize();
  ipcMain.handle("manga:get-incognito", () => incognitoManager.getIncognito());
  ipcMain.handle("manga:set-incognito", (_, value: boolean) => {
    incognitoManager.setIncognito(value);
    return true;
  });
}
