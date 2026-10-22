import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { UsersRound } from "lucide-react";
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "../store/useAuthStore";
import { openChatAt } from "../lib/openChat";
import { formatListTime, previewOf, snippetAround } from "../lib/utils";

const PAGE = 30;
const idOf = (v) => (v && v._id) || v;

/** Text with every occurrence of `query` highlighted (case-insensitive, no regex surprises). */
const Highlight = ({ text, query }) => {
  const q = query.trim().toLowerCase();
  if (!q || !text) return text || null;
  const parts = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at} className="bg-yellow-300 text-black rounded px-0.5">{text.slice(at, at + q.length)}</mark>);
    from = at + q.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
};

/** "Messages" section of the chat list while searching: matches inside every chat and group, newest first.
 *  Tapping one opens that chat and scrolls to the message. */
const MessageSearchResults = ({ query }) => {
  const me = useAuthStore((s) => s.authUser?._id);
  const q = query.trim();
  const [state, setState] = useState({ items: [], loading: false, more: false, done: false });

  useEffect(() => {
    if (q.length < 2) {
      setState({ items: [], loading: false, more: false, done: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, done: false }));
    const timer = setTimeout(async () => {
      try {
        const res = await axiosInstance.get("/messages/search", { params: { q, limit: PAGE } });
        if (alive) setState({ items: res.data, loading: false, more: res.data.length >= PAGE, done: true });
      } catch (error) {
        if (!alive) return;
        setState({ items: [], loading: false, more: false, done: true });
        if (error.response?.status !== 429) toast.error(error.response?.data?.message || "Search failed");
      }
    }, 350); // wait for a pause in typing
    return () => { alive = false; clearTimeout(timer); };
  }, [q]);

  const loadMore = async () => {
    const last = state.items[state.items.length - 1];
    if (!last) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await axiosInstance.get("/messages/search", { params: { q, limit: PAGE, before: last.createdAt } });
      setState((s) => ({ items: [...s.items, ...res.data], loading: false, more: res.data.length >= PAGE, done: true }));
    } catch (error) {
      setState((s) => ({ ...s, loading: false }));
      toast.error(error.response?.data?.message || "Search failed");
    }
  };

  const open = async (m) => {
    const isGroup = !!m.groupId;
    const chatId = isGroup ? idOf(m.groupId) : idOf(m.senderId) === me ? idOf(m.receiverId) : idOf(m.senderId);
    const ok = await openChatAt(isGroup ? "group" : "dm", chatId, { id: m._id, createdAt: m.createdAt });
    if (!ok) toast.error(isGroup ? "You're no longer in that group" : "That person is no longer in your contacts");
  };

  if (q.length < 2) return null;
  const { items, loading, more, done } = state;

  return (
    <div className="border-t border-base-300 mt-2 pt-2">
      <h3 className="px-4 pb-1 text-xs font-medium uppercase tracking-wider text-base-content/50">Messages</h3>
      {loading && items.length === 0 && <div className="flex justify-center py-4"><span className="loading loading-spinner loading-sm" /></div>}
      {done && !loading && items.length === 0 && <p className="px-4 py-3 text-sm text-base-content/50">No messages contain "{q}"</p>}

      {items.map((m) => {
        const isGroup = !!m.groupId;
        const mine = idOf(m.senderId) === me;
        const other = mine ? m.receiverId : m.senderId;
        const chatName = isGroup ? m.groupId.name : other?.fullName || "Contact";
        const pic = isGroup ? m.groupId.groupPic : other?.profilePic;
        const who = mine ? "You: " : isGroup && m.senderId?.fullName ? `${m.senderId.fullName}: ` : "";
        // the match is in the text, or in a file's name
        const hit = m.text && m.text.toLowerCase().includes(q.toLowerCase()) ? snippetAround(m.text, q) : previewOf({ fileName: m.fileName });
        return (
          <button key={m._id} type="button" onClick={() => open(m)} className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-base-300 transition-colors">
            <div className="relative shrink-0">
              <img src={pic || "/avatar.png"} alt="" className="size-10 rounded-full object-cover" />
              {isGroup && (
                <span className="absolute -bottom-0.5 -right-0.5 size-4 bg-primary rounded-full ring-2 ring-base-100 flex items-center justify-center">
                  <UsersRound className="size-2.5 text-primary-content" />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium truncate">{chatName}</span>
                <span className="text-xs text-base-content/40 shrink-0">{formatListTime(m.createdAt)}</span>
              </div>
              <p className="text-sm text-zinc-400 truncate"><span>{who}</span><Highlight text={hit} query={q} /></p>
            </div>
          </button>
        );
      })}

      {more && (
        <div className="flex justify-center py-2">
          <button type="button" className="btn btn-ghost btn-xs" disabled={loading} onClick={loadMore}>
            {loading ? <span className="loading loading-spinner loading-xs" /> : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
};

export default MessageSearchResults;
