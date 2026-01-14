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
  tags_list?: string; // Comma-separated list of tag names
  types_list?: string;
  content_type?: string | null; // Comma-separated: manga, doujinshi, webtoon, r18
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  is_default: boolean;
}

export interface Tag {
  id: number;
  name: string;
  category_id: number | null;
  description: string | null;
  is_default: boolean;
}

export interface TagWithCategory extends Tag {
  category_name: string | null;
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

    -- Indices
    CREATE INDEX IF NOT EXISTS idx_library_path ON library_items(path);
    CREATE INDEX IF NOT EXISTS idx_library_favorite ON library_items(is_favorite);
    CREATE INDEX IF NOT EXISTS idx_library_status ON library_items(reading_status);
    CREATE INDEX IF NOT EXISTS idx_library_last_read_at ON library_items(last_read_at);
    CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
    CREATE INDEX IF NOT EXISTS idx_tag_aliases_alias ON tag_aliases(alias);
    CREATE INDEX IF NOT EXISTS idx_category_aliases_alias ON category_aliases(alias);
    CREATE INDEX IF NOT EXISTS idx_page_visibility_item_id ON page_visibility(item_id);
    CREATE INDEX IF NOT EXISTS idx_type_aliases_alias ON type_aliases(alias);
  `);

  // Handle data integrity and maintenance routines
  try {
    // Data Integrity: normalization for library item types
    database
      .prepare(
        `
      UPDATE library_items 
      SET type = 'book' 
      WHERE type IS NULL 
         OR type = '' 
         OR type NOT IN ('book', 'folder')
    `
      )
      .run();

    // --- Default Data & Settings ---
    const defaultSettings = [
      ["theme", "dark"],
      ["defaultViewMode", "single"],
      ["defaultFitMode", "contain"],
      ["backgroundColor", "#000000"],
      ["enableAnimations", "true"],
      ["mangaMode", "false"],
    ];

    const insertSetting = database.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
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

      initDefaultTags(database, { importCategories, importTags });
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

      initDefaultTags(database, {
        importCategories: installCategories?.value === "true",
        importTags: installTags?.value === "true",
      });
      initDefaultTypes(database, installTypes?.value === "true");
    }

    migrateContentTypes(database);

    // Maintenance: Cleanup duplicates
    const duplicates = database
      .prepare(
        `
        SELECT lower(replace(path, '\\', '/')) as norm_path, count(*) as c 
        FROM library_items 
        GROUP BY lower(replace(path, '\\', '/')) 
        HAVING c > 1
      `
      )
      .all() as { norm_path: string; c: number }[];

    if (duplicates.length > 0) {
      const getDupes = database.prepare(`
        SELECT * FROM library_items 
        WHERE lower(replace(path, '\\', '/')) = ? 
        ORDER BY is_favorite DESC, last_read_at DESC, id ASC
      `);
      const deleteStmt = database.prepare(
        "DELETE FROM library_items WHERE id = ?"
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

// --- CATEGORY OPERATIONS ---------------------------------------------------
export function getAllCategories(): Category[] {
  return getDb()
    .prepare("SELECT * FROM categories ORDER BY name ASC")
    .all() as Category[];
}

export function createCategory(
  name: string,
  description: string | null = null
): Category {
  const info = getDb()
    .prepare(
      "INSERT INTO categories (name, description, is_default) VALUES (?, ?, 0)"
    )
    .run(name, description);
  return {
    id: info.lastInsertRowid as number,
    name,
    description,
    is_default: false,
  };
}

export function updateCategory(id: number, updates: Partial<Category>) {
  const allowed = ["name", "description", "is_default"];
  const fields = Object.keys(updates).filter(
    (k) => k !== "id" && allowed.includes(k)
  );
  if (fields.length === 0) return;

  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => updates[f as keyof Category]);

  getDb()
    .prepare(`UPDATE categories SET ${setClause} WHERE id = ?`)
    .run(...values, id);
}

export function deleteCategory(id: number) {
  getDb().prepare("DELETE FROM categories WHERE id = ?").run(id);
}

export function addCategoryAliases(categoryId: number, aliases: string[]) {
  const insert = getDb().prepare(
    "INSERT OR IGNORE INTO category_aliases (category_id, alias) VALUES (?, ?)"
  );
  const many = getDb().transaction((items: string[]) => {
    for (const alias of items) insert.run(categoryId, alias);
  });
  many(aliases);
}

export function removeCategoryAlias(categoryId: number, alias: string) {
  getDb()
    .prepare("DELETE FROM category_aliases WHERE category_id = ? AND alias = ?")
    .run(categoryId, alias);
}

export function getCategoryAliases(categoryId: number): string[] {
  const rows = getDb()
    .prepare("SELECT alias FROM category_aliases WHERE category_id = ?")
    .all(categoryId) as { alias: string }[];
  return rows.map((r) => r.alias);
}

// --- INITIAL DATA & SEEDING ------------------------------------------------
function initDefaultTags(
  db: Database.Database,
  options: { importCategories: boolean; importTags: boolean }
) {
  if (!options.importCategories && !options.importTags) return;

  if (options.importCategories) {
    // 1. Categories
    const defaultCategories = [
      "Character",
      "Artist",
      "Copyright",
      "Appearance",
      "Build",
      "Actions",
      "Accessories",
      "Clothing",
      "Meta",
      "Body Parts",
      "Character Count",
      "Gender",
      "Source",
      "Objects",
      "Other",
      "Language",
      "Sex Acts",
      "Expressions",
    ];

    const insertCat = db.prepare(
      "INSERT OR IGNORE INTO categories (name, is_default) VALUES (?, 1)"
    );
    for (const cat of defaultCategories) insertCat.run(cat);

    const updateCatDefault = db.prepare(
      "UPDATE categories SET is_default = 1 WHERE name = ?"
    );
    for (const cat of defaultCategories) updateCatDefault.run(cat);
  }

  // Helper to get cat ID
  const getCatId = (name: string) => {
    const row = db
      .prepare("SELECT id FROM categories WHERE name = ?")
      .get(name) as { id: number } | undefined;
    return row?.id || null;
  };

  // 2. Tags
  const defaults: [string, string][] = [
    // Character Count
    ...[
      "1girl",
      "2girls",
      "3girls",
      "4girls",
      "5girls",
      "multiple girls",
      "1boy",
      "2boys",
      "3boys",
      "4boys",
      "5boys",
      "multiple boys",
      "solo",
      "solo focus",
      "male focus",
    ].map((t) => [t, "Character Count"] as [string, string]),

    // Copyright
    ...["Original"].map((t) => [t, "Copyright"] as [string, string]),

    // Body Parts
    ...[
      "penis",
      "testicles",
      "small penis",
      "large penis",
      "huge penis",
      "pussy",
      "clitoris",
      "anus",
      "nipples",
      "areola",
      "areola slip",
      "ass",
      "navel",
      "belly",
      "feet",
      "thighs",
      "armpits",
      "barefoot",
      "bare shoulders",
      "tongue",
      "pubic hair",
      "female pubic hair",
      "armpit hair",
      "excessive pubic hair",
      "anus hair",
      "female anus hair",
      "crotch focus",
    ].map((t) => [t, "Body Parts"] as [string, string]),

    // Appearance
    ...[
      "breasts",
      "small breasts",
      "medium breasts",
      "large breasts",
      "huge breasts",
      "flat chest",
      "perky breasts",
      "sagging breasts",
      "pointy breasts",
      "trap",
      "futanari",
      "old woman",
      "old man",
      "child",
      "oppai loli",
      "petite",
      "bulge",
      "faceless",
      "cow ears",
      "wings",
      "halo",
      "asymmetrical bangs",
      "swept bangs",
      "two side up",
      "hair bun",
      "single bun",
      "double bun",
      "one side up",
      "side ponytail",
      "short twintails",
      "braid",
      "twin braids",
      "single braid",
      "long braid",
      "short braid",
      "low ponytail",
      "short ponytail",
      "low twintails",
      "low twin braids",
      "blush",
      "dark-skinned female",
      "dark skin",
      "gyaru",
      "tan",
      "tanlines",
      "short hair",
      "medium hair",
      "long hair",
      "very long hair",
      "black hair",
      "blonde hair",
      "blue hair",
      "brown hair",
      "grey hair",
      "red hair",
      "white hair",
      "orange hair",
      "sidelocks",
      "hair between eyes",
      "ahoge",
      "ponytail",
      "twintails",
      "parted bangs",
      "blunt bangs",
      "hair over one eye",
      "red eyes",
      "blue eyes",
      "yellow eyes",
      "green eyes",
      "black eyes",
      "brown eyes",
      "heart in eye",
      "animal ears",
      "cat ears",
      "pointy ears",
      "tail",
      "large areolae",
      "puffy nipples",
      "mole",
      "mole above eye",
      "mole above mouth",
      "mole beside mouth",
      "mole on cheek",
      "mole on ear",
      "mole on forehead",
      "mole on nose",
      "mole under eye",
      "mole under each eye",
      "mole under mouth",
      "mole on breast",
      "mole on areola",
      "mole on shoulder",
      "mole under breast",
      "mole on arm",
      "mole on armpit",
      "mole on crotch",
      "mole on hip",
      "wide hips",
      "mole on penis",
      "mole on pussy",
      "mole on stomach",
      "mole on testicles",
      "mole on ass",
      "mole on foot",
      "mole on leg",
      "mole on thigh",
      "freckles",
      "thick thighs",
      "muscular female",
      "muscular male",
      "bald",
      "fat",
      "fat man",
      "curvy",
      "plump",
      "skinny",
      "flat ass",
      "huge ass",
      "gigantic ass",
      "gigantic penis",
      "gigantic breasts",
      "large testicles",
      "huge testicles",
      "gigantic testicles",
      "small testicles",
      "dark areolae",
      "pregnant",
      "pregnant loli",
      "dark nipples",
      "dark anus",
      "fat mons",
      "hairy",
      "ugly bastard",
    ].map((t) => [t, "Appearance"] as [string, string]),

    // Build
    ...["loli", "tall female", "mature female", "shota", "muscular"].map(
      (t) => [t, "Build"] as [string, string]
    ),

    // Gender
    ...["female", "male"].map((t) => [t, "Gender"] as [string, string]),

    // Meta
    ...["decensored", "animated"].map((t) => [t, "Meta"] as [string, string]),

    // Language
    ...["English", "Japanese", "Korean", "Chinese", "Spanish"].map(
      (t) => [t, "Language"] as [string, string]
    ),

    // Accessories
    ...[
      "collar",
      "choker",
      "mouth mask",
      "gloves",
      "elbow gloves",
      "cow ear hairband",
      "thigh strap",
      "glasses",
    ].map((t) => [t, "Accessories"] as [string, string]),

    // Objects
    ...[
      "animal collar",
      "dog collar",
      "neck bell",
      "bell",
      "leash",
      "dildo",
      "anal beads",
      "butt plug",
      "anal tail",
      "anal ball wear",
      "sex toy",
      "vibrator",
      "cock ring",
      "rabbit vibrator",
      "hitachi magic wand",
      "remote control vibrator",
      "egg vibrator",
      "clitoral suction vibrator",
      "lotion bottle",
      "condom",
      "condom wrapper",
      "broken condom",
      "nose hook",
      "randoseru",
    ].map((t) => [t, "Objects"] as [string, string]),

    // Clothing
    ...[
      "swimsuit",
      "bikini",
      "underwear",
      "panties",
      "bra",
      "shirt",
      "pants",
      "socks",
      "pantyhose",
      "thighhighs",
      "blouse",
      "camisole",
      "shoes",
      "sleeveless",
      "spaghetti strap",
      "boots",
      "shorts",
      "thong",
      "t-back",
      "g-string",
      "c-string",
      "lingerie",
      "see-through clothes",
      "crossdressing",
      "school uniform",
      "school swimsuit",
      "one-piece swimsuit",
      "skirt",
      "dress",
      "cow print",
      "cow print bikini",
      "cow print thighhighs",
      "cow print gloves",
      "high heels",
      "animal print",
      "leopard print",
      "impossible clothes",
    ].map((t) => [t, "Clothing"] as [string, string]),

    // Other
    ...[
      "cum",
      "cumdrip",
      "precum",
      "x-ray",
      "internal cumshot",
      "cheating",
      "NTR",
      "yuri",
      "yaoi",
      "drunk",
      "midriff",
      "midriff peek",
      "zettai ryouiki",
      "pussy juice",
      "anal fluid",
      "pussy juice trail",
      "age difference",
      "onee-shota",
      "height difference",
      "censored",
      "bar censor",
      "blur censor",
      "heart censor",
      "light censor",
      "mosaic censoring",
      "censored by text",
      "blank censor",
      "censored identity",
      "cameltoe",
      "sweat",
      "saliva",
      "cleavage",
      "nude",
      "steam",
      "steaming body",
      "^^^",
      "topless female",
      "no bra",
      "bottomless",
      "fake animal ears",
      "lotion",
      "lube",
      "skindentation",
      "trefoil",
      "wedgie",
      "deep skin",
      "drugs",
      "drugged",
      "pill",
      "reverse NTR",
      "uncle",
      "aunt",
      "niece",
      "cousin",
      "brother",
      "sister",
      "mother",
      "father",
    ].map((t) => [t, "Other"] as [string, string]),

    // Expressions
    ...[
      "happy",
      "sad",
      "ahegao",
      "bohegao",
      "ohhoai",
      "ohogao",
      "torogao",
      "tongue out",
      "fucked silly",
      ":>=",
      "embarrassed",
      "crying",
      "tears",
      "averting eyes",
      "expressionless",
      "half-closed eyes",
      "narrowed eyes",
      "jitome",
      "squinting",
      "closed eyes",
      "open mouth",
      "oral invitation",
      "fellatio gesture",
      "penetration gesture",
      "smug",
      "c:",
      "smirk",
      ":3",
      "aroused",
      "in heat",
      "naughty face",
      "seductive smile",
      "smile",
      "you gonna get raped",
      "licking lips",
      ":p",
      ":q",
      "tehepero",
      "one eye closed",
      "crazy smile",
      "evil smile",
      "false smile",
      "nervous smile",
      "disgust",
      "angry",
      "annoyed",
      "horrified",
      "scared",
      "rolling eyes",
      "cross-eyed",
      "heart-shaped pupils",
    ].map((t) => [t, "Expressions"] as [string, string]),

    // Actions
    ...[
      "v",
      "double v",
      "kiss",
      "hug",
      "french kiss",
      "leg lock",
      "standing",
      "sitting",
      "standing on one leg",
      "leg up",
      "legs up",
      "arm up",
      "arms up",
      "middle finger",
      "covering face",
      "covering own eyes",
      "covering own mouth",
      "covering privates",
      "facepalm",
      "covering one eye",
      "holding leash",
      "peeing",
      "vomit",
      "burp",
      "fart",
      "covering breasts",
      "covering nipples",
      "covering crotch",
      "covering ass",
      "heavy breathing",
      "mouth pull",
      "squatting",
      "mask lift",
      "kneeling",
      "spread legs",
      "m legs",
      "v legs",
      "wide spread legs",
      "lying",
      "on back",
      "on stomach",
      "on side",
      "grabbing own ass",
      "licking",
      "licking object",
      "waving",
      "trembling",
      "shaking",
      "twitching",
      "screaming",
      "shouting",
      "arguing",
      "fighting",
      "looking at viewer",
      "breath",
      "manspreading",
      "finger sucking",
      "licking finger",
      "licking foot",
      "toe sucking",
      "lubrication",
      "blackmail",
      "hypnosis",
      "corruption",
      "mind control",
      "all fours",
      "recording",
    ].map((t) => [t, "Actions"] as [string, string]),

    // Sex Acts
    ...[
      "vaginal",
      "anal",
      "oral",
      "fellatio",
      "paizuri",
      "handjob",
      "footjob",
      "fingering",
      "masturbation",
      "deepthroat",
      "sex",
      "armpit sex",
      "rape",
      "incest",
      "doggystyle",
      "sex from behind",
      "cowgirl position",
      "reverse cowgirl position",
      "boy on top",
      "girl on top",
      "prone bone",
      "clothed sex",
      "group sex",
      "rough sex",
      "standing sex",
      "spooning",
      "double penetration",
      "spitroast",
      "amazon position",
      "piledriver (sex)",
      "mounting",
      "female masturbation",
      "anal fingering",
      "fisting",
      "clothed masturbation",
      "male masturbation",
      "mutual masturbation",
      "crotch rub",
      "bukkake",
      "orgasm",
      "female orgasm",
      "mutual orgasm",
      "afterglow",
      "missionary",
      "full nelson",
      "mating press",
      "suspension",
      "frottage",
      "kneepit sex",
      "naizuri",
      "glansjob",
      "groping",
      "grabbing another's ass",
      "grabbing another's breast",
      "crotch grab",
      "grabbing own breast",
      "hairjob",
      "caressing testicles",
      "double handjob",
      "cooperative handjob",
      "nursing handjob",
      "cuddling handjob",
      "reverse nursing handjob",
      "reach-around",
      "two-handed handjob",
      "implied masturbation",
      "anilingus",
      "rusty trombone",
      "breast sucking",
      "breastfeeding",
      "cunnilingus",
      "autocunnilingus",
      "implied cunnilingus",
      "autofellatio",
      "cum swap",
      "implied fellatio",
      "cooperative fellatio",
      "multiple penis fellatio",
      "irrumatio",
      "hug and suck",
      "licking testicle",
      "sitting on face",
      "testicle sucking",
      "oral sandwich",
      "daisy chain (sex)",
      "gangbang",
      "triple penetration",
      "cooperative footjob",
      "love train",
      "cooperative breast smother",
      "orgy",
      "reverse spitroast",
      "threesome",
      "mmf threesome",
      "ffm threesome",
      "mmm threesome",
      "fff threesome",
      "cervical penetration",
      "covered penetration",
      "deep penetration",
      "inflation",
      "cum inflation",
      "enema",
      "large insertion",
      "stomach bulge",
      "male penetrated",
      "multiple insertions",
      "nipple penetration",
      "nipple stimulation",
      "nipple tweak",
      "nipple pull",
      "nipple rub",
      "biting nipple",
      "nipple flick",
      "nipple press",
      "nipple push",
      "nipple fingering",
      "licking nipple",
      "nosejob",
      "object insertion",
      "vaginal object insertion",
      "anal object insertion",
      "urethral insertion",
      "sounding",
      "prostate milking",
      "fingering through panties",
      "fingering through clothes",
      "implied fingering",
      "after sex",
      "puckered anus",
      "spread anus",
      "gaping",
      "spread pussy",
      "cum in pussy",
      "extreme gaping",
      "cum in ass",
      "invisible penis",
      "half-spread pussy",
      "spreading own pussy",
      "spreading another's pussy",
      "spreading own anus",
      "spreading another's anus",
      "toddlercon",
      "pet play",
      "cum overflow",
      "ejaculation",
      "female ejaculation",
      "scat",
      "erection",
      "tonguejob",
      "cooperative tonguejob",
      "fellatio under mask",
      "covered fellatio",
      "cum on body",
      "cum on breasts",
      "cum on ass",
      "emotionless sex",
      "cum in mouth",
      "after fellatio",
      "facial",
      "gokkun",
      "cum on tongue",
      "table humping",
      "mind break",
      "prostitution",
      "penis on face",
      "penis over eyes",
      "penis over one eye",
      "penis shadow",
      "facejob",
      "penis awe",
      "penis on stomach",
      "condom on penis",
      "holding condom",
      "used condom",
      "drinking from condom",
      "condom left inside",
      "condom on nipples",
      "pointless condom",
      "used condom on mouth",
      "condom belt",
      "condom thigh strap",
    ].map((t) => [t, "Sex Acts"] as [string, string]),
  ];

  // Default tag metadata: keywords and descriptions
  const defaultTagMeta: Record<
    string,
    { keywords?: string[]; description?: string }
  > = {
    "large breasts": {
      keywords: [
        "big boobs",
        "big breasts",
        "big tits",
        "large boobs",
        "large tits",
      ],
    },
    penis: {
      keywords: [
        "chinchin",
        "chinpo",
        "cock",
        "dick",
        "ochinchin",
        "ochinpo",
        "peepee",
        "weewee",
      ],
    },
    testicles: { keywords: ["balls"] },
    pussy: { keywords: ["vagina", "vulva"] },
    loli: { keywords: ["lolicon"] },
    shota: { keywords: ["shotacon"] },
    Japanese: { keywords: ["JP"] },
    "mature female": {
      keywords: [
        "housewife",
        "married woman",
        "milf",
        "hag",
        "熟女",
        "人妻",
        "ママン",
      ],
      description:
        "An attractive \"middle-aged\" woman. Common traits include slight face wrinkles, a noticeable belly, and an overall body shape that's generally curvier than that of a younger woman. Alternate terms, depending on age range, can include cougar, hag, or MILF (Mother I'd Like to Fuck; used regardless of the fact whether she's had children or not).",
    },
    tan: { keywords: ["suntan"] },
    "blonde hair": { keywords: ["yellow hair"] },
    vaginal: { keywords: ["vaginal sex"] },
    anal: { keywords: ["anal sex"] },
    fellatio: {
      keywords: ["blowjob", "sucking cock", "sucking dick", "sucking penis"],
    },
    paizuri: { keywords: ["breasts job", "titjob", "tits job"] },
    footjob: { keywords: ["feetjob"] },
    NTR: {
      keywords: ["cuckcoldry", "cuckold", "netorare", "寝取られ", "逆NTR"],
      description:
        "A fetish in which someone close to the protagonist is either willingly or unwillingly seduced and stolen away. This isn't necessarily limited to one's lover, but may also include friends, unrequited love interests, or even relatives.\n\nClosely related is netori/netoru (寝取り/寝取る). In this genre, the protagonist instead takes the lover of someone else. Also related is cuckolding, in which seeking out others is actively encouraged, even at the expense of the cuckold.",
    },
    cheating: {
      keywords: ["affair", "不倫", "浮気"],
      description:
        "Cheating, in a sexual sense, is having sex with someone other than one's regular partner in a monogamous relationship. When this happens among married people, this is known as adultery. This can also apply to meeting another without the regular partner knowing.",
    },
    "reverse NTR": { keywords: ["reverse netorare", "逆NTR"] },
    panties: { keywords: ["underwear"] },
    bra: { keywords: ["underwear"] },
    thighhighs: { keywords: ["stockings"] },
    thong: { keywords: ["underwear"] },
    "t-back": { keywords: ["underwear"] },
    barefoot: { keywords: ["barefeet"] },
    glansjob: { keywords: ["handjob"] },
    anilingus: { keywords: ["anus licking", "butthole licking"] },
    "rusty trombone": {
      keywords: [
        "anilingus",
        "anus licking",
        "butthole licking",
        "handjob",
        "oral",
      ],
      description:
        "Performing anilingus on a male partner while giving him a handjob at the same time. Named after the mouth piece and sliding arm of the brass instrument, the trombone.",
    },
    "breast sucking": { keywords: ["nipple sucking"] },
    cunnilingus: { keywords: ["licking pussy", "pussy lick"] },
    irrumatio: {
      keywords: [
        "deepthroat",
        "thrusting penis into mouth",
        "thrusting penis into throat",
      ],
      description:
        "A type of oral sexual intercourse performed by someone actively thrusting their penis into their partner's mouth and possibly their throat.\n\nThe distinction between fellatio and irrumatio is based on who is actively moving: irrumatio means to thrust the penis into the partner's mouth, while fellatio means to move the head and mouth up-and-down around the penis. For tentacle sex, use mouth insertion instead.\n\nThe word comes from the Latin irrumāre, which had the same definition; although to the Romans it specifically connoted non-consensuality, which is not always the case in English.",
    },
    "licking testicle": {
      keywords: [
        "ball licking",
        "balls licking",
        "balls sucking",
        "licking balls",
      ],
    },
    "testicle sucking": {
      keywords: [
        "ball sucking",
        "balls sucking",
        "licking balls",
        "sucking balls",
      ],
    },
    "reverse spitroast": { keywords: ["ffm threesome"] },
    "cervical penetration": { keywords: ["cervix penetration"] },
    "stomach bulge": { keywords: ["stomach deformation"] },
    clitoris: { keywords: ["pussy", "vagina", "vulva"] },
    v: { keywords: ["piece sign"] },
    "double v": { keywords: ["double piece sign"] },
    "gigantic breasts": { keywords: ["giant breasts"] },
    "large testicles": {
      keywords: ["big balls", "big testicles", "large balls"],
    },
    "fat mons": { keywords: ["fat pussy"] },
    "pubic hair": {
      keywords: [
        "hairy anus",
        "hairy balls",
        "hairy pussy",
        "hairy testicles",
        "male pubic hair",
      ],
    },
    "female pubic hair": { keywords: ["hairy anus", "hairy pussy"] },
    "armpit hair": { keywords: ["hairy armpits"] },
    "excessive pubic hair": { keywords: ["female pubic hair"] },
    "anus hair": { keywords: ["anus pubic hair", "hairy anus"] },
    "female anus hair": { keywords: ["female anus pubic hair", "hairy anus"] },
    "sagging breasts": { keywords: ["saggy breasts"] },
    trap: { keywords: ["femboy"] },
    kiss: { keywords: ["kissing"] },
    hug: { keywords: ["hugging"] },
    "french kiss": { keywords: ["french kissing"] },
    decensored: { keywords: ["uncensored"] },
    gaping: { keywords: ["open anus", "spread anus"] },
    "cum in pussy": { keywords: ["nakadashi", "vaginal creampie"] },
    "cum in ass": { keywords: ["anal creampie", "cum in anus"] },
    toddlercon: { keywords: ["loli", "lolicon"] },
    "mouth mask": { keywords: ["face mask"] },
    ":>=": {
      keywords: [
        "blowjob face",
        "fellatio",
        "sucking cock",
        "sucking dick",
        "sucking penis",
        "vacuum face",
      ],
    },
    aroused: {
      description:
        "When a character is sexually excited or stimulated. This can be through sex, oral, nipple sucking, touching, french kissing, mutual masturbation, heavy breathing or other intimate acts.",
    },
    "naughty face": {
      keywords: ["lewd expressions", "lewd face", "naughty expression"],
    },
    fart: { keywords: ["farting"] },
    "female ejaculation": { keywords: ["squirting"] },
    erection: { keywords: ["boner"] },
    facial: { keywords: ["cum on face"] },
    gokkun: {
      keywords: [
        "drinking cum",
        "drinking semen",
        "swallow cum",
        "swallow semen",
      ],
    },
    "spread legs": { keywords: ["spreading legs"] },
    "m legs": { keywords: ["spread legs"] },
    "v legs": { keywords: ["spread legs"] },
    "false smile": { keywords: ["fake smile"] },
    "butt plug": { keywords: ["anal plug"] },
    manspreading: { keywords: ["spread legs"] },
    "licking foot": { keywords: ["licking feet"] },
    vomit: { keywords: ["throw up"] },
    burp: { keywords: ["burping"] },
    "rolling eyes": { keywords: ["ahegao"] },
    "penis awe": { keywords: ["penis shock"] },
  };

  const insertTag = db.prepare(
    "INSERT OR IGNORE INTO tags (name, category_id, description) VALUES (?, ?, ?)"
  );
  const insertAlias = db.prepare(
    "INSERT OR IGNORE INTO tag_aliases (tag_id, alias) VALUES (?, ?)"
  );
  const getTagId = db.prepare("SELECT id FROM tags WHERE name = ?");

  db.transaction(() => {
    if (options.importTags) {
      for (const [name, catName] of defaults) {
        const meta = defaultTagMeta[name];
        const description = meta?.description ?? null;
        insertTag.run(name, getCatId(catName), description);

        // Add keywords/aliases for the tag
        if (meta?.keywords && meta.keywords.length > 0) {
          const tagRow = getTagId.get(name) as { id: number } | undefined;
          if (tagRow) {
            for (const keyword of meta.keywords) {
              insertAlias.run(tagRow.id, keyword);
            }
          }
        }
      }
    }

    const barefeetRow = db
      .prepare("SELECT id FROM tags WHERE name = ?")
      .get("barefeet") as { id: number } | undefined;
    const barefootRow = db
      .prepare("SELECT id FROM tags WHERE name = ?")
      .get("barefoot") as { id: number } | undefined;
    if (barefeetRow) {
      if (!barefootRow) {
        db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(
          "barefoot",
          barefeetRow.id
        );
      } else {
        db.prepare(
          "UPDATE OR IGNORE item_tags SET tag_id = ? WHERE tag_id = ?"
        ).run(barefootRow.id, barefeetRow.id);
        db.prepare("DELETE FROM item_tags WHERE tag_id = ?").run(
          barefeetRow.id
        );
        db.prepare(
          "UPDATE OR IGNORE tag_aliases SET tag_id = ? WHERE tag_id = ?"
        ).run(barefootRow.id, barefeetRow.id);
        db.prepare("DELETE FROM tag_aliases WHERE tag_id = ?").run(
          barefeetRow.id
        );
        db.prepare("DELETE FROM tags WHERE id = ?").run(barefeetRow.id);
      }
    }

    const schoolUnifromRow = db
      .prepare("SELECT id FROM tags WHERE name = ?")
      .get("school unifrom") as { id: number } | undefined;
    const schoolUniformRow = db
      .prepare("SELECT id FROM tags WHERE name = ?")
      .get("school uniform") as { id: number } | undefined;
    if (schoolUnifromRow) {
      if (!schoolUniformRow) {
        db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(
          "school uniform",
          schoolUnifromRow.id
        );
      } else {
        db.prepare(
          "UPDATE OR IGNORE item_tags SET tag_id = ? WHERE tag_id = ?"
        ).run(schoolUniformRow.id, schoolUnifromRow.id);
        db.prepare("DELETE FROM item_tags WHERE tag_id = ?").run(
          schoolUnifromRow.id
        );
        db.prepare(
          "UPDATE OR IGNORE tag_aliases SET tag_id = ? WHERE tag_id = ?"
        ).run(schoolUniformRow.id, schoolUnifromRow.id);
        db.prepare("DELETE FROM tag_aliases WHERE tag_id = ?").run(
          schoolUnifromRow.id
        );
        db.prepare("DELETE FROM tags WHERE id = ?").run(schoolUnifromRow.id);
      }
    }

    // Ensure all known default tags are marked
    const allDefaultTagNames = defaults.map((d) => d[0]);
    const markDefault = db.prepare(
      "UPDATE tags SET is_default = 1 WHERE name = ?"
    );
    if (options.importTags) {
      for (const name of allDefaultTagNames) {
        markDefault.run(name);
      }
    }
  })();
}

// --- CONTENT TYPE OPERATIONS -----------------------------------------------
export interface ContentType {
  id: number;
  name: string;
  description: string | null;
  is_default?: boolean;
}

export interface ContentTypeWithAliases extends ContentType {
  aliases: string[];
}

export function getAllTypes(): ContentType[] {
  if (!db) return [];
  return db
    .prepare("SELECT * FROM content_types ORDER BY name")
    .all() as ContentType[];
}

export function getAllTypesWithAliases(): ContentTypeWithAliases[] {
  if (!db) return [];
  const types = getAllTypes();
  return types.map((type) => ({
    ...type,
    aliases: getTypeAliases(type.id),
  }));
}

export function getTypeById(id: number): ContentType | null {
  if (!db) return null;
  return (
    (db
      .prepare("SELECT * FROM content_types WHERE id = ?")
      .get(id) as ContentType) || null
  );
}

export function createType(
  name: string,
  description: string | null
): ContentType {
  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO content_types (name, description, is_default) VALUES (?, ?, 0)"
    )
    .run(name, description);
  return {
    id: result.lastInsertRowid as number,
    name,
    description,
    is_default: false,
  };
}

export function updateType(id: number, updates: Partial<ContentType>) {
  if (!db) return;
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push("description = ?");
    values.push(updates.description);
  }

  if (fields.length === 0) return;
  values.push(id);

  db.prepare(`UPDATE content_types SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values
  );
}

