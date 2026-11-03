import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, ArrowLeft, Check, Ellipsis, House, MessageCircle, Plus, Search, Settings, Star, User, UserPlus, Users, UsersRound, X } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import { useGroupStore } from "../store/useGroupStore";
import { useAuthStore } from "../store/useAuthStore";
import { useContactStore } from "../store/useContactStore";
import { useStatusStore } from "../store/useStatusStore";
import { useDraftStore } from "../store/useDraftStore";
import { useChatPrefsStore, prefKey, isMuted } from "../store/useChatPrefsStore";
import { formatListTime, previewOf } from "../lib/utils";
import ChatListItem from "./ChatListItem";
import MessageSearchResults from "./MessageSearchResults";
import ContactsModal from "./ContactsModal";
import StarredModal from "./StarredModal";
import { CreateGroupModal, DraftPreview } from "./Sidebar";

/** Pick a contact to start a chat with ("New Chat" in the + New sheet) */
const NewChatModal = ({ users, onPick, onAddContact, onClose }) => {
  const [q, setQ] = useState("");
  const list = users
    .filter((u) => u.fullName.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-base-100 rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[85dvh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="font-semibold text-lg">New chat</h2>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="px-5 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-base-content/40" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts" className="input input-bordered input-sm w-full pl-9 rounded-full" />
          </div>
        </div>
        <div className="overflow-y-auto px-3 pb-4 flex-1">
          {list.map((u) => (
            <button key={u._id} type="button" onClick={() => onPick(u)} className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-base-200 text-left">
              <img src={u.profilePic || "/avatar.png"} alt="" className="size-11 rounded-full object-cover shrink-0" />
              <span className="min-w-0">
                <span className="block font-medium truncate">{u.fullName}</span>
                {u.username && <span className="block text-xs text-base-content/50 truncate">@{u.username}</span>}
              </span>
            </button>
          ))}
          {list.length === 0 && (
            <div className="text-center text-sm text-base-content/50 py-8 space-y-3">
              <p>{q ? `No contacts named "${q}"` : "No contacts yet"}</p>
              {!q && <button className="btn btn-primary btn-sm rounded-full gap-2" onClick={onAddContact}><UserPlus className="size-4" /> Add contact</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** One entry of the "+ New" sheet */
const SheetItem = ({ icon: Icon, title, hint, onClick }) => (
  <button type="button" onClick={onClick} className="w-full flex items-center gap-3 px-1 py-3 text-left active:opacity-70">
    <span className="size-9 rounded-full bg-base-200 flex items-center justify-center shrink-0"><Icon className="size-[18px]" /></span>
    <span className="min-w-0">
      <span className="block text-sm font-semibold">{title}</span>
      <span className="block text-xs text-base-content/50">{hint}</span>
    </span>
  </button>
);

/** The phone home screen: greeting, stories, chat list and a bottom bar with "+ New". Desktop keeps the Sidebar. */
const MobileHome = () => {
  const navigate = useNavigate();
  const { getUsers, users, setSelectedUser, isUsersLoading, conversations } = useChatStore();
  const { getMyGroups, groups, setSelectedGroup, groupUnread } = useGroupStore();
  const authUser = useAuthStore((s) => s.authUser);
  const socket = useAuthStore((s) => s.socket);
  const onlineUsers = useAuthStore((s) => s.onlineUsers);
  const requestCount = useContactStore((s) => s.incoming.length);
  const drafts = useDraftStore((s) => s.drafts);
  const prefs = useChatPrefsStore((s) => s.prefs);
  const { getStatuses, subscribeToStatuses, unsubscribeFromStatuses, getStatusesByUser } = useStatusStore();
  const statuses = useStatusStore((s) => s.statuses); // re-render when stories change

  const [activeTab, setActiveTab] = useState("chats");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // the "…" next to Chats
  const [sheetOpen, setSheetOpen] = useState(false); // the "+ New" sheet
  const [showNewChat, setShowNewChat] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showStarred, setShowStarred] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => { getUsers(); }, [getUsers]);
  useEffect(() => { getMyGroups(); }, [getMyGroups]);
  useEffect(() => {
    getStatuses();
    subscribeToStatuses();
    return () => unsubscribeFromStatuses();
  }, [getStatuses, subscribeToStatuses, unsubscribeFromStatuses, socket]);

  const prefOf = (kind, id) => prefs[prefKey(kind, id)];
  const draftFor = (kind, id) => drafts[`${kind}:${id}`]?.text || null;
  const searching = query.trim().length > 0;
  const shown = (kind, id) => searching || !!prefOf(kind, id)?.archived === showArchived;
  const pinnedFirst = (kind) => (a, b) => !!prefOf(kind, b._id)?.pinnedAt - !!prefOf(kind, a._id)?.pinnedAt;
  const activity = (id) => new Date(conversations[id]?.lastMessage?.createdAt || 0).getTime();

  const filteredUsers = users
    .filter((u) => u.fullName.toLowerCase().includes(query.trim().toLowerCase()) && (onlineOnly ? onlineUsers.includes(u._id) : true) && shown("user", u._id))
    .sort((a, b) => pinnedFirst("user")(a, b) || activity(b._id) - activity(a._id) || a.fullName.localeCompare(b.fullName));
  const filteredGroups = groups
    .filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()) && shown("group", g._id))
    .sort(pinnedFirst("group"));

  const archivedUsers = users.filter((u) => prefOf("user", u._id)?.archived);
  const archivedGroups = groups.filter((g) => prefOf("group", g._id)?.archived);
  const archivedCount = activeTab === "chats" ? archivedUsers.length : archivedGroups.length;

  // "N unread messages" under the greeting: muted chats don't count
  const unreadTotal = useMemo(() => {
    let n = 0;
    for (const [id, c] of Object.entries(conversations)) if (!isMuted(prefs[prefKey("user", id)])) n += c.unread || 0;
    for (const [id, c] of Object.entries(groupUnread)) if (!isMuted(prefs[prefKey("group", id)])) n += c || 0;
    return n;
  }, [conversations, groupUnread, prefs]);

  const preview = (conv) => {
    const m = conv?.lastMessage;
    if (!m) return null;
    return `${m.senderId === authUser?._id ? "You: " : ""}${previewOf(m)}`;
  };

  const openUser = (user) => { setSelectedUser(user); setSelectedGroup(null); };
  const openGroup = (group) => { setSelectedGroup(group); setSelectedUser(null); };

  // Stories: everyone else's, then yours if you have one
  const grouped = getStatusesByUser();
  const idOf = (g) => g.user?._id || g.user;
  const myStory = grouped.find((g) => idOf(g) === authUser?._id);
  const otherStories = grouped.filter((g) => idOf(g) !== authUser?._id);
  void statuses;

  const closeSearch = () => { setSearchOpen(false); setQuery(""); };
  const goHome = () => {
    setShowArchived(false);
    closeSearch();
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const switchTab = (tab) => { setActiveTab(tab); setShowArchived(false); };

  const firstWord = (name) => (name || "").split(" ")[0];

  return (
    <div className="relative flex flex-col h-full w-full bg-base-100 overflow-hidden">
      {/* Greeting */}
      <header className="shrink-0 px-5 pt-[max(env(safe-area-inset-top),1.25rem)] pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold truncate">Hi {authUser?.fullName}</h1>
          <p className="text-xs text-base-content/50 mt-0.5">
            {unreadTotal > 0 ? `${unreadTotal} unread message${unreadTotal === 1 ? "" : "s"}` : "No unread messages"}
          </p>
        </div>
        <button type="button" onClick={() => setShowContacts(true)} aria-label={requestCount > 0 ? `Contacts, ${requestCount} new request${requestCount === 1 ? "" : "s"}` : "Contacts"}
          className="relative size-9 shrink-0 rounded-full bg-base-200 flex items-center justify-center active:opacity-70">
          <Users className="size-[18px]" />
          {requestCount > 0 && <span className="absolute top-0 right-0 size-2.5 rounded-full bg-error ring-2 ring-base-100" />}
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        {/* Stories */}
        <section className="px-5 pb-4">
          <div className="flex gap-3.5 overflow-x-auto -mx-5 px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button type="button" onClick={() => navigate("/status?add=1")} className="shrink-0 w-14 flex flex-col items-center gap-1.5 active:opacity-70">
              <span className="size-14 rounded-full border-2 border-dashed border-base-content/30 flex items-center justify-center">
                <Plus className="size-5 text-base-content/60" />
              </span>
              <span className="text-[11px] text-base-content/60 truncate w-full text-center">Add Story</span>
            </button>
            {myStory && (
              <button type="button" onClick={() => navigate(`/status?view=${authUser._id}`)} className="shrink-0 w-14 flex flex-col items-center gap-1.5 active:opacity-70">
                <img src={authUser.profilePic || "/avatar.png"} alt="" className="size-14 rounded-full object-cover ring-2 ring-primary ring-offset-2 ring-offset-base-100" />
                <span className="text-[11px] text-base-content/60 truncate w-full text-center">You</span>
              </button>
            )}
            {otherStories.map((g) => {
              const uid = idOf(g);
              const unviewed = g.items.some((s) => !s.viewedByMe);
              return (
                <button key={uid} type="button" onClick={() => navigate(`/status?view=${uid}`)} className="shrink-0 w-14 flex flex-col items-center gap-1.5 active:opacity-70">
                  <img src={g.user?.profilePic || "/avatar.png"} alt="" className={`size-14 rounded-full object-cover ring-2 ring-offset-2 ring-offset-base-100 ${unviewed ? "ring-primary" : "ring-base-300"}`} />
                  <span className="text-[11px] text-base-content/60 truncate w-full text-center">{firstWord(g.user?.fullName)}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Chats / Groups heading + search and menu */}
        <section className="px-5">
          <div className="flex items-center justify-between mb-1">
            {showArchived && !searching ? (
              <button type="button" onClick={() => setShowArchived(false)} className="flex items-center gap-2 text-lg font-semibold">
                <ArrowLeft className="size-5" /> Archived
              </button>
            ) : (
              <div className="flex items-baseline gap-4">
                <button type="button" onClick={() => switchTab("chats")} className={`text-lg font-semibold transition-colors ${activeTab === "chats" ? "" : "text-base-content/30"}`}>Chats</button>
                <button type="button" onClick={() => switchTab("groups")} className={`text-lg font-semibold transition-colors flex items-center gap-1.5 ${activeTab === "groups" ? "" : "text-base-content/30"}`}>
                  Groups
                  {groups.length > 0 && <span className="text-xs font-medium text-base-content/40">{groups.length}</span>}
                </button>
              </div>
            )}
            <div className="relative flex items-center gap-1">
              <button type="button" onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))} aria-label="Search chats and messages"
                className={`btn btn-ghost btn-sm btn-circle ${searchOpen ? "text-primary" : ""}`}>
                <Search className="size-[18px]" />
              </button>
              <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-label="More" aria-haspopup="menu" aria-expanded={menuOpen} className="btn btn-ghost btn-sm btn-circle">
                <Ellipsis className="size-5" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                  <ul role="menu" className="absolute right-0 top-full mt-1 z-40 w-56 bg-base-100 border border-base-300 rounded-xl shadow-xl p-1">
                    {activeTab === "chats" && (
                      <li role="none">
                        <button role="menuitemcheckbox" aria-checked={onlineOnly} type="button" onClick={() => { setOnlineOnly((v) => !v); setMenuOpen(false); }}
                          className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-sm hover:bg-base-200">
                          <span className="size-4 flex items-center justify-center">{onlineOnly ? <Check className="size-4 text-primary" /> : <span className="size-2 rounded-full bg-green-500" />}</span>
                          Online only <span className="ml-auto text-xs text-base-content/40">{onlineUsers.length}</span>
                        </button>
                      </li>
                    )}
                    <li role="none">
                      <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); setShowStarred(true); }} className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-sm hover:bg-base-200">
                        <Star className="size-4" /> Starred messages
                      </button>
                    </li>
                    <li role="none">
                      <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); navigate("/settings"); }} className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-sm hover:bg-base-200">
                        <Settings className="size-4" /> Settings
                      </button>
                    </li>
                  </ul>
                </>
              )}
            </div>
          </div>

          {searchOpen && (
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-base-content/40" />
              <input autoFocus type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats and messages..."
                className="input input-bordered input-sm w-full pl-9 rounded-full" />
            </div>
          )}

          {/* The list */}
          {isUsersLoading ? (
            <div className="space-y-4 pt-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="skeleton size-12 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2"><div className="skeleton h-3.5 w-32" /><div className="skeleton h-3 w-48" /></div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {!showArchived && !searching && archivedCount > 0 && (
                <button type="button" onClick={() => setShowArchived(true)} className="w-full flex items-center gap-3 py-2.5 text-left active:opacity-70">
                  <span className="size-12 rounded-full bg-base-200 flex items-center justify-center shrink-0"><Archive className="size-5 text-base-content/60" /></span>
                  <span className="flex-1 font-medium text-[15px]">Archived</span>
                  <span className="text-sm text-base-content/50">{archivedCount}</span>
                </button>
              )}

              {activeTab === "chats" ? (
                <>
                  {filteredUsers.map((user) => {
                    const conv = conversations[user._id];
                    const draft = draftFor("dm", user._id);
                    const online = onlineUsers.includes(user._id);
                    return (
                      <ChatListItem
                        key={user._id}
                        variant="mobile"
                        kind="user"
                        id={user._id}
                        pref={prefOf("user", user._id)}
                        onOpen={() => openUser(user)}
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
                    <div className="text-center text-base-content/50 py-10 text-sm">
                      {query ? `No chats named "${query}"` : showArchived ? "No archived chats" : onlineOnly ? "No contacts online" : (
                        <>
                          <p className="font-medium">No contacts yet</p>
                          <p className="mt-1">Tap <b>+ New</b>, then <b>New Contact</b>, and enter a friend's username to start chatting.</p>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {filteredGroups.map((group) => {
                    const draft = draftFor("group", group._id);
                    return (
                      <ChatListItem
                        key={group._id}
                        variant="mobile"
                        kind="group"
                        id={group._id}
                        pref={prefOf("group", group._id)}
                        onOpen={() => openGroup(group)}
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
                    <div className="text-center text-base-content/50 py-10 text-sm space-y-2">
                      <UsersRound className="size-8 mx-auto opacity-30" />
                      <p>{query ? `No groups named "${query}"` : showArchived ? "No archived groups" : "No groups yet"}</p>
                      {!query && !showArchived && (
                        <button onClick={() => setShowCreateGroup(true)} className="btn btn-primary btn-sm gap-1 rounded-full">
                          <Plus className="size-3" /> Create one
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>

        <MessageSearchResults query={query} />
        <div className="h-4" />
      </div>

      {/* Dim the screen while the + New sheet is open */}
      {sheetOpen && <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setSheetOpen(false)} />}

      {/* Bottom bar */}
      <nav className="relative z-50 shrink-0 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]" aria-label="Main">
        {sheetOpen && (
          <div role="menu" className="absolute left-4 right-4 bottom-full mb-1 bg-base-100 rounded-2xl shadow-2xl px-4 py-1 divide-y divide-base-300">
            <SheetItem icon={MessageCircle} title="New Chat" hint="Send a message to your contact" onClick={() => { setSheetOpen(false); setShowNewChat(true); }} />
            <SheetItem icon={UserPlus} title="New Contact" hint="Add a contact to be able to send message" onClick={() => { setSheetOpen(false); setShowContacts(true); }} />
            <SheetItem icon={UsersRound} title="New Group" hint="Create a group with your contacts" onClick={() => { setSheetOpen(false); setShowCreateGroup(true); }} />
          </div>
        )}
        <div className="bg-base-300 rounded-full p-2 flex items-center justify-between gap-3">
          <button type="button" onClick={goHome} aria-label="Home" aria-current="page" className="size-11 rounded-full flex items-center justify-center text-base-content active:opacity-70">
            <House className="size-5" />
          </button>
          {sheetOpen ? (
            <button type="button" onClick={() => setSheetOpen(false)} className="flex-1 h-11 rounded-full bg-base-100 text-base-content font-medium text-sm">Cancel</button>
          ) : (
            <button type="button" onClick={() => { setMenuOpen(false); setSheetOpen(true); }} className="flex-1 h-11 rounded-full bg-neutral text-neutral-content font-medium text-sm flex items-center justify-center gap-1.5 active:opacity-80">
              <Plus className="size-4" /> New
            </button>
          )}
          <button type="button" onClick={() => navigate("/profile")} aria-label="Profile" className="size-11 rounded-full flex items-center justify-center text-base-content/60 active:opacity-70">
            <User className="size-5" />
          </button>
        </div>
      </nav>

      {showNewChat && (
        <NewChatModal
          users={users}
          onPick={(u) => { setShowNewChat(false); openUser(u); }}
          onAddContact={() => { setShowNewChat(false); setShowContacts(true); }}
          onClose={() => setShowNewChat(false)}
        />
      )}
      {showContacts && <ContactsModal initialTab={requestCount > 0 ? "requests" : "add"} onClose={() => setShowContacts(false)} />}
      {showStarred && <StarredModal onClose={() => setShowStarred(false)} />}
      {showCreateGroup && <CreateGroupModal users={users} onClose={() => setShowCreateGroup(false)} />}
    </div>
  );
};

export default MobileHome;
