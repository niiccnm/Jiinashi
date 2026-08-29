import { ipcMain } from "electron";
import { extensionLoader } from "./extensions/loader";
import { mangaDownloader } from "./downloader/manga-downloader";
import * as mangaQueries from "./database/queries/manga";
import { getSetting } from "./database/database";
import { trackingService } from "./tracking/tracking-service";
import { anilistService } from "./tracking/anilist";
import { mangabakaMetadataService } from "./metadata/mangabaka";
import {
  normalizeSeriesTitleStyle,
  resolveSeriesTitle,
} from "./library/manga-linker/title-utils";

type RegisterMangaIpcHandlersOptions = {
  broadcastItemUpdate: (id: number) => void;
};

type AniListDetailCacheEntry = {
  detail: any;
  fetchedAtMs: number;
};

const ANILIST_DETAIL_FRESH_TTL_MS = 15 * 60 * 1000;
const ANILIST_DETAIL_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const ANILIST_DETAIL_DEFAULT_RETRY_MS = 60 * 1000;

export function registerMangaIpcHandlers({
  broadcastItemUpdate: _broadcastItemUpdate,
}: RegisterMangaIpcHandlersOptions) {
  const toSourceDescriptor = (source: any) => ({
    id: source.id,
    name: source.name,
    baseUrl: source.baseUrl,
    lang: source.lang,
    iconUrl: source.iconUrl,
    matchProfile: source.matchProfile,
  });

  ipcMain.handle("manga:get-extensions", () => extensionLoader.getExtensions());
  ipcMain.handle("manga:get-extension-repositories", () =>
    extensionLoader.getRepositories(),
  );
  ipcMain.handle("manga:import-extension-repository", (_, url: string) =>
    extensionLoader.importRepository(url),
  );
  ipcMain.handle("manga:remove-extension", (_, id: string) =>
    extensionLoader.removeInstalledExtension(id),
  );
  ipcMain.handle("manga:get-enabled-sources", () => {
    return extensionLoader.getEnabledSources().map(toSourceDescriptor);
  });
  ipcMain.handle("manga:get-source-catalog", () => {
    return extensionLoader.getAllSources().map(toSourceDescriptor);
  });

  ipcMain.handle("manga:toggle-extension", (_, id, enabled) =>
    extensionLoader.toggleExtension(id, enabled),
  );
  ipcMain.handle("manga:toggle-extension-site", (_, extensionId, siteId, enabled) =>
    extensionLoader.toggleExtensionSite(extensionId, siteId, enabled),
  );

  const resolveMangaSource = (sourceId: string) => {
    const normalizedSourceId = String(sourceId || "").trim();
    if (!normalizedSourceId) return undefined;
    return extensionLoader.getSource(normalizedSourceId);
  };

  const isProviderSourceId = (sourceId: string) => {
    return Boolean(resolveMangaSource(sourceId));
  };

  const toPositiveInt = (value: unknown): number => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  };

  const parseMangabakaIdFromText = (value: unknown): number => {
    const raw = String(value || "").trim();
    if (!raw) return 0;

    const direct = toPositiveInt(raw);
    if (direct > 0) return direct;

    const match = raw.match(/mangabaka\.org\/(\d+)/i);
    return match?.[1] ? toPositiveInt(match[1]) : 0;
  };

  const parseMangabakaIdFromExternalLinks = (value: unknown): number => {
    const links = Array.isArray(value) ? value : [];
    for (const link of links) {
      const rawUrl =
        typeof link === "string"
          ? link
          : typeof link === "object"
            ? (link as any)?.url
            : "";
      const parsed = parseMangabakaIdFromText(rawUrl);
      if (parsed > 0) return parsed;
    }
    return 0;
  };

  const isAniListRateLimitError = (error: unknown) => {
    const status = Number(
      (error as any)?.status || (error as any)?.response?.status || 0,
    );
    return Boolean((error as any)?.isAniListRateLimitError) || status === 429;
  };

  const getRetryAfterMs = (error: unknown): number => {
    const parsed = toPositiveInt((error as any)?.retryAfterMs);
    return parsed > 0 ? parsed : ANILIST_DETAIL_DEFAULT_RETRY_MS;
  };

  const mapSeriesToAnilistLikeDetail = (series: any) => {
    if (!series) return null;
    return {
      id: toPositiveInt(series.anilist_id) || null,
      idMal: toPositiveInt(series.mal_id) || null,
      idMangabaka: toPositiveInt(series.mangabaka_id) || null,
      title: {
        romaji: String(series.title_romaji || "").trim() || null,
        english: String(series.title_english || "").trim() || null,
        native: String(series.title_original || "").trim() || null,
      },
      synonyms: [],
      coverImage: {
        extraLarge: String(series.cover_url || "").trim() || null,
        large: String(series.cover_url || "").trim() || null,
      },
      bannerImage: String(series.banner_url || "").trim() || null,
      description: String(series.description || "").trim() || null,
      status: String(series.status || "").trim() || null,
      genres: Array.isArray(series.genres) ? series.genres : [],
      format: String(series.reading_format || "").trim() || null,
      chapters: null,
      volumes: null,
      staff: { edges: [] },
      externalLinks: [],
      sourceProvider: String(series.source_id || "").trim() || null,
      sourceUrl: String(series.source_url || "").trim() || null,
    };
  };

  const flattenMangabakaSecondaryTitles = (value: any): string[] => {
    if (!value || typeof value !== "object") return [];
    const out: string[] = [];
    for (const entries of Object.values(value as Record<string, any>)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const title = String((entry as any)?.title || "").trim();
        if (title) out.push(title);
      }
    }
    return Array.from(new Set(out));
  };

  const mapMangabakaToAnilistLikeDetail = (series: any) => {
    if (!series) return null;
    const sourceAnilistId = toPositiveInt(series?.source?.anilist?.id);
    const sourceMalId = toPositiveInt(series?.source?.my_anime_list?.id);
    const mangabakaId = toPositiveInt(series?.id);
    const coverRawUrl = String(series?.cover?.raw?.url || "").trim();
    const cover350 =
      String(series?.cover?.x350?.x2 || "").trim() ||
      String(series?.cover?.x350?.x1 || "").trim();
    const normalizedStatus = String(series?.status || "")
      .trim()
      .toUpperCase();
    const status =
      normalizedStatus === "RELEASING"
        ? "RELEASING"
        : normalizedStatus === "COMPLETED"
          ? "FINISHED"
          : normalizedStatus === "HIATUS"
            ? "HIATUS"
            : normalizedStatus === "CANCELLED"
              ? "CANCELLED"
              : null;
    const rating = Number(series?.rating || 0);
    const averageScore =
      Number.isFinite(rating) && rating > 0 ? Math.round(rating) : null;
    const year = toPositiveInt(series?.year);
    const links = Array.isArray(series?.links) ? series.links : [];
    const externalLinks = links
      .map((url: any) => String(url || "").trim())
      .filter(Boolean)
      .map((url: string) => ({ url, site: "External" }));

    return {
      id: sourceAnilistId || null,
      idMal: sourceMalId || null,
      idMangabaka: mangabakaId || null,
      title: {
        romaji:
          String(series?.romanized_title || "").trim() ||
          String(series?.title || "").trim() ||
          null,
        english: String(series?.title || "").trim() || null,
        native: String(series?.native_title || "").trim() || null,
      },
      synonyms: flattenMangabakaSecondaryTitles(series?.secondary_titles),
      coverImage: {
        extraLarge: coverRawUrl || cover350 || null,
        large: cover350 || coverRawUrl || null,
      },
      bannerImage: null,
      description: String(series?.description || "").trim() || null,
      status,
      genres: Array.isArray(series?.genres)
        ? series.genres
            .map((entry: any) => String(entry || "").trim())
            .filter(Boolean)
        : [],
      format:
        String(series?.type || "")
          .trim()
          .toUpperCase() || null,
      chapters: toPositiveInt(series?.total_chapters) || null,
      volumes: toPositiveInt(series?.final_volume) || null,
      staff: { edges: [] },
      externalLinks,
      averageScore,
      startDate: { year: year || null },
      sourceProvider: "mangabaka",
      sourceUrl:
        mangabakaId > 0 ? `https://mangabaka.org/${mangabakaId}` : null,
    };
  };

  const enrichDetailWithMangabakaIdentity = async (detail: any) => {
    if (!detail) return null;

    const existingMangabakaId =
      toPositiveInt(detail?.idMangabaka) ||
      parseMangabakaIdFromText(detail?.sourceUrl) ||
      parseMangabakaIdFromExternalLinks(detail?.externalLinks);

    if (existingMangabakaId > 0) {
      const sourceUrl =
        String(detail?.sourceUrl || "").trim() ||
        `https://mangabaka.org/${existingMangabakaId}`;
      return {
        ...detail,
        idMangabaka: existingMangabakaId,
        sourceUrl,
      };
    }

    const anilistId = toPositiveInt(detail?.id);
    const malId = toPositiveInt(detail?.idMal);

    let crosswalkSeries: any = null;
    if (anilistId > 0) {
      crosswalkSeries = await mangabakaMetadataService
        .getSeriesByAniListId(anilistId)
        .catch(() => null);
    }
    if (!crosswalkSeries && malId > 0) {
      crosswalkSeries = await mangabakaMetadataService
        .getSeriesByMalId(malId)
        .catch(() => null);
    }

    if (crosswalkSeries) {
      const mappedCrosswalk = mapMangabakaToAnilistLikeDetail(crosswalkSeries);
      const mappedMangabakaId = toPositiveInt(mappedCrosswalk?.idMangabaka);
      if (mappedMangabakaId > 0) {
        const mangabakaUrl = `https://mangabaka.org/${mappedMangabakaId}`;
        const externalLinks = Array.isArray(detail?.externalLinks)
          ? [...detail.externalLinks]
          : [];
        const hasMangabakaExternalLink = externalLinks.some((entry: any) =>
          parseMangabakaIdFromText(
            typeof entry === "string" ? entry : entry?.url,
          ),
        );
        if (!hasMangabakaExternalLink) {
          externalLinks.push({ url: mangabakaUrl, site: "Mangabaka" });
        }
        return {
          ...detail,
          idMangabaka: mappedMangabakaId,
          sourceUrl: String(detail?.sourceUrl || "").trim() || mangabakaUrl,
          externalLinks,
        };
      }
    }

    const dbSeries =
      (anilistId > 0
        ? mangaQueries.getMangaSeriesByAnilistId(anilistId)
        : null) ||
      (malId > 0 ? mangaQueries.getMangaSeriesByMalId(malId) : null);
    const dbMangabakaId =
      toPositiveInt(dbSeries?.mangabaka_id) ||
      parseMangabakaIdFromText(dbSeries?.source_url);
    if (dbMangabakaId > 0) {
      return {
        ...detail,
        idMangabaka: dbMangabakaId,
        sourceUrl:
          String(detail?.sourceUrl || "").trim() ||
          `https://mangabaka.org/${dbMangabakaId}`,
      };
    }

    return detail;
  };

  const anilistDetailCache = new Map<number, AniListDetailCacheEntry>();
  const anilistDetailInFlight = new Map<number, Promise<any | null>>();
  let anilistCooldownUntilMs = 0;

  const readCachedAnilistDetail = (
    anilistId: number,
    maxAgeMs: number,
  ): any | null => {
    const entry = anilistDetailCache.get(anilistId);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAtMs > maxAgeMs) return null;
    return entry.detail ?? null;
  };

  const logAniListDetailRateLimit = (
    anilistId: number,
    retryAfterMs: number,
    fallback: "cached" | "db" | "null",
    reason: "cooldown" | "429",
  ) => {
    console.warn(
      `[manga:anilist-details] rateLimited=true id=${anilistId} fallback=${fallback} retryAfterMs=${retryAfterMs} reason=${reason}`,
    );
  };

  const resolveAniListDetailFallback = (
    anilistId: number,
    retryAfterMs: number,
    reason: "cooldown" | "429",
  ): any | null => {
    const staleCached = readCachedAnilistDetail(
      anilistId,
      ANILIST_DETAIL_STALE_TTL_MS,
    );
    if (staleCached) {
      logAniListDetailRateLimit(anilistId, retryAfterMs, "cached", reason);
      return staleCached;
    }

    const dbSeries = mangaQueries.getMangaSeriesByAnilistId(anilistId);
    const dbFallback = mapSeriesToAnilistLikeDetail(dbSeries);
    logAniListDetailRateLimit(
      anilistId,
      retryAfterMs,
      dbFallback ? "db" : "null",
      reason,
    );
    return dbFallback;
  };

  const getAnilistDetailsResilient = async (
    id: number,
  ): Promise<any | null> => {
    const anilistId = toPositiveInt(id);
    if (anilistId <= 0) return null;

    const freshCached = readCachedAnilistDetail(
      anilistId,
      ANILIST_DETAIL_FRESH_TTL_MS,
    );
    if (freshCached) return freshCached;

    const now = Date.now();
    if (anilistCooldownUntilMs > now) {
      return resolveAniListDetailFallback(
        anilistId,
        anilistCooldownUntilMs - now,
        "cooldown",
      );
    }

    const inFlight = anilistDetailInFlight.get(anilistId);
    if (inFlight) return inFlight;

    const requestPromise = (async () => {
      try {
        const detail = await anilistService.getDetails(anilistId);
        anilistDetailCache.set(anilistId, {
          detail,
          fetchedAtMs: Date.now(),
        });
        return detail ?? null;
      } catch (error) {
        if (isAniListRateLimitError(error)) {
          const retryAfterMs = getRetryAfterMs(error);
          anilistCooldownUntilMs = Math.max(
            anilistCooldownUntilMs,
            Date.now() + retryAfterMs,
          );
          return resolveAniListDetailFallback(anilistId, retryAfterMs, "429");
        }

        const status = Number(
          (error as any)?.status || (error as any)?.response?.status || 0,
        );
        const message = String(
          (error as any)?.message || "Unknown AniList error",
        );
        console.error(
          `[manga:anilist-details] failed id=${anilistId} status=${status || "n/a"} message=${message}`,
        );
        throw error;
      } finally {
        anilistDetailInFlight.delete(anilistId);
      }
    })();

    anilistDetailInFlight.set(anilistId, requestPromise);
    return requestPromise;
  };

  ipcMain.handle("manga:get-popular", (_, sourceId: string, page: number) => {
    const source = resolveMangaSource(sourceId);
    if (!source) throw new Error("Source not found");
    return source.getPopular(page);
  });
  ipcMain.handle("manga:get-latest", (_, sourceId: string, page: number) => {
    const source = resolveMangaSource(sourceId);
    if (!source) throw new Error("Source not found");
    return source.getLatest(page);
  });

  const contextControllers = new Map<string, Set<AbortController>>();

  const addContextController = (contextId?: string) => {
    if (!contextId) return undefined;
    const controller = new AbortController();
    if (!contextControllers.has(contextId)) {
      contextControllers.set(contextId, new Set());
    }
    contextControllers.get(contextId)!.add(controller);
    return controller;
  };

  const removeContextController = (
    contextId: string | undefined,
    controller: AbortController | undefined,
  ) => {
    if (!contextId || !controller) return;
    const group = contextControllers.get(contextId);
    if (!group) return;
    group.delete(controller);
    if (group.size === 0) {
      contextControllers.delete(contextId);
    }
  };

  const normalizeSearchText = (value: unknown) =>
    String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const compactSearchText = (value: unknown) =>
    normalizeSearchText(value).replace(/\s+/g, "");

  const findEnglishTitle = async (query: string) => {
    const trimmed = String(query || "").trim();
    if (!trimmed) return "";
    const normalizedQuery = normalizeSearchText(trimmed);
    const compactQuery = compactSearchText(trimmed);
    if (!normalizedQuery || !compactQuery) return "";

    try {
      const payload = await anilistService.search(trimmed, 1, 5);
      const mediaItems = Array.isArray(payload?.media) ? payload.media : [];
      for (const media of mediaItems) {
        const candidates = [
          media?.title?.romaji,
          media?.title?.native,
          ...(Array.isArray(media?.synonyms) ? media.synonyms : []),
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean);
        const matched = candidates.some((candidate) => {
          const normalizedCandidate = normalizeSearchText(candidate);
          if (!normalizedCandidate) return false;
          if (normalizedCandidate === normalizedQuery) return true;
          return compactSearchText(candidate) === compactQuery;
        });
        if (!matched) continue;

        const englishTitle = String(media?.title?.english || "").trim();
        if (!englishTitle) continue;
        if (normalizeSearchText(englishTitle) === normalizedQuery) continue;
        return englishTitle;
      }
    } catch {
      return "";
    }

    return "";
  };

  ipcMain.handle(
    "manga:search",
    async (
      _,
      sourceId: string,
      query: string,
      page: number,
      contextId?: string,
    ) => {
      const source = resolveMangaSource(sourceId);
      if (!source) throw new Error("Source not found");

      const controller = addContextController(contextId);
      const signal = controller?.signal;
      try {
        const trimmedQuery = String(query || "").trim();
        let effectiveQuery = query;

        if (source.searchTitlePreference === "english" && page === 1 && trimmedQuery) {
          const englishFallbackQuery = await findEnglishTitle(trimmedQuery);
          if (englishFallbackQuery) {
            effectiveQuery = englishFallbackQuery;
          }
        }

        return await source.search(effectiveQuery, page, undefined, {
          signal,
        });
      } finally {
        removeContextController(contextId, controller);
      }
    },
  );

  ipcMain.handle("manga:cancel-search-context", (_, contextId: string) => {
    const group = contextControllers.get(contextId);
    if (group) {
      for (const controller of group) {
        try {
          controller.abort();
        } catch (e) {
          console.error("Failed to abort search context:", e);
        }
      }
      contextControllers.delete(contextId);
    }
    return true;
  });

  ipcMain.handle(
    "manga:get-detail",
    async (_, sourceId: string, urlOrId: string | number) => {
      // If urlOrId is a number, it's a library item.
      if (typeof urlOrId === "number") {
        const series = await mangaQueries.getMangaSeries(urlOrId);
        if (series) {
          const titleStyle = normalizeSeriesTitleStyle(
            getSetting("seriesTitleStyle"),
          );
          return {
            title: resolveSeriesTitle(series, titleStyle, "Unknown Series"),
            title_original: series.title_original,
            title_romaji: series.title_romaji,
            title_english: series.title_english,
            description: series.description,
            cover_url: series.cover_url,
            status: series.status,
            author: series.author,
            artist: series.artist,
            genres: series.genres || [],
            reading_format: series.reading_format,
          };
        }
      }
      const source = resolveMangaSource(sourceId);
      if (!source) throw new Error("Source not found");
      return source.getDetail(urlOrId as string);
    },
  );
  ipcMain.handle(
    "manga:get-chapters",
    async (
      _,
      sourceIdOrSeriesId: string | number,
      mangaId?: string,
      contextId?: string,
    ) => {
      if (typeof sourceIdOrSeriesId === "string" && mangaId) {
        const normalizedSourceId = String(sourceIdOrSeriesId || "").trim();
        if (!isProviderSourceId(normalizedSourceId)) {
          return [];
        }
        const source = resolveMangaSource(normalizedSourceId);
        if (!source) {
          return [];
        }
        const controller = addContextController(contextId);
        const signal = controller?.signal;
        return source
          .getChapters(mangaId, { signal })
          .finally(() => removeContextController(contextId, controller));
      }
      return mangaQueries.getMangaChapters(sourceIdOrSeriesId as number);
    },
  );
  ipcMain.handle("manga:get-chapter-local-states", (_, sourceUrls: string[]) =>
    mangaQueries.getLatestMangaChapterStatesBySourceUrls(sourceUrls || []),
  );
  ipcMain.handle("manga:download-chapter", (_, series: any, chapter: any) => {
    mangaDownloader.enqueue(series, chapter);
  });
  ipcMain.handle("manga:get-download-queue", () => mangaDownloader.getQueue());
  ipcMain.handle("manga:get-download-logs", (_, id: number) =>
    mangaDownloader.getTaskLogs(id),
  );
  ipcMain.handle("manga:cancel-download", (_, id: number) => {
    mangaDownloader.cancelDownload(id);
    return true;
  });
  ipcMain.handle("manga:retry-download", (_, id: number) => {
    mangaDownloader.retryDownload(id);
    return true;
  });
  ipcMain.handle("manga:clear-finished", () => {
    mangaDownloader.clearFinished();
    return true;
  });
  ipcMain.handle("manga:cancel-all", () => {
    mangaDownloader.cancelAll();
    return true;
  });
  ipcMain.handle("manga:remove-from-queue", (_, id: number) => {
    mangaDownloader.removeFromQueue(id);
    return true;
  });
  ipcMain.handle("manga:get-series", (_, id: number) =>
    mangaQueries.getMangaSeries(id),
  );
  ipcMain.handle("manga:update-series", (_, id: number, updates: any) =>
    mangaQueries.updateMangaSeries(id, updates || {}),
  );
  ipcMain.handle("manga:get-all-series", () =>
    mangaQueries.getAllMangaSeries(),
  );
  ipcMain.handle("manga:get-chapter-count", (_, seriesId: number) =>
    mangaQueries.getMangaChapterCount(seriesId),
  );
  ipcMain.handle("manga:get-library-series", () =>
    mangaQueries.getAllMangaSeries(),
  );
  ipcMain.handle("manga:ensure-local-series-for-tracking", (_, payload: any) => {
    const seriesId = mangaQueries.ensureMangaSeriesForTracking(payload || {});
    return { seriesId };
  });

  ipcMain.handle("manga:get-tracking-accounts", () =>
    trackingService.getTrackingAccounts(),
  );
  ipcMain.handle("manga:get-tracking-entries", (_, seriesId: number) =>
    mangaQueries.getTrackingEntries(seriesId),
  );
  ipcMain.handle(
    "manga:update-tracking-progress",
    async (
      _,
      seriesId: number,
      chaptersRead: number,
      score?: number,
      status?: string,
    ) => {
      const series = await mangaQueries.getMangaSeries(seriesId);
      if (series) {
        await trackingService.updateProgress(
          series,
          chaptersRead,
          score,
          status,
        );
      }
    },
  );
  ipcMain.handle(
    "manga:update-tracking-entry",
    async (
      _,
      payload: {
        seriesId: number;
        service: "mal" | "anilist";
        remoteId?: number | string | null;
        chaptersRead: number;
        volumesRead?: number;
        score?: number | null;
        status?: string;
        totalChapters?: number | null;
        totalVolumes?: number | null;
      },
    ) => {
      await trackingService.updateTrackingEntry(payload);
    },
  );
  ipcMain.handle(
    "manga:remove-tracking-entry",
    async (
      _,
      payload: {
        seriesId: number;
        service: "mal" | "anilist";
        remoteId?: number | string | null;
      },
    ) => {
      await trackingService.removeTrackingEntry(payload);
    },
  );

  ipcMain.handle(
    "manga:login-tracking",
    async (_, service: "mal" | "anilist") => {
      return trackingService.login(service);
    },
  );
  ipcMain.handle(
    "manga:disconnect-tracking",
    async (_, service: "mal" | "anilist") => {
      return trackingService.disconnect(service);
    },
  );
  ipcMain.handle("manga:get-tracking-custom-client-id", (_, service) =>
    trackingService.getCustomClientId(service),
  );
  ipcMain.handle(
    "manga:set-tracking-custom-client-id",
    async (_, service: "mal" | "anilist", clientId: string) =>
      trackingService.setCustomClientId(service, clientId),
  );
  ipcMain.handle(
    "manga:reset-tracking-custom-client-id",
    async (_, service: "mal" | "anilist") =>
      trackingService.resetCustomClientId(service),
  );
  ipcMain.handle(
    "manga:get-friends-reading",
    async (_, anilistId?: number, malId?: number) => {
      return trackingService.getFriendsReading(anilistId, malId);
    },
  );
  ipcMain.handle(
    "manga:get-user-tracking-status",
    async (_, seriesId: number, anilistId?: number, malId?: number) => {
      return trackingService.getUserTrackingStatus(seriesId, anilistId, malId);
    },
  );
  ipcMain.handle(
    "manga:get-mangadex-total-chapters",
    async (_, seriesId: number) => {
      return trackingService.getMangaDexTotalChapters(seriesId);
    },
  );

  ipcMain.handle("manga:anilist-search", (_, query: string, page: number) =>
    anilistService.search(query, page),
  );
  ipcMain.handle(
    "manga:mangabaka-search",
    (_, query: string, page: number, limit = 10) =>
      mangabakaMetadataService.search(query, page, limit),
  );
  ipcMain.handle("manga:anilist-trending", (_, page: number) =>
    anilistService.getTrending(page),
  );
  ipcMain.handle("manga:anilist-popular", (_, page: number) =>
    anilistService.getPopular(page),
  );
  ipcMain.handle("manga:anilist-details", async (_, id: number) => {
    const detail = await getAnilistDetailsResilient(id);
    return enrichDetailWithMangabakaIdentity(detail);
  });
  ipcMain.handle("manga:mangabaka-details", async (_, id: number) => {
    const detail = await mangabakaMetadataService.getSeries(id);
    const mapped = mapMangabakaToAnilistLikeDetail(detail?.data || detail);
    if (mapped) return mapped;

    const dbSeries = mangaQueries.getMangaSeriesByMangabakaId(
      toPositiveInt(id),
    );
    return mapSeriesToAnilistLikeDetail(dbSeries);
  });
  ipcMain.handle(
    "manga:anilist-recommendations",
    (_, id: number, page: number, perPage: number) =>
      anilistService.getRecommendations(id, page, perPage),
  );
  ipcMain.handle("manga:search-mal-id-by-title", (_, anilistId: number) =>
    trackingService.searchMalIdByTitle(anilistId),
  );
}
