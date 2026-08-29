import axios from "axios";
import type { MangaSeries } from "../types/manga-types";

type MangaDexSearchItem = {
  id?: string;
  attributes?: {
    title?: Record<string, string>;
    altTitles?: Array<Record<string, string>>;
  };
};

export class MangaDexTrackingService {
  private readonly apiUrl = "https://api.mangadex.org";
  private readonly requestTimeoutMs = 12000;
  private totalCache = new Map<number, number>();
  private titleUrlCache = new Map<number, string>();
  private inFlightTotalRequests = new Map<number, Promise<number | null>>();

  async resolveMangaDexTitleUrl(series: MangaSeries): Promise<string | null> {
    const mangaId = await this.resolveMangaDexMangaId(series);
    if (!mangaId) return null;
    return `https://mangadex.org/title/${mangaId}`;
  }

  async getTotalChapters(series: MangaSeries): Promise<number | null> {
    const seriesId = Number(series?.id || 0);
    if (!Number.isFinite(seriesId) || seriesId <= 0) return null;

    const cached = Number(this.totalCache.get(seriesId) || 0);
    if (Number.isFinite(cached) && cached > 0) return cached;

    const existingRequest = this.inFlightTotalRequests.get(seriesId);
    if (existingRequest) return existingRequest;

    const request = this.getTotalChaptersInternal(series).finally(() => {
      this.inFlightTotalRequests.delete(seriesId);
    });
    this.inFlightTotalRequests.set(seriesId, request);
    return request;
  }

  private async getTotalChaptersInternal(
    series: MangaSeries,
  ): Promise<number | null> {
    const seriesId = Number(series?.id || 0);
    const mangaId = await this.resolveMangaDexMangaId(series);
    if (!mangaId) return null;

    const total = await this.fetchAggregateTotal(mangaId);
    if (total === null || !Number.isFinite(total) || total <= 0) return null;
    const normalized = Math.floor(total);
    if (seriesId > 0) {
      this.totalCache.set(seriesId, normalized);
    }
    return normalized;
  }

  private async resolveMangaDexMangaId(
    series: MangaSeries,
  ): Promise<string | null> {
    const seriesId = Number(series?.id || 0);
    if (seriesId > 0) {
      const cachedUrl = String(this.titleUrlCache.get(seriesId) || "").trim();
      const cachedId = this.extractMangaIdFromUrl(cachedUrl);
      if (cachedId) return cachedId;
    }

    const sourceId = String(series?.source_id || "").trim().toLowerCase();
    const sourceUrl = String(series?.source_url || "").trim();
    if (sourceUrl && sourceId.startsWith("jiinashi.mangadex")) {
      const fromSource = this.extractMangaIdFromUrl(sourceUrl);
      if (fromSource) {
        if (seriesId > 0) this.titleUrlCache.set(seriesId, sourceUrl);
        return fromSource;
      }
    }

    const directFromUrl = this.extractMangaIdFromUrl(sourceUrl);
    if (directFromUrl) {
      if (seriesId > 0) this.titleUrlCache.set(seriesId, sourceUrl);
      return directFromUrl;
    }

    const match = await this.findMangaDexMatch(series);
    if (!match?.id) return null;
    if (seriesId > 0) {
      this.titleUrlCache.set(seriesId, `https://mangadex.org/title/${match.id}`);
    }
    return match.id;
  }

