import {
  MangaSeries,
  TrackingAccount,
  TrackingEntry,
  FriendReading,
  UserTrackingStatus,
} from "../types/manga-types";
import axios from "axios";
import { BrowserWindow, session } from "electron";

const ANILIST_AUTH_URL = "https://anilist.co/api/v2/oauth/authorize";
const REDIRECT_URI = "https://anilist.co/api/v2/oauth/pin";
const ANILIST_URL = "https://graphql.anilist.co";
const ANILIST_REQUEST_TIMEOUT_MS = 15_000;

export interface AnilistManga {
  id: number;
  title: {
    romaji: string;
    english: string;
    native: string;
  };
  synonyms?: string[];
  coverImage: {
    extraLarge: string;
    large: string;
    medium: string;
  };
  description: string;
  countryOfOrigin: string;
  status: string;
  genres: string[];
  averageScore: number;
  format: string;
  chapters: number;
  volumes: number;
  staff: {
    edges: Array<{
      role: string;
      node: {
        name: {
          full: string;
        };
      };
    }>;
  };
}

type HttpStatusError = Error & { status: number };

export class AniListService {
  private clientId?: string;
  private rateLimitedUntilMs = 0;
  private inFlightQueries = new Map<string, Promise<any>>();
  private viewerIdCache = new Map<string, { id: number; expiresAt: number }>();
  private readonly VIEWER_ID_TTL_MS = 10 * 60 * 1000;

  constructor(clientId?: string) {
    this.clientId = clientId;
  }

  setClientId(clientId?: string) {
    this.clientId = String(clientId || "").trim() || undefined;
  }

  private async clearAniListCookies(): Promise<void> {
    try {
      const cookieStore = session.defaultSession.cookies;
      const cookies = await cookieStore.get({});
      const targets = cookies.filter((cookie) =>
        String(cookie.domain || "")
          .toLowerCase()
          .includes("anilist.co"),
      );

      for (const cookie of targets) {
        const host = String(cookie.domain || "").replace(/^\./, "");
        if (!host) continue;
        const protocol = cookie.secure ? "https" : "http";
        const path = String(cookie.path || "/");
        const url = `${protocol}://${host}${path}`;
        await cookieStore.remove(url, cookie.name);
      }
    } catch (error) {
      console.warn("[AniList] Failed to clear auth cookies:", error);
    }
  }

  // --- Metadata Methods ---

  private getTokenKey(accessToken?: string): string {
    if (!accessToken) return "anon";
    const trimmed = String(accessToken).trim();
    if (!trimmed) return "anon";
    return `auth:${trimmed.slice(-16)}`;
  }

  private buildQueryKey(
    query: string,
    variables: any = {},
    accessToken?: string,
  ): string {
    const normalizedQuery = String(query || "")
      .replace(/\s+/g, " ")
      .trim();
    const normalizedVariables =
      variables && typeof variables === "object" ? variables : {};
    return [
      this.getTokenKey(accessToken),
      normalizedQuery,
      JSON.stringify(normalizedVariables),
    ].join("|");
  }

  private parseRetryAfterMs(error: any): number {
    const retryAfterHeader = String(
      error?.response?.headers?.["retry-after"] || "",
    ).trim();
    if (!retryAfterHeader) return 60_000;

    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.max(1_000, Math.min(120_000, Math.floor(seconds * 1000)));
    }

    const retryDate = Date.parse(retryAfterHeader);
    if (Number.isFinite(retryDate)) {
      const delta = retryDate - Date.now();
      return Math.max(1_000, Math.min(120_000, delta));
    }

