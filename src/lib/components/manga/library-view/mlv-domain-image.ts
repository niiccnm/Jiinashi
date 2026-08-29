type CreateImageDomainArgs = {
  imageCache: Map<string, string>;
  failedImageSources: Set<string>;
  maxImageCacheEntries: number;
  getFailedImageSourceVersion: () => number;
  onFailedImageSourcesChanged: () => void;
  getActiveSelectedSeriesId: () => number | null;
  getDetailSeriesId: () => number | null;
  getDetail: () => any;
  getActiveDetailSeriesId: () => number | null;
};

export function createMlvImageDomain({
  imageCache,
  failedImageSources,
  maxImageCacheEntries,
  getFailedImageSourceVersion,
  onFailedImageSourcesChanged,
  getActiveSelectedSeriesId,
  getDetailSeriesId,
  getDetail,
  getActiveDetailSeriesId,
}: CreateImageDomainArgs) {
  function setImageCache(cacheKey: string, src: string) {
    if (!cacheKey || !src) return;
    if (imageCache.has(cacheKey)) {
      imageCache.delete(cacheKey);
    }
    imageCache.set(cacheKey, src);
    while (imageCache.size > maxImageCacheEntries) {
      const oldest = imageCache.keys().next().value;
      if (oldest === undefined) break;
      imageCache.delete(oldest);
    }
  }

  function getImageFailureKey(value: string) {
    const next = String(value || "").trim();
    if (!next) return "";
    try {
      const parsed = new URL(next);
      const protocol = parsed.protocol.toLowerCase();
      if (protocol === "media:" || protocol === "file:") {
        let pathname = decodeURIComponent(parsed.pathname || "").replace(
          /\\/g,
          "/",
        );
        if (/^\/[a-zA-Z]:\//.test(pathname)) {
          pathname = pathname.slice(1);
        }
        return `${protocol}///${pathname.toLowerCase()}`;
      }
      parsed.hash = "";
      return parsed.toString();
    } catch {
      try {
        return decodeURI(next);
      } catch {
        return next;
      }
    }
  }

  function isRemoteUrl(value: string) {
    return /^https?:\/\//i.test(value);
  }

  function toMediaSrc(filePath: string) {
    return `media:///${filePath.replace(/\\/g, "/")}`;
  }

  function getSeriesCoverCacheKey(item: any) {
    const id = Number(item?.id || 0);
    return `series-cover:${id > 0 ? id : "unknown"}`;
  }

  function getSeriesBannerCacheKey(item: any) {
    const id = Number(item?.id || 0);
    return `series-banner:${id > 0 ? id : "unknown"}`;
  }

  function getChapterCoverCacheKey(item: any) {
    const id = Number(item?.id || 0);
    const version = Number(item?._coverVersion || 0);
    return `chapter-cover:${id > 0 ? id : "unknown"}:${version}`;
  }

  function resolveCachedImage(cacheKey: string, candidate: string) {
    getFailedImageSourceVersion();
    const next = String(candidate || "").trim();
    if (next && !failedImageSources.has(getImageFailureKey(next))) {
      setImageCache(cacheKey, next);
      return next;
    }
    const cached = String(imageCache.get(cacheKey) || "").trim();
    if (cached && !failedImageSources.has(getImageFailureKey(cached))) {
      return cached;
    }
    return "";
  }

  function markImageSourceFailed(src: string) {
    const next = getImageFailureKey(src);
    if (!next) return;
    if (failedImageSources.has(next)) return;
    failedImageSources.add(next);
    onFailedImageSourcesChanged();
  }

  function clearImageSourceFailed(src: string) {
    const next = getImageFailureKey(src);
    if (!next) return;
    if (!failedImageSources.delete(next)) return;
    onFailedImageSourcesChanged();
  }

  function cacheImageFromEvent(cacheKey: string, event: Event) {
    const image = event.currentTarget as HTMLImageElement | null;
    if (!image) return;
    const src = String(image.currentSrc || image.src || "").trim();
    if (!src) return;
    clearImageSourceFailed(src);
    image.style.removeProperty("visibility");
    setImageCache(cacheKey, src);
  }

  function getRemoteCoverUrl(item: any) {
    const remote = String(item?.cover_url || "").trim();
    if (remote) return remote;
    return "";
  }

  function getLocalCoverUrl(item: any) {
    const local = String(item?.cover_local_path || "").trim();
    if (local) {
      return isRemoteUrl(local) ? local : toMediaSrc(local);
    }
    return "";
  }

  function getSelectedDetailCoverUrl() {
    getFailedImageSourceVersion();
    const selectedId = Number(getActiveSelectedSeriesId() || 0);
    const detailSeriesId = Number(getDetailSeriesId() || 0);
    if (!selectedId || detailSeriesId !== selectedId) return "";
    const detail = getDetail();
    const fromDetail = String(
      detail?.coverImage?.extraLarge || detail?.coverImage?.large || "",
    ).trim();
    if (!fromDetail || failedImageSources.has(getImageFailureKey(fromDetail))) {
      return "";
    }
    return fromDetail;
  }

  function getSelectedDetailBannerUrl() {
    const selectedId = Number(getActiveSelectedSeriesId() || 0);
    const detailSeriesId = Number(getDetailSeriesId() || 0);
    if (!selectedId || detailSeriesId !== selectedId) return "";
    const detail = getDetail();
    return String(detail?.bannerImage || "").trim();
  }

  function getCoverUrl(item: any) {
    getFailedImageSourceVersion();
    const remote = getRemoteCoverUrl(item);
    if (remote && !failedImageSources.has(getImageFailureKey(remote))) {
      return remote;
    }
    const local = getLocalCoverUrl(item);
    if (local && !failedImageSources.has(getImageFailureKey(local))) {
      return local;
    }
    return "";
  }

  function getSeriesCoverSrc(item: any) {
    const cacheKey = getSeriesCoverCacheKey(item);
    const selectedId = Number(getActiveSelectedSeriesId() || 0);
    const itemId = Number(item?.id || 0);
    const isSelected = selectedId > 0 && itemId === selectedId;
    const isSelectedDetailLoading =
      isSelected && Number(getActiveDetailSeriesId() || 0) === selectedId;
    const candidate = isSelectedDetailLoading
      ? getSelectedDetailCoverUrl() || getRemoteCoverUrl(item)
      : getSelectedDetailCoverUrl() || getCoverUrl(item);
    return resolveCachedImage(cacheKey, candidate);
  }

  function getBannerUrl(item: any) {
    const fromSeries = String(item?.banner_url || "").trim();
    if (fromSeries) return fromSeries;
    return getSelectedDetailBannerUrl();
  }

  function getSeriesBannerSrc(item: any) {
    const cacheKey = getSeriesBannerCacheKey(item);
    return resolveCachedImage(cacheKey, getBannerUrl(item));
  }

  function getChapterCoverUrl(item: any) {
    const raw = String(item?.cover_path || "").trim();
    if (!raw) return "";
    const base = isRemoteUrl(raw) ? raw : toMediaSrc(raw);
    const coverVersion = Number(item?._coverVersion || 0);
    if (coverVersion > 0 && !isRemoteUrl(raw)) {
      return `${base}?v=${coverVersion}`;
    }
    return base;
  }

  function getChapterCoverSrc(item: any) {
    const cacheKey = getChapterCoverCacheKey(item);
    return resolveCachedImage(cacheKey, getChapterCoverUrl(item));
  }

  function handleSelectedCoverLoad(cacheKey: string, event: Event) {
    cacheImageFromEvent(cacheKey, event);
  }

  function handleCoverError(event: Event) {
    const image = event.currentTarget as HTMLImageElement | null;
    if (!image) return;
    const current = String(image.currentSrc || "").trim();
    const attrSrc = String(image.getAttribute("src") || image.src || "").trim();
    if (current) markImageSourceFailed(current);
    if (attrSrc && attrSrc !== current) markImageSourceFailed(attrSrc);
    const cacheKey = String(image.dataset.cacheKey || "").trim();
    if (cacheKey) {
      imageCache.delete(cacheKey);
    }
    image.style.visibility = "hidden";
  }

  function handleBannerError(event: Event) {
    const image = event.currentTarget as HTMLImageElement | null;
    if (!image) return;
    const cacheKey = String(image.dataset.cacheKey || "").trim();
    if (cacheKey) {
      imageCache.delete(cacheKey);
    }
    image.style.visibility = "hidden";
  }

  return {
    getSeriesCoverCacheKey,
    getSeriesBannerCacheKey,
    getChapterCoverCacheKey,
    cacheImageFromEvent,
    handleSelectedCoverLoad,
    getSeriesCoverSrc,
    getSeriesBannerSrc,
    getChapterCoverSrc,
    handleCoverError,
    handleBannerError,
  };
}



