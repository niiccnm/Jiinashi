<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import Dialog from "../components/Dialog.svelte";
  import { dragScroll } from "../utils/dragScroll";
  import { settingsCategories, type SettingsCategory, type SettingSearchEntry } from "./settingsCatalog";
  import { createSettingsModel } from "./settings/createSettingsModel.svelte";
  import SettingsNavigation from "./settings/SettingsNavigation.svelte";
  import GeneralSettings from "./settings/GeneralSettings.svelte";
  import ReadingSettings from "./settings/ReadingSettings.svelte";
  import DownloadsSettings from "./settings/DownloadsSettings.svelte";
  import MangaSettings from "./settings/MangaSettings.svelte";
  import ExtensionsSettings from "./settings/ExtensionsSettings.svelte";
  import LibrarySettings from "./settings/LibrarySettings.svelte";
  import DataSettings from "./settings/DataSettings.svelte";

  const model = createSettingsModel();
  const views = { general: GeneralSettings, reading: ReadingSettings, downloads: DownloadsSettings,
    manga: MangaSettings, extensions: ExtensionsSettings,
    library: LibrarySettings, data: DataSettings };
  let category = $state<SettingsCategory>("general");
  let content: HTMLElement;
  let heading = $state<HTMLHeadingElement>();
  let highlighted: HTMLElement | null = null;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let locationRequest = 0;
  let locationNotice = $state("");
  const current = $derived(settingsCategories.find(item => item.id === category)!);

  function clearHighlight() {
    locationRequest += 1;
    clearTimeout(highlightTimer);
    highlightTimer = undefined;
    highlighted?.classList.remove("setting-located");
    highlighted = null;
    locationNotice = "";
  }

  onDestroy(clearHighlight);

  async function selectCategory(next: SettingsCategory) {
    clearHighlight();
    category = next;
    await tick();
    content?.scrollTo({ top: 0 });
  }

  async function locate(entry: SettingSearchEntry) {
    clearHighlight();
    const request = locationRequest;
    category = entry.category;
    await tick();
    if (request !== locationRequest) return;
    const find = (id: string) => content?.querySelector<HTMLElement>('[data-setting="' + id + '"]');
    let target = find(entry.id);
    if (!target && entry.fallback) {
      target = find(entry.fallback);
      locationNotice = entry.description;
    }
    if (!target) {
      heading?.focus({ preventScroll: true });
      return;
    }
    highlighted = target;
    // Commit the removed class so locating the same row restarts its cue.
    void target.offsetWidth;
    target.classList.add("setting-located");
    // Match the 1200ms hold plus 600ms fade; allow one frame before cleanup.
    const highlightDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1200 : 1850;
    highlightTimer = setTimeout(() => {
      target.classList.remove("setting-located");
      highlighted = null;
      highlightTimer = undefined;
    }, highlightDuration);
    // Focus the row without activating a toggle, opening a dialog, or changing a value.
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center", behavior: "instant" });
  }
</script>

