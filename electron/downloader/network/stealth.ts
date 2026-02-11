import { BrowserWindow, Event } from "electron";
import path from "path";
import { CLIENT_HINTS, USER_AGENT } from "./constants";
import { preSeedCookies, syncCookies } from "./cookies";

/**
 * Fallback: Spawns hidden window to bypass Cloudflare/TLS checks.
 * Emulates real user interaction and synchronizes successful cookies.
 */
export async function fetchWithHiddenWindow(
  url: string,
  referer?: string,
  retries = 0,
  checkCancel?: () => boolean,
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    if (checkCancel?.()) return reject(new Error("Cancelled"));

    // Determine partition
    let partition = "persist:solver_default";
    if (url.includes("nhentai.net")) partition = "persist:solver_nhentai";
    else if (url.includes("e-hentai.org")) partition = "persist:solver_ehentai";
    else if (url.includes("exhentai.org"))
      partition = "persist:solver_exhentai";

    const isNH = url.includes("nhentai.net");
    await preSeedCookies(partition, url);

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      show: isNH,
      x: isNH ? undefined : -2000,
      y: isNH ? undefined : -2000,
      webPreferences: {
        offscreen: false,
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "..", "parsers", "stealth_preload.js"), // Fixed path
        backgroundThrottling: false,
      },
    });

    if (isNH) win.center();

    // Natural Focus
    win.on("show", () => {
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.focus();
          win.webContents.sendInputEvent({ type: "mouseMove", x: 10, y: 10 });
        }
      }, 500);
    });

    // Headers & Spoofing
    win.webContents.setUserAgent(USER_AGENT);
    win.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
      details.requestHeaders["User-Agent"] = USER_AGENT;
      Object.assign(details.requestHeaders, CLIENT_HINTS);
      cb({ cancel: false, requestHeaders: details.requestHeaders });
    });

    // Timeout & Cleanup
    let timeoutInt: NodeJS.Timeout;
    let escalationInt: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timeoutInt);
      clearTimeout(escalationInt);
      if ((global as any)._sweepInt) clearInterval((global as any)._sweepInt);
      if (!win.isDestroyed()) win.destroy();
    };

    timeoutInt = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout (180s)"));
    }, 180000);

    // Escalation (Show window if stuck)
    escalationInt = setTimeout(() => {
      if (win && !win.isDestroyed() && isNH) {
        console.log("[Fallback] Escalating to visible manual mode...");
        win.show();
        win.focus();
      }
    }, 1500);

    // Page Check Logic
    const checkPage = async (source: string) => {
      if (win.isDestroyed()) return;
      if (checkCancel?.()) {
        cleanup();
        return reject(new Error("Cancelled"));
      }

      try {
        const currentUrl = win.webContents.getURL();
        const title = win.webContents.getTitle();
        if (!currentUrl || currentUrl === "about:blank") return;

        const bodySnippet = await win.webContents
          .executeJavaScript(
            "document.body.innerText.substring(0, 50).toLowerCase()",
          )
          .catch(() => "");
        const isChallenge =
          title.includes("Just a moment") ||
          title.includes("Cloudflare") ||
          title.includes("Please Wait") ||
          title.includes("Checking") ||
          currentUrl.includes("waiting") ||
          bodySnippet.includes("verify") ||
          bodySnippet.includes("human") ||
          bodySnippet.includes("checking");

        const rootDomain = new URL(url).hostname.split(".").slice(-2).join(".");
        const cookies = await win.webContents.session.cookies.get({});
        const hasAuthCookie =
          rootDomain === "exhentai.org"
            ? cookies.some(
                (c) => c.name === "igneous" && c.domain?.includes(rootDomain),
              )
            : cookies.some(
                (c) =>
                  c.name === "cf_clearance" && c.domain?.includes(rootDomain),
              );

        // Comprehensive Check Content
        const isContentReady = await win.webContents
          .executeJavaScript(
            `
                !!(document.querySelector("#info, #gallery_id, #image-container, .reader-container, #i1, #gdt, .gm, .main-header, ul.pagination, div.gallery") || 
                   document.documentElement.innerHTML.includes('JSON.parse("') ||
                   !!(document.querySelector('#gn') || document.querySelector('#gd1')))
            `,
          )
          .catch(() => false);

        if ((isContentReady || hasAuthCookie) && !isChallenge) {
          console.log(`[Fallback] Success! (${source})`);

          // Final Settlement
          if (hasAuthCookie) await syncCookies(partition, "." + rootDomain);

          // Allow JS to settle before extract
          await new Promise((r) => setTimeout(r, 1500));

          if (win.isDestroyed()) return;
          const html = await win.webContents.executeJavaScript(
            "document.documentElement.outerHTML",
          );
          cleanup();
          resolve(html);
          return;
        }

        // Auto-solve logic (if not visible)
        if (isChallenge && !win.isVisible()) {
          // Programmatic interaction (if needed) or just wait for Cloudflare natural pass
        }
      } catch (e) {
        console.error("[Fallback] Check error:", e);
      }
    };

    // Background Sweep
    (global as any)._sweepInt = setInterval(checkPage, 3000, "sweep");
    win.webContents.on("did-finish-load", () => checkPage("did-finish-load"));
    win.webContents.on("dom-ready", () => checkPage("dom-ready"));

    // Proactive Failure Handling
    win.webContents.on(
      "did-fail-load",
      (_event: Event, errorCode: number, errorDescription: string) => {
        if (errorCode === -3) return; // Ignore ABORTED errors
        cleanup();
        reject(
          new Error(
            `Window failed to load: ${errorDescription} (${errorCode})`,
          ),
        );
      },
    );

    win.loadURL(url, { httpReferrer: referer || new URL(url).origin + "/" });
  });
}

/** Internal solver helper (kept for potential future use). */
async function solveChallengeInternally(webContents: any) {
  try {
    await webContents.executeJavaScript(`
      (function() {
        try {
          const selectors = [ 'input[type="checkbox"]', '.cf-turnstile-button', '#challenge-stage button', '.ctp-checkbox-label input' ];
          for (const s of selectors) {
            const el = document.querySelector(s);
            if (el && !el.checked) {
              el.click();
              el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
              el.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
              el.dispatchEvent(new MouseEvent('click', {bubbles: true}));
              break;
            }
          }
          if (!window._jiinashi_wiggle_active) {
            window._jiinashi_wiggle_active = true;
            setInterval(() => {
              if (Math.random() > 0.7) return;
              window.scrollBy(Math.floor(Math.random()*40)-20, Math.floor(Math.random()*40)-20);
            }, 800 + Math.random() * 400);
          }
        } catch(e) {}
      })()
    `);
  } catch (e) {}
}
