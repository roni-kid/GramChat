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
import { useContactStore } from "./store/useContactStore";
import { useOutboxStore } from "./store/useOutboxStore";
import { useChatPrefsStore, prefKey, isMuted } from "./store/useChatPrefsStore";
import { useDraftStore } from "./store/useDraftStore";
import { useEffect, useMemo } from "react";
import { Loader } from "lucide-react";
import { Toaster } from "react-hot-toast";
import { openChat } from "./lib/openChat";

const App = () => {
  const { authUser, checkAuth, isCheckingAuth } = useAuthStore();
  const { theme } = useThemeStore();
  const socket = useAuthStore((s) => s.socket);
  const conversations = useChatStore((s) => s.conversations);
  const groupUnreadMap = useGroupStore((s) => s.groupUnread);
  const prefs = useChatPrefsStore((s) => s.prefs);
  // Unread messages in the tab title: muted chats don't count
  const unreadTotal = useMemo(() => {
    let n = 0;
    for (const [id, c] of Object.entries(conversations)) if (!isMuted(prefs[prefKey("user", id)])) n += c.unread || 0;
    for (const [id, c] of Object.entries(groupUnreadMap)) if (!isMuted(prefs[prefKey("group", id)])) n += c || 0;
    return n;
  }, [conversations, groupUnreadMap, prefs]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // When logged out (or the session expires), forget everything about the previous account
  useEffect(() => {
    if (authUser) return;
    useChatStore.setState({ users: [], messages: [], selectedUser: null, conversations: {}, timers: {}, usersLoaded: false, replyingTo: null, isTyping: false });
    useGroupStore.setState({ groups: [], selectedGroup: null, groupMessages: [], groupUnread: {}, replyingTo: null });
    useContactStore.setState({ contacts: [], incoming: [], outgoing: [], blocked: [] });
    // Unsent messages and drafts disappear from the screen; they stay stored for the same account unless it was an explicit logout
    useOutboxStore.getState().reset();
    useDraftStore.getState().reset();
    useChatPrefsStore.getState().reset();
  }, [authUser]);

  // Signed in: bring back this account's unsent messages and drafts
  const myId = authUser?._id;
  useEffect(() => {
    if (!myId) return;
    useDraftStore.getState().load(myId);
    useOutboxStore.getState().load(myId);
    useChatPrefsStore.getState().load();
    useChatStore.getState().loadTimers();
  }, [myId]);

  // Session-wide realtime handlers (unread badges, live updates for chats that aren't open)
  useEffect(() => {
    if (!socket) return;
    const offs = [useChatStore.getState().initRealtime(socket), useGroupStore.getState().initRealtime(socket), useContactStore.getState().initRealtime(socket), useOutboxStore.getState().initRealtime(socket), useChatPrefsStore.getState().initRealtime(socket)];
    return () => offs.forEach((off) => off());
  }, [socket]);

  // Tapping a notification: the service worker either messages this open tab, or opens the app at /?open=dm:<id> | group:<id>
  const loggedIn = !!authUser;
  useEffect(() => {
    if (!loggedIn) return;
    const onMessage = (e) => { if (e.data?.type === "openChat") openChat(e.data.kind, e.data.chatId); };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    const target = new URLSearchParams(window.location.search).get("open");
    if (target) {
      const [kind, ...rest] = target.split(":");
      openChat(kind, rest.join(":"));
      window.history.replaceState({}, "", window.location.pathname);
    }
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, [loggedIn]);

  // "(3) Gramchat" in the browser tab / installed-app title
  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Gramchat` : "Gramchat";
  }, [unreadTotal]);

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
