import { getDb } from "../database";
import fs from "fs";
import type {
  MangaSeries,
  MangaChapter,
  MangaExtension,
  TrackingAccount,
  TrackingEntry,
  ReadingFormat,
} from "../../types/manga-types";
import {
  isStoredSecret,
  isSecretStorageAvailable,
  protectSecret,
  revealSecret,
} from "../../security/secret-store";
import {
  TRACKING_IDENTITY_SOURCE_ID,
  normalizeReadingFormat,
} from "../../../src/lib/utils/manga";

const LEGACY_PLAIN_PREFIX = "plain:v1:";

// --- MANGA SERIES ---

function normalizeGenres(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  }

  const raw = String(value || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => String(entry || "").trim())
        .filter(Boolean);
    }
    if (typeof parsed === "string") {
      const single = parsed.trim();
      return single ? [single] : [];
    }
  } catch {
    // Fall back to legacy/comma-delimited values.
  }

  return raw
    .split(/[,|/]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toMangaSeries(row: any): MangaSeries {
  return {
    ...row,
    genres: normalizeGenres(row?.genres),
  } as MangaSeries;
}

export function addMangaSeries(
  series: Omit<MangaSeries, "id" | "added_at">,
): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO manga_series (
      source_id, source_url, anilist_id, mal_id, mangabaka_id, title_original, title_romaji, title_english, 
      description, cover_url, banner_url, cover_local_path, author, artist, status, 
      reading_format, mal_score, year, genres, last_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    series.source_id,
    series.source_url,
    series.anilist_id || null,
    series.mal_id || null,
    series.mangabaka_id || null,
    series.title_original,
    series.title_romaji || null,
    series.title_english || null,
    series.description || null,
    series.cover_url || null,
    series.banner_url || null,
    series.cover_local_path || null,
    series.author || null,
    series.artist || null,
    series.status || null,
    series.reading_format || "manga",
    series.mal_score || null,
    series.year || null,
    series.genres ? JSON.stringify(series.genres) : null,
    series.last_updated || null,
  );

  return result.lastInsertRowid as number;
}

export function getMangaSeries(id: number): MangaSeries | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM manga_series WHERE id = ?")
    .get(id) as any;
  if (!row) return null;
  return toMangaSeries(row);
}

export function getMangaSeriesByAnilistId(anilistId: number): MangaSeries | null {
  const normalizedId = Number(anilistId || 0);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) return null;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM manga_series WHERE anilist_id = ? LIMIT 1")
    .get(Math.floor(normalizedId)) as any;
  if (!row) return null;
  return toMangaSeries(row);
}

export function getMangaSeriesByMalId(malId: number): MangaSeries | null {
  const normalizedId = Number(malId || 0);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) return null;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM manga_series WHERE mal_id = ? LIMIT 1")
    .get(Math.floor(normalizedId)) as any;
  if (!row) return null;
  return toMangaSeries(row);
}

export function getMangaSeriesByMangabakaId(
  mangabakaId: number,
): MangaSeries | null {
  const normalizedId = Number(mangabakaId || 0);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) return null;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM manga_series WHERE mangabaka_id = ? LIMIT 1")
    .get(Math.floor(normalizedId)) as any;
  if (!row) return null;
  return toMangaSeries(row);
}

export function getMangaSeriesBySource(
  sourceId: string,
  sourceUrl: string,
): MangaSeries | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM manga_series WHERE source_id = ? AND source_url = ?")
    .get(sourceId, sourceUrl) as any;
  if (!row) return null;
  return toMangaSeries(row);
}

export function getAllMangaSeries(): MangaSeries[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM manga_series ORDER BY added_at DESC")
    .all() as any[];
  return rows.map((row) => toMangaSeries(row));
}

