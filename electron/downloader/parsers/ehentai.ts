import * as cheerio from "cheerio";
import type { ISiteParser, MangaMetadata, ImageInfo } from "../types";
import { fetchWithSession } from "../network";

export class EHentaiParser implements ISiteParser {
  name = "e-hentai";

  match(url: string): boolean {
    return (
      /e-hentai\.org\/g\/\d+\/[a-z0-9]+/.test(url) ||
      /exhentai\.org\/g\/\d+\/[a-z0-9]+/.test(url)
    );
  }

  async getMetadata(
    url: string,
    _cookies?: string,
    _userAgent?: string,
    checkCancel?: () => boolean,
  ): Promise<MangaMetadata> {
    const html = await fetchWithSession(url, undefined, checkCancel);

    // ExHentai redirect check
    if (
      url.includes("exhentai.org") &&
      html.includes("<title>ExHentai.org - The Hentai Archive</title>")
    ) {
      throw new Error("AUTH_REQUIRED:exhentai");
    }

    const $ = cheerio.load(html);
    const title = $("#gn").text().trim() || url;
    const coverUrl =
      $("#gd1 div")
        .css("background-image")
        ?.replace(/url\(['"]?(.+?)['"]?\)/, "$1") || "";

    const pageCountMatch = $(".gpc")
      .text()
      .match(/of (\d+) images/);
    const pageCount = parseInt(pageCountMatch?.[1] || "0");

    const tags: string[] = [];
    $("#taglist tr").each((_, tr) => {
      const category = $(tr).find(".tc").text().replace(":", "").trim();
      $(tr)
        .find("div a")
        .each((_, a) => {
          tags.push(`${category}:${$(a).text().trim()}`);
        });
    });

    const contentType = $("#gdc div").text().trim();

    return {
      title,
      coverUrl,
      pageCount,
      source: url.includes("exhentai") ? "exhentai" : "e-hentai",
      tags,
      contentType: contentType || undefined,
    };
  }

  async getImages(
    url: string,
    checkCancel?: () => boolean,
  ): Promise<ImageInfo[]> {
    const images: ImageInfo[] = [];
    let currentUrl = url;
    let pageIdx = 0;

    // fetchWithSession handles cookies/headers automatically
    while (true) {
      if (checkCancel?.()) break;

      let html = "";
      try {
        html = await fetchWithSession(currentUrl, undefined, checkCancel);
      } catch (e) {
        console.error(
          `[EHentai] Failed to fetch gallery page: ${currentUrl}`,
          e,
        );
        break;
      }

      // ExHentai access check
      if (
        currentUrl.includes("exhentai.org") &&
        html.includes("<title>ExHentai.org - The Hentai Archive</title>")
      ) {
        throw new Error("AUTH_REQUIRED:exhentai");
      }

      const $ = cheerio.load(html);
      const thumbnailLinks: string[] = [];
      $("#gdt a").each((_, a) => {
        const href = $(a).attr("href");
        if (href) thumbnailLinks.push(href);
      });

      // Handle unauthenticated or blocked access (Sad Panda)
      if (thumbnailLinks.length === 0) {
        if (
          html.includes("panda_sad.jpg") ||
          html.includes("Content Warning") ||
          $("img[src*='panda_sad']").length > 0
        ) {
          throw new Error("AUTH_REQUIRED:e-hentai");
        }
        if (currentUrl.includes("exhentai.org")) {
          throw new Error("AUTH_REQUIRED:exhentai");
        }
        break;
      }

      const poolSize = 4;
      for (let i = 0; i < thumbnailLinks.length; i += poolSize) {
        const batch = thumbnailLinks.slice(i, i + poolSize);
        const results = await Promise.all(
          batch.map(async (pageLink) => {
            try {
              const imgPageHtml = await fetchWithSession(
                pageLink,
                undefined,
                checkCancel,
              );
              const $imgPage = cheerio.load(imgPageHtml);

              const originalUrl =
                $imgPage("a")
                  .filter((_, el) =>
                    $imgPage(el).text().includes("Download original"),
                  )
                  .attr("href") || null;
              const displayUrl = $imgPage("#img").attr("src") || null;
              const chosenUrl = originalUrl || displayUrl;

              if (!chosenUrl) return null;

              return {
                url: chosenUrl,
                fallbackUrl: originalUrl ? displayUrl : null,
                referer: pageLink,
              };
            } catch (e) {
              console.error(
                `[EHentai] Failed to resolve image at ${pageLink}`,
                e,
              );
              return null;
            }
          }),
        );

        for (const resolved of results) {
          if (!resolved?.url) continue;

          let ext = "jpg";
          try {
            const u = new URL(resolved.url);
            ext = u.pathname.split(".").pop() || "jpg";
          } catch {
            ext = resolved.url.split("?")[0].split(".").pop() || "jpg";
          }

          images.push({
            url: resolved.url,
            fallbackUrl: resolved.fallbackUrl || undefined,
            pageUrl: resolved.referer,
            filename: `${(pageIdx + 1).toString().padStart(3, "0")}.${ext}`,
            index: pageIdx++,
            headers: { Referer: resolved.referer },
            width: 0,
            height: 0,
          });
        }

        if (checkCancel?.()) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      const nextBtn = $(".ptb td").last().find("a").attr("href");
      if (!nextBtn || nextBtn === currentUrl) break;
      currentUrl = nextBtn;

      if (pageIdx > 3000) break; // Increased safety limit
    }

    return images;
  }

  async refreshImage(
    pageUrl: string,
    checkCancel?: () => boolean,
  ): Promise<Pick<
    ImageInfo,
    "url" | "fallbackUrl" | "pageUrl" | "headers"
  > | null> {
    const html = await fetchWithSession(pageUrl, undefined, checkCancel);
    const $ = cheerio.load(html);

    const originalUrl =
      $("a")
        .filter((_, el) => $(el).text().includes("Download original"))
        .attr("href") || null;
    const displayUrl = $("#img").attr("src") || null;
    const chosenUrl = originalUrl || displayUrl;

    if (!chosenUrl) return null;

    return {
      url: chosenUrl,
      fallbackUrl: originalUrl ? displayUrl || undefined : undefined,
      pageUrl,
      headers: { Referer: pageUrl },
    };
  }
}
