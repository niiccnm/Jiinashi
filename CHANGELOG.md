# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Reader Greyscale Mode**: Added a neutral greyscale display filter for pages in Single Page, Double Page, and Webtoon modes.
  - **Controls**: Can be toggled from the reader settings panel or with `Ctrl+Shift+C`; resetting Image Display also turns it off.
  - **Image Fidelity**: Removes color without adding contrast, shifting brightness, clipping tones, or modifying the source image.
  - **Files Modified**: `electron/app-windows.ts`, `electron/preload/bridge-misc.ts`, `electron/preload/types.ts`, `src/lib/components/Reader/ReaderSettings.svelte`, `src/lib/components/Reader/SinglePageCanvas.svelte`, `src/lib/components/Reader/DoublePageCanvas.svelte`, `src/lib/components/Reader/WebtoonCanvas.svelte`, `src/lib/views/Reader.svelte`.

### Changed

- **Reader Settings Panel**: Redesigned the reader settings panel with a cleaner layout and faster, smoother transitions while preserving the reader's existing behavior.
  - **Page Layout and Sizing**: Added visual previews for page layout and sizing options.
  - **Reading Direction**: Replaced the Manga Mode toggle with explicit left-to-right and right-to-left choices.
  - **Image Display Controls**: Added editable values and individual reset buttons for brightness, contrast, and gamma.
  - **Reader Interaction**: The panel handles its own wheel and drag scrolling while image zooming, panning, and middle-click reset remain available outside it.
  - **Files Modified**: `src/lib/components/Reader/ReaderSettings.svelte`, `src/lib/views/Reader.svelte`.

### Deprecated
- Soon-to-be removed features

### Removed
- Now removed features

### Fixed
- Bug fixes

### Security
- Vulnerability fixes

---

## [v0.0.3] - 2026-08-29

### Added

- **Folder Creation**: Added the ability to create new folders directly within the library view.
  - **Context-Aware**: Creates the folder as a sub-directory of the currently navigated folder or the selected library root.
  - **Keyboard Shortcut**: Added `Ctrl+Shift+N` to open the folder creation dialog while browsing the Library.
  - **UI**: Added a minimalist "New Folder" icon button in the library header.
  - **Feedback**: Shows a toast when no library location is selected and displays creation errors, such as duplicate names, inside the dialog.
  - **Files Modified**: `src/lib/views/Library.svelte`, `electron/main.ts`, `electron/preload.ts`, `electron/app-ipc.ts`, `electron/preload/bridge-library.ts`.

- **Move Item/Folder**: Added a hierarchical tree-view to move items and folders, accessible via the **Context Menu** and **Bulk Selection Bar**.
  - Includes **Source Highlighting** and a **Collapse/Restore Toggle**.
  - **Inline Folder Creation**: Supports creating new folders directly in the tree with automatic expansion and focus.
  - **Technical Backend**: Supports recursive directory moves, including moves between drives and automatic renaming when filenames conflict.
  - **Files Created**: `src/lib/components/MoveToFolderDialog.svelte`.
  - **Files Modified**: `electron/preload.ts`, `electron/main.ts`, `electron/database/queries/library.ts`, `src/lib/views/Library.svelte`, `src/lib/components/BulkSelection.svelte`, `electron/app-ipc.ts`, `electron/preload/bridge-library.ts`.

