import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";
import { patchById, applyDeletedToList, removeIds } from "../lib/messageRules";

const idOf = (v) => (v && v._id) || v;
const PAGE_SIZE = 50; // matches the server default
const withMessage = (list, msg) => (list.some((m) => m._id === msg._id) ? list : [...list, msg]);
// A group's `lastMessage` is a full message object: patch it when it is the one that changed
const patchGroupLast = (groups, id, patch) => groups.map((g) => (g.lastMessage?._id === id ? { ...g, lastMessage: { ...g.lastMessage, ...patch } } : g));

export const useGroupStore = create((set, get) => ({
  groups: [],
  selectedGroup: null,
  groupMessages: [],
  isGroupsLoading: false,
  isGroupMessagesLoading: false,
  isGroupTyping: false,
  groupTypingUser: null,
  replyingTo: null,
  // infinite scroll: are there older messages than the ones loaded?
  hasMore: false,
  isLoadingOlder: false,
  // up to 3 pinned messages of the open group
  pinned: [],
  // a message to scroll to once the open group has loaded: { id, createdAt } (set by search results and the media gallery)
  focus: null,
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
    set({ isGroupMessagesLoading: true, groupMessages: [], hasMore: false });
    try {
      const res = await axiosInstance.get(`/groups/${groupId}/messages`, { params: { limit: PAGE_SIZE } });
      if (get().selectedGroup?._id === groupId) set({ groupMessages: res.data, hasMore: res.data.length >= PAGE_SIZE });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to load group messages");
    } finally {
      set({ isGroupMessagesLoading: false });
    }
  },

  // Older messages (infinite scroll). Returns how many were added.
  loadOlder: async () => {
    const { selectedGroup, groupMessages, hasMore, isLoadingOlder } = get();
    if (!selectedGroup || !hasMore || isLoadingOlder || !groupMessages.length) return 0;
    const groupId = selectedGroup._id;
    set({ isLoadingOlder: true });
    try {
      const res = await axiosInstance.get(`/groups/${groupId}/messages`, { params: { before: groupMessages[0].createdAt, limit: PAGE_SIZE } });
      if (get().selectedGroup?._id !== groupId) return 0;
      const have = new Set(get().groupMessages.map((m) => m._id));
      const older = res.data.filter((m) => !have.has(m._id));
      set((s) => ({ groupMessages: [...older, ...s.groupMessages], hasMore: older.length > 0 && res.data.length >= PAGE_SIZE }));
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
      const { groupMessages, hasMore } = get();
      if (!hasMore || !groupMessages.length || new Date(groupMessages[0].createdAt) <= new Date(createdAt)) return;
      if (!(await get().loadOlder())) return;
    }
  },

  // Called by the send queue once the server has accepted a message (the socket may deliver the same one: de-duplicated by id)
  applySentGroup: (msg) =>
    set((s) => ({
      groupMessages: s.selectedGroup?._id === msg.groupId ? withMessage(s.groupMessages, msg) : s.groupMessages,
      groups: s.groups.map((g) => (g._id === msg.groupId ? { ...g, lastMessage: msg } : g)),
    })),

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

  // ── Phase 2A: edit / delete / star / pin (same action names as the DM store so the shared menu works with both) ──
  // apply* are shared by the HTTP response and the socket event, so they must be idempotent.
  applyEdit: ({ messageId, text, editedAt }) =>
    set((s) => ({
      groupMessages: patchById(s.groupMessages, messageId, { text, editedAt }),
      pinned: patchById(s.pinned, messageId, { text, editedAt }),
      groups: patchGroupLast(s.groups, messageId, { text, editedAt }),
    })),
  applyDeleted: (messageId) =>
    set((s) => ({
      groupMessages: applyDeletedToList(s.groupMessages, messageId),
      pinned: s.pinned.filter((m) => m._id !== messageId),
      groups: patchGroupLast(s.groups, messageId, { deletedForEveryone: true, text: undefined, image: undefined, fileName: undefined }),
    })),
  applyDeletedForMe: (messageId) => {
    const wasLast = get().groups.some((g) => g.lastMessage?._id === messageId);
    set((s) => ({ groupMessages: s.groupMessages.filter((m) => m._id !== messageId), pinned: s.pinned.filter((m) => m._id !== messageId) }));
    if (wasLast) get().getMyGroups(); // the preview must fall back to the previous message
  },
  applyStar: (messageId, starred) =>
    set((s) => ({ groupMessages: patchById(s.groupMessages, messageId, { starred }), pinned: patchById(s.pinned, messageId, { starred }) })),
  // A link preview arrived (or was removed because the text changed): linkPreview is an object, or null to clear it
  applyPreview: ({ messageId, linkPreview }) =>
    set((s) => ({
      groupMessages: patchById(s.groupMessages, messageId, { linkPreview: linkPreview || undefined }),
      pinned: patchById(s.pinned, messageId, { linkPreview: linkPreview || undefined }),
      groups: patchGroupLast(s.groups, messageId, { linkPreview: linkPreview || undefined }),
    })),
  applyPin: ({ messageId, pinned, pinnedAt }) => {
    set((s) => ({ groupMessages: patchById(s.groupMessages, messageId, { pinnedAt: pinned ? pinnedAt : undefined }) }));
    const g = get().selectedGroup;
    if (g) get().getPinned(g._id);
  },

  getPinned: async (groupId) => {
    try {
      const res = await axiosInstance.get(`/messages/pinned/group/${groupId}`);
      if (get().selectedGroup?._id === groupId) set({ pinned: res.data });
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

  // ── Phase 2E: disappearing messages and view-once (same action names as the DM store) ──
  // Admin only (the server enforces it). The group then carries `disappearAfter`, and members get it through `groupUpdated`.
  setDisappearing: async (groupId, seconds) => {
    try {
      const res = await axiosInstance.put(`/groups/${groupId}/disappearing`, { seconds });
      set((s) => ({
        groups: s.groups.map((g) => (g._id === groupId ? { ...g, ...res.data, lastMessage: g.lastMessage } : g)),
        selectedGroup: s.selectedGroup?._id === groupId ? { ...s.selectedGroup, ...res.data } : s.selectedGroup,
      }));
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || "Couldn't change the setting");
      return false;
    }
  },
  // The server deleted these (their time ran out)
  applyExpired: (ids) => {
    const gone = new Set(ids);
    const wasLast = get().groups.some((g) => gone.has(g.lastMessage?._id));
    set((s) => ({ groupMessages: removeIds(s.groupMessages, gone), pinned: removeIds(s.pinned, gone) }));
    if (wasLast) get().getMyGroups(); // the preview must fall back to the previous message
  },
  applyViewed: ({ messageId, viewCount, viewedByMe }) =>
    set((s) => ({
      groupMessages: patchById(s.groupMessages, messageId, {
        ...(viewCount != null ? { viewCount, viewOnceState: "opened" } : {}),
        ...(viewedByMe ? { viewedByMe: true, viewOnceState: "opened" } : {}),
      }),
    })),
  applyViewWiped: (messageId) =>
    set((s) => ({
      groupMessages: s.groupMessages.map((m) => (m._id === messageId ? { ...m, mediaWiped: true, viewOnceState: m.viewedByMe || m.viewCount > 0 ? "opened" : "expired" } : m)),
    })),

  setFocus: (focus) => set({ focus }),
  clearFocus: () => set({ focus: null }),

  setSelectedGroup: (group) =>
    set((s) => ({
      selectedGroup: group,
      groupMessages: [],
      pinned: [],
      focus: null,
      replyingTo: null,
      hasMore: false,
      isLoadingOlder: false,
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

    // Phase 2A. Only events that carry a groupId belong here (the DM store handles the rest).
    socket.on("messageEdited", ({ groupId, ...p }) => { if (groupId) get().applyEdit(p); });
    socket.on("messageDeleted", ({ groupId, messageId }) => { if (groupId) get().applyDeleted(messageId); });
    socket.on("messageDeletedForMe", ({ messageId, groupId }) => { if (groupId) get().applyDeletedForMe(messageId); });
    socket.on("messageStarred", ({ messageId, starred }) => get().applyStar(messageId, starred));
    socket.on("messagePinned", ({ groupId, ...p }) => { if (groupId) get().applyPin(p); });
    socket.on("messagePreview", ({ groupId, ...p }) => { if (groupId) get().applyPreview(p); });

    // Phase 2E. Only events that carry a groupId belong here (the DM store handles the rest).
    socket.on("messagesExpired", ({ groupId, messageIds }) => { if (groupId) get().applyExpired(messageIds); });
    socket.on("messageViewed", ({ groupId, ...p }) => { if (groupId) get().applyViewed(p); });
    socket.on("messageViewWiped", ({ groupId, messageId }) => { if (groupId) get().applyViewWiped(messageId); });

    return () => ["newGroupMessage", "messageReaction", "groupUpdated", "removedFromGroup", "groupCreated", "groupUserTyping", "groupUserStopTyping",
      "messageEdited", "messageDeleted", "messageDeletedForMe", "messageStarred", "messagePinned", "messagePreview", "messagesExpired", "messageViewed", "messageViewWiped"].forEach((e) => socket.off(e));
  },
}));
