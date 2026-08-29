export type ReadingFormat = "manga" | "manhwa" | "manhua";
export type ReadingStatus = "unread" | "reading" | "read";
export type MangaStatus = "ongoing" | "completed" | "hiatus" | "cancelled";

export interface IMangaSource {
  id: string;
  name: string;
  baseUrl: string;
  lang: string;
  iconUrl?: string;
  searchTitlePreference?: "english";
  matchProfile?: "slug-ranked" | "strict-ranked" | "title-exact" | "fast-first";
  getPopular(page: number): Promise<MangaSearchResult>;
  getLatest(page: number): Promise<MangaSearchResult>;
  search(
    query: string,
    page: number,
    filters?: any,
    options?: { signal?: AbortSignal },
  ): Promise<MangaSearchResult>;
  getDetail(
    url: string,
    options?: { signal?: AbortSignal },
  ): Promise<MangaSeriesMetadata>;
  getChapters(
    url: string,
    options?: { signal?: AbortSignal },
  ): Promise<MangaChapter[]>;
  getChapterPages(chapterUrl: string): Promise<ChapterPage[]>;
}

export interface MangaSeries {
  id?: number;
  source_id: string;
  source_url: string;
  anilist_id?: number;
  mal_id?: number;
  mangabaka_id?: number;
  title_original: string;
  title_romaji?: string;
  title_english?: string;
  description?: string;
  cover_url?: string;
  banner_url?: string;
  cover_local_path?: string;
  author?: string;
  artist?: string;
  status?: MangaStatus;
  reading_format: ReadingFormat;
  mal_score?: number;
  year?: number;
  genres?: string[]; // Stored as JSON in DB
  last_updated?: string;
  added_at?: string;
}

export interface MangaChapter {
  id?: number;
  series_id?: number;
  chapter_number: number;
  volume_number?: number;
  title?: string;
  source_url: string;
  scanlator?: string;
  date_uploaded?: string;
  is_downloaded: boolean;
  download_path?: string;
  is_downloadable?: boolean;
  unavailable_reason?: string;
  is_read: boolean;
  current_page: number;
  page_count: number;
  last_read_at?: string;
}

export interface MangaExtension {
  id: string;
  name: string;
  version: string;
  source_type: "external";
  content_type?: "manga" | "novel";
  repository_url?: string;
  repository_name?: string;
  icon_url?: string;
  is_enabled: boolean;
  installed_at: string;
  config?: MangaExtensionConfig | null;
  sites?: MangaExtensionSite[];
}

export interface MangaExtensionSite {
  id: string;
  name: string;
  base_url?: string;
  icon_url?: string;
  source_ids: string[];
  is_enabled: boolean;
}

export interface MangaExtensionConfig {
  siteStates?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface TrackingAccount {
  id?: number;
  service: "mal" | "anilist";
  username?: string;
  access_token: string;
  refresh_token?: string;
  token_expires_at?: string;
  is_active: boolean;
}

export interface TrackingEntry {
  id?: number;
  series_id: number;
  service: "mal" | "anilist";
  remote_id: string;
  status: string | null;
  chapters_read: number;
  total_chapters?: number | null;
  volumes_read?: number;
  total_volumes?: number | null;
  score: number | null;
  last_synced_at?: string;
}

export interface UserTrackingStatus {
  service: "mal" | "anilist";
  remote_id?: string;
  has_entry: boolean;
  status_unavailable?: boolean;
  status?: string;
  chapters_read?: number;
  total_chapters?: number | null;
  volumes_read?: number;
  total_volumes?: number | null;
  score?: number | null;
  last_synced_at?: string;
}

export interface MangaSeriesMetadata {
  title: string;
  title_original: string;
  title_romaji?: string;
  title_english?: string;
  description?: string;
  cover_url?: string;
  author?: string;
  artist?: string;
  status?: MangaStatus;
  reading_format: ReadingFormat;
  mal_score?: number;
  bookmark_count?: number;
  genres: string[];
}

export interface MangaSearchResult {
  items: MangaSearchItem[];
  hasNextPage: boolean;
}

export interface MangaSearchItem {
  source_id: string;
  source_url: string;
  title: string;
  cover_url?: string;
  bookmark_count?: number;
  /** Supplemental aliases used by source matching; not shown as the title. */
  match_titles?: string[];
  /** Provider publication year, when available for edition disambiguation. */
  year?: number;
}

export interface ChapterPage {
  index: number;
  url: string;
  headers?: Record<string, string>;
  xor_key?: string;
}

export interface FriendReading {
  username: string;
  avatar_url?: string;
  profile_url?: string;
  status: string;
  progress: number;
  service: "mal" | "anilist";
}

export interface MangaMatchResult {
  remote_id: string;
  service: "mal" | "anilist";
  title: string;
  cover_url?: string;
  description?: string;
  confidence: number;
}
