import { SvelteSet } from 'svelte/reactivity';

export interface SelectionItem {
  id: number;
}

export class SelectionModel {
  selectedIds = new SvelteSet<number>();
  selectionMode = $state(false);
  private lastSelectedId: number | null = null;

  toggle(id: number, allItems: SelectionItem[], event?: Event) {
    if (event) event.stopPropagation();

    // Range selection (Shift-click)
    if (event instanceof MouseEvent && event.shiftKey && this.lastSelectedId !== null) {
      event.preventDefault();
      const currentIdx = allItems.findIndex(i => i.id === id);
      const lastIdx = allItems.findIndex(i => i.id === this.lastSelectedId);
      
      if (currentIdx !== -1 && lastIdx !== -1) {
        const start = Math.min(currentIdx, lastIdx);
        const end = Math.max(currentIdx, lastIdx);
        for (let i = start; i <= end; i++) {
          this.selectedIds.add(allItems[i].id);
        }
        this.selectionMode = true;
        this.lastSelectedId = id;
        return;
      }
    }

    // Standard toggle
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
      if (this.selectedIds.size === 0) {
        this.selectionMode = false;
        this.lastSelectedId = null;
      }
    } else {
      this.selectedIds.add(id);
      this.selectionMode = true;
      this.lastSelectedId = id;
    }
  }

  selectAll(items: SelectionItem[]) {
    for (const item of items) {
      this.selectedIds.add(item.id);
    }
    this.selectionMode = true;
  }

  clear() {
    this.selectedIds.clear();
    this.selectionMode = false;
    this.lastSelectedId = null;
  }

  get size() {
    return this.selectedIds.size;
  }

  has(id: number) {
    return this.selectedIds.has(id);
  }

  get ids() {
    return Array.from(this.selectedIds) as number[];
  }
}
