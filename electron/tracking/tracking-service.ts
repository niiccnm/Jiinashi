import {
  MangaSeries,
  TrackingAccount,
  TrackingEntry,
  FriendReading,
  UserTrackingStatus,
} from "../types/manga-types";
import * as mangaQueries from "../database/queries/manga";
import * as libraryQueries from "../database/queries/library";
import { getSetting } from "../database/database";
import { MALService } from "./mal";
import { AniListService } from "./anilist";
import { MangaDexTrackingService } from "./mangadex";
import { incognitoManager } from "./incognito-manager";
import {
  trackingClientIdManager,
  type TrackingProvider,
} from "./client-id-manager";
import {
  normalizeSeriesTitleStyle,
  resolveSeriesTitle,
} from "../library/manga-linker/title-utils";

export type UpdateTrackingEntryPayload = {
  seriesId: number;
  service: "mal" | "anilist";
  remoteId?: number | string | null;
  chaptersRead: number;
  volumesRead?: number;
  score?: number | null;
  status?: string;
  totalChapters?: number | null;
  totalVolumes?: number | null;
  startedAt?: string | null;
};

export type RemoveTrackingEntryPayload = {
  seriesId: number;
  service: "mal" | "anilist";
  remoteId?: number | string | null;
};

export type TrackingLoginResult = {
  status: "success" | "cancelled" | "error";
  error?: string;
};

type AutoTrackingAction = "progress" | "reading" | "completed" | "manual";

export type AutoTrackingOutcome = {
  action: AutoTrackingAction;
  services: Array<"mal" | "anilist">;
  seriesTitle: string;
  label: string;
};

const TRACKING_SERVICES: Array<"mal" | "anilist"> = ["anilist", "mal"];

export class TrackingService {
  private mal: MALService;
  private anilist: AniListService;
  private mangadex: MangaDexTrackingService;
  private readonly FRIENDS_CACHE_TTL_MS = 2 * 60 * 1000;
  private readonly EMPTY_CACHE_TTL_MS = 15 * 1000;
  private volatileAccounts = new Map<"mal" | "anilist", TrackingAccount>();
  private friendsCache = new Map<
    string,
    { expiresAt: number; data: FriendReading[] }
  >();
  private inFlightRequests = new Map<string, Promise<FriendReading[]>>();
  private statusInFlightRequests = new Map<
    string,
    Promise<UserTrackingStatus[]>
  >();

  constructor() {
    this.mal = new MALService("");
    this.anilist = new AniListService();
    this.mangadex = new MangaDexTrackingService();
  }

  initializeClientIds() {
    trackingClientIdManager.initialize();
    this.applyClientId("mal");
    this.applyClientId("anilist");
  }

  getCustomClientId(service: TrackingProvider): string {
    return trackingClientIdManager.getCustomClientId(service);
  }

  async setCustomClientId(
    service: TrackingProvider,
    clientId: string,
  ): Promise<string> {
    const result = trackingClientIdManager.setCustomClientId(service, clientId);
    if (result.changed) {
      await this.disconnect(service);
      this.applyClientId(service);
    }
    return result.clientId;
  }

  async resetCustomClientId(
    service: TrackingProvider,
  ): Promise<string> {
    const result = trackingClientIdManager.resetCustomClientId(service);
    if (result.changed) {
      await this.disconnect(service);
      this.applyClientId(service);
    }
    return result.clientId;
  }

  private applyClientId(service: TrackingProvider) {
    const clientId = trackingClientIdManager.getEffectiveClientId(service);
    if (service === "mal") this.mal.setClientId(clientId);
    else this.anilist.setClientId(clientId);
  }

  async getMangaDexTotalChapters(seriesId: number): Promise<number | null> {
    const normalizedSeriesId = Number(seriesId || 0);
    if (!Number.isFinite(normalizedSeriesId) || normalizedSeriesId <= 0) {
      return null;
    }

    const series = mangaQueries.getMangaSeries(normalizedSeriesId);
    if (!series) return null;

    return this.mangadex.getTotalChapters(series);
  }

  async searchMalIdByTitle(anilistId: number): Promise<number | null> {
    const normalizedId = Number(anilistId || 0);
    if (!Number.isFinite(normalizedId) || normalizedId <= 0) return null;
    return this.anilist.searchMalIdByTitle(normalizedId, this.mal);
  }

  private isRateLimitedError(error: any): boolean {
    if (Number(error?.response?.status || error?.status || 0) === 429) {
      return true;
    }
    const message = String(error?.message || "").toLowerCase();
    return (
      message.includes("too many requests") || message.includes("rate limit")
    );
  }

  private formatErrorBrief(error: any): string {
    const status = Number(error?.response?.status || error?.status || 0);
    const graphQlMessage = String(
      error?.response?.data?.errors?.[0]?.message || "",
    ).trim();
    const message = graphQlMessage || String(error?.message || "Unknown error");
    return status > 0 ? `[${status}] ${message}` : message;
  }

  private clearTrackingCaches() {
    this.friendsCache.clear();
    this.inFlightRequests.clear();
    this.statusInFlightRequests.clear();
  }

  private isStatusUnavailable(status: UserTrackingStatus | undefined | null) {
    return Boolean(status?.status_unavailable);
  }

  private isUserCancellationError(error: any): boolean {
    if (!error) return false;
    if (Boolean(error?.isUserCancellation)) return true;

    const code = String(error?.code || "")
      .trim()
      .toLowerCase();
    if (code === "oauth_cancelled" || code === "cancelled") {
      return true;
    }

    const message = String(error?.message || "")
      .trim()
      .toLowerCase();
    return (
      message.includes("login cancelled by user") ||
      message.includes("login cancelled")
    );
  }

  private getActiveAccount(service: "mal" | "anilist"): TrackingAccount | null {
    const persisted = mangaQueries.getTrackingAccount(service);
    if (persisted && persisted.is_active && persisted.access_token) {
      return persisted;
    }

    const volatile = this.volatileAccounts.get(service);
    if (volatile && volatile.is_active && volatile.access_token) {
      return volatile;
    }

    return null;
  }

  getTrackingAccounts(): TrackingAccount[] {
    const merged = new Map<"mal" | "anilist", TrackingAccount>();

    for (const account of mangaQueries.getTrackingAccounts()) {
      if (!account.service) continue;
      if (account.access_token) {
        merged.set(account.service, account);
      }
    }

    for (const [service, account] of this.volatileAccounts.entries()) {
      merged.set(service, account);
    }

    return Array.from(merged.values());
  }

