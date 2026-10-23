import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";
import { patchById, applyDeletedToList, patchLast, DELETED_PREVIEW_PATCH, removeIds, timerLabel } from "../lib/messageRules";
import { useGroupStore } from "./useGroupStore";
import { useTranscriptStore } from "./useTranscriptStore";

const idOf = (v) => (v && v._id) || v;
const PAGE_SIZE = 50; // matches the server default
// Add a message only if we don't already have it (the same message can arrive via HTTP *and* socket)
const withMessage = (list, msg) => (list.some((m) => m._id === msg._id) ? list : [...list, msg]);
const lastOf = (m) => ({ _id: m._id, text: m.text, image: !!m.image, fileName: m.fileName, voice: !!m.voice, viewOnce: !!m.viewOnce, viewOnceKind: m.viewOnceKind, senderId: idOf(m.senderId), createdAt: m.createdAt, deletedForEveryone: m.deletedForEveryone });

export const useChatStore = create((set, get) => ({
  messages: [],
  users: [],
  selectedUser: null,
  isUsersLoading: false,
  isMessagesLoading: false,
  isTyping: false,
  replyingTo: null,
  // infinite scroll: are there older messages than the ones loaded?
  hasMore: false,
  isLoadingOlder: false,
  // up to 3 pinned messages of the open chat
  pinned: [],
  // a message to scroll to once the open chat has loaded: { id, createdAt } (set by search results and the media gallery)
  focus: null,
  // { [userId]: { unread, lastMessage } } for the chat list
  conversations: {},

  usersLoaded: false,

  getUsers: async () => {
    // Only show the skeleton on the very first load. (Showing it on every refresh, with an empty contact
    // list, unmounted the "Add contact" window right after a request was sent.)
    set({ isUsersLoading: !get().usersLoaded });
    try {
      const [users, convs] = await Promise.all([axiosInstance.get("/messages/users"), axiosInstance.get("/messages/conversations")]);
      set({ usersLoaded: true, users: users.data, conversations: Object.fromEntries(convs.data.map((c) => [c.userId, { unread: c.unread, lastMessage: c.lastMessage }])) });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to load users");
    } finally {
      set({ isUsersLoading: false });
    }
  },

  getMessages: async (userId) => {
    set({ isMessagesLoading: true, messages: [], hasMore: false });
    try {
      const res = await axiosInstance.get(`/messages/${userId}`, { params: { limit: PAGE_SIZE } });
      if (get().selectedUser?._id === userId) set({ messages: res.data, hasMore: res.data.length >= PAGE_SIZE });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to load messages");
    } finally {
      set({ isMessagesLoading: false });
    }
  },

  // Older messages (infinite scroll). Returns how many were added.
  loadOlder: async () => {
    const { selectedUser, messages, hasMore, isLoadingOlder } = get();
    if (!selectedUser || !hasMore || isLoadingOlder || !messages.length) return 0;
    const userId = selectedUser._id;
    set({ isLoadingOlder: true });
    try {
      const res = await axiosInstance.get(`/messages/${userId}`, { params: { before: messages[0].createdAt, limit: PAGE_SIZE } });
      if (get().selectedUser?._id !== userId) return 0;
      const have = new Set(get().messages.map((m) => m._id));
      const older = res.data.filter((m) => !have.has(m._id));
      set((s) => ({ messages: [...older, ...s.messages], hasMore: older.length > 0 && res.data.length >= PAGE_SIZE }));
      return older.length;
    } catch (error) {
      toast.error(error.response?.data?.message || "Couldn't load older messages");
      return 0;
    } finally {
      set({ isLoadingOlder: false });
    }
  },

  // Keeps loading older pages until the oldest loaded message is at or before `createdAt` (to jump to an old pinned message)
  loadUntil: async (createdAt) => {
    for (let i = 0; i < 20; i++) {
      const { messages, hasMore } = get();
      if (!hasMore || !messages.length || new Date(messages[0].createdAt) <= new Date(createdAt)) return;
      if (!(await get().loadOlder())) return;
    }
  },

  // Called by the send queue once the server has accepted a message (the same message may also arrive over the socket: de-duplicated by id)
  applySent: (msg) => {
    const other = idOf(msg.receiverId);
    set((s) => ({
      messages: s.selectedUser?._id === other ? withMessage(s.messages, msg) : s.messages,
      conversations: { ...s.conversations, [other]: { unread: 0, lastMessage: lastOf(msg) } },
    }));
  },

  addReaction: async (messageId, emoji) => {
    try {
      const res = await axiosInstance.post(`/messages/react/${messageId}`, { emoji });
      set((s) => ({ messages: s.messages.map((m) => (m._id === messageId ? { ...m, reactions: res.data.reactions } : m)) }));
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to add reaction");
    }
  },

  markMessagesAsRead: async (userId) => {
    set((s) => (s.conversations[userId]?.unread ? { conversations: { ...s.conversations, [userId]: { ...s.conversations[userId], unread: 0 } } } : s));
    try {
      await axiosInstance.put(`/messages/read/${userId}`);
    } catch {
      /* non-critical */
    }
  },

  setReplyingTo: (message) => set({ replyingTo: message }),
  clearReplyingTo: () => set({ replyingTo: null }),
  setSelectedUser: (selectedUser) => set({ selectedUser, isTyping: false, replyingTo: null, pinned: [], hasMore: false, isLoadingOlder: false, focus: null }),
  setFocus: (focus) => set({ focus }),
  clearFocus: () => set({ focus: null }),

  // ── Phase 2A: edit / delete / star / pin / forward ──
  // The apply* functions are shared by the HTTP response and the socket event, so they must be idempotent.
  applyEdit: ({ messageId, text, editedAt }) =>
    set((s) => ({
      messages: patchById(s.messages, messageId, { text, editedAt }),
      pinned: patchById(s.pinned, messageId, { text, editedAt }),
      conversations: patchLast(s.conversations, messageId, { text }),
    })),
  applyDeleted: (messageId) =>
    set((s) => ({
      messages: applyDeletedToList(s.messages, messageId),
      pinned: s.pinned.filter((m) => m._id !== messageId),
      conversations: patchLast(s.conversations, messageId, DELETED_PREVIEW_PATCH),
    })),
  applyDeletedForMe: (messageId) => {
    const wasLast = Object.values(get().conversations).some((c) => c.lastMessage?._id === messageId);
    set((s) => ({ messages: s.messages.filter((m) => m._id !== messageId), pinned: s.pinned.filter((m) => m._id !== messageId) }));
    if (wasLast) get().getUsers(); // the preview must fall back to the previous message
  },
  applyStar: (messageId, starred) =>
    set((s) => ({ messages: patchById(s.messages, messageId, { starred }), pinned: patchById(s.pinned, messageId, { starred }) })),
  // A link preview arrived (or was removed because the text changed): linkPreview is an object, or null to clear it
  applyPreview: ({ messageId, linkPreview }) =>
    set((s) => ({
      messages: patchById(s.messages, messageId, { linkPreview: linkPreview || undefined }),
      pinned: patchById(s.pinned, messageId, { linkPreview: linkPreview || undefined }),
    })),
  applyPin: ({ messageId, pinned, pinnedAt }) => {
    set((s) => ({ messages: patchById(s.messages, messageId, { pinnedAt: pinned ? pinnedAt : undefined }) }));
    const u = get().selectedUser;
    if (u) get().getPinned(u._id); // cheap (max 3) and also covers pins older than the loaded page
  },

  // ── Phase 2E: disappearing messages and view-once ──
  // { [contactId]: seconds } for the 1:1 chats that have disappearing messages on (groups carry `disappearAfter` themselves)
  timers: {},
  loadTimers: async () => {
    try {
      const res = await axiosInstance.get("/chats/timers");
      set({ timers: Object.fromEntries(res.data.map((t) => [t.id, t.seconds])) });
    } catch {
      /* non-critical */
    }
  },
  applyTimer: (userId, seconds) =>
    set((s) => {
      const timers = { ...s.timers };
      if (seconds) timers[userId] = seconds;
      else delete timers[userId];
      return { timers };
    }),
  setTimer: async (userId, seconds) => {
    try {
      await axiosInstance.put(`/chats/timer/user/${userId}`, { seconds });
      get().applyTimer(userId, seconds);
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || "Couldn't change the setting");
      return false;
    }
  },
  // The server deleted these (their time ran out): drop them from the open chat, the pins and the chat list preview
  applyExpired: (ids) => {
    const gone = new Set(ids);
    useTranscriptStore.getState().forget(ids); // a transcript never outlives its message
    const wasLast = Object.values(get().conversations).some((c) => gone.has(c.lastMessage?._id));
    set((s) => ({ messages: removeIds(s.messages, gone), pinned: removeIds(s.pinned, gone) }));
    if (wasLast) get().getUsers(); // the preview must fall back to the previous message
  },
  // Someone opened a view-once message: the sender sees `viewCount`, the opener's other tabs see `viewedByMe`
  applyViewed: ({ messageId, viewCount, viewedByMe }) =>
    set((s) => ({
      messages: patchById(s.messages, messageId, {
        ...(viewCount != null ? { viewCount, viewOnceState: "opened" } : {}),
        ...(viewedByMe ? { viewedByMe: true, viewOnceState: "opened" } : {}),
      }),
    })),
  // The view-once file was deleted from the server
  applyViewWiped: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) => (m._id === messageId ? { ...m, mediaWiped: true, viewOnceState: m.viewedByMe || m.viewCount > 0 ? "opened" : "expired" } : m)),
    })),

  // ── Phase 2F: Keep ──
  // Someone kept / un-kept a message: it stops / resumes expiring
  applyKept: ({ messageId, keptBy, expiresAt }) => {
    const patch = { keptBy: keptBy || undefined, expiresAt: expiresAt || undefined };
    set((s) => ({ messages: patchById(s.messages, messageId, patch), pinned: patchById(s.pinned, messageId, patch) }));
  },
  toggleKeep: async (messageId, kept) => {
    try {
      const res = await axiosInstance.put(`/messages/keep/${messageId}`, { kept });
      get().applyKept({ messageId, keptBy: res.data.keptBy, expiresAt: res.data.expiresAt });
    } catch (error) {
      toast.error(error.response?.data?.message || "Couldn't change that");
    }
  },

  getPinned: async (userId) => {
    try {
      const res = await axiosInstance.get(`/messages/pinned/user/${userId}`);
      if (get().selectedUser?._id === userId) set({ pinned: res.data });
    } catch {
      /* non-critical */
    }
  },

  editMessage: async (messageId, text) => {
    try {
      const res = await axiosInstance.put(`/messages/edit/${messageId}`, { text });
      get().applyEdit(res.data);
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || "Couldn't edit the message");
      return false;
    }
  },

  deleteMessage: async (messageId, scope) => {
    try {
      await axiosInstance.delete(`/messages/${messageId}`, { params: { scope } });
      if (scope === "everyone") get().applyDeleted(messageId);
      else get().applyDeletedForMe(messageId);
      useTranscriptStore.getState().forget(messageId); // a transcript never outlives its message
    } catch (error) {
      toast.error(error.response?.data?.message || "Couldn't delete the message");
    }
  },

  toggleStar: async (messageId, starred) => {
    try {
      await axiosInstance.put(`/messages/star/${messageId}`, { starred });
      get().applyStar(messageId, starred);
    } catch (error) {
      toast.error(error.response?.data?.message || "Couldn't update star");
    }
  },

  togglePin: async (messageId, pinned) => {
    try {
      const res = await axiosInstance.put(`/messages/pin/${messageId}`, { pinned });
      get().applyPin({ messageId, pinned, pinnedAt: res.data.pinnedAt });
    } catch (error) {
      toast.error(error.response?.data?.message || "Couldn't update pin");
    }
  },

  // targets: [{ type: "user" | "group", id }] → per-target results, or null if the whole request failed
  forwardMessage: async (messageId, targets) => {
    try {
      const res = await axiosInstance.post("/messages/forward", { messageId, targets });
      return res.data.results;
    } catch (error) {
      toast.error(error.response?.data?.message || "Couldn't forward the message");
      return null;
    }
  },

  // Attached once per socket for the whole session (not per open chat) so that messages for chats
  // you are *not* looking at still produce unread badges and previews.
  initRealtime: (socket) => {
    const me = () => useAuthStore.getState().authUser?._id;
    const visible = () => document.visibilityState === "visible";

    socket.on("newMessage", (msg) => {
      const sender = idOf(msg.senderId);
      const other = sender === me() ? idOf(msg.receiverId) : sender;
      const incoming = sender !== me();
      const { selectedUser } = get();
      const viewing = selectedUser?._id === other;

      set((s) => {
        const prev = s.conversations[other] || { unread: 0 };
        return {
          messages: viewing ? withMessage(s.messages, msg) : s.messages,
          conversations: { ...s.conversations, [other]: { unread: incoming && !(viewing && visible()) ? prev.unread + 1 : prev.unread, lastMessage: lastOf(msg) } },
        };
      });
      if (incoming && viewing && visible()) get().markMessagesAsRead(other);
    });

    socket.on("messagesRead", ({ readBy }) => set((s) => ({ messages: s.messages.map((m) => (idOf(m.receiverId) === readBy ? { ...m, isRead: true } : m)) })));
    socket.on("messagesReadByMe", ({ from }) => set((s) => (s.conversations[from] ? { conversations: { ...s.conversations, [from]: { ...s.conversations[from], unread: 0 } } } : s)));
    socket.on("messageReaction", ({ messageId, reactions, groupId }) => {
      if (groupId) return; // handled by the group store
      set((s) => ({ messages: s.messages.map((m) => (m._id === messageId ? { ...m, reactions } : m)) }));
    });
    socket.on("userTyping", ({ senderId }) => get().selectedUser?._id === senderId && set({ isTyping: true }));
    socket.on("userStopTyping", ({ senderId }) => get().selectedUser?._id === senderId && set({ isTyping: false }));

    // Phase 2A. Events that carry a groupId belong to the group store.
    socket.on("messageEdited", ({ groupId, ...p }) => { if (!groupId) get().applyEdit(p); });
    socket.on("messageDeleted", ({ groupId, messageId }) => { if (!groupId) { get().applyDeleted(messageId); useTranscriptStore.getState().forget(messageId); } });
    socket.on("messageDeletedForMe", ({ messageId }) => get().applyDeletedForMe(messageId));
    socket.on("messageStarred", ({ messageId, starred }) => get().applyStar(messageId, starred));
    socket.on("messagePinned", ({ groupId, ...p }) => { if (!groupId) get().applyPin(p); });
    socket.on("messagePreview", ({ groupId, ...p }) => { if (!groupId) get().applyPreview(p); });
    socket.on("messagesDelivered", ({ to }) => {
      const now = new Date().toISOString();
      set((s) => ({ messages: s.messages.map((m) => (idOf(m.receiverId) === to && !m.deliveredAt ? { ...m, deliveredAt: now } : m)) }));
    });

    // Phase 2E. Events that carry a groupId belong to the group store.
    socket.on("messagesExpired", ({ groupId, messageIds }) => { if (!groupId) get().applyExpired(messageIds); });
    socket.on("messageViewed", ({ groupId, ...p }) => { if (!groupId) get().applyViewed(p); });
    socket.on("messageViewWiped", ({ groupId, messageId }) => { if (!groupId) get().applyViewWiped(messageId); });
    socket.on("chatTimer", ({ kind, id, seconds, by }) => {
      if (kind === "user") get().applyTimer(id, seconds);
      if (!by || by === me()) return;
      const name = kind === "user"
        ? get().users.find((u) => u._id === by)?.fullName
        : useGroupStore.getState().groups.find((g) => g._id === id)?.members?.find((m) => (m._id || m) === by)?.fullName;
      toast(`${name || "Someone"} ${seconds ? `set new messages to disappear after ${timerLabel(seconds)}` : "turned off disappearing messages"}`, { icon: "⏱" });
    });
    // Phase 2F
    socket.on("messageKept", ({ groupId, by, ...p }) => {
      if (groupId) return;
      get().applyKept(p);
      if (p.keptBy && by && by !== me()) toast(`${get().users.find((u) => u._id === by)?.fullName || "Someone"} kept a message`, { icon: "🔖" });
    });

    // After a dropped connection a timer may have been changed meanwhile
    const onConnect = () => get().loadTimers();
    socket.on("connect", onConnect);

    // If the tab was in the background, mark the open chat as read once you come back
    const onVisible = () => {
      const u = get().selectedUser;
      if (visible() && u) get().markMessagesAsRead(u._id);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      ["newMessage", "messagesRead", "messagesReadByMe", "messageReaction", "userTyping", "userStopTyping",
        "messageEdited", "messageDeleted", "messageDeletedForMe", "messageStarred", "messagePinned", "messagePreview", "messagesDelivered",
        "messagesExpired", "messageViewed", "messageViewWiped", "chatTimer", "messageKept"].forEach((e) => socket.off(e));
      socket.off("connect", onConnect);
      document.removeEventListener("visibilitychange", onVisible);
    };
  },
}));
