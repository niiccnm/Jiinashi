<script lang="ts">
  import { tick } from "svelte";
  import { fuzzySearch } from "../../utils/fuzzySearch";
  import { settingsCategories, settingsCatalog, settingsSearchOptions, type SettingsCategory, type SettingSearchEntry } from "../settingsCatalog";

  let { category, oncategory, onlocate, disabled = false }: {
    category: SettingsCategory;
    oncategory: (category: SettingsCategory) => void;
    onlocate: (entry: SettingSearchEntry) => void;
    disabled?: boolean;
  } = $props();
  let query = $state("");
  let open = $state(false);
  let selected = $state(-1);
  let input: HTMLInputElement;
  const results = $derived(fuzzySearch(settingsCatalog, query, entry => [
    entry.label, entry.keywords || "", entry.description,
    settingsCategories.find(category => category.id === entry.category)!.label,
    entry.section,
  ], settingsSearchOptions));
  const visibleResults = $derived(results.slice(0, 6));
  const showResults = $derived(open && query.trim().length > 0);

  function locate(entry: SettingSearchEntry) {
    open = false;
    onlocate(entry);
  }

  async function searchKeydown(event: KeyboardEvent) {
    // Some IMEs end composition before the confirming keydown, leaving only 229.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Tab") {
      open = false;
      selected = -1;
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      query = "";
      open = false;
      selected = -1;
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!query.trim() || !visibleResults.length) return;
      event.preventDefault();
      open = true;
      selected = selected < 0
        ? (event.key === "ArrowDown" ? 0 : visibleResults.length - 1)
        : (selected + (event.key === "ArrowDown" ? 1 : -1) + visibleResults.length) % visibleResults.length;
      await tick();
      document.getElementById(`setting-result-${selected}`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && showResults && results.length) {
      event.preventDefault();
      locate(visibleResults[Math.max(0, selected)]);
    }
  }
</script>

