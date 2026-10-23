import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { Bookmark, BookmarkMinus, CornerUpLeft, Copy, EllipsisVertical, Forward, Info, Pencil, Pin, PinOff, Search, Star, Trash2, X } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import { useGroupStore } from "../store/useGroupStore";
import { useAuthStore } from "../store/useAuthStore";
import { canEdit, canDeleteForEveryone, canKeep, canUnkeep, MAX_FORWARD_TARGETS } from "../lib/messageRules";
import MessageInfoModal from "./MessageInfoModal";
import { previewOf } from "../lib/utils";

const storeFor = (store) => (store === "dm" ? useChatStore : useGroupStore).getState();

// navigator.clipboard only exists on HTTPS / localhost; over plain http on a LAN IP we fall back to execCommand.
const copyText = async (text) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
};

const Modal = ({ title, onClose, children }) =>
  createPortal(
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} className="bg-base-100 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-300">
          <h2 className="font-semibold text-lg">{title}</h2>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );

const DeleteDialog = ({ message, isOwn, store, onClose }) => {
  const myId = useAuthStore((s) => s.authUser?._id);
  const everyone = isOwn && canDeleteForEveryone(message, myId);
  const run = (scope) => {
    storeFor(store).deleteMessage(message._id, scope);
    onClose();
  };
  return (
    <Modal title="Delete message?" onClose={onClose}>
      <div className="p-5 space-y-2">
        <p className="text-sm text-base-content/60 mb-3 line-clamp-2">{previewOf(message)}</p>
        {everyone && <button className="btn btn-error btn-sm w-full" onClick={() => run("everyone")}>Delete for everyone</button>}
        <button className="btn btn-outline btn-error btn-sm w-full" onClick={() => run("me")}>Delete for me</button>
        <button className="btn btn-ghost btn-sm w-full" onClick={onClose}>Cancel</button>
        {isOwn && !everyone && !message.deletedForEveryone && (
          <p className="text-xs text-base-content/50 pt-1">It's too old to delete for everyone.</p>
        )}
      </div>
    </Modal>
  );
};

const ForwardModal = ({ message, onClose }) => {
  const users = useChatStore((s) => s.users);
  const groups = useGroupStore((s) => s.groups);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState([]); // "user:<id>" | "group:<id>"
  const [sending, setSending] = useState(false);

  const q = query.trim().toLowerCase();
  const rows = [
    ...users.map((u) => ({ key: `user:${u._id}`, type: "user", id: u._id, name: u.fullName, pic: u.profilePic })),
    ...groups.map((g) => ({ key: `group:${g._id}`, type: "group", id: g._id, name: g.name, pic: g.groupPic })),
  ].filter((r) => r.name.toLowerCase().includes(q));

  const toggle = (key) =>
    setPicked((p) => {
      if (p.includes(key)) return p.filter((k) => k !== key);
      if (p.length >= MAX_FORWARD_TARGETS) { toast.error(`You can forward to ${MAX_FORWARD_TARGETS} chats at a time`); return p; }
      return [...p, key];
    });

  const send = async () => {
    setSending(true);
    const targets = picked.map((k) => ({ type: k.split(":")[0], id: k.split(":")[1] }));
    const results = await useChatStore.getState().forwardMessage(message._id, targets);
    setSending(false);
    if (!results) return;
    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    if (ok) toast.success(`Forwarded to ${ok} chat${ok > 1 ? "s" : ""}`);
    if (failed.length) toast.error(`${failed.length} couldn't be sent: ${failed[0].error}`);
    onClose();
  };

  return (
    <Modal title="Forward to…" onClose={onClose}>
      <div className="px-5 pt-4">
        <p className="text-xs text-base-content/60 line-clamp-2 mb-3 border-l-2 border-primary pl-2">{previewOf(message)}</p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-base-content/40" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search contacts and groups" className="input input-bordered input-sm w-full pl-9 rounded-full" autoFocus />
        </div>
      </div>
      <div className="overflow-y-auto px-3 py-2 flex-1 min-h-[8rem]">
        {rows.map((r) => (
          <button key={r.key} type="button" onClick={() => toggle(r.key)}
            className={`flex items-center gap-3 w-full p-2.5 rounded-xl transition-colors ${picked.includes(r.key) ? "bg-primary/10 border border-primary/30" : "hover:bg-base-200 border border-transparent"}`}>
            <img src={r.pic || "/avatar.png"} alt="" className="size-9 rounded-full object-cover flex-shrink-0" />
            <span className="text-sm font-medium flex-1 text-left truncate">{r.name}</span>
            {r.type === "group" && <span className="badge badge-ghost badge-sm">Group</span>}
            {picked.includes(r.key) && <span className="size-5 rounded-full bg-primary text-primary-content text-xs flex items-center justify-center flex-shrink-0">✓</span>}
          </button>
        ))}
        {rows.length === 0 && <p className="text-center text-sm text-base-content/50 py-8">{q ? `No results for "${query}"` : "No contacts or groups yet"}</p>}
      </div>
      <div className="px-5 py-4 border-t border-base-300 flex gap-2">
        <button className="btn btn-ghost flex-1" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary flex-1" disabled={!picked.length || sending} onClick={send}>
          {sending ? <span className="loading loading-spinner loading-sm" /> : `Send${picked.length ? ` (${picked.length})` : ""}`}
        </button>
      </div>
    </Modal>
  );
};

