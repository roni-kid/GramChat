import { useState } from "react";
import { Ban, Bookmark, Clock, Forward, Pin, Star, Timer } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import { useGroupStore } from "../store/useGroupStore";
import { useOutboxStore } from "../store/useOutboxStore";
import { safeHttpUrl } from "../lib/utils";

const storeFor = (store) => (store === "dm" ? useChatStore : useGroupStore).getState();

/** Under a message that is still in the send queue: "Sending…", "Waiting for connection…", or "Not sent" with Retry / Discard. */
export const PendingFooter = ({ message }) => {
  if (!message.pending) return null;
  const { retry, discard } = useOutboxStore.getState();
  if (message.pending === "failed") {
    return (
      <div className="chat-footer text-xs mt-0.5 flex items-center gap-2 text-error" role="alert">
        <span>⚠ Not sent{message.error ? `: ${message.error}` : ""}</span>
        <button type="button" className="underline" onClick={() => retry(message.clientId)}>Retry</button>
        <button type="button" className="underline" onClick={() => discard(message.clientId)}>Discard</button>
      </div>
    );
  }
  return (
    <div className="chat-footer text-xs mt-0.5 flex items-center gap-1 opacity-60" role="status">
      <Clock className="size-3" /> {message.pending === "offline" ? "Waiting for connection…" : "Sending…"}
    </div>
  );
};

/** Small status line under a bubble's content: pinned / starred / edited / will disappear. */
export const MessageFlags = ({ message }) => {
  if (!message.pinnedAt && !message.starred && !message.editedAt && !message.expiresAt && !message.keptBy) return null;
  return (
    <span className="self-end flex items-center gap-1 text-[10px] opacity-60 mt-0.5">
      {message.keptBy && <span title="Kept: this message won't disappear"><Bookmark className="size-3" aria-label="Kept" /></span>}
      {message.expiresAt && (
        <span title={`Disappears ${new Date(message.expiresAt).toLocaleString()}`}><Timer className="size-3" aria-label="Disappearing message" /></span>
      )}
      {message.pinnedAt && <Pin className="size-3" aria-label="Pinned" />}
      {message.starred && <Star className="size-3 fill-current" aria-label="Starred" />}
      {message.editedAt && <span>edited</span>}
    </span>
  );
};

export const ForwardedLabel = ({ message }) =>
  message.forwarded ? (
    <p className="text-xs italic opacity-70 flex items-center gap-1 mb-1">
      <Forward className="size-3" /> Forwarded
    </p>
  ) : null;

/** The card under a message that contains a link: site, title, description, picture. The server built it (the sender can't
 *  forge one) and the picture is served from our own server, so showing it contacts no other site. The link is only opened when tapped. */
export const LinkPreviewCard = ({ preview }) => {
  const href = safeHttpUrl(preview?.url);
  if (!href || !(preview.title || preview.description)) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow"
      className="block rounded-lg overflow-hidden bg-black/10 hover:bg-black/20 transition mt-1 mb-1 w-64 max-w-full text-left">
      {preview.image && <img src={preview.image} alt="" loading="lazy" className="w-full max-h-40 object-cover" />}
      <div className="px-2.5 py-2 space-y-0.5">
        {preview.siteName && <p className="text-[10px] uppercase tracking-wide opacity-60 truncate">{preview.siteName}</p>}
        {preview.title && <p className="text-sm font-semibold line-clamp-2 break-words">{preview.title}</p>}
        {preview.description && <p className="text-xs opacity-80 line-clamp-3 break-words">{preview.description}</p>}
      </div>
    </a>
  );
};

/** What a "delete for everyone" message turns into. */
export const DeletedNote = ({ isOwn }) => (
  <p className="italic opacity-70 flex items-center gap-1.5 text-sm">
    <Ban className="size-3.5 shrink-0" /> {isOwn ? "You deleted this message" : "This message was deleted"}
  </p>
);

/** Edit a message in place. Enter saves, Shift+Enter adds a line, Esc cancels. */
export const InlineEditor = ({ message, store, onDone }) => {
  const [text, setText] = useState(message.text || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const clean = text.trim();
    if (clean === (message.text || "")) return onDone();
    if (!clean && !message.image && !message.fileUrl) return; // a text-only message can't become empty
    setSaving(true);
    const ok = await storeFor(store).editMessage(message._id, clean);
    setSaving(false);
    if (ok) onDone();
  };

  return (
    <div className="flex flex-col gap-1.5 min-w-[12rem]">
      <textarea
        autoFocus
        rows={2}
        maxLength={10000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
        }}
        className="textarea textarea-sm w-full bg-base-100 text-base-content"
        aria-label="Edit message"
      />
      <div className="flex justify-end gap-1">
        <button type="button" className="btn btn-xs btn-ghost" onClick={onDone} disabled={saving}>Cancel</button>
        <button type="button" className="btn btn-xs btn-primary" onClick={save} disabled={saving}>
          {saving ? <span className="loading loading-spinner loading-xs" /> : "Save"}
        </button>
      </div>
    </div>
  );
};
