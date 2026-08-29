export const msvApi = {
  manga: {
    cancelSearchContext(searchContextId: string) {
      return window.electronAPI.manga.cancelSearchContext(searchContextId);
    },
    getChapterLocalStates(sourceUrls: string[]) {
      return window.electronAPI.manga.getChapterLocalStates(sourceUrls);
    },
    onDownloaderProgress(callback: (queue: any[]) => void) {
      return window.electronAPI.manga.onDownloaderProgress(callback);
    },
    getDownloadQueue() {
      return window.electronAPI.manga.getDownloadQueue();
    },
    mangabakaDetails(mangabakaId: number) {
      return window.electronAPI.manga.mangabakaDetails(mangabakaId);
    },
    anilistDetails(anilistId: number) {
      return window.electronAPI.manga.anilistDetails(anilistId);
    },
    getEnabledSources() {
      return window.electronAPI.manga.getEnabledSources();
    },
    searchMalIdByTitle(anilistId: number) {
      return window.electronAPI.manga.searchMalIdByTitle(anilistId);
    },
    search(sourceId: string, query: string, page: number, contextId: string) {
      return window.electronAPI.manga.search(sourceId, query, page, contextId);
    },
    getChapters(sourceId: string, sourceUrlOrId: string, contextId: string) {
      return window.electronAPI.manga.getChapters(sourceId, sourceUrlOrId, contextId);
    },
    getDetail(sourceId: string, sourceUrl: string) {
      return window.electronAPI.manga.getDetail(sourceId, sourceUrl);
    },
    getFriendsReading(anilistId?: number, malId?: number) {
      return window.electronAPI.manga.getFriendsReading(anilistId, malId);
    },
    downloadChapter(seriesPayload: any, chapterPayload: any) {
      return window.electronAPI.manga.downloadChapter(seriesPayload, chapterPayload);
    },
  },
  settings: {
    get(key: string) {
      return window.electronAPI.settings.get(key);
    },
    set(key: string, value: string) {
      return window.electronAPI.settings.set(key, value);
    },
  },
  utils: {
    openExternal(url: string) {
      return window.electronAPI.utils.openExternal(url);
    },
  },
};
