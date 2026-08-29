// --- IMPORTS & INTERFACES --------------------------------------------------
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { app } from "electron";

let db: Database.Database | null = null;

export interface LibraryItem {
  id: number;
  path: string;
  title: string;
  type: "book" | "folder";
  page_count: number;
  cover_path: string | null;
  parent_id: number | null;
  is_favorite: boolean;
  reading_status: "unread" | "reading" | "read";
  current_page: number;
  current_page_offset?: number;
  last_read_at: string | null;
  added_at: string;
  tags_list?: string;
  types_list?: string;
  content_type?: string | null;
  miss_count?: number;
  manga_series_id?: number | null;
  manga_preference?: "auto" | "force_manga" | "force_non_manga";
}

export interface SearchResult extends LibraryItem {
  relevance?: number;
}

export interface PageVisibility {
  item_id: number;
  page_name: string;
}

export interface Settings {
  key: string;
  value: string;
}

export * from "./metadata";
export * from "./queries/tags";
export * from "./queries/downloads";
export * from "./queries/library";
import {
  initDefaultCategories,
  initDefaultTypes,
  ContentType,
} from "./metadata";
import { initDefaultTags } from "./data/tag-defaults";
import { TagWithCategory } from "./queries/tags";

// --- DATABASE CONNECTION & INITIALIZATION ----------------------------------
export function getDb(): Database.Database {
  if (!db) {
    initDatabase();
  }
  return db!;
}

