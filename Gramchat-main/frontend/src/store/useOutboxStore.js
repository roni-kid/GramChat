import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";
import { useChatStore } from "./useChatStore";
import { useGroupStore } from "./useGroupStore";
import { newClientId } from "../lib/clientId";
import { dbAll, dbPut, dbDelete, dbClear } from "../lib/outboxDb";

// Phase 2C: the send queue. Every outgoing message goes in here first, shows up instantly in the chat as "Sending…",
// and is sent from here. If the network is down it stays queued and is retried (on reconnect, when the tab comes back,
// and with a growing delay); a message that the server refuses for good is marked "Not sent" with Retry / Discard.
// Each message carries a random clientId that the server remembers, so a retry can never create a duplicate.
//
// Item: { clientId, userId, kind: "dm"|"group", targetId, body, replyTo, fileType, fileSize, createdAt, status, attempts, nextAt, error }
//   status: "queued" (waiting to be sent / retried) | "sending" | "failed" (refused by the server; needs the user)

const MAX_QUEUED = 50;
const BACKOFF_MS = [1000, 3000, 8000, 20000, 45000]; // after that: every 45 s (and immediately when the network comes back)
const backoff = (attempts) => BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1];

const keyOf = (i) => `${i.kind}:${i.targetId}`;
const busy = new Set(); // conversations with a request in flight: one at a time, so messages keep their order

const urlFor = (i) => (i.kind === "dm" ? `/messages/send/${i.targetId}` : `/groups/${i.targetId}/messages`);

// Network trouble, a server hiccup, throttling or an expired login are worth retrying; anything else is a "no".
const isRetryable = (error) => {
  const s = error.response?.status;
  return !error.response || s === 408 || s === 425 || s === 429 || s === 401 || s >= 500;
};

/** Turns a queue item into a message-shaped object so the chat can render it like any other bubble. */
export const toPendingMessage = (item, me) => ({
  _id: `pending:${item.clientId}`,
  clientId: item.clientId,
  senderId: item.kind === "group" ? { _id: me._id, fullName: me.fullName, profilePic: me.profilePic } : me._id,
  ...(item.kind === "dm" ? { receiverId: item.targetId } : { groupId: item.targetId }),
  ...(item.body.viewOnce
    // A view-once message never shows its media, not even to the sender while it is still waiting to be sent
    ? { viewOnce: true, viewOnceKind: item.body.image ? "image" : item.body.voice ? "audio" : "video", viewOnceState: "unopened", voice: item.body.voice || undefined, voiceDuration: item.body.voiceDuration }
    : {
        text: item.body.text || undefined,
        image: item.body.image || undefined,
        fileUrl: item.body.fileUrl || undefined,
        fileType: item.fileType,
        fileName: item.body.fileName || undefined,
        fileSize: item.fileSize,
        voice: item.body.voice || undefined,
        voiceDuration: item.body.voiceDuration,
        voiceWaveform: item.body.voiceWaveform,
      }),
  replyTo: item.replyTo || undefined,
  reactions: [],
  createdAt: item.createdAt,
  pending: item.status === "failed" ? "failed" : item.status === "queued" && item.attempts > 0 ? "offline" : "sending",
  error: item.error,
});

