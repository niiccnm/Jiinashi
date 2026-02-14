# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Folder Creation**: Added the ability to create new folders directly within the library view.
  - **Context-Aware**: Creates the folder as a sub-directory of the currently navigated folder or the selected library root.
  - **Keyboard Shortcut**: Added `Ctrl+Shift+N` global shortcut for quick folder creation.
  - **UI**: Added a minimalist "New Folder" icon button in the library header.
  - **Feedback**: Integrated toast notifications for error handling (e.g., duplicate names, no root selected).
  - **Files Modified**: `src/lib/views/Library.svelte`, `electron/main.ts`, `electron/preload.ts`.

- **Move Item/Folder**: Added a hierarchical tree-view to move items and folders, accessible via the **Context Menu** and **Bulk Selection Bar**.
  - Includes **Source Highlighting** and a **Collapse/Restore Toggle**.
  - **Inline Folder Creation**: Supports creating new folders directly in the tree with automatic expansion and focus.
  - **Technical Backend**: Implemented recursive directory moves in `main.ts` with cross-drive support (`EXDEV`) and file collision renaming.
  - **Files Created**: `src/lib/components/MoveToFolderDialog.svelte`.
  - **Files Modified**: `electron/preload.ts`, `electron/main.ts`, `electron/database/queries/library.ts`, `src/lib/views/Library.svelte`, `src/lib/components/BulkSelection.svelte`.

### Changed

- Changes in existing functionality

### Deprecated

- Soon-to-be removed features

### Removed

- Now removed features

### Fixed

- **Download Metadata Reactivity**: Fixed an issue where language badges (e.g., [EN], [JP]) were not visible on downloaded items in the library view until the application was restarted, even though the tags were correctly assigned.
  - **Files Modified**: `electron/downloader/manager.ts`.
- **Hitomi Language Tags**: Fixed an issue where downloads from Hitomi.la were missing language tags if the cross-referenced E-Hentai metadata didn't provide them. The parser now also checks Hitomi's own metadata for language information.
  - **Files Modified**: `electron/downloader/parsers/hitomi.ts`.

### Security

- Vulnerability fixes

---

## [v0.0.2] - 2026-02-12

### Added

- **Integrated In-Downloader System**: A built-in, high-performance download manager that fetches your content quickly and effortlessly.
  - **Site Support**: Native downloads straight from **nhentai**, **E-Hentai / ExHentai**, and **Hitomi.la**.
  - **Dynamic Quality Optimization**: Merges metadata across sources (e.g., EH + Hitomi) to select the highest resolution image version available.
  - **Advanced Stealth & Bypass Engine**:
    - **DNS-over-HTTPS (DoH)**: Native DoH integration via Cloudflare/Google to bypass ISP-level DNS blocks.
    - **Offscreen Bypass Solvers**: Background window orchestration for resolving Cloudflare Turnstile/Challenge pages automatically.
    - **Escalation Mode**: Seamless transition to visible manual verification windows if automated solvers fail.
    - **Identity Partitioning**: Isolated browser sessions per site with spoofed headers and persistent cookie synchronization.
  - **Intelligent Acquisition Logic**:
    - **Smart Image Refresh**: Automatically re-fetches valid image URLs if background links expire or fail during download.
    - **Automated WebP Conversion**: Transcodes user-generated WebP content to JPG automatically for maximum compatibility.
    - **Robust Error Recovery**: Task-level retry loops with smart backoff and session health verification.
  - **Per-Task Monitoring & UI**:
    - **Live Preview System**: Instant visual feedback with generated image previews during the download process.
    - **Detailed Per-Task Logs**: Native log inspection view with transmission details (headers, host info, dimensions) and 2000-line history.
    - **Persistent Queue Manager**: Multi-tab interface featuring real-time speed calculation, progress tracking, and source-specific branding (site icons). Queue and History tabs share the same database. Downloads persist across app restarts, and removing items from Queue does not affect History.
  - **Database & Site Infrastructure**:
    - **Site Authentication**: Integrated login/verification modules for E-Hentai and ExHentai directly into the **Settings page** for secure persistent cookie management.
    - **Persistent Download Tracking**: `download_history` table stores all download metadata, status, progress data (`total_images`, `downloaded_images`, `progress_percent`), and logs. Queue visibility controlled via `hidden_from_queue` flag.
    - **Automatic Category Routing**: Automatically organizes downloads into category-specific subfolders (e.g., `Doujinshi/`) within the main download directory to prepare for multi-type library expansion.
    - **Global Configuration**: Added centralized settings for download paths, concurrency, and acquisition delays.
  - **Library Integration**:
    - **Auto-Import Flow**: Downloaded items are automatically indexed and made available in the library view upon completion.
    - **Smart Tag & Type Bridging**: Site metadata is filtered and matched against the local database to preserve data integrity.
    - **Automatic View Refresh**: Triggers an immediate refresh of the **Library page** and current download directory for instant visibility of new arrivals without manual scanning.
  - **Files Created**: `electron/downloader/`, `src/lib/components/downloader/`, `src/lib/views/DownloadLogs.svelte`, `public/icons/sources/`.
  - **Files Modified**: `src/App.svelte`, `src/vite-env.d.ts`, `src/lib/stores/app.ts`, `src/lib/views/Downloader.svelte`, `src/lib/views/Settings.svelte`, `src/lib/views/Library.svelte`, `electron/database/database.ts`, `electron/preload.ts`, `electron/main.ts`, `vite.config.ts`.

