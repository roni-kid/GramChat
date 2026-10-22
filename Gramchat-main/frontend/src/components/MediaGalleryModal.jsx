import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { Download, FileText, Images, Link2, MessageSquare, Music, Play, X } from "lucide-react";
import { axiosInstance } from "../lib/axios";
import { firstUrl, formatListTime } from "../lib/utils";

const PAGE = 60;
const TABS = [
  { id: "media", label: "Media", icon: Images, empty: "No photos or videos yet." },
  { id: "docs", label: "Docs", icon: FileText, empty: "No documents yet." },
  { id: "links", label: "Links", icon: Link2, empty: "No links yet." },
];

const sizeLabel = (bytes) => (bytes ? (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`) : "");
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/** Full-screen view of one photo or video, with "Show in chat". */
const Viewer = ({ message, onClose, onShow }) => {
  const url = message.image || message.fileUrl;
  const isVideo = !message.image && message.fileType === "video";
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 bg-black/90 z-[70] flex flex-col" onClick={onClose} role="dialog" aria-label="Media viewer">
      <div className="flex items-center justify-between gap-2 p-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm opacity-80 truncate">{message.senderId?.fullName ? `${message.senderId.fullName} · ` : ""}{formatListTime(message.createdAt)}</span>
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-ghost btn-sm text-white gap-1" onClick={() => onShow(message)}>
            <MessageSquare className="size-4" /> Show in chat
          </button>
          <a className="btn btn-ghost btn-sm btn-circle text-white" href={url} download target="_blank" rel="noreferrer" title="Download" aria-label="Download">
            <Download className="size-4" />
          </a>
          <button type="button" className="btn btn-ghost btn-sm btn-circle text-white" onClick={onClose} aria-label="Close"><X className="size-5" /></button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-3" onClick={(e) => e.stopPropagation()}>
        {isVideo
          ? <video src={url} controls autoPlay className="max-w-full max-h-full rounded-lg" />
          : <img src={url} alt="" className="max-w-full max-h-full object-contain rounded-lg" />}
      </div>
      {message.text && <p className="text-white/80 text-sm text-center px-4 pb-4 line-clamp-3" onClick={(e) => e.stopPropagation()}>{message.text}</p>}
    </div>,
    document.body
  );
};

/** Photos, videos, documents and links shared in one chat. kind: "user" (1:1 chat, chatId = the contact) or "group".
 *  onShow(message) should scroll the chat to that message; the gallery closes itself afterwards. */
const MediaGalleryModal = ({ kind, chatId, title, onShow, onClose }) => {
  const [tab, setTab] = useState("media");
  const [data, setData] = useState({}); // { [tab]: { items, loading, more } }
  const [viewing, setViewing] = useState(null);
  const requested = useRef(new Set());

  const load = useCallback(async (type, before) => {
    setData((d) => ({ ...d, [type]: { items: d[type]?.items || [], loading: true, more: false } }));
    try {
      const res = await axiosInstance.get(`/messages/media/${kind}/${chatId}`, { params: { type, limit: PAGE, ...(before ? { before } : {}) } });
      setData((d) => ({ ...d, [type]: { items: [...(before ? d[type]?.items || [] : []), ...res.data], loading: false, more: res.data.length >= PAGE } }));
    } catch (error) {
      toast.error(error.response?.data?.message || "Couldn't load shared items");
      setData((d) => ({ ...d, [type]: { items: d[type]?.items || [], loading: false, more: false } }));
    }
  }, [kind, chatId]);

  useEffect(() => {
    if (requested.current.has(tab)) return;
    requested.current.add(tab);
    load(tab);
  }, [tab, load]);

  const show = (m) => {
    onShow(m);
    onClose();
  };

  const cur = data[tab];
  const items = cur?.items || [];
  const meta = TABS.find((t) => t.id === tab);

  return (
    <>
      {createPortal(
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
          <div role="dialog" aria-label="Media, links and docs" className="bg-base-100 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col h-[80vh] max-h-[40rem]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-base-300">
              <div className="min-w-0">
                <h2 className="font-semibold text-lg">Media, links and docs</h2>
                {title && <p className="text-xs text-base-content/50 truncate">{title}</p>}
              </div>
              <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
            </div>

            <div role="tablist" className="tabs tabs-bordered px-2">
              {TABS.map((t) => (
                <button key={t.id} role="tab" type="button" aria-selected={tab === t.id}
                  className={`tab gap-1.5 flex-1 ${tab === t.id ? "tab-active" : ""}`} onClick={() => setTab(t.id)}>
                  <t.icon className="size-4" /> {t.label}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto flex-1 p-2">
              {!cur?.items?.length && cur?.loading && <div className="flex justify-center py-10"><span className="loading loading-spinner" /></div>}
              {cur && !cur.loading && items.length === 0 && <p className="text-center text-sm text-base-content/50 py-10">{meta.empty}</p>}

              {tab === "media" && items.length > 0 && (
                <div className="grid grid-cols-3 gap-1">
                  {items.map((m) => {
                    const isVideo = !m.image && m.fileType === "video";
                    return (
                      <button key={m._id} type="button" onClick={() => setViewing(m)} className="relative aspect-square bg-base-200 overflow-hidden rounded-md" aria-label={isVideo ? "Open video" : "Open photo"}>
                        {isVideo
                          ? <video src={m.fileUrl} preload="metadata" muted className="size-full object-cover pointer-events-none" />
                          : <img src={m.image || m.fileUrl} alt="" loading="lazy" className="size-full object-cover" />}
                        {isVideo && <span className="absolute inset-0 flex items-center justify-center bg-black/20"><Play className="size-7 text-white fill-white" /></span>}
                      </button>
                    );
                  })}
                </div>
              )}

              {tab === "docs" && items.map((m) => (
                <div key={m._id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-base-200">
                  <a href={m.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="size-10 rounded-lg bg-base-200 flex items-center justify-center shrink-0">
                      {m.fileType === "audio" ? <Music className="size-5" /> : <FileText className="size-5" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{m.fileName || "File"}</span>
                      <span className="block text-xs text-base-content/50 truncate">
                        {[m.senderId?.fullName, sizeLabel(m.fileSize), formatListTime(m.createdAt)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </a>
                  <button type="button" className="btn btn-ghost btn-xs btn-circle shrink-0" title="Show in chat" aria-label="Show in chat" onClick={() => show(m)}>
                    <MessageSquare className="size-3.5" />
                  </button>
                </div>
              ))}

              {tab === "links" && items.map((m) => {
                const url = firstUrl(m.text);
                if (!url) return null;
                return (
                  <div key={m._id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-base-200">
                    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-3 flex-1 min-w-0">
                      {m.linkPreview?.image
                        ? <img src={m.linkPreview.image} alt="" loading="lazy" className="size-10 rounded-lg object-cover shrink-0" />
                        : <span className="size-10 rounded-lg bg-base-200 flex items-center justify-center shrink-0"><Link2 className="size-5" /></span>}
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{m.linkPreview?.title || hostOf(url)}</span>
                        <span className="block text-xs text-primary truncate">{url}</span>
                        <span className="block text-xs text-base-content/50 truncate">{[m.senderId?.fullName, formatListTime(m.createdAt)].filter(Boolean).join(" · ")}</span>
                      </span>
                    </a>
                    <button type="button" className="btn btn-ghost btn-xs btn-circle shrink-0" title="Show in chat" aria-label="Show in chat" onClick={() => show(m)}>
                      <MessageSquare className="size-3.5" />
                    </button>
                  </div>
                );
              })}

              {cur?.more && (
                <div className="flex justify-center py-3">
                  <button type="button" className="btn btn-sm btn-ghost" disabled={cur.loading} onClick={() => load(tab, items[items.length - 1]?.createdAt)}>
                    {cur.loading ? <span className="loading loading-spinner loading-xs" /> : "Load more"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      {viewing && <Viewer message={viewing} onClose={() => setViewing(null)} onShow={show} />}
    </>
  );
};

export default MediaGalleryModal;
