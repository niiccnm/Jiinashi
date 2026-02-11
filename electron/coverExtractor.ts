import StreamZip from "node-stream-zip";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { app, nativeImage } from "electron";
import { ArchiveHandler } from "./archives/archive";

// Lazy initialization for cover cache directory
let _coverCacheDir: string | null = null;

function getCoverCacheDir(): string {
  if (!_coverCacheDir) {
    _coverCacheDir = path.join(app.getPath("userData"), "covers");
  }
  return _coverCacheDir;
}

// Supported image extensions for covers
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

/** Initialize cover cache directory */
export function initCoverCache(): void {
  const dir = getCoverCacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Generate path hash for cover filename */
function getPathHash(filePath: string): string {
  return crypto.createHash("md5").update(filePath).digest("hex");
}

/** Get cached cover path */
export function getCoverCachePath(archivePath: string): string {
  const hash = getPathHash(archivePath);
  return path.join(getCoverCacheDir(), `${hash}.jpg`);
}

/** Check if cover is cached */
export function isCoverCached(archivePath: string): boolean {
  const coverPath = getCoverCachePath(archivePath);
  return fs.existsSync(coverPath);
}

/** Extract first image from ZIP/CBZ as cover */
export async function extractCoverFromZip(
  archivePath: string,
): Promise<string | null> {
  try {
    const hash = getPathHash(archivePath);
    const cacheDir = getCoverCacheDir();
    const jpgPath = path.join(cacheDir, `${hash}.jpg`);
    const gifPath = path.join(cacheDir, `${hash}.gif`);
    const webpPath = path.join(cacheDir, `${hash}.webp`);

    // 1. Check existing cache
    if (fs.existsSync(gifPath)) return gifPath;
    if (fs.existsSync(webpPath)) return webpPath;

    // 2. Check zip for animated formats (healing mode)

    const zip = new StreamZip.async({ file: archivePath });
    const entries = await zip.entries();
    const entryList = Object.values(entries);

    const imageEntries = entryList
      .filter((e) => {
        if (e.isDirectory) return false;
        return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(e.name);
      })
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );

    if (imageEntries.length === 0) {
      console.warn(`[CoverExtractor] No images found in ZIP: ${archivePath}`);
      if (entryList.length > 0) {
        console.warn(
          `[CoverExtractor] Entries sample:`,
          entryList.slice(0, 5).map((e) => e.name),
        );
      }
      await zip.close();
      return null;
    }

    const firstEntry = imageEntries[0];
    const ext = path.extname(firstEntry.name).toLowerCase();

    // Animated format handling
    if (ext === ".gif" || ext === ".webp") {
      const imageBuffer = await zip.entryData(firstEntry.name);
      await zip.close();

      if (imageBuffer) {
        const finalPath = ext === ".gif" ? gifPath : webpPath;
        fs.writeFileSync(finalPath, imageBuffer);

        // Cleanup stale JPG if it exists
        if (fs.existsSync(jpgPath)) {
          try {
            fs.unlinkSync(jpgPath);
          } catch (e) {}
        }
        return finalPath;
      }
    }

    // Use cached JPG if not animated
    if (fs.existsSync(jpgPath)) {
      await zip.close();
      return jpgPath;
    }

    // Extract non-animated image
    const imageBuffer = await zip.entryData(firstEntry.name);
    await zip.close();

    if (!imageBuffer) return null;

    // Convert to JPG
    const image = nativeImage.createFromBuffer(imageBuffer);

    if (image.isEmpty()) {
      console.warn(
        `[CoverExtractor] nativeImage failed to load buffer for ${archivePath} (Entry: ${firstEntry.name}). Using raw buffer.`,
      );
      fs.writeFileSync(jpgPath, imageBuffer);
      return jpgPath;
    }

    const size = image.getSize();
    const maxHeight = 600;

    let finalBuffer: Buffer;
    if (size.height > maxHeight) {
      const newWidth = Math.round(size.width * (maxHeight / size.height));
      const resized = image.resize({
        height: maxHeight,
        width: newWidth,
        quality: "best",
      });
      finalBuffer = resized.toJPEG(80);
    } else {
      finalBuffer = image.toJPEG(80);
    }

    fs.writeFileSync(jpgPath, finalBuffer);
    return jpgPath;
  } catch (error) {
    console.error("Failed to extract cover from:", archivePath, error);
    return null;
  }
}