- **Manga Downloader**: Added a Manga tab to the Downloader page alongside the existing Doujinshi tab. Manga chapters are obtained through extensions imported by the user, downloaded by the app, and added to the local library.
  - **Browsing and Downloads**: The Manga tab shows trending and popular titles from AniList and searches AniList and Mangabaka. Users can open a series, find its chapters through imported sources, and add selected chapters to the Manga download queue. Queue progress, status, previews, cancellation, retries, and logs remain available from the shared Downloader page.
  - **Browsing History**: During the current session, the Manga tab keeps search results and restores the browser's scroll position when returning from a series. Switching between Manga and Doujinshi also preserves their scroll positions. Mouse back and forward buttons navigate the Manga browsing history.
  - **Source Icons and Manga Artwork**: Imported Manga sources can provide their own names and icons for use in the Manga tab, Settings, and download queue. Series covers are loaded from the selected source or from the metadata services used by the app.
  - **Manual Source URL**: If the app cannot find the correct series page on a source, the user can paste its exact URL and load the available chapters for the current session.
  - **Title Language Preference**: Added a setting for showing Manga titles in English, Native, or Romaji. Native uses the title in its original language, such as Japanese, Korean, or Chinese, while Romaji uses its romanized form. The selected title is used across the Manga tab, series pages, recommendations, MLV, and new download file names.
  - **Extension Repositories**: Users can paste a compatible external repository or catalog link in Settings to import its Manga extensions into the app. Imported extensions become available from the Manga tab, and the repository can later be refreshed to retrieve updated versions of its extensions. Installed extensions can be enabled, disabled, or removed, and individual sites supplied by an extension can also be enabled or disabled.
  - **Download Folders**: Manga is saved in a separate `Manga` directory inside the configured download location, defaulting to `Documents/Jiinashi Downloads/Manga` when no location is selected. Each series receives its own folder, and each completed chapter is packed as a CBZ file.
  - **Source-Based File Names**: A source identifies where a chapter came from. For chapters downloaded through the app, it is the supported site added by an extension, such as MangaFire, Comix, or MangaDex. For files added manually, the source label can instead identify the scanlation group or uploader that supplied the release. Keeping this label at the beginning of the filename lets chapters and alternate releases from several sources remain organized in the same series folder. Files downloaded by the app follow the general format `[Source] Series Title - Ch. Number - Chapter Title (Language) [Scanlator].cbz`, with language and scanlator information included when available. Conflicting new downloads receive a numbered suffix, while a requested redownload replaces its previously linked file.
  - **Library Import**: After a chapter finishes downloading, the app scans the series folder and adds it to the library. The imported folder is marked as Manga or Webtoon according to the series reading format.
  - **Key Files Created**: `electron/downloader/manga-downloader.ts`, `electron/downloader/manga-queue.ts`, `electron/extensions/loader.ts`, `electron/library/manga-linker/title-utils.ts`, `electron/manga-ipc.ts`, `src/lib/components/manga/MetadataBrowser.svelte`, `src/lib/components/manga/MangaSeriesView.svelte`, `src/lib/components/manga/MangaRecommendations.svelte`, `src/lib/components/manga/sourceCatalog.ts`, `src/lib/components/manga/series-view/`, `src/lib/utils/manga.ts`.
  - **Key Files Modified**: `src/lib/components/downloader/DownloadItem.svelte`, `src/lib/views/Downloader.svelte`, `src/lib/views/Settings.svelte`, `vite.config.ts`, `src/lib/views/DownloadLogs.svelte`.

- **Manga Library View (MLV)**: Added a Manga-specific view inside the existing Library for browsing downloaded series and chapters linked to Manga records.
  - **Library Layouts**: MLV can be switched between a cover-based Grid view similar to the normal Library layout and a List view. Both layouts keep each Manga series and its downloaded chapters together with their covers, titles, and chapter counts.
  - **Series Header Artwork**: Opening a series in MLV shows its cover over a wide AniList banner when one is available. The banner URL is saved with the Manga series and reused when the view is opened again, while the image itself remains remote. Series without an available banner use a dark gradient background instead.
  - **Source-Based Organization**: MLV uses the source label in each filename to group chapters into separate tabs, keeping releases from different sources apart and making it easier to browse between them. Each tab shows its chapter count, and tabs are ordered from most chapters to fewest, with alphabetical ordering when counts are equal. Within each tab, chapters use descending title order, with numeric parts such as 10 appearing before 2.
  - **View Switching**: `Ctrl+Shift+V` switches Manga folders between MLV and the normal Library view.
  - **Chapter Options**: Downloaded chapter cards use the same three-dot options menu available for books in the normal Library view.
  - **Library Actions**: The view can continue reading a downloaded chapter, open a series in the Manga downloader, open its external source, and access its tracking information.
  - **Shared Library**: MLV uses the same local library and files as the rest of the app; Manga records are linked to those items instead of being stored in a separate library.
  - **Key Files Created**: `src/lib/components/manga/MangaLibraryView.svelte`, `src/lib/components/manga/library-view/`, `src/lib/utils/source-grouping.ts`.
  - **Key File Modified**: `src/lib/views/Library.svelte`.

- **Local Manga Scanning and Series Linking**: Extended library scanning so Manga added from local folders can be identified from their file and folder names and linked to the series record used by MLV.
  - **Local Title Detection**: When an imported item is treated as Manga and is not already linked, the scanner builds a series title from its filename and surrounding folders. Source and scanlator labels, file extensions, chapter or volume numbers, and other release text are removed before matching. Files from the same series folder are handled together instead of being treated as unrelated books.
  - **Series Matching**: The detected title is searched on AniList first and compared with its English, Romaji, native, and alternative titles. If AniList returns no usable match or only a weak result, the scanner searches Mangabaka as a fallback, allowing series available only through Mangabaka to be linked as well. A match is assigned automatically only when it is clear enough and also agrees with the scanned folder name. Unclear matches remain unlinked instead of being assigned to the wrong series. The matching AniList or Mangabaka ID is stored with the Manga series, and the local items are connected through `manga_series_id`.
  - **Resuming Manga Matching**: Unfinished Manga recognition jobs are saved locally and resumed when the app reopens, skipping items that have already been linked. Temporary network or service failures are retried after a delay. Searches that finish without a clear match leave the items unlinked instead of being retried indefinitely. Clearing the library also discards pending matching jobs and clears their saved queue so they are not resumed after an app restart.
  - **Missing Manga Series Records**: Startup checks and library scans clear a book’s saved Manga link if the referenced series record no longer exists in the local database. The library item and its file are kept, and eligible items can be matched again during scanning.
  - **Link Repair on Rescan**: Rescanning checks for a single Manga series link incorrectly shared across separate series folders. Suspicious links without supporting download records are cleared and queued for matching again, while verified links are kept.
  - **MLV and Downloader Links**: Once a local series is linked, MLV can load its series information and use **Get Chapters** to open the same title in the Manga tab. **Open Source** can open the matching series page for a supported source when a saved or confidently matched source link is available.
  - **Key Files Created**: `electron/scanner/manga-scanner.ts`, `electron/library/manga-linker/`, `electron/library-manga-link-ipc.ts`.
  - **Key Files Modified**: `electron/library/scanner.ts`, `src/lib/components/manga/library-view/mlv-controller-actions.ts`.

