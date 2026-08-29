import fs from "fs";
import path from "path";
import StreamZip from "node-stream-zip";
import { ArchiveHandler } from "./archives/archive";
import type { IArchiveHandler } from "./archives/archive";

interface CachedArchive {
  path: string;
  zip?: any;
  rar?: IArchiveHandler;
  zipImageEntries?: string[];
  rarEntries?: string[];
  lastAccessed: number;
  timer: NodeJS.Timeout;
}

type ReaderPagePayload = {
  data: Buffer;
  totalPages: number;
  width?: number;
  height?: number;
  name?: string;
};

type ReaderPageInfoPayload = Pick<ReaderPagePayload, "width" | "height">;

const ARCHIVE_CACHE_TIMEOUT = 60 * 1000; // 1 minute
const archiveCache = new Map<string, CachedArchive>();

function getImageDimensions(
  buffer: Buffer,
  ext: string,
): { width: number; height: number } | null {
  try {
    const e = ext.toLowerCase();

    if (e === ".png") {
      if (buffer.length < 24) return null;
      if (
        buffer[0] !== 0x89 ||
        buffer[1] !== 0x50 ||
        buffer[2] !== 0x4e ||
        buffer[3] !== 0x47
      ) {
        return null;
      }
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }

    if (e === ".gif") {
      if (buffer.length < 10) return null;
      if (buffer.toString("ascii", 0, 3) !== "GIF") return null;
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }

    if (e === ".webp") {
      if (buffer.length < 30) return null;
      if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
      if (buffer.toString("ascii", 8, 12) !== "WEBP") return null;

      let offset = 12;
      while (offset + 8 <= buffer.length) {
        const chunkType = buffer.toString("ascii", offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const chunkData = offset + 8;
        if (chunkType === "VP8X") {
          if (chunkData + 10 > buffer.length) return null;
          const widthMinus1 = buffer.readUIntLE(chunkData + 4, 3);
          const heightMinus1 = buffer.readUIntLE(chunkData + 7, 3);
          const width = widthMinus1 + 1;
          const height = heightMinus1 + 1;
          if (width > 0 && height > 0) return { width, height };
          return null;
        }
        const padded = chunkSize + (chunkSize % 2);
        offset = chunkData + padded;
      }
      return null;
    }

    if (e === ".jpg" || e === ".jpeg") {
      if (buffer.length < 4) return null;
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
      let i = 2;
      while (i + 1 < buffer.length) {
        if (buffer[i] !== 0xff) {
          i += 1;
          continue;
        }
        while (i < buffer.length && buffer[i] === 0xff) i += 1;
        if (i >= buffer.length) break;
        const marker = buffer[i];
        i += 1;

        if (marker === 0xd9 || marker === 0xda) break;
        if (i + 1 >= buffer.length) break;
        const len = buffer.readUInt16BE(i);
        if (len < 2) return null;

        const isSOF =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);

        if (isSOF) {
          if (i + 7 >= buffer.length) return null;
          const height = buffer.readUInt16BE(i + 3);
          const width = buffer.readUInt16BE(i + 5);
          if (width > 0 && height > 0) return { width, height };
          return null;
        }

        i += len;
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

function getCachedArchive(archivePath: string): CachedArchive | null {
  const cached = archiveCache.get(archivePath);
  if (cached) {
    clearTimeout(cached.timer);
    cached.timer = setTimeout(
      () => closeCachedArchive(archivePath),
      ARCHIVE_CACHE_TIMEOUT,
    );
    cached.lastAccessed = Date.now();
    return cached;
  }
  return null;
}

function cacheArchive(
  archivePath: string,
  zip?: any,
  rar?: IArchiveHandler,
  zipImageEntries?: string[],
  rarEntries?: string[],
) {
  const existing = archiveCache.get(archivePath);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(
    () => closeCachedArchive(archivePath),
    ARCHIVE_CACHE_TIMEOUT,
  );

  archiveCache.set(archivePath, {
    path: archivePath,
    zip,
    rar,
    zipImageEntries,
    rarEntries,
    lastAccessed: Date.now(),
    timer,
  });
}

async function getZipImageEntries(zip: any): Promise<string[]> {
  const entries = await zip.entries();
  return Object.values(entries)
    .filter(
      (e) =>
        /\.(jpg|jpeg|png|gif|webp)$/i.test((e as any).name) &&
        !(e as any).isDirectory,
    )
    .map((e) => (e as any).name as string)
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
}

async function getZipReaderArchive(archivePath: string) {
  const cached = getCachedArchive(archivePath);
  const zip =
    cached?.zip ?? new StreamZip.async({ file: archivePath });
  if (!cached?.zip) cacheArchive(archivePath, zip, undefined);

  const activeCache = getCachedArchive(archivePath);
  let imageEntries = activeCache?.zipImageEntries;
  if (!imageEntries) {
    imageEntries = await getZipImageEntries(zip);
    if (activeCache) activeCache.zipImageEntries = imageEntries;
  }
  return { zip, imageEntries };
}

async function readZipImageDimensions(
  zip: any,
  entryName: string,
): Promise<ReaderPageInfoPayload | null> {
  const stream = await zip.stream(entryName);
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let dimensions: ReaderPageInfoPayload | null = null;

  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
      totalBytes += chunk.length;
      dimensions = getImageDimensions(
        Buffer.concat(chunks, totalBytes),
        path.extname(entryName),
      );
      if (dimensions || totalBytes >= 256 * 1024) break;
    }
  } catch {
    return null;
  }

  return dimensions;
}

async function closeCachedArchive(archivePath: string) {
  const cached = archiveCache.get(archivePath);
  if (cached) {
    if (cached.zip) {
      await cached.zip.close();
    }
    if (cached.rar && typeof cached.rar.close === "function") {
      cached.rar.close();
    }
    archiveCache.delete(archivePath);
  }
}

function isSamePathOrDescendant(candidatePath: string, targetPath: string) {
  const candidate = path.resolve(candidatePath);
  const target = path.resolve(targetPath);
  const relative = path.relative(target, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export async function closeReaderArchivesForPath(targetPath: string) {
  const matchingPaths = [...archiveCache.keys()].filter((archivePath) =>
    isSamePathOrDescendant(archivePath, targetPath),
  );
  await Promise.all(
    matchingPaths.map((archivePath) => closeCachedArchive(archivePath)),
  );
}

export function clearReaderArchiveCache() {
  for (const archivePath of archiveCache.keys()) {
    closeCachedArchive(archivePath);
  }
}

export async function getReaderPage(
  archivePath: string,
  pageIndex: number,
  hiddenPages: string[] = [],
  includeHidden: boolean = false,
): Promise<ReaderPagePayload | null> {
  const ext = path.extname(archivePath).toLowerCase();
  const cached = getCachedArchive(archivePath);

  if (ext === ".cbz" || ext === ".zip") {
    const { zip, imageEntries } = await getZipReaderArchive(archivePath);

    const visibleEntries = includeHidden
      ? imageEntries
      : imageEntries.filter((entry) => !hiddenPages.includes(entry));

    if (pageIndex >= 0 && pageIndex < visibleEntries.length) {
      const buffer = await zip.entryData(visibleEntries[pageIndex]);
      const dims = getImageDimensions(
        buffer,
        path.extname(visibleEntries[pageIndex]),
      );
      return {
        data: buffer,
        totalPages: visibleEntries.length,
        width: dims?.width,
        height: dims?.height,
        name: visibleEntries[pageIndex],
      };
    }
    return null;
  }

  if ([".cbr", ".rar"].includes(ext)) {
    let handler;
    if (cached?.rar) {
      handler = cached.rar;
    } else {
      handler = await ArchiveHandler.open(archivePath);
      cacheArchive(archivePath, undefined, handler);
    }

    let entries: string[];
    const cachedAfterOpen = getCachedArchive(archivePath);
    if (cachedAfterOpen?.rarEntries) {
      entries = cachedAfterOpen.rarEntries;
    } else {
      entries = await handler.getEntries();
      if (cachedAfterOpen) {
        cachedAfterOpen.rarEntries = entries;
      }
    }

    const visibleEntries = includeHidden
      ? entries
      : entries.filter((entry) => !hiddenPages.includes(entry));

    if (pageIndex >= 0 && pageIndex < visibleEntries.length) {
      const buffer = await handler.getFile(visibleEntries[pageIndex]);
      const dims = getImageDimensions(
        buffer,
        path.extname(visibleEntries[pageIndex]),
      );
      return {
        data: buffer,
        totalPages: visibleEntries.length,
        width: dims?.width,
        height: dims?.height,
        name: visibleEntries[pageIndex],
      };
    }
    return null;
  }

  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext)) {
    const buffer = fs.readFileSync(archivePath);
    const dims = getImageDimensions(buffer, ext);
    return {
      data: buffer,
      totalPages: 1,
      width: dims?.width,
      height: dims?.height,
    };
  }

  return null;
}

export async function getReaderPageInfo(
  archivePath: string,
  pageIndex: number,
  hiddenPages: string[] = [],
  includeHidden: boolean = false,
): Promise<ReaderPageInfoPayload | null> {
  const ext = path.extname(archivePath).toLowerCase();
  if (ext !== ".cbz" && ext !== ".zip") {
    const page = await getReaderPage(
      archivePath,
      pageIndex,
      hiddenPages,
      includeHidden,
    );
    return page ? { width: page.width, height: page.height } : null;
  }

  const { zip, imageEntries } = await getZipReaderArchive(archivePath);
  const visibleEntries = includeHidden
    ? imageEntries
    : imageEntries.filter((entry) => !hiddenPages.includes(entry));
  const entryName = visibleEntries[pageIndex];
  if (!entryName) return null;

  const dimensions = await readZipImageDimensions(zip, entryName);
  if (dimensions) return dimensions;

  const buffer = await zip.entryData(entryName);
  return getImageDimensions(buffer, path.extname(entryName));
}

export async function getReaderArchiveContent(
  archivePath: string,
): Promise<string[]> {
  const ext = path.extname(archivePath).toLowerCase();

  if (ext === ".cbz" || ext === ".zip") {
    const zip = new StreamZip.async({ file: archivePath });
    const entries = await zip.entries();
    const imageEntries = Object.values(entries)
      .filter((e) => /\.(jpg|jpeg|png|gif|webp)$/i.test(e.name) && !e.isDirectory)
      .map((e) => e.name)
      .sort((a, b) =>
        a.localeCompare(b, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
    await zip.close();
    return imageEntries;
  }

  if ([".cbr", ".rar"].includes(ext)) {
    const handler = await ArchiveHandler.open(archivePath);
    const entries = await handler.getEntries();
    entries.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
    handler.close();
    return entries;
  }

  return [];
}

export async function getReaderPageCount(
  archivePath: string,
  hiddenPages: string[] = [],
): Promise<number> {
  const ext = path.extname(archivePath).toLowerCase();

  if (ext === ".cbz" || ext === ".zip") {
    const zip = new StreamZip.async({ file: archivePath });
    const entries = await zip.entries();
    const visibleCount = Object.values(entries).filter(
      (e) =>
        /\.(jpg|jpeg|png|gif|webp)$/i.test((e as any).name) &&
        !(e as any).isDirectory &&
        !hiddenPages.includes((e as any).name),
    ).length;
    await zip.close();
    return visibleCount;
  }

  if ([".cbr", ".rar"].includes(ext)) {
    const handler = await ArchiveHandler.open(archivePath);
    const entries = await handler.getEntries();
    const visibleCount = entries.filter(
      (entry) => !hiddenPages.includes(entry),
    ).length;
    handler.close();
    return visibleCount;
  }

  return 1;
}