export function deleteType(id: number) {
  if (!db) return;
  db.prepare("DELETE FROM content_types WHERE id = ?").run(id);
}

export function getTypeAliases(typeId: number): string[] {
  if (!db) return [];
  const rows = db
    .prepare("SELECT alias FROM type_aliases WHERE type_id = ?")
    .all(typeId) as { alias: string }[];
  return rows.map((r) => r.alias);
}

export function addTypeAliases(typeId: number, aliases: string[]) {
  if (!db || aliases.length === 0) return;
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO type_aliases (type_id, alias) VALUES (?, ?)"
  );
  for (const alias of aliases) {
    stmt.run(typeId, alias.trim());
  }
}

export function removeTypeAlias(typeId: number, alias: string) {
  if (!db) return;
  db.prepare("DELETE FROM type_aliases WHERE type_id = ? AND alias = ?").run(
    typeId,
    alias
  );
}

function initDefaultTypes(db: Database.Database, shouldImport: boolean) {
  if (!shouldImport) return;
  const defaultTypes = [
    {
      name: "Manga",
      description: "Japanese comic format, typically read right-to-left",
    },
    { name: "Doujinshi", description: "Self-published or fan-made works" },
    {
      name: "Webtoon",
      description: "Vertical scroll format, typically Korean",
    },
    { name: "R18", description: "Adult content (18+)" },
    { name: "Image Set", description: "Collection of images or illustrations" },
    {
      name: "Artist CG",
      description: "Collection of CGs from a single artist",
    },
  ];
  const insertType = db.prepare(
    "INSERT OR IGNORE INTO content_types (name, description, is_default) VALUES (?, ?, 1)"
  );
  for (const type of defaultTypes) insertType.run(type.name, type.description);
  const updateDefault = db.prepare(
    "UPDATE content_types SET is_default = 1 WHERE name = ?"
  );
  for (const type of defaultTypes) updateDefault.run(type.name);
}