- **Manga Metadata and Tracking**: Added external metadata and tracking information used by the Manga downloader, series views, and MLV.
  - **Manga Discovery**: AniList and Mangabaka are used to search and browse Manga metadata, open fuller series information, and match titles that may use different IDs across services.
  - **AniList and MyAnimeList**: Accounts from either service can be connected to view and update reading status, progress, and other tracking information from within the app. When both accounts are connected, the tracking editor's **Sync Both** option mirrors edits between them. Turning it off lets the user edit each service's values separately.
  - **Plan to Read Shortcut**: Added a bookmark button to Manga series pages for adding a series to Plan to Read on AniList or MyAnimeList without downloading it. The same button can remove the tracking entry, with confirmation for entries that have another reading status.
  - **Account Security**: Authentication tokens for connected AniList and MyAnimeList accounts are encrypted through the operating system's secure storage before being saved in the database. Basic account information, such as the service name and username, remains unencrypted. If secure storage is unavailable, the account stays connected only for the current session instead of saving its token as plain text.
  - **Client ID Settings**: Added controls in Settings for using a custom AniList or MyAnimeList client ID. Custom IDs are encrypted before being saved and can be reset to the ID bundled with Jiinashi. Changing an ID disconnects that tracking account so it needs to be connected again using the new ID.
  - **MangaDex Information**: MangaDex title matching is used to provide an external series link and an additional chapter-total reference. It is not treated as a user tracking account.
  - **Related Information**: Series views can also show AniList recommendations and available friend-reading information from connected tracking accounts.
  - **Key Files Created**: `electron/tracking/anilist.ts`, `electron/tracking/mal.ts`, `electron/tracking/mangadex.ts`, `electron/tracking/tracking-service.ts`, `electron/metadata/mangabaka.ts`, `src/lib/components/manga/series-view/msv-controller.svelte.ts`, `src/lib/components/manga/series-view/msv-view.svelte`, `src/lib/components/manga/library-view/mlv-controller-tracking-editor.ts`, `src/lib/components/manga/library-view/mlv-tracking-editor-dialog.svelte`, `electron/security/secret-store.ts`, `electron/tracking/client-id-manager.ts`, `src/lib/components/manga/TrackingClientIdControl.svelte`.
  - **Key Files Modified**: `src/lib/views/Settings.svelte`.

- **Tracking Incognito Mode**: Added an optional mode that pauses automatic AniList and MyAnimeList updates while reading Manga without disabling the connected accounts or changing how reading progress is stored locally.
  - **Automatic Tracking**: With incognito mode disabled, finishing a linked Manga chapter can update its reading status and chapter progress on each connected tracking service. Enabling incognito mode skips those automatic remote updates for both AniList and MyAnimeList, while local page progress, reading status, and history continue to work normally.
  - **Manual Updates**: Tracking information can still be edited and synchronized manually while incognito mode is active. This allows the user to decide which changes are sent without disconnecting an account.
  - **Controls**: Incognito mode can be toggled from the Manga and Tracking section in Settings or with `Ctrl+Shift+I`. The selected state is saved and restored the next time the app starts.
  - **Key Files Created**: `electron/tracking/incognito-manager.ts`.
  - **Key Files Modified**: `electron/tracking/tracking-service.ts`, `electron/main.ts`, `electron/preload/bridge-manga.ts`, `electron/preload/types.ts`, `src/lib/views/Settings.svelte`.

