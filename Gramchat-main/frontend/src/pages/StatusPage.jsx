import { useCallback, useEffect, useState } from "react";
import { useStatusStore } from "../store/useStatusStore";
import { useAuthStore } from "../store/useAuthStore";
import { Plus, X, Eye, Trash2, Circle } from "lucide-react";

const BG_COLORS = [
  "#1a1a2e","#16213e","#0f3460","#533483","#2d6a4f",
  "#1b4332","#6b2737","#3d405b","#264653","#2b2d42",
];

const CreateStatusModal = ({ onClose }) => {
  const { createStatus } = useStatusStore();
  const [text, setText] = useState("");
  const [image, setImage] = useState(null);
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [loading, setLoading] = useState(false);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("Image must be under 5MB"); return; }
    const reader = new FileReader();
    reader.onloadend = () => setImage(reader.result);
    reader.readAsDataURL(file);
  };

  const handlePost = async () => {
    if (!text.trim() && !image) return;
    setLoading(true);
    await createStatus({ text, image, bgColor });
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-base-100 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-300">
          <h2 className="font-semibold text-lg">New Status</h2>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose}><X className="size-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-2xl h-48 flex items-center justify-center relative overflow-hidden"
            style={{ backgroundColor: bgColor }}>
            {image ? (
              <img src={image} alt="Preview" className="w-full h-full object-cover" />
            ) : (
              <p className="text-white text-xl font-medium text-center px-4 break-words">{text || "Your status text..."}</p>
            )}
          </div>
          <label className="btn btn-outline btn-sm w-full gap-2 rounded-full cursor-pointer">
            📷 Add Photo
            <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
          </label>
          {!image && (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What's on your mind?"
                className="textarea textarea-bordered w-full rounded-xl resize-none"
                rows={3}
                maxLength={200}
              />
              <div>
                <p className="text-xs text-base-content/50 mb-2">Background</p>
                <div className="flex gap-2 flex-wrap">
                  {BG_COLORS.map((c) => (
                    <button key={c} onClick={() => setBgColor(c)}
                      className={`size-7 rounded-full border-2 transition-transform hover:scale-110 ${bgColor === c ? "border-primary scale-110" : "border-transparent"}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button className="btn btn-ghost flex-1" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary flex-1" disabled={(!text.trim() && !image) || loading} onClick={handlePost}>
            {loading ? <span className="loading loading-spinner loading-sm" /> : "Post Status"}
          </button>
        </div>
      </div>
    </div>
  );
};

const StatusViewer = ({ statusGroup, onClose, onView }) => {
  const [idx, setIdx] = useState(0);
  const { authUser } = useAuthStore();
  const { deleteStatus } = useStatusStore();
  const status = statusGroup.items[idx];

  const statusId = status?._id;
  useEffect(() => {
    if (statusId) onView(statusId);
  }, [statusId, onView]);

  // Auto-advance after 5 s; after the last slide, close the viewer
  useEffect(() => {
    const timer = setTimeout(() => {
      if (idx < statusGroup.items.length - 1) setIdx(idx + 1);
      else onClose();
    }, 5000);
    return () => clearTimeout(timer);
  }, [idx, statusGroup.items.length, onClose]);

  const isOwn = (status?.userId?._id || status?.userId) === authUser._id;
  const viewedCount = status?.viewedBy?.length || 0;

  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center" onClick={onClose}>
      <div className="relative w-full max-w-sm h-full max-h-[700px]" onClick={(e) => e.stopPropagation()}>
        <div className="absolute top-3 left-3 right-3 z-10 flex gap-1">
          {statusGroup.items.map((_, i) => (
            <div key={i} className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden">
              <div className="h-full bg-white"
                style={i < idx ? { width: "100%" } : i === idx ? { animation: "status-progress 5s linear forwards" } : { width: 0 }} />
            </div>
          ))}
        </div>
        <div className="absolute top-8 left-3 right-3 z-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={statusGroup.user?.profilePic || "/avatar.png"} alt="" className="size-9 rounded-full border-2 border-white" />
            <div>
              <p className="text-white font-medium text-sm">{statusGroup.user?.fullName}</p>
              <p className="text-white/60 text-xs">{new Date(status?.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
            </div>
          </div>
          <div className="flex gap-1">
            {isOwn && (
              <button onClick={() => deleteStatus(status._id)}
                className="btn btn-ghost btn-sm btn-circle text-white"><Trash2 className="size-4" /></button>
            )}
            <button onClick={onClose} className="btn btn-ghost btn-sm btn-circle text-white"><X className="size-4" /></button>
          </div>
        </div>
        <div className="w-full h-full rounded-2xl overflow-hidden flex items-center justify-center"
          style={{ backgroundColor: status?.bgColor || "#1a1a2e" }}>
          {status?.image ? (
            <img src={status.image} alt="Status" className="w-full h-full object-cover" />
          ) : (
            <p className="text-white text-2xl font-semibold text-center px-8 break-words">{status?.text}</p>
          )}
        </div>
        <button className="absolute left-0 top-1/2 -translate-y-1/2 w-1/3 h-full opacity-0"
          onClick={() => setIdx((p) => Math.max(0, p - 1))} />
        <button className="absolute right-0 top-1/2 -translate-y-1/2 w-1/3 h-full opacity-0"
          onClick={() => setIdx((p) => Math.min(statusGroup.items.length - 1, p + 1))} />
        {isOwn && (
          <div className="absolute bottom-6 left-0 right-0 flex justify-center">
            <div className="flex items-center gap-1.5 bg-black/40 rounded-full px-3 py-1.5">
              <Eye className="size-3.5 text-white" />
              <span className="text-white text-xs">{viewedCount} view{viewedCount !== 1 ? "s" : ""}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const StatusPage = () => {
  const { getStatuses, subscribeToStatuses, unsubscribeFromStatuses, viewStatus, getStatusesByUser } = useStatusStore();
  const { authUser } = useAuthStore();
  const [showCreate, setShowCreate] = useState(false);
  const [viewingGroup, setViewingGroup] = useState(null);

  useEffect(() => {
    getStatuses();
    subscribeToStatuses();
    return () => unsubscribeFromStatuses();
  }, [getStatuses, subscribeToStatuses, unsubscribeFromStatuses]);

  const closeViewer = useCallback(() => setViewingGroup(null), []);

  const grouped = getStatusesByUser();
  const myGroup = grouped.find((g) => (g.user?._id || g.user) === authUser._id);
  const othersGroups = grouped.filter((g) => (g.user?._id || g.user) !== authUser._id);

  return (
    <div className="h-screen pt-20">
      <div className="overflow-y-auto h-full p-6 max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Status</h1>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary btn-sm gap-2 rounded-full">
          <Plus className="size-4" /> Add Status
        </button>
      </div>

      <section className="mb-6">
        <h2 className="text-xs text-base-content/50 uppercase tracking-wider font-medium mb-3">My Status</h2>
        <div className="flex items-center gap-3 p-3 bg-base-200 rounded-2xl cursor-pointer hover:bg-base-300 transition-colors"
          onClick={() => myGroup ? setViewingGroup(myGroup) : setShowCreate(true)}>
          <div className={`relative shrink-0 ${myGroup ? "ring-2 ring-primary ring-offset-2 ring-offset-base-200 rounded-full" : ""}`}>
            <img src={authUser.profilePic || "/avatar.png"} alt="me" className="size-14 rounded-full object-cover" />
            {!myGroup && (
              <span className="absolute bottom-0 right-0 size-5 bg-primary rounded-full ring-2 ring-base-200 flex items-center justify-center">
                <Plus className="size-3 text-primary-content" />
              </span>
            )}
          </div>
          <div>
            <p className="font-medium">My status</p>
            <p className="text-sm text-base-content/50">{myGroup ? `${myGroup.items.length} update${myGroup.items.length !== 1 ? "s" : ""}` : "Tap to add status"}</p>
          </div>
        </div>
      </section>

      {othersGroups.length > 0 && (
        <section>
          <h2 className="text-xs text-base-content/50 uppercase tracking-wider font-medium mb-3">Recent Updates</h2>
          <div className="space-y-2">
            {othersGroups.map((group) => {
              const userId = group.user?._id || group.user;
              const hasUnviewed = group.items.some((s) => !s.viewedByMe);
              return (
                <div key={userId}
                  className="flex items-center gap-3 p-3 bg-base-200 rounded-2xl cursor-pointer hover:bg-base-300 transition-colors"
                  onClick={() => setViewingGroup(group)}>
                  <div className={`relative shrink-0 ${hasUnviewed ? "ring-2 ring-primary ring-offset-2 ring-offset-base-200 rounded-full" : "ring-2 ring-base-300 ring-offset-2 ring-offset-base-200 rounded-full"}`}>
                    <img src={group.user?.profilePic || "/avatar.png"} alt={group.user?.fullName} className="size-14 rounded-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{group.user?.fullName}</p>
                    <p className="text-sm text-base-content/50">{group.items.length} update{group.items.length !== 1 ? "s" : ""}</p>
                  </div>
                  {hasUnviewed && <span className="size-2.5 bg-primary rounded-full flex-shrink-0" />}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {grouped.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <Circle className="size-12 mx-auto text-base-content/20" />
          <p className="text-base-content/50">No statuses yet</p>
          <button onClick={() => setShowCreate(true)} className="btn btn-primary btn-sm gap-2 rounded-full">
            <Plus className="size-3" /> Be the first
          </button>
        </div>
      )}

      {showCreate && <CreateStatusModal onClose={() => setShowCreate(false)} />}
      {viewingGroup && (
        <StatusViewer statusGroup={viewingGroup} onClose={closeViewer} onView={viewStatus} />
      )}
    </div>
    </div>
  );
};
export default StatusPage;
