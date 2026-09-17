export const settingsCategories = [
  { id: "general", label: "General", description: "App updates, appearance, and content visibility.", icon: "M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6" },
  { id: "library", label: "Library", description: "Manage source folders and their display order.", icon: "M4 4h4v16H4zM8 4h4v16H8zM15 4l4-1 4 16-4 1z" },
  { id: "reading", label: "Reader", description: "Default page layout, image scaling, and reading direction.", icon: "M12 6v15m0-15C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2Z" },
  { id: "downloads", label: "Downloads", description: "Download location, request limits, and site sign-in.", icon: "M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" },
  { id: "manga", label: "Manga & tracking", description: "Title language, private reading, and connected tracking accounts.", icon: "M4 19.5V5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5a2.5 2.5 0 0 1 0-5H20M9 10l2 2 4-4" },
  { id: "extensions", label: "Extensions", description: "Install repositories and manage available sources.", icon: "M9 4H4v5a3 3 0 1 1 0 6v5h5a3 3 0 1 1 6 0h5v-5a3 3 0 1 0 0-6V4h-5a3 3 0 1 0-6 0Z" },
  { id: "data", label: "Data", description: "Back up, restore, transfer, or clear your library data.", icon: "M20 5c0 2-4 3-8 3S4 7 4 5s4-3 8-3 8 1 8 3ZM4 5v14c0 2 4 3 8 3s8-1 8-3V5M4 12c0 2 4 3 8 3s8-1 8-3" },
] as const;

export type SettingsCategory = typeof settingsCategories[number]["id"];

// Ignore common English filler, but keep action words such as "change" and "remove".
export const settingsSearchOptions = {
  ignoreWords: ["a", "an", "the", "i", "my", "me", "we", "you", "your", "please",
    "where", "how", "what", "can", "could", "would", "do", "does", "is", "are",
    "to", "of", "for", "in", "it", "this", "that"],
  partialCoverage: true,
  unorderedCharacters: true,
  balancedTypos: true,
  titleInitials: true,
};
export type SettingSearchEntry = {
  id: string;
  category: SettingsCategory;
  section: string;
  label: string;
  description: string;
  keywords?: string;
  /** Used when the matching child control is hidden. */
  fallback?: string;
};