- **Download History Export**: Added the ability to include completed downloads and queue items in backup files. This option is **enabled by default**.
  - **Optional Download Logs**: Included support for exporting detailed execution logs for each download history item (disabled by default).
  - **Enhanced Backup Portability**: Download history file paths are now automatically normalized to relative paths during export and resolved back to absolute paths during import based on current library roots.
  - **Files Modified**: `electron/main.ts`, `src/lib/views/Settings.svelte`, `electron/database/database.ts`.

- **RTL Mode Persistence**: The Right-to-Left (Manga Mode) reading setting is now included in backup exports, ensuring your reading preference is preserved when migrating data.
  - **Default Optimization**: Changed the default reading direction to **Right-to-Left (Manga Mode)** for new installations to better match the content type.
  - **Files Modified**: `electron/main.ts`, `src/lib/views/Reader.svelte`, `src/lib/views/Settings.svelte`, `electron/database/database.ts`.

- **Tag Manager Counters**: Added item counters to the Tags, Categories, and Types tabs to show the number of items currently displayed (filtered) versus the total available.
  - **Files Modified**: `src/lib/views/Tags.svelte`.

### Changed

- **Database Restructure**: Refactored the monolithic `electron/database.ts` into a modular `electron/database/` directory structure.
  - `database.ts`: Now strictly handles database connection, schema initialization, and global settings.
  - `metadata.ts`: Manages meta-definitions like Categories and Content Types (including their aliases), separating "what things are" from "actual library data".
  - `data/tag-defaults.ts`: Isolated the extensive list of default tags and categories into a dedicated static data file, significantly reducing noise in logic files.
  - `queries/`: Domain-specific logic has been split into dedicated modules:
    - `tags.ts`: Tag CRUD operations and alias management.
    - `library.ts`: Core library item management and search logic.
    - `downloads.ts`: Download history tracking and logging.
  - **Files Created**: `electron/database/database.ts`, `electron/database/metadata.ts`, `electron/database/data/tag-defaults.ts`, `electron/database/queries/tags.ts`, `electron/database/queries/library.ts`, `electron/database/queries/downloads.ts`, `electron/database/migrations/`.
  - **Files Modified**: `electron/main.ts`, `electron/ipc/tags.ts`, `electron/ipc/library.ts`.

- **Library & Collections**:
  - **Multi-Root Support**: Added a dedicated Library Switcher dropdown (`FolderSwitcher`) allowing users to toggle between specific imported library roots or view **"All Collections"** unified.
  - **Folder Sort Order**: Added a new setting to customize how library folders appear in the switcher dropdown (Alphabetical or Import Order). Folders now sort alphabetically by default.
  - **Legacy Export Support**: Integrated support for migrating categories, tags, and content types from v0.0.1 exports via new `importTags` and `importBackup` handlers.
  - **Context-Aware Search & Filtering**:
    - **Dynamic Filtering**: The new `FolderSwitcher` logic ensures that search queries and filters (categories, tags) are applied strictly within the context of the currently selected library root.
    - **Persistence**: Switching roots maintains the search/filter state where applicable, instantly updating results to show matches from the new location.
  - **Files Created**: `src/lib/components/FolderSwitcher.svelte`.
  - **Files Modified**: `src/lib/views/Library.svelte`, `src/lib/views/Favorites.svelte`, `src/lib/views/Settings.svelte`, `electron/main.ts`, `electron/database/database.ts`, `electron/database/queries/library.ts`.
