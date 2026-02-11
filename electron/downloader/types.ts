export interface DownloadTask {
  id: number;
  url: string;
  title: string;
  source: string;
  cover_url: string;
  status:
    | "pending"
    | "parsing"
    | "downloading"
    | "zipping"
    | "completed"
    | "failed"
    | "cancelled"
    | "verification";
  progress: {
    current: number;
    total: number;
    percent: number;
  };
  totalImages: number;
  downloadedImages: number;
  bytesDownloaded?: number;
  speed?: string;
  errorMessage?: string;
  outputPath?: string;
  preview_data?: string;
  logs?: string[];
  artist?: string;
  parody?: string;
  tags?: string[];
  contentType?: string;
}

export type DownloadStatus = DownloadTask["status"];

export interface SpeedData {
  lastAt: number;
  lastBytes: number;
}

export interface ImageInfo {
  url: string;
  fallbackUrl?: string;
  pageUrl?: string;
  filename: string;
  index: number;
  headers?: Record<string, string>;
  width?: number;
  height?: number;
}

export interface MangaMetadata {
  title: string;
  coverUrl: string;
  pageCount: number;
  source: string;
  tags?: string[];
  artist?: string;
  parody?: string;
  contentType?: string;
}

export interface ISiteParser {
  name: string;
  match(url: string): boolean;
  getMetadata(
    url: string,
    cookies?: string,
    userAgent?: string,
    checkCancel?: () => boolean,
  ): Promise<MangaMetadata>;
  getImages(url: string, checkCancel?: () => boolean): Promise<ImageInfo[]>;
}
