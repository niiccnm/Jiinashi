import fs from "fs";
import path from "path";
import { shell } from "electron";
import type { DownloaderManager } from "../downloader/manager";
import { mangaDownloader } from "../downloader/manga-downloader";
import { closeReaderArchivesForPath } from "../reader-archive";

export async function trashLibraryPath(
  itemPath: string,
  downloaderManager: DownloaderManager | null,
) {
  const targetPath = path.resolve(itemPath);

  await Promise.all([
    mangaDownloader.cancelDownloadsForPath(targetPath),
    downloaderManager?.cancelDownloadsForPath(targetPath),
  ]);
  await closeReaderArchivesForPath(targetPath);

  if (!fs.existsSync(targetPath)) return;

  await shell.trashItem(targetPath);
}
