import AdmZip from 'adm-zip'
import { extname } from 'path'
import * as fs from 'fs-extra'


import { createExtractorFromFile } from 'node-unrar-js/dist/index.js'
import path from 'path' 
import os from 'os'

// Helper to get WASM binary
function getWasmBinary(): ArrayBuffer {
  try {
    // Attempt to resolve relative to the library entry point
    const libPath = require.resolve('node-unrar-js/dist/index.js')
    const wasmPath = path.join(path.dirname(libPath), 'js/unrar.wasm')
    return fs.readFileSync(wasmPath).buffer as ArrayBuffer
  } catch (e) {
    console.error('Failed to load unrar.wasm:', e)
    throw e
  }
}

function normalizePath(p: string): string {
    return p.replace(/\\/g, '/')
}

export interface IArchiveHandler {
  getEntries(): Promise<string[]>
  getFile(entryName: string): Promise<Buffer>
  close(): void
}

export class ArchiveHandler {
  static async open(filePath: string): Promise<IArchiveHandler> {
    const ext = extname(filePath).toLowerCase()
    
    if (ext === '.zip' || ext === '.cbz') {
      return new ZipHandler(filePath)
    }
    
    // TODO: Add RAR/7Z support
    if (ext === '.rar' || ext === '.cbr') {
      return new RarHandler(filePath)
    }

    throw new Error(`Unsupported archive format: ${ext}`)
  }
}

class ZipHandler implements IArchiveHandler {
  private zip: AdmZip

  constructor(filePath: string) {
    this.zip = new AdmZip(filePath)
  }

  async getEntries(): Promise<string[]> {
    const entries = this.zip.getEntries()
    // Filter for images? Or just return all names?
    // User wants "JPEG, GIF, PNG, TIFF, and BMP"
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp']
    
    return entries
      .filter(entry => !entry.isDirectory && imageExtensions.includes(extname(entry.entryName).toLowerCase()))
      .map(entry => entry.entryName)
      .sort() // Natural sort might be needed later
  }

  async getFile(entryName: string): Promise<Buffer> {
    const entry = this.zip.getEntry(entryName)
    if (!entry) throw new Error('File not found in archive')
    const buffer = this.zip.readFile(entry)
    if (!buffer) throw new Error('Failed to read file from archive')
    return buffer
  }

  close() {
    // adm-zip is synchronous and doesn't hold open handles strictly in the same way, but good to have method
    this.zip = null as any
  }
}

class RarHandler implements IArchiveHandler {
  private filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async getEntries(): Promise<string[]> {
    const extractor = await createExtractorFromFile({ 
        filepath: this.filePath,
        wasmBinary: getWasmBinary()
    })
    const list = extractor.getFileList()
    
    // console.log('[RarHandler] Raw list headers:', list.fileHeaders.length) 
    
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp']
    
    const entries = []
    for (const entry of list.fileHeaders) {
       // console.log('[RarHandler] Entry:', entry.name, 'Dir:', entry.flags.directory)
       if (!entry.flags.directory) {
         entries.push(entry.name)
       }
    }
    
    const filtered = entries
      .filter(name => imageExtensions.includes(extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      
    return filtered
  }

  async getFile(entryName: string): Promise<Buffer> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jiinashi-rar-'))
    
    try {
        const extractor = await createExtractorFromFile({ 
            filepath: this.filePath,
            targetPath: tempDir,
            wasmBinary: getWasmBinary()
        }) as any
        
        const targetEntryNormalized = normalizePath(entryName)

        const extracted = extractor.extract({ 
            files: (fileHeader: any) => {
                const current = normalizePath(fileHeader.name)
                // Loose match to handle separator differences
                return current === targetEntryNormalized
            } 
        })
        
        // Force iterator to run
        const results = [...extracted.files]
        if (results.length === 0) {
            console.error('[RarHandler] Filter matched nothing for:', entryName)
            throw new Error('File not found in archive (filter mismatch)')
        }
        
        // Construct expected output path
        // ExtractorFile joins targetPath + filename
        const outputPath = path.join(tempDir, entryName)
        
        if (!await fs.pathExists(outputPath)) {
            // Try to find it if name transform messed up
            console.warn('[RarHandler] Direct output path missing, searching in temp...')
            const files = await fs.readdir(tempDir)
            if (files.length > 0) {
                 // Warning: flat find might fail for nested rar content if not recursive search
                 // But typically we extract one file.
                 // Just trying to read whatever is there if it's the only one
                 // Actually relying on `entryName` structure
            }
            throw new Error(`Extracted file not found on disk: ${outputPath}`)
        }
        
        const buffer = await fs.readFile(outputPath)
        return buffer
    } finally {
        // Cleanup
        try {
            await fs.remove(tempDir)
        } catch (e) {
            console.warn('Failed to cleanup temp dir:', e)
        }
    }
  }

  close() {
    // node-unrar-js doesn't seem to need explicit close for file extractor if used per-method
  }
}