export const settingsCatalog: readonly SettingSearchEntry[] = [
  { id: "version", category: "general", section: "App Info", label: "Application Version", description: "The current version of Jiinashi installed on your system", keywords: "about release installed number" },
  { id: "updates", category: "general", section: "App Info", label: "Automatically Check for Updates", description: "Check for new versions when the app starts", keywords: "startup upgrade automatic update check" },
  { id: "sync", category: "general", section: "App Info", label: "Sync Default Data on Startup", description: "Keep default tags updated. Turn off to preserve your manual edits.", keywords: "synchronize refresh built in tags preserve edits" },
  { id: "theme", category: "general", section: "Appearance", label: "Theme", description: "Choose your preferred visual theme", keywords: "appearance dark light change" },
  { id: "background", category: "general", section: "Appearance", label: "Background Color", description: "Custom solid background for the reader", keywords: "appearance colour reader canvas" },
  { id: "animations", category: "general", section: "Appearance", label: "Animations", description: "Enable smooth transitions and effects", keywords: "appearance motion turn on off disable enable effects" },
  { id: "blur", category: "general", section: "Appearance", label: "Blur R18 Content", description: "Apply a blur effect to covers of R18 items", keywords: "adult privacy nsfw visibility hide censor obscure covers" },
  { id: "blur-hover", category: "general", section: "Appearance", label: "Reveal on Hover", description: "Temporarily remove blur when hovering over the cover. Requires Blur R18 Content.", fallback: "blur", keywords: "show hidden cover mouse" },
  { id: "blur-intensity", category: "general", section: "Appearance", label: "Blur Intensity", description: "Adjust the strength of the blur effect. Requires Blur R18 Content.", fallback: "blur", keywords: "stronger weaker cover blur" },
  { id: "view-mode", category: "reading", section: "Reader Experience", label: "Default View Mode", description: "How would you like to read by default?", keywords: "reader single double page webtoon scroll layout choose reading pages" },
  { id: "scaling", category: "reading", section: "Reader Experience", label: "Scaling Mode", description: "Default image scaling strategy", keywords: "reader best fit cover screen width height zoom resize image" },
  { id: "direction", category: "reading", section: "Reader Experience", label: "Right-to-Left", description: "Standard manga reading direction", keywords: "reader rtl manga mode read backwards left right" },
  { id: "download-location", category: "downloads", section: "Downloader", label: "Download Location", description: "Change the folder for downloaded files", keywords: "path directory save choose change download folder" },
  { id: "concurrent", category: "downloads", section: "Downloader", label: "Concurrent Downloads", description: "Number of items to download at once", keywords: "parallel simultaneous queue download limit" },
  { id: "delay", category: "downloads", section: "Downloader", label: "Image Delay (ms)", description: "Wait time between image requests to avoid rate limits", keywords: "speed throttle slow down requests pause wait" },
  { id: "history", category: "downloads", section: "Downloader", label: "Max History Items", description: "Number of completed downloads to keep in history", keywords: "limit keep completed download records" },
  { id: "authentication", category: "downloads", section: "Site Authentication", label: "E-Hentai / ExHentai", description: "Site authentication", keywords: "sign in login cookies account into restricted sites" },
  { id: "series-title", category: "manga", section: "Manga preferences", label: "Series Title Language", description: "Choose how manga titles are displayed throughout the app", keywords: "romaji english original native shown display manga title language" },
  { id: "incognito", category: "manga", section: "Manga preferences", label: "Incognito Mode", description: "Prevent automatic tracker updates while reading; manual edits still sync", keywords: "privacy private history ctrl shift i stop automatic progress updates reading" },
  { id: "mal", category: "manga", section: "Tracking Services", label: "MyAnimeList", description: "Connect or reconnect your tracker and manage its client ID", keywords: "mal account login custom oauth link reading progress tracking" },
  { id: "anilist", category: "manga", section: "Tracking Services", label: "AniList", description: "Connect or reconnect your tracker and manage its client ID", keywords: "account login custom oauth link reading progress tracking" },
  { id: "repository", category: "extensions", section: "Extension Management", label: "Add Extension Repository", description: "Paste a compatible JSON catalog URL. Only import repositories you trust.", keywords: "install source plugin add catalog packages" },
  { id: "installed", category: "extensions", section: "Extension Management", label: "Installed Extensions", description: "Manage installed packages and the sites available through them.", keywords: "enable disable update remove sources manage source sites turn on off" },
  { id: "folder-sort", category: "library", section: "Library Locations", label: "Folder Sort Order", description: "How library folders are displayed in the switcher", keywords: "alphabetical import order reorder folders alphabetically" },
  { id: "locations", category: "library", section: "Library Locations", label: "Library Locations", description: "Manage imported source folders", keywords: "path directory remove manage imported directories" },
  { id: "backup", category: "data", section: "Data Management", label: "Backup / Export", description: "Save your reading progress and favorites to a JSON file", keywords: "save library favorites progress file" },
  { id: "backup-history", category: "data", section: "Data Management", label: "Include Download History", description: "Include completed downloads and queue items in the backup", keywords: "export queue completed downloads" },
  { id: "backup-logs", category: "data", section: "Data Management", label: "Include Detailed Logs", description: "Include full execution logs for each download. Requires Include Download History.", fallback: "backup-history", keywords: "export download details" },
  { id: "restore", category: "data", section: "Data Management", label: "Restore / Relocate", description: "Restore data or apply it to a new location", keywords: "backup import drag drop move library recover" },
  { id: "import", category: "data", section: "Data Management", label: "Import Metadata", description: "Restore tags, categories, and types from export file", keywords: "drag drop load saved tags types categories" },
  { id: "export", category: "data", section: "Data Management", label: "Export Metadata", description: "Export tags, categories, and types with item associations", keywords: "save tags types categories" },
  { id: "descriptions", category: "data", section: "Data Management", label: "Include Descriptions", description: "Include descriptions in exported metadata", keywords: "export tag descriptions" },
  { id: "keywords", category: "data", section: "Data Management", label: "Include Keywords", description: "Include keywords in exported metadata", keywords: "export tag aliases" },
  { id: "default-tags", category: "data", section: "Data Management", label: "Include Default Tags", description: "Include default tags in exported metadata", keywords: "export built in tags" },
  { id: "exclude-categories", category: "data", section: "Data Management", label: "Exclude Categories", description: "Selected categories and their tags will be omitted from the export.", fallback: "export", keywords: "omit tag categories" },
  { id: "types", category: "data", section: "Data Management", label: "Include Types", description: "Include types in exported metadata", keywords: "export book types" },
  { id: "default-types", category: "data", section: "Data Management", label: "Include Default Types", description: "Include default types in exported metadata. Requires Include Types.", fallback: "types", keywords: "export built in types" },
  { id: "exclude-types", category: "data", section: "Data Management", label: "Exclude Types", description: "Selected types will be omitted from the export. Requires Include Types.", fallback: "types", keywords: "omit book types" },
  { id: "clear", category: "data", section: "Danger Zone", label: "Clear Library Database", description: "Permanently removes imported books and metadata. Physical files will not be touched.", keywords: "delete reset erase empty library remove database" },
];
