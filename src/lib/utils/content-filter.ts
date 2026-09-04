export interface ContentFilterSettings {
  blurR18: boolean;
  blurR18Hover: boolean;
  blurR18Intensity: number;
}

export const DEFAULT_CONTENT_FILTER_SETTINGS: ContentFilterSettings = {
  blurR18: false,
  blurR18Hover: false,
  blurR18Intensity: 12,
};

export function parseContentFilterSettings(
  settings: Record<string, string> | null | undefined,
): ContentFilterSettings {
  const intensity = Number.parseInt(settings?.blurR18Intensity ?? "", 10);
  return {
    blurR18: settings?.blurR18 === "true",
    blurR18Hover: settings?.blurR18Hover === "true",
    blurR18Intensity: Number.isFinite(intensity) ? intensity : 12,
  };
}