export function updateMangaSeries(
  id: number,
  updates: Partial<MangaSeries>,
): boolean {
  const db = getDb();
  const keys = Object.keys(updates);
  if (keys.length === 0) return false;

  const setClause = keys
    .map((key) => {
      if (key === "genres") return `${key} = ?`;
      return `${key} = ?`;
    })
    .join(", ");

  const values = keys.map((key) => {
    if (key === "genres") return JSON.stringify(updates[key]);
    return (updates as any)[key];
  });

  const stmt = db.prepare(`UPDATE manga_series SET ${setClause} WHERE id = ?`);
  const result = stmt.run(...values, id);
  return result.changes > 0;
}

export function deleteMangaSeries(id: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM manga_series WHERE id = ?").run(id);
  return result.changes > 0;
}

export function upsertMangaSeriesBySource(
  series: Omit<MangaSeries, "id" | "added_at">,
): number {
  return persistMangaSeries(series);
}

function hasMeaningfulSeriesValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return true;
}

function mergeReadingFormatValue(
  existing: unknown,
  incoming: unknown,
): ReadingFormat | undefined {
  const existingFormat = normalizeReadingFormat(String(existing || ""));
  const incomingFormat = normalizeReadingFormat(String(incoming || ""));

  if (existingFormat === "manga" && incomingFormat && incomingFormat !== "manga") {
    return incomingFormat;
  }
  if (existingFormat) return existingFormat;
  if (incomingFormat) return incomingFormat;
  return undefined;
}

function isPlaceholderSeriesTitle(value: unknown): boolean {
  return String(value || "")
    .trim()
    .toLowerCase() === "unknown series";
}

function isMetadataTrackingIdentity(
  sourceId: unknown,
  sourceUrl: unknown,
): boolean {
  const normalizedSourceId = String(sourceId || "")
    .trim()
    .toLowerCase();
  const normalizedSourceUrl = String(sourceUrl || "")
    .trim()
    .toLowerCase();

  if (
    normalizedSourceId === "anilist" ||
    normalizedSourceId === "mal" ||
    normalizedSourceId === "mangabaka" ||
    normalizedSourceId === TRACKING_IDENTITY_SOURCE_ID
  ) {
    return true;
  }

  return (
    normalizedSourceUrl.startsWith("anilist:") ||
    normalizedSourceUrl.startsWith("mal:") ||
    normalizedSourceUrl.startsWith("mangabaka:") ||
    normalizedSourceUrl.includes("anilist.co/") ||
    normalizedSourceUrl.includes("myanimelist.net/") ||
    normalizedSourceUrl.includes("mangabaka.org/")
  );
}

function pickExistingSeriesByIdentity(
  series: Partial<Omit<MangaSeries, "id" | "added_at">>,
): MangaSeries | null {
  const anilistId = Number(series.anilist_id || 0);
  if (Number.isFinite(anilistId) && anilistId > 0) {
    const existing = getMangaSeriesByAnilistId(Math.floor(anilistId));
    if (existing) return existing;
  }

  const malId = Number(series.mal_id || 0);
  if (Number.isFinite(malId) && malId > 0) {
    const existing = getMangaSeriesByMalId(Math.floor(malId));
    if (existing) return existing;
  }

  const mangabakaId = Number(series.mangabaka_id || 0);
  if (Number.isFinite(mangabakaId) && mangabakaId > 0) {
    const existing = getMangaSeriesByMangabakaId(Math.floor(mangabakaId));
    if (existing) return existing;
  }

  const sourceId = String(series.source_id || "").trim();
  const sourceUrl = String(series.source_url || "").trim();
  if (sourceId && sourceUrl) {
    return getMangaSeriesBySource(sourceId, sourceUrl);
  }

  return null;
}

function buildSeriesUpdates(
  series: Partial<Omit<MangaSeries, "id" | "added_at">>,
  fields: Array<keyof Omit<MangaSeries, "id" | "added_at">>,
) {
  const updates: Partial<MangaSeries> = {};

  for (const field of fields) {
    const value = series[field];
    if (!hasMeaningfulSeriesValue(value)) continue;
    (updates as any)[field] = value;
  }

  return updates;
}