function migrateContentTypes(db: Database.Database) {
  try {
    const count = db
      .prepare("SELECT COUNT(*) as count FROM item_types")
      .get() as { count: number };
    if (count.count > 0) return;
    const items = db
      .prepare(
        "SELECT id, content_type FROM library_items WHERE content_type IS NOT NULL AND content_type != ''"
      )
      .all() as { id: number; content_type: string }[];
    if (items.length === 0) return;
    const insertItemType = db.prepare(
      "INSERT OR IGNORE INTO item_types (item_id, type_id) VALUES (?, ?)"
    );
    const findType = db.prepare(
      "SELECT id FROM content_types WHERE name = ? COLLATE NOCASE"
    );
    const transaction = db.transaction(() => {
      for (const item of items) {
        const typeNames = item.content_type.split(",").filter(Boolean);
        for (const typeName of typeNames) {
          const type = findType.get(typeName) as { id: number } | undefined;
          if (type) insertItemType.run(item.id, type.id);
        }
      }
    });
    transaction();
  } catch (e) {
    console.error("Error maintaining content types:", e);
  }
}

// --- TAG OPERATIONS --------------------------------------------------------
export function getAllTags(): TagWithCategory[] {
  return getDb()
    .prepare(
      `
    SELECT t.*, c.name as category_name 
    FROM tags t 
    LEFT JOIN categories c ON t.category_id = c.id 
    ORDER BY t.name ASC
  `
    )
    .all() as TagWithCategory[];
}

