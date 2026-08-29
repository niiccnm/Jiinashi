import type { ISiteParser, MangaMetadata, ImageInfo } from "../types";
import { fetchWithSession } from "../network";

type NHentaiImage = {
  t?: string;
  number?: number;
  path?: string;
};

type NHentaiTag = {
  type?: string;
  name?: string;
};

type NHentaiGalleryData = {
  media_id: number | string;
  title: {
    english?: string | null;
    japanese?: string | null;
    pretty?: string | null;
  };
  // API v2 fields.
  cover?: NHentaiImage;
  pages?: NHentaiImage[];
  // Legacy API/page-template fields.
  images?: {
    cover?: NHentaiImage;
    pages: NHentaiImage[];
  };
  tags?: NHentaiTag[];
  num_pages?: number;
};

// Gallery data cache (5 min TTL) prevents duplicate Cloudflare windows.
const galleryDataCache = new Map<
  string,
  { data: NHentaiGalleryData; expiresAt: number }
>();
const CACHE_TTL = 5 * 60 * 1000;

const EXTENSIONS: Record<string, string> = {
  j: "jpg",
  p: "png",
  g: "gif",
  w: "webp",
  a: "avif",
};

function isGalleryData(value: unknown): value is NHentaiGalleryData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<NHentaiGalleryData>;
  return Boolean(
    data.media_id !== undefined &&
      data.title &&
      (Array.isArray(data.pages) || Array.isArray(data.images?.pages)),
  );
}

function getGalleryPages(data: NHentaiGalleryData): NHentaiImage[] {
  return data.pages || data.images?.pages || [];
}

function getImageExtension(image?: NHentaiImage): string {
  const pathExtension = image?.path?.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1];
  return pathExtension?.toLowerCase() || EXTENSIONS[image?.t || ""] || "jpg";
}

function normalizeCdnPath(path: string): string {
  return path.replace(/^\/+/, "");
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };

  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (entity, decimal: string, hexadecimal: string, name: string) => {
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
      if (hexadecimal)
        return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      return named[name.toLowerCase()] ?? entity;
    },
  );
}

