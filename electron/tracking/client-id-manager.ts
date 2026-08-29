import { app } from "electron";
import fs from "fs";
import path from "path";
import * as bytenode from "bytenode";
import {
  deleteSetting,
  getSetting,
  setSetting,
} from "../database/database";
import { protectSecret, revealSecret } from "../security/secret-store";

export type TrackingProvider = "mal" | "anilist";

type TrackingClientIds = Record<TrackingProvider, string>;
type ClientIdChange = { changed: boolean; clientId: string };

const CUSTOM_SETTING_KEYS: Record<TrackingProvider, string> = {
  mal: "tracking:mal:customClientId",
  anilist: "tracking:anilist:customClientId",
};

function assertTrackingProvider(
  service: unknown,
): asserts service is TrackingProvider {
  if (service !== "mal" && service !== "anilist") {
    throw new Error("Invalid tracking provider.");
  }
}

function parseEnvFile(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = normalized.slice(0, separatorIndex).trim();
    const rawValue = normalized.slice(separatorIndex + 1).trim();
    parsed[key] = rawValue.replace(/^(['"])([\s\S]*)\1$/, "$2").trim();
  }
  return parsed;
}

function loadDevelopmentClientIds(): TrackingClientIds {
  const envPath = path.join(process.cwd(), ".env");
  const fileEnv = fs.existsSync(envPath)
    ? parseEnvFile(fs.readFileSync(envPath, "utf8"))
    : {};
  return {
    mal: String(process.env.MAL_CLIENT_ID || fileEnv.MAL_CLIENT_ID || "").trim(),
    anilist: String(
      process.env.ANILIST_CLIENT_ID || fileEnv.ANILIST_CLIENT_ID || "",
    ).trim(),
  };
}

function loadPackagedClientIds(): TrackingClientIds {
  const configPath = path.join(
    app.getAppPath(),
    "dist-electron",
    "tracking-client-config.jsc",
  );
  const loaded = bytenode.runBytecodeFile(configPath) as Partial<TrackingClientIds>;
  return {
    mal: String(loaded?.mal || "").trim(),
    anilist: String(loaded?.anilist || "").trim(),
  };
}

export function isValidTrackingClientId(
  value: string,
): boolean {
  const normalized = String(value || "").trim();
  return /^[^\s\p{C}]{1,256}$/u.test(normalized);
}

class TrackingClientIdManager {
  private initialized = false;
  private bundled: TrackingClientIds = { mal: "", anilist: "" };
  private custom: TrackingClientIds = { mal: "", anilist: "" };

  initialize(): void {
    if (this.initialized) return;
    this.bundled = app.isPackaged
      ? loadPackagedClientIds()
      : loadDevelopmentClientIds();

    for (const service of ["mal", "anilist"] as const) {
      const stored = revealSecret(getSetting(CUSTOM_SETTING_KEYS[service]));
      this.custom[service] = isValidTrackingClientId(stored)
        ? stored
        : "";
    }
    this.initialized = true;
  }

  getEffectiveClientId(service: TrackingProvider): string {
    this.initialize();
    return this.custom[service] || this.bundled[service] || "";
  }

  getCustomClientId(service: TrackingProvider): string {
    assertTrackingProvider(service);
    this.initialize();
    return this.custom[service] || "";
  }

  setCustomClientId(
    service: TrackingProvider,
    value: string,
  ): ClientIdChange {
    assertTrackingProvider(service);
    this.initialize();
    const normalized = String(value || "").trim();
    if (!isValidTrackingClientId(normalized)) {
      throw new Error(
        "Enter a client ID between 1 and 256 characters without spaces.",
      );
    }
    const changed = this.custom[service] !== normalized;
    if (changed) {
      const protectedValue = protectSecret(normalized);
      if (!protectedValue) throw new Error("Failed to protect the client ID.");
      setSetting(CUSTOM_SETTING_KEYS[service], protectedValue);
      this.custom[service] = normalized;
    }
    return { changed, clientId: this.custom[service] };
  }

  resetCustomClientId(
    service: TrackingProvider,
  ): ClientIdChange {
    assertTrackingProvider(service);
    this.initialize();
    const changed = Boolean(this.custom[service]);
    if (changed) {
      deleteSetting(CUSTOM_SETTING_KEYS[service]);
      this.custom[service] = "";
    }
    return { changed, clientId: "" };
  }
}

export const trackingClientIdManager = new TrackingClientIdManager();