export interface TagWithAliases extends TagWithCategory {
  aliases: string[];
}

export function getAllTagsWithAliases(): TagWithAliases[] {
  const tags = getAllTags();
  const tagIds = tags.map((t) => t.id);
  if (tagIds.length === 0) return [];
  const placeholders = tagIds.map(() => "?").join(",");
  const aliasRows = getDb()
    .prepare(
      `SELECT tag_id, alias FROM tag_aliases WHERE tag_id IN (${placeholders})`
    )
    .all(...tagIds) as { tag_id: number; alias: string }[];
  const aliasMap = new Map<number, string[]>();
  for (const row of aliasRows) {
    if (!aliasMap.has(row.tag_id)) aliasMap.set(row.tag_id, []);
    aliasMap.get(row.tag_id)!.push(row.alias);
  }
  return tags.map((tag) => ({ ...tag, aliases: aliasMap.get(tag.id) || [] }));
}

export function searchTags(query: string): TagWithCategory[] {
  const pattern = `%${query}%`;
  return getDb()
    .prepare(
      `
    SELECT t.*, c.name as category_name
    FROM tags t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.name LIKE @pattern
    OR t.id IN (SELECT tag_id FROM tag_aliases WHERE alias LIKE @pattern)
    ORDER BY
      CASE
        WHEN lower(t.name) = lower(@query) THEN 1
        WHEN lower(t.name) LIKE lower(@query) || '%' THEN 2
        WHEN EXISTS (SELECT 1 FROM tag_aliases ta WHERE ta.tag_id = t.id AND lower(ta.alias) = lower(@query)) THEN 3
        WHEN EXISTS (SELECT 1 FROM tag_aliases ta WHERE ta.tag_id = t.id AND lower(ta.alias) LIKE lower(@query) || '%') THEN 4
        ELSE 5
      END ASC,
      t.name ASC
    LIMIT 20
  `
    )
    .all({ query, pattern }) as TagWithCategory[];
}