- **Installer & Uninstaller Options**:
  - **Desktop Shortcut**: Added a toggle for creating a desktop shortcut during installation. The option is **toggled off by default** to minimize clutter and respect user preference.
  - **Clean Uninstallation**: Added an optional checkbox to the uninstaller allowing users to remove all local data (databases, history, covers) by deleting the `Jiinashi` folder in `AppData/Roaming`. This option is **toggled off by default** to prevent accidental data loss.
  - **Files Modified**: `build/installer.nsh`.
- **Export/Import Format Enhancement**: Enhanced backup and metadata export formats to track which library root each item belongs to via `roots` array and `rootIndex` fields. Import logic now performs precision matching by root name before falling back to sequential search, preventing mismatches when multiple roots share identical relative paths. Fully backward compatible with v0.0.1 exports.
  - **Files Modified**: `electron/main.ts`.
- **Backup Format Simplification**: Removed explicit `version` field from exported backups. The import logic now automatically detects the data structure (duck-typing) to ensure seamless compatibility with both v0.0.1 (array-based) and v0.0.2 (object-based)
  - Files modified: `electron/main.ts`.
- **Context-Aware File Counting**: The total file counter in the Library header now dynamically reflects the count of the currently selected root folder, providing a more accurate view of individual collections versus the global library total.
  - **Files Modified**: `electron/database/queries/library.ts`, `electron/main.ts`, `electron/preload.ts`, `src/vite-env.d.ts`, `src/lib/views/Library.svelte`.

- **Default Data Synchronization**:
  - **Auto-Update Mechanism**: The app now automatically syncs default tags, categories, and content types on every startup. This ensures that new descriptions, keyword fixes, and reclassifications from app updates are immediately applied to your existing database.
  - **User-Respecting Sync Toggle**: Added a new setting "Sync Default Data on Startup" (enabled by default). When disabled, the app switches to an additive-only mode that strictly preserves your manual edits to default tags and descriptions while still adding any strictly new defaults.
  - **Conflict Resolution**: The sync logic intelligently updates default entries (`is_default = 1`) and re-synchronizes aliases to match the app's definition, while strictly preserving all user-created tags and modifications.
  - **Ordered Keywords**: Added a new `sort_order` column to alias tables to guarantee that keywords appear in the specific order defined by the application, improving consistency in the Tags view.
  - **Files Modified**: `electron/database/database.ts`, `electron/database/metadata.ts`, `electron/database/data/tag-defaults.ts`, `electron/database/queries/tags.ts`, `src/lib/views/Settings.svelte`.

### Removed

- **Unsupported Formats**: Removed incomplete handlers for `.7z`, `.cb7`, and `.pdf` which lacked required dependencies.
  - **Files Modified**: `electron/archives/archive.ts`, `README.md`.

### Fixed

- **Library & Favorites UX**:
  - **Scroll Interaction**: Improved UI responsiveness by automatically dismissing autocomplete suggestions during drag-scroll gestures to prevent visual obstruction.
  - **View Stability**: Optimized state management during library root switching to eliminate UI flickering and ensure smooth view transitions.
  - **Files Modified**: `src/lib/views/Library.svelte`, `src/lib/views/Favorites.svelte`.
- **Dropdown Styling**: Fixed an issue where Settings dropdown options appeared with incorrect light-themed/grey colors when the mouse was moved off the menu.
  - **Files Modified**: `src/app.css`.

- **Orphaned Data Cleanup System**:
  - **Automatic Integrity Check**: Implemented a "3-strike" graduated miss counter that runs on every startup. Library items whose files are missing are flagged, and only removed after 3 consecutive startup checks confirm their absence. This prevents accidental data loss from temporary issues like unmounted external drives.
  - **Comprehensive Cleanup**: Automatically removes all associated data (tags, types, reading progress, page bookmarks) and cleans up cached cover images when an orphaned item is finally removed.
  - **Files Modified**: `electron/main.ts`, `electron/database/database.ts`, `electron/database/queries/library.ts`, `electron/coverExtractor.ts`.

---

## [0.0.1] - 2026-01-14

### Added

- Initial release with basic features
- Simple tag dataset
