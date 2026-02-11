import { getDb } from "../database";

// --- DOWNLOAD HISTORY OPERATIONS -------------------------------------------
export function addDownloadHistory(entry: {
  url: string;
  title: string;
  status: string;
  source: string;
  cover_url: string;
  artist?: string;
  parody?: string;
  content_type?: string;
}): number {
  const info = getDb()
    .prepare(
      "INSERT INTO download_history (url, title, status, source, cover_url, artist, parody, content_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      entry.url,
      entry.title,
      entry.status,
      entry.source,
      entry.cover_url,
      entry.artist || null,
      entry.parody || null,
      entry.content_type || null,
    );
  return info.lastInsertRowid as number;
}

export function updateDownloadHistory(
  id: number,
  updates: Partial<{
    status: string;
    title: string;
    source: string;
    cover_url: string;
    completed_at: string;
    file_path: string;
    error_message: string;
    artist: string;
    parody: string;
    content_type: string;
  }>,
) {
  const fields = Object.keys(updates);
  if (fields.length === 0) return;
  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => (updates as any)[f]);
  getDb()
    .prepare(`UPDATE download_history SET ${setClause} WHERE id = ?`)
    .run(...values, id);
}

export function getDownloadHistory(limit: number = 50) {
  return getDb()
    .prepare("SELECT * FROM download_history ORDER BY added_at DESC LIMIT ?")
    .all(limit);
}

export function getAllDownloadHistory() {
  return getDb()
    .prepare("SELECT * FROM download_history ORDER BY added_at DESC")
    .all() as any[];
}

export function getDownloadHistoryItem(id: number) {
  return getDb()
    .prepare("SELECT * FROM download_history WHERE id = ?")
    .get(id) as any;
}

export function getDownloadHistoryByPath(filePath: string) {
  const norm = filePath.replace(/\\/g, "/");
  return getDb()
    .prepare(
      "SELECT * FROM download_history WHERE replace(file_path, '\\', '/') = ? COLLATE NOCASE",
    )
    .get(norm) as any;
}

export function clearDownloadHistory() {
  getDb().prepare("DELETE FROM download_history").run();
  adjustHistorySequence();
}

export function pruneDownloadHistory(limit: number) {
  getDb()
    .prepare(
      "DELETE FROM download_history WHERE id NOT IN (SELECT id FROM download_history ORDER BY added_at DESC LIMIT ?)",
    )
    .run(limit);
  adjustHistorySequence();
}

export function removeDownloadHistoryItem(id: number) {
  getDb().prepare("DELETE FROM download_history WHERE id = ?").run(id);
  adjustHistorySequence();
}

export function saveDownloadLogs(id: number, logs: string[]) {
  const logsJson = JSON.stringify(logs);
  getDb()
    .prepare("UPDATE download_history SET logs = ? WHERE id = ?")
    .run(logsJson, id);
}

function adjustHistorySequence() {
  try {
    getDb()
      .prepare(
        "UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id), 0) FROM download_history) WHERE name = 'download_history'",
      )
      .run();
  } catch (e) {
    console.error("Failed to adjust history sequence:", e);
  }
}

export function getDownloadLogs(id: number): string[] {
  const row = getDb()
    .prepare("SELECT logs FROM download_history WHERE id = ?")
    .get(id) as { logs: string | null } | undefined;
  if (!row?.logs) return [];
  try {
    return JSON.parse(row.logs);
  } catch (e) {
    console.error("Failed to parse logs from database:", e);
    return [];
  }
}

export function getLatestDownloadHistoryByUrl(url: string) {
  return getDb()
    .prepare(
      "SELECT * FROM download_history WHERE url = ? ORDER BY added_at DESC LIMIT 1",
    )
    .get(url) as any;
}

export function getDownloadsForQueue() {
  return getDb()
    .prepare(
      "SELECT * FROM download_history WHERE hidden_from_queue = 0 OR hidden_from_queue IS NULL ORDER BY added_at ASC",
    )
    .all() as any[];
}

export function hideFromQueue(id: number) {
  getDb()
    .prepare("UPDATE download_history SET hidden_from_queue = 1 WHERE id = ?")
    .run(id);
}

export function updateDownloadProgress(
  id: number,
  downloaded: number,
  total: number,
  percent: number,
) {
  getDb()
    .prepare(
      "UPDATE download_history SET downloaded_images = ?, total_images = ?, progress_percent = ? WHERE id = ?",
    )
    .run(downloaded, total, percent, id);
}