export function createTag(
  name: string,
  categoryId: number | null,
  description: string | null = null
): Tag {
  const info = getDb()
    .prepare(
      "INSERT INTO tags (name, category_id, description, is_default) VALUES (?, ?, ?, 0)"
    )
    .run(name, categoryId, description);
  return {
    id: info.lastInsertRowid as number,
    name,
    category_id: categoryId,
    description,
    is_default: false,
  };
}

export function updateTag(id: number, updates: Partial<Tag>) {
  const allowed = ["name", "category_id", "description", "is_default"];
  const fields = Object.keys(updates).filter(
    (k) => k !== "id" && allowed.includes(k)
  );
  if (fields.length === 0) return;
  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => updates[f as keyof Tag]);
  getDb()
    .prepare(`UPDATE tags SET ${setClause} WHERE id = ?`)
    .run(...values, id);
}

export function deleteTag(id: number) {
  getDb().prepare("DELETE FROM tags WHERE id = ?").run(id);
}

export function addTagAliases(tagId: number, aliases: string[]) {
  const insert = getDb().prepare(
    "INSERT OR IGNORE INTO tag_aliases (tag_id, alias) VALUES (?, ?)"
  );
  const many = getDb().transaction((items: string[]) => {
    for (const alias of items) insert.run(tagId, alias);
  });
  many(aliases);
}

export function removeTagAlias(tagId: number, alias: string) {
  getDb()
    .prepare("DELETE FROM tag_aliases WHERE tag_id = ? AND alias = ?")
    .run(tagId, alias);
}

export function getTagAliases(tagId: number): string[] {
  const rows = getDb()
    .prepare("SELECT alias FROM tag_aliases WHERE tag_id = ?")
    .all(tagId) as { alias: string }[];
  return rows.map((r) => r.alias);
}