    return 60_000;
  }

  private isRateLimitedError(error: any): boolean {
    if (Number(error?.response?.status || 0) === 429) return true;
    if (error?.isAniListRateLimitError) return true;
    const message = String(error?.message || "").toLowerCase();
    return message.includes("too many requests");
  }

  private createRateLimitError(retryAfterMs: number): Error {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    const error: any = new Error(
      `AniList rate limited. Retry after ${seconds}s`,
    );
    error.status = 429;
    error.retryAfterMs = retryAfterMs;
    error.isAniListRateLimitError = true;
    return error;
  }

  private formatErrorBrief(error: any): string {
    const status = Number(error?.response?.status || error?.status || 0);
    const graphQlMessage = String(
      error?.response?.data?.errors?.[0]?.message || "",
    ).trim();
    const message =
      graphQlMessage || String(error?.message || "Unknown AniList error");
    return status > 0 ? `[${status}] ${message}` : message;
  }

  private async query(
    query: string,
    variables: any = {},
    accessToken?: string,
  ) {
    const now = Date.now();
    if (this.rateLimitedUntilMs > now) {
      throw this.createRateLimitError(this.rateLimitedUntilMs - now);
    }

    const requestKey = this.buildQueryKey(query, variables, accessToken);
    const existing = this.inFlightQueries.get(requestKey);
    if (existing) return existing;

    const requestPromise = (async () => {
      try {
        const response = await axios.post(
          ANILIST_URL,
          {
            query,
            variables,
          },
          {
            timeout: ANILIST_REQUEST_TIMEOUT_MS,
            headers: accessToken
              ? {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                }
              : undefined,
          },
        );

        const graphQlErrors = Array.isArray(response?.data?.errors)
          ? response.data.errors
          : [];
        if (graphQlErrors.length > 0) {
          const isRateLimited = graphQlErrors.some(
            (entry: any) => Number(entry?.status || 0) === 429,
          );
          if (isRateLimited) {
            const retryAfterMs = this.parseRetryAfterMs({
              response: { headers: response?.headers || {} },
            });
            this.rateLimitedUntilMs = Date.now() + retryAfterMs;
            throw this.createRateLimitError(retryAfterMs);
          }
          const message = String(graphQlErrors[0]?.message || "AniList error");
          const error: any = new Error(message);
          error.response = { data: { errors: graphQlErrors } };
          throw error;
        }

        return response.data.data;
      } catch (error: any) {
        const errorMessage = String(error?.message || "").toLowerCase();
        if (
          error?.code === "ECONNABORTED" ||
          errorMessage.includes("timeout")
        ) {
          const timeoutError = new Error(
            `AniList request timed out after ${Math.ceil(ANILIST_REQUEST_TIMEOUT_MS / 1000)}s`,
          ) as HttpStatusError;
          timeoutError.status = 408;
          throw timeoutError;
        }
        if (this.isRateLimitedError(error)) {
          const retryAfterMs =
            Number(error?.retryAfterMs || 0) > 0
              ? Number(error.retryAfterMs)
              : this.parseRetryAfterMs(error);
          this.rateLimitedUntilMs = Math.max(
            this.rateLimitedUntilMs,
            Date.now() + retryAfterMs,
          );
          throw this.createRateLimitError(retryAfterMs);
        }
        console.error("[AniList] API error:", this.formatErrorBrief(error));
        throw error;
      }
    })().finally(() => {
      this.inFlightQueries.delete(requestKey);
    });

    this.inFlightQueries.set(requestKey, requestPromise);
    return requestPromise;
  }

  private transformFormat(media: any): any {
    if (!media) return media;
    // Auto-detect Manhwa/Manhua based on country
    if (media.countryOfOrigin === "KR") {
      media.format = "MANHWA";
    } else if (media.countryOfOrigin === "CN") {
      media.format = "MANHUA";
    }
    // Default fallback is whatever Anilist sent (usually MANGA or ONE_SHOT)
    return media;
  }

  async search(query: string, page: number = 1, perPage: number = 20) {
    const q = `
      query ($search: String, $page: Int, $perPage: Int) {
        Page (page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
            perPage
          }
          media (search: $search, type: MANGA, sort: SEARCH_MATCH) {
            id
            title {
              romaji
              english
              native
            }
            synonyms
            coverImage {
              extraLarge
              large
            }
            description
            countryOfOrigin
            status
            genres
            averageScore
            format
          }
        }
      }
    `;

    const data = await this.query(q, { search: query, page, perPage });
    if (data?.Page?.media) {
      data.Page.media = data.Page.media.map((m: any) =>
        this.transformFormat(m),
      );
    }
    return data.Page;
  }

  async getTrending(page: number = 1, perPage: number = 20) {
    const q = `
      query ($page: Int, $perPage: Int) {
        Page (page: $page, perPage: $perPage) {
          pageInfo {
            hasNextPage
            currentPage
          }
          media (type: MANGA, sort: TRENDING_DESC) {
            id
            title {
              romaji
              english
              native
            }
            coverImage {
              extraLarge
              large
            }
            description
            countryOfOrigin
            status
            format
          }
        }
      }
    `;

    const data = await this.query(q, { page, perPage });
    if (data?.Page?.media) {
      data.Page.media = data.Page.media.map((m: any) =>
        this.transformFormat(m),
      );
    }
    return data.Page;
  }

  async getPopular(page: number = 1, perPage: number = 20) {
    const q = `
      query ($page: Int, $perPage: Int) {
        Page (page: $page, perPage: $perPage) {
          pageInfo {
            hasNextPage
            currentPage
          }
          media (type: MANGA, sort: POPULARITY_DESC) {
            id
            title {
              romaji
              english
              native
            }
            coverImage {
              extraLarge
              large
            }
            description
            countryOfOrigin
            status
            format
          }
        }
      }
    `;

    const data = await this.query(q, { page, perPage });
    if (data?.Page?.media) {
      data.Page.media = data.Page.media.map((m: any) =>
        this.transformFormat(m),
      );
    }
    return data.Page;
  }

  async getDetails(id: number) {
    const q = `
      query ($id: Int) {
        Media (id: $id, type: MANGA) {
          id
          idMal
          title {
            romaji
            english
            native
          }
          synonyms
          coverImage {
            extraLarge
            large
          }
          bannerImage
          description
          countryOfOrigin
          status
          genres
          averageScore
          format
          chapters
          volumes
          startDate {
            year
          }
          staff {
            edges {
              role
              node {
                name {
                  full
                }
              }
            }
          }
          externalLinks {
            url
            site
          }
        }
      }
    `;

    const data = await this.query(q, { id });
    return this.transformFormat(data.Media);
  }

  async getByMalId(malId: number) {
    const normalizedMalId = Number(malId || 0);
    if (!Number.isFinite(normalizedMalId) || normalizedMalId <= 0) return null;

    const q = `
      query ($idMal: Int) {
        Media (idMal: $idMal, type: MANGA) {
          id
          idMal
          title {
            romaji
            english
            native
          }
          synonyms
          coverImage {
            extraLarge
            large
          }
          bannerImage
          description
          countryOfOrigin
          status
          genres
          averageScore
          format
          chapters
          volumes
          startDate {
            year
          }
          staff {
            edges {
              role
              node {
                name {
                  full
                }
              }
            }
          }
          externalLinks {
            url
            site
          }
        }
      }
    `;

    const data = await this.query(q, { idMal: Math.floor(normalizedMalId) });
    return this.transformFormat(data.Media);
  }

  /** Returns the MAL ID for an AniList entry, falling back to a MAL title search if `idMal` is null. */
  async searchMalIdByTitle(
    anilistId: number,
    mal: {
      searchByTitle(
        titles: string[],
        expectedTypes: string[],
      ): Promise<number | null>;
    },
  ): Promise<number | null> {
    try {
      const detail = await this.getDetails(anilistId);
      if (!detail) return null;

      // Fast path: idMal already set.
      const existingMalId = Number(detail.idMal || 0);
      if (existingMalId > 0) return existingMalId;

      // Map AniList format/country to expected MAL media_type values.
      const format = String(detail.format || "").toUpperCase();
      const country = String(detail.countryOfOrigin || "").toUpperCase();
      let expectedMalTypes: string[];
      if (format === "NOVEL") {
        expectedMalTypes = ["light_novel", "novel"];
      } else if (format === "ONE_SHOT") {
        expectedMalTypes = ["one_shot", "manga"];
      } else if (format === "MANHWA" || country === "KR") {
        expectedMalTypes = ["manhwa"];
      } else if (format === "MANHUA" || country === "CN") {
        expectedMalTypes = ["manhua"];
      } else {
        // Default: standard Japanese manga.
        expectedMalTypes = ["manga", "one_shot"];
      }

      // Collect title candidates.
      const titles: string[] = [
        String(detail.title?.romaji || ""),
        String(detail.title?.english || ""),
        String(detail.title?.native || ""),
        ...((detail.synonyms as string[]) ?? []),
      ].filter(Boolean);

      if (titles.length === 0) return null;

      const malId = await mal.searchByTitle(titles, expectedMalTypes);
      if (malId) {
        console.log(
          `[AniList] Resolved MAL ID ${malId} for AniList ID ${anilistId} via title search`,
        );
      }
      return malId;
    } catch (error) {
      console.warn(
        `[AniList] searchMalIdByTitle failed for ID ${anilistId}:`,
        (error as any)?.message,
      );
      return null;
    }
  }

  async getRecommendations(id: number, page: number = 1, perPage: number = 5) {
    const q = `
      query ($id: Int, $page: Int, $perPage: Int) {
        Media(id: $id, type: MANGA) {
          recommendations(page: $page, perPage: $perPage, sort: [RATING_DESC, ID]) {
            pageInfo {
              hasNextPage
              currentPage
            }
            nodes {
              id
              rating
              mediaRecommendation {
                id
                title {
                  romaji
                  english
                  native
                }
                coverImage {
                  extraLarge
                  large
                }
                format
                status
                averageScore
                countryOfOrigin
              }
            }
          }
        }
      }
    `;

    const data = await this.query(q, { id, page, perPage });
    const recs = data?.Media?.recommendations;
    if (!recs)
      return { nodes: [], pageInfo: { hasNextPage: false, currentPage: page } };

    const nodes = (recs.nodes || [])
      .filter((node: any) => node?.mediaRecommendation != null)
      .map((node: any) => ({
        ...node,
        mediaRecommendation: this.transformFormat(node.mediaRecommendation),
      }));

    return { nodes, pageInfo: recs.pageInfo };
  }

  // --- Authentication & Tracking Methods ---

  async authenticate(): Promise<string> {
    if (!this.clientId) {
      throw new Error("Client ID is required for authentication");
    }
    await this.clearAniListCookies();

    return new Promise((resolve, reject) => {
      let settled = false;
      const finishResolve = (value: string) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const finishReject = (error: any) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const authWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      const consumeUrl = (candidateUrl: string) => {
        if (settled) return;
        const nextUrl = String(candidateUrl || "").trim();
        if (!nextUrl) return;

        let token = "";
        try {
          token = this.extractAccessTokenFromCallbackUrl(nextUrl);
        } catch {
          token = "";
        }
        if (!token) return;

        finishResolve(token);
        if (!authWindow.isDestroyed()) {
          authWindow.close();
        }
      };

      const url = `${ANILIST_AUTH_URL}?client_id=${this.clientId}&response_type=token`;
      authWindow.loadURL(url);

      authWindow.webContents.on("will-navigate", (_event, nextUrl) => {
        consumeUrl(nextUrl);
      });

      authWindow.webContents.on("did-navigate", (_event, nextUrl) => {
        consumeUrl(nextUrl);
      });

      authWindow.webContents.on("did-navigate-in-page", (_event, nextUrl) => {
        consumeUrl(nextUrl);
      });

      authWindow.on("closed", () => {
        if (settled) return;
        const cancelledError: any = new Error("Login cancelled by user");
        cancelledError.code = "oauth_cancelled";
        cancelledError.isUserCancellation = true;
        finishReject(cancelledError);
      });
    });
  }

  private extractAccessTokenFromCallbackUrl(url: string): string {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return "";
    }

    const redirect = new URL(REDIRECT_URI);
    const isExpectedRedirect =
      parsed.origin === redirect.origin &&
      parsed.pathname === redirect.pathname;
    if (!isExpectedRedirect) return "";

    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const tokenFromHash = String(hashParams.get("access_token") || "").trim();
    const tokenFromQuery = String(
      parsed.searchParams.get("access_token") || "",
    ).trim();
    return tokenFromHash || tokenFromQuery;
  }

  async updateProgress(
    entry: TrackingEntry,
    chaptersRead: number,
    account: TrackingAccount,
    options: {
      status?: string;
      score?: number | null;
      volumesRead?: number;
      startedAt?: { year: number; month: number; day: number } | null;
    } = {},
  ) {
    const query = `
      mutation ($mediaId: Int, $progress: Int, $progressVolumes: Int, $status: MediaListStatus, $score: Float, $startedAt: FuzzyDateInput) {
        SaveMediaListEntry (mediaId: $mediaId, progress: $progress, progressVolumes: $progressVolumes, status: $status, score: $score, startedAt: $startedAt) {
          id
        }
      }
    `;
    const safeProgress = Number.isFinite(Number(chaptersRead))
      ? Math.max(0, Math.floor(Number(chaptersRead)))
      : 0;
    const mediaId = Number.parseInt(String(entry.remote_id || ""), 10);
    const variables: Record<string, any> = {
      mediaId,
      progress: safeProgress,
    };
    if (Number.isFinite(Number(options.volumesRead))) {
      const safeVolumesRead = Math.max(
        0,
        Math.floor(Number(options.volumesRead)),
      );
      variables.progressVolumes = safeVolumesRead;
    }
    const normalizedStatus = String(options.status || "")
      .trim()
      .toUpperCase();
    const statusForProgress =
      safeProgress <= 0 &&
      (!normalizedStatus ||
        normalizedStatus === "CURRENT" ||
        normalizedStatus === "REPEATING" ||
        normalizedStatus === "READING")
        ? "PLANNING"
        : normalizedStatus;
    if (statusForProgress) {
      variables.status = statusForProgress;
    }
    const normalizedScore = Number(options.score);
    if (
      options.score !== null &&
      options.score !== undefined &&
      Number.isFinite(normalizedScore) &&
      normalizedScore > 0
    ) {
      variables.score = normalizedScore;
    }
    const startedAtYear = Number(options.startedAt?.year || 0);
    const startedAtMonth = Number(options.startedAt?.month || 0);
    const startedAtDay = Number(options.startedAt?.day || 0);
    if (safeProgress <= 0) {
      // Explicitly clear start date when there is no reading progress.
      variables.startedAt = null;
    } else if (
      Number.isFinite(startedAtYear) &&
      startedAtYear > 0 &&
      Number.isFinite(startedAtMonth) &&
      startedAtMonth >= 1 &&
      startedAtMonth <= 12 &&
      Number.isFinite(startedAtDay) &&
      startedAtDay >= 1 &&
      startedAtDay <= 31
    ) {
      variables.startedAt = {
        year: Math.floor(startedAtYear),
        month: Math.floor(startedAtMonth),
        day: Math.floor(startedAtDay),
      };
    }

    await this.query(query, variables, account.access_token || undefined);
  }

  async removeEntry(entry: TrackingEntry, account: TrackingAccount) {
    const mediaId = Number.parseInt(String(entry.remote_id || ""), 10);
    if (!Number.isFinite(mediaId) || mediaId <= 0) return;

    const viewerId = await this.getViewerId(account).catch(() => null);
    const candidateEntryIds = new Set<number>();
    let resolvedListLookup = false;
    const addCandidateId = (value: unknown) => {
      const id = Number(value || 0);
      if (Number.isFinite(id) && id > 0) {
        candidateEntryIds.add(Math.floor(id));
      }
    };

    const mediaLookupQuery = `
      query ($mediaId: Int) {
        Media(id: $mediaId, type: MANGA) {
          mediaListEntry {
            id
          }
        }
      }
    `;
    try {
      const mediaLookup = await this.query(
        mediaLookupQuery,
        { mediaId },
        account.access_token || undefined,
      );
      resolvedListLookup = true;
      addCandidateId(mediaLookup?.Media?.mediaListEntry?.id);
    } catch {}

    if (viewerId && viewerId > 0) {
      const mediaListLookupQuery = `
        query ($mediaId: Int, $userId: Int) {
          MediaList(mediaId: $mediaId, userId: $userId, type: MANGA) {
            id
          }
        }
      `;
      try {
        const mediaListLookup = await this.query(
          mediaListLookupQuery,
          { mediaId, userId: viewerId },
          account.access_token || undefined,
        );
        resolvedListLookup = true;
        addCandidateId(mediaListLookup?.MediaList?.id);
      } catch {}
    }

    if (candidateEntryIds.size === 0) {
      if (resolvedListLookup) {
        // A successful lookup with no matching list entry means the remote row
        // is already gone, so local cleanup is safe.
        return;
      }
      throw new Error("AniList entry could not be located for removal");
    }

    const deleteMutation = `
      mutation ($id: Int) {
        DeleteMediaListEntry(id: $id) {
          deleted
        }
      }
    `;
    let deletedAny = false;
    let removedOrMissing = false;
    let lastDeleteError: any = null;
    for (const listEntryId of candidateEntryIds) {
      try {
        const deletion = await this.query(
          deleteMutation,
          { id: listEntryId },
          account.access_token || undefined,
        );
        if (deletion?.DeleteMediaListEntry?.deleted) {
          deletedAny = true;
          removedOrMissing = true;
        }
      } catch (error: any) {
        lastDeleteError = error;
        const status = Number(error?.response?.status || error?.status || 0);
        const message = String(
          error?.response?.data?.errors?.[0]?.message || error?.message || "",
        ).toLowerCase();
        if (status === 404 || message.includes("not found")) {
          // Treat missing list entry as already removed.
          removedOrMissing = true;
          continue;
        }
      }
    }

    if (!deletedAny && !removedOrMissing) {
      if (lastDeleteError) throw lastDeleteError;
      throw new Error("AniList did not confirm entry deletion");
    }

    // Verify that the list entry is actually gone after deletion.
    if (viewerId && viewerId > 0) {
      try {
        const verifyQuery = `
          query ($mediaId: Int, $userId: Int) {
            MediaList(mediaId: $mediaId, userId: $userId, type: MANGA) {
              id
            }
          }
        `;
        const verify = await this.query(
          verifyQuery,
          { mediaId, userId: viewerId },
          account.access_token || undefined,
        );
        const remainingId = Number(verify?.MediaList?.id || 0);
        if (Number.isFinite(remainingId) && remainingId > 0) {
          throw new Error("AniList entry still exists after deletion");
        }
      } catch (error: any) {
        const status = Number(error?.response?.status || error?.status || 0);
        if (status !== 404) throw error;
        console.warn(
          "[AniList] Post-delete verification returned 404; treating as removed.",
        );
      }
      return;
    }

    try {
      const verifyMediaLookup = await this.query(
        mediaLookupQuery,
        { mediaId },
        account.access_token || undefined,
      );
      const remainingMediaEntryId = Number(
        verifyMediaLookup?.Media?.mediaListEntry?.id || 0,
      );
      if (Number.isFinite(remainingMediaEntryId) && remainingMediaEntryId > 0) {
        throw new Error("AniList entry still exists after deletion");
      }
    } catch (error: any) {
      const status = Number(error?.response?.status || error?.status || 0);
      if (status !== 404) throw error;
      console.warn(
        "[AniList] Post-delete media lookup returned 404; treating as removed.",
      );
    }
  }

  async getCurrentUserStatus(
    mediaId: number,
    account: TrackingAccount,
  ): Promise<UserTrackingStatus> {
    if (!mediaId) {
      return {
        service: "anilist",
        remote_id: undefined,
        has_entry: false,
      };
    }

    const query = `
      query ($mediaId: Int) {
        Media(id: $mediaId, type: MANGA) {
          chapters
          volumes
          mediaListEntry {
            status
            progress
            progressVolumes
            score(format: POINT_10_DECIMAL)
            updatedAt
          }
        }
      }
    `;

    const publicChaptersQuery = `
      query ($mediaId: Int) {
        Media(id: $mediaId, type: MANGA) {
          chapters
          volumes
        }
      }
    `;

    try {
      const data = await this.query(
        query,
        { mediaId },
        account.access_token || undefined,
      );
      const totalChapters = Number(data?.Media?.chapters || 0);
      const totalVolumes = Number(data?.Media?.volumes || 0);
      const entry = data?.Media?.mediaListEntry;
      if (!entry) {
        return {
          service: "anilist",
          remote_id: String(mediaId),
          has_entry: false,
          total_chapters:
            Number.isFinite(totalChapters) && totalChapters > 0
              ? totalChapters
              : null,
          total_volumes:
            Number.isFinite(totalVolumes) && totalVolumes > 0
              ? totalVolumes
              : null,
        };
      }

      const updatedAt = Number(entry?.updatedAt || 0);
      const rawScore = Number(entry?.score);
      const volumesRead = Number(entry?.progressVolumes ?? 0);
      return {
        service: "anilist",
        remote_id: String(mediaId),
        has_entry: true,
        status: String(entry?.status || "CURRENT").trim(),
        chapters_read: this.parseProgress(entry?.progress),
        total_chapters:
          Number.isFinite(totalChapters) && totalChapters > 0
            ? totalChapters
            : null,
        volumes_read:
          Number.isFinite(volumesRead) && volumesRead > 0 ? volumesRead : 0,
        total_volumes:
          Number.isFinite(totalVolumes) && totalVolumes > 0
            ? totalVolumes
            : null,
        score: Number.isFinite(rawScore) && rawScore > 0 ? rawScore : null,
        last_synced_at:
          Number.isFinite(updatedAt) && updatedAt > 0
            ? new Date(updatedAt * 1000).toISOString()
            : undefined,
      };
    } catch (error) {
      if (this.isRateLimitedError(error)) {
        return {
          service: "anilist",
          remote_id: String(mediaId),
          has_entry: false,
          status_unavailable: true,
        };
      }
      console.warn(
        "[AniList] Authenticated status query failed; trying public chapters.",
      );
    }

    try {
      const publicData = await this.query(publicChaptersQuery, { mediaId });
      const totalChapters = Number(publicData?.Media?.chapters || 0);
      const totalVolumes = Number(publicData?.Media?.volumes || 0);
      return {
        service: "anilist",
        remote_id: String(mediaId),
        has_entry: false,
        status_unavailable: true,
        total_chapters:
          Number.isFinite(totalChapters) && totalChapters > 0
            ? totalChapters
            : null,
        total_volumes:
          Number.isFinite(totalVolumes) && totalVolumes > 0
            ? totalVolumes
            : null,
      };
    } catch {
      return {
        service: "anilist",
        remote_id: String(mediaId),
        has_entry: false,
        status_unavailable: true,
      };
    }
  }

  async getTotalChapters(mediaId: number): Promise<number | null> {
    if (!mediaId) return null;
    const q = `
      query ($mediaId: Int) {
        Media(id: $mediaId, type: MANGA) {
          chapters
        }
      }
    `;
    try {
      const data = await this.query(q, { mediaId });
      const total = Number(data?.Media?.chapters || 0);
      return Number.isFinite(total) && total > 0 ? total : null;
    } catch {
      return null;
    }
  }

  async getTotalVolumes(mediaId: number): Promise<number | null> {
    if (!mediaId) return null;
    const q = `
      query ($mediaId: Int) {
        Media(id: $mediaId, type: MANGA) {
          volumes
        }
      }
    `;
    try {
      const data = await this.query(q, { mediaId });
      const total = Number(data?.Media?.volumes || 0);
      return Number.isFinite(total) && total > 0 ? total : null;
    } catch {
      return null;
    }
  }

  private parseProgress(progress: unknown): number {
    if (typeof progress === "number" && Number.isFinite(progress)) {
      return progress;
    }
    if (typeof progress === "string") {
      const match = progress.match(/\d+/);
      if (match) return parseInt(match[0], 10);
    }
    return 0;
  }

  private isActiveAniListMediaStatus(status: unknown): boolean {
    if (typeof status !== "string") return false;
    const normalized = status.trim().toUpperCase();
    return normalized === "CURRENT" || normalized === "REPEATING";
  }

  private isActiveAniListActivityStatus(status: unknown): boolean {
    if (typeof status !== "string") return false;
    const normalized = status.trim().toLowerCase();

    // Keep statuses that indicate ongoing reading activity.
    if (normalized.includes("read chapter")) return true;
    if (normalized.includes("reread")) return true;
    if (normalized.includes("reading")) return true;

    // Exclude list states that are not currently reading.
    if (normalized.includes("completed")) return false;
    if (normalized.includes("dropped")) return false;
    if (normalized.includes("paused")) return false;
    if (normalized.includes("plan")) return false;

    return false;
  }

  private sortFriendReadings(values: Iterable<FriendReading>): FriendReading[] {
    return Array.from(values).sort((a, b) => b.progress - a.progress);
  }

  private async getViewerId(account: TrackingAccount): Promise<number | null> {
    const cacheKey = this.getTokenKey(account.access_token);
    const now = Date.now();
    const cached = this.viewerIdCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.id;

    const viewerIdQuery = `
      query {
        Viewer {
          id
        }
      }
    `;
    const data = await this.query(viewerIdQuery, {}, account.access_token);
    const viewerId = Number(data?.Viewer?.id || 0);
    if (viewerId > 0) {
      this.viewerIdCache.set(cacheKey, {
        id: viewerId,
        expiresAt: now + this.VIEWER_ID_TTL_MS,
      });
      return viewerId;
    }
    return null;
  }

  async getFriendsReading(
    mediaId: number,
    account: TrackingAccount,
  ): Promise<FriendReading[]> {
    if (!account.access_token) return [];

    const followingReadersQuery = `
      query ($mediaId: Int, $page: Int, $perPage: Int) {
        Viewer {
          id
        }
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            hasNextPage
          }
          mediaList(
            mediaId: $mediaId
            type: MANGA
            isFollowing: true
            status_in: [CURRENT, REPEATING]
            sort: UPDATED_TIME_DESC
          ) {
            status
            progress
            user {
              id
              name
              avatar {
                medium
              }
            }
          }
        }
      }
    `;

    const followingUsersQuery = `
      query ($viewerId: Int!, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            hasNextPage
          }
          following(userId: $viewerId) {
            id
            name
            avatar {
              medium
            }
          }
        }
      }
    `;

    const followerUsersQuery = `
      query ($viewerId: Int!, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            hasNextPage
          }
          followers(userId: $viewerId) {
            id
            name
            avatar {
              medium
            }
          }
        }
      }
    `;

    const readingUsersQuery = `
      query ($mediaId: Int, $page: Int, $perPage: Int, $userIds: [Int]) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            hasNextPage
          }
          mediaList(
            mediaId: $mediaId
            type: MANGA
            userId_in: $userIds
            status_in: [CURRENT, REPEATING]
            sort: UPDATED_TIME_DESC
          ) {
            status
            progress
            user {
              id
              name
              avatar {
                medium
              }
            }
          }
        }
      }
    `;

    const resultByUserId = new Map<number, FriendReading>();
    let viewerId: number | null = null;

    const upsertFriend = (entry: any, user: any) => {
      if (!user || typeof user.id !== "number") return;
      if (viewerId !== null && user.id === viewerId) return;
      if (!this.isActiveAniListMediaStatus(entry?.status)) return;
      resultByUserId.set(user.id, {
        username: user.name || `User ${user.id}`,
        avatar_url: user.avatar?.medium || undefined,
        profile_url: user.name
          ? `https://anilist.co/user/${encodeURIComponent(user.name)}`
          : undefined,
        status: entry.status || "CURRENT",
        progress: this.parseProgress(entry.progress),
        service: "anilist",
      });
    };

    // Fast path: paginated "following" readers for this manga.
    try {
      let page = 1;
      let hasNextPage = true;
      while (hasNextPage && page <= 10) {
        const followingReadersData = await this.query(
          followingReadersQuery,
          { mediaId, page, perPage: 50 },
          account.access_token,
        );
        if (typeof followingReadersData?.Viewer?.id === "number") {
          viewerId = followingReadersData.Viewer.id;
        }

        const entries = followingReadersData?.Page?.mediaList ?? [];
        for (const entry of entries) {
          upsertFriend(entry, entry?.user);
        }

        hasNextPage = !!followingReadersData?.Page?.pageInfo?.hasNextPage;
        page += 1;
      }
    } catch (error) {
      if (this.isRateLimitedError(error)) {
        return [];
      }
      console.warn("[AniList] isFollowing readers query failed.");
    }

    if (resultByUserId.size > 0) {
      return this.sortFriendReadings(resultByUserId.values());
    }

    // Fallback 1: collect full social graph (paginated).
    const following: any[] = [];
    const followers: any[] = [];
    try {
      if (viewerId === null) {
        viewerId = await this.getViewerId(account);
      }

      if (viewerId !== null) {
        let followPage = 1;
        let followHasNext = true;
        while (followHasNext && followPage <= 10) {
          const followData = await this.query(
            followingUsersQuery,
            { viewerId, page: followPage, perPage: 50 },
            account.access_token,
          );
          const batch = followData?.Page?.following ?? [];
          following.push(...batch);
          followHasNext = !!followData?.Page?.pageInfo?.hasNextPage;
          followPage += 1;
        }

        let followerPage = 1;
        let followerHasNext = true;
        while (followerHasNext && followerPage <= 10) {
          const followerData = await this.query(
            followerUsersQuery,
            { viewerId, page: followerPage, perPage: 50 },
            account.access_token,
          );
          const batch = followerData?.Page?.followers ?? [];
          followers.push(...batch);
          followerHasNext = !!followerData?.Page?.pageInfo?.hasNextPage;
          followerPage += 1;
        }
      }
    } catch (error) {
      if (this.isRateLimitedError(error)) {
        return [];
      }
      console.warn("[AniList] Social graph fallback query failed.");
    }

    const friendIds = new Set<number>();
    const usersById = new Map<number, any>();
    for (const user of [...following, ...followers]) {
      if (!user || typeof user.id !== "number") continue;
      if (viewerId !== null && user.id === viewerId) continue;
      friendIds.add(user.id);
      if (!usersById.has(user.id)) usersById.set(user.id, user);
    }
    const userIds = Array.from(friendIds.values());
    if (userIds.length === 0) return [];

    try {
      let readersPage = 1;
      let hasNextPage = true;
      while (hasNextPage && readersPage <= 10) {
        const readersData = await this.query(
          readingUsersQuery,
          { mediaId, page: readersPage, perPage: 50, userIds },
          account.access_token,
        );

        const readerEntries = readersData?.Page?.mediaList ?? [];
        for (const entry of readerEntries) {
          const user = entry?.user;
          if (!user || typeof user.id !== "number") continue;
          if (!friendIds.has(user.id)) continue;
          upsertFriend(entry, user);
        }

        hasNextPage = !!readersData?.Page?.pageInfo?.hasNextPage;
        readersPage += 1;
      }
    } catch (error) {
      if (this.isRateLimitedError(error)) {
        return this.sortFriendReadings(resultByUserId.values());
      }
      // Fallback 2: if userId_in is unsupported, query multiple users per request
      // using GraphQL aliases (avoids per-user request spam).
      console.warn(
        "[AniList] userId_in query failed; falling back to alias checks.",
      );

      const FALLBACK_CHUNK = 20;
      let shouldAbortAliases = false;
      for (let i = 0; i < userIds.length; i += FALLBACK_CHUNK) {
        const chunk = userIds.slice(i, i + FALLBACK_CHUNK);
        const aliasFields = chunk
          .map(
            (id) => `
              u_${id}: MediaList(mediaId: $mediaId, userId: ${id}, type: MANGA) {
                status
                progress
              }`,
          )
          .join("\n");

        const aliasQuery = `
          query ($mediaId: Int) {
            ${aliasFields}
          }
        `;

        try {
          const data = await this.query(
            aliasQuery,
            { mediaId },
            account.access_token,
          );
          for (const id of chunk) {
            const entry = data?.[`u_${id}`];
            if (!entry) continue;
            if (!this.isActiveAniListMediaStatus(entry.status)) continue;
            const user = usersById.get(id);
            if (!user) continue;
            upsertFriend(entry, user);
          }
        } catch (innerError) {
          if (this.isRateLimitedError(innerError)) {
            shouldAbortAliases = true;
            break;
          }
          console.warn("[AniList] Alias fallback chunk failed.");
        }
      }
      if (shouldAbortAliases) {
        return this.sortFriendReadings(resultByUserId.values());
      }
    }

    return this.sortFriendReadings(resultByUserId.values());
  }
}

// Singleton instance for metadata usage (no Client ID needed)
export const anilistService = new AniListService();
