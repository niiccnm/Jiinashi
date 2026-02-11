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
  last_read_at: string | null;
  added_at: string;
  tags_list?: string;
  types_list?: string;
  content_type?: string | null;
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
      last_read_at TEXT,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP,
      content_type TEXT,
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
      hidden_from_queue INTEGER DEFAULT 0
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
  `);

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

    const defaultSettings = [
      ["theme", "dark"],
      ["defaultViewMode", "single"],
      ["defaultFitMode", "contain"],
      ["backgroundColor", "#000000"],
      ["enableAnimations", "true"],
      ["mangaMode", "false"],
      [
        "downloadPath",
        path.join(app.getPath("documents"), "Jiinashi Downloads"),
      ],
      ["concurrentDownloads", "2"],
      ["downloadDelay", "500"],
      ["maxHistoryItems", "50"],
      ["strictImport", "true"],
      ["librarySortOrder", "alphabetical"],
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

      initDefaultCategories(database, importCategories);
      initDefaultTags(database, { importTags });
      initDefaultTypes(database, importTypes);

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

      initDefaultCategories(database, installCategories?.value === "true");
      initDefaultTags(database, {
        importTags: installTags?.value === "true",
      });
      initDefaultTypes(database, installTypes?.value === "true");
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

export function getAllSettings(): Record<string, string> {
  const rows = getDb()
    .prepare("SELECT key, value FROM settings")
    .all() as Settings[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
