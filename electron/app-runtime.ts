import { app, nativeTheme, session, BrowserWindow } from "electron";
import type { Session } from "electron";
import { CLIENT_HINTS, USER_AGENT } from "./downloader/network/constants";

export const GHOST_UA = USER_AGENT;

let runtimeConfigured = false;

function setupSessionStealth(sess: Session) {
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = details.url.toLowerCase();
    const isNH = url.includes("nhentai.net");
    const isEH = url.includes("e-hentai.org") || url.includes("exhentai.org");
    const isHitomi =
      url.includes("hitomi.la") || url.includes("gold-usergeneratedcontent.net");

    if (isNH || isEH || isHitomi) {
      details.requestHeaders["User-Agent"] = GHOST_UA;
      Object.assign(details.requestHeaders, CLIENT_HINTS);

      if (
        url.includes("i.nhentai.net") ||
        url.includes("exhentai.org") ||
        isHitomi
      ) {
        if (!details.requestHeaders["Referer"]) {
          if (isNH) details.requestHeaders["Referer"] = "https://nhentai.net/";
          else if (isEH)
            details.requestHeaders["Referer"] = "https://exhentai.org/";
          else if (isHitomi)
            details.requestHeaders["Referer"] = "https://hitomi.la/";
        }
      }
    }

    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });
}

export function configureAppRuntime() {
  if (runtimeConfigured) return;
  runtimeConfigured = true;

  nativeTheme.themeSource = "dark";

  // Prevent white flash
  app.commandLine.appendSwitch("background-color", "#030712");
  app.commandLine.appendSwitch("enable-features", "WebUIDarkMode");
  app.commandLine.appendSwitch("force-dark-mode");
  if (process.platform === "win32") {
    app.commandLine.appendSwitch(
      "disable-features",
      "CalculateNativeWinOcclusion",
    );
  }

  // Anti-detection flags for Cloudflare Turnstile
  app.commandLine.appendSwitch(
    "disable-features",
    "WebGPU,DawnExperimentalSubgroupLimits,AdapterPropertiesSubgroups",
  );
  app.commandLine.appendSwitch(
    "disable-blink-features",
    "AutomationControlled",
  );
  app.commandLine.appendSwitch("disable-infobars");

  // Keep the spoofed Chrome identity aligned with Electron's Chromium build.
  app.userAgentFallback = GHOST_UA;
  app.commandLine.appendSwitch("referrer-policy", "unsafe-url");

  // Enforce browser identity across all sessions
  app.whenReady().then(async () => {
    // Inherit system proxy (VPN, DNS) settings
    try {
      await session.defaultSession.setProxy({ mode: "system" });
      console.log("[Proxy] System proxy mode enabled for default session");
    } catch (e) {
      console.error("[Proxy] Failed to set system proxy:", e);
    }

    // Allow unsafe-url referrer for anti-scraping sites
    if ((session.defaultSession as any).setReferrerPolicy) {
      (session.defaultSession as any).setReferrerPolicy("unsafe-url");
    }

    setupSessionStealth(session.defaultSession);

    // Apply stealth to solver session partitions
    const commonPartitions = [
      "persist:solver_nhentai",
      "persist:solver_ehentai",
      "persist:solver_exhentai",
      "persist:solver_default",
    ];
    for (const p of commonPartitions) {
      const partitionSession = session.fromPartition(p);
      setupSessionStealth(partitionSession);
      try {
        await partitionSession.setProxy({ mode: "system" });
      } catch (e) {
        console.error(`[Proxy] Failed to set system proxy for ${p}:`, e);
      }
    }
  });

  // Force dark DevTools (Chromium caches light theme)
  app.on("browser-window-created", (_, window) => {
    window.webContents.on("devtools-opened", () => {
      nativeTheme.themeSource = "dark";
    });
  });
}