// --- DATA EXPORT -----------------------------------------------------------
export function getTagExportData(options: {
  includeDescription: boolean;
  includeKeywords: boolean;
  includeDefaultTags: boolean;
  excludedCategoryIds: number[];
  includeTypes?: boolean;
  includeDefaultTypes?: boolean;
  excludedTypeIds?: number[];
}) {
  const db_local = getDb();
  const excludedTypeIds = options.excludedTypeIds || [];
  const excludedTypeIdsSql =
    excludedTypeIds.length > 0 ? excludedTypeIds.join(",") : "-1";
  const categories = db_local
    .prepare(
      `SELECT * FROM categories WHERE (? = 1 OR is_default = 0) AND id NOT IN (${
        options.excludedCategoryIds.length > 0
          ? options.excludedCategoryIds.join(",")
          : "-1"
      })`
    )
    .all(options.includeDefaultTags ? 1 : 0) as Category[];
  const tags = db_local
    .prepare(
      `SELECT t.*, c.name as category_name FROM tags t LEFT JOIN categories c ON t.category_id = c.id WHERE (? = 1 OR t.is_default = 0) AND (t.category_id IS NULL OR t.category_id NOT IN (${
        options.excludedCategoryIds.length > 0
          ? options.excludedCategoryIds.join(",")
          : "-1"
      }))`
    )
    .all(options.includeDefaultTags ? 1 : 0) as TagWithCategory[];
  const exportCategories = categories.map((c) => ({
    name: c.name,
    description: options.includeDescription ? c.description : null,
    isDefault: Boolean(c.is_default),
  }));
  const itemTags = db_local
    .prepare(
      `SELECT it.item_id, t.name as tag_name, li.path FROM item_tags it JOIN tags t ON it.tag_id = t.id JOIN library_items li ON it.item_id = li.id WHERE (? = 1 OR t.is_default = 0) AND (t.category_id IS NULL OR t.category_id NOT IN (${
        options.excludedCategoryIds.length > 0
          ? options.excludedCategoryIds.join(",")
          : "-1"
      })) AND EXISTS (SELECT 1 FROM item_types it2 WHERE it2.item_id = it.item_id AND it2.type_id NOT IN (${excludedTypeIdsSql}))`
    )
    .all(options.includeDefaultTags ? 1 : 0) as {
    item_id: number;
    tag_name: string;
    path: string;
  }[];
  const tagItems: Record<string, string[]> = {};
  for (const entry of itemTags) {
    if (!tagItems[entry.tag_name]) tagItems[entry.tag_name] = [];
    tagItems[entry.tag_name].push(entry.path);
  }
  const usedTagNames = new Set(Object.keys(tagItems));
  const exportTags = tags
    .filter((t) => usedTagNames.has(t.name))
    .map((t) => {
      const exportTag: any = {
        name: t.name,
        categoryName: t.category_name || null,
        description: options.includeDescription ? t.description : null,
        isDefault: Boolean(t.is_default),
      };
      if (options.includeKeywords) {
        const aliases = db_local
          .prepare("SELECT alias FROM tag_aliases WHERE tag_id = ?")
          .all(t.id) as { alias: string }[];
        exportTag.keywords = aliases.map((a) => a.alias);
      }
      return exportTag;
    });
  let exportTypes: any[] = [];
  let typeItems: Record<string, string[]> = {};
  if (options.includeTypes !== false) {
    const types = db_local
      .prepare(
        `SELECT * FROM content_types WHERE (? = 1 OR is_default = 0) AND id NOT IN (${excludedTypeIdsSql})`
      )
      .all(options.includeDefaultTypes !== false ? 1 : 0) as ContentType[];
    exportTypes = types.map((t) => {
      const exp: any = {
        name: t.name,
        description: options.includeDescription ? t.description : null,
        isDefault: Boolean(t.is_default),
      };
      if (options.includeKeywords) {
        const aliases = db_local
          .prepare("SELECT alias FROM type_aliases WHERE type_id = ?")
          .all(t.id) as { alias: string }[];
        exp.keywords = aliases.map((a) => a.alias);
      }
      return exp;
    });
    const itemTypesData = db_local
      .prepare(
        `SELECT it.item_id, ct.name as type_name, li.path FROM item_types it JOIN content_types ct ON it.type_id = ct.id JOIN library_items li ON it.item_id = li.id WHERE (? = 1 OR ct.is_default = 0) AND ct.id NOT IN (${excludedTypeIdsSql}) AND EXISTS (SELECT 1 FROM item_types it3 WHERE it3.item_id = it.item_id AND it3.type_id NOT IN (${excludedTypeIdsSql}))`
      )
      .all(options.includeDefaultTypes !== false ? 1 : 0) as {
      item_id: number;
      type_name: string;
      path: string;
    }[];
    for (const entry of itemTypesData) {
      if (!typeItems[entry.type_name]) typeItems[entry.type_name] = [];
      typeItems[entry.type_name].push(entry.path);
    }
  }
  return {
    categories: exportCategories,
    tags: exportTags,
    tagItems,
    types: exportTypes,
    typeItems,
  };
}