function decodeSingleQuotedString(value: string): string {
  return value.replace(
    /\\(?:u([0-9a-f]{4})|x([0-9a-f]{2})|([\\'"/bfnrtv]))/gi,
    (_escape, unicode: string, hexadecimal: string, simple: string) => {
      if (unicode) return String.fromCharCode(Number.parseInt(unicode, 16));
      if (hexadecimal)
        return String.fromCharCode(Number.parseInt(hexadecimal, 16));
      const escaped: Record<string, string> = {
        "\\": "\\",
        "'": "'",
        '"': '"',
        "/": "/",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
      };
      return escaped[simple] ?? simple;
    },
  );
}

function parseJsonCandidate(candidate: string): NHentaiGalleryData | null {
  try {
    let parsed: unknown = JSON.parse(candidate.replace(/^\uFEFF/, "").trim());
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return isGalleryData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Parses both the current gallery API response and legacy HTML payloads.
 */
function parseNHentaiGalleryResponse(response: string): NHentaiGalleryData {
  const direct = parseJsonCandidate(response);
  if (direct) return direct;

  // BrowserWindow renders a JSON main-frame response inside a <pre> element.
  const preMatch = response.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (preMatch) {
    const preData = parseJsonCandidate(decodeHtmlEntities(preMatch[1]));
    if (preData) return preData;
  }

  // Compatibility with the older gallery and reader page templates.
  const scriptMatch = response.match(
    /JSON\.parse\(\s*(["'])((?:\\.|(?!\1)[\s\S])*)\1\s*\)/,
  );
  if (scriptMatch) {
    const decoded =
      scriptMatch[1] === '"'
        ? JSON.parse(`"${scriptMatch[2]}"`)
        : decodeSingleQuotedString(scriptMatch[2]);
    const scriptData = parseJsonCandidate(decoded);
    if (scriptData) return scriptData;
  }

  throw new Error("Response did not contain valid nhentai gallery data");
}

export class NHentaiParser implements ISiteParser {
  name = "nhentai";

  match(url: string): boolean {
    return /nhentai\.net\/g\/\d+/.test(url);
  }

  private getGalleryId(url: string): string | null {
    const match = url.match(/nhentai\.net\/g\/(\d+)/);
    return match ? match[1] : null;
  }

  /** Fetches and parses gallery data for both metadata and image discovery. */
  private async fetchGalleryData(
    galleryId: string,
    checkCancel?: () => boolean,
  ): Promise<NHentaiGalleryData> {
    const cached = galleryDataCache.get(galleryId);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[nHentai] Using cached data for ${galleryId}`);
      return cached.data;
    }

    const galleryUrl = `https://nhentai.net/g/${galleryId}/`;
    const apiUrl = `https://nhentai.net/api/v2/galleries/${galleryId}`;
    let data: NHentaiGalleryData | null = null;
    let apiError: unknown;

    try {
      const response = await fetchWithSession(apiUrl, galleryUrl, checkCancel);
      data = parseNHentaiGalleryResponse(response);
    } catch (error) {
      if (checkCancel?.()) throw error;
      apiError = error;
      console.warn(
        `[nHentai] Gallery API failed for ${galleryId}; trying the gallery page`,
        error,
      );
    }

    if (!data) {
      try {
        const html = await fetchWithSession(
          galleryUrl,
          galleryUrl,
          checkCancel,
        );
        data = parseNHentaiGalleryResponse(html);
      } catch (pageError) {
        if (checkCancel?.()) throw pageError;
        console.error(`[nHentai] Gallery extraction failed for ${galleryId}`, {
          apiError,
          pageError,
        });
        throw new Error(
          "Could not load gallery data (the gallery may be unavailable or nhentai may be blocking requests)",
        );
      }
    }

    galleryDataCache.set(galleryId, {
      data,
      expiresAt: Date.now() + CACHE_TTL,
    });
    console.log(`[nHentai] Cached data for ${galleryId}`);
    return data;
  }

  async getMetadata(
    url: string,
    _cookies?: string,
    _userAgent?: string,
  ): Promise<MangaMetadata> {
    const galleryId = this.getGalleryId(url);
    if (!galleryId) throw new Error("Invalid nhentai URL");

    const data = await this.fetchGalleryData(galleryId);
    const title =
      data.title.english ||
      data.title.pretty ||
      data.title.japanese ||
      "Unknown Title";
    const cover = data.cover || data.images?.cover;
    const coverType = getImageExtension(cover);
    const coverUrl = cover?.path
      ? `https://t.nhentai.net/${normalizeCdnPath(cover.path)}`
      : `https://t.nhentai.net/galleries/${data.media_id}/cover.${coverType}`;
    const tags = (data.tags || [])
      .filter((tag) => tag.name)
      .map((tag) =>
        tag.type === "tag" || !tag.type
          ? tag.name!
          : `${tag.type}:${tag.name}`,
      );
    const categoryTag = (data.tags || []).find(
      (tag) => tag.type === "category" && tag.name,
    );
    const contentType = categoryTag?.name
      ? categoryTag.name.charAt(0).toUpperCase() + categoryTag.name.slice(1)
      : undefined;

    return {
      title,
      coverUrl,
      pageCount: data.num_pages ?? getGalleryPages(data).length,
      source: "nhentai",
      tags,
      contentType,
    };
  }

  async getImages(
    url: string,
    checkCancel?: () => boolean,
  ): Promise<ImageInfo[]> {
    const galleryId = this.getGalleryId(url);
    if (!galleryId) throw new Error("Invalid nhentai URL");
    if (checkCancel?.()) throw new Error("Cancelled by user");

    const data = await this.fetchGalleryData(galleryId, checkCancel);
    const mediaId = data.media_id;

    return getGalleryPages(data).map((page, index) => {
      const extension = getImageExtension(page);
      const pageNumber = page.number || index + 1;
      // nhentai currently distributes originals across four numbered hosts.
      const imageHost = `i${(index % 4) + 1}.nhentai.net`;
      const imagePath = page.path
        ? normalizeCdnPath(page.path)
        : `galleries/${mediaId}/${pageNumber}.${extension}`;
      return {
        url: `https://${imageHost}/${imagePath}`,
        filename: `${pageNumber.toString().padStart(3, "0")}.${extension}`,
        index,
        headers: {
          Referer: `https://nhentai.net/g/${galleryId}/${pageNumber}/`,
        },
      };
    });
  }
}