function buildDirectSeriesUpdates(
  series: Partial<Omit<MangaSeries, "id" | "added_at">>,
) {
  return buildSeriesUpdates(series, [
    "anilist_id",
    "mal_id",
    "mangabaka_id",
    "title_original",
    "title_romaji",
    "title_english",
    "description",
    "cover_url",
    "banner_url",
    "cover_local_path",
    "author",
    "artist",
    "status",
    "reading_format",
    "mal_score",
    "year",
    "genres",
    "last_updated",
  ]);
}

function buildMergedSeriesUpdates(
  existing: MangaSeries,
  series: Partial<Omit<MangaSeries, "id" | "added_at">>,
) {
  return buildSeriesUpdates(
    {
      ...series,
      source_id:
        !hasMeaningfulSeriesValue(existing.source_id) ||
        !hasMeaningfulSeriesValue(existing.source_url) ||
        isMetadataTrackingIdentity(existing.source_id, existing.source_url)
          ? series.source_id
          : existing.source_id,
      source_url:
        !hasMeaningfulSeriesValue(existing.source_id) ||
        !hasMeaningfulSeriesValue(existing.source_url) ||
        isMetadataTrackingIdentity(existing.source_id, existing.source_url)
          ? series.source_url
          : existing.source_url,
      title_original:
        hasMeaningfulSeriesValue(existing.title_original) &&
        !isPlaceholderSeriesTitle(existing.title_original)
        ? existing.title_original
        : series.title_original,
      title_romaji: hasMeaningfulSeriesValue(existing.title_romaji)
        ? existing.title_romaji
        : series.title_romaji,
      title_english: hasMeaningfulSeriesValue(existing.title_english)
        ? existing.title_english
        : series.title_english,
      description: hasMeaningfulSeriesValue(existing.description)
        ? existing.description
        : series.description,
      cover_url: hasMeaningfulSeriesValue(existing.cover_url)
        ? existing.cover_url
        : series.cover_url,
      banner_url: hasMeaningfulSeriesValue(existing.banner_url)
        ? existing.banner_url
        : series.banner_url,
      cover_local_path: hasMeaningfulSeriesValue(existing.cover_local_path)
        ? existing.cover_local_path
        : series.cover_local_path,
      author: hasMeaningfulSeriesValue(existing.author)
        ? existing.author
        : series.author,
      artist: hasMeaningfulSeriesValue(existing.artist)
        ? existing.artist
        : series.artist,
      status: hasMeaningfulSeriesValue(existing.status)
        ? existing.status
        : series.status,
      reading_format: mergeReadingFormatValue(
        existing.reading_format,
        series.reading_format,
      ),
      mal_score: hasMeaningfulSeriesValue(existing.mal_score)
        ? existing.mal_score
        : series.mal_score,
      year: hasMeaningfulSeriesValue(existing.year)
        ? existing.year
        : series.year,
      genres:
        Array.isArray(existing.genres) && existing.genres.length > 0
          ? existing.genres
          : series.genres,
      anilist_id: hasMeaningfulSeriesValue(existing.anilist_id)
        ? existing.anilist_id
        : series.anilist_id,
      mal_id: hasMeaningfulSeriesValue(existing.mal_id)
        ? existing.mal_id
        : series.mal_id,
      mangabaka_id: hasMeaningfulSeriesValue(existing.mangabaka_id)
        ? existing.mangabaka_id
        : series.mangabaka_id,
      last_updated: series.last_updated || existing.last_updated,
    },
    [
      "source_id",
      "source_url",
      "anilist_id",
      "mal_id",
      "mangabaka_id",
      "title_original",
      "title_romaji",
      "title_english",
      "description",
      "cover_url",
      "banner_url",
      "cover_local_path",
      "author",
      "artist",
      "status",
      "reading_format",
      "mal_score",
      "year",
      "genres",
      "last_updated",
    ],
  );
}

