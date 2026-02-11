import { net } from "electron";
import axios from "axios";
import * as https from "https";
import { USER_AGENT } from "./constants";
import { resolveWithDoH } from "./doh";
import { getExHentaiBridgedCookies } from "./cookies";
import { fetchWithHiddenWindow } from "./stealth";

/** Fetches Hitomi content using 4 strategies: Direct, DoH, Net, Hidden Window. */
async function fetchHitomiWithDoH(
  url: string,
  referer?: string,
  checkCancel?: () => boolean,
): Promise<string> {
  const hostname = new URL(url).hostname;
  const errors: string[] = [];
  const commonHeaders = {
    Referer: referer || `https://${hostname}/`,
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  // Strategy 1: Direct Axios (Only for non-blocked domains)
  if (!hostname.includes("hitomi.la")) {
    try {
      console.log(`[Hitomi] Strategy 1: Direct axios`);
      const res = await axios.get(url, {
        headers: commonHeaders,
        timeout: 15000,
      });
      if (checkCancel?.()) throw new Error("Cancelled");
      return res.data;
    } catch (e: any) {
      errors.push(`Strategy 1: ${e.message}`);
    }
  }

  // Strategy 2: DoH + Axios IP Request
  try {
    console.log(`[Hitomi] Strategy 2: DoH + IP`);
    const ip = await resolveWithDoH(hostname);
    const ipUrl = url.replace(hostname, ip);
    const res = await axios.get(ipUrl, {
      headers: { ...commonHeaders, Host: hostname },
      timeout: 15000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
    if (checkCancel?.()) throw new Error("Cancelled");
    return res.data;
  } catch (e: any) {
    errors.push(`Strategy 2: ${e.message}`);
  }

  // Strategy 3: Electron Net (TLS Fingerprint)
  try {
    console.log(`[Hitomi] Strategy 3: Electron net`);
    const data = await new Promise<string>((resolve, reject) => {
      const req = net.request({ method: "GET", url, useSessionCookies: false });
      Object.entries(commonHeaders).forEach(([k, v]) => req.setHeader(k, v));

      let data = "";
      const timeout = setTimeout(() => {
        req.abort();
        reject(new Error("Timeout"));
      }, 15000);

      req.on("response", (res) => {
        if (res.statusCode !== 200) {
          clearTimeout(timeout);
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.on("data", (d) => (data += d.toString()));
        res.on("end", () => {
          clearTimeout(timeout);
          resolve(data);
        });
        res.on("error", (e) => {
          clearTimeout(timeout);
          reject(e);
        });
      });
      req.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      req.end();
    });
    if (checkCancel?.()) throw new Error("Cancelled");
    return data;
  } catch (e: any) {
    errors.push(`Strategy 3: ${e.message}`);
  }

  // Strategy 4: Hidden Window Fallback
  try {
    console.log(`[Hitomi] Strategy 4: Hidden Window`);
    return await fetchWithHiddenWindow(url, referer, 0, checkCancel);
  } catch (e: any) {
    errors.push(`Strategy 4: ${e.message}`);
  }

  throw new Error(`Hitomi fetch failed: ${errors.join("; ")}`);
}

/**
 * Main HTTP request helper using Electron's net module with session support.
 * Handles Hitomi special logic and ExHentai cookie bridging.
 */
export async function fetchWithSession(
  url: string,
  referer?: string,
  checkCancel?: () => boolean,
): Promise<string> {
  // Special handling for Hitomi
  if (
    url.includes("hitomi.la") ||
    url.includes("gold-usergeneratedcontent.net")
  ) {
    return fetchHitomiWithDoH(url, referer, checkCancel);
  }

  const bridgedCookies = await getExHentaiBridgedCookies(url);
  if (checkCancel && checkCancel()) throw new Error("Cancelled by user");

  return new Promise((resolve, reject) => {
    const request = net.request({
      method: "GET",
      url,
      useSessionCookies: true,
    });
    if (bridgedCookies) request.setHeader("Cookie", bridgedCookies);

    // Standard headers
    request.setHeader(
      "Accept",
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    );
    console.log(`[Base] Fetching ${url}`);

    let data = "";
    request.on("response", async (response) => {
      // Handle Cloudflare blocks immediately
      if (response.statusCode === 403 || response.statusCode === 503) {
        console.log(`[Base] HTTP ${response.statusCode}, falling back...`);
        return fetchWithHiddenWindow(url, referer, 0, checkCancel)
          .then(resolve)
          .catch(reject);
      }
      if (response.statusCode !== 200)
        return reject(new Error(`HTTP ${response.statusCode}`));

      response.on("data", (chunk) => (data += chunk.toString()));
      response.on("end", async () => {
        const lowerData = data.toLowerCase();
        // Proactive Challenge Check
        if (
          lowerData.includes("just a moment...") ||
          lowerData.includes("cf-challenge") ||
          lowerData.includes("checking your browser") ||
          lowerData.includes("challenge-form")
        ) {
          console.log(`[Base] Challenge detected in body, falling back...`);
          return fetchWithHiddenWindow(url, referer, 0, checkCancel)
            .then(resolve)
            .catch(reject);
        }
        resolve(data);
      });
      response.on("error", reject);
    });

    request.on("error", async (err) => {
      console.log(`[Base] Network error: ${err.message}, falling back...`);
      fetchWithHiddenWindow(url, referer, 0, checkCancel)
        .then(resolve)
        .catch(() => reject(err));
    });

    request.end();
  });
}