  async updateProgress(
    series: MangaSeries,
    chaptersRead: number,
    score?: number,
    status?: string,
  ) {
    const entries = await mangaQueries.getTrackingEntries(series.id!);
    if (incognitoManager.getIncognito()) return;

    for (const entry of entries) {
      if (incognitoManager.getIncognito()) return;
      const service = entry.service as "mal" | "anilist";
      const account = this.getActiveAccount(service);
      if (!account || !account.is_active) continue;

      try {
        const normalizedStatus = this.normalizeStatusForService(
          service,
          status ?? entry.status,
        );
        const normalizedScore = this.normalizeScore(score ?? entry.score);
        const safeChaptersRead = Number.isFinite(Number(chaptersRead))
          ? Math.max(0, Math.floor(Number(chaptersRead)))
          : 0;
        const coherentStatus = this.enforceStatusForProgress(
          service,
          normalizedStatus,
          safeChaptersRead,
          entry.status,
        );
        const previousProgress = Number.isFinite(Number(entry.chapters_read))
          ? Math.max(0, Math.floor(Number(entry.chapters_read)))
          : 0;
        const shouldApplyStartedAt = this.shouldAutoSetStartedAt(
          service,
          coherentStatus,
          safeChaptersRead,
          previousProgress,
        );
        const autoStartedAt = shouldApplyStartedAt
          ? this.normalizeStartedAt(this.getCurrentLocalDateString())
          : null;

        if (service === "mal") {
          await this.mal.updateProgress(entry, safeChaptersRead, account, {
            status: coherentStatus,
            score: normalizedScore,
            startedAt: autoStartedAt?.mal ?? null,
          });
        } else if (service === "anilist") {
          await this.anilist.updateProgress(entry, safeChaptersRead, account, {
            status: coherentStatus,
            score: normalizedScore,
            startedAt: autoStartedAt?.anilist ?? null,
          });
        }

        // Update local DB
        await mangaQueries.updateTrackingEntry(entry.id!, {
          chapters_read: safeChaptersRead,
          score: normalizedScore,
          status: coherentStatus,
          last_synced_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error(`Failed to sync with ${service}:`, e);
      }
    }
  }

  async updateTrackingEntry(payload: UpdateTrackingEntryPayload) {
    const normalizedSeriesId = Number(payload?.seriesId || 0);
    if (!Number.isFinite(normalizedSeriesId) || normalizedSeriesId <= 0) {
      throw new Error("Invalid series id");
    }

    const service = String(payload?.service || "")
      .trim()
      .toLowerCase();
    if (service !== "mal" && service !== "anilist") {
      throw new Error("Invalid tracking service");
    }
    const typedService = service as "mal" | "anilist";

    const account = this.getActiveAccount(typedService);
    if (
      !account ||
      !account.is_active ||
      !String(account.access_token || "").trim()
    ) {
      throw new Error(
        service === "anilist"
          ? "AniList account is not connected"
          : "MAL account is not connected",
      );
    }

    const existing = mangaQueries.getTrackingEntry(normalizedSeriesId, service);
    const remoteIdRaw =
      payload?.remoteId ?? String(existing?.remote_id || "").trim();
    const remoteId = String(remoteIdRaw || "").trim();
    if (!remoteId) {
      throw new Error(
        service === "anilist"
          ? "Missing AniList id for this series"
          : "Missing MAL id for this series",
      );
    }

    const safeChaptersRead = Number.isFinite(Number(payload?.chaptersRead))
      ? Math.max(0, Math.floor(Number(payload.chaptersRead)))
      : 0;
    const safeVolumesRead = Number.isFinite(
      Number(payload?.volumesRead ?? existing?.volumes_read),
    )
      ? Math.max(
          0,
          Math.floor(Number(payload?.volumesRead ?? existing?.volumes_read)),
        )
      : 0;
    const normalizedStatus = this.normalizeStatusForService(
      typedService,
      payload?.status ?? existing?.status,
    );
    const coherentStatus = this.enforceStatusForProgress(
      typedService,
      normalizedStatus,
      safeChaptersRead,
      existing?.status,
    );
    const normalizedScore = this.normalizeScore(
      payload?.score ?? existing?.score ?? null,
    );
    const normalizedStartedAt = this.normalizeStartedAt(payload?.startedAt);
    const existingProgress = Number.isFinite(Number(existing?.chapters_read))
      ? Math.max(0, Math.floor(Number(existing?.chapters_read)))
      : 0;
    const shouldApplyStartedAt = this.shouldAutoSetStartedAt(
      typedService,
      coherentStatus,
      safeChaptersRead,
      existingProgress,
    );
    const autoStartedAt =
      !normalizedStartedAt && shouldApplyStartedAt
        ? this.normalizeStartedAt(this.getCurrentLocalDateString())
        : null;
    const startedAtForSync =
      safeChaptersRead > 0 ? (normalizedStartedAt ?? autoStartedAt) : null;
    const rawTotalChapters = Number(
      payload?.totalChapters ?? existing?.total_chapters ?? 0,
    );
    const normalizedTotalChapters =
      Number.isFinite(rawTotalChapters) && rawTotalChapters > 0
        ? Math.floor(rawTotalChapters)
        : null;
    const rawTotalVolumes = Number(
      payload?.totalVolumes ?? existing?.total_volumes ?? 0,
    );
    const normalizedTotalVolumes =
      Number.isFinite(rawTotalVolumes) && rawTotalVolumes > 0
        ? Math.floor(rawTotalVolumes)
        : null;

    const draftEntry: TrackingEntry = {
      series_id: normalizedSeriesId,
      service: typedService,
      remote_id: remoteId,
      status: coherentStatus,
      chapters_read: safeChaptersRead,
      total_chapters: normalizedTotalChapters,
      volumes_read: safeVolumesRead,
      total_volumes: normalizedTotalVolumes,
      score: normalizedScore,
      last_synced_at: new Date().toISOString(),
    };

    if (typedService === "mal") {
      await this.mal.updateProgress(draftEntry, safeChaptersRead, account, {
        status: coherentStatus,
        score: normalizedScore,
        volumesRead: safeVolumesRead,
        startedAt: startedAtForSync?.mal ?? null,
      });
    } else {
      await this.anilist.updateProgress(draftEntry, safeChaptersRead, account, {
        status: coherentStatus,
        score: normalizedScore,
        volumesRead: safeVolumesRead,
        startedAt: startedAtForSync?.anilist ?? null,
      });
    }

    if (existing?.id) {
      mangaQueries.updateTrackingEntry(existing.id, {
        remote_id: remoteId,
        status: coherentStatus,
        chapters_read: safeChaptersRead,
        total_chapters: normalizedTotalChapters,
        volumes_read: safeVolumesRead,
        total_volumes: normalizedTotalVolumes,
        score: normalizedScore,
        last_synced_at: new Date().toISOString(),
      });
    } else {
      mangaQueries.upsertTrackingEntry(draftEntry);
    }
  }

  async removeTrackingEntry(payload: RemoveTrackingEntryPayload) {
    const normalizedSeriesId = Number(payload?.seriesId || 0);
    if (!Number.isFinite(normalizedSeriesId) || normalizedSeriesId <= 0) {
      throw new Error("Invalid series id");
    }

    const service = String(payload?.service || "")
      .trim()
      .toLowerCase();
    if (service !== "mal" && service !== "anilist") {
      throw new Error("Invalid tracking service");
    }
    const typedService = service as "mal" | "anilist";

    const account = this.getActiveAccount(typedService);
    if (
      !account ||
      !account.is_active ||
      !String(account.access_token || "").trim()
    ) {
      throw new Error(
        service === "anilist"
          ? "AniList account is not connected"
          : "MAL account is not connected",
      );
    }

    const existing = mangaQueries.getTrackingEntry(normalizedSeriesId, service);
    const remoteIdRaw =
      payload?.remoteId ?? String(existing?.remote_id || "").trim();
    const remoteId = String(remoteIdRaw || "").trim();
    if (!remoteId) {
      throw new Error(
        service === "anilist"
          ? "Missing AniList id for this series"
          : "Missing MAL id for this series",
      );
    }

    const targetEntry: TrackingEntry = {
      series_id: normalizedSeriesId,
      service: typedService,
      remote_id: remoteId,
      status: String(existing?.status || "").trim(),
      chapters_read: Number(existing?.chapters_read || 0),
      total_chapters:
        Number.isFinite(Number(existing?.total_chapters || 0)) &&
        Number(existing?.total_chapters || 0) > 0
          ? Number(existing?.total_chapters || 0)
          : null,
      volumes_read: Number(existing?.volumes_read || 0),
      total_volumes:
        Number.isFinite(Number(existing?.total_volumes || 0)) &&
        Number(existing?.total_volumes || 0) > 0
          ? Number(existing?.total_volumes || 0)
          : null,
      score:
        Number.isFinite(Number(existing?.score || 0)) &&
        Number(existing?.score || 0) > 0
          ? Number(existing?.score || 0)
          : null,
    };

    if (typedService === "mal") {
      await this.mal.removeEntry(targetEntry, account);
    } else {
      await this.anilist.removeEntry(targetEntry, account);
    }

    mangaQueries.deleteTrackingEntry(normalizedSeriesId, typedService);
  }

  private normalizeScore(value: number | null | undefined): number | null {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.max(0, Math.min(10, Number(raw.toFixed(1))));
  }

  private normalizeStatusForService(
    service: "mal" | "anilist",
    value: unknown,
  ): string {
    const raw = String(value || "").trim();
    if (!raw) {
      return service === "anilist" ? "CURRENT" : "reading";
    }
    const normalized = raw.replace(/[\s-]+/g, "_").toUpperCase();

    if (service === "anilist") {
      const map: Record<string, string> = {
        READING: "CURRENT",
        CURRENT: "CURRENT",
        PLANNING: "PLANNING",
        PLAN_TO_READ: "PLANNING",
        COMPLETED: "COMPLETED",
        DROPPED: "DROPPED",
        PAUSED: "PAUSED",
        ON_HOLD: "PAUSED",
        REPEATING: "REPEATING",
        REREADING: "REPEATING",
      };
      return map[normalized] || "CURRENT";
    }

    const malMap: Record<string, string> = {
      READING: "reading",
      CURRENT: "reading",
      PLANNING: "plan_to_read",
      PLAN_TO_READ: "plan_to_read",
      COMPLETED: "completed",
      DROPPED: "dropped",
      PAUSED: "on_hold",
      ON_HOLD: "on_hold",
      REPEATING: "reading",
      REREADING: "reading",
    };
    return malMap[normalized] || "reading";
  }

  private isReadingLikeStatus(
    service: "mal" | "anilist",
    normalizedStatus: string,
  ) {
    const status = String(normalizedStatus || "")
      .trim()
      .toUpperCase();
    if (!status) return false;
    if (service === "anilist") {
      return status === "CURRENT" || status === "REPEATING";
    }
    return status === "READING";
  }

  private shouldAutoSetStartedAt(
    service: "mal" | "anilist",
    normalizedStatus: string,
    nextProgress: number,
    previousProgress: number,
  ) {
    const safeNextProgress = Number.isFinite(Number(nextProgress))
      ? Math.max(0, Math.floor(Number(nextProgress)))
      : 0;
    const safePreviousProgress = Number.isFinite(Number(previousProgress))
      ? Math.max(0, Math.floor(Number(previousProgress)))
      : 0;
    if (safeNextProgress <= 0 || safePreviousProgress > 0) return false;
    return this.isReadingLikeStatus(service, normalizedStatus);
  }

  private enforceStatusForProgress(
    service: "mal" | "anilist",
    normalizedStatus: string,
    chaptersRead: number,
    existingStatus?: string | null,
  ) {
    const safeProgress = Number.isFinite(Number(chaptersRead))
      ? Math.max(0, Math.floor(Number(chaptersRead)))
      : 0;
    if (safeProgress > 0) {
      const status = String(normalizedStatus || "")
        .trim()
        .toUpperCase();
      if (service === "anilist" && status === "PLANNING") {
        return "CURRENT";
      }
      if (service === "mal" && status === "PLAN_TO_READ") {
        return "reading";
      }
      return normalizedStatus;
    }
    if (!this.isReadingLikeStatus(service, normalizedStatus)) {
      return normalizedStatus;
    }

    const fallbackExisting = this.normalizeStatusForService(
      service,
      existingStatus,
    );
    if (
      fallbackExisting &&
      !this.isReadingLikeStatus(service, fallbackExisting)
    ) {
      return fallbackExisting;
    }
    return service === "anilist" ? "PLANNING" : "plan_to_read";
  }

  private normalizeStartedAt(value: unknown): {
    mal: string;
    anilist: { year: number; month: number; day: number };
  } | null {
    const text = String(value || "").trim();
    if (!text) return null;

    const directMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (directMatch) {
      const year = Number(directMatch[1]);
      const month = Number(directMatch[2]);
      const day = Number(directMatch[3]);
      if (
        Number.isFinite(year) &&
        Number.isFinite(month) &&
        Number.isFinite(day) &&
        year > 0 &&
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= 31
      ) {
        return {
          mal: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          anilist: { year, month, day },
        };
      }
    }

    const parsed = new Date(text);
    if (!Number.isFinite(parsed.getTime())) return null;
    const year = parsed.getFullYear();
    const month = parsed.getMonth() + 1;
    const day = parsed.getDate();
    if (year <= 0) return null;
    return {
      mal: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      anilist: { year, month, day },
    };
  }

  private getCurrentLocalDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  private toPositiveInt(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    const text = String(value ?? "").trim();
    if (!text) return null;
    const direct = Number(text);
    if (Number.isFinite(direct) && direct > 0) {
      return Math.floor(direct);
    }
    const match = text.match(/(\d+)/);
    if (!match?.[1]) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
  }

  private toTrackingProgressNumber(value: number | null): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.floor(parsed);
  }

  private stripFileExtension(value: unknown): string {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const parsed = path.parse(raw);
    return String(parsed.name || raw).trim();
  }

  private getLocalSeriesFileName(pathValue: unknown): string {
    const fileName = String(pathValue || "")
      .split(/[/\\]/)
      .at(-1);
    return this.stripFileExtension(fileName);
  }

  private normalizeLocalSeriesFileText(value: unknown): string {
    return String(value || "").trim().replace(/[_-]+/g, " ");
  }

  private getLocalSeriesFileTextCandidates(item: {
    title?: string;
    path?: string;
  }): string[] {
    const values = [
      this.normalizeLocalSeriesFileText(item?.title),
      this.normalizeLocalSeriesFileText(this.getLocalSeriesFileName(item?.path)),
    ].filter(Boolean);
    return Array.from(new Set(values));
  }

  private parseVolumeNumberFromText(value: unknown): number | null {
    const text = this.normalizeLocalSeriesFileText(value);
    if (!text) return null;
    const match = text.match(
      /(?:^|[^a-z0-9])(?:volume|vol|v)\.?\s*([0-9]+(?:\.[0-9]+)?)(?=$|[^a-z0-9])/i,
    );
    if (!match?.[1]) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private parseVolumeNumberFromItem(item: { title?: string; path?: string }) {
    for (const candidate of this.getLocalSeriesFileTextCandidates(item)) {
      const parsed = this.parseVolumeNumberFromText(candidate);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  private isIntegerChapterNumber(value: number | null): boolean {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return false;
    return Math.abs(parsed - Math.round(parsed)) < 1e-9;
  }

  private parseChapterNumberFromText(value: unknown): number | null {
    const text = String(value || "").trim();
    if (!text) return null;
    const normalized = text.replace(/[_-]+/g, " ");
    const labeled = normalized.match(
      /(?:chapter|chap|ch|episode|ep|act|part)\s*[:#.\-\s]*([0-9]+(?:\.[0-9]+)?)/i,
    );
    if (labeled?.[1]) {
      const parsed = Number(labeled[1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    const fallback = normalized.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!fallback?.[1]) return null;
    const parsed = Number(fallback[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private parseChapterNumberFromItem(item: { title?: string; path?: string }) {
    for (const candidate of this.getLocalSeriesFileTextCandidates(item)) {
      const parsed = this.parseChapterNumberFromText(candidate);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  private isLocalSeriesVolumeItemId(itemId: number): boolean {
    const item = libraryQueries.getItemById(Number(itemId || 0));
    if (!item || String(item.type || "") === "folder") return false;
    if (Number(item?.manga_series_id || 0) <= 0) return false;
    return (
      this.parseVolumeNumberFromItem({
        title: String(item.title || ""),
        path: String(item.path || ""),
      }) !== null
    );
  }

  private resolveSeriesChapterBounds(
    items: Array<{ id: number; title?: string; path?: string }>,
  ) {
    const chapters = Array.isArray(items) ? items : [];
    if (chapters.length === 0) {
      return {
        first: null as { id: number; title?: string; path?: string } | null,
        last: null as { id: number; title?: string; path?: string } | null,
        lastIntegerId: null as number | null,
        totalCount: 0,
        maxProgressNumber: null as number | null,
        ordered: [] as Array<{
          id: number;
          title?: string;
          path?: string;
          chapterNumber: number | null;
        }>,
      };
    }

    const withNumbers = chapters
      .map((item) => {
        const isVolume = this.parseVolumeNumberFromItem(item) !== null;
        return {
          item,
          isVolume,
          chapterNumber: !isVolume ? this.parseChapterNumberFromItem(item) : null,
        };
      })
      .filter((entry) => !entry.isVolume);
    if (withNumbers.length === 0) {
      return {
        first: null as { id: number; title?: string; path?: string } | null,
        last: null as { id: number; title?: string; path?: string } | null,
        lastIntegerId: null as number | null,
        totalCount: 0,
        maxProgressNumber: null as number | null,
        ordered: [] as Array<{
          id: number;
          title?: string;
          path?: string;
          chapterNumber: number | null;
        }>,
      };
    }
    const hasAllNumbers = withNumbers.every(
      (entry) => entry.chapterNumber !== null,
    );

    const orderedEntries = hasAllNumbers
      ? [...withNumbers].sort((left, right) => {
          const numberDelta =
            Number(left.chapterNumber || 0) - Number(right.chapterNumber || 0);
          if (numberDelta !== 0) return numberDelta;
          return String(left.item?.title || "").localeCompare(
            String(right.item?.title || ""),
            undefined,
            { numeric: true, sensitivity: "base" },
          );
        })
      : [...withNumbers].sort((left, right) =>
          String(left.item?.title || "").localeCompare(
            String(right.item?.title || ""),
            undefined,
            { numeric: true, sensitivity: "base" },
          ),
        );

    const ordered = orderedEntries.map((entry) => entry.item);
    const orderedWithMeta = orderedEntries.map((entry) => ({
      id: Number(entry.item?.id || 0),
      title: entry.item?.title,
      path: entry.item?.path,
      chapterNumber: entry.chapterNumber,
    }));
    let lastIntegerId: number | null = null;
    let maxProgressNumber: number | null = null;
    for (const entry of orderedWithMeta) {
      if (this.isIntegerChapterNumber(entry.chapterNumber)) {
        lastIntegerId = entry.id;
      }
      const progress = this.toTrackingProgressNumber(entry.chapterNumber);
      if (progress !== null) {
        maxProgressNumber =
          maxProgressNumber === null
            ? progress
            : Math.max(maxProgressNumber, progress);
      }
    }

    return {
      first: ordered[0] || null,
      last: ordered[ordered.length - 1] || null,
      lastIntegerId,
      totalCount: ordered.length,
      maxProgressNumber,
      ordered: orderedWithMeta,
    };
  }

  private formatChapterNumber(value: number | null) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) return "";
    return String(Number(value)).replace(/\.0+$/g, "");
  }

  private buildChapterLabel(
    chapterMeta: { chapterNumber: number | null; title?: string } | null,
    chapterOrdinal: number,
  ) {
    const fromParsed = this.formatChapterNumber(
      Number(chapterMeta?.chapterNumber || 0) || null,
    );
    if (fromParsed) return `Chapter ${fromParsed}`;

    const title = String(chapterMeta?.title || "").trim();
    const fromTitle = this.parseChapterNumberFromText(title);
    const normalizedFromTitle = this.formatChapterNumber(fromTitle);
    if (normalizedFromTitle) return `Chapter ${normalizedFromTitle}`;

    if (Number.isFinite(chapterOrdinal) && chapterOrdinal > 0) {
      return `Chapter ${Math.floor(chapterOrdinal)}`;
    }
    return "Chapter";
  }

  private buildVolumeLabel(item: { title?: string; path?: string } | null) {
    const volumeNumber = this.parseVolumeNumberFromItem(item || {});
    const formattedNumber = this.formatChapterNumber(volumeNumber);
    if (formattedNumber) return `Volume ${formattedNumber}`;

    const title = String(item?.title || "").trim();
    if (title) return title;

    const fileName = this.getLocalSeriesFileName(item?.path);
    return fileName || "Volume";
  }

  private isFinishedSeriesStatus(status: unknown): boolean {
    const normalized = String(status || "")
      .trim()
      .toUpperCase()
      .replace(/[\s_-]+/g, "");
    if (!normalized) return false;
    if (["ONGOING", "RELEASING", "PUBLISHING"].includes(normalized)) {
      return false;
    }
    return [
      "FINISHED",
      "COMPLETED",
      "COMPLETE",
      "ENDED",
      "CANCELLED",
      "CANCELED",
      "HIATUS",
    ].includes(normalized);
  }

  private resolveTrackingRemoteId(
    service: "mal" | "anilist",
    status: UserTrackingStatus | undefined,
    localEntry: TrackingEntry | undefined,
    series: MangaSeries,
  ): string {
    const statusRemoteId = String(status?.remote_id || "").trim();
    if (statusRemoteId) return statusRemoteId;
    const localRemoteId = String(localEntry?.remote_id || "").trim();
    if (localRemoteId) return localRemoteId;
    if (service === "anilist") {
      const anilistId = this.toPositiveInt(series?.anilist_id);
      return anilistId ? String(anilistId) : "";
    }
    const malId = this.toPositiveInt(series?.mal_id);
    return malId ? String(malId) : "";
  }

  private getOrderedServices(values: Iterable<"mal" | "anilist">) {
    const set = new Set(values);
    const ordered: Array<"mal" | "anilist"> = [];
    if (set.has("anilist")) ordered.push("anilist");
    if (set.has("mal")) ordered.push("mal");
    return ordered;
  }

  private getSeriesDisplayTitle(series: MangaSeries) {
    const style = normalizeSeriesTitleStyle(getSetting("seriesTitleStyle"));
    return resolveSeriesTitle(series, style, "Series");
  }

  async handleAutoTrackingForCompletedChapter(
    chapterItemId: number,
  ): Promise<AutoTrackingOutcome | null> {
    if (incognitoManager.getIncognito()) return null;

    const normalizedChapterItemId = Number(chapterItemId || 0);
    if (
      !Number.isFinite(normalizedChapterItemId) ||
      normalizedChapterItemId <= 0
    ) {
      return null;
    }

    const chapterItem = libraryQueries.getItemById(normalizedChapterItemId);
    if (!chapterItem || String(chapterItem.type || "") === "folder")
      return null;
    if (chapterItem.manga_preference === "force_non_manga") return null;
    const seriesId = Number(chapterItem?.manga_series_id || 0);
    if (!Number.isFinite(seriesId) || seriesId <= 0) return null;

    const series = mangaQueries.getMangaSeries(seriesId);
    if (!series) return null;

    const localEntries = mangaQueries.getTrackingEntries(seriesId);
    const entryByService = new Map<"mal" | "anilist", TrackingEntry>();
    for (const entry of localEntries) {
      const service = String(entry?.service || "").toLowerCase();
      if (service === "mal" || service === "anilist") {
        entryByService.set(service, entry);
      }
    }

    const statuses = await this.getUserTrackingStatus(
      seriesId,
      this.toPositiveInt(series?.anilist_id) || undefined,
      this.toPositiveInt(series?.mal_id) || undefined,
    );

    const statusByService = new Map<"mal" | "anilist", UserTrackingStatus>();
    for (const status of statuses) {
      const service = String(status?.service || "").toLowerCase();
      if (service === "mal" || service === "anilist") {
        statusByService.set(service, status);
      }
    }

    if (this.isLocalSeriesVolumeItemId(normalizedChapterItemId)) {
      const manuallyTrackedServices = this.getOrderedServices(
        TRACKING_SERVICES.filter((service) => {
          const account = this.getActiveAccount(service);
          if (
            !account ||
            !account.is_active ||
            !String(account.access_token || "").trim()
          ) {
            return false;
          }
          return statusByService.has(service) || entryByService.has(service);
        }),
      );
      if (manuallyTrackedServices.length === 0) return null;

      return {
        action: "manual",
        services: manuallyTrackedServices,
        seriesTitle: this.getSeriesDisplayTitle(series),
        label: this.buildVolumeLabel({
          title: String(chapterItem.title || ""),
          path: String(chapterItem.path || ""),
        }),
      };
    }

    const chapterItems = libraryQueries.getSeriesBookItems(seriesId);
    const boundaries = this.resolveSeriesChapterBounds(
      chapterItems.map((item) => ({
        id: Number(item.id || 0),
        title: String(item.title || ""),
        path: String(item.path || ""),
      })),
    );
    const chapterOrdinal =
      boundaries.ordered.findIndex(
        (entry) => Number(entry.id || 0) === normalizedChapterItemId,
      ) + 1;
    const chapterMeta =
      boundaries.ordered.find(
        (entry) => Number(entry.id || 0) === normalizedChapterItemId,
      ) || null;
    if (chapterOrdinal <= 0) return null;

    const parsedProgress = this.toTrackingProgressNumber(
      chapterMeta?.chapterNumber ?? null,
    );
    const targetProgressBase = parsedProgress ?? chapterOrdinal;
    const isFirstChapter =
      Number(boundaries.first?.id || 0) === normalizedChapterItemId;
    const isLastChapter =
      Number(boundaries.last?.id || 0) === normalizedChapterItemId;
    const isLastIntegerChapter =
      boundaries.lastIntegerId === normalizedChapterItemId;
    const hasIntegerChapters = boundaries.lastIntegerId !== null;
    const shouldAutoComplete =
      this.isFinishedSeriesStatus(series?.status) &&
      (isLastIntegerChapter || (!hasIntegerChapters && isLastChapter));
    const chapterLabel = this.buildChapterLabel(chapterMeta, chapterOrdinal);

    const completedServices = new Set<"mal" | "anilist">();
    const readingServices = new Set<"mal" | "anilist">();
    const progressServices = new Set<"mal" | "anilist">();
    const startedAt = this.getCurrentLocalDateString();

    for (const service of this.getOrderedServices(TRACKING_SERVICES)) {
      if (incognitoManager.getIncognito()) return null;
      const account = this.getActiveAccount(service);
      if (
        !account ||
        !account.is_active ||
        !String(account.access_token || "").trim()
      ) {
        continue;
      }

      const status = statusByService.get(service);
      const localEntry = entryByService.get(service);
      const remoteId = this.resolveTrackingRemoteId(
        service,
        status,
        localEntry,
        series,
      );
      if (!remoteId) continue;

      const remoteProgress = this.toPositiveInt(status?.chapters_read) || 0;
      const localProgress = this.toPositiveInt(localEntry?.chapters_read) || 0;
      const previousProgress = Math.max(remoteProgress, localProgress);
      const hasNoPreviousRead = previousProgress <= 0;
      const normalizedExistingStatus = String(
        status?.status || localEntry?.status || "",
      )
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
      const isAlreadyCompleted =
        normalizedExistingStatus === "COMPLETED" ||
        normalizedExistingStatus === "COMPLETE";
      const remoteTotal = this.toPositiveInt(status?.total_chapters);
      const localTotal = this.toPositiveInt(localEntry?.total_chapters);
      const inferredTotal =
        boundaries.maxProgressNumber ??
        this.toPositiveInt(boundaries.totalCount);
      const resolvedTotal = remoteTotal ?? localTotal ?? inferredTotal ?? null;
      const rawStatusScore = Number(status?.score);
      const rawLocalScore = Number(localEntry?.score);
      const preservedScore = this.normalizeScore(
        Number.isFinite(rawStatusScore) && rawStatusScore > 0
          ? rawStatusScore
          : Number.isFinite(rawLocalScore) && rawLocalScore > 0
            ? rawLocalScore
            : null,
      );

      try {
        if (shouldAutoComplete) {
          const completionProgress = Math.max(
            resolvedTotal || 0,
            previousProgress,
            1,
          );
          if (isAlreadyCompleted && previousProgress >= completionProgress) {
            continue;
          }
          await this.updateTrackingEntry({
            seriesId,
            service,
            remoteId,
            chaptersRead: completionProgress,
            score: preservedScore,
            status: "COMPLETED",
            totalChapters: resolvedTotal ?? completionProgress,
            startedAt: isFirstChapter && hasNoPreviousRead ? startedAt : null,
          });
          completedServices.add(service);
          continue;
        }
        const targetProgress = Math.max(
          previousProgress,
          targetProgressBase,
          1,
        );
        if (targetProgress <= previousProgress && !hasNoPreviousRead) {
          continue;
        }
        const shouldForceReadingStatus =
          hasNoPreviousRead ||
          normalizedExistingStatus === "PLANNING" ||
          normalizedExistingStatus === "PLAN_TO_READ";
        await this.updateTrackingEntry({
          seriesId,
          service,
          remoteId,
          chaptersRead: targetProgress,
          score: preservedScore,
          status: shouldForceReadingStatus
            ? "reading"
            : (status?.status ?? localEntry?.status ?? "reading"),
          totalChapters: resolvedTotal,
          startedAt: isFirstChapter && hasNoPreviousRead ? startedAt : null,
        });
        if (isFirstChapter && hasNoPreviousRead) {
          readingServices.add(service);
        } else {
          progressServices.add(service);
        }
      } catch (error) {
        console.warn(
          `[Tracking] Auto-update failed for ${service}:`,
          this.formatErrorBrief(error),
        );
      }
    }

    if (completedServices.size > 0) {
      return {
        action: "completed",
        services: this.getOrderedServices(completedServices),
        seriesTitle: this.getSeriesDisplayTitle(series),
        label: chapterLabel,
      };
    }
    if (readingServices.size > 0) {
      return {
        action: "reading",
        services: this.getOrderedServices(readingServices),
        seriesTitle: this.getSeriesDisplayTitle(series),
        label: chapterLabel,
      };
    }
    if (progressServices.size > 0) {
      return {
        action: "progress",
        services: this.getOrderedServices(progressServices),
        seriesTitle: this.getSeriesDisplayTitle(series),
        label: chapterLabel,
      };
    }
    return null;
  }

  async login(service: "mal" | "anilist"): Promise<TrackingLoginResult> {
    try {
      if (service === "mal") {
        const tokens = await this.mal.authenticate();
        const account: TrackingAccount = {
          service: "mal",
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          is_active: true,
        };
        try {
          await mangaQueries.upsertTrackingAccount(account);
          this.volatileAccounts.delete("mal");
        } catch (storageError) {
          this.volatileAccounts.set("mal", account);
          console.warn(
            "[Tracking] Secure storage unavailable; MAL login is session-only.",
            storageError,
          );
        }
      } else {
        const token = await this.anilist.authenticate();
        const account: TrackingAccount = {
          service: "anilist",
          access_token: token,
          is_active: true,
        };
        try {
          await mangaQueries.upsertTrackingAccount(account);
          this.volatileAccounts.delete("anilist");
        } catch (storageError) {
          this.volatileAccounts.set("anilist", account);
          console.warn(
            "[Tracking] Secure storage unavailable; AniList login is session-only.",
            storageError,
          );
        }
      }
      // Clear caches after re-auth to avoid stale statuses/friends snapshots.
      this.clearTrackingCaches();
      return { status: "success" };
    } catch (e) {
      if (this.isUserCancellationError(e)) {
        return { status: "cancelled" };
      }
      console.error(`Login failed for ${service}:`, e);
      const errorMessage = String((e as any)?.message || "").trim();
      return {
        status: "error",
        error: errorMessage || "Login failed",
      };
    }
  }

  async disconnect(service: "mal" | "anilist"): Promise<boolean> {
    let changed = false;
    if (this.volatileAccounts.delete(service)) {
      changed = true;
    }

    try {
      if (mangaQueries.deleteTrackingAccount(service)) {
        changed = true;
      }
    } catch (error) {
      console.warn(
        `[Tracking] Failed to remove persisted ${service} account:`,
        error,
      );
    }

    this.clearTrackingCaches();
    return changed;
  }

  async getFriendsReading(
    anilistId?: number,
    malId?: number,
  ): Promise<FriendReading[]> {
    const cacheKey = `${anilistId || 0}:${malId || 0}`;
    const now = Date.now();
    const cached = this.friendsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.data;
    const inFlight = this.inFlightRequests.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const accounts = this.getTrackingAccounts().filter(
        (account) => account.is_active,
      );

      const withTimeout = async (
        p: Promise<FriendReading[]>,
        ms: number,
      ): Promise<FriendReading[]> => {
        return Promise.race([
          p,
          new Promise<FriendReading[]>((resolve) =>
            setTimeout(() => resolve([]), ms),
          ),
        ]);
      };

      const tasks: Promise<FriendReading[]>[] = [];

      for (const account of accounts) {
        if (account.service === "anilist" && anilistId) {
          tasks.push(
            withTimeout(
              this.anilist.getFriendsReading(anilistId, account),
              30000,
            ).catch((error) => {
              console.warn(
                "[Tracking] AniList friends unavailable:",
                this.formatErrorBrief(error),
              );
              return [];
            }),
          );
        }

        if (account.service === "mal" && malId) {
          tasks.push(
            withTimeout(this.mal.getFriendsReading(malId, account), 3500).catch(
              (error) => {
                console.warn(
                  "[Tracking] MAL friends unavailable:",
                  this.formatErrorBrief(error),
                );
                return [];
              },
            ),
          );
        }
      }

      if (tasks.length === 0) return [];

      const merged = (await Promise.all(tasks)).flat();

      // Deduplicate by service+username and keep highest progress.
      const byUser = new Map<string, FriendReading>();
      for (const friend of merged) {
        const key = `${friend.service}:${friend.username.toLowerCase()}`;
        const existing = byUser.get(key);
        if (!existing || friend.progress > existing.progress) {
          byUser.set(key, friend);
        }
      }

      const data = Array.from(byUser.values()).sort((a, b) => {
        const byService = a.service.localeCompare(b.service, undefined, {
          sensitivity: "base",
        });
        if (byService !== 0) return byService;
        return a.username.localeCompare(b.username, undefined, {
          sensitivity: "base",
        });
      });
      this.friendsCache.set(cacheKey, {
        data,
        expiresAt:
          now +
          (data.length > 0
            ? this.FRIENDS_CACHE_TTL_MS
            : this.EMPTY_CACHE_TTL_MS),
      });
      return data;
    })();

    this.inFlightRequests.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inFlightRequests.delete(cacheKey);
    }
  }

  async getUserTrackingStatus(
    seriesId: number,
    anilistId?: number,
    malId?: number,
  ): Promise<UserTrackingStatus[]> {
    const requestKey = `${Number(seriesId || 0)}:${Number(anilistId || 0)}:${Number(malId || 0)}`;
    const inFlight = this.statusInFlightRequests.get(requestKey);
    if (inFlight) return inFlight;

    const requestPromise = this.getUserTrackingStatusInternal(
      seriesId,
      anilistId,
      malId,
    ).finally(() => {
      this.statusInFlightRequests.delete(requestKey);
    });
    this.statusInFlightRequests.set(requestKey, requestPromise);
    return requestPromise;
  }

  private async getUserTrackingStatusInternal(
    seriesId: number,
    anilistId?: number,
    malId?: number,
  ): Promise<UserTrackingStatus[]> {
    const normalizedSeriesId = Number(seriesId || 0);
    if (!Number.isFinite(normalizedSeriesId) || normalizedSeriesId <= 0) {
      return [];
    }

    const activeAccounts = this.getTrackingAccounts().filter(
      (account) => account.is_active && !!account.access_token,
    );

    const accountByService = new Map<"mal" | "anilist", TrackingAccount>();
    for (const account of activeAccounts) {
      accountByService.set(account.service, account);
    }

    const toPositiveInt = (value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
      }
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const direct = Number(raw);
      if (Number.isFinite(direct) && direct > 0) {
        return Math.floor(direct);
      }
      const match = raw.match(/(\d+)/);
      if (!match?.[1]) return 0;
      const extracted = Number(match[1]);
      return Number.isFinite(extracted) && extracted > 0
        ? Math.floor(extracted)
        : 0;
    };

    const localEntries = mangaQueries.getTrackingEntries(normalizedSeriesId);
    let localAnilistId = 0;
    let localMalId = 0;
    for (const entry of localEntries) {
      const service = String(entry?.service || "").toLowerCase();
      const remoteId = toPositiveInt(entry?.remote_id);
      if (!remoteId) continue;
      if (service === "anilist" && !localAnilistId) {
        localAnilistId = remoteId;
      } else if (service === "mal" && !localMalId) {
        localMalId = remoteId;
      }
    }

    const statuses: UserTrackingStatus[] = [];
    const normalizedAnilistId = localAnilistId || toPositiveInt(anilistId) || 0;
    const normalizedMalId = localMalId || toPositiveInt(malId) || 0;
    const readTotal = (status: UserTrackingStatus | undefined | null) => {
      const total = Number(status?.total_chapters ?? 0);
      return Number.isFinite(total) && total > 0 ? total : null;
    };
    const readVolumeTotal = (status: UserTrackingStatus | undefined | null) => {
      const total = Number(status?.total_volumes ?? 0);
      return Number.isFinite(total) && total > 0 ? total : null;
    };
    const wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    const runWithRetry = async <T>(task: () => Promise<T>, retries = 1) => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          return await task();
        } catch (error) {
          lastError = error;
          if (this.isRateLimitedError(error)) break;
          if (attempt >= retries) break;
          await wait(220);
        }
      }
      throw lastError;
    };

    const anilistAccount = accountByService.get("anilist");
    if (anilistAccount) {
      if (normalizedAnilistId > 0) {
        try {
          const current = await runWithRetry(
            () =>
              this.anilist.getCurrentUserStatus(
                normalizedAnilistId,
                anilistAccount,
              ),
            1,
          );
          statuses.push(current);
        } catch (error) {
          console.warn(
            "[Tracking] AniList user status unavailable:",
            this.formatErrorBrief(error),
          );
          statuses.push({
            service: "anilist",
            remote_id: String(normalizedAnilistId),
            has_entry: false,
            status_unavailable: true,
          });
        }
      } else {
        statuses.push({
          service: "anilist",
          has_entry: false,
        });
      }
    }

    const malAccount = accountByService.get("mal");
    if (malAccount) {
      if (normalizedMalId > 0) {
        try {
          const current = await runWithRetry(
            () => this.mal.getCurrentUserStatus(normalizedMalId, malAccount),
            1,
          );
          statuses.push(current);
        } catch (error) {
          console.warn(
            "[Tracking] MAL user status unavailable:",
            this.formatErrorBrief(error),
          );
          statuses.push({
            service: "mal",
            remote_id: String(normalizedMalId),
            has_entry: false,
            status_unavailable: true,
          });
        }
      } else {
        statuses.push({
          service: "mal",
          has_entry: false,
        });
      }
    }

    for (const status of statuses) {
      if (readTotal(status) !== null) continue;
      if (status.service === "anilist" && normalizedAnilistId > 0) {
        try {
          const total = await runWithRetry(
            () => this.anilist.getTotalChapters(normalizedAnilistId),
            1,
          );
          if (total !== null) status.total_chapters = total;
        } catch (error) {
          console.warn(
            "[Tracking] Failed to resolve AniList chapter total:",
            this.formatErrorBrief(error),
          );
        }
        continue;
      }
      if (status.service === "mal" && normalizedMalId > 0) {
        try {
          const total = await runWithRetry(
            () => this.mal.getTotalChapters(normalizedMalId, malAccount),
            1,
          );
          if (total !== null) status.total_chapters = total;
        } catch (error) {
          console.warn(
            "[Tracking] Failed to resolve MAL chapter total:",
            this.formatErrorBrief(error),
          );
        }
      }
    }

    for (const status of statuses) {
      if (readVolumeTotal(status) !== null) continue;
      if (status.service === "anilist" && normalizedAnilistId > 0) {
        try {
          const total = await runWithRetry(
            () => this.anilist.getTotalVolumes(normalizedAnilistId),
            1,
          );
          if (total !== null) status.total_volumes = total;
        } catch (error) {
          console.warn(
            "[Tracking] Failed to resolve AniList volume total:",
            this.formatErrorBrief(error),
          );
        }
        continue;
      }
      if (status.service === "mal" && normalizedMalId > 0) {
        try {
          const total = await runWithRetry(
            () => this.mal.getTotalVolumes(normalizedMalId, malAccount),
            1,
          );
          if (total !== null) status.total_volumes = total;
        } catch (error) {
          console.warn(
            "[Tracking] Failed to resolve MAL volume total:",
            this.formatErrorBrief(error),
          );
        }
      }
    }

    for (const status of statuses) {
      const remoteId = String(status.remote_id || "").trim();
      const resolvedTotal = readTotal(status);
      const resolvedVolumeTotal = readVolumeTotal(status);
      const statusUnavailable = this.isStatusUnavailable(status);
      if (!status.has_entry) {
        if (statusUnavailable) {
          if (resolvedTotal === null && resolvedVolumeTotal === null) continue;
          try {
            const existing = mangaQueries.getTrackingEntry(
              normalizedSeriesId,
              status.service,
            );
            if (existing?.id) {
              const updates: Partial<TrackingEntry> = {};
              if (resolvedTotal !== null) {
                updates.total_chapters = resolvedTotal;
              }
              if (resolvedVolumeTotal !== null) {
                updates.total_volumes = resolvedVolumeTotal;
              }
              if (Object.keys(updates).length > 0) {
                mangaQueries.updateTrackingEntry(existing.id, updates);
              }
            }
          } catch (error) {
            console.warn(
              `[Tracking] Failed to persist ${status.service} totals:`,
              this.formatErrorBrief(error),
            );
          }
          continue;
        }
        try {
          const existing = mangaQueries.getTrackingEntry(
            normalizedSeriesId,
            status.service,
          );
          if (existing?.id) {
            const updates: Partial<TrackingEntry> = {};
            if (remoteId) {
              updates.remote_id = remoteId;
            }
            updates.status = null;
            updates.chapters_read = 0;
            updates.volumes_read = 0;
            updates.score = null;
            if (resolvedTotal !== null) {
              updates.total_chapters = resolvedTotal;
            }
            if (resolvedVolumeTotal !== null) {
              updates.total_volumes = resolvedVolumeTotal;
            }
            if (Object.keys(updates).length > 0) {
              mangaQueries.updateTrackingEntry(existing.id, updates);
            }
          }
        } catch (error) {
          console.warn(
            `[Tracking] Failed to persist ${status.service} totals:`,
            this.formatErrorBrief(error),
          );
        }
        continue;
      }
      if (!remoteId) continue;

      const chaptersRead = Number(status.chapters_read || 0);
      const volumesRead = Number(status.volumes_read || 0);
      const normalizedScore = Number(status.score);
      const score =
        Number.isFinite(normalizedScore) && normalizedScore > 0
          ? normalizedScore
          : null;

      try {
        mangaQueries.upsertTrackingEntry({
          series_id: normalizedSeriesId,
          service: status.service,
          remote_id: remoteId,
          status: String(status.status || "").trim(),
          chapters_read:
            Number.isFinite(chaptersRead) && chaptersRead >= 0
              ? chaptersRead
              : 0,
          total_chapters: resolvedTotal,
          volumes_read:
            Number.isFinite(volumesRead) && volumesRead >= 0 ? volumesRead : 0,
          total_volumes: resolvedVolumeTotal,
          score,
        });
      } catch (error) {
        console.warn(
          `[Tracking] Failed to upsert ${status.service} tracking entry:`,
          this.formatErrorBrief(error),
        );
      }
    }

    return statuses;
  }
}

export const trackingService = new TrackingService();
