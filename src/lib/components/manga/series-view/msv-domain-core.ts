import { parsePositiveId } from "../library-view/mlv-domain-core";

export function normalizeChapterSourceUrl(value: unknown) {
  return String(value || "").trim();
}

export function toPositiveInt(value: unknown) {
  return parsePositiveId(value) || 0;
}

export function getSelectedMetadataProviderForManga(manga: any) {
  const explicit = String(
    manga?.provider || manga?.sourceProvider || "",
  ).toLowerCase();
  if (explicit === "anilist") return "anilist";

  const anilistId =
    toPositiveInt(manga?.anilist_id) || toPositiveInt(manga?.idAnilist);
  if (anilistId > 0) return "anilist";

  if (explicit === "mangabaka") return "mangabaka";

  const sourceId = String(manga?.source_id || "").toLowerCase();
  if (sourceId === "anilist") return "anilist";
  if (sourceId === "mangabaka") return "mangabaka";

  const sourceUrl = String(manga?.source_url || "").toLowerCase();
  if (sourceUrl.includes("anilist.co/manga/")) return "anilist";
  if (sourceUrl.includes("mangabaka.org/")) return "mangabaka";

  return "anilist";
}

export function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeExternalUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function buildExternalAnchor(label: unknown, href: unknown) {
  const safeHref = sanitizeExternalUrl(href);
  if (!safeHref) return escapeHtml(label);
  return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer" class="text-blue-300 hover:text-blue-200 underline underline-offset-2">${escapeHtml(label)}</a>`;
}

export function linkifyPlainText(text: unknown) {
  const input = String(text || "");
  if (!input) return "";
  const urlRegex = /\bhttps?:\/\/[^\s<>\"']+/gi;
  let out = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = urlRegex.exec(input)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    out += escapeHtml(input.slice(lastIndex, matchStart));

    let rawUrl = match[0];
    let trailing = "";
    while (/[),.!?;:]$/.test(rawUrl)) {
      trailing = rawUrl.slice(-1) + trailing;
      rawUrl = rawUrl.slice(0, -1);
    }

    const safeUrl = sanitizeExternalUrl(rawUrl);
    if (safeUrl) {
      out += buildExternalAnchor(rawUrl, safeUrl);
    } else {
      out += escapeHtml(match[0]);
    }
    out += escapeHtml(trailing);
    lastIndex = matchEnd;
  }
  out += escapeHtml(input.slice(lastIndex));
  return out;
}

export function formatMangabakaDescriptionHtml(value: unknown) {
  const input = String(value || "").trim();
  if (!input) return "";

  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
  let out = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = markdownLinkRegex.exec(input)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    out += linkifyPlainText(input.slice(lastIndex, matchStart));
    out += buildExternalAnchor(match[1] || match[2], match[2]);
    lastIndex = matchEnd;
  }

  out += linkifyPlainText(input.slice(lastIndex));
  return out.replace(/\r?\n/g, "<br/>");
}

export function formatChapterNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const stringified = Number.isInteger(value) ? String(value) : String(value);
  return stringified.replace(/\.0+$/g, "").replace(/(\.\d*?[1-9])0+$/g, "$1");
}

export function resolveChapterNumberForDownload(chapter: any) {
  const direct = Number(chapter?.chapter_number);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const volumeNumber = Number(chapter?.volume_number);
  if (
    direct === 0 &&
    Number.isFinite(volumeNumber) &&
    volumeNumber > 0
  ) {
    return 0;
  }

  const title = String(chapter?.title || "");
  const match = title.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return 0;

  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

export function getChapterDisplayTitle(chapter: any) {
  const chapterNumber = Number(chapter?.chapter_number);
  const formattedNumber = formatChapterNumber(chapterNumber);
  const rawTitle = String(chapter?.title || "").trim();
  const numberedPrefix = rawTitle.match(
    /^(?:(?:chapter|ch|iteration|episode|ep|part|act|tale|testament|case|course|battle|love|volume|vol)\b\s*[#:.\-\s]*|#\s*)([0-9]+(?:\.[0-9]+)?)/i,
  );

  if (formattedNumber && rawTitle) {
    const titleNumber = numberedPrefix ? Number(numberedPrefix[1]) : NaN;
    if (
      Number.isFinite(titleNumber) &&
      Math.abs(titleNumber - chapterNumber) < 1e-9
    ) {
      return rawTitle;
    }
    return `Chapter ${formattedNumber} - ${rawTitle}`;
  }

  if (formattedNumber) {
    return `Chapter ${formattedNumber}`;
  }

  return rawTitle || "Chapter";
}

export function getChapterPosterLabel(chapter: any) {
  const scanlator = String(chapter?.scanlator || "").trim();
  if (!scanlator) return "";
  return `By ${scanlator}`;
}

export function isChapterDownloadable(chapter: any) {
  return chapter?.is_downloadable !== false;
}

export function isChapterDownloaded(chapter: any) {
  return Boolean(chapter?.is_downloaded);
}

export function getChapterUnavailableReason(chapter: any) {
  const reason = String(chapter?.unavailable_reason || "").trim();
  return reason || "Not downloadable";
}
