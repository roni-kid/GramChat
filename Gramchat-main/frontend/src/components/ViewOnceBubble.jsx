import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { Image as ImageIcon, Film, Mic, X } from "lucide-react";
import { axiosInstance } from "../lib/axios";
import { useChatStore } from "../store/useChatStore";
import { useGroupStore } from "../store/useGroupStore";

const KINDS = {
  image: { label: "Photo", Icon: ImageIcon },
  video: { label: "Video", Icon: Film },
  audio: { label: "Voice message", Icon: Mic },
};
const storeFor = (store) => (store === "dm" ? useChatStore : useGroupStore).getState();

/** The "1 in a dashed circle" icon used for view-once */
export const OnceIcon = ({ className = "" }) => (
  <span aria-hidden="true" className={`inline-flex items-center justify-center rounded-full border border-dashed border-current font-bold leading-none shrink-0 ${className}`}>1</span>
);

/** Full-screen viewer. It only discourages casual saving (no download button, no right-click menu, no drag): it can't stop a
 *  screenshot or a screen recording, and the message says so. */
const Viewer = ({ media, onClose }) => {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const block = (e) => e.preventDefault();

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/95 flex flex-col items-center justify-center p-4 select-none" onContextMenu={block} role="dialog" aria-modal="true" aria-label="View once">
      <button type="button" onClick={onClose} className="btn btn-sm btn-ghost text-white absolute top-3 right-3 gap-1">
        <X className="size-4" /> Close
      </button>
      {media.kind === "image" && (
        <img src={media.url} alt="View-once photo" draggable={false} onDragStart={block} className="max-h-[80vh] max-w-full rounded-lg object-contain" />
      )}
      {media.kind === "video" && (
        <video src={media.url} autoPlay controls playsInline disablePictureInPicture controlsList="nodownload noremoteplayback" onContextMenu={block} className="max-h-[80vh] max-w-full rounded-lg" />
      )}
      {media.kind === "audio" && (
        <div className="bg-base-100 rounded-2xl p-6 flex flex-col items-center gap-3">
          <Mic className="size-8 text-primary" />
          <audio src={media.url} autoPlay controls controlsList="nodownload" onContextMenu={block} />
        </div>
      )}
      <p className="text-white/60 text-xs mt-4 text-center max-w-sm">
        View once: it is deleted when you close this. Anyone can still screenshot or record their screen.
      </p>
    </div>,
    document.body
  );
};

/** The bubble content of a view-once message (the media itself is never in the message: opening it asks the server).
 *  message.viewOnceState: "unopened" | "opened" | "expired".  store: "dm" | "group". */
const ViewOnceBubble = ({ message, isOwn, store }) => {
  const [media, setMedia] = useState(null);
  const [opening, setOpening] = useState(false);
  const openRef = useRef(false); // a viewer is on screen and hasn't been closed on the server yet
  const id = message._id;
  const { label, Icon } = KINDS[message.viewOnceKind] || KINDS.image;
  const state = message.viewOnceState || "unopened";

  const close = async () => {
    setMedia(null);
    if (!openRef.current) return;
    openRef.current = false;
    try {
      await axiosInstance.post(`/messages/view-once/${id}/close`);
    } catch {
      /* the server wipes it anyway a few minutes after opening */
    }
  };

  // Leaving the chat (unmounting) with the viewer open counts as closing it
  useEffect(() => () => {
    if (openRef.current) {
      openRef.current = false;
      axiosInstance.post(`/messages/view-once/${id}/close`).catch(() => {});
    }
  }, [id]);

  const open = async () => {
    if (opening || message.pending) return;
    setOpening(true);
    try {
      const res = await axiosInstance.post(`/messages/view-once/${id}/open`);
      openRef.current = true;
      storeFor(store).applyViewed({ messageId: id, viewedByMe: true });
      setMedia(res.data);
    } catch (error) {
      toast.error(error.response?.data?.message || "Couldn't open this");
      if (error.response?.status === 410) storeFor(store).applyViewWiped(id);
    } finally {
      setOpening(false);
    }
  };

  // The sender (and a message still waiting to be sent) never sees the media again: only its status
  let body;
  if (isOwn || message.pending) {
    const status =
      message.pending ? "Sending…"
      : store === "group" ? (message.viewCount > 0 ? `Opened by ${message.viewCount}` : state === "expired" ? "Expired" : "Not opened yet")
      : state === "opened" ? "Opened" : state === "expired" ? "Expired" : "Not opened yet";
    body = (
      <div className="flex items-center gap-2 text-sm py-0.5">
        <OnceIcon className="size-5 text-[11px]" />
        <Icon className="size-4 shrink-0" />
        <span>{label} · {status}</span>
      </div>
    );
  } else if (state !== "unopened") {
    body = (
      <div className="flex items-center gap-2 text-sm py-0.5 opacity-60">
        <OnceIcon className="size-5 text-[11px]" />
        <span>{state === "opened" ? "Opened" : "Expired"}</span>
      </div>
    );
  } else {
    body = (
      <button type="button" onClick={open} disabled={opening} className="flex items-center gap-2 text-sm py-1 pr-2 hover:opacity-80 transition-opacity text-left" aria-label={`Open view-once ${label.toLowerCase()}`}>
        <OnceIcon className="size-6 text-xs" />
        <Icon className="size-4 shrink-0" />
        <span className="font-medium">{label}</span>
        <span className="opacity-70">{opening ? "Opening…" : "Tap to view"}</span>
      </button>
    );
  }

  // The viewer is rendered whatever the placeholder says: opening flips it to "Opened" while the media is still on screen
  return (
    <>
      {body}
      {media && <Viewer media={media} onClose={close} />}
    </>
  );
};

export default ViewOnceBubble;
