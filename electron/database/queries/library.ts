import { getDb, LibraryItem, SearchResult } from "../database";
import { ContentType } from "../metadata";
import { TagWithCategory } from "./tags";

// --- LIBRARY OPERATIONS ----------------------------------------------------
export function getAllItems(
  parentId: number | null = null,
  rootPath?: string,
): LibraryItem[] {
  let whereClause =
    parentId === null ? "li.parent_id IS NULL" : "li.parent_id = ?";
  const params: any[] = parentId === null ? [] : [parentId];

  if (rootPath) {
    whereClause += " AND (li.path LIKE ? OR li.path = ?)";
    const normalizedRoot = rootPath.replace(/\\/g, "/");
    params.push(`${normalizedRoot}/%`, normalizedRoot);
  }

  const sql = `
    SELECT li.*, 
    GROUP_CONCAT(DISTINCT t.name) as tags_list,
    GROUP_CONCAT(DISTINCT ct.name) as types_list
    FROM library_items li
    LEFT JOIN item_tags it ON li.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    LEFT JOIN item_types it2 ON li.id = it2.item_id
    LEFT JOIN content_types ct ON it2.type_id = ct.id
    WHERE ${whereClause}
    GROUP BY li.id
  `;

  const stmt = getDb().prepare(sql);
  const items = stmt.all(...params) as LibraryItem[];

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
  `,
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
  `,
    )
    .get(id) as LibraryItem | undefined;
}

export function getAllFolders(): LibraryItem[] {
  return getDb()
    .prepare("SELECT * FROM library_items WHERE type = 'folder'")
    .all() as LibraryItem[];
}

export function getDescendants(parentId: number): LibraryItem[] {
  return getDb()
    .prepare(
      `
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM library_items WHERE parent_id = ?
        UNION ALL
        SELECT li.id
        FROM library_items li
        JOIN descendants d ON li.parent_id = d.id
      )
      SELECT * FROM library_items WHERE id IN (SELECT id FROM descendants)
    `,
    )
    .all(parentId) as LibraryItem[];
}

export function getTotalBookCount(rootPath?: string): number {
  let sql =
    "SELECT COUNT(*) as count FROM library_items WHERE type != 'folder'";
  const params: any[] = [];

  if (rootPath) {
    sql += " AND (path LIKE ? OR path = ?)";
    const normalized = rootPath.replace(/\\/g, "/");
    params.push(`${normalized}/%`, normalized);
  }

  const row = getDb()
    .prepare(sql)
    .get(...params) as { count: number };
  return row.count;
}

export function searchItems(
  query: string,
  options?: { rootPath?: string; favoritesOnly?: boolean },
): LibraryItem[] {
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

  if (options?.favoritesOnly) {
    whereClauses.push("li.is_favorite = 1");
  }

  if (options?.rootPath) {
    whereClauses.push("(li.path LIKE ? OR li.path = ?)");
    const normalizedRoot = options.rootPath.replace(/\\/g, "/");
    params.push(`${normalizedRoot}/%`, normalizedRoot);
  }

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

  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(" AND ")}`;
  }

  // Optimization: Sort and Limit
  sql += ` GROUP BY li.id ORDER BY li.type DESC, li.title ASC`;

  // Metadata is enriched directly in the query; no secondary queries needed.
  return getDb()
    .prepare(sql)
    .all(...params) as LibraryItem[];
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
        is_favorite = @is_favorite,
        content_type = @content_type
      WHERE id = @id
    `);

    stmt.run({
      ...item,
      path: normalizedPath,
      id: existing.id,
      is_favorite: item.is_favorite ? 1 : 0,
      content_type:
        (item as any).content_type || (item as any).contentType || null,
    });
    return existing.id;
  }

  const stmt = getDb().prepare(`
    INSERT INTO library_items (path, title, type, page_count, cover_path, parent_id, is_favorite, reading_status, current_page, last_read_at, content_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    item.last_read_at,
    (item as any).content_type || (item as any).contentType || null,
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
    (k) => k !== "id" && allowed.includes(k),
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
    `,
    )
    .run(id);
}

export function clearAllItems() {
  getDb().prepare("DELETE FROM library_items").run();
}