/** The "⋯" menu on a message: reply, copy, forward, star, pin, edit, delete. Works for both DMs ("dm") and groups ("group"). */
const MessageMenu = ({ message, isOwn, store, onReply, onEdit }) => {
  const myId = useAuthStore((s) => s.authUser?._id);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [dialog, setDialog] = useState(null); // "delete" | "forward"
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const act = () => storeFor(store);
  const items = message.deletedForEveryone
    ? [{ key: "del", label: "Delete for me", icon: Trash2, danger: true, run: () => setDialog("delete") }]
    : message.viewOnce
    // View-once messages can't be replied to, copied, forwarded, starred, pinned or edited: only deleted
    ? [{ key: "del", label: "Delete…", icon: Trash2, danger: true, run: () => setDialog("delete") }]
    : [
        { key: "reply", label: "Reply", icon: CornerUpLeft, run: () => onReply(message) },
        message.text && {
          key: "copy", label: "Copy", icon: Copy,
          run: async () => ((await copyText(message.text)) ? toast.success("Copied") : toast.error("Couldn't copy")),
        },
        { key: "fwd", label: "Forward", icon: Forward, run: () => setDialog("forward") },
        { key: "star", label: message.starred ? "Unstar" : "Star", icon: Star, run: () => act().toggleStar(message._id, !message.starred) },
        { key: "pin", label: message.pinnedAt ? "Unpin" : "Pin", icon: message.pinnedAt ? PinOff : Pin, run: () => act().togglePin(message._id, !message.pinnedAt) },
        // Phase 2F: a message that is set to disappear can be kept (and un-kept by whoever kept it, or by its sender)
        canKeep(message) && { key: "keep", label: "Keep message", icon: Bookmark, run: () => act().toggleKeep(message._id, true) },
        canUnkeep(message, myId) && { key: "unkeep", label: "Unkeep", icon: BookmarkMinus, run: () => act().toggleKeep(message._id, false) },
        // Group messages of mine: who received / read it
        store === "group" && isOwn && !message.pending && { key: "info", label: "Message info", icon: Info, run: () => setDialog("info") },
        canEdit(message, myId) && { key: "edit", label: "Edit", icon: Pencil, run: () => onEdit(message) },
        { key: "del", label: "Delete…", icon: Trash2, danger: true, run: () => setDialog("delete") },
      ].filter(Boolean);

  const toggle = () => {
    if (open) return setOpen(false);
    const r = btnRef.current.getBoundingClientRect();
    const w = 192;
    const h = items.length * 36 + 12;
    const left = Math.min(Math.max(8, isOwn ? r.right - w : r.left), window.innerWidth - w - 8);
    const top = r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4;
    setPos({ top, left });
    setOpen(true);
  };

  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle}
        className="lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100 transition-opacity btn btn-ghost btn-xs btn-circle"
        title="Message options" aria-label="Message options" aria-haspopup="menu" aria-expanded={open}>
        <EllipsisVertical className="size-3" />
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
          <ul role="menu" style={{ top: pos.top, left: pos.left }} className="fixed z-[56] w-48 bg-base-100 border border-base-300 rounded-xl shadow-xl p-1">
            {items.map(({ key, label, icon: Icon, danger, run }) => (
              <li key={key} role="none">
                <button role="menuitem" type="button" onClick={() => { setOpen(false); run(); }}
                  className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm hover:bg-base-200 ${danger ? "text-error" : ""}`}>
                  <Icon className="size-4 shrink-0" /> {label}
                </button>
              </li>
            ))}
          </ul>
        </>,
        document.body
      )}

      {dialog === "delete" && <DeleteDialog message={message} isOwn={isOwn} store={store} onClose={() => setDialog(null)} />}
      {dialog === "forward" && <ForwardModal message={message} onClose={() => setDialog(null)} />}
      {dialog === "info" && <MessageInfoModal message={message} onClose={() => setDialog(null)} />}
    </>
  );
};

export default MessageMenu;
