import { getDb } from "../database";

// --- INTERFACES -----------------------------------------------------------

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

export interface TagWithAliases extends Tag {
  category_name: string | null;
  aliases: string[];
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
  `,
    )
    .all() as TagWithCategory[];
}

export function getAllTagsWithAliases(): TagWithAliases[] {
  const tags = getAllTags();
  const tagIds = tags.map((t) => t.id);
  if (tagIds.length === 0) return [];
  const placeholders = tagIds.map(() => "?").join(",");
  const aliasRows = getDb()
    .prepare(
      `SELECT tag_id, alias FROM tag_aliases WHERE tag_id IN (${placeholders}) ORDER BY sort_order ASC`,
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
  `,
    )
    .all({ query, pattern }) as TagWithCategory[];
}

export function createTag(
  name: string,
  categoryId: number | null,
  description: string | null = null,
): Tag {
  const info = getDb()
    .prepare(
      "INSERT INTO tags (name, category_id, description, is_default) VALUES (?, ?, ?, 0)",
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

export function getTagByName(name: string): Tag | null {
  return (
    (getDb()
      .prepare("SELECT * FROM tags WHERE name = ? COLLATE NOCASE")
      .get(name) as Tag) || null
  );
}

export function ensureTag(
  name: string,
  categoryId: number | null = null,
): number {
  const existing = getTagByName(name);
  if (existing) return existing.id;
  const tag = createTag(name, categoryId);
  return tag.id;
}

export function updateTag(id: number, updates: Partial<Tag>) {
  const allowed = ["name", "category_id", "description", "is_default"];
  const fields = Object.keys(updates).filter(
    (k) => k !== "id" && allowed.includes(k),
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
  const db = getDb();
  const maxRow = db
    .prepare(
      "SELECT COALESCE(MAX(sort_order), -1) as max_order FROM tag_aliases WHERE tag_id = ?",
    )
    .get(tagId) as { max_order: number };
  let nextOrder = maxRow.max_order + 1;

  const insert = db.prepare(
    "INSERT OR IGNORE INTO tag_aliases (tag_id, alias, sort_order) VALUES (?, ?, ?)",
  );
  const many = db.transaction((items: string[]) => {
    for (const alias of items) insert.run(tagId, alias, nextOrder++);
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
    .prepare(
      "SELECT alias FROM tag_aliases WHERE tag_id = ? ORDER BY sort_order ASC",
    )
    .all(tagId) as { alias: string }[];
  return rows.map((r) => r.alias);
}