function shouldMergeSeriesByIdentity(
  existing: MangaSeries,
  series: Partial<Omit<MangaSeries, "id" | "added_at">>,
) {
  if (
    !hasMeaningfulSeriesValue(existing.source_id) ||
    !hasMeaningfulSeriesValue(existing.source_url)
  ) {
    return true;
  }

  return (
    isMetadataTrackingIdentity(existing.source_id, existing.source_url) ||
    isMetadataTrackingIdentity(series.source_id, series.source_url)
  );
}

function persistMangaSeries(
  series: Omit<MangaSeries, "id" | "added_at">,
): number {
  const existingBySource = getMangaSeriesBySource(series.source_id, series.source_url);
  if (existingBySource?.id) {
    const updates = buildDirectSeriesUpdates(series);
    if (Object.keys(updates).length > 0) {
      updateMangaSeries(existingBySource.id, updates);
    }
    return existingBySource.id;
  }

  const existingByIdentity = pickExistingSeriesByIdentity(series);
  if (!existingByIdentity?.id) {
    return addMangaSeries(series);
  }

  if (!shouldMergeSeriesByIdentity(existingByIdentity, series)) {
    return addMangaSeries(series);
  }

  const updates = buildMergedSeriesUpdates(existingByIdentity, series);
  if (Object.keys(updates).length > 0) {
    updateMangaSeries(existingByIdentity.id, updates);
  }
  return existingByIdentity.id;
}

export function ensureMangaSeriesForTracking(
  series: Partial<Omit<MangaSeries, "id" | "added_at">> &
    Pick<MangaSeries, "source_id" | "source_url" | "title_original" | "reading_format">,
): number {
  const normalizedSeries: Omit<MangaSeries, "id" | "added_at"> = {
    source_id: String(series.source_id || "").trim(),
    source_url: String(series.source_url || "").trim(),
    anilist_id:
      Number.isFinite(Number(series.anilist_id || 0)) &&
      Number(series.anilist_id || 0) > 0
        ? Math.floor(Number(series.anilist_id))
        : undefined,
    mal_id:
      Number.isFinite(Number(series.mal_id || 0)) &&
      Number(series.mal_id || 0) > 0
        ? Math.floor(Number(series.mal_id))
        : undefined,
    mangabaka_id:
      Number.isFinite(Number(series.mangabaka_id || 0)) &&
      Number(series.mangabaka_id || 0) > 0
        ? Math.floor(Number(series.mangabaka_id))
        : undefined,
    title_original: String(series.title_original || "").trim() || "Unknown Series",
    title_romaji: String(series.title_romaji || "").trim() || undefined,
    title_english: String(series.title_english || "").trim() || undefined,
    description: String(series.description || "").trim() || undefined,
    cover_url: String(series.cover_url || "").trim() || undefined,
    banner_url: String(series.banner_url || "").trim() || undefined,
    cover_local_path: String(series.cover_local_path || "").trim() || undefined,
    author: String(series.author || "").trim() || undefined,
    artist: String(series.artist || "").trim() || undefined,
    status: series.status,
    reading_format: series.reading_format || "manga",
    mal_score:
      Number.isFinite(Number(series.mal_score)) && Number(series.mal_score) > 0
        ? Number(series.mal_score)
        : undefined,
    year:
      Number.isFinite(Number(series.year)) && Number(series.year) > 0
        ? Math.floor(Number(series.year))
        : undefined,
    genres: Array.isArray(series.genres)
      ? series.genres
          .map((entry) => String(entry || "").trim())
          .filter(Boolean)
      : undefined,
    last_updated: String(series.last_updated || "").trim() || undefined,
  };
  return persistMangaSeries(normalizedSeries);
}

// --- MANGA CHAPTERS ---

export function addMangaChapter(chapter: Omit<MangaChapter, "id">): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO manga_chapters (
      series_id, chapter_number, volume_number, title, source_url, 
      scanlator, date_uploaded, is_downloaded, download_path, 
      is_read, current_page, page_count, last_read_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    chapter.series_id,
    chapter.chapter_number,
    chapter.volume_number || null,
    chapter.title || null,
    chapter.source_url,
    chapter.scanlator || null,
    chapter.date_uploaded || null,
    chapter.is_downloaded ? 1 : 0,
    chapter.download_path || null,
    chapter.is_read ? 1 : 0,
    chapter.current_page || 0,
    chapter.page_count || 0,
    chapter.last_read_at || null,
  );

  return result.lastInsertRowid as number;
}

