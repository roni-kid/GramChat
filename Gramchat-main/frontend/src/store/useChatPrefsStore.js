import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";

// Per-chat settings: pinned to the top, archived, muted. Private to this account; stored on the server so every device agrees.
// prefs is keyed "user:<contactId>" (a 1:1 chat) or "group:<groupId>" and only holds chats that have something set.
export const prefKey = (kind, id) => `${kind}:${id}`;
export const isMuted = (pref, now = Date.now()) => !!pref?.mutedUntil && new Date(pref.mutedUntil).getTime() > now;
export const MAX_PINNED_CHATS = 3; // the server enforces this; it's here only for the menu text

export const useChatPrefsStore = create((set, get) => ({
  prefs: {},
  loaded: false,

  load: async () => {
    try {
      const res = await axiosInstance.get("/chats/prefs");
      set({ prefs: Object.fromEntries(res.data.map((p) => [prefKey(p.kind, p.id), p])), loaded: true });
    } catch {
      /* non-critical: the list just shows no pins / archives / mutes */
    }
  },

  // One chat's settings came back from the server or from another of my devices (idempotent)
  apply: (p) =>
    set((s) => {
      const next = { ...s.prefs };
      const key = prefKey(p.kind, p.id);
      if (!p.pinnedAt && !p.archived && !isMuted(p)) delete next[key];
      else next[key] = p;
      return { prefs: next };
    }),

  // changes: { pinned?: boolean, archived?: boolean, mute?: "off" | "8h" | "1w" | "always" }. kind: "user" | "group"
  update: async (kind, id, changes) => {
    try {
      const res = await axiosInstance.put(`/chats/prefs/${kind}/${id}`, changes);
      get().apply(res.data);
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || "Couldn't update the chat");
      return false;
    }
  },

  reset: () => set({ prefs: {}, loaded: false }),

  initRealtime: (socket) => {
    const onPref = (p) => get().apply(p);
    // After a dropped connection other devices may have changed things meanwhile
    const onConnect = () => { if (get().loaded) get().load(); };
    socket.on("chatPref", onPref);
    socket.on("connect", onConnect);
    return () => {
      socket.off("chatPref", onPref);
      socket.off("connect", onConnect);
    };
  },
}));
