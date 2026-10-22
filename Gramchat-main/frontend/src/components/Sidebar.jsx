import { useEffect, useState, useRef } from "react";
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import { useGroupStore } from "../store/useGroupStore";
import SidebarSkeleton from "./Skeletons/SidebarSkeleton";
import { Search, Users, UsersRound, Plus, X, Camera, UserPlus, Star, Archive, ArrowLeft } from "lucide-react";
import ContactsModal from "./ContactsModal";
import StarredModal from "./StarredModal";
import ChatListItem from "./ChatListItem";
import MessageSearchResults from "./MessageSearchResults";
import { useContactStore } from "../store/useContactStore";
import { useChatPrefsStore, prefKey, isMuted } from "../store/useChatPrefsStore";
import { formatListTime, previewOf } from "../lib/utils";
import { useDraftStore } from "../store/useDraftStore";

// "Draft: hello…" shown in the chat list for chats that have unsent text (not for the chat you're typing in)
const DraftPreview = ({ text }) => (
  <>
    <span className="text-error">Draft: </span>{text}
  </>
);

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

/** "Archived" row at the top of a list (opens the archive) */
const ArchivedRow = ({ count, unread, onClick }) => (
  <button type="button" onClick={onClick} className="w-full px-3 py-3 flex items-center gap-3 text-left hover:bg-base-300 transition-colors">
    <span className="size-12 rounded-full bg-base-200 flex items-center justify-center shrink-0"><Archive className="size-5 text-base-content/60" /></span>
    <span className="flex-1 font-medium">Archived</span>
    {unread > 0 && <span className="badge badge-primary badge-sm" aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</span>}
    <span className="text-sm text-base-content/50">{count}</span>
  </button>
);