<div class="settings-page">
  <Dialog
    open={model.showClearDialog}
    title="Clear Library Database"
    description="Are you sure you want to remove ALL items from your library? This action cannot be undone and will remove all metadata and reading progress. Your physical files will not be deleted."
    confirmText="Clear Library"
    variant="danger"
    loading={model.loading}
    onConfirm={model.handleClearLibrary}
    onCancel={() => (model.showClearDialog = false)}
  />

  <Dialog
    open={model.showRemoveRootDialog}
    title="Remove Library Location"
    description={`Are you sure you want to remove this library location?\n\n${model.rootToRemove}\n\nThis will remove all books and metadata associated with this folder from your database. Your files will NOT be deleted.`}
    confirmText="Remove Location"
    variant="danger"
    loading={model.loading}
    onConfirm={model.confirmRemoveRoot}
    onCancel={() => (model.showRemoveRootDialog = false)}
  />

  <Dialog
    open={model.extensionToRemove !== null}
    title="Remove Extension"
    description={`Are you sure you want to remove "${model.extensionToRemove?.name ?? "this extension"}"? Its sources will no longer be available. Downloaded files will not be deleted.`}
    confirmText="Remove Extension"
    variant="danger"
    loading={model.removingExtension}
    onConfirm={model.confirmRemoveExtension}
    onCancel={model.cancelRemoveExtension}
  />

  <SettingsNavigation {category} oncategory={selectCategory} onlocate={locate} disabled={model.pageLoading} />

  <main bind:this={content} class="settings-content" use:dragScroll={{ axis: "y" }}>
    {#if model.pageLoading}
      <div class="loading" role="status" aria-label="Loading settings">
        <div class="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
      </div>
    {:else}
      <div class="content-inner">
        <div class="category-heading">
          <h2 bind:this={heading} tabindex="-1">{current.label}</h2>
          <p>{current.description}</p>
        </div>
        {#if locationNotice}
          <p class="location-notice" role="status">{locationNotice}</p>
        {/if}
        {#each settingsCategories as item}
          {@const CategoryView = views[item.id]}
          <div class="category-view" hidden={category !== item.id}>
            <CategoryView {model} />
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>

<style>
  .settings-page { display: grid; grid-template-columns: 208px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); height: 100%; min-height: 0; overflow: hidden; background: #0a111f; color: theme('colors.slate.100'); }
  .settings-content { min-height: 0; min-width: 0; overflow-y: auto; padding: 30px 36px 64px; }
  .content-inner { width: 100%; max-width: 860px; margin: 0 auto; }
  .category-heading { margin-bottom: 28px; }
  .category-heading h2 { color: theme('colors.slate.100'); font-size: 23px; font-weight: 600; letter-spacing: -.025em; outline: none; }
  .category-heading p { margin-top: 6px; color: theme('colors.slate.400'); font-size: 13px; line-height: 1.6; }
  .category-view[hidden] { display: none; }
  .category-view :global(section + section) { margin-top: 32px; }
  .category-view :global(section > h2), .category-view :global(section > div > h2) { margin-bottom: 14px; padding-left: 0; font-size: 11px; font-weight: 600; letter-spacing: .08em; }
  .category-view :global([data-setting]) { scroll-margin: 24px; }
  .category-view :global(.setting-located) { background-color: theme('colors.blue.500 / 5%'); border-radius: 8px; animation: setting-locate 1800ms ease-out forwards; }
  @keyframes setting-locate {
    0%, 66.667% { background-color: theme('colors.blue.500 / 5%'); }
    100% { background-color: transparent; }
  }
  .category-view :global(button:focus-visible), .category-view :global([role="button"]:focus-visible), .category-view :global(input:focus-visible), .category-view :global(select:focus-visible) { box-shadow: inset 0 0 0 2px theme('colors.blue.400 / 70%'); }
  .category-view :global(label:has(> input.sr-only)) { position: relative; }
  .category-view :global(label:has(input:focus-visible)) { box-shadow: inset 0 0 0 2px theme('colors.blue.400 / 70%'); border-radius: 4px; }
  .category-view :global(.rounded-2xl.overflow-hidden > label:first-child:has(input:focus-visible)) { border-top-left-radius: inherit; border-top-right-radius: inherit; }
  .category-view :global(.rounded-2xl.overflow-hidden > label:last-child:has(input:focus-visible)) { border-bottom-left-radius: inherit; border-bottom-right-radius: inherit; }
  .location-notice { margin-bottom: 20px; border-left-width: 2px; border-left-style: solid; border-color: theme('colors.blue.400'); padding: 8px 12px; color: theme('colors.blue.200'); background-color: theme('colors.blue.500 / 10%'); font-size: 13px; }
  .loading { height: 100%; display: flex; align-items: center; justify-content: center; }
  @media (max-width: 1100px) {
    .settings-content { padding: 26px 24px 48px; }
    .category-view :global(.group.flex.items-center.justify-between) { gap: 16px; flex-wrap: wrap; }
    .category-view :global(.group.flex.items-center.justify-between > .flex-col) { flex: 1 1 200px; }
    .category-view :global(.group.flex.items-center.justify-between > .relative.w-12) { flex-shrink: 0; }
  }
  @media (max-width: 900px) {
    .settings-page { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr); }
  }
  @media (max-width: 520px) {
    .settings-content { padding: 24px 16px 40px; }
    .category-heading h2 { font-size: 21px; }
    .category-view :global(.p-5) { padding: 16px; }
    .category-view :global(.flex.items-center.justify-between) { gap: 12px; flex-wrap: wrap; }
  }
  @media (prefers-reduced-motion: reduce) {
    .category-view :global(.setting-located) { animation: none; }
    .settings-page :global(*) { animation-duration: .01ms !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
  }
</style>