- **Manga Data and Library Linking**: Added the database records needed to connect downloaded library items with Manga series, chapters, installed extensions, and tracking accounts.
  - **Manga Records**: Added `manga_series` and `manga_chapters` for series metadata, source and tracking IDs, reading format, chapter information, download paths, and reading state.
  - **Manga Recognition Controls**: Added a Manga Recognition submenu to the three-dot menu for library folders with three options: **Set as manga**, **Auto**, and **Set as non-manga**. When an item is downloaded from the Manga tab, its series folder uses **Set as manga** by default so the downloaded chapters are treated as Manga and can appear in MLV. Other library folders use **Auto** by default, which is why most folders appear as Auto when the library is exported as a backup; this option leaves Manga recognition to the app. **Set as non-manga** prevents the folder and its contents from being treated as Manga. The selected option is stored in `manga_preference`, while matched series links use `manga_series_id`.
    - **Bulk Selection**: The same Manga recognition options can be applied to multiple selected folders from the bulk-selection bar.
  - **Extensions and Tracking**: Added `manga_extensions`, `tracking_accounts`, and `tracking_entries` for installed extension settings and AniList/MyAnimeList connections and progress.
  - **Database Queries**: Manga series, chapters, extensions, and tracking operations were separated into `electron/database/queries/manga.ts`.
  - **Existing Databases and Backups**: The new tables and columns are added without resetting an existing database. Backups preserve Manga series links and preferences, while backups created before these fields existed can still be imported.
  - **Manga Series Link Restoration**: Backups use AniList, MyAnimeList, or Mangabaka IDs and source information instead of local database IDs. Restore reconnects library items to existing series records or fetches metadata using the saved IDs to create missing records. If a series cannot be resolved, existing links are kept and unlinked items remain unlinked.
  - **Scan and Restore Coordination**: Directory imports, library rescans, and backup imports share a queue, so each waits for the previous operation to finish before running. Manga series links are restored using their saved AniList, MyAnimeList, or Mangabaka identifiers. Background title matching runs separately; restored links take priority because the matcher rechecks each item and skips links already applied by the backup.
  - **Key Files Created**: `electron/database/queries/manga.ts`, `electron/types/manga-types.ts`.
  - **Key Files Modified**: `electron/database/database.ts`, `electron/database/queries/library.ts`, `electron/library/backup-restore.ts`, `electron/library/scanner.ts`, `electron/library-ipc.ts`.

- **Recent Item Menu**: Added a three-dot action menu to every item on the Recent page, similar to the menu in Favorites.
  - **Available Actions**: Supports editing tags and type, managing content, moving, renaming, opening the file location, and deleting the item.
  - **Files Modified**: `src/lib/views/Recent.svelte`.

- **Webtoon Reader Interaction Controls**: Added direct mouse interaction designed for continuous vertical reading.
  - **Drag Scrolling**: Pages can be click-dragged vertically, or horizontally when zoomed, while normal wheel input continues to scroll through the chapter.
  - **Window Movement Recognition**: In a windowed reader, pointer gestures distinguish between scrolling the Webtoon and moving the reader window.
  - **Dedicated Window Movement**: The title region provides a reliable drag target in a windowed reader. `Alt`-drag offers the same direct control while the Webtoon page is not horizontally pannable.
  - **Cursor-Anchored Zoom**: `Ctrl`+wheel zooms toward the pointer position, while keyboard controls and middle-click retain their zoom and reset behavior.
  - **Files Modified**: `src/lib/views/Reader.svelte`, `src/lib/components/Reader/WebtoonCanvas.svelte`, `src/lib/components/Reader/ReaderOverlay.svelte`, `src/lib/components/Reader/ReaderSettings.svelte`.

- **Format-Aware Reader Launching**: Series downloaded through the new Manga tab, or otherwise linked in the library, can initialize the reader using their recognized reading format without replacing the user's global reader settings.
  - **Manga**: Opens in the configured Single or Double Page mode with Right-to-Left reading enabled.
  - **Manhwa / Manhua**: Opens directly in Webtoon mode.
  - **Per-Item Control**: Items explicitly marked as non-manga retain the normal reader defaults.
  - **Files Modified**: `electron/app-ipc.ts`, `electron/app-windows.ts`, `electron/preload/bridge-misc.ts`, `electron/preload/types.ts`, `src/App.svelte`, `src/lib/stores/app.ts`, `src/lib/utils/manga.ts`, `src/lib/views/Reader.svelte`, `src/lib/components/ArchiveManager.svelte`, `src/lib/components/manga/library-view/mlv-runtime.ts`.

### Changed

- **Cover Management Improvements**:
  - **Dynamic Cover Selection**: Hiding or restoring a page through "Manage Content" now immediately updates the item's cover to the first page that remains visible. If that item is being used as its parent folder's thumbnail, the folder cover is refreshed as well.
  - **Standalone Cover Images**: When a folder contains an archive, separate images named `cover.jpg`, `cover.jpeg`, `cover.png`, `cover.gif`, `cover.webp`, or `cover.bmp` are skipped during scanning. Rescanning removes any existing library entries for those images without deleting the files. Image-only folders and pages inside archives are unaffected.
  - **Files Modified**: `electron/main.ts`, `electron/coverExtractor.ts`, `electron/library/scanner.ts`, `electron/app-ipc.ts`, `electron/library-ipc.ts`.

- **Chinese Language Tag Alias**: Added `CN` as another keyword for the Chinese language tag, alongside `ZH` and `中文`.
  - **File Modified**: `electron/database/data/tag-defaults.ts`.