const Sidebar = () => {
  const { getUsers, users, selectedUser, setSelectedUser, isUsersLoading, conversations } = useChatStore();
  const authUser = useAuthStore((s) => s.authUser);
  const { onlineUsers } = useAuthStore();
  const { getMyGroups, groups, selectedGroup, setSelectedGroup, groupUnread } = useGroupStore();
  const [activeTab, setActiveTab] = useState("chats");
  const [showOnlineOnly, setShowOnlineOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [showStarred, setShowStarred] = useState(false);
  const [showArchived, setShowArchived] = useState(false); // the archive of the current tab
  const requestCount = useContactStore((s) => s.incoming.length);
  const drafts = useDraftStore((s) => s.drafts);
  const prefs = useChatPrefsStore((s) => s.prefs);
  const draftFor = (kind, id, openId) => (openId === id ? null : drafts[`${kind}:${id}`]?.text || null);

  useEffect(() => { getUsers(); }, [getUsers]);
  useEffect(() => { getMyGroups(); }, [getMyGroups]);

  const prefOf = (kind, id) => prefs[prefKey(kind, id)];
  const searching = searchQuery.trim().length > 0;
  // Archived chats are hidden from the main list and shown in the Archived view; while searching they are included
  const shown = (kind, id) => searching || !!prefOf(kind, id)?.archived === showArchived;
  // Pinned chats first (the sort is stable, so the existing order is kept inside each part)
  const pinnedFirst = (kind) => (a, b) => !!prefOf(kind, b._id)?.pinnedAt - !!prefOf(kind, a._id)?.pinnedAt;

  const activity = (id) => new Date(conversations[id]?.lastMessage?.createdAt || 0).getTime();
  const filteredUsers = users
    .filter((user) => {
      const matchesSearch = user.fullName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesOnline = showOnlineOnly ? onlineUsers.includes(user._id) : true;
      return matchesSearch && matchesOnline && shown("user", user._id);
    })
    .sort((a, b) => pinnedFirst("user")(a, b) || activity(b._id) - activity(a._id) || a.fullName.localeCompare(b.fullName));

  const preview = (conv) => {
    const m = conv?.lastMessage;
    if (!m) return null;
    return `${m.senderId === authUser?._id ? "You: " : ""}${previewOf(m)}`;
  };

  const filteredGroups = groups
    .filter((g) => g.name.toLowerCase().includes(searchQuery.toLowerCase()) && shown("group", g._id))
    .sort(pinnedFirst("group"));

  // The Archived row: how many archived chats, and how many unread messages they hold (muted ones don't count)
  const archivedUsers = users.filter((u) => prefOf("user", u._id)?.archived);
  const archivedGroups = groups.filter((g) => prefOf("group", g._id)?.archived);
  const archivedCount = activeTab === "chats" ? archivedUsers.length : archivedGroups.length;
  const archivedUnread = activeTab === "chats"
    ? archivedUsers.reduce((n, u) => n + (isMuted(prefOf("user", u._id)) ? 0 : conversations[u._id]?.unread || 0), 0)
    : archivedGroups.reduce((n, g) => n + (isMuted(prefOf("group", g._id)) ? 0 : groupUnread[g._id] || 0), 0);

  // Re-selecting the chat that is already open would reset it, so do nothing
  const handleSelectUser = (user) => { if (selectedUser?._id === user._id) return; setSelectedUser(user); setSelectedGroup(null); };
  const handleSelectGroup = (group) => { if (selectedGroup?._id === group._id) return; setSelectedGroup(group); setSelectedUser(null); };
  const switchTab = (tab) => { setActiveTab(tab); setShowArchived(false); };

  // The dot on the Chats tab: unread messages in chats that aren't muted
  const unreadDot = Object.entries(conversations).some(([id, c]) => c.unread > 0 && !isMuted(prefOf("user", id)));

  if (isUsersLoading) return <SidebarSkeleton />;

  return (
    <>
      <aside className="h-full w-full lg:w-72 border-r border-base-300 flex flex-col transition-all duration-200">
        <div className="border-b border-base-300 flex">
          <button onClick={() => switchTab("chats")}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
              activeTab === "chats" ? "border-b-2 border-primary text-primary" : "text-base-content/60 hover:text-base-content"}`}>
            <Users className="size-4" /> Chats
            {unreadDot && <span className="size-2 rounded-full bg-primary" />}
          </button>
          <button onClick={() => switchTab("groups")}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
              activeTab === "groups" ? "border-b-2 border-primary text-primary" : "text-base-content/60 hover:text-base-content"}`}>
            <UsersRound className="size-4" /> Groups
            {groups.length > 0 && <span className="badge badge-sm badge-primary">{groups.length}</span>}
          </button>
        </div>

        <div className="border-b border-base-300 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-base-content/40" />
              <input type="text" placeholder="Search chats and messages..."
                value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="input input-bordered input-sm w-full pl-9 rounded-full" />
            </div>
            <button onClick={() => setShowStarred(true)} className="btn btn-ghost btn-sm btn-circle" title="Starred messages" aria-label="Starred messages">
              <Star className="size-4" />
            </button>
          </div>
          {activeTab === "chats" && (
            <button onClick={() => setShowContacts(true)} className="btn btn-primary btn-sm w-full gap-2 rounded-full">
              <UserPlus className="size-4" /> Add contact
              {requestCount > 0 && <span className="badge badge-secondary badge-sm">{requestCount} new</span>}
            </button>
          )}
          {activeTab === "chats" && (
            <div className="flex items-center gap-2">
              <label className="cursor-pointer flex items-center gap-2">
                <input type="checkbox" checked={showOnlineOnly} onChange={(e) => setShowOnlineOnly(e.target.checked)} className="checkbox checkbox-xs" />
                <span className="text-sm">Online only</span>
              </label>
              <span className="text-xs text-zinc-500 ml-auto">({onlineUsers.length} online)</span>
            </div>
          )}
          {activeTab === "groups" && (
            <button onClick={() => setShowCreateGroup(true)} className="btn btn-primary btn-sm w-full gap-2 rounded-full">
              <Plus className="size-4" /> New Group
            </button>
          )}
        </div>

        <div className="overflow-y-auto w-full py-2 flex-1">
          {showArchived && !searching && (
            <button type="button" onClick={() => setShowArchived(false)} className="w-full px-3 py-2 flex items-center gap-2 text-sm font-medium hover:bg-base-300 text-left">
              <ArrowLeft className="size-4" /> Archived
            </button>
          )}
          {!showArchived && !searching && archivedCount > 0 && (
            <ArchivedRow count={archivedCount} unread={archivedUnread} onClick={() => setShowArchived(true)} />
          )}

          {activeTab === "chats" ? (
            <>
              {filteredUsers.map((user) => {
                const conv = conversations[user._id];
                const draft = draftFor("dm", user._id, selectedUser?._id);
                const online = onlineUsers.includes(user._id);
                return (
                  <ChatListItem
                    key={user._id}
                    kind="user"
                    id={user._id}
                    pref={prefOf("user", user._id)}
                    selected={selectedUser?._id === user._id}
                    onOpen={() => handleSelectUser(user)}
                    avatar={(
                      <div className="relative shrink-0">
                        <img src={user.profilePic || "/avatar.png"} alt={user.fullName} className="size-12 object-cover rounded-full" />
                        {online && <span className="absolute bottom-0 right-0 size-3 bg-green-500 rounded-full ring-2 ring-base-100" />}
                      </div>
                    )}
                    name={user.fullName}
                    time={formatListTime(conv?.lastMessage?.createdAt)}
                    unread={conv?.unread || 0}
                    preview={draft ? <DraftPreview text={draft} /> : preview(conv) || (online ? "Online" : "Offline")}
                  />
                );
              })}
              {filteredUsers.length === 0 && (
                <div className="text-center text-zinc-500 py-8 text-sm">
                  {searchQuery ? `No chats named "${searchQuery}"` : showArchived ? "No archived chats" : showOnlineOnly ? "No contacts online" : (
                    <>
                      <p className="font-medium">No contacts yet</p>
                      <p className="mt-1">Tap <b>Add contact</b> and enter a friend's username to start chatting.</p>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {filteredGroups.map((group) => {
                const draft = draftFor("group", group._id, selectedGroup?._id);
                return (
                  <ChatListItem
                    key={group._id}
                    kind="group"
                    id={group._id}
                    pref={prefOf("group", group._id)}
                    selected={selectedGroup?._id === group._id}
                    onOpen={() => handleSelectGroup(group)}
                    avatar={(
                      <div className="relative shrink-0">
                        <img src={group.groupPic || "/avatar.png"} alt={group.name} className="size-12 object-cover rounded-full" />
                        <span className="absolute bottom-0 right-0 size-5 bg-primary rounded-full ring-2 ring-base-100 flex items-center justify-center">
                          <UsersRound className="size-3 text-primary-content" />
                        </span>
                      </div>
                    )}
                    name={group.name}
                    time={formatListTime(group.lastMessage?.createdAt)}
                    unread={groupUnread[group._id] || 0}
                    preview={draft ? <DraftPreview text={draft} /> : group.lastMessage ? previewOf(group.lastMessage) : `${group.members?.length || 0} members`}
                  />
                );
              })}
              {filteredGroups.length === 0 && (
                <div className="text-center text-zinc-500 py-8 text-sm space-y-2">
                  <UsersRound className="size-8 mx-auto opacity-30" />
                  <p>{searchQuery ? `No groups named "${searchQuery}"` : showArchived ? "No archived groups" : "No groups yet"}</p>
                  {!searchQuery && !showArchived && (
                    <button onClick={() => setShowCreateGroup(true)} className="btn btn-primary btn-sm gap-1">
                      <Plus className="size-3" /> Create one
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          <MessageSearchResults query={searchQuery} />
        </div>
      </aside>
      {showContacts && <ContactsModal initialTab={requestCount > 0 ? "requests" : "add"} onClose={() => setShowContacts(false)} />}
      {showStarred && <StarredModal onClose={() => setShowStarred(false)} />}
      {showCreateGroup && <CreateGroupModal users={users} onClose={() => setShowCreateGroup(false)} />}
    </>
  );
};
export default Sidebar;
