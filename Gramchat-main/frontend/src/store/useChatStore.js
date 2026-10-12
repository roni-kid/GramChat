import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";

const idOf = (v) => (v && v._id) || v;
// Add a message only if we don't already have it (the same message can arrive via HTTP *and* socket)
const withMessage = (list, msg) => (list.some((m) => m._id === msg._id) ? list : [...list, msg]);
const lastOf = (m) => ({ text: m.text, image: !!m.image, fileName: m.fileName, senderId: idOf(m.senderId), createdAt: m.createdAt });

export const useChatStore = create((set, get) => ({
  messages: [],
  users: [],
  selectedUser: null,
  isUsersLoading: false,
  isMessagesLoading: false,
  isTyping: false,
  replyingTo: null,
  // { [userId]: { unread, lastMessage } } for the chat list
  conversations: {},

  getUsers: async () => {
    set({ isUsersLoading: !get().users.length });
    try {
      const [users, convs] = await Promise.all([axiosInstance.get("/messages/users"), axiosInstance.get("/messages/conversations")]);
      set({ users: users.data, conversations: Object.fromEntries(convs.data.map((c) => [c.userId, { unread: c.unread, lastMessage: c.lastMessage }])) });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to load users");
    } finally {
      set({ isUsersLoading: false });
    }
  },

  getMessages: async (userId) => {
    set({ isMessagesLoading: true, messages: [] });
    try {
      const res = await axiosInstance.get(`/messages/${userId}`);
      if (get().selectedUser?._id === userId) set({ messages: res.data });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to load messages");
    } finally {
      set({ isMessagesLoading: false });
    }
  },

  // Returns true on success so the input only clears when the message really went out
  sendMessage: async (messageData) => {
    const { selectedUser, replyingTo } = get();
    if (!selectedUser) return false;
    try {
      const res = await axiosInstance.post(`/messages/send/${selectedUser._id}`, { ...messageData, replyToId: replyingTo?._id || null });
      // functional update: never overwrite messages that arrived while this request was in flight
      set((s) => ({
        messages: s.selectedUser?._id === selectedUser._id ? withMessage(s.messages, res.data) : s.messages,
        replyingTo: null,
        conversations: { ...s.conversations, [selectedUser._id]: { unread: 0, lastMessage: lastOf(res.data) } },
      }));
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to send message");
      return false;
    }
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
  setSelectedUser: (selectedUser) => set({ selectedUser, isTyping: false, replyingTo: null }),

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
    socket.on("userJoined", (user) => set((s) => (s.users.some((u) => u._id === user._id) ? s : { users: [...s.users, user] })));

    // If the tab was in the background, mark the open chat as read once you come back
    const onVisible = () => {
      const u = get().selectedUser;
      if (visible() && u) get().markMessagesAsRead(u._id);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      ["newMessage", "messagesRead", "messagesReadByMe", "messageReaction", "userTyping", "userStopTyping", "userJoined"].forEach((e) => socket.off(e));
      document.removeEventListener("visibilitychange", onVisible);
    };
  },
}));
