import { create } from "zustand";
import { checkTranscriptionSetup, transcribeAudio } from "../lib/transcribe";
import { tGet, tPut, tDelete, tClear } from "../lib/transcriptDb";

// Phase 2F: voice-note transcripts. Opt-in per device (a switch in Settings), made on this device only, kept on this device only.
//   available: null (not checked yet) | false (the server owner hasn't run `npm run setup:transcripts`, or this browser can't) | true
//   items[messageId]: { status: "working" | "done" | "error", text?, progress?, error? }
const PREF_KEY = "gramchat:transcripts";
const readPref = () => {
  try { return localStorage.getItem(PREF_KEY) === "on"; } catch { return false; }
};

let checking = null;

export const useTranscriptStore = create((set, get) => ({
  available: null,
  model: null,
  enabled: readPref(),
  items: {},

  // Looks for the on-device engine once per page load
  init: () => {
    if (get().available !== null) return Promise.resolve();
    if (!checking) {
      checking = checkTranscriptionSetup().then((manifest) => set({ available: !!manifest, model: manifest?.model || null }));
    }
    return checking;
  },

  setEnabled: (enabled) => {
    try { localStorage.setItem(PREF_KEY, enabled ? "on" : "off"); } catch { /* private mode */ }
    set({ enabled });
  },

  // Shows a transcript this device already made (kept messages only; see transcriptDb.js)
  loadCached: async (id) => {
    if (get().items[id]) return;
    const hit = await tGet(id);
    if (hit?.text && !get().items[id]) set((s) => ({ items: { ...s.items, [id]: { status: "done", text: hit.text } } }));
  },

  transcribe: async (message) => {
    const id = message._id;
    if (get().items[id]?.status === "working") return;
    const put = (v) => set((s) => ({ items: { ...s.items, [id]: v } }));
    put({ status: "working", progress: 0 });
    try {
      const saved = await tGet(id); // made earlier on this device
      if (saved?.text) return put({ status: "done", text: saved.text });
      const text = await transcribeAudio(message.fileUrl, { onProgress: (progress) => put({ status: "working", progress }) });
      put({ status: "done", text: text || "(nothing was recognised)" });
      // A message that is set to disappear is never written to disk: the text would outlive it
      if (text && !message.expiresAt) tPut({ id, text, at: Date.now() });
    } catch (e) {
      put({ status: "error", error: e.message || "Transcription failed" });
    }
  },

  // Hide the text again (it can be shown again by tapping Transcribe, which uses the saved copy if there is one)
  hide: (id) =>
    set((s) => {
      const items = { ...s.items };
      delete items[id];
      return { items };
    }),

  // The message is gone (deleted for everyone or disappeared): its transcript goes too
  forget: (ids) => {
    const list = Array.isArray(ids) ? ids : [ids];
    set((s) => {
      const items = { ...s.items };
      list.forEach((id) => delete items[id]);
      return { items };
    });
    list.forEach((id) => tDelete(id));
  },

  // Logout: nothing stays behind for the next person on this browser
  reset: () => {
    set({ items: {} });
    tClear();
  },
}));

// An explicit logout (see useAuthStore.logout) wipes the transcripts made on this device
if (typeof window !== "undefined") window.addEventListener("gramchat:logout", () => useTranscriptStore.getState().reset());
