import { BrowserWindow } from "electron";
import type { Event } from "electron";
import path from "path";
import { CLIENT_HINTS, USER_AGENT } from "./constants";
import { preSeedCookies, syncCookies } from "./cookies";

type HiddenWindowOptions = {
  timeoutMs?: number;
  escalationDelayMs?: number;
  escalateToVisible?: boolean;
};

/** Opens a browser-backed request when an ordinary HTTP request is challenged. */
export async function fetchWithHiddenWindow(
  url: string,
  referer?: string,
  retries = 0,
  checkCancel?: () => boolean,
  options?: HiddenWindowOptions,
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    if (checkCancel?.()) return reject(new Error("Cancelled"));
    void retries;

    const isPrimaryGallery = url.includes("nhentai.net");
    const partition = isPrimaryGallery
      ? "persist:solver_nhentai"
      : url.includes("e-hentai.org")
        ? "persist:solver_ehentai"
        : url.includes("exhentai.org")
          ? "persist:solver_exhentai"
          : "persist:solver_default";
    const timeoutMs = Math.max(5000, Number(options?.timeoutMs || 180000));
    const escalationDelayMs = Math.max(1000, Number(options?.escalationDelayMs || 1500));
    const shouldEscalate = options?.escalateToVisible ?? isPrimaryGallery;
    await preSeedCookies(partition, url);

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "stealth_preload.js"),
        backgroundThrottling: false,
      },
    });
    if (isPrimaryGallery) win.center();

    // Preserve the user-like focus/input behavior used by the original
    // doujinshi verification window when it becomes visible.
    win.on("show", () => {
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.focus();
          win.webContents.sendInputEvent({ type: "mouseMove", x: 10, y: 10 });
        }
      }, 500);
    });

    win.webContents.setUserAgent(USER_AGENT);
    win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders["User-Agent"] = USER_AGENT;
      Object.assign(details.requestHeaders, CLIENT_HINTS);
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    let settled = false;
    let sweep: NodeJS.Timeout | undefined;
    const finish = () => {
      if (sweep) clearInterval(sweep);
      clearTimeout(timeout);
      clearTimeout(escalation);
      if (!win.isDestroyed()) win.destroy();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      finish();
      reject(error);
    };
    const timeout = setTimeout(
      () => fail(new Error(`Timeout (${Math.round(timeoutMs / 1000)}s)`)),
      timeoutMs,
    );
    const escalation = setTimeout(() => {
      if (!win.isDestroyed() && shouldEscalate) {
        win.show();
        win.focus();
        win.center();
      }
    }, escalationDelayMs);

    const checkPage = async () => {
      if (settled || win.isDestroyed()) return;
      if (checkCancel?.()) return fail(new Error("Cancelled"));
      try {
        const currentUrl = win.webContents.getURL();
        if (!currentUrl || currentUrl === "about:blank") return;
        const state = await win.webContents.executeJavaScript(`(() => {
          const text = (document.body?.innerText || '').trim();
          const title = document.title || '';
          const challenged = /just a moment|cloudflare|please wait|checking/i.test(title) ||
            /verify|human|checking/i.test(text.slice(0, 80)) ||
            location.href.includes('waiting');
          const ready = Boolean(
            document.querySelector('#info, #gallery_id, #image-container, .reader-container, #i1, #gdt, .gm, .main-header, ul.pagination, div.gallery, #gn, #gd1') ||
            document.documentElement.innerHTML.includes('JSON.parse("') ||
            text.startsWith('{') || text.startsWith('[') ||
            document.contentType.includes('xml')
          );
          return { challenged, ready };
        })()`);
        const rootDomain = new URL(url).hostname.split(".").slice(-2).join(".");
        const cookies = await win.webContents.session.cookies.get({});
        const hasSession = cookies.some((cookie) =>
          ["cf_clearance", "igneous"].includes(cookie.name) &&
          cookie.domain?.includes(rootDomain),
        );
        if (!state.ready && !hasSession) return;
        if (state.challenged && !hasSession) return;

        settled = true;
        clearTimeout(escalation);
        if (hasSession) await syncCookies(partition, `.${rootDomain}`);
        await new Promise((done) => setTimeout(done, 1500));
        if (win.isDestroyed()) return;
        const html = await win.webContents.executeJavaScript(
          "document.documentElement.outerHTML",
        );
        finish();
        resolve(html);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    };

    sweep = setInterval(checkPage, 3000);
    win.webContents.on("did-finish-load", checkPage);
    win.webContents.on("dom-ready", checkPage);
    win.webContents.on(
      "did-fail-load",
      (_event: Event, errorCode: number, errorDescription: string) => {
        if (errorCode !== -3) {
          fail(new Error(`Window failed to load: ${errorDescription} (${errorCode})`));
        }
      },
    );
    win.loadURL(url, { httpReferrer: referer || `${new URL(url).origin}/` });
  });
}