- **Preload Bridge Modularization**: Refactored the monolithic Electron preload script into focused bridge modules while preserving the unified `window.electronAPI` interface used by the renderer.
  - **Thin Composition Entry Point**: Reduced `electron/preload.ts` from a large collection of IPC bindings to a small assembly layer responsible for combining and exposing the application bridges through Electron's `contextBridge`.
  - **Domain-Specific Bridges**: Separated library and Manga operations into `bridge-library.ts` and `bridge-manga.ts`, while `bridge-misc.ts` groups the reader, window, settings, metadata, updater, environment, and Doujinshi downloader APIs.
  - **Shared IPC Helpers**: Centralized the repeated invoke, send, synchronous-send, and event-subscription wrappers in `bridge-helpers.ts`, including consistent listener cleanup.
  - **Structural Benefits**: Isolated IPC responsibilities by domain, reduced the size and maintenance burden of the preload entry point, and established a clearer boundary for extending renderer-facing APIs.
  - **Files Created**: `electron/preload/bridge-helpers.ts`, `electron/preload/bridge-library.ts`, `electron/preload/bridge-manga.ts`, `electron/preload/bridge-misc.ts`, `electron/preload/types.ts`.
  - **Files Modified**: `electron/preload.ts`.

- **Electron Main-Process Modularization**: Refactored the monolithic `electron/main.ts` into a smaller application bootstrap and a set of domain-focused runtime, window, IPC, library, and reader modules.
  - **Application Bootstrap**: Reduced `main.ts` from roughly 3,000 lines to an orchestration layer responsible for application startup, manager initialization, lifecycle coordination, and registration of the extracted modules.
  - **Runtime and Window Separation**: Moved application/session configuration into `app-runtime.ts` and centralized construction of the main, reader, and download-log windows in `app-windows.ts`.
  - **IPC Domain Separation**: Extracted general and library IPC registration into `app-ipc.ts` and `library-ipc.ts`. New Manga and library-to-Manga functionality was introduced through the dedicated `manga-ipc.ts` and `library-manga-link-ipc.ts` modules instead of expanding `main.ts` again.
  - **Library and Reader Services**: Moved backup and restore workflows into `library/backup-restore.ts`, consolidated library-root, scanning, and integrity-check responsibilities in `library/scanner.ts`, and isolated archive access and reader-page caching in `reader-archive.ts`.
  - **Structural Benefits**: Established clearer process-level ownership, reduced coupling between unrelated Electron responsibilities, and made individual IPC and service areas easier to maintain and extend.
  - **Files Created**: `electron/app-runtime.ts`, `electron/app-windows.ts`, `electron/app-ipc.ts`, `electron/library-ipc.ts`, `electron/library-manga-link-ipc.ts`, `electron/manga-ipc.ts`, `electron/reader-archive.ts`, `electron/library/backup-restore.ts`.
  - **Files Modified**: `electron/main.ts`, `electron/library/scanner.ts`.

- **Nested Library Roots**: When both a folder and one of its subfolders are imported, the app keeps the parent as the library root. The subfolder remains accessible inside it, avoiding duplicate work when rescanning the library.
  - **Files Modified**: `electron/library/scanner.ts`, `electron/app-ipc.ts`.

- **Library View Modularization**: Moved several self-contained parts of the large `Library.svelte` view into separate components while keeping folder navigation, loading, and library state in the main view.
  - **Library Items**: `LibraryGridItem.svelte` now contains each grid item's cover, reading information, selection behavior, quick actions, three-dot menu, and Manga Recognition submenu.
  - **Tag and Type Dialogs**: `LibraryMetadataDialogs.svelte` contains the tag and type editors shared by the Library and Recent pages.
  - **Scan Progress**: `LibraryScanOverlay.svelte` contains the full-screen progress display shown while the library is being scanned.
  - **Files Created**: `src/lib/components/Library/LibraryGridItem.svelte`, `src/lib/components/Library/LibraryMetadataDialogs.svelte`, `src/lib/components/Library/LibraryScanOverlay.svelte`.
  - **Files Modified**: `src/lib/views/Library.svelte`, `src/lib/views/Recent.svelte`.

- **Manga and Doujinshi Queues and History**: Updated the shared Downloader page so the Manga and Doujinshi modes keep their own visible queues and histories instead of mixing both download types together.
  - **Separate Queues**: Manga downloads use their own queue manager and `hidden_from_manga_queue` state, while Doujinshi downloads continue to use the original queue and `hidden_from_queue`. New Manga entries are marked as Manga and immediately excluded from the Doujinshi queue. Eligible tasks are restored to the appropriate queue after an app restart, with interrupted tasks returned to a pending state.
  - **Separate Histories**: Both download types remain in the existing `download_history` table, but Manga entries are identified by `content_type = 'manga'`. History requests use the selected Downloader mode so the Manga tab shows Manga records and the Doujinshi tab shows the remaining records.
  - **Scoped Controls**: Clearing history, removing a history entry, clearing finished tasks, cancelling downloads, retrying tasks, and removing tasks from the queue apply only to the currently selected Manga or Doujinshi mode.
  - **Backup Support**: Download-history backups preserve the download type and both queue-visibility states so the separation remains intact after a restore.
  - **Key Files Created**: `electron/downloader/manga-downloader.ts`, `electron/downloader/manga-queue.ts`.
  - **Key Files Modified**: `electron/database/database.ts`, `electron/database/queries/downloads.ts`, `electron/downloader/ipc.ts`, `electron/downloader/manager.ts`, `electron/library/backup-restore.ts`, `src/lib/views/Downloader.svelte`.