// --- LIBRARY OPERATIONS ----------------------------------------------------
export function getAllItems(parentId: number | null = null): LibraryItem[] {
  const sql = `
    SELECT li.*, 
    GROUP_CONCAT(DISTINCT t.name) as tags_list,
    GROUP_CONCAT(DISTINCT ct.name) as types_list
    FROM library_items li
    LEFT JOIN item_tags it ON li.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    LEFT JOIN item_types it2 ON li.id = it2.item_id
    LEFT JOIN content_types ct ON it2.type_id = ct.id
    WHERE ${parentId === null ? "li.parent_id IS NULL" : "li.parent_id = ?"}
    GROUP BY li.id
  `;

  const stmt = getDb().prepare(sql);
  const items =
    parentId === null
      ? (stmt.all() as LibraryItem[])
      : (stmt.all(parentId) as LibraryItem[]);

  return items.sort((a, b) => {
    // 1. Types: Folders first
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    // 2. Title: Natural sort (numeric awareness)
    return a.title.localeCompare(b.title, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

export function getAllItemsFlat(): LibraryItem[] {
  return getDb().prepare("SELECT * FROM library_items").all() as LibraryItem[];
}

export function getItemByPath(itemPath: string): LibraryItem | undefined {
  const normalized = itemPath.replace(/\\/g, "/");
  return getDb()
    .prepare(
      `
    SELECT li.*, 
    GROUP_CONCAT(DISTINCT t.name) as tags_list,
    GROUP_CONCAT(DISTINCT ct.name) as types_list
    FROM library_items li
    LEFT JOIN item_tags it ON li.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    LEFT JOIN item_types it2 ON li.id = it2.item_id
    LEFT JOIN content_types ct ON it2.type_id = ct.id
    WHERE replace(li.path, '\\', '/') = ? COLLATE NOCASE
    GROUP BY li.id
  `
    )
    .get(normalized) as LibraryItem | undefined;
}

export function getItemById(id: number): LibraryItem | undefined {
  return getDb()
    .prepare(
      `
    SELECT li.*, 
    GROUP_CONCAT(DISTINCT t.name) as tags_list,
    GROUP_CONCAT(DISTINCT ct.name) as types_list
    FROM library_items li
    LEFT JOIN item_tags it ON li.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    LEFT JOIN item_types it2 ON li.id = it2.item_id
    LEFT JOIN content_types ct ON it2.type_id = ct.id
    WHERE li.id = ?
    GROUP BY li.id
  `
    )
    .get(id) as LibraryItem | undefined;
}
export function getTotalBookCount(): number {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) as count FROM library_items WHERE type != 'folder'"
    )
    .get() as { count: number };
  return row.count;
}

export function searchItems(query: string): LibraryItem[] {
  // Parse query for tags and text
  // Syntax: "text -\u200Bfoo \u200Bbar"
  // Logic:
  // 1. Term starts with '\u200B' (ZWSP): Strict Tag Search (Item MUST have this tag).
  // 2. Term does NOT start with '\u200B': Loose Search (Item Title partial match OR Item has tag).

  const terms = query
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (terms.length === 0) return getAllItemsFlat();

  const TAG_MARKER = "\u200B";

  interface SearchTerm {
    val: string;
    type: "text" | "tag";
  }

  const inclusions: SearchTerm[] = [];
  const exclusions: SearchTerm[] = [];

  terms.forEach((term) => {
    let cleanTerm = term;
    let isExclusion = false;

    if (cleanTerm.startsWith("-")) {
      isExclusion = true;
      cleanTerm = cleanTerm.slice(1);
    }

    let type: "text" | "tag" = "text";
    if (cleanTerm.startsWith(TAG_MARKER)) {
      type = "tag";
      cleanTerm = cleanTerm.slice(TAG_MARKER.length); // remove ZWSP
    }

    if (!cleanTerm) return;

    const obj = { val: cleanTerm, type };
    if (isExclusion) {
      exclusions.push(obj);
    } else {
      inclusions.push(obj);
    }
  });

  let tempDb = getDb();

  let sql = `
    SELECT li.*,
    GROUP_CONCAT(DISTINCT t.name) as tags_list,
    GROUP_CONCAT(DISTINCT ct.name) as types_list
    FROM library_items li
    LEFT JOIN item_tags it_main ON li.id = it_main.item_id
    LEFT JOIN tags t ON it_main.tag_id = t.id
    LEFT JOIN item_types it_types ON li.id = it_types.item_id
    LEFT JOIN content_types ct ON it_types.type_id = ct.id
  `;
  const params: any[] = [];
  const whereClauses: string[] = [];

  for (const term of inclusions) {
    if (term.type === "tag") {
      // STRICT Tag Match - EXACT ONLY
      whereClauses.push(`EXISTS (
            SELECT 1 FROM item_tags it 
            JOIN tags t ON it.tag_id = t.id 
            WHERE it.item_id = li.id AND t.name = ? COLLATE NOCASE
        )`);
      params.push(term.val);
    } else {
      // Loose Match (Title OR Tag)
      // Checks Title (partial) OR Tag (exact)
      whereClauses.push(`(
          li.title LIKE ? COLLATE NOCASE
          OR EXISTS (
            SELECT 1 FROM item_tags it 
            JOIN tags t ON it.tag_id = t.id 
            WHERE it.item_id = li.id AND (t.name = ? COLLATE NOCASE OR t.name IN (SELECT name FROM tags WHERE id IN (SELECT tag_id FROM tag_aliases WHERE alias = ? COLLATE NOCASE)))
          )
        )`);
      params.push(`%${term.val}%`, term.val, term.val);
    }
  }

  for (const term of exclusions) {
    if (term.type === "tag") {
      // STRICT Tag Exclusion - EXACT ONLY
      whereClauses.push(`NOT EXISTS (
            SELECT 1 FROM item_tags it 
            JOIN tags t ON it.tag_id = t.id 
            WHERE it.item_id = li.id AND t.name = ? COLLATE NOCASE
         )`);
      params.push(term.val);
    } else {
      // Loose Exclusion (Title OR Tag)
      whereClauses.push(`NOT (
          li.title LIKE ? COLLATE NOCASE
          OR EXISTS (
            SELECT 1 FROM item_tags it 
            JOIN tags t ON it.tag_id = t.id 
            WHERE it.item_id = li.id AND (t.name = ? COLLATE NOCASE OR t.name IN (SELECT name FROM tags WHERE id IN (SELECT tag_id FROM tag_aliases WHERE alias = ? COLLATE NOCASE)))
          )
        )`);
      params.push(`%${term.val}%`, term.val, term.val);
    }
  }

  // Global search: include files and folders by filename

  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(" AND ")}`;
  }

  // Optimization: Sort and Limit
  sql += ` GROUP BY li.id ORDER BY li.type DESC, li.title ASC`;

  const items = tempDb.prepare(sql).all(...params) as LibraryItem[];

  // Note: tags_list and types_list are now populated directly by the query.
  // No need for secondary enrichment queries.

  return items;
}

// --- ITEM RELATIONSHIPS ----------------------------------------------------
export function addItem(item: Omit<LibraryItem, "id" | "added_at">): number {
  const normalizedPath = item.path.replace(/\\/g, "/");
  const existing = getItemByPath(normalizedPath);

  if (existing) {
    // Update existing item
    const stmt = getDb().prepare(`
      UPDATE library_items SET
        title = @title,
        type = @type,
        page_count = @page_count,
        cover_path = coalesce(@cover_path, cover_path),
        parent_id = @parent_id,
        reading_status = coalesce(reading_status, @reading_status),
        last_read_at = coalesce(last_read_at, @last_read_at),
        current_page = @current_page,
        is_favorite = @is_favorite
      WHERE id = @id
    `);

    stmt.run({
      ...item,
      path: normalizedPath,
      id: existing.id,
      is_favorite: item.is_favorite ? 1 : 0,
    });
    return existing.id;
  }

  const stmt = getDb().prepare(`
    INSERT INTO library_items (path, title, type, page_count, cover_path, parent_id, is_favorite, reading_status, current_page, last_read_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    normalizedPath,
    item.title,
    item.type,
    item.page_count,
    item.cover_path,
    item.parent_id,
    item.is_favorite ? 1 : 0,
    item.reading_status,
    item.current_page,
    item.last_read_at
  );

  return result.lastInsertRowid as number;
}

export function updateItem(id: number, updates: Partial<LibraryItem>) {
  const allowed = [
    "path",
    "title",
    "type",
    "page_count",
    "cover_path",
    "parent_id",
    "is_favorite",
    "reading_status",
    "current_page",
    "last_read_at",
    "content_type",
  ];
  const fields = Object.keys(updates).filter(
    (k) => k !== "id" && allowed.includes(k)
  );
  if (fields.length === 0) return;

  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => {
    let val = updates[f as keyof LibraryItem];
    if (f === "path" && typeof val === "string") {
      val = val.replace(/\\/g, "/");
    }
    if (typeof val === "boolean") return val ? 1 : 0;
    return val;
  });

  getDb()
    .prepare(`UPDATE library_items SET ${setClause} WHERE id = ?`)
    .run(...values, id);
}

export function deleteItem(id: number) {
  // Delete this item and all its descendants (subfolders, books).
  // We store the hierarchy with parent_id, but do not enforce ON DELETE CASCADE.
  getDb()
    .prepare(
      `
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM library_items WHERE id = ?
        UNION ALL
        SELECT li.id
        FROM library_items li
        JOIN descendants d ON li.parent_id = d.id
      )
      DELETE FROM library_items
      WHERE id IN (SELECT id FROM descendants)
    `
    )
    .run(id);
}

export function clearAllItems() {
  getDb().prepare("DELETE FROM library_items").run();
}

export function getFavorites(): LibraryItem[] {
  try {
    const items = getDb()
      .prepare(
        `
      SELECT li.*, 
      GROUP_CONCAT(DISTINCT t.name) as tags_list,
      GROUP_CONCAT(DISTINCT ct.name) as types_list
      FROM library_items li
      LEFT JOIN item_tags it ON li.id = it.item_id
      LEFT JOIN tags t ON it.tag_id = t.id
      LEFT JOIN item_types it2 ON li.id = it2.item_id
      LEFT JOIN content_types ct ON it2.type_id = ct.id
      WHERE li.is_favorite = 1
      GROUP BY li.id
      ORDER BY li.type DESC, li.title ASC
    `
      )
      .all() as LibraryItem[];
    return items;
  } catch (e) {
    console.error("Error in getFavorites:", e);
    return [];
  }
}

export function getRecent(limit: number = 20): LibraryItem[] {
  return getDb()
    .prepare(
      `
      SELECT li.*, 
      GROUP_CONCAT(DISTINCT t.name) as tags_list,
      GROUP_CONCAT(DISTINCT ct.name) as types_list
      FROM library_items li
      LEFT JOIN item_tags it ON li.id = it.item_id
      LEFT JOIN tags t ON it.tag_id = t.id
      LEFT JOIN item_types it2 ON li.id = it2.item_id
      LEFT JOIN content_types ct ON it2.type_id = ct.id
      WHERE li.last_read_at IS NOT NULL 
      GROUP BY li.id
      ORDER BY li.last_read_at DESC, li.id DESC 
      LIMIT ?
      `
    )
    .all(limit) as LibraryItem[];
}

export function toggleFavorite(id: number): boolean {
  const item = getDb()
    .prepare("SELECT is_favorite FROM library_items WHERE id = ?")
    .get(id) as { is_favorite: number } | undefined;
  if (!item) return false;
  const newValue = item.is_favorite ? 0 : 1;
  getDb()
    .prepare("UPDATE library_items SET is_favorite = ? WHERE id = ?")
    .run(newValue, id);
  return newValue === 1;
}

export function updateReadingProgress(
  id: number,
  currentPage: number,
  status?: "unread" | "reading" | "read",
  updateTimestamp: boolean = true
): string | null {
  const existing = getDb()
    .prepare(
      "SELECT last_read_at, current_page FROM library_items WHERE id = ?"
    )
    .get(id) as
    | { last_read_at: string | null; current_page: number }
    | undefined;

  const updates: any = {
    current_page: currentPage,
  };
  let lastReadAt: string | null = null;

  const isForwardChange = Boolean(
    existing &&
      existing.current_page !== currentPage &&
      currentPage > existing.current_page
  );

  const shouldTouchTimestamp = Boolean(
    updateTimestamp ||
      isForwardChange ||
      (existing &&
        existing.last_read_at === null &&
        existing.current_page !== currentPage)
  );

  if (shouldTouchTimestamp) {
    lastReadAt = new Date().toISOString();
    updates.last_read_at = lastReadAt;
  }
  if (status) updates.reading_status = status;
  updateItem(id, updates);
  return lastReadAt;
}

