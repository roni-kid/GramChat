import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";

export const useStatusStore = create((set, get) => ({
  statuses: [],
  isStatusesLoading: false,

  getStatuses: async () => {
    set({ isStatusesLoading: true });
    try {
      const res = await axiosInstance.get("/status");
      set({ statuses: res.data });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to load statuses");
    } finally {
      set({ isStatusesLoading: false });
    }
  },

  createStatus: async ({ text, image, bgColor }) => {
    try {
      const res = await axiosInstance.post("/status", { text, image, bgColor });
      set({ statuses: [res.data, ...get().statuses] });
      toast.success("Status posted!");
      return res.data;
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to post status");
      return null;
    }
  },

  viewStatus: async (statusId) => {
    try {
      await axiosInstance.post(`/status/view/${statusId}`);
      set((st) => ({ statuses: st.statuses.map((s) => (s._id === statusId ? { ...s, viewedByMe: true } : s)) }));
    } catch (error) {
      console.log("Error viewing status:", error.message);
    }
  },

  deleteStatus: async (statusId) => {
    try {
      await axiosInstance.delete(`/status/${statusId}`);
      set({ statuses: get().statuses.filter((s) => s._id !== statusId) });
      toast.success("Status deleted");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to delete status");
    }
  },

  subscribeToStatuses: () => {
    const socket = useAuthStore.getState().socket;
    if (!socket) return;

    socket.on("newStatus", (status) => {
      const exists = get().statuses.find((s) => s._id === status._id);
      if (!exists) set({ statuses: [status, ...get().statuses] });
    });

    socket.on("statusDeleted", ({ statusId }) => {
      set({ statuses: get().statuses.filter((s) => s._id !== statusId) });
    });

    socket.on("statusViewed", ({ statusId, viewerId }) => {
      set((st) => ({
        statuses: st.statuses.map((s) => (s._id === statusId ? { ...s, viewedBy: [...new Set([...(s.viewedBy || []), viewerId])] } : s)),
      }));
    });
  },

  unsubscribeFromStatuses: () => {
    const socket = useAuthStore.getState().socket;
    if (!socket) return;
    socket.off("newStatus");
    socket.off("statusDeleted");
    socket.off("statusViewed");
  },

  // Group statuses by user
  getStatusesByUser: () => {
    const statuses = get().statuses;
    const grouped = {};
    statuses.forEach((s) => {
      const uid = s.userId._id || s.userId;
      if (!grouped[uid]) grouped[uid] = { user: s.userId, items: [] };
      grouped[uid].items.push(s);
    });
    return Object.values(grouped);
  },
}));
