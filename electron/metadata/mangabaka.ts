import axios from "axios";

const MANGABAKA_API_BASE_URL = "https://api.mangabaka.org";
const SEARCH_RATE_LIMIT_WINDOW_MS = 60_000;
const SEARCH_RATE_LIMIT_BUDGET = 30;
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
// MangaBaka's Hentai genre: /v1/tags?id=10.
const HENTAI_TAG_ID = 10;

type MangabakaCacheEntry = {
  expiresAtMs: number;
  data: any;
};

function toPositiveInt(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function normalizeSeriesTitles(series: any) {
  if (!series || !Array.isArray(series.titles)) return series;
  const primary = series.titles.find((entry: any) =>
    entry?.language === "ja-Latn" && entry?.is_primary === true &&
    typeof entry?.title === "string" && entry.title.trim(),
  );
  if (!primary) return series;
  const romaji = primary.title.trim();
  const previous = String(series.romanized_title || "").trim();
  if (romaji === previous) return series;
  const aliases = Array.isArray(series.secondary_titles?.unknown)
    ? [...series.secondary_titles.unknown] : [];
  if (previous && !aliases.some((entry: any) => entry?.title === previous)) {
    aliases.push({ title: previous, type: "unknown" });
  }
  return {
    ...series,
    romanized_title: romaji,
    secondary_titles: { ...series.secondary_titles, unknown: aliases },
  };
}

// Normalize titles before caching, including nested recommendation results.
function normalizeResponseTitles(payload: any) {
  if (!payload?.data) return payload;
  const data = payload.data;
  return {
    ...payload,
    data: Array.isArray(data) ? data.map((entry: any) => entry?.series
      ? { ...entry, series: normalizeSeriesTitles(entry.series) }
      : normalizeSeriesTitles(entry))
      : Array.isArray(data.series)
        ? { ...data, series: data.series.map(normalizeSeriesTitles) }
        : normalizeSeriesTitles(data),
  };
}

export class MangabakaMetadataService {
  private readonly searchCache = new Map<string, MangabakaCacheEntry>();
  private readonly detailCache = new Map<string, MangabakaCacheEntry>();
  private readonly inFlight = new Map<string, Promise<any>>();
  private searchWindowStartMs = 0;
  private searchCountInWindow = 0;

  private readCache(cache: Map<string, MangabakaCacheEntry>, key: string) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAtMs) {
      cache.delete(key);
      return null;
    }
    return entry.data;
  }

  private writeCache(
    cache: Map<string, MangabakaCacheEntry>,
    key: string,
    data: any,
    ttlMs: number,
  ) {
    cache.set(key, { data, expiresAtMs: Date.now() + Math.max(1000, ttlMs) });
  }

  private parseRetryAfterMs(error: any): number {
    const retryAfter = String(
      error?.response?.headers?.["retry-after"] || "",
    ).trim();
    if (!retryAfter) return 2000;
    const asSeconds = Number(retryAfter);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      return Math.max(500, Math.min(120_000, Math.floor(asSeconds * 1000)));
    }
    const asDate = Date.parse(retryAfter);
    if (Number.isFinite(asDate)) {
      const delta = asDate - Date.now();
      return Math.max(500, Math.min(120_000, delta));
    }
    return 2000;
  }

  private async reserveSearchBudget() {
    const now = Date.now();
    if (
      this.searchWindowStartMs <= 0 ||
      now - this.searchWindowStartMs >= SEARCH_RATE_LIMIT_WINDOW_MS
    ) {
      this.searchWindowStartMs = now;
      this.searchCountInWindow = 0;
    }

    if (this.searchCountInWindow >= SEARCH_RATE_LIMIT_BUDGET) {
      const waitMs =
        this.searchWindowStartMs + SEARCH_RATE_LIMIT_WINDOW_MS - now + 50;
      await delay(waitMs);
      this.searchWindowStartMs = Date.now();
      this.searchCountInWindow = 0;
    }

    this.searchCountInWindow += 1;
  }

  private async request(options: {
    requestKey: string;
    cacheKey?: string;
    cacheStore?: Map<string, MangabakaCacheEntry>;
    cacheTtlMs?: number;
    path: string;
    params?: Record<string, unknown>;
    retries?: number;
    isSearch?: boolean;
  }) {
    const retries = Math.max(0, Math.floor(Number(options.retries ?? 2)));
    const cacheKey = String(options.cacheKey || "").trim();
    const cacheStore = options.cacheStore;
    const shouldCache = Boolean(cacheStore && cacheKey);
    if (shouldCache) {
      const cached = this.readCache(cacheStore!, cacheKey);
      if (cached) return cached;
    }

    const existing = this.inFlight.get(options.requestKey);
    if (existing) return existing;

    const requestPromise = (async () => {
      let attempt = 0;
      while (true) {
        try {
          if (options.isSearch) {
            await this.reserveSearchBudget();
          }

          const response = await axios.get(
            `${MANGABAKA_API_BASE_URL}${options.path}`,
            {
              params: options.params,
              timeout: REQUEST_TIMEOUT_MS,
            },
          );
          const payload = normalizeResponseTitles(response?.data);
          if (shouldCache) {
            this.writeCache(
              cacheStore!,
              cacheKey,
              payload,
              Number(options.cacheTtlMs || 0),
            );
          }
          return payload;
        } catch (error: any) {
          const status = Number(error?.response?.status || 0);
          const retryable =
            status === 429 ||
            status >= 500 ||
            status === 0 ||
            error?.code === "ECONNABORTED";
          if (!retryable || attempt >= retries) {
            throw error;
          }
          const retryAfterMs =
            status === 429
              ? this.parseRetryAfterMs(error)
              : Math.min(4000, 500 * 2 ** attempt);
          await delay(retryAfterMs);
          attempt += 1;
        }
      }
    })();

    this.inFlight.set(options.requestKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      this.inFlight.delete(options.requestKey);
    }
  }

  async search(query: string, page = 1, limit = 10, sort?: "trending_7d" | "popularity_asc", hideHentai = false) {
    const q = String(query || "").trim();
    const safePage = Math.max(1, Math.floor(Number(page || 1)));
    const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit || 10))));
    const requestKey = `search|${q}|${safePage}|${safeLimit}|${sort || "relevance"}|${hideHentai}`;
    return this.request({
      requestKey,
      cacheKey: requestKey,
      cacheStore: this.searchCache,
      cacheTtlMs: SEARCH_CACHE_TTL_MS,
      path: "/v1/series/search",
      params: {
        q: q || undefined,
        sort_by: sort,
        tag_not: hideHentai ? HENTAI_TAG_ID : undefined,
        page: safePage,
        limit: safeLimit,
      },
      retries: 2,
      isSearch: true,
    });
  }

  async browse(mode: "trending" | "popular", page = 1, hideHentai = false) {
    return this.search("", page, 20, mode === "trending" ? "trending_7d" : "popularity_asc", hideHentai);
  }

  async getRecommendations(seriesId: number, hideHentai = false) {
    const id = toPositiveInt(seriesId);
    if (!id) return { data: [] };
    const requestKey = `recommendations|${id}|${hideHentai}`;
    return this.request({
      requestKey,
      cacheKey: requestKey,
      cacheStore: this.detailCache,
      cacheTtlMs: DETAIL_CACHE_TTL_MS,
      path: `/v1/series/${id}/similar`,
      params: { limit: 24, tag_not: hideHentai ? HENTAI_TAG_ID : undefined },
      retries: 1,
    });
  }

  async getSeries(seriesId: number, options: { throwOnError?: boolean } = {}) {
    const id = toPositiveInt(seriesId);
    if (id <= 0) return null;
    const requestKey = `series|${id}`;
    const cacheKey = requestKey;
    return this.request({
      requestKey,
      cacheKey,
      cacheStore: this.detailCache,
      cacheTtlMs: DETAIL_CACHE_TTL_MS,
      path: `/v1/series/${id}/full`,
      retries: 1,
    }).catch(async (error) => {
      if (options.throwOnError && Number(error?.response?.status) !== 404) throw error;
      try {
        return await this.request({
          requestKey: `${requestKey}|fallback`,
          path: `/v1/series/${id}`,
          retries: 1,
        });
      } catch (error: any) {
        if (options.throwOnError && Number(error?.response?.status) !== 404) throw error;
        return null;
      }
    });
  }

  private pickSeriesFromSourceLookup(payload: any) {
    const list = Array.isArray(payload?.data?.series) ? payload.data.series : [];
    if (list.length === 0) return null;
    return list[0];
  }

  async getSeriesByAniListId(anilistId: number, options: { throwOnError?: boolean } = {}) {
    const id = toPositiveInt(anilistId);
    if (id <= 0) return null;
    const payload = await this.request({
      requestKey: `source-anilist|${id}`,
      cacheKey: `source-anilist|${id}`,
      cacheStore: this.detailCache,
      cacheTtlMs: DETAIL_CACHE_TTL_MS,
      path: `/v1/source/anilist/${id}`,
      retries: 1,
    }).catch((error) => {
      if (options.throwOnError && Number(error?.response?.status) !== 404) throw error;
      return null;
    });
    return this.pickSeriesFromSourceLookup(payload);
  }

  async getSeriesByMalId(malId: number, options: { throwOnError?: boolean } = {}) {
    const id = toPositiveInt(malId);
    if (id <= 0) return null;
    const payload = await this.request({
      requestKey: `source-mal|${id}`,
      cacheKey: `source-mal|${id}`,
      cacheStore: this.detailCache,
      cacheTtlMs: DETAIL_CACHE_TTL_MS,
      path: `/v1/source/my-anime-list/${id}`,
      retries: 1,
    }).catch((error) => {
      if (options.throwOnError && Number(error?.response?.status) !== 404) throw error;
      return null;
    });
    return this.pickSeriesFromSourceLookup(payload);
  }
}

export const mangabakaMetadataService = new MangabakaMetadataService();