export function removeFromRecent(id: number) {
  getDb()
    .prepare(
      "UPDATE library_items SET last_read_at = NULL, current_page = 0 WHERE id = ?"
    )
    .run(id);
}

export function deleteItemsByRoot(rootPath: string): void {
  const db = getDb();
  try {
    let normalizedRoot = rootPath.replace(/\\/g, "/");
    // Ensure trailing slash for literal match precision
    if (!normalizedRoot.endsWith("/")) normalizedRoot += "/";

    // Find items matching root
    const itemsToDelete = db
      .prepare(
        `
      SELECT id 
      FROM library_items 
      WHERE replace(path, '\\', '/') LIKE ? || '%'
    `
      )
      .all(normalizedRoot) as { id: number }[];

    if (itemsToDelete.length > 0) {
      const ids = itemsToDelete.map((i) => i.id);
      db.prepare(
        `DELETE FROM library_items WHERE id IN (${ids.join(",")})`
      ).run();
    }
  } catch (e) {
    console.error(`[DB] Error deleting items by root ${rootPath}:`, e);
    throw e;
  }
}

// --- ITEM TAGGING ----------------------------------------------------------
export function addItemTags(itemId: number, tagIds: number[]) {
  const insert = getDb().prepare(
    "INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)"
  );
  const many = getDb().transaction((ids) => {
    for (const tid of ids) insert.run(itemId, tid);
  });
  many(tagIds);
}

export function removeItemTags(itemId: number, tagIds: number[]) {
  const del = getDb().prepare(
    "DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?"
  );
  const many = getDb().transaction((ids) => {
    for (const tid of ids) del.run(itemId, tid);
  });
  many(tagIds);
}

export function getItemTags(itemId: number): TagWithCategory[] {
  return getDb()
    .prepare(
      `
    SELECT t.*, c.name as category_name
    FROM tags t
    JOIN item_tags it ON t.id = it.tag_id
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE it.item_id = ?
    ORDER BY c.name, t.name
  `
    )
    .all(itemId) as TagWithCategory[];
}

export function getBulkItemTags(itemIds: number[]): TagWithCategory[] {
  if (itemIds.length === 0) return [];
  if (itemIds.length === 1) return getItemTags(itemIds[0]);

  const placeholders = itemIds.map(() => "?").join(",");
  return getDb()
    .prepare(
      `
    SELECT t.*, c.name as category_name
    FROM tags t
    JOIN item_tags it ON t.id = it.tag_id
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE it.item_id IN (${placeholders})
    GROUP BY t.id
    HAVING COUNT(DISTINCT it.item_id) = ?
    ORDER BY c.name, t.name
  `
    )
    .all(...itemIds, itemIds.length) as TagWithCategory[];
}

export function getItemTypes(itemId: number): ContentType[] {
  if (!db) return [];
  return db
    .prepare(
      `SELECT ct.* FROM content_types ct
       JOIN item_types it ON ct.id = it.type_id
       WHERE it.item_id = ?
       ORDER BY ct.name`
    )
    .all(itemId) as ContentType[];
}

export function addItemTypes(itemId: number, typeIds: number[]) {
  if (!db || typeIds.length === 0) return;
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO item_types (item_id, type_id) VALUES (?, ?)"
  );
  for (const typeId of typeIds) {
    stmt.run(itemId, typeId);
  }
}

export function removeItemTypes(itemId: number, typeIds: number[]) {
  if (!db || typeIds.length === 0) return;
  const stmt = db.prepare(
    "DELETE FROM item_types WHERE item_id = ? AND type_id = ?"
  );
  for (const typeId of typeIds) {
    stmt.run(itemId, typeId);
  }
}

// --- BATCH OPERATIONS ------------------------------------------------------
export async function bulkDeleteItems(ids: number[]) {
  if (ids.length === 0) return;
  const db = getDb();
  const deleteStmt = db.prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM library_items WHERE id = ?
      UNION ALL
      SELECT li.id
      FROM library_items li
      JOIN descendants d ON li.parent_id = d.id
    )
    DELETE FROM library_items
    WHERE id IN (SELECT id FROM descendants)
  `);

  db.transaction((targetIds) => {
    for (const id of targetIds) {
      deleteStmt.run(id);
    }
  })(ids);
}

export function bulkToggleFavorite(ids: number[]) {
  if (ids.length === 0) return;
  const db = getDb();
  const firstItem = db
    .prepare("SELECT is_favorite FROM library_items WHERE id = ?")
    .get(ids[0]) as { is_favorite: number } | undefined;
  if (!firstItem) return;

  const newValue = firstItem.is_favorite ? 0 : 1;
  const updateStmt = db.prepare(
    "UPDATE library_items SET is_favorite = ? WHERE id = ?"
  );

  db.transaction((targetIds) => {
    for (const id of targetIds) {
      updateStmt.run(newValue, id);
    }
  })(ids);

  return newValue === 1;
}

export function bulkSetTags(
  itemIds: number[],
  tagIds: number[],
  action: "add" | "remove"
) {
  if (itemIds.length === 0 || tagIds.length === 0) return;
  const db = getDb();
  const sql =
    action === "add"
      ? "INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)"
      : "DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?";

  const stmt = db.prepare(sql);

  db.transaction((items, tags) => {
    for (const itemId of items) {
      for (const tagId of tags) {
        stmt.run(itemId, tagId);
      }
    }
  })(itemIds, tagIds);
}

export function bulkSetContentType(
  itemIds: number[],
  contentType: string | null
) {
  if (itemIds.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE library_items SET content_type = ? WHERE id = ?"
  );

  db.transaction((items) => {
    for (const itemId of items) {
      stmt.run(contentType, itemId);
    }
  })(itemIds);
}

export function bulkAddItemTypes(itemIds: number[], typeIds: number[]) {
  if (!db || itemIds.length === 0 || typeIds.length === 0) return;
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO item_types (item_id, type_id) VALUES (?, ?)"
  );
  db.transaction((items, types) => {
    for (const itemId of items) {
      for (const typeId of types) {
        stmt.run(itemId, typeId);
      }
    }
  })(itemIds, typeIds);
}

export function bulkRemoveItemTypes(itemIds: number[], typeIds: number[]) {
  if (!db || itemIds.length === 0 || typeIds.length === 0) return;
  const stmt = db.prepare(
    "DELETE FROM item_types WHERE item_id = ? AND type_id = ?"
  );
  db.transaction((items, types) => {
    for (const itemId of items) {
      for (const typeId of types) {
        stmt.run(itemId, typeId);
      }
    }
  })(itemIds, typeIds);
}

// --- PAGE VISIBILITY -------------------------------------------------------
export function getHiddenPages(itemId: number): string[] {
  if (!db) return [];
  const rows = db
    .prepare("SELECT page_name FROM page_visibility WHERE item_id = ?")
    .all(itemId) as { page_name: string }[];
  return rows.map((r) => r.page_name);
}

export function getAllHiddenPages(): Record<number, string[]> {
  if (!db) return {};
  const rows = db
    .prepare("SELECT item_id, page_name FROM page_visibility")
    .all() as { item_id: number; page_name: string }[];

  const result: Record<number, string[]> = {};
  for (const row of rows) {
    if (!result[row.item_id]) result[row.item_id] = [];
    result[row.item_id].push(row.page_name);
  }
  return result;
}

export function setPageVisibility(
  itemId: number,
  pageName: string,
  hidden: boolean
) {
  if (!db) return;
  if (hidden) {
    db.prepare(
      "INSERT OR IGNORE INTO page_visibility (item_id, page_name) VALUES (?, ?)"
    ).run(itemId, pageName);
  } else {
    db.prepare(
      "DELETE FROM page_visibility WHERE item_id = ? AND page_name = ?"
    ).run(itemId, pageName);
  }
}

export function clearPageVisibility(itemId?: number) {
  if (!db) return;
  if (itemId !== undefined) {
    db.prepare("DELETE FROM page_visibility WHERE item_id = ?").run(itemId);
  } else {
    db.prepare("DELETE FROM page_visibility").run();
  }
}
