import { app, net, BrowserWindow, session } from "electron";
import axios from "axios";
import fs from "fs";
import * as db from "../database/database";
import { fetchWithHiddenWindow } from "./network";

export class Fetcher {
  private cookieHeaderCache = new Map<
    string,
    { value: string; expiresAt: number }
  >();

  /**
   * Streams an image from URL directly to a file path.
   * Does NOT manage directories.
   */
  async downloadImageToFile(
    url: string,
    destPath: string,
    extraHeaders?: Record<string, string>,
    onBytes?: (bytes: number) => void,
    checkCancel?: () => boolean,
  ): Promise<number> {
    const isNhentai = url.includes("nhentai.net");
    const isHitomi =
      url.includes("gold-usergeneratedcontent.net") ||
      url.includes("hitomi.la");

    if (isNhentai) {
      return this.downloadWithAxios(
        url,
        destPath,
        extraHeaders,
        onBytes,
        checkCancel,
      );
    }
    if (isHitomi) {
      return this.downloadHitomiWithRetries(
        url,
        destPath,
        extraHeaders,
        onBytes,
        checkCancel,
      );
    }

    try {
      return await this.downloadWithNetRequest(
        url,
        destPath,
        extraHeaders,
        onBytes,
        checkCancel,
      );
    } catch (e: any) {
      if (e.message && e.message.includes("ERR_BLOCKED_BY_CLIENT")) {
        return await this.downloadWithAxios(
          url,
          destPath,
          extraHeaders,
          onBytes,
          checkCancel,
        );
      }
      throw e;
    }
  }

