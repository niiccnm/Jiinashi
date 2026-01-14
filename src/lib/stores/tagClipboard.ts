import { writable } from "svelte/store";

// Persistent storage key
const STORAGE_KEY = "jiinashi_tag_clipboard";

// Load initial state from localStorage if available
function getInitialState() {
  if (typeof localStorage === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error("Failed to load tag clipboard from localStorage:", e);
    return [];
  }
}

// Create the store
export const tagClipboard = writable<any[]>(getInitialState());

// Subscribe to changes and persist to localStorage
if (typeof localStorage !== "undefined") {
  tagClipboard.subscribe((value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (e) {
      console.error("Failed to persist tag clipboard to localStorage:", e);
    }
  });
}
