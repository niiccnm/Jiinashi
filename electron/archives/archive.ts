import AdmZip from "adm-zip";
import { extname, join, dirname } from "path";
import * as fs from "fs-extra";
import { createExtractorFromFile } from "node-unrar-js/dist/index.js";
import os from "os";

/**
 * Supported image extensions for extraction
 */
const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tiff",
  ".webp",
]);

/**
 * Helper to get WASM binary for node-unrar-js
 */
function getWasmBinary(): ArrayBuffer {
  try {
    const libPath = require.resolve("node-unrar-js/dist/index.js");
    const wasmPath = join(dirname(libPath), "js/unrar.wasm");
    return fs.readFileSync(wasmPath).buffer as ArrayBuffer;
  } catch (e) {
    console.error("Failed to load unrar.wasm:", e);
    throw e;
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function isImage(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filename).toLowerCase());
}

export interface IArchiveHandler {
  getEntries(): Promise<string[]>;
  getFile(entryName: string): Promise<Buffer>;
  close(): void;
}

export class ArchiveHandler {
  static async open(filePath: string): Promise<IArchiveHandler> {
    const ext = extname(filePath).toLowerCase();

    switch (ext) {
      case ".zip":
      case ".cbz":
        return new ZipHandler(filePath);
      case ".rar":
      case ".cbr":
        return new RarHandler(filePath);
      default:
        throw new Error(`Unsupported archive format: ${ext}`);
    }
  }
}

class ZipHandler implements IArchiveHandler {
  private zip: AdmZip;

  constructor(filePath: string) {
    this.zip = new AdmZip(filePath);
  }

  async getEntries(): Promise<string[]> {
    return this.zip
      .getEntries()
      .filter((entry) => !entry.isDirectory && isImage(entry.entryName))
      .map((entry) => entry.entryName)
      .sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      );
  }

  async getFile(entryName: string): Promise<Buffer> {
    const entry = this.zip.getEntry(entryName);
    if (!entry) throw new Error("File not found in archive");

    const buffer = this.zip.readFile(entry);
    if (!buffer) throw new Error("Failed to read file from archive");

    return buffer;
  }

  close() {
    this.zip = null as any;
  }
}

class RarHandler implements IArchiveHandler {
  constructor(private filePath: string) {}

  async getEntries(): Promise<string[]> {
    const extractor = await createExtractorFromFile({
      filepath: this.filePath,
      wasmBinary: getWasmBinary(),
    });

    const list = extractor.getFileList();
    const entries: string[] = [];

    for (const entry of list.fileHeaders) {
      if (!entry.flags.directory && isImage(entry.name)) {
        entries.push(entry.name);
      }
    }

    return entries.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
  }

  async getFile(entryName: string): Promise<Buffer> {
    const tempDir = await fs.mkdtemp(join(os.tmpdir(), "jiinashi-rar-"));

    try {
      const extractor = (await createExtractorFromFile({
        filepath: this.filePath,
        targetPath: tempDir,
        wasmBinary: getWasmBinary(),
      })) as any;

      const targetEntryNormalized = normalizePath(entryName);

      const extracted = extractor.extract({
        files: (fileHeader: any) => {
          return normalizePath(fileHeader.name) === targetEntryNormalized;
        },
      });

      const results = [...extracted.files];
      if (results.length === 0) {
        throw new Error(`File not found in archive: ${entryName}`);
      }

      const outputPath = join(tempDir, entryName);
      if (!(await fs.pathExists(outputPath))) {
        throw new Error(`Extracted file not found: ${outputPath}`);
      }

      return await fs.readFile(outputPath);
    } finally {
      await fs.remove(tempDir).catch((e) => {
        console.warn("Failed to cleanup RAR temp dir:", e);
      });
    }
  }

  close() {}
}
