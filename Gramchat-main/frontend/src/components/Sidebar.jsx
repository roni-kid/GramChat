import { useEffect, useState, useRef } from "react";
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import { useGroupStore } from "../store/useGroupStore";
import SidebarSkeleton from "./Skeletons/SidebarSkeleton";
import { Search, Users, UsersRound, Plus, X, Camera } from "lucide-react";
import { formatListTime, previewOf } from "../lib/utils";

const CreateGroupModal = ({ users, onClose }) => {
  const { createGroup } = useGroupStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [groupPic, setGroupPic] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  const toggle = (id) =>
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);

  const handlePic = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setGroupPic(reader.result);
    reader.readAsDataURL(file);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await createGroup({ name, description, memberIds: selectedIds, groupPic });
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-base-100 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-300">
          <h2 className="font-semibold text-lg">New Group</h2>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose}><X className="size-4" /></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4 flex-1">
          <div className="flex justify-center">
            <div className="relative">
              <div className="size-20 rounded-full bg-base-200 flex items-center justify-center overflow-hidden border-2 border-base-300">
                {groupPic ? <img src={groupPic} alt="Group" className="size-full object-cover" /> : <UsersRound className="size-8 text-base-content/30" />}
              </div>
              <label className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center cursor-pointer hover:bg-primary/80 transition">
                <Camera className="size-4 text-primary-content" />
                <input type="file" accept="image/*" className="hidden" ref={fileRef} onChange={handlePic} />
              </label>
            </div>
          </div>
          <div>
            <label className="text-xs text-base-content/50 uppercase tracking-wider font-medium">Group name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Study Squad"
              className="input input-bordered w-full mt-1 rounded-xl" autoFocus />
          </div>
          <div>
            <label className="text-xs text-base-content/50 uppercase tracking-wider font-medium">Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional"
              className="input input-bordered w-full mt-1 rounded-xl" />
          </div>
          <div>
            <label className="text-xs text-base-content/50 uppercase tracking-wider font-medium">
              Add members ({selectedIds.length} selected)
            </label>
            <div className="mt-2 space-y-1 max-h-52 overflow-y-auto">
              {users.map((u) => (
                <button key={u._id} onClick={() => toggle(u._id)}
                  className={`flex items-center gap-3 w-full p-2.5 rounded-xl transition-colors ${
                    selectedIds.includes(u._id) ? "bg-primary/10 border border-primary/30" : "hover:bg-base-200"}`}>
                  <img src={u.profilePic || "/avatar.png"} alt={u.fullName} className="size-9 rounded-full object-cover flex-shrink-0" />
                  <span className="text-sm font-medium flex-1 text-left">{u.fullName}</span>
                  {selectedIds.includes(u._id) && (
                    <span className="size-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <span className="text-primary-content text-xs">✓</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-base-300 flex gap-2">
          <button className="btn btn-ghost flex-1" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary flex-1" disabled={!name.trim() || loading} onClick={handleCreate}>
            {loading ? <span className="loading loading-spinner loading-sm" /> : "Create Group"}
          </button>
        </div>
      </div>
    </div>
  );
};

const Sidebar = () => {
  const { getUsers, users, selectedUser, setSelectedUser, isUsersLoading, conversations } = useChatStore();
  const authUser = useAuthStore((s) => s.authUser);
  const { onlineUsers } = useAuthStore();
  const { getMyGroups, groups, selectedGroup, setSelectedGroup, groupUnread } = useGroupStore();
  const [activeTab, setActiveTab] = useState("chats");
  const [showOnlineOnly, setShowOnlineOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  useEffect(() => { getUsers(); }, [getUsers]);
  useEffect(() => { getMyGroups(); }, [getMyGroups]);

  const activity = (id) => new Date(conversations[id]?.lastMessage?.createdAt || 0).getTime();
  const filteredUsers = users
    .filter((user) => {
      const matchesSearch = user.fullName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesOnline = showOnlineOnly ? onlineUsers.includes(user._id) : true;
      return matchesSearch && matchesOnline;
    })
    .sort((a, b) => activity(b._id) - activity(a._id) || a.fullName.localeCompare(b.fullName));

  const preview = (conv) => {
    const m = conv?.lastMessage;
    if (!m) return null;
    return `${m.senderId === authUser?._id ? "You: " : ""}${previewOf(m)}`;
  };

  const filteredGroups = groups.filter((g) => g.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleSelectUser = (user) => { setSelectedUser(user); setSelectedGroup(null); };
  const handleSelectGroup = (group) => { setSelectedGroup(group); setSelectedUser(null); };

  if (isUsersLoading) return <SidebarSkeleton />;

  return (
    <>
      <aside className="h-full w-full lg:w-72 border-r border-base-300 flex flex-col transition-all duration-200">
        <div className="border-b border-base-300 flex">
          <button onClick={() => setActiveTab("chats")}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
              activeTab === "chats" ? "border-b-2 border-primary text-primary" : "text-base-content/60 hover:text-base-content"}`}>
            <Users className="size-4" /> Chats
            {Object.values(conversations).reduce((n, c) => n + (c.unread || 0), 0) > 0 && <span className="size-2 rounded-full bg-primary" />}
          </button>
          <button onClick={() => setActiveTab("groups")}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
              activeTab === "groups" ? "border-b-2 border-primary text-primary" : "text-base-content/60 hover:text-base-content"}`}>
            <UsersRound className="size-4" /> Groups
            {groups.length > 0 && <span className="badge badge-sm badge-primary">{groups.length}</span>}
          </button>
        </div>

        <div className="border-b border-base-300 p-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-base-content/40" />
            <input type="text" placeholder={activeTab === "chats" ? "Search contacts..." : "Search groups..."}
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="input input-bordered input-sm w-full pl-9 rounded-full" />
          </div>
          {activeTab === "chats" && (
            <div className="flex items-center gap-2">
              <label className="cursor-pointer flex items-center gap-2">
                <input type="checkbox" checked={showOnlineOnly} onChange={(e) => setShowOnlineOnly(e.target.checked)} className="checkbox checkbox-xs" />
                <span className="text-sm">Online only</span>
              </label>
              <span className="text-xs text-zinc-500 ml-auto">({Math.max(0, onlineUsers.length - 1)} online)</span>
            </div>
          )}
          {activeTab === "groups" && (
            <button onClick={() => setShowCreateGroup(true)} className="btn btn-primary btn-sm w-full gap-2 rounded-full">
              <Plus className="size-4" /> New Group
            </button>
          )}
        </div>

        <div className="overflow-y-auto w-full py-2 flex-1">
          {activeTab === "chats" ? (
            <>
              {filteredUsers.map((user) => (
                <button key={user._id} onClick={() => handleSelectUser(user)}
                  className={`w-full p-3 flex items-center gap-3 hover:bg-base-300 transition-colors ${selectedUser?._id === user._id ? "bg-base-300 ring-1 ring-base-300" : ""}`}>
                  <div className="relative shrink-0">
                    <img src={user.profilePic || "/avatar.png"} alt={user.fullName} className="size-12 object-cover rounded-full" />
                    {onlineUsers.includes(user._id) && (
                      <span className="absolute bottom-0 right-0 size-3 bg-green-500 rounded-full ring-2 ring-base-100" />
                    )}
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium truncate">{user.fullName}</span>
                      <span className={`text-xs shrink-0 ${conversations[user._id]?.unread ? "text-primary font-semibold" : "text-base-content/40"}`}>
                        {formatListTime(conversations[user._id]?.lastMessage?.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-zinc-400 truncate">
                        {preview(conversations[user._id]) || (onlineUsers.includes(user._id) ? "Online" : "Offline")}
                      </span>
                      {conversations[user._id]?.unread > 0 && (
                        <span className="badge badge-primary badge-sm shrink-0" aria-label={`${conversations[user._id].unread} unread`}>
                          {conversations[user._id].unread > 99 ? "99+" : conversations[user._id].unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              {filteredUsers.length === 0 && (
                <div className="text-center text-zinc-500 py-8 text-sm">
                  {searchQuery ? `No results for "${searchQuery}"` : showOnlineOnly ? "No users online" : "No contacts yet"}
                </div>
              )}
            </>
          ) : (
            <>
              {filteredGroups.map((group) => (
                <button key={group._id} onClick={() => handleSelectGroup(group)}
                  className={`w-full p-3 flex items-center gap-3 hover:bg-base-300 transition-colors ${selectedGroup?._id === group._id ? "bg-base-300 ring-1 ring-base-300" : ""}`}>
                  <div className="relative shrink-0">
                    <img src={group.groupPic || "/avatar.png"} alt={group.name} className="size-12 object-cover rounded-full" />
                    <span className="absolute bottom-0 right-0 size-5 bg-primary rounded-full ring-2 ring-base-100 flex items-center justify-center">
                      <UsersRound className="size-3 text-primary-content" />
                    </span>
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="font-medium truncate">{group.name}</div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-zinc-400 truncate">
                        {group.lastMessage ? previewOf(group.lastMessage) : `${group.members?.length || 0} members`}
                      </span>
                      {groupUnread[group._id] > 0 && (
                        <span className="badge badge-primary badge-sm shrink-0" aria-label={`${groupUnread[group._id]} unread`}>
                          {groupUnread[group._id] > 99 ? "99+" : groupUnread[group._id]}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              {filteredGroups.length === 0 && (
                <div className="text-center text-zinc-500 py-8 text-sm space-y-2">
                  <UsersRound className="size-8 mx-auto opacity-30" />
                  <p>{searchQuery ? `No results for "${searchQuery}"` : "No groups yet"}</p>
                  {!searchQuery && (
                    <button onClick={() => setShowCreateGroup(true)} className="btn btn-primary btn-sm gap-1">
                      <Plus className="size-3" /> Create one
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
      {showCreateGroup && <CreateGroupModal users={users} onClose={() => setShowCreateGroup(false)} />}
    </>
  );
};
export default Sidebar;
