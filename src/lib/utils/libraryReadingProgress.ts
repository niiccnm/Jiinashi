import type { LibraryItem } from "../stores/app";

export function getLibraryReadingProgress(
  item: Pick<
    LibraryItem,
    "current_page" | "page_count" | "visible_page_count" | "reading_status"
  >,
): number {
  if (item.reading_status === "unread") return 0;
  // A known archive with every page hidden has no readable progress.
  if (item.page_count > 0 && item.visible_page_count === 0) return 0;
  if (item.reading_status === "read") return 100;
  const pageCount = item.visible_page_count ?? item.page_count;
  if (!Number.isFinite(pageCount) || pageCount <= 0) return 0;

  // Resume positions are zero-based; cards show the page reached out of the total.
  const page = Number.isFinite(item.current_page)
    ? Math.max(0, item.current_page)
    : 0;
  return Math.min(100, ((page + 1) / pageCount) * 100);
}