  private async downloadWithNetRequest(
    url: string,
    dest: string,
    extraHeaders?: Record<string, string>,
    onBytes?: (bytes: number) => void,
    checkCancel?: () => boolean,
  ): Promise<number> {
    const cookieHeader = await this.getCookieHeaderForRequest(url);
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: "GET",
        url,
        useSessionCookies: true,
      });

      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) {
          request.setHeader(k, v);
        }
      }

      if (cookieHeader) request.setHeader("Cookie", cookieHeader);

      request.on("response", (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(dest);
        let bytesDownloaded = 0;

        response.on("data", (chunk: Buffer) => {
          if (checkCancel && checkCancel()) {
            request.abort();
            fileStream.close();
            reject(new Error("Cancelled by user"));
            return;
          }
          fileStream.write(chunk);
          bytesDownloaded += chunk.length;
          if (onBytes) onBytes(chunk.length);
        });

        response.on("end", () => {
          fileStream.end();
          resolve(bytesDownloaded);
        });

        response.on("error", (err) => {
          fileStream.close();
          reject(err);
        });
      });

      request.on("error", (err) => reject(err));
      request.end();
    });
  }

  private async downloadWithAxios(
    url: string,
    dest: string,
    extraHeaders?: Record<string, string>,
    onBytes?: (bytes: number) => void,
    checkCancel?: () => boolean,
    httpsAgent?: any,
  ): Promise<number> {
    const userAgent = app.userAgentFallback;
    const cookies =
      (await this.getCookieHeaderForRequest(url)) ||
      (await this.getCookiesString(url));

    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 60000,
      headers: {
        "User-Agent": userAgent,
        Cookie: cookies,
        ...extraHeaders,
      },
      httpsAgent,
    });

    if (checkCancel && checkCancel()) {
      throw new Error("Cancelled by user");
    }

    const buffer = Buffer.from(response.data);
    fs.writeFileSync(dest, buffer);
    if (onBytes) onBytes(buffer.length);
    return buffer.length;
  }

  private async downloadHitomiWithRetries(
    url: string,
    dest: string,
    extraHeaders?: Record<string, string>,
    onBytes?: (bytes: number) => void,
    checkCancel?: () => boolean,
  ): Promise<number> {
    const urlObj = new URL(url);
    const host = urlObj.hostname;
    const isHitomiLa = url.includes("hitomi.la");
    let requestUrl = url;
    let extra: any = {};

    if (isHitomiLa) {
      const ip = "172.67.0.1";
      requestUrl = url.replace(host, ip);
      extra = { Host: host };
    }

    let lastError: any;
    const https = require("https");
    const agent = isHitomiLa
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;

    for (let i = 0; i < 4; i++) {
      if (i > 0)
        await new Promise((r) => setTimeout(r, Math.pow(2, i - 1) * 1000));
      if (checkCancel?.()) throw new Error("Cancelled by user");

      try {
        return await this.downloadWithAxios(
          requestUrl,
          dest,
          {
            ...extraHeaders,
            ...extra,
            Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
            Referer: "https://hitomi.la/",
          },
          onBytes,
          checkCancel,
          agent,
        );
      } catch (err: any) {
        lastError = err;
        if (err.response?.status !== 503 && err.response) throw err;
      }
    }
    throw lastError;
  }

  async getCookiesString(url: string): Promise<string> {
    const host = new URL(url).hostname;
    const now = Date.now();
    const cached = this.cookieHeaderCache.get(url);
    if (cached && cached.expiresAt > now) return cached.value;

    const filter: any = {};
    if (host.includes("nhentai.net")) filter.domain = ".nhentai.net";
    else if (host.includes("e-hentai.org")) filter.domain = ".e-hentai.org";
    else if (host.includes("exhentai.org")) filter.domain = ".exhentai.org";
    else filter.url = url;

    const cookiesList = await session.defaultSession.cookies.get(filter);

    if (host.includes("exhentai.org")) {
      const eh = await session.defaultSession.cookies.get({
        domain: ".e-hentai.org",
      });
      // Merge EH cookies into EX for better success rate
      const all = [...eh, ...cookiesList];
      const map = new Map();
      all.forEach((c) => map.set(c.name, c.value));
      const bridged = Array.from(map.entries())
        .map(([n, v]) => `${n}=${v}`)
        .join("; ");
      this.cookieHeaderCache.set(url, {
        value: bridged,
        expiresAt: now + 5000,
      });
      return bridged;
    }

    const str = cookiesList.map((c: any) => `${c.name}=${c.value}`).join("; ");
    this.cookieHeaderCache.set(url, {
      value: str,
      expiresAt: now + 1000 * 60 * 5,
    });
    return str;
  }

  async getCookieHeaderForRequest(url: string): Promise<string> {
    const host = new URL(url).hostname;
    let key = "";
    if (host.endsWith("ehgt.org") || host.endsWith("exhentai.org"))
      key = "eh_ex";
    else if (host.endsWith("e-hentai.org")) key = "eh";
    else if (!key) return "";

    const cached = this.cookieHeaderCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const val = await this.getCookiesString(
      host.endsWith("ehgt.org") ? "https://exhentai.org/" : url,
    );
    if (val)
      this.cookieHeaderCache.set(key, {
        value: val,
        expiresAt: Date.now() + 2500,
      });
    return val;
  }

  async proxyImage(imageUrl: string, source: string): Promise<string | null> {
    if (!imageUrl) return null;
    const userAgent = app.userAgentFallback;
    const cookies = await this.getCookieHeaderForRequest(imageUrl);

    const referer =
      source === "exhentai" || imageUrl.includes("exhentai.org")
        ? "https://exhentai.org/"
        : source === "hitomi" || imageUrl.includes("hitomi.la")
          ? "https://hitomi.la/"
          : "https://e-hentai.org/";

    try {
      const response = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 15000,
        headers: {
          "User-Agent": userAgent,
          Referer: referer,
          Cookie: cookies || (await this.getCookiesString(imageUrl)),
        },
      });
      const contentType = response.headers["content-type"] || "image/jpeg";
      const base64 = Buffer.from(response.data).toString("base64");
      return `data:${contentType};base64,${base64}`;
    } catch (e) {
      console.error("Proxy error", e);
      return null;
    }
  }

  async openLoginWindow(siteKey: string): Promise<boolean> {
    const urls: Record<string, string> = {
      "e-hentai": "https://forums.e-hentai.org/index.php?act=Login",
      exhentai: "https://forums.e-hentai.org/index.php?act=Login",
      nhentai: "https://nhentai.net/",
    };
    const url = urls[siteKey];
    if (!url) return false;

    const win = new BrowserWindow({
      width: 800,
      height: 600,
      title: `Verify - ${siteKey}`,
    });
    await win.loadURL(url);

    return new Promise((resolve) => {
      win.on("closed", async () => {
        try {
          // Proof of login: ipb_pass_hash on .e-hentai.org (forums/main site)
          const ehCookies = await session.defaultSession.cookies.get({
            domain: ".e-hentai.org",
          });
          const hasPassHash = ehCookies.some((c) => c.name === "ipb_pass_hash");

          if (hasPassHash) {
            db.setSetting("cookies:e-hentai", "true");

            // Verify ExHentai session cookie (igneous)
            if (siteKey === "exhentai" || siteKey === "e-hentai") {
              // Visit exhentai to trigger cookie sync
              try {
                await fetchWithHiddenWindow("https://exhentai.org/");
              } catch (e) {}

              const exCookies = await session.defaultSession.cookies.get({
                domain: ".exhentai.org",
              });
              if (exCookies.some((c) => c.name === "igneous")) {
                db.setSetting("cookies:exhentai", "true");
              }
            }
          } else if (siteKey === "nhentai") {
            const nhCookies = await session.defaultSession.cookies.get({
              domain: "nhentai.net",
            });
            if (nhCookies.length > 0) db.setSetting("cookies:nhentai", "true");
          }
        } catch (e) {
          console.error("Cookie verification error:", e);
        }
        resolve(true);
      });
    });
  }
}