- **Type Contract Hardening (`vite-env` + preload typings)**:
  - **Why This Change Was Needed**: `src/vite-env.d.ts` had grown into a duplicated preload contract and drifted from runtime-exposed APIs (including stale method signatures), creating false type confidence and maintenance overhead.
  - **Single Source of Truth**: Reduced `src/vite-env.d.ts` to a thin ambient wrapper for `Window.electronAPI` and centralized shared API typing in preload types.
  - **`any` Cleanup (Type-Only)**: Tightened preload/renderer typing paths used by update and downloader flows to reduce `any` usage in the contract surface.
  - **Benefits**:
    - **Lower Drift Risk**: Avoids duplicate API contract declarations and keeps renderer typing aligned with preload/runtime definitions.
    - **Safer Refactors**: Improves compile-time detection of payload/shape mismatches that were previously hidden by loose `any` typing.
    - **Better Maintainability**: Reduces declaration-file bloat and makes future API/type changes easier to reason about and review.
  - **Files Modified**: `src/vite-env.d.ts`, `electron/preload/types.ts`, `electron/preload/bridge-library.ts`, `electron/preload/bridge-manga.ts`, `electron/preload/bridge-misc.ts`, `src/lib/views/About.svelte`, `src/lib/components/UpdateNotification.svelte`, `src/lib/views/Downloader.svelte`, `src/lib/views/DownloadLogs.svelte`, `src/lib/components/MoveToFolderDialog.svelte`, `package.json`.

- **Favorites Item Menu Alignment**:
  - **Expanded Menu Coverage**: Expanded the Favorites three-dot item menu to more closely align with the Library menu while retaining view-appropriate differences.
  - **Consistent Iconography**: Updated the menu icons and color styling to match the Library page.
  - **Files Modified**: `src/lib/views/Favorites.svelte`.

- **Webtoon Reader Layout and Scaling**: Reworked Webtoon presentation into a consistent continuous reading column.
  - **Mixed Image Dimensions**: Pages with different source resolutions or aspect ratios retain their individual heights while sharing a consistent displayed width. Once a page’s dimensions are known, the reader preserves its space when its image is no longer rendered off-screen, helping reduce layout shifts while scrolling.
  - **Webtoon Scale Modes**: Added **Best Fit** and **Fit Width** to the reader settings and context menu for Webtoon mode.
  - **Mode-Appropriate Options**: **Fit Height** and **Stretch** remain available for Single and Double Page modes but are excluded from Webtoon mode.
  - **Independent Preference**: Webtoon scaling is stored separately so changing it does not replace the scale mode used by the other reader modes.
  - **Responsive Geometry**: Page dimensions and the continuous column are recalculated from the available viewport and real image aspect ratios.
  - **Initial Window Size**: In Best Fit, the Webtoon reader uses proportions sampled from up to five pages to choose its initial window size, reducing the influence of an unusually shaped cover. Fit Width uses the current page's proportions when available, falling back to the sampled proportions otherwise.
  - **Files Modified**: `src/lib/views/Reader.svelte`, `src/lib/components/Reader/WebtoonCanvas.svelte`, `src/lib/components/Reader/ReaderSettings.svelte`, `src/lib/components/Reader/ReaderContextMenu.svelte`, `electron/library-ipc.ts`, `electron/reader-archive.ts`, `electron/preload/bridge-misc.ts`, `electron/preload/types.ts`.

### Fixed

- **Download Metadata Reactivity**: Fixed an issue where language badges (e.g., [EN], [JP]) were not visible on downloaded items in the library view until the application was restarted, even though the tags were correctly assigned.
  - **Files Modified**: `electron/downloader/manager.ts`.

- **Hitomi Language Tags**: Fixed an issue where downloads from Hitomi.la were missing language tags if the cross-referenced E-Hentai metadata didn't provide them. The parser now also checks Hitomi's own metadata for language information.
  - **Files Modified**: `electron/downloader/parsers/hitomi.ts`.

- **Folder Renaming**: Fixed a critical issue where renaming a folder would not update the paths of its contained items, causing them to become inaccessible. Implemented a robust recursive update system with transactional safety and automatic rollback.
  - **Files Modified**: `electron/main.ts`, `electron/database/queries/library.ts`, `electron/app-ipc.ts`.

- **Item Disappearance**: Fixed a critical bug where items would disappear from the library view when navigating between folders or updating item properties. The issue was due to incorrect cache key parsing in the frontend when using multiple library roots.
  - **Files Modified**: `src/lib/views/Library.svelte`.

