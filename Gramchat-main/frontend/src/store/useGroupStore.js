import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";

const idOf = (v) => (v && v._id) || v;
const withMessage = (list, msg) => (list.some((m) => m._id === msg._id) ? list : [...list, msg]);

export const useGroupStore = create((set, get) => ({
  groups: [],
  selectedGroup: null,
  groupMessages: [],
  isGroupsLoading: false,
  isGroupMessagesLoading: false,
  isGroupTyping: false,
  groupTypingUser: null,
  replyingTo: null,
  // unread counts for groups (this session only)
  groupUnread: {},

  getMyGroups: async () => {
    set({ isGroupsLoading: !get().groups.length });
    try {
      const res = await axiosInstance.get("/groups");
      set({ groups: res.data });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to load groups");
    } finally {
      set({ isGroupsLoading: false });
    }
  },

  createGroup: async ({ name, description, memberIds, groupPic }) => {
    try {
      const res = await axiosInstance.post("/groups", { name, description, memberIds, groupPic });
      set((s) => ({ groups: s.groups.some((g) => g._id === res.data._id) ? s.groups : [res.data, ...s.groups] }));
      toast.success("Group created!");
      return res.data;
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to create group");
      return null;
    }
  },

  getGroupMessages: async (groupId) => {
    set({ isGroupMessagesLoading: true, groupMessages: [] });
    try {
      const res = await axiosInstance.get(`/groups/${groupId}/messages`);
      if (get().selectedGroup?._id === groupId) set({ groupMessages: res.data });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to load group messages");
    } finally {
      set({ isGroupMessagesLoading: false });
    }
  },

  sendGroupMessage: async (groupId, messageData) => {
    try {
      const res = await axiosInstance.post(`/groups/${groupId}/messages`, { ...messageData, replyToId: get().replyingTo?._id || null });
      set((s) => ({ groupMessages: s.selectedGroup?._id === groupId ? withMessage(s.groupMessages, res.data) : s.groupMessages, replyingTo: null }));
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to send message");
      return false;
    }
  },

  addGroupReaction: async (messageId, emoji) => {
    try {
      const res = await axiosInstance.post(`/messages/react/${messageId}`, { emoji });
      set((s) => ({ groupMessages: s.groupMessages.map((m) => (m._id === messageId ? { ...m, reactions: res.data.reactions } : m)) }));
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to add reaction");
    }
  },

  addGroupMember: async (groupId, userId) => {
    try {
      const res = await axiosInstance.post(`/groups/${groupId}/members`, { userId });
      set((s) => ({ groups: s.groups.map((g) => (g._id === groupId ? res.data : g)), selectedGroup: res.data }));
      toast.success("Member added!");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to add member");
    }
  },

  removeGroupMember: async (groupId, userId) => {
    try {
      const res = await axiosInstance.delete(`/groups/${groupId}/members/${userId}`);
      const left = userId === useAuthStore.getState().authUser?._id;
      set((s) => ({
        groups: left || !res.data.members?.length ? s.groups.filter((g) => g._id !== groupId) : s.groups.map((g) => (g._id === groupId ? res.data : g)),
        selectedGroup: left || !res.data.members?.length ? null : res.data,
      }));
      toast.success(left ? "You left the group" : "Member removed");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to remove member");
    }
  },

  updateGroup: async (groupId, data) => {
    try {
      const res = await axiosInstance.put(`/groups/${groupId}`, data);
      set((s) => ({ groups: s.groups.map((g) => (g._id === groupId ? res.data : g)), selectedGroup: res.data }));
      toast.success("Group updated!");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to update group");
    }
  },

  setReplyingTo: (message) => set({ replyingTo: message }),
  clearReplyingTo: () => set({ replyingTo: null }),

  setSelectedGroup: (group) =>
    set((s) => ({
      selectedGroup: group,
      groupMessages: [],
      replyingTo: null,
      isGroupTyping: false,
      groupTypingUser: null,
      groupUnread: group ? { ...s.groupUnread, [group._id]: 0 } : s.groupUnread,
    })),

  // Attached once per socket. The server already put this socket in the rooms of all groups the user belongs to.
  initRealtime: (socket) => {
    const me = () => useAuthStore.getState().authUser?._id;

    socket.on("newGroupMessage", ({ groupId, message }) => {
      const viewing = get().selectedGroup?._id === groupId;
      const mine = idOf(message.senderId) === me();
      set((s) => ({
        groupMessages: viewing ? withMessage(s.groupMessages, message) : s.groupMessages,
        groups: s.groups.map((g) => (g._id === groupId ? { ...g, lastMessage: message } : g)),
        groupUnread: viewing || mine ? s.groupUnread : { ...s.groupUnread, [groupId]: (s.groupUnread[groupId] || 0) + 1 },
      }));
    });
    socket.on("messageReaction", ({ messageId, reactions, groupId }) => {
      if (!groupId) return;
      set((s) => ({ groupMessages: s.groupMessages.map((m) => (m._id === messageId ? { ...m, reactions } : m)) }));
    });
    socket.on("groupUpdated", (g) =>
      set((s) => ({ groups: s.groups.map((x) => (x._id === g._id ? { ...x, ...g, lastMessage: x.lastMessage } : x)), selectedGroup: s.selectedGroup?._id === g._id ? { ...s.selectedGroup, ...g } : s.selectedGroup }))
    );
    socket.on("removedFromGroup", ({ groupId }) => {
      set((s) => ({ groups: s.groups.filter((g) => g._id !== groupId), selectedGroup: s.selectedGroup?._id === groupId ? null : s.selectedGroup }));
    });
    socket.on("groupCreated", (g) => set((s) => (s.groups.some((x) => x._id === g._id) ? s : { groups: [g, ...s.groups] })));
    socket.on("groupUserTyping", ({ senderId, groupId }) => get().selectedGroup?._id === groupId && set({ isGroupTyping: true, groupTypingUser: senderId }));
    socket.on("groupUserStopTyping", ({ groupId }) => get().selectedGroup?._id === groupId && set({ isGroupTyping: false, groupTypingUser: null }));

    return () => ["newGroupMessage", "messageReaction", "groupUpdated", "removedFromGroup", "groupCreated", "groupUserTyping", "groupUserStopTyping"].forEach((e) => socket.off(e));
  },
}));
