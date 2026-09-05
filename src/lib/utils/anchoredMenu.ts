/** Keep row menus above clipping containers and within the window. */
export function anchoredMenu(
  node: HTMLElement,
  { align = "left", gap = 4 }: { align?: "left" | "right"; gap?: number } = {},
) {
  const anchor = node.previousElementSibling as HTMLElement;
  const margin = 8;

  // The top layer escapes ancestor overflow and transforms without reparenting
  // the menu, so Svelte events and outside-click checks keep their ancestry.
  node.setAttribute("popover", "manual");
  node.setAttribute("data-drag-scroll-ignore", "");
  Object.assign(node.style, {
    position: "fixed",
    inset: "auto",
    margin: "0",
    padding: "0",
    overflowY: "auto",
    overscrollBehavior: "contain",
  });
  node.showPopover();

  function position() {
    const rect = anchor.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    const below = Math.max(0, height - margin - rect.bottom - gap);
    const above = Math.max(0, rect.top - gap - margin);
    const naturalHeight = node.scrollHeight + node.offsetHeight - node.clientHeight;
    const opensUp = naturalHeight > below && above > below;
    node.style.maxHeight = `${opensUp ? above : below}px`;
    node.style.maxWidth = `${Math.max(0, width - margin * 2)}px`;
    const left = align === "right" ? rect.right - node.offsetWidth : rect.left;
    node.style.left = `${Math.max(margin, Math.min(left, width - margin - node.offsetWidth))}px`;
    node.style.top = `${Math.max(margin, opensUp ? rect.top - gap - node.offsetHeight : rect.bottom + gap)}px`;
  }

  position();
  const observer = new ResizeObserver(position);
  observer.observe(node);
  window.addEventListener("resize", position);
  // The owning views already dismiss menus when the page scrolls.
  return {
    destroy() {
      observer.disconnect();
      window.removeEventListener("resize", position);
      if (node.matches(":popover-open")) node.hidePopover();
    },
  };
}
