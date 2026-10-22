import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { Star, X } from "lucide-react";
import { axiosInstance } from "../lib/axios";
import { useChatStore } from "../store/useChatStore";
import { useGroupStore } from "../store/useGroupStore";
import { useAuthStore } from "../store/useAuthStore";
import { formatListTime, previewOf } from "../lib/utils";

/** Everything the user starred, across chats and groups. Opened from the chat list. */
const StarredModal = ({ onClose }) => {
  const me = useAuthStore((s) => s.authUser?._id);
  const users = useChatStore((s) => s.users);
  const groups = useGroupStore((s) => s.groups);
  const [items, setItems] = useState(null);

  useEffect(() => {
    let alive = true;
    axiosInstance.get("/messages/starred")
      .then((r) => alive && setItems(r.data))
      .catch((e) => { toast.error(e.response?.data?.message || "Couldn't load starred messages"); if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  const titleOf = (m) =>
    m.groupId ? `${m.senderId?._id === me ? "You" : m.senderId?.fullName || "Someone"} in ${m.groupId.name}`
      : m.senderId?._id === me ? `You → ${m.receiverId?.fullName || "contact"}` : m.senderId?.fullName || "Contact";

  const open = (m) => {
    if (m.groupId) {
      const g = groups.find((x) => x._id === m.groupId._id);
      if (!g) return toast.error("You're no longer in that group");
      useChatStore.getState().setSelectedUser(null);
      useGroupStore.getState().setSelectedGroup(g);
    } else {
      const otherId = m.senderId?._id === me ? m.receiverId?._id : m.senderId?._id;
      const u = users.find((x) => x._id === otherId);
      if (!u) return toast.error("That person is no longer in your contacts");
      useGroupStore.getState().setSelectedGroup(null);
      useChatStore.getState().setSelectedUser(u);
    }
    onClose();
  };

  const unstar = async (m) => {
    await useChatStore.getState().toggleStar(m._id, false);
    setItems((list) => list.filter((x) => x._id !== m._id));
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-label="Starred messages" className="bg-base-100 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-300">
          <h2 className="font-semibold text-lg flex items-center gap-2"><Star className="size-4 fill-current text-warning" /> Starred messages</h2>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-2 min-h-[10rem]">
          {items === null && <div className="flex justify-center py-10"><span className="loading loading-spinner" /></div>}
          {items?.length === 0 && (
            <p className="text-center text-sm text-base-content/50 py-10 px-6">Nothing starred yet. Open a message's ⋯ menu and choose Star to keep it here. Only you can see what you starred.</p>
          )}
          {items?.map((m) => (
            <div key={m._id} className="flex items-start gap-2 p-2.5 rounded-xl hover:bg-base-200">
              <button type="button" className="flex-1 min-w-0 text-left" onClick={() => open(m)}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-primary truncate">{titleOf(m)}</span>
                  <span className="text-xs text-base-content/40 shrink-0">{formatListTime(m.createdAt)}</span>
                </div>
                <p className="text-sm line-clamp-2 break-words">{previewOf(m)}</p>
              </button>
              <button type="button" className="btn btn-ghost btn-xs btn-circle shrink-0" title="Unstar" aria-label="Unstar" onClick={() => unstar(m)}>
                <Star className="size-3.5 fill-current text-warning" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default StarredModal;
