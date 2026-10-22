import { create } from "zustand";

// Phase 2C: unsent text per chat ("drafts"). Keys: `dm:<userId>` and `group:<groupId>`.
// Stored in localStorage for the signed-in account only; text only (attachments and replies aren't kept).
const KEY = "gramchat:drafts:v1";

const readStored = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
};
const writeStored = (userId, drafts) => {
  try {
    if (Object.keys(drafts).length) localStorage.setItem(KEY, JSON.stringify({ userId, drafts }));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked or full: drafts just won't survive a reload */
  }
};

let owner = null; // account the in-memory drafts belong to

export const useDraftStore = create((set, get) => ({
  drafts: {}, // { [chatKey]: { text, at } }

  load: (userId) => {
    owner = userId;
    const stored = readStored();
    if (stored.userId === userId) set({ drafts: stored.drafts || {} });
    else {
      set({ drafts: {} });
      writeStored(userId, {}); // another account's leftovers are dropped
    }
  },

  setDraft: (chatKey, text) => {
    if (!owner || !chatKey || chatKey.endsWith(":undefined")) return;
    const prev = get().drafts[chatKey]?.text || "";
    const clean = typeof text === "string" && text.trim() ? text : "";
    if (clean === prev) return;
    const drafts = { ...get().drafts };
    if (clean) drafts[chatKey] = { text: clean.slice(0, 10000), at: Date.now() };
    else delete drafts[chatKey];
    set({ drafts });
    writeStored(owner, drafts);
  },

  // Session ended on its own (expired login): forget in memory, keep what's stored for the same account
  reset: () => {
    owner = null;
    set({ drafts: {} });
  },

  // Explicit logout: forget everything, including what's stored
  clearAll: () => {
    owner = null;
    set({ drafts: {} });
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
}));

if (typeof window !== "undefined") window.addEventListener("gramchat:logout", () => useDraftStore.getState().clearAll());