export function getMangaChapterBySource(
  seriesId: number,
  sourceUrl: string,
): MangaChapter | null {
  const db = getDb();
  const row = db
    .prepare(
      `
    SELECT *
    FROM manga_chapters
    WHERE series_id = ? AND source_url = ?
    ORDER BY id DESC
    LIMIT 1
  `,
    )
    .get(seriesId, sourceUrl) as any;
  if (!row) return null;
  return {
    ...row,
    is_downloaded: !!row.is_downloaded,
    is_read: !!row.is_read,
  } as MangaChapter;
}

export function getMangaSeriesIdByChapterSourceUrl(
  sourceUrl: string,
): number | null {
  const db = getDb();
  const row = db
    .prepare(
      `
    SELECT series_id
    FROM manga_chapters
    WHERE source_url = ?
    ORDER BY id DESC
    LIMIT 1
  `,
    )
    .get(sourceUrl) as { series_id?: number } | undefined;
  const seriesId = Number(row?.series_id || 0);
  return seriesId > 0 ? seriesId : null;
}

export function getMangaSeriesIdByChapterDownloadPath(
  downloadPath: string,
): number | null {
  const normalizedPath = String(downloadPath || "").trim();
  if (!normalizedPath) return null;
  const db = getDb();
  const row = db
    .prepare(
      `
    SELECT series_id
    FROM manga_chapters
    WHERE LOWER(download_path) = LOWER(?)
    ORDER BY id DESC
    LIMIT 1
  `,
    )
    .get(normalizedPath) as { series_id?: number } | undefined;
  const seriesId = Number(row?.series_id || 0);
  return seriesId > 0 ? seriesId : null;
}

export function upsertMangaChapterBySource(
  chapter: Omit<MangaChapter, "id">,
): number {
  const existing = getMangaChapterBySource(
    Number(chapter.series_id || 0),
    chapter.source_url,
  );

  if (!existing?.id) {
    return addMangaChapter(chapter);
  }

  const db = getDb();
  const stmt = db.prepare(`
    UPDATE manga_chapters
    SET
      chapter_number = ?,
      volume_number = ?,
      title = ?,
      scanlator = ?,
      date_uploaded = ?,
      is_downloaded = ?,
      download_path = ?,
      is_read = ?,
      current_page = ?,
      page_count = ?,
      last_read_at = ?
    WHERE id = ?
  `);
  stmt.run(
    chapter.chapter_number,
    chapter.volume_number || null,
    chapter.title || null,
    chapter.scanlator || null,
    chapter.date_uploaded || null,
    chapter.is_downloaded ? 1 : 0,
    chapter.download_path || null,
    chapter.is_read ? 1 : 0,
    chapter.current_page || 0,
    chapter.page_count || 0,
    chapter.last_read_at || null,
    existing.id,
  );

  return existing.id;
}

