import fs from "fs";
import path from "path";
import { app } from "electron";
import AdmZip from "adm-zip";
import * as db from "../database/database";
import { DownloadTask } from "./types";
import { truncateTitle } from "./utils";

export class FileSystemManager {
  ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async writeImage(filePath: string, buffer: Buffer): Promise<void> {
    const dir = path.dirname(filePath);
    this.ensureDir(dir);
    return fs.promises.writeFile(filePath, buffer);
  }

  async createCBZ(sourceDir: string, outputPath: string): Promise<void> {
    const zip = new AdmZip();
    zip.addLocalFolder(sourceDir);
    return new Promise((resolve, reject) => {
      zip.writeZip(outputPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  cleanup(dir: string): void {
    if (!fs.existsSync(dir)) return;

    for (let i = 0; i < 3; i++) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        return; // Success
      } catch (e: any) {
        if (e.code === "EBUSY" && i < 2) {
          // Just retry without blocking
          continue;
        }
        // Give up after 3 tries
        console.warn(`Failed to cleanup ${dir}:`, e);
      }
    }
  }

  getOutputPath(task: DownloadTask): string {
    const rootPath =
      db.getSetting("downloadPath") ||
      path.join(app.getPath("documents"), "Jiinashi Downloads");

    // Route to subfolder to prepare for v0.0.3 Manga integration
    const downloadPath = path.join(rootPath, "Doujinshi");

    let safeTitle = (task.title || "").trim().replace(/[<>:"/\\|?*]/g, "_");
    if (!safeTitle) safeTitle = `jiinashi_${task.id}`;

    const extension = ".cbz";
    safeTitle = truncateTitle(safeTitle, downloadPath, extension);
    return path.join(downloadPath, `${safeTitle}${extension}`);
  }

  exists(pathStr: string): boolean {
    return fs.existsSync(pathStr);
  }
}
