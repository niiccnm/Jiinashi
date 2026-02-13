import * as cheerio from "cheerio";
import type { ISiteParser, MangaMetadata, ImageInfo } from "../types";
import { fetchWithSession } from "../network";

const hitomiGalleryInfoCache = new Map<
  string,
  { expiresAt: number; info: any }
>();

// Image URL routing configuration
let ggConfig: {
  pathCode: string;
  startsWithA: boolean;
  subdomainCodes: Set<number>;
  expiresAt: number;
} | null = null;

async function fetchGgConfig(checkCancel?: () => boolean): Promise<void> {
  const now = Date.now();
  if (ggConfig && ggConfig.expiresAt > now) return;

  try {
    const ggJs = await fetchWithSession(
      "https://ltn.gold-usergeneratedcontent.net/gg.js",
      undefined,
      checkCancel,
    );

    const lines = ggJs.split("\n");
    let pathCode = "";
    let startsWithA = false;
    const subdomainCodes = new Set<number>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("b:")) {
        const match = trimmed.match(/b:\s*'([^']+)'/);
        if (match) pathCode = match[1];
      } else if (trimmed.startsWith("o =")) {
        startsWithA = trimmed.includes("= 0");
      } else if (trimmed.startsWith("case ")) {
        const match = trimmed.match(/case\s+(\d+):/);
        if (match) subdomainCodes.add(parseInt(match[1], 10));
      }
    }

    console.log(
      `[Hitomi] gg.js loaded: pathCode=${pathCode}, startsWithA=${startsWithA}, subdomainCodes=${subdomainCodes.size}`,
    );

    ggConfig = {
      pathCode,
      startsWithA,
      subdomainCodes,
      expiresAt: now + 300_000,
    };
  } catch (e: any) {
    console.error(
      `[Hitomi] Failed to fetch gg.js (${e.message}). Using fallback pathCode=1769119202/`,
    );
    ggConfig = {
      pathCode: "1769119202/",
      startsWithA: false,
      subdomainCodes: new Set(),
      expiresAt: now + 60_000,
    };
  }
}

/** Extracts hash code from image hash */
function getImageHashCode(hash: string): number {
  return parseInt(hash.slice(-1) + hash.slice(-3, -1), 16);
}

/** Gets subdomain for optimized formats (webp/avif/jxl) */
function getSubdomain(hash: string, extension: string): string {
  const imageHashCode = getImageHashCode(hash);
  const extLetter = extension[0];
  const hasCode = ggConfig?.subdomainCodes.has(imageHashCode) ?? false;
  const startsWithA = ggConfig?.startsWithA ?? false;
  const suffix = hasCode === startsWithA ? "1" : "2";
  return extLetter + suffix;
}

/** Gets subdomain for original images (jpg/png) */
function getOriginalSubdomain(hash: string): string {
  const imageHashCode = getImageHashCode(hash);
  const hasCode = ggConfig?.subdomainCodes.has(imageHashCode) ?? false;
  return hasCode ? "2" : "1";
}