export function getMangaChapters(seriesId: number): MangaChapter[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT * FROM manga_chapters 
    WHERE series_id = ? 
    ORDER BY chapter_number ASC
  `,
    )
    .all(seriesId) as any[];

  return rows.map((row) => ({
    ...row,
    is_downloaded: !!row.is_downloaded,
    is_read: !!row.is_read,
  })) as MangaChapter[];
}

export function getLatestMangaChapterStatesBySourceUrls(
  sourceUrls: string[],
): Record<string, MangaChapter> {
  const normalizedUrls = Array.from(
    new Set(
      (sourceUrls || [])
        .map((url) => String(url || "").trim())
        .filter(Boolean),
    ),
  );
  if (normalizedUrls.length === 0) return {};

  const db = getDb();
  const chunkSize = 400;
  const result: Record<string, MangaChapter> = {};

  for (let start = 0; start < normalizedUrls.length; start += chunkSize) {
    const chunk = normalizedUrls.slice(start, start + chunkSize);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `
        SELECT mc.*
        FROM manga_chapters mc
        INNER JOIN (
          SELECT source_url, MAX(id) AS max_id
          FROM manga_chapters
          WHERE source_url IN (${placeholders})
          GROUP BY source_url
        ) latest ON latest.max_id = mc.id
      `,
      )
      .all(...chunk) as any[];

    for (const row of rows) {
      const sourceUrl = String(row?.source_url || "").trim();
      if (!sourceUrl) continue;
      const rawDownloadPath = String(row?.download_path || "").trim();
      const hasLocalDownloadPath = rawDownloadPath.length > 0;
      let hasLocalFile = false;
      if (hasLocalDownloadPath) {
        try {
          hasLocalFile = fs.existsSync(rawDownloadPath);
        } catch {
          hasLocalFile = false;
        }
      }
      const isDownloaded = Boolean(row?.is_downloaded) && hasLocalFile;
      result[sourceUrl] = {
        ...row,
        is_downloaded: isDownloaded,
        download_path: hasLocalFile ? rawDownloadPath : undefined,
        is_read: !!row.is_read,
      } as MangaChapter;
    }
  }

  return result;
}

export function getMangaChapterCount(seriesId: number): number {
  const db = getDb();
  const row = db
    .prepare(
      `
    SELECT COUNT(*) as count
    FROM manga_chapters
    WHERE series_id = ?
  `,
    )
    .get(seriesId) as { count?: number } | undefined;
  return Number(row?.count || 0);
}

export function updateChapterProgress(
  id: number,
  currentPage: number,
  isRead: boolean,
): boolean {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE manga_chapters 
    SET current_page = ?, is_read = ?, last_read_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `);
  const result = stmt.run(currentPage, isRead ? 1 : 0, id);
  return result.changes > 0;
}

// --- EXTENSIONS ---

export function addExtension(extension: MangaExtension): boolean {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO manga_extensions (
      id, name, version, source_type, icon_url, is_enabled, config
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    extension.id,
    extension.name,
    extension.version,
    extension.source_type,
    extension.icon_url || null,
    extension.is_enabled ? 1 : 0,
    extension.config ? JSON.stringify(extension.config) : null,
  );

  return result.changes > 0;
}

export function getInstalledExtensions(): MangaExtension[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM manga_extensions").all() as any[];
  return rows.map((row) => ({
    ...row,
    is_enabled: !!row.is_enabled,
    config: row.config ? JSON.parse(row.config) : null,
  })) as MangaExtension[];
}

