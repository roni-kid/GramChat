import Navbar from "./components/Navbar";
import HomePage from "./pages/HomePage";
import SignUpPage from "./pages/SignUpPage";
import LoginPage from "./pages/LoginPage";
import SettingsPage from "./pages/SettingsPage";
import ProfilePage from "./pages/ProfilePage";
import StatusPage from "./pages/StatusPage";
import CallOverlay from "./components/CallOverlay";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/useAuthStore";
import { useThemeStore } from "./store/useThemeStore";
import { useChatStore } from "./store/useChatStore";
import { useGroupStore } from "./store/useGroupStore";
import { useEffect } from "react";
import { Loader } from "lucide-react";
import { Toaster } from "react-hot-toast";

const App = () => {
  const { authUser, checkAuth, isCheckingAuth } = useAuthStore();
  const { theme } = useThemeStore();
  const socket = useAuthStore((s) => s.socket);
  const chatUnread = useChatStore((s) => Object.values(s.conversations).reduce((n, c) => n + (c.unread || 0), 0));
  const groupUnread = useGroupStore((s) => Object.values(s.groupUnread).reduce((n, c) => n + c, 0));

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Session-wide realtime handlers (unread badges, live updates for chats that aren't open)
  useEffect(() => {
    if (!socket) return;
    const offs = [useChatStore.getState().initRealtime(socket), useGroupStore.getState().initRealtime(socket)];
    return () => offs.forEach((off) => off());
  }, [socket]);

  // "(3) Gramchat" in the browser tab / installed-app title
  useEffect(() => {
    const n = chatUnread + groupUnread;
    document.title = n > 0 ? `(${n}) Gramchat` : "Gramchat";
  }, [chatUnread, groupUnread]);

  // Apply theme to <html> — DaisyUI requires this to cascade across the entire page
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  if (isCheckingAuth && !authUser)
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader className="size-10 animate-spin" />
      </div>
    );

  return (
    <>
      <Navbar />

      {authUser && <CallOverlay />}

      <Routes>
        <Route path="/" element={authUser ? <HomePage /> : <Navigate to="/login" />} />
        <Route path="/signup" element={!authUser ? <SignUpPage /> : <Navigate to="/" />} />
        <Route path="/login" element={!authUser ? <LoginPage /> : <Navigate to="/" />} />
        <Route path="/settings" element={authUser ? <SettingsPage /> : <Navigate to="/login" />} />
        <Route path="/profile" element={authUser ? <ProfilePage /> : <Navigate to="/login" />} />
        <Route path="/status" element={authUser ? <StatusPage /> : <Navigate to="/login" />} />
      </Routes>

      <Toaster />
    </>
  );
};
export default App;
