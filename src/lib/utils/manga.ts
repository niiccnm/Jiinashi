export const TRACKING_IDENTITY_SOURCE_ID = "tracking.identity";

export type ReadingFormat = "manga" | "manhwa" | "manhua";
export type ReaderViewMode = "single" | "double" | "webtoon";
export type MangaPreference = "auto" | "force_manga" | "force_non_manga";

export const MANGA_RECOGNITION_OPTIONS = [
  { value: "auto", label: "Auto", statusLabel: "Auto", description: "Use Jiinashi's normal detection" },
  { value: "force_manga", label: "Set as manga", statusLabel: "Manga", description: "Always treat these folders as manga" },
  { value: "force_non_manga", label: "Set as non-manga", statusLabel: "Non-manga", description: "Never treat these folders as manga" },
] as const satisfies ReadonlyArray<{
  value: MangaPreference;
  label: string;
  statusLabel: string;
  description: string;
}>;

export type ReaderBootstrapOverrides = {
  initialViewMode?: ReaderViewMode;
  initialMangaMode?: boolean;
};

export function formatMangaStatus(status: string | null | undefined): string {
  if (!status) return "UNKNOWN";
  const map: Record<string, string> = {
    RELEASING: "ON-GOING",
    FINISHED: "FINISHED",
    NOT_YET_RELEASED: "NOT YET RELEASED",
    CANCELLED: "CANCELLED",
    HIATUS: "HIATUS",
  };
  return map[status.toUpperCase()] || status.replace(/_/g, " ").toUpperCase();
}

export type SeriesTitleStyle = "original" | "romaji" | "english";

type SeriesTitleSource = {
  title_original?: string | null;
  title_romaji?: string | null;
  title_english?: string | null;
};

export function normalizeSeriesTitleStyle(
  value: string | null | undefined,
): SeriesTitleStyle {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "original") return "original";
  if (normalized === "english") return "english";
  return "romaji";
}

export function resolveSeriesTitle(
  series: SeriesTitleSource | null | undefined,
  style: SeriesTitleStyle = "romaji",
  fallback = "Unknown Series",
): string {
  const english = String(series?.title_english || "").trim();
  const romaji = String(series?.title_romaji || "").trim();
  const original = String(series?.title_original || "").trim();

  const orderedCandidates =
    style === "original"
      ? [original, romaji, english]
      : style === "english"
        ? [english, romaji, original]
        : [romaji, english, original];

  for (const candidate of orderedCandidates) {
    if (candidate) return candidate;
  }
  return fallback;
}

export function normalizeReadingFormat(
  value: string | null | undefined,
): ReadingFormat | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "manga") return "manga";
  if (normalized === "manhwa") return "manhwa";
  if (normalized === "manhua") return "manhua";
  return null;
}

export function resolveReadingFormatFromMetadata(
  formatValue: string | null | undefined,
  countryValue: string | null | undefined,
  fallbackValue?: string | null | undefined,
): ReadingFormat | null {
  const normalizedFormat = String(formatValue || "")
    .trim()
    .toUpperCase();
  const normalizedCountry = String(countryValue || "")
    .trim()
    .toUpperCase();

  if (normalizedFormat === "MANHWA") return "manhwa";
  if (normalizedFormat === "MANHUA") return "manhua";
  if (normalizedFormat === "MANGA" && normalizedCountry === "KR") {
    return "manhwa";
  }
  if (normalizedFormat === "MANGA" && normalizedCountry === "CN") {
    return "manhua";
  }
  if (normalizedFormat === "MANGA" || normalizedFormat === "ONE_SHOT") {
    return "manga";
  }

  return normalizeReadingFormat(fallbackValue);
}

export function getReadingFormatLabel(
  value: string | null | undefined,
): string | null {
  const format = normalizeReadingFormat(value);
  if (format === "manga") return "Manga";
  if (format === "manhwa") return "Manhwa";
  if (format === "manhua") return "Manhua";
  return null;
}

export function resolveReaderBootstrapOverrides(
  readingFormatValue: string | null | undefined,
  defaultViewModeValue: string | null | undefined,
): ReaderBootstrapOverrides | null {
  const readingFormat = normalizeReadingFormat(readingFormatValue);
  if (!readingFormat) return null;

  if (readingFormat === "manhwa" || readingFormat === "manhua") {
    return {
      initialViewMode: "webtoon",
    };
  }

  const normalizedDefaultViewMode = String(defaultViewModeValue || "")
    .trim()
    .toLowerCase();
  const initialViewMode: ReaderViewMode =
    normalizedDefaultViewMode === "double" ? "double" : "single";

  return {
    initialViewMode,
    initialMangaMode: readingFormat === "manga",
  };
}
