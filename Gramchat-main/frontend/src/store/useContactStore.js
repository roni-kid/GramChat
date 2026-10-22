import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { useChatStore } from "./useChatStore";

const fail = (e, fallback) => toast.error(e.response?.data?.message || fallback);

export const useContactStore = create((set, get) => ({
  contacts: [],
  incoming: [], // people who asked to connect with me
  outgoing: [], // people I asked
  blocked: [],

  load: async () => {
    try {
      const { data } = await axiosInstance.get("/contacts");
      set(data);
    } catch {
      /* not critical; the next event retries */
    }
  },

  // Exact username lookup. Returns the result object, or null when nobody matches.
  search: async (username) => {
    try {
      const { data } = await axiosInstance.get("/contacts/search", { params: { username } });
      return data;
    } catch (e) {
      if (e.response?.status !== 404) fail(e, "Search failed");
      return null;
    }
  },

  // After any change, refresh both lists (the chat list is built from accepted contacts)
  _refresh: async () => {
    await Promise.all([get().load(), useChatStore.getState().getUsers()]);
  },

  sendRequest: async (userId) => {
    try {
      const { data } = await axiosInstance.post(`/contacts/request/${userId}`);
      toast.success(data.status === "accepted" ? "You're now contacts!" : "Request sent");
      await get()._refresh();
      return data.status;
    } catch (e) {
      fail(e, "Couldn't send request");
      return null;
    }
  },

  accept: async (userId) => {
    try {
      await axiosInstance.post(`/contacts/accept/${userId}`);
      toast.success("Contact added");
      await get()._refresh();
    } catch (e) {
      fail(e, "Couldn't accept");
    }
  },

  // decline an incoming request, cancel an outgoing one, or remove a contact
  remove: async (userId) => {
    try {
      await axiosInstance.delete(`/contacts/${userId}`);
      if (useChatStore.getState().selectedUser?._id === userId) useChatStore.getState().setSelectedUser(null);
      await get()._refresh();
    } catch (e) {
      fail(e, "Couldn't remove");
    }
  },

  block: async (userId) => {
    try {
      await axiosInstance.post(`/contacts/block/${userId}`);
      if (useChatStore.getState().selectedUser?._id === userId) useChatStore.getState().setSelectedUser(null);
      toast.success("Blocked");
      await get()._refresh();
    } catch (e) {
      fail(e, "Couldn't block");
    }
  },

  unblock: async (userId) => {
    try {
      await axiosInstance.delete(`/contacts/block/${userId}`);
      toast.success("Unblocked");
      await get()._refresh();
    } catch (e) {
      fail(e, "Couldn't unblock");
    }
  },

  // One listener for the whole session
  initRealtime: (socket) => {
    get().load();
    socket.on("contactsChanged", (ev = {}) => {
      if (ev.type === "request") toast(`@${ev.user.username} wants to connect`, { icon: "👋" });
      if (ev.type === "accepted" && ev.user) toast.success(`You and @${ev.user.username} are now contacts`);
      if (ev.type === "removed" && useChatStore.getState().selectedUser?._id === ev.userId) useChatStore.getState().setSelectedUser(null);
      get()._refresh();
    });
    return () => socket.off("contactsChanged");
  },
}));
