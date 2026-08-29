export interface SourceGroupingInput {
  id: string;
  name?: string;
  baseUrl?: string;
}

export function normalizeSourceToken(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function stripVariantSuffix(name: string) {
  return String(name || "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

export function isLanguageSegment(value: string) {
  return /^[a-z]{2,3}(?:-[a-z]{2,3})?$/i.test(String(value || "").trim());
}

export function toTitleCaseWord(value: string) {
  if (!value) return value;
  return value[0].toUpperCase() + value.slice(1).toLowerCase();
}

export function humanizeSourceToken(value: string) {
  const spaced = String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return "Unknown Source";

  return spaced
    .split(/\s+/)
    .map((part) => toTitleCaseWord(part))
    .join(" ");
}

export function getProviderTokenFromSourceId(sourceId: string) {
  const segments = String(sourceId || "")
    .trim()
    .split(".")
    .filter(Boolean);
  if (!segments.length) return "";
  const last = segments[segments.length - 1];
  if (segments.length >= 2 && isLanguageSegment(last)) {
    return segments[segments.length - 2];
  }
  return last;
}

export function getSourceHost(baseUrl?: string) {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function humanizeSourceId(sourceId: string) {
  return humanizeSourceToken(getProviderTokenFromSourceId(sourceId));
}

export function getBaseSourceName(
  source: Pick<SourceGroupingInput, "id" | "name">,
) {
  const rawName = String(source?.name || "").trim();
  if (!rawName) {
    return humanizeSourceId(String(source?.id || ""));
  }
  return (
    stripVariantSuffix(rawName) || humanizeSourceId(String(source?.id || ""))
  );
}

export function getSourceGroupId(
  source: Pick<SourceGroupingInput, "id" | "name" | "baseUrl">,
) {
  const host = getSourceHost(source.baseUrl);
  if (host) return `host:${host}`;
  return `name:${normalizeSourceToken(getBaseSourceName(source))}`;
}