export const useOutboxStore = create((set, get) => {
  const patch = (clientId, changes) => set((s) => ({ items: s.items.map((i) => (i.clientId === clientId ? { ...i, ...changes } : i)) }));
  const remove = (clientId) => {
    set((s) => ({ items: s.items.filter((i) => i.clientId !== clientId) }));
    dbDelete(clientId);
  };

  // One send attempt. Returns "sent" | "retry" | "failed".
  const attempt = async (item) => {
    patch(item.clientId, { status: "sending" });
    try {
      const res = await axiosInstance.post(urlFor(item), item.body);
      if (item.kind === "dm") useChatStore.getState().applySent(res.data);
      else useGroupStore.getState().applySentGroup(res.data);
      remove(item.clientId);
      return "sent";
    } catch (error) {
      if (isRetryable(error)) {
        const attempts = item.attempts + 1;
        patch(item.clientId, { status: "queued", attempts, nextAt: Date.now() + backoff(attempts) });
        return "retry";
      }
      patch(item.clientId, { status: "failed", error: error.response?.data?.message || "Couldn't send" });
      const saved = get().items.find((i) => i.clientId === item.clientId);
      if (saved) dbPut(saved);
      return "failed";
    }
  };

  const drain = async (key) => {
    if (busy.has(key)) return;
    busy.add(key);
    try {
      for (;;) {
        // The first message still waiting in this chat. If it isn't due yet, nothing behind it goes first.
        const next = get().items.find((i) => keyOf(i) === key && i.status === "queued");
        if (!next || next.nextAt > Date.now()) return;
        if ((await attempt(next)) === "retry") return;
      }
    } finally {
      busy.delete(key);
    }
  };

  return {
    items: [],

    // Restores this account's unsent messages after a reload. Another account's leftovers are deleted.
    load: async (userId) => {
      const all = await dbAll();
      for (const i of all) if (i.userId !== userId) dbDelete(i.clientId);
      const mine = all
        .filter((i) => i.userId === userId)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        // "sending" when the page closed: unknown whether it arrived. Safe to retry, the server de-duplicates by clientId.
        .map((i) => ({ ...i, status: i.status === "failed" ? "failed" : "queued", attempts: 0, nextAt: 0 }));
      if (useAuthStore.getState().authUser?._id !== userId) return; // logged out while loading
      set((s) => ({ items: [...mine.filter((m) => !s.items.some((i) => i.clientId === m.clientId)), ...s.items] }));
      get().flush();
    },

    /** Adds a message to the queue and starts sending. kind: "dm" (targetId = the other person) | "group". */
    enqueue: ({ kind, targetId, data }) => {
      const me = useAuthStore.getState().authUser;
      if (!me || !targetId) return false;
      if (get().items.length >= MAX_QUEUED) {
        toast.error("Too many unsent messages. Check your connection first.");
        return false;
      }
      const replyingTo = (kind === "dm" ? useChatStore : useGroupStore).getState().replyingTo;
      const item = {
        clientId: newClientId(),
        userId: me._id,
        kind,
        targetId,
        body: {
          text: data.text || "",
          image: data.image || null,
          fileUrl: data.fileUrl || null,
          fileName: data.fileName || null,
          voice: data.voice || undefined,
          voiceDuration: data.voiceDuration,
          voiceWaveform: data.voiceWaveform,
          viewOnce: data.viewOnce || undefined,
          replyToId: replyingTo?._id || null,
        },
        replyTo: replyingTo
          ? { _id: replyingTo._id, text: replyingTo.text, image: replyingTo.image, fileName: replyingTo.fileName, senderId: replyingTo.senderId, deletedForEveryone: replyingTo.deletedForEveryone, voice: replyingTo.voice }
          : undefined,
        fileType: data.fileType,
        fileSize: data.fileSize,
        createdAt: new Date().toISOString(),
        status: "queued",
        attempts: 0,
        nextAt: 0,
      };
      item.body.clientId = item.clientId;
      (kind === "dm" ? useChatStore : useGroupStore).getState().clearReplyingTo();
      set((s) => ({ items: [...s.items, item] }));
      dbPut(item);
      get().flush();
      return true;
    },

    flush: async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return; // the browser knows it's offline: don't bother
      const keys = [...new Set(get().items.filter((i) => i.status === "queued").map(keyOf))];
      await Promise.all(keys.map(drain));
    },

    // "Retry" on a message that wasn't sent
    retry: (clientId) => {
      patch(clientId, { status: "queued", attempts: 0, nextAt: 0, error: undefined });
      get().flush();
    },

    discard: (clientId) => remove(clientId),

    // Retry triggers: the network or the socket came back, the tab became visible, and a slow timer as a safety net.
    initRealtime: (socket) => {
      const retryNow = () => {
        set((s) => ({ items: s.items.map((i) => (i.status === "queued" ? { ...i, nextAt: 0 } : i)) }));
        get().flush();
      };
      const onVisible = () => document.visibilityState === "visible" && get().flush();
      socket.on("connect", retryNow);
      window.addEventListener("online", retryNow);
      document.addEventListener("visibilitychange", onVisible);
      const timer = setInterval(() => get().flush(), 5000);
      return () => {
        socket.off("connect", retryNow);
        window.removeEventListener("online", retryNow);
        document.removeEventListener("visibilitychange", onVisible);
        clearInterval(timer);
      };
    },

    // Login expired: stop showing this account's queue but keep it stored, so the same account can pick up where it left off
    reset: () => set({ items: [] }),

    // Explicit logout: nothing unsent is left on this device for the next person
    clearAll: () => {
      set({ items: [] });
      dbClear();
    },
  };
});

if (typeof window !== "undefined") window.addEventListener("gramchat:logout", () => useOutboxStore.getState().clearAll());
