import { nativeImage, app } from "electron";
import path from "path";
import fs from "fs";
import sharp from "sharp";

/**
 * Normalizes a URL to a standard format
 */
export function normalizeUrl(url: string): string {
  let norm = url.trim().replace(/\/+$/, "");
  if (norm.includes("nhentai.net/g/")) {
    const match = norm.match(/nhentai\.net\/g\/(\d+)/);
    if (match) return `https://nhentai.net/g/${match[1]}`;
  }
  if (norm.includes("hitomi.la/")) {
    const idMatch =
      norm.match(/-(\d+)\.html(?:$|#|\?)/) ||
      norm.match(
        /\/(?:reader|manga|doujinshi|cg|gamecg|artistcg|imageset|galleries)\/(\d+)/,
      ) ||
      norm.match(/\D(\d{6,7})\D/) ||
      norm.match(/^(\d{6,7})$/);

    if (idMatch) {
      const id = idMatch[1];
      return `https://hitomi.la/galleries/${id}.html`;
    }
  }
  return norm;
}

/**
 * Truncates a title to ensure it fits within OS path limits
 */
export function truncateTitle(
  title: string,
  downloadPath: string,
  ext: string,
): string {
  const absoluteDownloadPath = path.resolve(downloadPath);
  const maxSafeTitleLength = 255 - absoluteDownloadPath.length - 1 - ext.length;
  if (title.length > maxSafeTitleLength) {
    return title.slice(0, Math.max(50, maxSafeTitleLength)).trim();
  }
  return title;
}

/**
 * Formats bytes to a human readable string
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes,
    idx = 0;
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024;
    idx++;
  }
  return `${idx === 0 ? v : v.toFixed(2)} ${units[idx]}`;
}

/**
 * Formats milliseconds to a human readable string
 */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Formats bits per second to a human readable speed string
 */
export function formatSpeed(bps: number): string {
  const kb = 1024,
    mb = kb * 1024;
  if (bps >= mb) return `${(bps / mb).toFixed(2)} MB/s`;
  if (bps >= kb) return `${(bps / kb).toFixed(1)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

/**
 * Gets image dimensions in a safe way
 */
export function getImageDimsSafe(filePath: string): string {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (!img.isEmpty()) {
      const s = img.getSize();
      if (s?.width && s?.height) return `${s.width}x${s.height}`;
    }
  } catch (e) {}
  return "?";
}

/**
 * Converts a WebP image to JPG format
 */
export async function convertWebpToJpgAsync(
  webpPath: string,
): Promise<string | null> {
  try {
    if (!fs.existsSync(webpPath)) return null;
    const jpgPath = webpPath.replace(/\.webp$/i, ".jpg");
    sharp.cache(false);
    await sharp(webpPath)
      .jpeg({ quality: 100, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toFile(jpgPath);
    for (let i = 0; i < 5; i++) {
      try {
        if (fs.existsSync(webpPath)) fs.unlinkSync(webpPath);
        break;
      } catch (e) {
        await new Promise((r) => setTimeout(r, 200 * (i + 1)));
      }
    }
    return jpgPath;
  } catch (e) {
    return null;
  }
}