export async function extractCoverFromRar(
  archivePath: string,
): Promise<string | null> {
  try {
    const hash = getPathHash(archivePath);
    const cacheDir = getCoverCacheDir();
    const jpgPath = path.join(cacheDir, `${hash}.jpg`);
    const gifPath = path.join(cacheDir, `${hash}.gif`);
    const webpPath = path.join(cacheDir, `${hash}.webp`);

    // 1. Check existing cache
    if (fs.existsSync(gifPath)) return gifPath;
    if (fs.existsSync(webpPath)) return webpPath;
    if (fs.existsSync(jpgPath)) return jpgPath;

    const handler = await ArchiveHandler.open(archivePath);
    const entries = await handler.getEntries();

    // Filter images
    const imageEntries = entries.filter((name) =>
      /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name),
    );

    if (imageEntries.length === 0) {
      console.warn(`[CoverExtractor] No images found in RAR: ${archivePath}`);
      console.warn(`[CoverExtractor] Entries sample:`, entries.slice(0, 5));
      handler.close();
      return null;
    }

    const firstEntryName = imageEntries[0];
    const ext = path.extname(firstEntryName).toLowerCase();
    const buffer = await handler.getFile(firstEntryName);
    handler.close();

    if (!buffer) return null;

    // Animated format handling
    if (ext === ".gif" || ext === ".webp") {
      const finalPath = ext === ".gif" ? gifPath : webpPath;
      fs.writeFileSync(finalPath, buffer);
      // Cleanup stale JPG if exists
      if (fs.existsSync(jpgPath)) {
        try {
          fs.unlinkSync(jpgPath);
        } catch (e) {}
      }
      return finalPath;
    }

    // Convert to JPG
    const image = nativeImage.createFromBuffer(buffer);

    if (image.isEmpty()) {
      console.warn(
        `[CoverExtractor] nativeImage failed to load RAR buffer for ${archivePath}. Using raw buffer.`,
      );
      fs.writeFileSync(jpgPath, buffer);
      return jpgPath;
    }

    const size = image.getSize();
    const maxHeight = 600;

    let finalBuffer: Buffer;
    if (size.height > maxHeight) {
      const newWidth = Math.round(size.width * (maxHeight / size.height));
      const resized = image.resize({
        height: maxHeight,
        width: newWidth,
        quality: "best",
      });
      finalBuffer = resized.toJPEG(80);
    } else {
      finalBuffer = image.toJPEG(80);
    }

    fs.writeFileSync(jpgPath, finalBuffer);
    return jpgPath;
  } catch (error) {
    console.error("Failed to extract RAR cover:", archivePath, error);
    return null;
  }
}

/** Extract cover from any supported archive */
export async function extractCover(
  archivePath: string,
): Promise<string | null> {
  const ext = path.extname(archivePath).toLowerCase();

  if (ext === ".cbz" || ext === ".zip") {
    return extractCoverFromZip(archivePath);
  }

  if (ext === ".rar" || ext === ".cbr" || ext === ".7z" || ext === ".cb7") {
    return extractCoverFromRar(archivePath);
  }

  // Image files are their own covers
  if (IMAGE_EXTENSIONS.includes(ext)) {
    return archivePath;
  }

  if (ext === ".pdf") {
    // PDF covers require heavy deps, using generic for now but page count is ok
    console.log(
      `[CoverExtractor] PDF cover extraction not yet fully implemented: ${archivePath}`,
    );
    return null;
  }

  console.warn(`Cover extraction not yet supported for: ${ext}`);
  return null;
}

/** Get cover for a folder using its first book */
export async function extractCoverFromFolder(
  folderPath: string,
): Promise<string | null> {
  try {
    const files = fs.readdirSync(folderPath);
    const supportedExtensions = [
      ".cbz",
      ".zip",
      ".cbr",
      ".rar",
      ".cb7",
      ".7z",
      ".pdf",
      ...IMAGE_EXTENSIONS,
    ];

    // Sort files naturally
    const sortedFiles = files.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );

    // Find first supported file
    for (const file of sortedFiles) {
      const filePath = path.join(folderPath, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile()) {
        const ext = path.extname(file).toLowerCase();
        if (supportedExtensions.includes(ext)) {
          return extractCover(filePath);
        }
      }
    }

    // If no files found, check subdirectories
    for (const file of sortedFiles) {
      const filePath = path.join(folderPath, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        const cover = await extractCoverFromFolder(filePath);
        if (cover) return cover;
      }
    }

    return null;
  } catch (error) {
    console.error("Failed to extract cover from folder:", folderPath, error);
    return null;
  }
}

/** Delete cached cover */
export function deleteCachedCover(archivePath: string): void {
  const coverPath = getCoverCachePath(archivePath);
  if (fs.existsSync(coverPath)) {
    fs.unlinkSync(coverPath);
  }
}

/** Get cover as base64 data URL */
export function getCoverAsDataUrl(coverPath: string): string | null {
  try {
    if (!fs.existsSync(coverPath)) {
      return null;
    }

    const buffer = fs.readFileSync(coverPath);
    const ext = path.extname(coverPath).toLowerCase();

    let mimeType = "image/jpeg";
    if (ext === ".png") mimeType = "image/png";
    else if (ext === ".gif") mimeType = "image/gif";
    else if (ext === ".webp") mimeType = "image/webp";
    else if (ext === ".bmp") mimeType = "image/bmp";

    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.error("Failed to read cover:", coverPath, error);
    return null;
  }
}

/** Clear all cached covers */
export function clearCoverCache(): void {
  const dir = getCoverCacheDir();
  if (fs.existsSync(dir)) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        fs.unlinkSync(path.join(dir, file));
      }
      console.log("Cover cache cleared");
    } catch (error) {
      console.error("Failed to clear cover cache:", error);
    }
  }
}
