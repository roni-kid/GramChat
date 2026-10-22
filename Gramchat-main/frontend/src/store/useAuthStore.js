import { create } from "zustand";
import { axiosInstance } from "../lib/axios.js";
import toast from "react-hot-toast";
import { io } from "socket.io-client";
import { removePushOnLogout } from "../lib/pushClient.js";

// undefined = same origin as the page. Override with VITE_SOCKET_URL if the socket server is elsewhere.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined;

const getAuthErrorMessage = (error, fallback) => {
  if (error.response?.data?.message) return error.response.data.message;
  if (error.code === "ERR_NETWORK" || !error.response) {
    return "Cannot reach the server. Make sure the backend is running and you opened the right address.";
  }
  return fallback;
};

export const useAuthStore = create((set, get) => ({
  authUser: null,
  isSigningUp: false,
  isLoggingIn: false,
  isUpdatingProfile: false,
  isCheckingAuth: true,
  onlineUsers: [],
  socket: null,

  checkAuth: async () => {
    try {
      const res = await axiosInstance.get("/auth/check");
      set({ authUser: res.data });
      get().connectSocket();
    } catch {
      set({ authUser: null });
    } finally {
      set({ isCheckingAuth: false });
    }
  },

  signup: async (data) => {
    set({ isSigningUp: true });
    try {
      const res = await axiosInstance.post("/auth/signup", data);
      set({ authUser: res.data });
      toast.success("Account created successfully");
      get().connectSocket();
    } catch (error) {
      toast.error(getAuthErrorMessage(error, "Signup failed"));
    } finally {
      set({ isSigningUp: false });
    }
  },

  login: async (data) => {
    set({ isLoggingIn: true });
    try {
      const res = await axiosInstance.post("/auth/login", data);
      set({ authUser: res.data });
      toast.success("Logged in successfully");
      get().connectSocket();
    } catch (error) {
      toast.error(getAuthErrorMessage(error, "Login failed"));
    } finally {
      set({ isLoggingIn: false });
    }
  },

  logout: async () => {
    try {
      await removePushOnLogout(); // while the cookie is still valid: stop this device receiving this account's notifications
      await axiosInstance.post("/auth/logout");
      get().disconnectSocket();
      // Explicit logout: unsent messages and drafts are wiped from this device (stores listen for this)
      window.dispatchEvent(new Event("gramchat:logout"));
      set({ authUser: null, socket: null, onlineUsers: [] });
      toast.success("Logged out successfully");
    } catch (error) {
      toast.error(error.response?.data?.message || "Logout failed");
    }
  },

  updateProfile: async (data) => {
    set({ isUpdatingProfile: true });
    try {
      const res = await axiosInstance.put("/auth/update-profile", data);
      set({ authUser: res.data });
      toast.success("Profile updated successfully");
    } catch (error) {
      toast.error(error.response?.data?.message || "Profile update failed");
    } finally {
      set({ isUpdatingProfile: false });
    }
  },

  updateUsername: async (username) => {
    try {
      const res = await axiosInstance.put("/auth/username", { username });
      set({ authUser: res.data });
      toast.success("Username updated");
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || "Couldn't change username");
      return false;
    }
  },

  updatePrivacy: async (changes) => {
    const before = get().authUser;
    set({ authUser: { ...before, privacy: { ...before.privacy, ...changes } } }); // optimistic
    try {
      const res = await axiosInstance.put("/auth/privacy", changes);
      set({ authUser: res.data });
    } catch (error) {
      set({ authUser: before });
      toast.error(error.response?.data?.message || "Couldn't save setting");
    }
  },

  // The server identifies the user from the login cookie; the client never states who it is.
  connectSocket: () => {
    const { authUser, socket: existing } = get();
    if (!authUser || existing) return;

    const socket = io(SOCKET_URL, { withCredentials: true });
    socket.on("getOnlineUsers", (userIds) => set({ onlineUsers: userIds }));
    socket.on("connect_error", (err) => {
      if (err.message === "unauthorized") {
        // Login expired: drop back to the login page instead of retrying forever
        socket.disconnect();
        set({ authUser: null, socket: null });
      }
    });
    set({ socket });
  },

  disconnectSocket: () => {
    const { socket } = get();
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    set({ socket: null });
  },
}));