<header class="settings-header">
  <div class="page-title flex items-center gap-4">
    <div class="h-10 w-10 flex items-center justify-center shrink-0">
      <svg aria-hidden="true" class="w-7 h-7 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </div>
    <div>
      <h1 class="text-xl font-bold text-white tracking-tight">Settings</h1>
      <p class="text-xs text-slate-500 font-medium tracking-wide uppercase">Preferences &amp; Config</p>
    </div>
  </div>
  <div class="search" onfocusout={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) open = false;
  }}>
    <div class="relative group">
      <svg aria-hidden="true" class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-blue-400 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
      <input
        class="w-full pl-10 pr-10 py-2.5 bg-slate-950/35 border border-slate-700/45 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:bg-slate-950/50 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-colors duration-200 shadow-sm"
        bind:this={input}
        bind:value={query}
        {disabled}
        role="combobox"
        aria-label="Search all settings"
        aria-autocomplete="list"
        aria-expanded={showResults}
        aria-controls="settings-search-results"
        aria-activedescendant={showResults && selected >= 0 ? `setting-result-${selected}` : undefined}
        placeholder="Search all settings…"
        autocomplete="off"
        spellcheck="false"
        oninput={() => { selected = -1; open = true; }}
        onfocus={() => (open = true)}
        onkeydown={searchKeydown}
      />
      {#if query}
        <button class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-white rounded-full hover:bg-slate-700/50 transition-colors" type="button" aria-label="Clear settings search" onclick={() => { query = ""; selected = -1; input.focus(); }}><svg aria-hidden="true" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
      {/if}
    </div>
    {#if showResults}
      <div class="search-popover">
        <div id="settings-search-results" role="listbox" aria-label="Matching settings" class="results">
          {#each visibleResults as entry, index (entry.id)}
            <button
              id={`setting-result-${index}`}
              type="button"
              role="option"
              tabindex="-1"
              aria-selected={selected === index}
              class:result-selected={selected === index}
              onclick={() => locate(entry)}
            >
              <span class="result-context">
                <span class="result-category">{settingsCategories.find(category => category.id === entry.category)!.label}</span>
                <span class="result-separator" aria-hidden="true">›</span>
                <span class="result-section">{entry.section}</span>
              </span>
              <span class="result-label">{entry.label}</span>
              <span class="result-description" title={entry.description}>{entry.description}</span>
            </button>
          {/each}
        </div>
        {#if !results.length}
          <p class="empty">No settings found</p>
        {/if}
        {#if results.length > visibleResults.length}
          <p class="search-hint">Showing 6 best matches</p>
        {/if}
        <span class="sr-only" aria-live="polite">{results.length} matching settings</span>
      </div>
    {/if}
  </div>
</header>

<aside class="settings-rail">
  <nav aria-label="Settings categories">
    {#each settingsCategories as item}
      <button
        type="button"
        class:current={category === item.id}
        aria-current={category === item.id ? "page" : undefined}
        onclick={() => { open = false; oncategory(item.id); }}
      >
        <span class="category-label">
          <svg class="category-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d={item.icon} /></svg>
          <span>{item.label}</span>
        </span>
        <svg class="category-chevron" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m8 5 5 5-5 5" /></svg>
      </button>
    {/each}
  </nav>
</aside>

<style>
  .settings-header { background-color: rgb(10 17 31 / 88%); backdrop-filter: blur(12px); border-bottom-width: 1px; border-bottom-style: solid; border-color: theme('colors.slate.700 / 45%'); grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 80px; padding: 16px 32px; z-index: 20; }
  .page-title, .settings-rail { user-select: none; }
  .search { position: relative; width: min(420px, 55%); }
  .search-popover { position: absolute; inset: calc(100% + 8px) 0 auto; border-width: 1px; border-style: solid; border-color: theme('colors.slate.700 / 70%'); background-color: theme('colors.slate.900'); border-radius: 12px;  box-shadow: 0 25px 50px -12px theme('colors.black / 50%'); overflow: hidden; }
  .results { max-height: min(380px, 55vh); overflow-y: auto; }
  .results button { display: flex; flex-direction: column; width: 100%; text-align: left; gap: 4px; padding: 12px 16px; }
  .results button:hover, .results .result-selected { background-color: theme('colors.slate.800'); }
  .results .result-selected { box-shadow: inset 0 0 0 1px theme('colors.blue.500 / 50%'); }
  .result-context { color: theme('colors.slate.500'); font-size: 10px; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .result-category { color: theme('colors.blue.400 / 85%'); font-weight: 600; }
  .result-separator { padding: 0 5px; color: theme('colors.slate.600'); }
  .result-label { color: theme('colors.slate.100'); font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .result-description { color: theme('colors.slate.400'); font-size: 11px; line-height: 1.5; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: theme('colors.slate.400'); padding: 18px 16px; font-size: 13px; line-height: 1.4; text-align: center; }
  .search-hint { padding: 8px 16px; color: theme('colors.slate.500'); font-size: 10px; }
  .settings-rail { min-height: 0; padding: 28px 16px; background-color: theme('colors.slate.950 / 35%'); border-right-width: 1px; border-right-style: solid; border-color: theme('colors.slate.700 / 30%'); overflow-y: auto; }
  nav { display: flex; flex-direction: column; gap: 4px; }
  nav button { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; padding: 10px 12px; border-left: 2px solid transparent; border-radius: 0 7px 7px 0; color: theme('colors.slate.400'); text-align: left; font-size: 13px; }
  nav button:hover { color: theme('colors.white'); background-color: theme('colors.white / 1.5%'); }
  nav button.current { color: theme('colors.white'); border-left-color: theme('colors.blue.400'); }
  .category-label { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .category-icon { width: 16px; height: 16px; flex-shrink: 0; }
  .current .category-icon { color: theme('colors.blue.400'); }
  .category-chevron { width: 14px; height: 14px; flex-shrink: 0; opacity: 0; }
  .current .category-chevron { opacity: 1; }
  button:focus-visible { box-shadow: inset 0 0 0 2px theme('colors.blue.400 / 70%'); }
  @media (max-width: 900px) {
    .settings-header { padding: 16px 20px; }
    .settings-rail { grid-column: 1 / -1; padding: 10px 16px; border-right: 0; border-bottom-width: 1px; border-bottom-style: solid; border-color: theme('colors.slate.700 / 35%'); }
    nav { flex-direction: row; overflow-x: auto; }
    nav button { width: auto; flex-shrink: 0; padding: 8px 12px; border-left: 0; border-bottom: 2px solid transparent; border-radius: 6px 6px 0 0; }
    nav button.current { border-bottom-color: theme('colors.blue.400'); }
    .category-chevron { display: none; }
  }
  @media (max-width: 520px) {
    .settings-header { align-items: stretch; flex-direction: column; gap: 12px; }
    .search { width: 100%; }
  }
</style>
