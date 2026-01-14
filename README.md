# Jiinashi

A local library manager and reader for Doujinshi and Manga.

> **Note**: This application was primarily developed for personal use and for a small circle of friends.

## Key Features

### 📚 Library & Content Management

- **Library Scanning**: Scans configured folders to build your database.
- **Supported Formats**:

| Category     | Extensions                                            |
| :----------- | :---------------------------------------------------- |
| **Archives** | `.cbz`, `.zip`, `.cbr`, `.rar`, `.7z`, `.cb7`, `.pdf` |
| **Images**   | `.jpg`, `.png`, `.gif`, `.webp`, `.bmp`, `.tiff`      |

- **Content Types**: Categorize items as **Manga**, **Doujinshi**, **Webtoon**, **Artist CG**, etc.
- **Deleting Behavior**: Deleting items moves them to the system Trash instead of permanent deletion.

### 🏷️ Booru-Style Tagging System

Tagging system similar to online image boards.

- **Tag Categories**: Assign tags with specific groups like **Artist**, **Character**, or **Copyright**.
- **Tag Aliases**: Manage synonyms automatically (e.g., searching for a nickname finds the correct tag).
- **Color-Coded**: Different colors for different tag categories.
- **Bulk Manager**: Manage tags and content types for multiple items at once.

### 🔍 Search & Filter

- **Filtering**: Filter by tags, excluding tags, reading status, date added, or content type.
- **Sorting**: Various sorting options including relevance-based search results.

### 📖 Reader

- **View Modes**: Single Page, Double Page, and Vertical (Webtoon) scrolling.
- **Manga Mode**: Right-to-Left (RTL) reading support.
- **Internal Content Manager**: Manage the visibility of images within an archive. Allows you to "hide" specific images (such as unwanted images, different language versions, or variations) from the reading view without altering the original file.
- **Animated Support**: Support for animated formats (GIF/WebP) inside archives.

### 💾 Backup & Relocation

- **Backups**: Export library metadata (tags, reading progress, favorites) to a JSON file.
- **Relocation support**: Attempts to re-link metadata to files if the root directory path changes.

## 🚀 Future Roadmap

- **Built-in Downloader**: Ability to download content directly within the application. (High Priority)
- **Tracker Integration**: Support for **MAL** (MyAnimeList) and **AniList** to track your reading progress. (High Priority)
- **Account Integration**: Import cookies or login to services (e.g., E-Hentai, ExHentai) to download content using your account, similar to Hitomi Downloader.
- **Light Novel Support**: Support for managing and reading Light Novels with native **EPUB** support and dedicated settings.
- **Japanese Language Learning**: Integrate **manga-ocr** and **mokuro** to generate selectable text overlays in the reader. This will enable **Yomitan** dictionary lookups and direct word exporting to **Anki**.
- **Multi-language Support**: Localize the application into **Japanese**, **Korean**, **Chinese**, and **Spanish**.
- **Linux Support**: Plan to provide official support and builds for Linux distributions.

## 🖥️ System Requirements

Performance may vary depending on library size and archive complexity.

| Requirement      | Minimum    | Recommended                  |
| :--------------- | :--------- | :--------------------------- |
| **OS**           | Windows 10 | Windows 11                   |
| **Memory (RAM)** | 2 GB       | 4 GB+                        |
| **CPU**          | Dual-Core  | Quad-Core (e.g., Ryzen 5/i5) |
| **Storage**      | HDD        | **SSD** (Highly Recommended) |

> [!NOTE]
>
> - **Compatibility**: Verified on libraries with **2000+ items**.
> - **App Size**: Approximately 300 MB when installed.
> - **Memory**: Usage averages around 550 MB during normal use, but can spike to 1 GB+ during tasks like internal content management.
> - **CPU Performance**: On high-end processors (e.g., Ryzen 7), scanning averages ~3% CPU usage with spikes up to ~15% (Library stored on HDD). Metadata backup imports show similar efficiency (~7% average, spikes to ~15%).

## 🛠️ Issues & Contributions

Jiinashi is in its early stages of development. If you encounter bugs or have suggestions:

- **Report Issues**: Please [search for existing issues](https://github.com/niiccnm/jiinashi/issues) before opening a new one.
- **Pull Requests**: Contributions are welcome; however, they are currently not a high priority. There is a possibility that PRs may be ignored or rejected depending on the current development focus.

## Disclaimer

**Jiinashi is not hosting any kind of content.** This application is a tool for managing and viewing digital content locally. The developer(s) of this application do not have any affiliation with the content providers available on the internet via third-party extensions.

Users are solely responsible for ensuring that their use of the application and any extensions complies with applicable laws and regulations.

## Credits & Forking

If you choose to fork this project or use any part of this software in your own work, you **must**:

1. Include a copy of the [LICENSE](LICENSE) in your distribution.
2. Provide clear credits and attribution to the original **Jiinashi** project and its authors.
3. Keep all existing copyright and attribution notices intact in the source code.
