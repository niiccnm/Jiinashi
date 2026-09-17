import { onMount } from "svelte";
import type { MangaExtensionSite } from "../../../../electron/preload/types";
import { toasts } from "../../stores/toast";

export function createSettingsModel() {
  let loading = $state(false);
  let pageLoading = $state(true);
  let settings = $state<Record<string, string>>({});
  let showClearDialog = $state(false);
  let appVersion = $state("...");

  // Tag Export Options
  let includeDescription = $state(true);
  let includeKeywords = $state(true);
  let includeDefaultTags = $state(true);
  let excludedCategoryIds = $state<number[]>([]);
  let allCategories = $state<any[]>([]);
  let showExcludedCategories = $state(false);

  // Types Export Options
  let includeTypes = $state(true);
  let includeDefaultTypes = $state(true);
  let excludedTypeIds = $state<number[]>([]);
  let allTypes = $state<any[]>([]);
  let showExcludedTypes = $state(false);

  // Backup Options
  let includeDownloadHistory = $state(true);
  let includeDownloadLogs = $state(false);

  // Manga & Tracking
  let trackingAccounts = $state<any[]>([]);
  let incognitoMode = $state(false);
  let extensions = $state<any[]>([]);
  let extensionRepositoryUrl = $state("");
  let importingExtensionRepository = $state(false);
  let extensionToRemove = $state<{ id: string; name: string } | null>(null);
  let removingExtension = $state(false);
  let expandedExtensionSites = $state<Record<string, boolean>>({});
  let brokenSiteIcons = $state<Record<string, boolean>>({});
  let seriesTitleStyle = $state("romaji");

  async function refreshSettings() {
    try {
      const allSettings = await window.electronAPI.settings.getAll();
      settings = allSettings || {};
      brokenSiteIcons = {};
      await loadRoots();
      allCategories = await window.electronAPI.categories.getAll();
      allTypes = await window.electronAPI.types.getAll();
      appVersion = await window.electronAPI.utils.getVersion();
      trackingAccounts = await window.electronAPI.manga.getTrackingAccounts();
      incognitoMode = await window.electronAPI.manga.getIncognito();
      extensions = await window.electronAPI.manga.getExtensions();
      seriesTitleStyle = settings["seriesTitleStyle"] || "romaji";
    } catch (e) {
      console.error("Failed to load settings:", e);
      toasts.add("Failed to load settings", "error");
    } finally {
      pageLoading = false;
    }
  }

  onMount(() => {
    refreshSettings();

    const unsubRoots = window.electronAPI.library.onRootsUpdated((newRoots) => {
      libraryRoots = newRoots;
    });

    return () => {
      unsubRoots();
    };
  });

  async function updateSetting(key: string, value: string | boolean) {
    const stringValue = String(value);
    settings[key] = stringValue; // Optimistic update
    try {
      await window.electronAPI.settings.set(key, stringValue);
    } catch (e) {
      console.error(`Failed to update setting ${key}:`, e);
      toasts.add(`Failed to update setting: ${key}`, "error");
    }
  }

  async function handleClearLibrary() {
    loading = true;
    try {
      await window.electronAPI.library.clear();
      toasts.add("Library cleared successfully", "success");
      showClearDialog = false;
    } catch (e) {
      console.error("Failed to clear library:", e);
      toasts.add("Failed to clear library", "error");
    } finally {
      loading = false;
    }
  }

  async function handleBackup() {
    loading = true;
    try {
      const result = await window.electronAPI.library.backup({
        includeDownloadHistory: includeDownloadHistory,
        includeDownloadLogs: includeDownloadLogs,
      });
      if (result && result.success) {
        let message = `Backup successful! Saved ${result.count} items.`;
        if (result.historyCount && result.historyCount > 0) {
          message = `Backup successful! Saved ${result.count} items and ${result.historyCount} download history entries.`;
        }
        toasts.add(message, "success");
      } else if (result && result.error !== "Cancelled") {
        toasts.add(`Backup failed: ${result.error}`, "error");
      }
    } catch (e) {
      console.error("Backup error:", e);
      toasts.add("Backup failed", "error");
    } finally {
      loading = false;
    }
  }

  async function handleRestore(filePath?: string) {
    loading = true;
    try {
      const result = await window.electronAPI.library.importBackup(filePath);
      if (result && result.success) {
        toasts.add(
          `Restore successful! Updated ${result.count} items.`,
          "success",
        );
      } else if (result && result.error !== "Cancelled") {
        toasts.add(`Restore failed: ${result.error}`, "error");
      }
    } catch (e) {
      console.error("Restore error:", e);
      toasts.add("Restore failed", "error");
    } finally {
      loading = false;
    }
  }

  function toggleCategoryExclusion(id: number) {
    if (excludedCategoryIds.includes(id)) {
      excludedCategoryIds = excludedCategoryIds.filter((cid) => cid !== id);
    } else {
      excludedCategoryIds = [...excludedCategoryIds, id];
    }
  }

  function selectAllCategories() {
    excludedCategoryIds = allCategories.map((c) => c.id);
  }

  function deselectAllCategories() {
    excludedCategoryIds = [];
  }

  function toggleTypeExclusion(id: number) {
    if (excludedTypeIds.includes(id)) {
      excludedTypeIds = excludedTypeIds.filter((tid) => tid !== id);
    } else {
      excludedTypeIds = [...excludedTypeIds, id];
    }
  }

  function selectAllTypes() {
    excludedTypeIds = allTypes.map((t) => t.id);
  }

  function deselectAllTypes() {
    excludedTypeIds = [];
  }

  async function handleExportTags() {
    loading = true;
    try {
      const result = await window.electronAPI.library.exportTags({
        includeDescription,
        includeKeywords,
        includeDefaultTags,
        excludedCategoryIds: $state.snapshot(excludedCategoryIds),
        includeTypes,
        includeDefaultTypes,
        excludedTypeIds: $state.snapshot(excludedTypeIds),
      });
      if (result && result.success) {
        toasts.add("Tags exported successfully", "success");
      } else if (result && result.error !== "Cancelled") {
        toasts.add(`Export failed: ${result.error}`, "error");
      }
    } catch (e) {
      console.error("Export tags error:", e);
      toasts.add("Export failed", "error");
    } finally {
      loading = false;
    }
  }

  async function handleImportTags(filePath?: string) {
    loading = true;
    try {
      const result = await window.electronAPI.library.importTags(filePath);
      if (result && result.success) {
        toasts.add(
          `Tags imported! Mapped to ${result.count} items.`,
          "success",
        );
      } else if (result && result.error !== "Cancelled") {
        toasts.add(`Import failed: ${result.error}`, "error");
      }
    } catch (e) {
      console.error("Import tags error:", e);
      toasts.add("Import failed", "error");
    } finally {
      loading = false;
    }
  }

  let isDragging = $state(false);

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;

    if (e.dataTransfer?.files?.[0]) {
      const file = e.dataTransfer.files[0];
      if (!file.name.toLowerCase().endsWith(".json")) {
        toasts.add(
          "Invalid file type. Please drop a JSON backup file.",
          "error",
        );
        return;
      }
      // @ts-ignore
      const filePath = window.electronAPI.utils.getPathForFile(file);
      if (filePath) {
        const name = file.name.toLowerCase();
        if (name.includes("backup")) {
          await handleRestore(filePath);
        } else if (name.includes("tags")) {
          await handleImportTags(filePath);
        } else {
          await handleRestore(filePath);
        }
      } else {
        toasts.add("Could not determine file path.", "error");
      }
    }
  }

  let libraryRoots = $state<string[]>([]);

  async function loadRoots() {
    try {
      libraryRoots = await window.electronAPI.library.getRoots();
    } catch (e) {
      console.error("Failed to load library roots:", e);
    }
  }

  let showRemoveRootDialog = $state(false);
  let rootToRemove = $state<string | null>(null);

  function handleRemoveRoot(root: string) {
    rootToRemove = root;
    showRemoveRootDialog = true;
  }

  async function confirmRemoveRoot() {
    if (!rootToRemove) return;

    loading = true;
    try {
      const res = await window.electronAPI.library.removeRoot(rootToRemove);
      if (res.success) {
        toasts.add("Library location removed", "success");
        await loadRoots();
        showRemoveRootDialog = false;
      } else {
        toasts.add(`Failed to remove: ${res.error}`, "error");
      }
    } catch (e) {
      console.error(e);
      toasts.add("Error removing library location", "error");
    } finally {
      loading = false;
      rootToRemove = null;
    }
  }

  async function handleSelectDownloadPath() {
    try {
      const path = await window.electronAPI.dialog.selectFolder();
      if (path) {
        await updateSetting("downloadPath", path);
      }
    } catch (e) {
      console.error("Failed to select download path:", e);
    }
  }

  async function handleLogin(siteKey: string) {
    loading = true;
    try {
      // @ts-ignore
      const success = await window.electronAPI.downloader.login(siteKey);
      if (success) {
        await refreshSettings();
        toasts.add(`Logged in to ${siteKey}`, "success");
      } else {
        toasts.add(`Login failed or cancelled for ${siteKey}`, "error");
      }
    } catch (e) {
      console.error(e);
      toasts.add(`Error during ${siteKey} login`, "error");
    } finally {
      loading = false;
    }
  }

  async function handleTrackingLogin(service: "mal" | "anilist") {
    const serviceLabel = service === "mal" ? "MAL" : "AniList";
    const wasConnected = isTrackingConnected(service);
    loading = true;
    try {
      const result = await window.electronAPI.manga.loginTracking(service);
      if (result?.status === "success") {
        toasts.add(`Connected to ${serviceLabel}`, "success");
        trackingAccounts = await window.electronAPI.manga.getTrackingAccounts();
        return;
      }

      if (result?.status === "cancelled") {
        if (wasConnected) {
          const disconnected =
            await window.electronAPI.manga.disconnectTracking(service);
          trackingAccounts =
            await window.electronAPI.manga.getTrackingAccounts();
          if (disconnected || !isTrackingConnected(service)) {
            toasts.add(`Disconnected from ${serviceLabel}`, "info");
          } else {
            toasts.add(`Failed to disconnect from ${serviceLabel}`, "error");
          }
        } else {
          toasts.add(`${serviceLabel} login cancelled`, "info");
        }
        return;
      }

      const errorText = String(result?.error || "").trim();
      toasts.add(
        errorText
          ? `Failed to connect to ${serviceLabel}: ${errorText}`
          : `Failed to connect to ${serviceLabel}`,
        "error",
      );
    } catch (e) {
      console.error(e);
      toasts.add(`Error connecting to ${serviceLabel}`, "error");
    } finally {
      loading = false;
    }
  }

  function isTrackingConnected(service: "mal" | "anilist") {
    return trackingAccounts.some((account) => {
      const accountService = String(account?.service || "").toLowerCase();
      if (accountService !== service) return false;
      if (!account?.is_active) return false;
      return String(account?.access_token || "").trim().length > 0;
    });
  }

  async function toggleIncognito() {
    try {
      incognitoMode = !incognitoMode;
      await window.electronAPI.manga.setIncognito(incognitoMode);
      toasts.add(
        `Incognito Mode: ${incognitoMode ? "Enabled" : "Disabled"}`,
        "info",
      );
    } catch (e) {
      console.error(e);
      toasts.add("Failed to toggle Incognito Mode", "error");
    }
  }

  async function toggleExtension(id: string, currentStatus: boolean) {
    try {
      await window.electronAPI.manga.toggleExtension(id, !currentStatus);
      extensions = await window.electronAPI.manga.getExtensions();
      toasts.add(
        `Extension ${!currentStatus ? "enabled" : "disabled"}`,
        "success",
      );
    } catch (e) {
      console.error(e);
      toasts.add("Failed to toggle extension", "error");
    }
  }

  async function refreshTrackingAccounts() {
    trackingAccounts = await window.electronAPI.manga.getTrackingAccounts();
  }

  async function importExtensionRepository() {
    const url = extensionRepositoryUrl.trim();
    if (!url || importingExtensionRepository) return;
    importingExtensionRepository = true;
    try {
      await window.electronAPI.manga.importExtensionRepository(url);
      extensionRepositoryUrl = "";
      extensions = await window.electronAPI.manga.getExtensions();
      toasts.add("Extension repository imported", "success");
    } catch (e) {
      console.error(e);
      toasts.add(
        e instanceof Error ? e.message : "Failed to import repository",
        "error",
      );
    } finally {
      importingExtensionRepository = false;
    }
  }

  function requestRemoveExtension(id: string, name: string) {
    extensionToRemove = { id, name };
  }

  function cancelRemoveExtension() {
    if (removingExtension) return;
    extensionToRemove = null;
  }

  async function confirmRemoveExtension() {
    if (!extensionToRemove || removingExtension) return;
    removingExtension = true;
    try {
      await window.electronAPI.manga.removeExtension(extensionToRemove.id);
      extensions = await window.electronAPI.manga.getExtensions();
      toasts.add("Extension removed", "success");
      extensionToRemove = null;
    } catch (e) {
      console.error(e);
      toasts.add("Failed to remove extension", "error");
    } finally {
      removingExtension = false;
    }
  }

  async function refreshExtensionRepository(url: string) {
    if (importingExtensionRepository) return;
    importingExtensionRepository = true;
    try {
      await window.electronAPI.manga.importExtensionRepository(url);
      extensions = await window.electronAPI.manga.getExtensions();
      toasts.add("Repository updated", "success");
    } catch (e) {
      console.error(e);
      toasts.add(
        e instanceof Error ? e.message : "Failed to update repository",
        "error",
      );
    } finally {
      importingExtensionRepository = false;
    }
  }

  async function toggleExtensionSite(
    extensionId: string,
    siteId: string,
    currentStatus: boolean,
  ) {
    try {
      await window.electronAPI.manga.toggleExtensionSite(
        extensionId,
        siteId,
        !currentStatus,
      );
      extensions = await window.electronAPI.manga.getExtensions();
      toasts.add(`Site ${!currentStatus ? "enabled" : "disabled"}`, "success");
    } catch (e) {
      console.error(e);
      toasts.add("Failed to toggle site", "error");
    }
  }

  function getExtensionSites(ext: any): MangaExtensionSite[] {
    return Array.isArray(ext?.sites) ? ext.sites : [];
  }

  function canManageExtensionSites(ext: any) {
    return getExtensionSites(ext).length > 0;
  }

  function toggleExtensionSitesPanel(extensionId: string) {
    if (!expandedExtensionSites[extensionId]) {
      const prefix = `${extensionId}:`;
      brokenSiteIcons = Object.fromEntries(
        Object.entries(brokenSiteIcons).filter(([key]) => !key.startsWith(prefix)),
      );
    }
    expandedExtensionSites = {
      ...expandedExtensionSites,
      [extensionId]: !expandedExtensionSites[extensionId],
    };
  }

  function handleExtensionHeaderClick(event: MouseEvent, ext: any) {
    if (!canManageExtensionSites(ext)) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button")) return;
    toggleExtensionSitesPanel(ext.id);
  }

  function handleExtensionHeaderKeydown(event: KeyboardEvent, ext: any) {
    if (!canManageExtensionSites(ext) || event.target !== event.currentTarget) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleExtensionSitesPanel(ext.id);
  }

  function getEnabledSiteCount(ext: any) {
    return getExtensionSites(ext).filter((site) => site.is_enabled).length;
  }

  function formatSiteHost(baseUrl?: string) {
    const raw = String(baseUrl || "").trim();
    if (!raw) return "";
    try {
      return new URL(raw).hostname.replace(/^www\./i, "");
    } catch {
      return raw;
    }
  }

  function getSiteIconStateKey(extensionId: string, siteId: string) {
    return `${extensionId}:${siteId}`;
  }

  function markSiteIconBroken(extensionId: string, siteId: string) {
    const key = getSiteIconStateKey(extensionId, siteId);
    brokenSiteIcons = {
      ...brokenSiteIcons,
      [key]: true,
    };
  }

  function canShowSiteIcon(extensionId: string, site: MangaExtensionSite) {
    if (!site.icon_url) return false;
    return !brokenSiteIcons[getSiteIconStateKey(extensionId, site.id)];
  }

  return {
    get loading() { return loading; },
    get pageLoading() { return pageLoading; },
    get settings() { return settings; },
    get showClearDialog() { return showClearDialog; },
    set showClearDialog(value) { showClearDialog = value; },
    get appVersion() { return appVersion; },
    get includeDescription() { return includeDescription; },
    set includeDescription(value) { includeDescription = value; },
    get includeKeywords() { return includeKeywords; },
    set includeKeywords(value) { includeKeywords = value; },
    get includeDefaultTags() { return includeDefaultTags; },
    set includeDefaultTags(value) { includeDefaultTags = value; },
    get excludedCategoryIds() { return excludedCategoryIds; },
    get allCategories() { return allCategories; },
    get showExcludedCategories() { return showExcludedCategories; },
    set showExcludedCategories(value) { showExcludedCategories = value; },
    get includeTypes() { return includeTypes; },
    set includeTypes(value) { includeTypes = value; },
    get includeDefaultTypes() { return includeDefaultTypes; },
    set includeDefaultTypes(value) { includeDefaultTypes = value; },
    get excludedTypeIds() { return excludedTypeIds; },
    get allTypes() { return allTypes; },
    get showExcludedTypes() { return showExcludedTypes; },
    set showExcludedTypes(value) { showExcludedTypes = value; },
    get includeDownloadHistory() { return includeDownloadHistory; },
    set includeDownloadHistory(value) { includeDownloadHistory = value; },
    get includeDownloadLogs() { return includeDownloadLogs; },
    set includeDownloadLogs(value) { includeDownloadLogs = value; },
    get incognitoMode() { return incognitoMode; },
    get extensions() { return extensions; },
    get extensionRepositoryUrl() { return extensionRepositoryUrl; },
    set extensionRepositoryUrl(value) { extensionRepositoryUrl = value; },
    get importingExtensionRepository() { return importingExtensionRepository; },
    get extensionToRemove() { return extensionToRemove; },
    get removingExtension() { return removingExtension; },
    get expandedExtensionSites() { return expandedExtensionSites; },
    get seriesTitleStyle() { return seriesTitleStyle; },
    set seriesTitleStyle(value) { seriesTitleStyle = value; },
    get isDragging() { return isDragging; },
    set isDragging(value) { isDragging = value; },
    get libraryRoots() { return libraryRoots; },
    get showRemoveRootDialog() { return showRemoveRootDialog; },
    set showRemoveRootDialog(value) { showRemoveRootDialog = value; },
    get rootToRemove() { return rootToRemove; },
    updateSetting,
    handleClearLibrary,
    handleBackup,
    handleRestore,
    toggleCategoryExclusion,
    selectAllCategories,
    deselectAllCategories,
    toggleTypeExclusion,
    selectAllTypes,
    deselectAllTypes,
    handleExportTags,
    handleImportTags,
    handleDrop,
    handleRemoveRoot,
    confirmRemoveRoot,
    handleSelectDownloadPath,
    handleLogin,
    handleTrackingLogin,
    isTrackingConnected,
    toggleIncognito,
    toggleExtension,
    refreshTrackingAccounts,
    importExtensionRepository,
    requestRemoveExtension,
    cancelRemoveExtension,
    confirmRemoveExtension,
    refreshExtensionRepository,
    toggleExtensionSite,
    getExtensionSites,
    canManageExtensionSites,
    toggleExtensionSitesPanel,
    handleExtensionHeaderClick,
    handleExtensionHeaderKeydown,
    getEnabledSiteCount,
    formatSiteHost,
    markSiteIconBroken,
    canShowSiteIcon,
  };
}

export type SettingsModel = ReturnType<typeof createSettingsModel>;
