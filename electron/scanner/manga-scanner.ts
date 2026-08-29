import { anilistService } from "../tracking/anilist";
import * as mangaQueries from "../database/queries/manga";
import { updateItem } from "../database/database";
import { mapFormat } from "../library/manga-linker/title-utils";

export interface MangaMatchResult {
  remoteId: string;
  title: string;
  coverUrl: string;
  description: string;
  score: number;
  type: string;
  format: string;
}

export class MangaScanner {
  async searchAnimeList(query: string): Promise<MangaMatchResult[]> {
    try {
      const page = await anilistService.search(query, 1, 5);
      const media = page.media;

      return media.map((m: any) => ({
        remoteId: m.id.toString(),
        title: m.title.english || m.title.romaji || m.title.native,
        coverUrl: m.coverImage.large,
        description: m.description,
        score: m.averageScore / 10,
        type: m.status,
        format: m.format,
      }));
    } catch (e) {
      console.error("Manga search failed:", e);
      return [];
    }
  }

  async setAsManga(itemId: number, match: MangaMatchResult) {
    let detail: any = null;
    try {
      detail = await anilistService.getDetails(Number(match.remoteId));
    } catch (error) {
      console.warn("Failed to load AniList detail for scanner match:", error);
      detail = null;
    }

    const titleNative = String(detail?.title?.native || "").trim();
    const titleRomaji = String(detail?.title?.romaji || "").trim();
    const titleEnglish = String(detail?.title?.english || "").trim();
    const coverUrl =
      String(detail?.coverImage?.extraLarge || "").trim() ||
      String(detail?.coverImage?.large || "").trim() ||
      match.coverUrl;
    const description = String(detail?.description || "").trim() || match.description;
    const readingFormat = detail
      ? mapFormat(detail?.format, detail?.countryOfOrigin)
      : ((match.format?.toLowerCase() as any) || "manga");
    const averageScore = Number(detail?.averageScore || 0);

    // 1. Create series in DB
    const seriesId = await mangaQueries.addMangaSeries({
      source_id: "anilist",
      source_url: `https://anilist.co/manga/${match.remoteId}`,
      anilist_id: Number(match.remoteId) || undefined,
      title_original: titleNative,
      title_romaji: titleRomaji || undefined,
      title_english: titleEnglish || match.title || undefined,
      description,
      cover_url: coverUrl,
      reading_format: readingFormat,
      mal_score:
        Number.isFinite(averageScore) && averageScore > 0
          ? averageScore / 10
          : match.score,
    });

    // 2. Link library item
    updateItem(itemId, { manga_series_id: seriesId });

    return seriesId;
  }

  normalizeFolderName(name: string): string {
    // Remove tags like [Group], (Year), {ID}, etc.
    return name
      .replace(/\[.*?\]/g, "")
      .replace(/\(.*?\)/g, "")
      .replace(/\{.*?\}/g, "")
      .trim();
  }
}

export const mangaScanner = new MangaScanner();
