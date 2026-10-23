import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { axiosInstance } from "../lib/axios";
import { previewOf } from "../lib/utils";

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

const Section = ({ title, rows, showTime = true }) =>
  rows.length ? (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/50 mb-1">{title} · {rows.length}</h3>
      <ul className="space-y-1">
        {rows.map(({ user, at }) => (
          <li key={user._id} className="flex items-center gap-3 py-1">
            <img src={user.profilePic || "/avatar.png"} alt="" className="size-8 rounded-full object-cover shrink-0" />
            <span className="text-sm font-medium flex-1 min-w-0 truncate">{user.fullName}</span>
            {showTime && <span className="text-xs text-base-content/50 shrink-0">{when(at)}</span>}
          </li>
        ))}
      </ul>
    </div>
  ) : null;

/** "Message info" for one of MY group messages: who has read it, who only received it, who hasn't got it yet.
 *  Updates live while open (the parent's message carries the tick counts, which change whenever a receipt arrives). */
const MessageInfoModal = ({ message, onClose }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const version = `${message.ticks?.delivered}-${message.ticks?.read}`;

  useEffect(() => {
    let alive = true;
    axiosInstance.get(`/messages/info/${message._id}`)
      .then((res) => alive && (setData(res.data), setError(null)))
      .catch((e) => alive && setError(e.response?.data?.message || "Couldn't load the details"));
    return () => { alive = false; };
  }, [message._id, version]);

  return createPortal(
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-label="Message info" className="bg-base-100 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-300">
          <div className="min-w-0">
            <h2 className="font-semibold text-lg">Message info</h2>
            <p className="text-xs text-base-content/50 truncate">{previewOf(message)}</p>
          </div>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          {!data && !error && <div className="text-center py-6"><span className="loading loading-spinner" /></div>}
          {error && <p className="text-sm text-error">{error}</p>}
          {data && (
            <>
              <Section title="Read by" rows={data.read} />
              <Section title="Delivered to" rows={data.delivered} />
              <Section title="Not delivered yet" rows={data.pending} showTime={false} />
              {data.total === 0 && <p className="text-sm text-base-content/60">You're the only member of this group.</p>}
              {data.readHidden && (
                <p className="text-xs text-base-content/50">Read times are hidden because you turned off read receipts. Delivery is still shown.</p>
              )}
              {!data.readHidden && data.total > 0 && (
                <p className="text-xs text-base-content/50">People who turned off read receipts appear under "Delivered to", even if they read it.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default MessageInfoModal;