export function getFavorites(rootPath?: string): LibraryItem[] {
  try {
    let whereClause = "li.is_favorite = 1";
    const params: any[] = [];

    if (rootPath) {
      whereClause += " AND (li.path LIKE ? OR li.path = ?)";
      const normalizedRoot = rootPath.replace(/\\/g, "/");
      params.push(`${normalizedRoot}/%`, normalizedRoot);
    }

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
      WHERE ${whereClause}
      GROUP BY li.id
      ORDER BY li.type DESC, li.title ASC
    `,
      )
      .all(...params) as LibraryItem[];
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
      `,
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
  updateTimestamp: boolean = true,
): string | null {
  const existing = getDb()
    .prepare(
      "SELECT last_read_at, current_page FROM library_items WHERE id = ?",
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
    currentPage > existing.current_page,
  );

  const shouldTouchTimestamp = Boolean(
    updateTimestamp ||
    isForwardChange ||
    (existing &&
      existing.last_read_at === null &&
      existing.current_page !== currentPage),
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
      "UPDATE library_items SET last_read_at = NULL, current_page = 0 WHERE id = ?",
    )
    .run(id);
}

export function deleteItemsByRoot(rootPath: string): void {
  const db = getDb();
  try {
    let normalizedRoot = rootPath.replace(/\\/g, "/");
    if (!normalizedRoot.endsWith("/")) normalizedRoot += "/";

    const itemsToDelete = db
      .prepare(
        `
      SELECT id 
      FROM library_items 
      WHERE replace(path, '\\', '/') LIKE ? || '%'
    `,
      )
      .all(normalizedRoot) as { id: number }[];

    if (itemsToDelete.length > 0) {
      const ids = itemsToDelete.map((i) => i.id);
      db.prepare(
        `DELETE FROM library_items WHERE id IN (${ids.join(",")})`,
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
    "INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)",
  );
  const many = getDb().transaction((ids) => {
    for (const tid of ids) insert.run(itemId, tid);
  });
  many(tagIds);
}

export function removeItemTags(itemId: number, tagIds: number[]) {
  const del = getDb().prepare(
    "DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?",
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
  `,
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
  `,
    )
    .all(...itemIds, itemIds.length) as TagWithCategory[];
}

export function getItemTypes(itemId: number): ContentType[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT ct.* FROM content_types ct
       JOIN item_types it ON ct.id = it.type_id
       WHERE it.item_id = ?
       ORDER BY ct.name`,
    )
    .all(itemId) as ContentType[];
}

export function addItemTypes(itemId: number, typeIds: number[]) {
  const db = getDb();
  if (typeIds.length === 0) return;
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO item_types (item_id, type_id) VALUES (?, ?)",
  );
  for (const typeId of typeIds) {
    stmt.run(itemId, typeId);
  }
}

export function removeItemTypes(itemId: number, typeIds: number[]) {
  const db = getDb();
  if (typeIds.length === 0) return;
  const stmt = db.prepare(
    "DELETE FROM item_types WHERE item_id = ? AND type_id = ?",
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
    "UPDATE library_items SET is_favorite = ? WHERE id = ?",
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
  action: "add" | "remove",
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
  contentType: string | null,
) {
  if (itemIds.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE library_items SET content_type = ? WHERE id = ?",
  );

  db.transaction((items) => {
    for (const itemId of items) {
      stmt.run(contentType, itemId);
    }
  })(itemIds);
}

export function bulkAddItemTypes(itemIds: number[], typeIds: number[]) {
  const db = getDb();
  if (itemIds.length === 0 || typeIds.length === 0) return;
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO item_types (item_id, type_id) VALUES (?, ?)",
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
  const db = getDb();
  if (itemIds.length === 0 || typeIds.length === 0) return;
  const stmt = db.prepare(
    "DELETE FROM item_types WHERE item_id = ? AND type_id = ?",
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
  const db = getDb();
  const rows = db
    .prepare("SELECT page_name FROM page_visibility WHERE item_id = ?")
    .all(itemId) as { page_name: string }[];
  return rows.map((r) => r.page_name);
}

export function getAllHiddenPages(): Record<number, string[]> {
  const db = getDb();
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
  hidden: boolean,
) {
  const db = getDb();
  if (hidden) {
    db.prepare(
      "INSERT OR IGNORE INTO page_visibility (item_id, page_name) VALUES (?, ?)",
    ).run(itemId, pageName);
  } else {
    db.prepare(
      "DELETE FROM page_visibility WHERE item_id = ? AND page_name = ?",
    ).run(itemId, pageName);
  }
}

export function clearPageVisibility(itemId?: number) {
  const db = getDb();
  if (itemId !== undefined) {
    db.prepare("DELETE FROM page_visibility WHERE item_id = ?").run(itemId);
  } else {
    db.prepare("DELETE FROM page_visibility").run();
  }
}

// --- ORPHAN CLEANUP OPERATIONS ---------------------------------------------
export function incrementMissCount(id: number) {
  getDb()
    .prepare(
      "UPDATE library_items SET miss_count = COALESCE(miss_count, 0) + 1 WHERE id = ?",
    )
    .run(id);
}

export function resetMissCount(id: number) {
  getDb()
    .prepare("UPDATE library_items SET miss_count = 0 WHERE id = ?")
    .run(id);
}

export function resetMissCountBulk(ids: number[]) {
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `UPDATE library_items SET miss_count = 0 WHERE id IN (${placeholders})`,
  ).run(...ids);
}

export function getOrphanedItems(threshold: number): LibraryItem[] {
  return getDb()
    .prepare("SELECT * FROM library_items WHERE miss_count >= ?")
    .all(threshold) as LibraryItem[];
}