export function initDatabase(): Database.Database {
  const dbPath = path.join(app.getPath("userData"), "jiinashi.db");
  const database = new Database(dbPath);
  db = database;

  // Create tables and indices (consolidated schema)
  database.exec(`
    CREATE TABLE IF NOT EXISTS library_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'book',
      page_count INTEGER DEFAULT 0,
      cover_path TEXT,
      parent_id INTEGER,
      is_favorite INTEGER DEFAULT 0,
      reading_status TEXT DEFAULT 'unread',
      current_page INTEGER DEFAULT 0,
      current_page_offset REAL DEFAULT 0,
      last_read_at TEXT,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP,
      content_type TEXT,
      manga_preference TEXT DEFAULT 'auto',
      FOREIGN KEY (parent_id) REFERENCES library_items(id)
    );
    
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      is_default INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      category_id INTEGER,
      description TEXT,
      is_default INTEGER DEFAULT 0,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );
    
    CREATE TABLE IF NOT EXISTS tag_aliases (
      tag_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      PRIMARY KEY (tag_id, alias),
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS item_tags (
      item_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY (item_id, tag_id),
      FOREIGN KEY (item_id) REFERENCES library_items(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS category_aliases (
      category_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      PRIMARY KEY (category_id, alias),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS page_visibility (
      item_id INTEGER NOT NULL,
      page_name TEXT NOT NULL,
      PRIMARY KEY (item_id, page_name),
      FOREIGN KEY (item_id) REFERENCES library_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS content_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      is_default INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS type_aliases (
      type_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      PRIMARY KEY (type_id, alias),
      FOREIGN KEY (type_id) REFERENCES content_types(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS item_types (
      item_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      PRIMARY KEY (item_id, type_id),
      FOREIGN KEY (item_id) REFERENCES library_items(id) ON DELETE CASCADE,
      FOREIGN KEY (type_id) REFERENCES content_types(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS download_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT,
      cover_url TEXT,
      artist TEXT,
      parody TEXT,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      file_path TEXT,
      error_message TEXT,
      content_type TEXT,
      logs TEXT,
      total_images INTEGER,
      downloaded_images INTEGER,
      progress_percent REAL,
      hidden_from_queue INTEGER DEFAULT 0,
      hidden_from_manga_queue INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_library_path ON library_items(path);
    CREATE INDEX IF NOT EXISTS idx_library_favorite ON library_items(is_favorite);
    CREATE INDEX IF NOT EXISTS idx_library_status ON library_items(reading_status);
    CREATE INDEX IF NOT EXISTS idx_library_last_read_at ON library_items(last_read_at);
    CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
    CREATE INDEX IF NOT EXISTS idx_tag_aliases_alias ON tag_aliases(alias);
    CREATE INDEX IF NOT EXISTS idx_category_aliases_alias ON category_aliases(alias);
    CREATE INDEX IF NOT EXISTS idx_page_visibility_item_id ON page_visibility(item_id);
    CREATE INDEX IF NOT EXISTS idx_type_aliases_alias ON type_aliases(alias);
    CREATE INDEX IF NOT EXISTS idx_download_history_url ON download_history(url);
    CREATE INDEX IF NOT EXISTS idx_download_history_added_at ON download_history(added_at);

    -- Manga series metadata (offline-available)
    CREATE TABLE IF NOT EXISTS manga_series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,           -- extension source identifier
      source_url TEXT NOT NULL,          -- URL on the source site
      anilist_id INTEGER,                -- AniList manga ID (stable identity)
      mal_id INTEGER,                    -- MyAnimeList manga ID
      mangabaka_id INTEGER,              -- Mangabaka series ID
      title_original TEXT,               -- Original (JP/KR/CN) title
      title_romaji TEXT,                 -- Romanized title
      title_english TEXT,                -- English title
      description TEXT,
      cover_url TEXT,                    -- Remote cover URL (sourced from AniList)
      banner_url TEXT,                   -- Remote banner URL (sourced from AniList)
      cover_local_path TEXT,             -- Cached cover on disk
      author TEXT,
      artist TEXT,
      status TEXT,                       -- ongoing, completed, hiatus, cancelled
      reading_format TEXT DEFAULT 'manga', -- 'manga' (RTL) | 'manhwa'/'manhua' (vertical scroll)
      mal_score REAL,                    -- MAL score (sourced from MAL API)
      year INTEGER,                      -- Publication start year (AniList)
      genres TEXT,                       -- JSON array (genres)
      last_updated TEXT,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_id, source_url)
    );

    -- Individual chapters/volumes within a series
    CREATE TABLE IF NOT EXISTS manga_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id INTEGER NOT NULL,
      chapter_number REAL,               -- 1, 1.5, 2, etc.
      volume_number INTEGER,             -- optional volume grouping
      title TEXT,
      source_url TEXT NOT NULL,
      scanlator TEXT,
      date_uploaded TEXT,
      is_downloaded INTEGER DEFAULT 0,
      download_path TEXT,                -- local path when downloaded
      is_read INTEGER DEFAULT 0,
      current_page INTEGER DEFAULT 0,
      page_count INTEGER DEFAULT 0,
      last_read_at TEXT,
      FOREIGN KEY (series_id) REFERENCES manga_series(id) ON DELETE CASCADE
    );

    -- Installed extensions
    CREATE TABLE IF NOT EXISTS manga_extensions (
      id TEXT PRIMARY KEY,               -- unique extension ID
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      source_type TEXT NOT NULL,
      icon_url TEXT,
      is_enabled INTEGER DEFAULT 1,
      installed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      config TEXT                        -- JSON config/settings
    );

    -- Tracking service accounts (MAL, AniList)
    CREATE TABLE IF NOT EXISTS tracking_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL,              -- 'mal' | 'anilist'
      username TEXT,
      access_token TEXT,                  -- encrypted
      refresh_token TEXT,                 -- encrypted
      token_expires_at TEXT,
      is_active INTEGER DEFAULT 1,
      UNIQUE(service)
    );

    -- Tracking entries (link series to tracker)
    CREATE TABLE IF NOT EXISTS tracking_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id INTEGER NOT NULL,
      service TEXT NOT NULL,              -- 'mal' | 'anilist'
      remote_id TEXT NOT NULL,            -- MAL/AniList manga ID
      status TEXT,                        -- reading, completed, plan_to_read, etc.
      chapters_read INTEGER DEFAULT 0,
      total_chapters INTEGER,             -- Total chapters from tracker API when available
      volumes_read INTEGER DEFAULT 0,
      total_volumes INTEGER,              -- Total volumes from tracker API when available
      score REAL,                        -- User's personal score (editable in UI)
      last_synced_at TEXT,
      FOREIGN KEY (series_id) REFERENCES manga_series(id) ON DELETE CASCADE,
      UNIQUE(series_id, service)
    );

    CREATE INDEX IF NOT EXISTS idx_manga_chapters_series ON manga_chapters(series_id);
    CREATE INDEX IF NOT EXISTS idx_tracking_entries_series ON tracking_entries(series_id);
    CREATE INDEX IF NOT EXISTS idx_manga_series_source ON manga_series(source_id);
  `);

  // Add sort_order column to alias tables if they don't exist
  try {
    database.exec(
      "ALTER TABLE tag_aliases ADD COLUMN sort_order INTEGER DEFAULT 0",
    );
  } catch (e) {}
  try {
    database.exec(
      "ALTER TABLE category_aliases ADD COLUMN sort_order INTEGER DEFAULT 0",
    );
  } catch (e) {}
  try {
    database.exec(
      "ALTER TABLE type_aliases ADD COLUMN sort_order INTEGER DEFAULT 0",
    );
  } catch (e) {}
  try {
    database.exec(
      "ALTER TABLE library_items ADD COLUMN miss_count INTEGER DEFAULT 0",
    );
  } catch (e) {}
  try {
    database.exec(
      "ALTER TABLE library_items ADD COLUMN manga_series_id INTEGER",
    );
  } catch (e) {}
  try {
    database.exec(
      "ALTER TABLE library_items ADD COLUMN manga_preference TEXT DEFAULT 'auto'",
    );
  } catch (e) {}
  try {
    database.exec(
      "ALTER TABLE library_items ADD COLUMN current_page_offset REAL DEFAULT 0",
    );
  } catch (e) {}
  try {
    database.exec(
      "ALTER TABLE download_history ADD COLUMN hidden_from_manga_queue INTEGER DEFAULT 0",
    );
  } catch (e) {}
  try {
    const migrationKey = "migration:manga_queue_visibility_v1";
    const hasMigration = database
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(migrationKey) as { value?: string } | undefined;
    if (!hasMigration?.value) {
      database
        .prepare(
          "UPDATE download_history SET hidden_from_manga_queue = 1 WHERE content_type = 'manga'",
        )
        .run();
      database
        .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .run(migrationKey, "1");
    }
  } catch (e) {}
  try {
    database.exec("ALTER TABLE manga_series ADD COLUMN anilist_id INTEGER");
  } catch (e) {}
  try {
    database.exec("ALTER TABLE manga_series ADD COLUMN mal_id INTEGER");
  } catch (e) {}
  try {
    database.exec("ALTER TABLE manga_series ADD COLUMN mangabaka_id INTEGER");
  } catch (e) {}
  try {
    database.exec("ALTER TABLE manga_series ADD COLUMN year INTEGER");
  } catch (e) {}
  try {
    database.exec("ALTER TABLE manga_series ADD COLUMN banner_url TEXT");
  } catch (e) {}
  try {
    database.exec(
      "ALTER TABLE tracking_entries ADD COLUMN total_chapters INTEGER",
    );
  } catch (e) {}
  try {
    database.exec(
      "ALTER TABLE tracking_entries ADD COLUMN volumes_read INTEGER DEFAULT 0",
    );
  } catch (e) {}
  try {
    database.exec(
      "ALTER TABLE tracking_entries ADD COLUMN total_volumes INTEGER",
    );
  } catch (e) {}
  try {
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_manga_series_mangabaka_id ON manga_series(mangabaka_id)",
    );
    database.exec("DROP INDEX IF EXISTS idx_manga_series_mangabaka_id_unique");
    database.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_manga_series_mangabaka_id_unique ON manga_series(mangabaka_id) WHERE mangabaka_id IS NOT NULL AND LOWER(source_id) IN ('anilist', 'mal', 'mangabaka')",
    );
  } catch (e) {}

  try {
    database
      .prepare(
        `
      UPDATE library_items 
      SET type = 'book' 
      WHERE type IS NULL 
         OR type = '' 
         OR type NOT IN ('book', 'folder')
    `,
      )
      .run();

    database
      .prepare(
        `
      UPDATE library_items
      SET manga_preference = 'auto'
      WHERE manga_preference IS NULL
         OR manga_preference = ''
         OR manga_preference NOT IN ('auto', 'force_manga', 'force_non_manga')
    `,
      )
      .run();

    const defaultSettings = [
      ["theme", "dark"],
      ["defaultViewMode", "single"],
      ["defaultFitMode", "contain"],
      ["backgroundColor", "#000000"],
      ["enableAnimations", "true"],
      ["mangaMode", "true"],
      [
        "downloadPath",
        path.join(app.getPath("documents"), "Jiinashi Downloads"),
      ],
      ["concurrentDownloads", "2"],
      ["downloadDelay", "500"],
      ["maxHistoryItems", "50"],
      ["strictImport", "true"],
      ["librarySortOrder", "alphabetical"],
      ["syncDefaultData", "true"],
    ];

    const insertSetting = database.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
    );
    for (const [key, value] of defaultSettings) {
      insertSetting.run(key, value);
    }

    const setupCompleted = database
      .prepare("SELECT value FROM settings WHERE key = 'setupCompleted'")
      .get() as { value: string } | undefined;

    if (!setupCompleted) {
      let importCategories = true;
      let importTags = true;
      let importTypes = true;

      try {
        const configPath = app.isPackaged
          ? path.join(process.resourcesPath, "install-config.json")
          : path.join(app.getAppPath(), "resources", "install-config.json");

        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          if (config.importCategories !== undefined)
            importCategories = config.importCategories === true;
          if (config.importTags !== undefined)
            importTags = config.importTags === true;
          if (config.importTypes !== undefined)
            importTypes = config.importTypes === true;
        }
      } catch (e) {
        console.error("[Setup] Error reading install-config.json:", e);
      }

      initDefaultCategories(database, importCategories, true);
      initDefaultTags(database, { importTags, syncDefaults: true });
      initDefaultTypes(database, importTypes, true);

      database.transaction(() => {
        database
          .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
          .run("installCategories", importCategories ? "true" : "false");
        database
          .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
          .run("installTags", importTags ? "true" : "false");
        database
          .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
          .run("installTypes", importTypes ? "true" : "false");
        database
          .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
          .run("setupCompleted", "true");
      })();
    } else {
      const installCategories = database
        .prepare("SELECT value FROM settings WHERE key = 'installCategories'")
        .get() as { value: string } | undefined;
      const installTags = database
        .prepare("SELECT value FROM settings WHERE key = 'installTags'")
        .get() as { value: string } | undefined;
      const installTypes = database
        .prepare("SELECT value FROM settings WHERE key = 'installTypes'")
        .get() as { value: string } | undefined;
      const syncDefaults = database
        .prepare("SELECT value FROM settings WHERE key = 'syncDefaultData'")
        .get() as { value: string } | undefined;

      const isSyncing = syncDefaults?.value !== "false";

      initDefaultCategories(
        database,
        installCategories?.value === "true",
        isSyncing,
      );
      initDefaultTags(database, {
        importTags: installTags?.value === "true",
        syncDefaults: isSyncing,
      });
      initDefaultTypes(database, installTypes?.value === "true", isSyncing);
    }

    const duplicates = database
      .prepare(
        `
        SELECT lower(replace(path, '\\', '/')) as norm_path, count(*) as c 
        FROM library_items 
        GROUP BY lower(replace(path, '\\', '/')) 
        HAVING c > 1
      `,
      )
      .all() as { norm_path: string; c: number }[];

    if (duplicates.length > 0) {
      const getDupes = database.prepare(`
        SELECT * FROM library_items 
        WHERE lower(replace(path, '\\', '/')) = ? 
        ORDER BY is_favorite DESC, last_read_at DESC, id ASC
      `);
      const deleteStmt = database.prepare(
        "DELETE FROM library_items WHERE id = ?",
      );
      database.transaction(() => {
        for (const { norm_path } of duplicates) {
          const items = getDupes.all(norm_path) as LibraryItem[];
          if (items.length > 1) {
            const [, ...remove] = items;
            for (const item of remove) deleteStmt.run(item.id);
          }
        }
      })();
    }
  } catch (e) {
    console.error("Error during database initialization:", e);
  }
  return database;
}

// --- SETTINGS OPERATIONS ---------------------------------------------------
export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(key, value);
}

export function deleteSetting(key: string): boolean {
  const result = getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
  return result.changes > 0;
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb()
    .prepare(
      "SELECT key, value FROM settings WHERE key NOT LIKE 'tracking:%:customClientId'",
    )
    .all() as Settings[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
