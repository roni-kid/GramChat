import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, Bell, BellOff, EllipsisVertical, Pin, PinOff } from "lucide-react";
import { isMuted, useChatPrefsStore } from "../store/useChatPrefsStore";
import { muteLabel } from "../lib/utils";

/** The "⋯" menu of a chat row: pin, archive, mute. kind: "user" | "group". */
const ChatActionsMenu = ({ kind, id, pref }) => {
  const update = useChatPrefsStore((s) => s.update);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const pinned = !!pref?.pinnedAt;
  const archived = !!pref?.archived;
  const muted = isMuted(pref);

  const items = [
    { key: "pin", label: pinned ? "Unpin chat" : "Pin chat", icon: pinned ? PinOff : Pin, run: () => update(kind, id, { pinned: !pinned }) },
    { key: "archive", label: archived ? "Unarchive chat" : "Archive chat", icon: archived ? ArchiveRestore : Archive, run: () => update(kind, id, { archived: !archived }) },
    ...(muted
      ? [{ key: "unmute", label: "Unmute", icon: Bell, divider: true, run: () => update(kind, id, { mute: "off" }) }]
      : [
          { key: "m8", label: "Mute for 8 hours", icon: BellOff, divider: true, run: () => update(kind, id, { mute: "8h" }) },
          { key: "m1w", label: "Mute for 1 week", icon: BellOff, run: () => update(kind, id, { mute: "1w" }) },
          { key: "mall", label: "Mute always", icon: BellOff, run: () => update(kind, id, { mute: "always" }) },
        ]),
  ];

  const toggle = (e) => {
    e.stopPropagation();
    if (open) return setOpen(false);
    const r = btnRef.current.getBoundingClientRect();
    const w = 208;
    const h = items.length * 36 + 12;
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    const top = r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4;
    setPos({ top, left });
    setOpen(true);
  };

  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle}
        className="absolute right-1 top-1/2 -translate-y-1/2 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100 transition-opacity btn btn-ghost btn-xs btn-circle"
        title="Chat options" aria-label="Chat options" aria-haspopup="menu" aria-expanded={open}>
        <EllipsisVertical className="size-4" />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
          <ul role="menu" style={{ top: pos.top, left: pos.left }} className="fixed z-[56] w-52 bg-base-100 border border-base-300 rounded-xl shadow-xl p-1">
            {items.map(({ key, label, icon: Icon, divider, run }) => (
              <li key={key} role="none" className={divider ? "border-t border-base-300 mt-1 pt-1" : ""}>
                <button role="menuitem" type="button" onClick={() => { setOpen(false); run(); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm hover:bg-base-200">
                  <Icon className="size-4 shrink-0" /> {label}
                </button>
              </li>
            ))}
          </ul>
        </>,
        document.body
      )}
    </>
  );
};

/** One row of the chat list (a contact or a group). The row opens the chat; the ⋯ button opens pin / archive / mute. */
const ChatListItem = ({ kind, id, pref, selected, onOpen, avatar, name, time, unread, preview }) => {
  const muted = isMuted(pref);
  return (
    <div className={`group relative transition-colors hover:bg-base-300 ${selected ? "bg-base-300 ring-1 ring-base-300" : ""}`}>
      <button type="button" onClick={onOpen} className="w-full p-3 pr-9 flex items-center gap-3 text-left">
        {avatar}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium truncate flex items-center gap-1.5 min-w-0">
              <span className="truncate">{name}</span>
              {muted && <BellOff className="size-3.5 shrink-0 text-base-content/40" aria-label={muteLabel(pref.mutedUntil)} />}
            </span>
            <span className={`text-xs shrink-0 flex items-center gap-1 ${unread && !muted ? "text-primary font-semibold" : "text-base-content/40"}`}>
              {pref?.pinnedAt && <Pin className="size-3" aria-label="Pinned" />}
              {time}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-zinc-400 truncate">{preview}</span>
            {unread > 0 && (
              <span className={`badge badge-sm shrink-0 ${muted ? "badge-ghost" : "badge-primary"}`} aria-label={`${unread} unread`}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </div>
        </div>
      </button>
      <ChatActionsMenu kind={kind} id={id} pref={pref} />
    </div>
  );
};

export default ChatListItem;