export function removeExtension(id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM manga_extensions WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

// --- TRACKING ---

function secureTrackingRow(db: ReturnType<typeof getDb>, row: any): any {
  if (!row) return row;

  let accessToken = row.access_token as string | null;
  let refreshToken = row.refresh_token as string | null;
  let isActive = !!row.is_active;
  let changed = false;

  const canPersistSecurely = isSecretStorageAvailable();

  if (accessToken && !isStoredSecret(accessToken)) {
    const normalizedAccessToken = accessToken.startsWith(LEGACY_PLAIN_PREFIX)
      ? accessToken.slice(LEGACY_PLAIN_PREFIX.length)
      : accessToken;
    if (canPersistSecurely) {
      const secured = protectSecret(normalizedAccessToken);
      if (secured && secured !== accessToken) {
        accessToken = secured;
        changed = true;
      }
    } else {
      // Drop legacy plaintext token instead of keeping insecure data.
      accessToken = null;
      isActive = false;
      changed = true;
    }
  }

  if (refreshToken && !isStoredSecret(refreshToken)) {
    const normalizedRefreshToken = refreshToken.startsWith(LEGACY_PLAIN_PREFIX)
      ? refreshToken.slice(LEGACY_PLAIN_PREFIX.length)
      : refreshToken;
    if (canPersistSecurely) {
      const secured = protectSecret(normalizedRefreshToken);
      if (secured && secured !== refreshToken) {
        refreshToken = secured;
        changed = true;
      }
    } else {
      refreshToken = null;
      changed = true;
    }
  }

  if (changed) {
    db.prepare(
      "UPDATE tracking_accounts SET access_token = ?, refresh_token = ?, is_active = ? WHERE service = ?",
    ).run(accessToken, refreshToken, isActive ? 1 : 0, row.service);
  }

  return {
    ...row,
    access_token: accessToken,
    refresh_token: refreshToken,
    is_active: isActive ? 1 : 0,
  };
}

function toTrackingAccount(row: any): TrackingAccount {
  const accessToken = revealSecret(row.access_token);
  const refreshToken = revealSecret(row.refresh_token);

  return {
    ...row,
    access_token: accessToken,
    refresh_token: refreshToken || undefined,
    is_active: !!row.is_active,
  } as TrackingAccount;
}

export function upsertTrackingAccount(account: TrackingAccount): boolean {
  const db = getDb();
  const encryptedAccessToken = protectSecret(account.access_token);
  if (!encryptedAccessToken) {
    throw new Error("Tracking account token is empty");
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO tracking_accounts (
      service, username, access_token, refresh_token, token_expires_at, is_active
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    account.service,
    account.username || null,
    encryptedAccessToken,
    protectSecret(account.refresh_token || null),
    account.token_expires_at || null,
    account.is_active ? 1 : 0,
  );

  return result.changes > 0;
}

export function getTrackingAccounts(): TrackingAccount[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM tracking_accounts").all() as any[];
  return rows
    .map((row) => secureTrackingRow(db, row))
    .map((row) => toTrackingAccount(row));
}

export function getTrackingAccount(
  service: "mal" | "anilist",
): TrackingAccount | null {
  const db = getDb();
  const raw = db
    .prepare("SELECT * FROM tracking_accounts WHERE service = ?")
    .get(service) as any;
  if (!raw) return null;
  const row = secureTrackingRow(db, raw);
  return toTrackingAccount(row);
}

export function deleteTrackingAccount(service: "mal" | "anilist"): boolean {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM tracking_accounts WHERE service = ?")
    .run(service);
  return result.changes > 0;
}

export function upsertTrackingEntry(entry: TrackingEntry): boolean {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO tracking_entries (
      series_id, service, remote_id, status, chapters_read, total_chapters, volumes_read, total_volumes, score, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const result = stmt.run(
    entry.series_id,
    entry.service,
    entry.remote_id,
    entry.status,
    entry.chapters_read,
    entry.total_chapters ?? null,
    entry.volumes_read ?? 0,
    entry.total_volumes ?? null,
    entry.score,
  );

  return result.changes > 0;
}

export function getTrackingEntry(
  seriesId: number,
  service: string,
): TrackingEntry | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM tracking_entries WHERE series_id = ? AND service = ?",
    )
    .get(seriesId, service) as any;
  return (row as TrackingEntry) || null;
}

export function getTrackingEntries(seriesId: number): TrackingEntry[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM tracking_entries WHERE series_id = ?")
    .all(seriesId) as any[];
  return rows as TrackingEntry[];
}

export function updateTrackingEntry(
  id: number,
  updates: Partial<TrackingEntry>,
): boolean {
  const db = getDb();
  const keys = Object.keys(updates);
  if (keys.length === 0) return false;

  const setClause = keys.map((key) => `${key} = ?`).join(", ");
  const values = keys.map((key) => (updates as any)[key]);

  const stmt = db.prepare(
    `UPDATE tracking_entries SET ${setClause}, last_synced_at = CURRENT_TIMESTAMP WHERE id = ?`,
  );
  const result = stmt.run(...values, id);
  return result.changes > 0;
}

export function deleteTrackingEntry(
  seriesId: number,
  service: "mal" | "anilist",
): boolean {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM tracking_entries WHERE series_id = ? AND service = ?")
    .run(seriesId, service);
  return result.changes > 0;
}