async function getHitomiGalleryInfo(
  galleryId: string,
  checkCancel?: () => boolean,
): Promise<any> {
  const cached = hitomiGalleryInfoCache.get(galleryId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.info;

  const jsUrl = `https://ltn.gold-usergeneratedcontent.net/galleries/${galleryId}.js`;
  const jsContent = await fetchWithSession(jsUrl, undefined, checkCancel);
  const jsonStr = jsContent.replace(/^var\s+\w+\s*=\s*/, "").replace(/;$/, "");
  const info = JSON.parse(jsonStr);

  hitomiGalleryInfoCache.set(galleryId, {
    info,
    expiresAt: now + 300_000,
  });

  return info;
}

// E-Hentai metadata cross-fetching
async function fetchEHentaiMetadataByGid(
  galleryId: string,
  hitomiTitle: string,
  checkCancel?: () => boolean,
): Promise<{ title: string | null; tags: string[] }> {
  const result: { title: string | null; tags: string[] } = {
    title: null,
    tags: [],
  };

  try {
    const searchUrl = `https://e-hentai.org/?f_search=gid:${galleryId}`;
    let html = await fetchWithSession(searchUrl, undefined, checkCancel);

    if (
      html.includes("panda_sad.jpg") ||
      html.includes("Content Warning") ||
      html.includes("<title>ExHentai.org")
    ) {
      const exSearchUrl = `https://exhentai.org/?f_search=gid:${galleryId}`;
      html = await fetchWithSession(exSearchUrl, undefined, checkCancel);
    }

    const galleryUrl = findEHentaiGalleryUrl(html, galleryId);
    if (!galleryUrl) {
      const titleSearchUrl = `https://e-hentai.org/?f_search=${encodeURIComponent(hitomiTitle)}`;
      const titleHtml = await fetchWithSession(
        titleSearchUrl,
        undefined,
        checkCancel,
      );
      const fallbackUrl = findEHentaiGalleryUrl(titleHtml, galleryId);
      if (!fallbackUrl) return result;
      return fetchEHentaiMetadataFromUrl(fallbackUrl, checkCancel);
    }

    return fetchEHentaiMetadataFromUrl(galleryUrl, checkCancel);
  } catch (e: any) {
    console.log(`[Hitomi] E-Hentai lookup failed for ${galleryId}:`, e.message);
    return result;
  }
}

function findEHentaiGalleryUrl(html: string, galleryId: string): string | null {
  const $ = cheerio.load(html);
  return $(`a[href*='/g/${galleryId}/']`).first().attr("href") || null;
}

async function fetchEHentaiMetadataFromUrl(
  url: string,
  checkCancel?: () => boolean,
): Promise<{ title: string | null; tags: string[] }> {
  const html = await fetchWithSession(url, undefined, checkCancel);
  const $ = cheerio.load(html);

  const title = $("#gn").text().trim();
  const tags: string[] = [];
  $("#taglist tr").each((_, tr) => {
    const category = $(tr).find(".tc").text().replace(":", "").trim();
    $(tr)
      .find("div a")
      .each((_, a) => {
        tags.push(`${category}:${$(a).text().trim()}`);
      });
  });

  return { title: title || null, tags };
}

export class HitomiParser implements ISiteParser {
  name = "hitomi";
  urlPatterns = [
    /hitomi\.la\/(?:reader|manga|doujinshi|cg|gamecg|artistcg|imageset|galleries)\/.*-(\d+)\.html/,
    /hitomi\.la\/(?:reader|manga|doujinshi|cg|gamecg|artistcg|imageset|galleries)\/(\d+)/,
  ];

  match(url: string): boolean {
    return this.urlPatterns.some((p) => p.test(url));
  }

  private extractGalleryId(url: string): string | null {
    const m1 = url.match(/-(\d+)\.html(?:$|#|\?)/);
    if (m1) return m1[1];

    const m2 = url.match(
      /\/(?:reader|manga|doujinshi|cg|gamecg|artistcg|imageset)\/(\d+)/,
    );
    if (m2) return m2[1];

    const m3 = url.match(/\D(\d{6,7})\D/) || url.match(/^(\d{6,7})$/);
    return m3 ? m3[1] : null;
  }

  async getMetadata(
    url: string,
    cookies?: string,
    userAgent?: string,
    checkCancel?: () => boolean,
  ): Promise<MangaMetadata> {
    const galleryId = this.extractGalleryId(url);
    if (!galleryId) throw new Error("Cannot extract gallery ID from URL");

    const info = await getHitomiGalleryInfo(galleryId, checkCancel);
    const ehMetadata = await fetchEHentaiMetadataByGid(
      galleryId,
      info.japanese_title || info.title || "",
      checkCancel,
    );

    const files = info.files;
    if (!files || files.length === 0) throw new Error("No files in gallery");
    const coverHash = files[0].hash;
    const coverUrl = `https://tn.gold-usergeneratedcontent.net/webpbigtn/${coverHash.slice(-1)}/${coverHash.slice(-3, -1)}/${coverHash}.webp`;

    const hitomiTags = (info.tags || []).map((t: any) => {
      const ns = t.f ? "female" : t.m ? "male" : "";
      return ns ? `${ns}:${t.tag}` : t.tag;
    });

    if (info.language) {
      hitomiTags.push(`language:${info.language.toLowerCase().trim()}`);
    }

    const combinedTags = Array.from(
      new Set([...hitomiTags, ...ehMetadata.tags]),
    );

    return {
      title:
        ehMetadata.title ||
        info.japanese_title ||
        info.title ||
        `Hitomi Gallery ${galleryId}`,
      pageCount: files.length,
      coverUrl,
      source: "hitomi",
      tags: combinedTags,
      contentType: info.type
        ? info.type.charAt(0).toUpperCase() + info.type.slice(1)
        : undefined,
    };
  }

  async getImages(
    url: string,
    checkCancel?: () => boolean,
  ): Promise<ImageInfo[]> {
    const galleryId = this.extractGalleryId(url);
    if (!galleryId) throw new Error("Cannot extract gallery ID from URL");

    const info = await getHitomiGalleryInfo(galleryId, checkCancel);
    await fetchGgConfig(checkCancel);

    return info.files.map((file: any, i: number) => {
      const hash = file.hash;
      const useExt = "webp"; // CDN serves optimized formats only
      const subdomain = getSubdomain(hash, useExt);
      const pathCode = ggConfig?.pathCode || "";
      const imageHashCode = getImageHashCode(hash);
      const imageUrl = `https://${subdomain}.gold-usergeneratedcontent.net/${pathCode}${imageHashCode}/${hash}.${useExt}`;

      return {
        url: imageUrl,
        filename: `${(i + 1).toString().padStart(3, "0")}.${useExt}`,
        index: i,
        headers: { Referer: `https://hitomi.la/reader/${galleryId}.html` },
        width: file.width || file.w || 0,
        height: file.height || file.h || 0,
      };
    });
  }
}
