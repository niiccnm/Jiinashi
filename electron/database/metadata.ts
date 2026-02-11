import Database from "better-sqlite3";
import { getDb } from "./database";
import {
  Tag,
  TagWithCategory,
  TagWithAliases,
  getAllTags,
} from "./queries/tags";

// --- INTERFACES -----------------------------------------------------------

export interface Category {
  id: number;
  name: string;
  description: string | null;
  is_default: boolean;
}

export interface ContentType {
  id: number;
  name: string;
  description: string | null;
  is_default?: boolean;
}

export interface ContentTypeWithAliases extends ContentType {
  aliases: string[];
}

// --- CATEGORY OPERATIONS ---------------------------------------------------

export function getAllCategories(): Category[] {
  return getDb()
    .prepare("SELECT * FROM categories ORDER BY name ASC")
    .all() as Category[];
}

export function createCategory(
  name: string,
  description: string | null = null,
): Category {
  const info = getDb()
    .prepare(
      "INSERT INTO categories (name, description, is_default) VALUES (?, ?, 0)",
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
    (k) => k !== "id" && allowed.includes(k),
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
    "INSERT OR IGNORE INTO category_aliases (category_id, alias) VALUES (?, ?)",
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

export function ensureCategory(name: string): number {
  const existing = getAllCategories().find(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing.id;
  const cat = createCategory(name, null);
  return cat.id;
}

// --- INITIAL DATA & SEEDING ------------------------------------------------

export function initDefaultCategories(
  db: Database.Database,
  shouldImport: boolean,
) {
  if (!shouldImport) return;

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
    "INSERT OR IGNORE INTO categories (name, is_default) VALUES (?, 1)",
  );
  for (const cat of defaultCategories) insertCat.run(cat);

  const updateCatDefault = db.prepare(
    "UPDATE categories SET is_default = 1 WHERE name = ?",
  );
  for (const cat of defaultCategories) updateCatDefault.run(cat);

  // 2. Category Aliases
  const defaultCategoryMeta: Record<string, { keywords?: string[] }> = {
    Copyright: { keywords: ["Parody"] },
  };

  const insertCatAlias = db.prepare(
    "INSERT OR IGNORE INTO category_aliases (category_id, alias) VALUES (?, ?)",
  );
  const findCatId = db.prepare("SELECT id FROM categories WHERE name = ?");

  for (const catName of defaultCategories) {
    const meta = defaultCategoryMeta[catName];
    if (meta?.keywords) {
      const catRow = findCatId.get(catName) as { id: number } | undefined;
      if (catRow) {
        for (const keyword of meta.keywords) {
          insertCatAlias.run(catRow.id, keyword);
        }
      }
    }
  }
}

// --- CONTENT TYPE OPERATIONS -----------------------------------------------

export function getAllTypes(): ContentType[] {
  return getDb()
    .prepare("SELECT * FROM content_types ORDER BY name")
    .all() as ContentType[];
}

export function getAllTypesWithAliases(): ContentTypeWithAliases[] {
  const types = getAllTypes();
  return types.map((type) => ({
    ...type,
    aliases: getTypeAliases(type.id),
  }));
}

export function getTypeByName(name: string): ContentType | null {
  return (
    (getDb()
      .prepare("SELECT * FROM content_types WHERE name = ? COLLATE NOCASE")
      .get(name) as ContentType) || null
  );
}

export function getTypeById(id: number): ContentType | null {
  return (
    (getDb()
      .prepare("SELECT * FROM content_types WHERE id = ?")
      .get(id) as ContentType) || null
  );
}

export function createType(
  name: string,
  description: string | null,
): ContentType {
  const result = getDb()
    .prepare(
      "INSERT INTO content_types (name, description, is_default) VALUES (?, ?, 0)",
    )
    .run(name, description);
  return {
    id: result.lastInsertRowid as number,
    name,
    description,
    is_default: false,
  };
}

export function ensureContentType(name: string): number {
  const existing = getAllTypes().find(
    (t) => t.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing.id;
  const type = createType(name, null);
  return type.id;
}

export function updateType(id: number, updates: Partial<ContentType>) {
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

  getDb()
    .prepare(`UPDATE content_types SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values);
}

export function deleteType(id: number) {
  getDb().prepare("DELETE FROM content_types WHERE id = ?").run(id);
}

export function getTypeAliases(typeId: number): string[] {
  const rows = getDb()
    .prepare("SELECT alias FROM type_aliases WHERE type_id = ?")
    .all(typeId) as { alias: string }[];
  return rows.map((r) => r.alias);
}

export function addTypeAliases(typeId: number, aliases: string[]) {
  if (aliases.length === 0) return;
  const stmt = getDb().prepare(
    "INSERT OR IGNORE INTO type_aliases (type_id, alias) VALUES (?, ?)",
  );
  for (const alias of aliases) {
    stmt.run(typeId, alias.trim());
  }
}

export function removeTypeAlias(typeId: number, alias: string) {
  getDb()
    .prepare("DELETE FROM type_aliases WHERE type_id = ? AND alias = ?")
    .run(typeId, alias);
}

export function initDefaultTypes(db: Database.Database, shouldImport: boolean) {
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
    "INSERT OR IGNORE INTO content_types (name, description, is_default) VALUES (?, ?, 1)",
  );
  for (const type of defaultTypes) insertType.run(type.name, type.description);
  const updateDefault = db.prepare(
    "UPDATE content_types SET is_default = 1 WHERE name = ?",
  );
  for (const type of defaultTypes) updateDefault.run(type.name);
}

export function migrateContentTypes(db: Database.Database) {
  try {
    const count = db
      .prepare("SELECT COUNT(*) as count FROM item_types")
      .get() as { count: number };
    if (count.count > 0) return;
    const items = db
      .prepare(
        "SELECT id, content_type FROM library_items WHERE content_type IS NOT NULL AND content_type != ''",
      )
      .all() as { id: number; content_type: string }[];
    if (items.length === 0) return;
    const insertItemType = db.prepare(
      "INSERT OR IGNORE INTO item_types (item_id, type_id) VALUES (?, ?)",
    );
    const findType = db.prepare(
      "SELECT id FROM content_types WHERE name = ? COLLATE NOCASE",
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
      })`,
    )
    .all(options.includeDefaultTags ? 1 : 0) as Category[];
  const tags = db_local
    .prepare(
      `SELECT t.*, c.name as category_name FROM tags t LEFT JOIN categories c ON t.category_id = c.id WHERE (? = 1 OR t.is_default = 0) AND (t.category_id IS NULL OR t.category_id NOT IN (${
        options.excludedCategoryIds.length > 0
          ? options.excludedCategoryIds.join(",")
          : "-1"
      }))`,
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
      })) AND EXISTS (SELECT 1 FROM item_types it2 WHERE it2.item_id = it.item_id AND it2.type_id NOT IN (${excludedTypeIdsSql}))`,
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
        `SELECT * FROM content_types WHERE (? = 1 OR is_default = 0) AND id NOT IN (${excludedTypeIdsSql})`,
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
        `SELECT it.item_id, ct.name as type_name, li.path FROM item_types it JOIN content_types ct ON it.type_id = ct.id JOIN library_items li ON it.item_id = li.id WHERE (? = 1 OR ct.is_default = 0) AND ct.id NOT IN (${excludedTypeIdsSql}) AND EXISTS (SELECT 1 FROM item_types it3 WHERE it3.item_id = it.item_id AND it3.type_id NOT IN (${excludedTypeIdsSql}))`,
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
