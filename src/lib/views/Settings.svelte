<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fade } from "svelte/transition";
  import Dialog from "../components/Dialog.svelte";
  import { toasts } from "../stores/toast";
  import { dragScroll } from "../utils/dragScroll";

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

  async function refreshSettings() {
    try {
      const allSettings = await window.electronAPI.settings.getAll();
      settings = allSettings || {};
      await loadRoots();
      allCategories = await window.electronAPI.categories.getAll();
      allTypes = await window.electronAPI.types.getAll();
      appVersion = await window.electronAPI.utils.getVersion();
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
</script>

<div
  class="h-full flex flex-col bg-gray-950 text-gray-100 font-sans selection:bg-blue-500/30 overflow-hidden"
>
  <Dialog
    open={showClearDialog}
    title="Clear Library Database"
    description="Are you sure you want to remove ALL items from your library? This action cannot be undone and will remove all metadata and reading progress. Your physical files will not be deleted."
    confirmText="Clear Library"
    variant="danger"
    {loading}
    onConfirm={handleClearLibrary}
    onCancel={() => (showClearDialog = false)}
  />

  <Dialog
    open={showRemoveRootDialog}
    title="Remove Library Location"
    description={`Are you sure you want to remove this library location?\n\n${rootToRemove}\n\nThis will remove all books and metadata associated with this folder from your database. Your files will NOT be deleted.`}
    confirmText="Remove Location"
    variant="danger"
    {loading}
    onConfirm={confirmRemoveRoot}
    onCancel={() => (showRemoveRootDialog = false)}
  />

  <!-- Header -->
  <header
    class="sticky top-0 z-10 bg-gray-950/80 backdrop-blur-md border-b border-white/5 px-8 h-20 flex items-center justify-between flex-shrink-0"
  >
    <div class="flex items-center gap-4">
      <div class="h-10 w-10 flex items-center justify-center">
        <svg
          class="w-7 h-7 text-blue-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </div>
      <div>
        <h1 class="text-xl font-bold text-white tracking-tight">Settings</h1>
        <p class="text-xs text-slate-500 font-medium tracking-wide uppercase">
          Preferences & Config
        </p>
      </div>
    </div>
  </header>

  <main
    class="flex-1 overflow-y-auto px-6 py-12"
    use:dragScroll={{ axis: "y" }}
  >
    {#if pageLoading}
      <div class="flex items-center justify-center h-full">
        <div
          class="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"
        ></div>
      </div>
    {:else}
      <div class="max-w-3xl mx-auto space-y-16 pb-20">
        <!-- System Section -->
        <section>
          <h2
            class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
          >
            App Info
          </h2>

          <div
            class="space-y-1 bg-white/[0.02] rounded-2xl border border-white/[0.06] overflow-hidden"
          >
            <!-- Version Info -->
            <div
              class="flex items-center justify-between p-5 border-b border-white/[0.04]"
            >
              <div class="flex flex-col">
                <span class="text-base font-medium text-slate-200"
                  >Application Version</span
                >
                <span class="text-sm text-slate-500"
                  >The current version of Jiinashi installed on your system</span
                >
              </div>
              <span
                class="text-sm font-mono text-slate-400 bg-white/[0.04] px-3 py-1 rounded-full"
              >
                v{appVersion}
              </span>
            </div>

            <!-- Auto-Update Toggle -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors cursor-pointer outline-none focus:bg-white/[0.04]"
              role="button"
              tabindex="0"
              onclick={() =>
                updateSetting(
                  "autoCheckUpdates",
                  !settings["autoCheckUpdates"] ||
                    settings["autoCheckUpdates"] === "false"
                    ? "true"
                    : "false",
                )}
              onkeydown={(e) =>
                e.key === "Enter" &&
                updateSetting(
                  "autoCheckUpdates",
                  !settings["autoCheckUpdates"] ||
                    settings["autoCheckUpdates"] === "false"
                    ? "true"
                    : "false",
                )}
            >
              <div class="flex flex-col">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Automatically Check for Updates</span
                >
                <span class="text-sm text-slate-500"
                  >Check for new versions when the app starts</span
                >
              </div>

              <!-- Toggle Switch -->
              <div
                class={`relative w-12 h-7 rounded-full transition-colors duration-300 ${!settings["autoCheckUpdates"] || settings["autoCheckUpdates"] === "true" ? "bg-blue-600" : "bg-slate-700"}`}
              >
                <div
                  class={`absolute left-1 top-1 bg-white w-5 h-5 rounded-full shadow-sm transition-transform duration-300 ${!settings["autoCheckUpdates"] || settings["autoCheckUpdates"] === "true" ? "translate-x-5" : "translate-x-0"}`}
                ></div>
              </div>
            </div>
          </div>
        </section>

        <!-- Appearance Section -->
        <section>
          <h2
            class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
          >
            Appearance
          </h2>

          <div
            class="space-y-1 bg-white/[0.02] rounded-2xl border border-white/[0.06] overflow-hidden"
          >
            <!-- Theme -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
            >
              <div class="flex flex-col">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Theme</span
                >
                <span class="text-sm text-slate-500"
                  >Choose your preferred visual theme</span
                >
              </div>
              <div class="relative">
                <select
                  value={settings["theme"] || "dark"}
                  onchange={(e) =>
                    updateSetting("theme", e.currentTarget.value)}
                  class="appearance-none bg-slate-900/50 text-slate-200 pl-4 pr-10 py-2 rounded-lg border border-white/10 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none transition-all cursor-pointer hover:bg-slate-900"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
                <div
                  class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500"
                >
                  <svg
                    class="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    ><path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 9l-7 7-7-7"
                    /></svg
                  >
                </div>
              </div>
            </div>

            <div class="h-px bg-white/[0.06] mx-5"></div>

            <!-- Background Color -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
            >
              <div class="flex flex-col">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Background Color</span
                >
                <span class="text-sm text-slate-500"
                  >Custom solid background for the reader</span
                >
              </div>
              <div class="flex items-center gap-3">
                <span class="text-xs font-mono text-slate-500 uppercase"
                  >{settings["backgroundColor"] || "#000000"}</span
                >
                <div
                  class="relative h-9 w-16 rounded-lg overflow-hidden border border-white/10 shadow-sm ring-2 ring-white/5 transition-transform active:scale-95"
                >
                  <input
                    type="color"
                    value={settings["backgroundColor"] || "#000000"}
                    onchange={(e) =>
                      updateSetting("backgroundColor", e.currentTarget.value)}
                    class="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] p-0 m-0 cursor-pointer border-none"
                  />
                </div>
              </div>
            </div>

            <div class="h-px bg-white/[0.06] mx-5"></div>

            <!-- Animations -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors cursor-pointer outline-none focus:bg-white/[0.04]"
              role="button"
              tabindex="0"
              onclick={() =>
                updateSetting(
                  "enableAnimations",
                  !settings["enableAnimations"] ||
                    settings["enableAnimations"] === "false"
                    ? "true"
                    : "false",
                )}
              onkeydown={(e) =>
                e.key === "Enter" &&
                updateSetting(
                  "enableAnimations",
                  !settings["enableAnimations"] ||
                    settings["enableAnimations"] === "false"
                    ? "true"
                    : "false",
                )}
            >
              <div class="flex flex-col">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Animations</span
                >
                <span class="text-sm text-slate-500"
                  >Enable smooth transitions and effects</span
                >
              </div>

              <!-- Toggle Switch -->
              <div
                class={`relative w-12 h-7 rounded-full transition-colors duration-300 ${settings["enableAnimations"] === "true" ? "bg-blue-600" : "bg-slate-700"}`}
              >
                <div
                  class={`absolute left-1 top-1 bg-white w-5 h-5 rounded-full shadow-sm transition-transform duration-300 ${settings["enableAnimations"] === "true" ? "translate-x-5" : "translate-x-0"}`}
                ></div>
              </div>
            </div>

            <div class="h-px bg-white/[0.06] mx-5"></div>

            <!-- Blur R18 -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors cursor-pointer outline-none focus:bg-white/[0.04]"
              role="button"
              tabindex="0"
              onclick={() =>
                updateSetting(
                  "blurR18",
                  !settings["blurR18"] || settings["blurR18"] === "false"
                    ? "true"
                    : "false",
                )}
              onkeydown={(e) =>
                e.key === "Enter" &&
                updateSetting(
                  "blurR18",
                  !settings["blurR18"] || settings["blurR18"] === "false"
                    ? "true"
                    : "false",
                )}
            >
              <div class="flex flex-col">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Blur R18 Content</span
                >
                <span class="text-sm text-slate-500"
                  >Apply a blur effect to covers of R18 items</span
                >
              </div>

              <!-- Toggle Switch -->
              <div
                class={`relative w-12 h-7 rounded-full transition-colors duration-300 ${settings["blurR18"] === "true" ? "bg-blue-600" : "bg-slate-700"}`}
              >
                <div
                  class={`absolute left-1 top-1 bg-white w-5 h-5 rounded-full shadow-sm transition-transform duration-300 ${settings["blurR18"] === "true" ? "translate-x-5" : "translate-x-0"}`}
                ></div>
              </div>
            </div>

            {#if settings["blurR18"] === "true"}
              <div transition:fade={{ duration: 200 }}>
                <!-- Separator -->
                <div class="h-px bg-white/[0.06] mx-5"></div>

                <!-- Reveal on Hover -->
                <div
                  class="group flex items-center justify-between p-5 pl-10 hover:bg-white/[0.02] transition-colors cursor-pointer outline-none focus:bg-white/[0.04]"
                  role="button"
                  tabindex="0"
                  onclick={() =>
                    updateSetting(
                      "blurR18Hover",
                      !settings["blurR18Hover"] ||
                        settings["blurR18Hover"] === "false"
                        ? "true"
                        : "false",
                    )}
                  onkeydown={(e) =>
                    e.key === "Enter" &&
                    updateSetting(
                      "blurR18Hover",
                      !settings["blurR18Hover"] ||
                        settings["blurR18Hover"] === "false"
                        ? "true"
                        : "false",
                    )}
                >
                  <div class="flex flex-col">
                    <span
                      class="text-sm font-medium text-slate-300 group-hover:text-white transition-colors"
                      >Reveal on Hover</span
                    >
                    <span class="text-xs text-slate-500"
                      >Temporarily remove blur when hovering over the cover</span
                    >
                  </div>

                  <!-- Toggle Switch -->
                  <div
                    class={`relative w-10 h-6 rounded-full transition-colors duration-300 ${settings["blurR18Hover"] === "true" ? "bg-blue-600" : "bg-slate-700"}`}
                  >
                    <div
                      class={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform duration-300 ${settings["blurR18Hover"] === "true" ? "translate-x-4" : "translate-x-0"}`}
                    ></div>
                  </div>
                </div>

                <!-- Separator -->
                <div class="h-px bg-white/[0.06] mx-5"></div>

                <!-- Blur Intensity -->
                <div class="p-5 pl-10 hover:bg-white/[0.02] transition-colors">
                  <div class="flex items-center justify-between mb-3">
                    <div class="flex flex-col">
                      <span class="text-sm font-medium text-slate-300"
                        >Blur Intensity</span
                      >
                      <span class="text-xs text-slate-500"
                        >Adjust the strength of the blur effect</span
                      >
                    </div>
                    <span
                      class="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-1 rounded"
                    >
                      {settings["blurR18Intensity"] || "12"}px
                    </span>
                  </div>

                  <input
                    type="range"
                    min="4"
                    max="32"
                    step="2"
                    value={settings["blurR18Intensity"] || "12"}
                    oninput={(e) =>
                      updateSetting("blurR18Intensity", e.currentTarget.value)}
                    class="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                </div>
              </div>
            {/if}
          </div>
        </section>

        <!-- Reader Section -->
        <section>
          <h2
            class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
          >
            Reader Experience
          </h2>

          <div
            class="space-y-1 bg-white/[0.02] rounded-2xl border border-white/[0.06] overflow-hidden"
          >
            <!-- View Mode -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
            >
              <div class="flex flex-col">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Default View Mode</span
                >
                <span class="text-sm text-slate-500"
                  >How would you like to read by default?</span
                >
              </div>
              <div class="relative">
                <select
                  value={settings["defaultViewMode"] || "single"}
                  onchange={(e) =>
                    updateSetting("defaultViewMode", e.currentTarget.value)}
                  class="appearance-none bg-slate-900/50 text-slate-200 pl-4 pr-10 py-2 rounded-lg border border-white/10 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none transition-all cursor-pointer hover:bg-slate-900"
                >
                  <option value="single">Single Page</option>
                  <option value="double">Double Page</option>
                  <option value="webtoon">Webtoon (Scroll)</option>
                </select>
                <div
                  class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500"
                >
                  <svg
                    class="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    ><path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 9l-7 7-7-7"
                    /></svg
                  >
                </div>
              </div>
            </div>

            <div class="h-px bg-white/[0.06] mx-5"></div>

            <!-- Fit Mode -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
            >
              <div class="flex flex-col">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Scaling Mode</span
                >
                <span class="text-sm text-slate-500"
                  >Default image scaling strategy</span
                >
              </div>
              <div class="relative">
                <select
                  value={settings["defaultFitMode"] || "contain"}
                  onchange={(e) =>
                    updateSetting("defaultFitMode", e.currentTarget.value)}
                  class="appearance-none bg-slate-900/50 text-slate-200 pl-4 pr-10 py-2 rounded-lg border border-white/10 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none transition-all cursor-pointer hover:bg-slate-900"
                >
                  <option value="contain">Best Fit</option>
                  <option value="cover">Cover Screen</option>
                  <option value="width">Fit Width</option>
                  <option value="height">Fit Height</option>
                </select>
                <div
                  class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500"
                >
                  <svg
                    class="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    ><path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 9l-7 7-7-7"
                    /></svg
                  >
                </div>
              </div>
            </div>

            <div class="h-px bg-white/[0.06] mx-5"></div>

            <!-- Manga Mode -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors cursor-pointer outline-none focus:bg-white/[0.04]"
              role="button"
              tabindex="0"
              onclick={() =>
                updateSetting(
                  "mangaMode",
                  !settings["mangaMode"] || settings["mangaMode"] === "false"
                    ? "true"
                    : "false",
                )}
              onkeydown={(e) =>
                e.key === "Enter" &&
                updateSetting(
                  "mangaMode",
                  !settings["mangaMode"] || settings["mangaMode"] === "false"
                    ? "true"
                    : "false",
                )}
            >
              <div class="flex flex-col">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Right-to-Left</span
                >
                <span class="text-sm text-slate-500"
                  >Standard manga reading direction</span
                >
              </div>
              <!-- Toggle Switch -->
              <div
                class={`relative w-12 h-7 rounded-full transition-colors duration-300 ${settings["mangaMode"] === "true" ? "bg-blue-600" : "bg-slate-700"}`}
              >
                <div
                  class={`absolute left-1 top-1 bg-white w-5 h-5 rounded-full shadow-sm transition-transform duration-300 ${settings["mangaMode"] === "true" ? "translate-x-5" : "translate-x-0"}`}
                ></div>
              </div>
            </div>
          </div>
        </section>

        <!-- Downloader Section -->
        <section>
          <h2
            class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
          >
            Downloader
          </h2>

          <div
            class="space-y-1 bg-white/[0.02] rounded-2xl border border-white/[0.06] overflow-hidden"
          >
            <!-- Download Path -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
            >
              <div class="flex flex-col overflow-hidden mr-4">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Download Location</span
                >
                <span
                  class="text-sm text-slate-500 truncate"
                  title={settings["downloadPath"]}
                >
                  {settings["downloadPath"] || "Not set"}
                </span>
              </div>
              <button
                onclick={handleSelectDownloadPath}
                class="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-medium rounded-lg transition-colors border border-blue-500/20 active:scale-95 shrink-0"
              >
                Change
              </button>
            </div>

            <div class="h-px bg-white/[0.06] mx-5"></div>

            <!-- Concurrent Downloads -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
            >
              <div class="flex flex-col">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Concurrent Downloads</span
                >
                <span class="text-sm text-slate-500"
                  >Number of items to download at once</span
                >
              </div>
              <div class="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={settings["concurrentDownloads"] || "2"}
                  onchange={(e) =>
                    updateSetting("concurrentDownloads", e.currentTarget.value)}
                  class="w-16 bg-slate-900/50 text-slate-200 px-3 py-1.5 rounded-lg border border-white/10 focus:border-blue-500/50 focus:outline-none transition-all text-center font-mono"
                />
              </div>
            </div>

            <div class="h-px bg-white/[0.06] mx-5"></div>

            <!-- Download Delay -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
            >
              <div class="flex flex-col">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Image Delay (ms)</span
                >
                <span class="text-sm text-slate-500"
                  >Wait time between image requests to avoid rate limits</span
                >
              </div>
              <div class="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  max="5000"
                  step="100"
                  value={settings["downloadDelay"] || "500"}
                  onchange={(e) =>
                    updateSetting("downloadDelay", e.currentTarget.value)}
                  class="w-20 bg-slate-900/50 text-slate-200 px-3 py-1.5 rounded-lg border border-white/10 focus:border-blue-500/50 focus:outline-none transition-all text-center font-mono"
                />
              </div>
            </div>

            <div class="h-px bg-white/[0.06] mx-5"></div>

            <!-- Max History -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
            >
              <div class="flex flex-col">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Max History Items</span
                >
                <span class="text-sm text-slate-500"
                  >Number of completed downloads to keep in history</span
                >
              </div>
              <div class="flex items-center gap-3">
                <input
                  type="number"
                  min="10"
                  max="500"
                  step="10"
                  value={settings["maxHistoryItems"] || "50"}
                  onchange={(e) =>
                    updateSetting("maxHistoryItems", e.currentTarget.value)}
                  class="w-20 bg-slate-900/50 text-slate-200 px-3 py-1.5 rounded-lg border border-white/10 focus:border-blue-500/50 focus:outline-none transition-all text-center font-mono"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- Site Authentication Section -->
        <section>
          <h2
            class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
          >
            Site Authentication
          </h2>

          <div
            class="space-y-1 bg-white/[0.02] rounded-2xl border border-white/[0.06] overflow-hidden"
          >
            <!-- E-Hentai / ExHentai -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
            >
              <div class="flex flex-col">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >E-Hentai / ExHentai</span
                >
                <div class="flex items-center gap-2 mt-1">
                  {#if settings["cookies:e-hentai"] || settings["cookies:exhentai"]}
                    <span
                      class="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20"
                    >
                      <div
                        class="w-1.5 h-1.5 rounded-full bg-emerald-400"
                      ></div>
                      Authenticated
                    </span>
                  {:else}
                    <span class="text-sm text-slate-500">Not logged in</span>
                  {/if}
                </div>
              </div>
              <button
                onclick={() => handleLogin("e-hentai")}
                disabled={loading}
                class="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-medium rounded-lg transition-colors border border-blue-500/20 active:scale-95 shrink-0"
              >
                {settings["cookies:e-hentai"] || settings["cookies:exhentai"]
                  ? "Re-login"
                  : "Login"}
              </button>
            </div>
          </div>
        </section>

        <!-- Library Locations -->
        <section>
          <h2
            class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
          >
            Library Locations
          </h2>

          <div
            class="bg-white/[0.02] rounded-2xl border border-white/[0.06] overflow-hidden"
          >
            <!-- Library Sort Order -->
            <div
              class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
            >
              <div class="flex flex-col">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Folder Sort Order</span
                >
                <span class="text-sm text-slate-500"
                  >How library folders are displayed in the switcher</span
                >
              </div>
              <div class="relative">
                <select
                  value={settings["librarySortOrder"] || "alphabetical"}
                  onchange={(e) =>
                    updateSetting("librarySortOrder", e.currentTarget.value)}
                  class="appearance-none bg-slate-900/50 text-slate-200 pl-4 pr-10 py-2 rounded-lg border border-white/10 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none transition-all cursor-pointer hover:bg-slate-900"
                >
                  <option value="alphabetical">Alphabetical</option>
                  <option value="imported">Import Order</option>
                </select>
                <div
                  class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500"
                >
                  <svg
                    class="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    ><path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 9l-7 7-7-7"
                    /></svg
                  >
                </div>
              </div>
            </div>

            <div class="h-px bg-white/[0.06] mx-5"></div>

            {#if libraryRoots.length === 0}
              <div class="p-8 text-center text-slate-500 text-sm">
                No library locations found. Import a folder to get started.
              </div>
            {:else}
              {#each libraryRoots as root, i}
                <div
                  class="group flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors {i !==
                  libraryRoots.length - 1
                    ? 'border-b border-white/[0.06]'
                    : ''}"
                >
                  <div class="flex flex-col overflow-hidden mr-4">
                    <span
                      class="text-base font-medium text-slate-200 group-hover:text-white transition-colors truncate"
                      title={root}>{root}</span
                    >
                    <span class="text-xs text-slate-500">Source Folder</span>
                  </div>
                  <button
                    onclick={() => handleRemoveRoot(root)}
                    disabled={loading}
                    class="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-sm font-medium rounded-lg transition-colors border border-rose-500/20 active:scale-95 disabled:opacity-50 shrink-0"
                  >
                    Remove
                  </button>
                </div>
              {/each}
            {/if}
          </div>
        </section>

        <!-- Data Management Section -->
        <section>
          <h2
            class="text-sm font-bold text-blue-400 uppercase tracking-widest mb-6 px-2"
          >
            Data Management
          </h2>

          <div
            class="space-y-1 bg-white/[0.02] rounded-2xl border border-white/[0.06] overflow-hidden"
          >
            <!-- Backup -->
            <div class="group p-5 hover:bg-white/[0.02] transition-colors">
              <div class="flex items-center justify-between">
                <div class="flex flex-col">
                  <span
                    class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                    >Backup / Export</span
                  >
                  <span class="text-sm text-slate-500"
                    >Save your reading progress and favorites to a JSON file</span
                  >
                </div>
                <button
                  onclick={handleBackup}
                  disabled={loading}
                  class="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-medium rounded-lg transition-colors border border-emerald-500/20 active:scale-95 disabled:opacity-50"
                >
                  Backup
                </button>
              </div>

              <!-- Backup Options -->
              <div
                class="mt-4 flex flex-col gap-3 p-4 bg-emerald-500/[0.03] rounded-2xl border border-emerald-500/10 shadow-inner"
              >
                <!-- Include Download History -->
                <div class="flex items-center justify-between">
                  <div class="flex flex-col gap-0.5">
                    <span class="text-sm font-semibold text-slate-200"
                      >Include Download History</span
                    >
                    <span class="text-xs text-slate-500"
                      >Include completed downloads and queue items</span
                    >
                  </div>
                  <!-- Custom Switch -->
                  <div
                    class="relative w-10 h-6 rounded-full transition-colors duration-200 cursor-pointer {includeDownloadHistory
                      ? 'bg-emerald-500'
                      : 'bg-slate-700'}"
                    role="button"
                    tabindex="0"
                    onclick={() =>
                      (includeDownloadHistory = !includeDownloadHistory)}
                    onkeydown={(e) =>
                      e.key === "Enter" &&
                      (includeDownloadHistory = !includeDownloadHistory)}
                  >
                    <div
                      class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform duration-200 {includeDownloadHistory
                        ? 'translate-x-4'
                        : 'translate-x-0'}"
                    ></div>
                  </div>
                </div>

                {#if includeDownloadHistory}
                  <!-- Connector Line -->
                  <div class="flex gap-4">
                    <div class="ml-4 w-px bg-emerald-500/20 rounded-full"></div>

                    <!-- Include Download Logs -->
                    <div class="flex-1 flex items-center justify-between py-1">
                      <div class="flex flex-col gap-0.5">
                        <span class="text-xs font-medium text-slate-400"
                          >Include Detailed Logs</span
                        >
                        <span class="text-[10px] text-slate-500"
                          >Include full execution logs for each download</span
                        >
                      </div>
                      <!-- Custom Switch -->
                      <div
                        class="relative w-9 h-5 rounded-full transition-colors duration-200 cursor-pointer {includeDownloadLogs
                          ? 'bg-emerald-500'
                          : 'bg-slate-800'}"
                        role="button"
                        tabindex="0"
                        onclick={() =>
                          (includeDownloadLogs = !includeDownloadLogs)}
                        onkeydown={(e) =>
                          e.key === "Enter" &&
                          (includeDownloadLogs = !includeDownloadLogs)}
                      >
                        <div
                          class="absolute left-1 top-1 bg-white w-3 h-3 rounded-full shadow-sm transition-transform duration-200 {includeDownloadLogs
                            ? 'translate-x-4'
                            : 'translate-x-0'}"
                        ></div>
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            </div>

            <div class="h-px bg-white/[0.06] mx-5"></div>

            <!-- Restore -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="group relative flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors overflow-hidden"
              class:bg-blue-500_10={isDragging}
              ondragenter={() => (isDragging = true)}
              ondragover={(e) => e.preventDefault()}
              ondragleave={(e) => {
                // Check if we're moving to a child element to prevent flashing
                const relatedTarget = e.relatedTarget as Node;
                if (
                  !relatedTarget ||
                  !e.currentTarget.contains(relatedTarget)
                ) {
                  isDragging = false;
                }
              }}
              ondrop={handleDrop}
            >
              <!-- Drag Overlay -->
              {#if isDragging}
                <div
                  class="absolute inset-0 bg-blue-500/20 flex items-center justify-center z-10 backdrop-blur-[1px] border border-blue-500/30"
                >
                  <div
                    class="bg-blue-950/90 text-blue-200 px-4 py-2 rounded-xl shadow-xl border border-blue-500/30 font-medium flex items-center gap-2 pointer-events-none"
                  >
                    <svg
                      class="w-5 h-5 animate-bounce"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      /></svg
                    >
                    Drop to Restore
                  </div>
                </div>
              {/if}

              <div class="flex flex-col relative z-0">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Restore / Relocate</span
                >
                <span class="text-sm text-slate-500"
                  >Restore data or apply it to a new location</span
                >
                <span
                  class="text-xs text-blue-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
                >
                  <svg
                    class="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    ><path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    /></svg
                  >
                  Drag & Drop backup file here
                </span>
              </div>
              <button
                onclick={() => handleRestore()}
                disabled={loading}
                class="relative z-0 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-medium rounded-lg transition-colors border border-blue-500/20 active:scale-95 disabled:opacity-50"
              >
                Restore
              </button>
            </div>

            <div class="h-px bg-white/[0.06] mx-5"></div>

            <!-- Import Tags -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="group relative flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors overflow-hidden"
              class:bg-blue-500_10={isDragging}
              ondragenter={() => (isDragging = true)}
              ondragover={(e) => e.preventDefault()}
              ondragleave={() => (isDragging = false)}
              onpointerup={() => (isDragging = false)}
              ondrop={handleDrop}
            >
              {#if isDragging}
                <div
                  class="absolute inset-0 bg-blue-500/10 flex items-center justify-center z-10"
                >
                  <div
                    class="flex items-center gap-2 text-blue-400 font-bold uppercase tracking-wider text-xs"
                  >
                    <svg
                      class="w-5 h-5 animate-bounce"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      /></svg
                    >
                    Drop Tags File
                  </div>
                </div>
              {/if}

              <div class="flex flex-col relative z-0">
                <span
                  class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                  >Import Metadata</span
                >
                <span class="text-sm text-slate-500"
                  >Restore tags, categories, and types from export file</span
                >
              </div>
              <button
                onclick={() => handleImportTags()}
                disabled={loading}
                class="relative z-0 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-medium rounded-lg transition-colors border border-blue-500/20 active:scale-95 disabled:opacity-50"
              >
                Import
              </button>
            </div>

            <div class="h-px bg-white/[0.06] mx-5"></div>

            <!-- Tag Export -->
            <div
              class="group flex flex-col p-5 hover:bg-white/[0.02] transition-colors"
            >
              <div class="flex items-center justify-between mb-6">
                <div class="flex flex-col">
                  <span
                    class="text-base font-medium text-slate-200 group-hover:text-white transition-colors"
                    >Export Metadata</span
                  >
                  <span class="text-sm text-slate-500"
                    >Export tags, categories, and types with item associations</span
                  >
                </div>
                <button
                  onclick={handleExportTags}
                  disabled={loading}
                  class="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-medium rounded-lg transition-colors border border-blue-500/20 active:scale-95 disabled:opacity-50"
                >
                  Export
                </button>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-2">
                <!-- Include Descriptions -->
                <label
                  class="flex items-center gap-3 cursor-pointer group/label"
                >
                  <div class="relative flex items-center">
                    <input
                      type="checkbox"
                      bind:checked={includeDescription}
                      class="peer sr-only"
                    />
                    <div
                      class="w-10 h-6 bg-slate-700 peer-checked:bg-blue-600 rounded-full transition-colors"
                    ></div>
                    <div
                      class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4"
                    ></div>
                  </div>
                  <span
                    class="text-xs font-medium text-slate-400 group-hover/label:text-slate-200 transition-colors"
                  >
                    Include Descriptions
                  </span>
                </label>

                <!-- Include Keywords -->
                <label
                  class="flex items-center gap-3 cursor-pointer group/label"
                >
                  <div class="relative flex items-center">
                    <input
                      type="checkbox"
                      bind:checked={includeKeywords}
                      class="peer sr-only"
                    />
                    <div
                      class="w-10 h-6 bg-slate-700 peer-checked:bg-blue-600 rounded-full transition-colors"
                    ></div>
                    <div
                      class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4"
                    ></div>
                  </div>
                  <span
                    class="text-xs font-medium text-slate-400 group-hover/label:text-slate-200 transition-colors"
                  >
                    Include Keywords
                  </span>
                </label>

                <!-- Include Default Tags -->
                <label
                  class="flex items-center gap-3 cursor-pointer group/label"
                >
                  <div class="relative flex items-center">
                    <input
                      type="checkbox"
                      bind:checked={includeDefaultTags}
                      class="peer sr-only"
                    />
                    <div
                      class="w-10 h-6 bg-slate-700 peer-checked:bg-blue-600 rounded-full transition-colors"
                    ></div>
                    <div
                      class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4"
                    ></div>
                  </div>
                  <span
                    class="text-xs font-medium text-slate-400 group-hover/label:text-slate-200 transition-colors"
                  >
                    Include Default Tags
                  </span>
                </label>
              </div>

              <!-- Exclude Categories -->
              {#if allCategories.length > 0}
                <div class="mt-6 pt-6 border-t border-slate-700/50">
                  <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-4">
                      <p
                        class="text-[10px] font-bold text-slate-500 uppercase tracking-wider"
                      >
                        Exclude Categories
                      </p>
                      {#if showExcludedCategories}
                        <div class="flex items-center gap-2">
                          <button
                            onclick={selectAllCategories}
                            type="button"
                            class="text-[10px] font-bold text-slate-400 hover:text-slate-200 transition-colors uppercase tracking-wider"
                          >
                            Select All
                          </button>
                          <span class="text-[10px] text-slate-700">|</span>
                          <button
                            onclick={deselectAllCategories}
                            type="button"
                            class="text-[10px] font-bold text-slate-400 hover:text-slate-200 transition-colors uppercase tracking-wider"
                          >
                            Deselect All
                          </button>
                        </div>
                      {/if}
                    </div>
                    <button
                      onclick={() =>
                        (showExcludedCategories = !showExcludedCategories)}
                      type="button"
                      class="text-[10px] font-bold text-blue-500 hover:text-blue-400 transition-colors uppercase tracking-wider flex items-center gap-1"
                    >
                      <span>{showExcludedCategories ? "Hide" : "Show"}</span>
                      <svg
                        class="w-3 h-3 transition-transform {showExcludedCategories
                          ? 'rotate-180'
                          : ''}"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </button>
                  </div>

                  {#if showExcludedCategories}
                    <div class="flex flex-wrap gap-2">
                      {#each allCategories as cat}
                        <button
                          onclick={() => toggleCategoryExclusion(cat.id)}
                          type="button"
                          class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border {excludedCategoryIds.includes(
                            cat.id,
                          )
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                            : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'}"
                        >
                          {cat.name}
                        </button>
                      {/each}
                    </div>
                    <p class="mt-2 text-[10px] text-slate-500 italic">
                      Selected categories and their tags will be omitted from
                      the export.
                    </p>
                  {/if}
                </div>
              {/if}

              <!-- Types Export Options -->
              <div class="mt-6 pt-6 border-t border-slate-700/50">
                <p
                  class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-4"
                >
                  Types Options
                </p>
                <div class="flex items-center gap-4 mb-4">
                  <label
                    class="flex items-center gap-3 cursor-pointer group/label"
                  >
                    <div class="relative flex items-center">
                      <input
                        type="checkbox"
                        bind:checked={includeTypes}
                        class="peer sr-only"
                      />
                      <div
                        class="w-10 h-6 bg-slate-700 peer-checked:bg-blue-600 rounded-full transition-colors"
                      ></div>
                      <div
                        class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4"
                      ></div>
                    </div>
                    <span
                      class="text-xs font-medium text-slate-400 group-hover/label:text-slate-200 transition-colors"
                    >
                      Include Types
                    </span>
                  </label>

                  {#if includeTypes}
                    <label
                      class="flex items-center gap-3 cursor-pointer group/label"
                    >
                      <div class="relative flex items-center">
                        <input
                          type="checkbox"
                          bind:checked={includeDefaultTypes}
                          class="peer sr-only"
                        />
                        <div
                          class="w-10 h-6 bg-slate-700 peer-checked:bg-blue-600 rounded-full transition-colors"
                        ></div>
                        <div
                          class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4"
                        ></div>
                      </div>
                      <span
                        class="text-xs font-medium text-slate-400 group-hover/label:text-slate-200 transition-colors"
                      >
                        Include Default Types
                      </span>
                    </label>
                  {/if}
                </div>

                {#if includeTypes && allTypes.length > 0}
                  <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-4">
                      <p
                        class="text-[10px] font-bold text-slate-500 uppercase tracking-wider"
                      >
                        Exclude Types
                      </p>
                      {#if showExcludedTypes}
                        <div class="flex items-center gap-2">
                          <button
                            onclick={selectAllTypes}
                            type="button"
                            class="text-[10px] font-bold text-slate-400 hover:text-slate-200 transition-colors uppercase tracking-wider"
                          >
                            Select All
                          </button>
                          <span class="text-[10px] text-slate-700">|</span>
                          <button
                            onclick={deselectAllTypes}
                            type="button"
                            class="text-[10px] font-bold text-slate-400 hover:text-slate-200 transition-colors uppercase tracking-wider"
                          >
                            Deselect All
                          </button>
                        </div>
                      {/if}
                    </div>
                    <button
                      onclick={() => (showExcludedTypes = !showExcludedTypes)}
                      type="button"
                      class="text-[10px] font-bold text-blue-500 hover:text-blue-400 transition-colors uppercase tracking-wider flex items-center gap-1"
                    >
                      <span>{showExcludedTypes ? "Hide" : "Show"}</span>
                      <svg
                        class="w-3 h-3 transition-transform {showExcludedTypes
                          ? 'rotate-180'
                          : ''}"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </button>
                  </div>

                  {#if showExcludedTypes}
                    <div class="flex flex-wrap gap-2">
                      {#each allTypes as type}
                        <button
                          onclick={() => toggleTypeExclusion(type.id)}
                          type="button"
                          class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border {excludedTypeIds.includes(
                            type.id,
                          )
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                            : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'}"
                        >
                          {type.name}
                        </button>
                      {/each}
                    </div>
                    <p class="mt-2 text-[10px] text-slate-500 italic">
                      Selected types will be omitted from the export.
                    </p>
                  {/if}
                {/if}
              </div>
            </div>
          </div>
        </section>

        <!-- Danger Zone -->
        <section>
          <h2
            class="text-sm font-bold text-rose-500 uppercase tracking-widest mb-6 px-2"
          >
            Danger Zone
          </h2>

          <div
            class="bg-rose-500/[0.03] rounded-2xl border border-rose-500/10 p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:bg-rose-500/[0.05] transition-colors"
          >
            <div>
              <h3 class="text-rose-200 font-medium mb-1">
                Clear Library Database
              </h3>
              <p class="text-rose-200/50 text-sm max-w-md">
                Permanently removes all imported books and metadata from the
                database. Your physical files will not be touched.
              </p>
            </div>

            <button
              onclick={() => (showClearDialog = true)}
              disabled={loading}
              class="flex items-center justify-center gap-2 px-6 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-medium rounded-xl transition-all border border-rose-500/20 hover:border-rose-500/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shadow-lg shadow-rose-900/10"
            >
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              <span>Clear Library</span>
            </button>
          </div>
        </section>
      </div>
    {/if}
  </main>
</div>
