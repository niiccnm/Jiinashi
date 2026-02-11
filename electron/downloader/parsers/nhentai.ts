import type { ISiteParser, MangaMetadata, ImageInfo } from "../types";
import { fetchWithSession } from "../network";

// Gallery data cache (5 min TTL) - prevents duplicate Cloudflare windows
const galleryDataCache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export class NHentaiParser implements ISiteParser {
  name = "nhentai";

  match(url: string): boolean {
    return /nhentai\.net\/g\/\d+/.test(url);
  }

  private getGalleryId(url: string): string | null {
    const match = url.match(/nhentai\.net\/g\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Fetches and parses gallery data with caching.
   * Used by both getMetadata() and getImages().
   */
  private async fetchGalleryData(galleryId: string): Promise<any> {
    const cached = galleryDataCache.get(galleryId);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[nHentai] Using cached data for ${galleryId}`);
      return cached.data;
    }

    const pageUrl = `https://nhentai.net/g/${galleryId}/1/`;
    const referer = `https://nhentai.net/g/${galleryId}/`;
    const html = await fetchWithSession(pageUrl, referer);

    // Extract JSON.parse() data (handles both single and double quotes)
    const scriptMatch = html.match(/JSON\.parse\(['"](.+?)['"]\);/);
    if (!scriptMatch) {
      console.error(
        `[nHentai] Extraction failed. Snippet: ${html.substring(0, 500).replace(/\s+/g, " ")}`,
      );
      throw new Error(
        "Could not find gallery data (Cloudflare might be active)",
      );
    }

    // Parse double-encoded JSON
    let data;
    try {
      const isSingleQuote = html.includes("JSON.parse('");
      let rawData = scriptMatch[1];

      if (isSingleQuote) {
        rawData = rawData.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      } else {
        rawData = rawData.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }

      // Decode unicode escapes
      rawData = rawData.replace(
        /\\u([0-9a-fA-F]{4})/g,
        (_: string, grp: string) => String.fromCharCode(parseInt(grp, 16)),
      );

      const parsed = JSON.parse(rawData);
      data = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    } catch (e) {
      console.error("[nHentai] Parse error:", e);
      throw new Error("Failed to parse gallery data: " + (e as Error).message);
    }

    if (!data || !data.title || !data.images) {
      throw new Error("Invalid gallery data structure");
    }

    // Cache for reuse by getImages()
    galleryDataCache.set(galleryId, {
      data,
      expiresAt: Date.now() + CACHE_TTL,
    });
    console.log(`[nHentai] Cached data for ${galleryId}`);

    return data;
  }

  async getMetadata(
    url: string,
    cookies?: string,
    userAgent?: string,
  ): Promise<MangaMetadata> {
    const galleryId = this.getGalleryId(url);
    if (!galleryId) throw new Error("Invalid nhentai URL");

    const data = await this.fetchGalleryData(galleryId);

    const title =
      data.title.english ||
      data.title.pretty ||
      data.title.japanese ||
      "Unknown Title";

    const extMap: Record<string, string> = { j: "jpg", p: "png", g: "gif" };
    const coverType = extMap[data.images.cover.t] || "jpg";
    const coverUrl = `https://t.nhentai.net/galleries/${data.media_id}/cover.${coverType}`;

    const tags = data.tags.map((t: any) =>
      t.type === "tag" ? t.name : `${t.type}:${t.name}`,
    );

    const categoryTag = data.tags.find((t: any) => t.type === "category");
    const contentType = categoryTag
      ? categoryTag.name.charAt(0).toUpperCase() + categoryTag.name.slice(1)
      : undefined;

    return {
      title,
      coverUrl,
      pageCount: data.num_pages,
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

    const data = await this.fetchGalleryData(galleryId);

    if (!data?.images?.pages) {
      throw new Error("Invalid gallery data structure for images");
    }

    const mediaId = data.media_id;
    const extMap: Record<string, string> = { j: "jpg", p: "png", g: "gif" };

    return data.images.pages.map((page: any, i: number) => {
      const ext = extMap[page.t] || "jpg";
      const pageNum = i + 1;
      return {
        url: `https://i.nhentai.net/galleries/${mediaId}/${pageNum}.${ext}`,
        filename: `${pageNum.toString().padStart(3, "0")}.${ext}`,
        index: i,
        headers: { Referer: `https://nhentai.net/g/${galleryId}/${pageNum}/` },
      };
    });
  }
}
