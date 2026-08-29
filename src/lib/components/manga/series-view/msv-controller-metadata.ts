import {
  normalizeSeriesTitleStyle,
  resolveSeriesTitle,
  type SeriesTitleStyle,
} from "../../../utils/manga";
import {
  getAnilistExternalUrl,
  getMalExternalUrl,
  getMangabakaExternalUrl,
  parseMangabakaId,
} from "../library-view/mlv-domain-core";
import {
  formatMangabakaDescriptionHtml,
  sanitizeExternalUrl,
  getSelectedMetadataProviderForManga,
  toPositiveInt,
} from "./msv-domain-core";
import { msvApi } from "./msv-runtime";

export function createMsvMetadataSlice(ctx: any) {
  async function refreshSeriesTitleStyle() {
    try {
      const rawStyle = await msvApi.settings.get("seriesTitleStyle");
      ctx.seriesTitleStyle = normalizeSeriesTitleStyle(rawStyle);
    } catch {
      ctx.seriesTitleStyle = "romaji";
    }
  }

  function getDisplaySeriesTitle() {
    return resolveSeriesTitle(
      {
        title_original: ctx.detail?.title?.native || ctx.manga?.title?.native,
        title_romaji: ctx.detail?.title?.romaji || ctx.manga?.title?.romaji,
        title_english: ctx.detail?.title?.english || ctx.manga?.title?.english,
      },
      ctx.seriesTitleStyle as SeriesTitleStyle,
      "Unknown Series",
    );
  }

  function getSeriesTypeLabel() {
    const rawFormat = String(ctx.detail?.format || ctx.manga?.format || "MANGA")
      .trim()
      .toUpperCase();

    if (!rawFormat) return "series";
    if (rawFormat === "ONE_SHOT") return "one-shot";
    return rawFormat.replace(/_/g, " ").toLowerCase();
  }

  function parseMangabakaIdFromExternalLinks(value: unknown) {
    const links = Array.isArray(value) ? value : [];
    for (const link of links) {
      const rawUrl =
        typeof link === "string"
          ? link
          : typeof link === "object"
            ? (link as any)?.url
            : "";
      const parsed = parseMangabakaId({ sourceUrl: rawUrl }) || 0;
      if (parsed > 0) return parsed;
    }
    return 0;
  }

  function getSelectedMetadataProvider() {
    return getSelectedMetadataProviderForManga(ctx.manga);
  }

  function getMangabakaIdFromInput() {
    return (
      toPositiveInt(ctx.detail?.idMangabaka) ||
      (parseMangabakaId(ctx.detail) || 0) ||
      parseMangabakaIdFromExternalLinks(ctx.detail?.externalLinks) ||
      toPositiveInt(ctx.manga?.mangabaka_id) ||
      (getSelectedMetadataProvider() === "mangabaka"
        ? toPositiveInt(ctx.manga?.id)
        : 0) ||
      (parseMangabakaId(ctx.manga) || 0)
    );
  }

  function getAnilistEntryUrl() {
    const anilistId = toPositiveInt(ctx.detail?.id) || toPositiveInt(ctx.manga?.anilist_id);
    return getAnilistExternalUrl(anilistId, getDisplaySeriesTitle());
  }

  function getMalEntryUrl() {
    const malId = toPositiveInt(ctx.detail?.idMal) || toPositiveInt(ctx.manga?.mal_id);
    return getMalExternalUrl(
      malId,
      String(ctx.manga?.source_url || ""),
      getDisplaySeriesTitle(),
    );
  }

  function getMangabakaEntryUrl() {
    return getMangabakaExternalUrl(
      getMangabakaIdFromInput(),
      String(ctx.detail?.sourceUrl || ctx.manga?.source_url || ""),
      getDisplaySeriesTitle(),
    );
  }

  async function loadFriendsReading(currentDetail: any, token: number) {
    if (!currentDetail) {
      ctx.friends = [];
      return;
    }

    ctx.friends = [];
    try {
      const rawFriends = await msvApi.manga.getFriendsReading(
        currentDetail.id,
        currentDetail.idMal,
      );
      if (!ctx.isMounted || token !== ctx.loadToken) return;

      ctx.friends = (rawFriends || []).map((friend: any) => ({
        name: friend.username,
        avatar_url: friend.avatar_url,
        profile_url:
          friend.profile_url ||
          (friend.service === "mal"
            ? `https://myanimelist.net/profile/${encodeURIComponent(friend.username)}`
            : `https://anilist.co/user/${encodeURIComponent(friend.username)}`),
        chapter: friend.progress || 0,
        service: friend.service,
        status: friend.status,
      }));
      ctx.persistSeriesSessionCache();
    } catch (e) {
      console.error("Failed to load friends reading data:", e);
      ctx.friends = [];
      ctx.persistSeriesSessionCache();
    }
  }

  function openFriendProfile(friend: any) {
    if (!friend?.profile_url) return;
    msvApi.utils.openExternal(friend.profile_url);
  }

  function getDescriptionHtml() {
    const rawDescription = String(ctx.detail?.description || "").trim();
    if (!rawDescription) return "";
    const provider = String(
      ctx.detail?.sourceProvider || getSelectedMetadataProvider(),
    ).toLowerCase();
    if (provider === "mangabaka") {
      return formatMangabakaDescriptionHtml(rawDescription);
    }
    return rawDescription;
  }

  function handleDescriptionClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest("a");
    if (!anchor) return;
    const href = sanitizeExternalUrl(anchor.getAttribute("href"));
    if (!href) return;
    event.preventDefault();
    event.stopPropagation();
    msvApi.utils.openExternal(href);
  }

  return {
    refreshSeriesTitleStyle,
    getDisplaySeriesTitle,
    getSeriesTypeLabel,
    parseMangabakaIdFromExternalLinks,
    getSelectedMetadataProvider,
    getMangabakaIdFromInput,
    getAnilistEntryUrl,
    getMalEntryUrl,
    getMangabakaEntryUrl,
    loadFriendsReading,
    openFriendProfile,
    getDescriptionHtml,
    handleDescriptionClick,
  };
}
