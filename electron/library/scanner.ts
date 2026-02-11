import * as fs from "fs-extra";
import { join, extname, basename } from "path";
import { getDb, getTagByName, addItemTags } from "../database/database";
import { ArchiveHandler } from "../archives/archive";

const SUPPORTED_ARCHIVES = [".cbz", ".zip", ".cbr", ".rar", ".7z", ".tar"];
const SUPPORTED_IMAGES = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];

export class LibraryScanner {
  private db = getDb();

  async scanPath(path: string) {
    console.log(`Scanning: ${path}`);

    // Ensure path exists
    if (!fs.existsSync(path)) throw new Error("Path does not exist");

    const stats = await fs.stat(path);
    if (stats.isDirectory()) {
      await this.scanDirectory(path, null);
    } else {
      // Single file add?
    }
  }

  private async scanDirectory(path: string, parentId: number | null) {
    // 1. Add current directory as a folder item (unless root? maybe root is just container)
    // Actually, user "adds library" which is a root folder.
    // We can store the root folder itself or its contents.
    // Let's assume we scan contents.

    // First, insert or get SELF (if we want to track folders in DB)
    // For now, let's just find comics.
    // BUT user wants "Folder-based organization". So we MUST track folders.

    let currentFolderId = parentId;

    // If path is NOT the library root (implied by parentId being null for root scan call?),
    // actually we need to handle the structure.
    // Let's assume scanPath is called on a LIBRARY ROOT.
    // We should probably have a "Libraries" table, and items belong to a library?
    // Or just items with NULL parent_id are roots.

    // Simplified: We assume scanDirectory is recursive.

    const entries = await fs.readdir(path, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(path, entry.name);

      if (entry.isDirectory()) {
        // Create folder item
        const folderId = this.upsertItem(fullPath, "folder", parentId);
        // Recurse
        await this.scanDirectory(fullPath, folderId);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (SUPPORTED_ARCHIVES.includes(ext)) {
          // It's a comic book
          const bookId = this.upsertItem(fullPath, "book", parentId);
          // Process metadata (async/lazy?)
          // For now, doing it inline might be slow for massive libraries, but ok for MVP.
          await this.processBookMetadata(bookId, fullPath);
        } else if (SUPPORTED_IMAGES.includes(ext)) {
          // Loose images? User said "Supports common image formats".
          // Often folders of images are treated as a chapter/book.
          // For now, treating individual image files as items?
          // Or ignores loose images unless in specific mode.
          // Let's ignore loose images for now unless requested as "book".
          // Actually, YACReader treats a folder of images as a comic.
          // That logic is complex (folder = book if contains images).
          // Leaving loose images out of DB as individual items for now to keep table small.
        }
      }
    }
  }

  private upsertItem(
    path: string,
    type: "folder" | "book",
    parentId: number | null,
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO library_items (path, type, title, parent_id)
      VALUES (@path, @type, @title, @parentId)
      ON CONFLICT(path) DO UPDATE SET
        title = @title
      RETURNING id
    `);

    const info = stmt.get({
      path,
      type,
      title: basename(path).replace(extname(path), ""), // Simple title
      parentId,
    }) as { id: number };

    return info.id;
  }

  private async processBookMetadata(id: number, path: string) {
    try {
      const handler = await ArchiveHandler.open(path);
      const entries = await handler.getEntries();

      // Update page count
      this.db
        .prepare("UPDATE library_items SET page_count = ? WHERE id = ?")
        .run(entries.length, id);

      // Try to read info.json for tags/metadata
      try {
        const infoBuffer = await handler.getFile("info.json");
        if (infoBuffer) {
          const info = JSON.parse(infoBuffer.toString());
          const tagIds: number[] = [];

          // 1. Process explicit tags array
          if (info.tags && Array.isArray(info.tags)) {
            for (const tagName of info.tags) {
              const tag = getTagByName(tagName);
              if (tag) tagIds.push(tag.id);
            }
          }

          // 2. Process artist/parody as potential tags (e.g. from Hitomi)
          const extraTags = [];
          if (info.artist)
            extraTags.push(
              ...info.artist.split(",").map((s: string) => s.trim()),
            );
          if (info.parody)
            extraTags.push(
              ...info.parody.split(",").map((s: string) => s.trim()),
            );

          for (const extraName of extraTags) {
            if (!extraName) continue;
            const tag = getTagByName(extraName);
            if (tag && !tagIds.includes(tag.id)) {
              tagIds.push(tag.id);
            }
          }

          if (tagIds.length > 0) {
            addItemTags(id, tagIds);
          }
        }
      } catch (e) {
        // info.json might not exist, that's fine
      }

      handler.close();
    } catch (e) {
      console.error(`Failed to process book ${path}:`, e);
    }
  }
}
