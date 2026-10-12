import toast from "react-hot-toast";
import { useState } from "react";
import { useGroupStore } from "../store/useGroupStore";
import { useAuthStore } from "../store/useAuthStore";
import { useChatStore } from "../store/useChatStore";
import { X, Crown, UserMinus, UserPlus, Camera, Edit2, Check } from "lucide-react";

const GroupInfoModal = ({ group, onClose }) => {
  const { authUser } = useAuthStore();
  const { users } = useChatStore();
  const { addGroupMember, removeGroupMember, updateGroup } = useGroupStore();
  const isAdmin = group.admin?._id === authUser._id || group.admin === authUser._id;

  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(group.name);
  const [showAddMember, setShowAddMember] = useState(false);

  const memberIds = group.members?.map((m) => m._id || m) || [];
  const nonMembers = users.filter((u) => !memberIds.includes(u._id));

  const handleSaveName = async () => {
    if (newName.trim() && newName !== group.name) {
      await updateGroup(group._id, { name: newName.trim() });
    }
    setEditingName(false);
  };

  const handleGroupPicChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast?.error("Image must be under 5MB"); return; }
    const reader = new FileReader();
    reader.onloadend = () => updateGroup(group._id, { groupPic: reader.result });
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-base-100 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        {/* Banner */}
        <div className="h-20 bg-gradient-to-r from-primary/30 to-primary/10 relative flex-shrink-0">
          <button className="absolute top-3 right-3 btn btn-ghost btn-sm btn-circle" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-5 overflow-y-auto">
          {/* Group avatar */}
          <div className="flex items-end gap-4 -mt-8 mb-4">
            <div className="relative">
              <img src={group.groupPic || "/avatar.png"} alt={group.name}
                className="size-16 rounded-full object-cover border-4 border-base-100 shadow-md" />
              {isAdmin && (
                <label className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center cursor-pointer hover:bg-primary/80 transition">
                  <Camera className="size-3 text-primary-content" />
                  <input type="file" accept="image/*" className="hidden" onChange={handleGroupPicChange} />
                </label>
              )}
            </div>
            <div className="pb-1 flex-1">
              {editingName ? (
                <div className="flex items-center gap-1">
                  <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") setEditingName(false); }}
                    className="input input-bordered input-sm flex-1 rounded-lg" />
                  <button onClick={handleSaveName} className="btn btn-ghost btn-xs btn-circle">
                    <Check className="size-3 text-success" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <h2 className="text-lg font-bold">{group.name}</h2>
                  {isAdmin && (
                    <button onClick={() => setEditingName(true)} className="btn btn-ghost btn-xs btn-circle">
                      <Edit2 className="size-3" />
                    </button>
                  )}
                </div>
              )}
              <p className="text-xs text-base-content/50">{group.members?.length || 0} members</p>
            </div>
          </div>

          {/* Members list */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-base-content/70 uppercase tracking-wider">Members</h3>
              {isAdmin && (
                <button onClick={() => setShowAddMember((v) => !v)}
                  className="btn btn-ghost btn-xs gap-1 text-primary">
                  <UserPlus className="size-3" /> Add
                </button>
              )}
            </div>

            {/* Add member dropdown */}
            {showAddMember && nonMembers.length > 0 && (
              <div className="mb-3 bg-base-200 rounded-xl p-2 space-y-1 max-h-36 overflow-y-auto">
                {nonMembers.map((u) => (
                  <button key={u._id}
                    onClick={() => { addGroupMember(group._id, u._id); setShowAddMember(false); }}
                    className="flex items-center gap-2 w-full hover:bg-base-300 rounded-lg p-2 transition-colors">
                    <img src={u.profilePic || "/avatar.png"} alt={u.fullName} className="size-6 rounded-full" />
                    <span className="text-sm">{u.fullName}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1">
              {group.members?.map((member) => {
                const memberId = member._id || member;
                const memberIsAdmin = (group.admin?._id || group.admin) === memberId;
                const isSelf = memberId === authUser._id;
                return (
                  <div key={memberId}
                    className="flex items-center gap-3 p-2 hover:bg-base-200 rounded-xl transition-colors">
                    <img src={member.profilePic || "/avatar.png"} alt={member.fullName || "Member"}
                      className="size-9 rounded-full object-cover flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {member.fullName || "Member"}
                        {isSelf && <span className="text-xs text-base-content/50 ml-1">(You)</span>}
                      </p>
                    </div>
                    {memberIsAdmin && (
                      <span className="flex items-center gap-1 text-xs text-amber-500 font-medium flex-shrink-0">
                        <Crown className="size-3" /> Admin
                      </span>
                    )}
                    {/* Remove button: admin can remove others, anyone can remove themselves */}
                    {(isAdmin && !memberIsAdmin && !isSelf) || isSelf ? (
                      <button
                        onClick={() => removeGroupMember(group._id, memberId)}
                        className="btn btn-ghost btn-xs btn-circle text-error opacity-60 hover:opacity-100"
                        title={isSelf ? "Leave group" : "Remove"}>
                        <UserMinus className="size-3" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GroupInfoModal;
