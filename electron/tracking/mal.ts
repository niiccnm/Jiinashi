import {
  MangaSeries,
  TrackingAccount,
  TrackingEntry,
  FriendReading,
  UserTrackingStatus,
} from "../types/manga-types";
import axios from "axios";
import { BrowserWindow, session } from "electron";
import crypto from "crypto";
import * as mangaQueries from "../database/queries/manga";

const MAL_AUTH_URL = "https://myanimelist.net/v1/oauth2/authorize";
const MAL_TOKEN_URL = "https://myanimelist.net/v1/oauth2/token";
const REDIRECT_URI = "http://localhost";

export class MALService {
  private clientId: string;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  setClientId(clientId: string) {
    this.clientId = String(clientId || "").trim();
  }

  private async clearMalCookies(): Promise<void> {
    try {
      const cookieStore = session.defaultSession.cookies;
      const cookies = await cookieStore.get({});
      const targets = cookies.filter((cookie) =>
        String(cookie.domain || "")
          .toLowerCase()
          .includes("myanimelist.net"),
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
      console.warn("[MAL] Failed to clear auth cookies:", error);
    }
  }

  async authenticate(): Promise<{ accessToken: string; refreshToken: string }> {
    if (!this.clientId) {
      throw new Error("MyAnimeList client ID is unavailable");
    }
    await this.clearMalCookies();
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = codeVerifier; // Use plain for simplicity and reliability

    return new Promise((resolve, reject) => {
      let settled = false;
      const finishResolve = (value: {
        accessToken: string;
        refreshToken: string;
      }) => {
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

      const url = `${MAL_AUTH_URL}?response_type=code&client_id=${this.clientId}&code_challenge=${codeChallenge}&code_challenge_method=plain&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

      authWindow.loadURL(url);

      const filter = {
        urls: [
          `${REDIRECT_URI}/?code=*`, // http://localhost/?code=...
          `${REDIRECT_URI}/*?code=*`, // Fallback for path variations
        ],
      };

      authWindow.webContents.session.webRequest.onBeforeRequest(
        filter,
        async (details, callback) => {
          if (settled) {
            callback({ cancel: true });
            return;
          }

          const url = new URL(details.url);
          const code = url.searchParams.get("code");

          if (code) {
            try {
              const tokens = await this.exchangeCodeForTokens(
                code,
                codeVerifier,
              );
              finishResolve(tokens);
              authWindow.close();
            } catch (err) {
              finishReject(err);
              authWindow.close();
            }
            callback({ cancel: true });
            return;
          }
          callback({ cancel: true });
        },
      );

      authWindow.on("closed", () => {
        const cancelledError: any = new Error("Login cancelled by user");
        cancelledError.code = "oauth_cancelled";
        cancelledError.isUserCancellation = true;
        finishReject(cancelledError);
      });
    });
  }

  private generateCodeVerifier() {
    return crypto.randomBytes(32).toString("base64url");
  }

  private async exchangeCodeForTokens(code: string, codeVerifier: string) {
    const params = new URLSearchParams();
    params.append("client_id", this.clientId);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("code_verifier", codeVerifier);
    params.append("redirect_uri", REDIRECT_URI);

    const response = await axios.post(MAL_TOKEN_URL, params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
    };
  }

  private async refreshAccountToken(
    account: TrackingAccount,
  ): Promise<TrackingAccount | null> {
    const refreshToken = String(account.refresh_token || "").trim();
    if (!refreshToken) return null;

    try {
      const params = new URLSearchParams();
      params.append("client_id", this.clientId);
      params.append("grant_type", "refresh_token");
      params.append("refresh_token", refreshToken);

      const response = await axios.post(MAL_TOKEN_URL, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      const nextAccessToken = String(response.data?.access_token || "").trim();
      if (!nextAccessToken) return null;
      const nextRefreshToken =
        String(response.data?.refresh_token || "").trim() || refreshToken;

      const updated: TrackingAccount = {
        ...account,
        service: "mal",
        access_token: nextAccessToken,
        refresh_token: nextRefreshToken,
        is_active: true,
      };

      try {
        mangaQueries.upsertTrackingAccount(updated);
      } catch (storageError) {
        console.warn("[MAL] Failed to persist refreshed token:", storageError);
      }

      return updated;
    } catch (error) {
      console.warn("[MAL] Failed to refresh MAL access token:", error);
      return null;
    }
  }

  async updateProgress(
    entry: TrackingEntry,
    chaptersRead: number,
    account: TrackingAccount,
    options: {
      status?: string;
      score?: number | null;
      volumesRead?: number;
      startedAt?: string | null;
    } = {},
  ) {
    const url = `https://api.myanimelist.net/v2/manga/${entry.remote_id}/my_list_status`;
    const data = new URLSearchParams();
    const safeProgress = Number.isFinite(Number(chaptersRead))
      ? Math.max(0, Math.floor(Number(chaptersRead)))
      : 0;
    data.append("num_chapters_read", safeProgress.toString());
    if (Number.isFinite(Number(options.volumesRead))) {
      const safeVolumesRead = Math.max(
        0,
        Math.floor(Number(options.volumesRead)),
      );
      data.append("num_volumes_read", safeVolumesRead.toString());
    }
    const normalizedStatus = String(options.status || "")
      .trim()
      .toLowerCase();
    if (normalizedStatus) {
      data.append("status", normalizedStatus);
    }
    const normalizedScore = Number(options.score);
    if (
      options.score !== null &&
      options.score !== undefined &&
      Number.isFinite(normalizedScore) &&
      normalizedScore > 0
    ) {
      data.append("score", Math.round(normalizedScore).toString());
    }
    const normalizedStartedAt = String(options.startedAt || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedStartedAt)) {
      data.append("start_date", normalizedStartedAt);
    }

    await axios.put(url, data, {
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
  }

  async removeEntry(entry: TrackingEntry, account: TrackingAccount) {
    const url = `https://api.myanimelist.net/v2/manga/${entry.remote_id}/my_list_status`;
    await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${account.access_token}`,
      },
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 404,
    });
  }

  async getCurrentUserStatus(
    mangaId: number,
    account: TrackingAccount,
  ): Promise<UserTrackingStatus> {
    if (!mangaId) {
      return {
        service: "mal",
        remote_id: undefined,
        has_entry: false,
      };
    }

    const fetchPublicTotals = async () => {
      try {
        const publicResponse = await axios.get(
          `https://api.myanimelist.net/v2/manga/${mangaId}`,
          {
            headers: {
              "X-MAL-CLIENT-ID": this.clientId,
            },
            params: {
              fields: "num_chapters,num_volumes",
            },
            timeout: 12000,
          },
        );
        const chapters = Number(publicResponse.data?.num_chapters || 0);
        const volumes = Number(publicResponse.data?.num_volumes || 0);
        return {
          chapters: Number.isFinite(chapters) && chapters > 0 ? chapters : null,
          volumes: Number.isFinite(volumes) && volumes > 0 ? volumes : null,
        };
      } catch {
        return {
          chapters: null,
          volumes: null,
        };
      }
    };

    const fetchAuthorizedTotals = async (accessToken: string) => {
      try {
        const totalResponse = await axios.get(
          `https://api.myanimelist.net/v2/manga/${mangaId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            params: {
              fields: "num_chapters,num_volumes",
            },
            timeout: 12000,
          },
        );
        const chapters = Number(totalResponse.data?.num_chapters || 0);
        const volumes = Number(totalResponse.data?.num_volumes || 0);
        return {
          chapters: Number.isFinite(chapters) && chapters > 0 ? chapters : null,
          volumes: Number.isFinite(volumes) && volumes > 0 ? volumes : null,
        };
      } catch {
        return {
          chapters: null,
          volumes: null,
        };
      }
    };

    let accessToken = String(account.access_token || "").trim();
    if (!accessToken) {
      const totals = await fetchPublicTotals();
      return {
        service: "mal",
        remote_id: String(mangaId),
        has_entry: false,
        status_unavailable: true,
        total_chapters: totals.chapters,
        total_volumes: totals.volumes,
      };
    }

    let response: any = null;
    try {
      response = await axios.get(
        `https://api.myanimelist.net/v2/manga/${mangaId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params: {
            fields: "my_list_status,num_chapters,num_volumes",
          },
          timeout: 12000,
        },
      );
    } catch (error) {
      const statusCode = Number((error as any)?.response?.status || 0);
      if ((statusCode === 401 || statusCode === 403) && account.refresh_token) {
        const refreshedAccount = await this.refreshAccountToken(account);
        const refreshedToken = String(
          refreshedAccount?.access_token || "",
        ).trim();
        if (refreshedToken) {
          accessToken = refreshedToken;
          try {
            response = await axios.get(
              `https://api.myanimelist.net/v2/manga/${mangaId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
                params: {
                  fields: "my_list_status,num_chapters,num_volumes",
                },
                timeout: 12000,
              },
            );
          } catch (retryError) {
            console.warn(
              "[MAL] Authenticated status fetch failed after token refresh:",
              retryError,
            );
          }
        }
      }
    }

    if (!response) {
      const authorizedTotals = await fetchAuthorizedTotals(accessToken);
      if (
        authorizedTotals.chapters !== null ||
        authorizedTotals.volumes !== null
      ) {
        return {
          service: "mal",
          remote_id: String(mangaId),
          has_entry: false,
          status_unavailable: true,
          total_chapters: authorizedTotals.chapters,
          total_volumes: authorizedTotals.volumes,
        };
      }

      console.warn(
        "[MAL] Failed to fetch authenticated user status, trying public chapters",
      );
      const totals = await fetchPublicTotals();
      return {
        service: "mal",
        remote_id: String(mangaId),
        has_entry: false,
        status_unavailable: true,
        total_chapters: totals.chapters,
        total_volumes: totals.volumes,
      };
    }

    const totalChapters = Number(response.data?.num_chapters || 0);
    const totalVolumes = Number(response.data?.num_volumes || 0);
    const listStatus = response.data?.my_list_status;
    if (!listStatus) {
      const publicTotals = await fetchPublicTotals();
      const fallbackChapterTotal =
        Number.isFinite(totalChapters) && totalChapters > 0
          ? totalChapters
          : publicTotals.chapters;
      const fallbackVolumeTotal =
        Number.isFinite(totalVolumes) && totalVolumes > 0
          ? totalVolumes
          : publicTotals.volumes;
      return {
        service: "mal",
        remote_id: String(mangaId),
        has_entry: false,
        total_chapters: fallbackChapterTotal,
        total_volumes: fallbackVolumeTotal,
      };
    }

    const rawScore = Number(listStatus?.score);
    const chaptersReadValue = Number(listStatus?.num_chapters_read || 0);
    const volumesReadValue = Number(listStatus?.num_volumes_read || 0);
    const publicTotals = await fetchPublicTotals();
    const resolvedChapterTotal =
      Number.isFinite(totalChapters) && totalChapters > 0
        ? totalChapters
        : publicTotals.chapters;
    const resolvedVolumeTotal =
      Number.isFinite(totalVolumes) && totalVolumes > 0
        ? totalVolumes
        : publicTotals.volumes;
    return {
      service: "mal",
      remote_id: String(mangaId),
      has_entry: true,
      status: String(listStatus?.status || "reading").trim(),
      chapters_read:
        Number.isFinite(chaptersReadValue) && chaptersReadValue > 0
          ? chaptersReadValue
          : 0,
      total_chapters: resolvedChapterTotal,
      volumes_read:
        Number.isFinite(volumesReadValue) && volumesReadValue > 0
          ? volumesReadValue
          : 0,
      total_volumes: resolvedVolumeTotal,
      score: Number.isFinite(rawScore) && rawScore > 0 ? rawScore : null,
      last_synced_at: String(listStatus?.updated_at || "").trim() || undefined,
    };
  }

  async getTotalChapters(
    mangaId: number,
    account?: TrackingAccount,
  ): Promise<number | null> {
    if (!mangaId) return null;

    const fetchPublicTotal = async () => {
      try {
        const response = await axios.get(
          `https://api.myanimelist.net/v2/manga/${mangaId}`,
          {
            headers: {
              "X-MAL-CLIENT-ID": this.clientId,
            },
            params: {
              fields: "num_chapters",
            },
            timeout: 12000,
          },
        );
        const total = Number(response.data?.num_chapters || 0);
        return Number.isFinite(total) && total > 0 ? total : null;
      } catch {
        return null;
      }
    };

    const token = String(account?.access_token || "").trim();
    if (token) {
      try {
        const response = await axios.get(
          `https://api.myanimelist.net/v2/manga/${mangaId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            params: {
              fields: "num_chapters",
            },
            timeout: 12000,
          },
        );
        const total = Number(response.data?.num_chapters || 0);
        if (Number.isFinite(total) && total > 0) return total;
      } catch {}
    }

    return fetchPublicTotal();
  }

  async getTotalVolumes(
    mangaId: number,
    account?: TrackingAccount,
  ): Promise<number | null> {
    if (!mangaId) return null;

    const fetchPublicTotal = async () => {
      try {
        const response = await axios.get(
          `https://api.myanimelist.net/v2/manga/${mangaId}`,
          {
            headers: {
              "X-MAL-CLIENT-ID": this.clientId,
            },
            params: {
              fields: "num_volumes",
            },
            timeout: 12000,
          },
        );
        const total = Number(response.data?.num_volumes || 0);
        return Number.isFinite(total) && total > 0 ? total : null;
      } catch {
        return null;
      }
    };

    const token = String(account?.access_token || "").trim();
    if (token) {
      try {
        const response = await axios.get(
          `https://api.myanimelist.net/v2/manga/${mangaId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            params: {
              fields: "num_volumes",
            },
            timeout: 12000,
          },
        );
        const total = Number(response.data?.num_volumes || 0);
        if (Number.isFinite(total) && total > 0) return total;
      } catch {}
    }

    return fetchPublicTotal();
  }

  async getFriendsReading(
    mangaId: number,
    account: TrackingAccount,
  ): Promise<FriendReading[]> {
    if (!account.access_token) return [];

    const headers = {
      Authorization: `Bearer ${account.access_token}`,
    };

    const friendsResponse = await axios.get(
      "https://api.myanimelist.net/v2/users/@me/friends",
      {
        headers,
        params: { limit: 20 },
      },
    );

    const friends: any[] = friendsResponse.data?.data ?? [];
    if (!Array.isArray(friends) || friends.length === 0) return [];

    const MAX_FRIENDS_TO_CHECK = 10;
    const CONCURRENCY = 4;
    const candidates = friends.slice(0, MAX_FRIENDS_TO_CHECK);
    const matched: FriendReading[] = [];

    const worker = async (batch: any[]) => {
      for (const friendEntry of batch) {
        const friendNode = friendEntry?.node ?? friendEntry;
        const username: string | undefined = friendNode?.name;
        if (!username) continue;

        try {
          const listResponse = await axios.get(
            `https://api.myanimelist.net/v2/users/${encodeURIComponent(username)}/mangalist`,
            {
              headers,
              params: {
                status: "reading",
                limit: 100,
                fields: "list_status",
              },
            },
          );

          const entries: any[] = listResponse.data?.data ?? [];
          const targetEntry = entries.find(
            (item) => item?.node?.id === mangaId,
          );
          if (!targetEntry) continue;

          matched.push({
            username,
            avatar_url: friendNode?.picture || undefined,
            profile_url: `https://myanimelist.net/profile/${encodeURIComponent(username)}`,
            status: targetEntry?.list_status?.status || "reading",
            progress: targetEntry?.list_status?.num_chapters_read || 0,
            service: "mal",
          });
        } catch (error) {
          console.warn(
            `[MAL] Failed to fetch list for friend ${username}:`,
            error,
          );
        }
      }
    };

    const buckets: any[][] = Array.from(
      { length: Math.min(CONCURRENCY, candidates.length) },
      () => [],
    );
    candidates.forEach((friend, index) => {
      buckets[index % buckets.length].push(friend);
    });

    await Promise.all(buckets.map((bucket) => worker(bucket)));

    return matched;
  }

  /** Searches MAL by title and returns the best matching MAL ID, filtered by media type. */
  async searchByTitle(
    titles: string[],
    expectedMalTypes: string[],
  ): Promise<number | null> {
    const candidates = titles
      .map((t) => String(t || "").trim())
      .filter(Boolean);
    if (candidates.length === 0) return null;

    const diceSimilarity = (a: string, b: string): number => {
      const normalize = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, " ")
          .trim();
      const na = normalize(a);
      const nb = normalize(b);
      if (!na || !nb) return 0;
      if (na === nb) return 1;
      const bigrams = (s: string) => {
        const set = new Map<string, number>();
        for (let i = 0; i < s.length - 1; i++) {
          const bg = s[i] + s[i + 1];
          set.set(bg, (set.get(bg) || 0) + 1);
        }
        return set;
      };
      const ba = bigrams(na);
      const bb = bigrams(nb);
      let intersection = 0;
      for (const [bg, countA] of ba) {
        const countB = bb.get(bg) || 0;
        intersection += Math.min(countA, countB);
      }
      const total =
        [...ba.values()].reduce((s, c) => s + c, 0) +
        [...bb.values()].reduce((s, c) => s + c, 0);
      return total === 0 ? 0 : (2 * intersection) / total;
    };

    const normalizedExpected = expectedMalTypes.map((t) =>
      String(t || "")
        .trim()
        .toLowerCase(),
    );

    const scoreResult = (data: any): number => {
      const malTitles: string[] = [
        String(data?.title || ""),
        String(data?.alternative_titles?.en || ""),
        String(data?.alternative_titles?.ja || ""),
        ...((data?.alternative_titles?.synonyms as string[]) ?? []),
      ].filter(Boolean);
      return Math.max(
        0,
        ...candidates.map((q) =>
          Math.max(0, ...malTitles.map((t) => diceSimilarity(q, t))),
        ),
      );
    };

    const seen = new Map<number, number>();

    for (const query of candidates) {
      try {
        const response = await axios.get(
          "https://api.myanimelist.net/v2/manga",
          {
            headers: { "X-MAL-CLIENT-ID": this.clientId },
            params: {
              q: query,
              limit: 10,
              fields: "media_type,alternative_titles",
            },
            timeout: 10000,
          },
        );

        const items: any[] = response.data?.data ?? [];
        for (const item of items) {
          const data = item?.node ?? item;
          const malId = Number(data?.id || 0);
          if (!malId) continue;

          if (normalizedExpected.length > 0) {
            const itemType = String(data?.media_type || "").toLowerCase();
            if (!normalizedExpected.includes(itemType)) continue;
          }

          const score = scoreResult(data);
          const existing = seen.get(malId) ?? -1;
          if (score > existing) {
            seen.set(malId, score);
          }
        }
      } catch (error) {
        console.warn(
          `[MAL] Title search failed for "${query}":`,
          (error as any)?.message,
        );
      }
    }

    if (seen.size === 0) return null;

    const MIN_SCORE = 0.6;
    const best = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];

    if (!best || best[1] < MIN_SCORE) return null;
    return best[0];
  }
}