- **Empty Folder Cover Updates**: Fixed an issue where folders created within the app would not generate a cover/thumbnail even after items were moved into them and a library scan was performed.
  - **Instant Updates**: Moving items into a folder now **immediately** updates its cover without requiring a manual scan.
  - **Rescan Updates**: Rescanning fills in missing folder thumbnails and refreshes existing ones when their cover source changes. If a folder no longer contains eligible files, its previous thumbnail is cleared.
  - **Path Normalization**: Updated file path handling to resolve hash mismatches on Windows that caused stale covers.
  - **Cover Caching**: Cover URLs include a version that changes when the thumbnail is updated, allowing refreshed covers to load while unchanged images remain cached.
  - **Files Modified**: `electron/main.ts`, `electron/coverExtractor.ts`, `electron/library/scanner.ts`, `src/lib/views/Library.svelte`, `src/lib/views/Favorites.svelte`, `electron/preload.ts`, `src/lib/stores/app.ts`, `electron/app-ipc.ts`, `electron/preload/bridge-library.ts`.

- **Favorites Deletion Sync**: Fixed an issue where items deleted from the Library view would persist in the Favorites view (and vice versa) until the application was restarted.
  Implemented bidirectional real-time synchronization so deletions immediately update both the Library and Favorites views.
  - **Files Modified**: `electron/main.ts`, `electron/preload.ts`, `src/lib/views/Favorites.svelte`, `src/lib/views/Library.svelte`, `src/vite-env.d.ts`, `electron/app-ipc.ts`, `electron/library-ipc.ts`, `electron/preload/bridge-library.ts`, `electron/preload/types.ts`.

- **Download History Retention**: Fixed the **Max History Items** setting only limiting how many downloads were displayed instead of removing older records from the stored history.
  - **Finished Downloads**: The app now keeps the newest configured number of completed, failed, and cancelled records across the Manga and Doujinshi download histories, removing older finished entries when the limit is exceeded.
  - **Active Queue Safety**: Pending and active downloads do not count toward the history limit and are never removed by its cleanup, so the total number of stored records can temporarily exceed the selected limit while downloads are still in progress.
  - **Files Modified**: `electron/database/queries/downloads.ts`, `electron/downloader/manager.ts`, `electron/downloader/manga-downloader.ts`.

- **Library Navigation and View State**: Fixed folder navigation losing its previous position, showing only the first group of items again, or ending on the wrong view after rapid navigation.
  - **Folder State**: The Library now remembers the scroll position and number of loaded items for each folder and library root, restoring both when returning through breadcrumbs, back and forward navigation, or root switching.
  - **Navigation Stability**: Pending folder loads are cancelled when a newer navigation action takes over, invalid history targets are ignored, and open folder levels are refreshed together so returning to a parent does not show stale content.
  - **Thumbnail Stability**: Reduced cover and folder-thumbnail flashing when navigating between folders by preloading covers, keeping previous folder views rendered, and avoiding repeated fade-in animations.
  - **Mouse Navigation**: Mouse back and forward buttons follow the app's history in both normal Library view and MLV without losing Forward navigation after visiting Downloader.
  - **Parent-Folder Navigation**: After returning to the parent folder with Back or its breadcrumb, mouse Forward reopens the folder just left without replaying intervening page visits.
  - **Files Modified**: `src/App.svelte`, `src/lib/stores/app.ts`, `src/lib/views/Library.svelte`, `src/lib/components/Library/LibraryGridItem.svelte`.

- **Clear Library Reset**: Clearing the library now resets the selected location to **All Collections** instead of retaining the previously selected directory.
  - **File Modified**: `src/lib/views/Library.svelte`.

- **Folder Cover Selection**: Fixed folder thumbnails using a loose image before a book or chapter archive simply because its filename appeared first alphabetically.
  - **Archive Priority**: Folders now check naturally sorted CBZ, ZIP, CBR, and RAR files first and use the first cover that can be extracted successfully.
  - **Image Fallback**: Loose images are used only when none of the supported archives in the folder produces a cover.
  - **Folder Scope**: Cover selection stays within the current folder instead of borrowing a thumbnail from a nested subfolder.
  - **Files Modified**: `electron/coverExtractor.ts`.

- **Dialog Backdrop Interaction**: Fixed shared dialogs closing after the pointer was dragged across the backdrop. Clicking the empty backdrop still closes the dialog normally, while dragging is ignored and no longer interferes with the page's drag-scrolling behavior.
  - **Files Modified**: `src/lib/components/Dialog.svelte`.

- **Library Selection Interaction**: Improved selecting multiple items from the Library and Favorites grids.
  - **Selection Feedback**: Selection clicks no longer focus the item card or select its text, and unselected cards keep a transparent border while selection mode is active to prevent brief border flashes as their selection state changes.
  - **Shift-Click Ranges**: Toggling other items no longer unexpectedly replaces the starting point used for Shift-click range selection.
  - **Files Modified**: `src/lib/state/selection.svelte.ts`, `src/lib/components/Library/LibraryGridItem.svelte`, `src/lib/views/Favorites.svelte`.