  private async findMangaDexMatch(series: MangaSeries) {
    const candidates = this.getSearchCandidates(series);
    if (candidates.length === 0) return null;

    const normalizedCandidates = candidates
      .map((entry) => this.normalizeText(entry))
      .filter(Boolean);
    if (normalizedCandidates.length === 0) return null;

    const ranking = new Map<string, { id: string; score: number }>();
    for (const query of candidates) {
      let data: any = null;
      try {
        const response = await axios.get(`${this.apiUrl}/manga`, {
          params: {
            title: query,
            limit: 12,
            "order[relevance]": "desc",
            "includes[]": ["cover_art"],
          },
          timeout: this.requestTimeoutMs,
        });
        data = response.data;
      } catch {
        continue;
      }

      const mangas = Array.isArray(data?.data) ? data.data : [];
      for (const manga of mangas as MangaDexSearchItem[]) {
        const mangaId = String(manga?.id || "").trim();
        if (!mangaId) continue;

        const titles = this.collectSearchableTitles(manga);
        const score = Math.max(
          0,
          ...normalizedCandidates.map((needle) =>
            Math.max(
              0,
              ...titles.map((title) => this.scoreTitleMatch(title, needle)),
            ),
          ),
        );
        const existing = ranking.get(mangaId);
        if (!existing || score > existing.score) {
          ranking.set(mangaId, { id: mangaId, score });
        }
      }
    }

    const best = [...ranking.values()].sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < 260) return null;
    return best;
  }

  private async fetchAggregateTotal(mangaId: string): Promise<number | null> {
    let data: any = null;
    try {
      const response = await axios.get(`${this.apiUrl}/manga/${mangaId}/aggregate`, {
        timeout: this.requestTimeoutMs,
      });
      data = response.data;
    } catch {
      return null;
    }

    const volumes = data?.volumes;
    if (!volumes || typeof volumes !== "object") return null;

    let maxChapter = 0;
    const chapterKeys = new Set<string>();

    for (const volume of Object.values(volumes) as any[]) {
      const chapters =
        volume && typeof volume === "object" ? volume.chapters : null;
      if (!chapters || typeof chapters !== "object") continue;

      for (const [chapterKey, chapterInfo] of Object.entries(chapters as any)) {
        const key = String(chapterKey || "").trim();
        const infoKey = String((chapterInfo as any)?.chapter || "").trim();
        const resolvedKey = key || infoKey;
        if (resolvedKey) chapterKeys.add(resolvedKey);

        const parsed = this.parseChapterNumber(resolvedKey);
        if (parsed !== null) {
          maxChapter = Math.max(maxChapter, parsed);
        }
      }
    }

    if (maxChapter > 0) return Math.floor(maxChapter);
    if (chapterKeys.size > 0) return chapterKeys.size;
    return null;
  }

  private parseChapterNumber(value: string): number | null {
    const text = String(value || "").trim().toLowerCase();
    if (!text || text === "none") return null;

    const labeled = text.match(
      /(?:chapter|chap|ch|episode|ep|act|part)\s*[:#.\-\s]*([0-9]+(?:\.[0-9]+)?)/i,
    );
    if (labeled?.[1]) {
      const parsed = Number(labeled[1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    const direct = Number(text);
    if (Number.isFinite(direct) && direct > 0) return direct;

    const fallback = text.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!fallback?.[1]) return null;
    const parsed = Number(fallback[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private getSearchCandidates(series: MangaSeries) {
    const candidates = [
      String(series?.title_original || "").trim(),
      String(series?.title_romaji || "").trim(),
      String(series?.title_english || "").trim(),
    ].filter(Boolean);
    return Array.from(new Set(candidates)).slice(0, 4);
  }

  private collectSearchableTitles(manga: MangaDexSearchItem) {
    const titles: string[] = [];
    const titleValues = manga?.attributes?.title || {};
    for (const value of Object.values(titleValues)) {
      if (typeof value === "string" && value.trim()) {
        titles.push(value.trim());
      }
    }
    for (const altTitle of manga?.attributes?.altTitles || []) {
      for (const value of Object.values(altTitle || {})) {
        if (typeof value === "string" && value.trim()) {
          titles.push(value.trim());
        }
      }
    }
    return Array.from(new Set(titles));
  }

  private normalizeText(value: string) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  private scoreTitleMatch(candidate: string, query: string) {
    const c = this.normalizeText(candidate);
    const q = this.normalizeText(query);
    if (!c || !q) return 0;
    if (c === q) return 600;
    if (c.startsWith(q) || q.startsWith(c)) return 420;
    if (c.includes(q) || q.includes(c)) return 260;
    const qTokens = q.split(" ").filter(Boolean);
    let tokenScore = 0;
    for (const token of qTokens) {
      if (token.length >= 2 && c.includes(token)) tokenScore += 20;
    }
    return tokenScore;
  }

  private extractMangaIdFromUrl(rawUrl: string): string | null {
    const text = String(rawUrl || "").trim();
    if (!text) return null;

    try {
      const parsed = new URL(text);
      const host = String(parsed.hostname || "").toLowerCase();
      const isMangaDexHost =
        host === "mangadex.org" || host.endsWith(".mangadex.org");
      if (!isMangaDexHost) return null;
      const segments = parsed.pathname.split("/").filter(Boolean);
      const titleIndex = segments.findIndex((entry) => entry === "title");
      if (titleIndex >= 0 && segments[titleIndex + 1]) {
        const id = String(segments[titleIndex + 1]).trim();
        return id || null;
      }
      return null;
    } catch {
      const match = text.match(/\/title\/([a-f0-9-]{8,})/i);
      if (match?.[1]) return String(match[1]).trim();
      return null;
    }
  }
}