- **nhentai Downloads**: Fixed gallery metadata and image downloads after the legacy API was retired.
  - **API v2 Migration**: Updated gallery metadata retrieval to use nhentai's current API.
  - **Image Quality**: Downloads now use the exact full-resolution page paths returned by the service.
  - **Cloudflare Fallback**: API fallback windows start hidden and can become visible after a short delay if the request remains unresolved.
  - **Files Modified**: `electron/downloader/parsers/nhentai.ts`, `electron/downloader/network/client.ts`, `electron/downloader/network/stealth.ts`.

- **Recycle Bin Deletion Reliability**: Fixed files and folders disappearing from the library while remaining on disk when Windows failed to move them to the Recycle Bin.
  - **Active Download Safety**: Manga and Doujinshi downloads targeting the item are cancelled and awaited before deletion.
  - **Reader Handle Cleanup**: Open archive handles are closed before moving files or folders to the Recycle Bin.
  - **Database Consistency**: Library records are only removed after the filesystem operation succeeds; failed and partially failed bulk deletions remain visible and report an error.
  - **Files Created**: `electron/library/trash.ts`.
  - **Files Modified**: `electron/app-ipc.ts`, `electron/library-ipc.ts`, `electron/reader-archive.ts`, `electron/downloader/manager.ts`, `electron/downloader/manga-downloader.ts`, `electron/downloader/utils.ts`, `src/lib/components/BulkSelection.svelte`, `src/lib/views/Library.svelte`, `src/lib/views/Favorites.svelte`.

- **Electron TypeScript Validation**: Fixed Electron-side type errors involving cancelled download states, Axios response headers, manga reading formats, scanner metadata mapping, and Node.js types.
  - **Project Coverage**: Added a dedicated Electron TypeScript configuration so the Electron TypeScript source tree is checked consistently.
  - **Files Created**: `electron/tsconfig.json`.
  - **Files Modified**: `tsconfig.json`, `electron/database/queries/manga.ts`, `electron/downloader/manager.ts`, `electron/downloader/manga-downloader.ts`, `electron/scanner/manga-scanner.ts`.

- **Responsive Reader Title Display**: Fixed reader titles being truncated too early.
  - **Adaptive Width**: Titles use progressively wider limits as the reader viewport grows while retaining the compact-window layout.
  - **Single-Line Layout**: Long series and chapter names remain on one line with ellipsis truncation and do not overlap the settings button.
  - **Code Cleanup**: Removed unused imports, redundant styling utilities, and an empty style block from the reader overlay.
  - **Files Modified**: `src/lib/components/Reader/ReaderOverlay.svelte`.

- **Webtoon Reader Position Persistence**: Fixed Webtoon mode losing or desynchronizing the reader's exact position on long images.
  - **Progress / Canvas Synchronization**: Fixed cases where the progress bar advanced while the displayed image remained frozen, and ensured programmatic page changes update both the progress state and visible canvas.
  - **Exact In-Page Restore**: Reading progress now stores both the page index and a normalized offset within the page, so reopening returns to the same vertical position rather than the top of the saved image.
  - **Fullscreen Stability**: Entering or leaving fullscreen captures the current Webtoon anchor and restores it after the resized layout settles, preventing jumps to an earlier saved position.
  - **Resizing and Scale Changes**: The current Webtoon page and position within it are preserved when manually resizing the reader or switching between Best Fit and Fit Width.
  - **Efficient Persistence**: Scroll-position saves are throttled to 300 ms, with a synchronous final save when the reader closes so the most recent position is not lost.
  - **Database Compatibility**: Added `library_items.current_page_offset` as a backward-compatible `REAL DEFAULT 0` column through the existing automatic schema-update pattern; the database version was not changed.
  - **Backup Compatibility**: Normal library backups now export and restore `currentPageOffset`; older backups remain compatible and default to the top of the saved page.
  - **Files Modified**: `src/lib/views/Reader.svelte`, `src/lib/components/Reader/WebtoonCanvas.svelte`, `src/App.svelte`, `src/lib/stores/app.ts`, `electron/database/database.ts`, `electron/database/queries/library.ts`, `electron/library-ipc.ts`, `electron/preload/bridge-misc.ts`, `electron/preload/types.ts`, `electron/library/backup-restore.ts`.

- **Reader Window Flashing**: Reduced flashing when opening the reader in Single Page, Double Page, or Webtoon mode by preparing the initial images before revealing the window. Webtoon mode also hides the intermediate resizing frame when leaving fullscreen.
  - **Files Modified**: `src/lib/views/Reader.svelte`, `src/lib/components/Reader/WebtoonCanvas.svelte`, `src/App.svelte`, `electron/app-windows.ts`, `electron/main.ts`, `electron/preload/bridge-misc.ts`, `electron/preload/types.ts`.

- **Recent List Ordering**: Fixed items briefly jumping to the top of the Recent page when a library update included an unchanged last-read timestamp. Items now keep their position unless that timestamp changes.
  - **Files Modified**: `src/lib/views/Recent.svelte`.

- **Updater Initialization**: Fixed the updater not starting with the app, restoring development update testing, packaged update checks and downloads, installation, and update notifications. Updater handlers are registered only once if the main window is recreated.
  - **File Modified**: `electron/main.ts`.

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
