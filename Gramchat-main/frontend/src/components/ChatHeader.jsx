import { ArrowLeft, Ban, Images, MoreVertical, Phone, Search, Timer, UserMinus, Video, X } from "lucide-react";
import { useState } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { useChatStore } from "../store/useChatStore";
import { useCallStore } from "../store/useCallStore";
import { useContactStore } from "../store/useContactStore";
import UserProfileModal from "./UserProfileModal";
import MediaGalleryModal from "./MediaGalleryModal";
import DisappearingModal from "./DisappearingModal";
import { timerLabel } from "../lib/messageRules";

const ChatHeader = ({ onToggleSearch, isSearchOpen }) => {
  const { selectedUser, setSelectedUser } = useChatStore();
  const { onlineUsers } = useAuthStore();
  const { startCall, callState } = useCallStore();
  const [showProfile, setShowProfile] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showTimer, setShowTimer] = useState(false);
  const timerSeconds = useChatStore((s) => s.timers[selectedUser._id] || 0); // disappearing messages for this chat (0 = off)
  const [menuOpen, setMenuOpen] = useState(false);
  const { remove, block } = useContactStore();

  const isOnline = onlineUsers.includes(selectedUser._id);
  const isBusy = callState !== "idle";

  return (
    <>
      <div className="p-2.5 border-b border-base-300">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            {/* Back arrow — mobile */}
            <button className="lg:hidden btn btn-ghost btn-sm btn-circle" onClick={() => setSelectedUser(null)}>
              <ArrowLeft className="size-5" />
            </button>

            {/* Avatar */}
            <div className="avatar cursor-pointer" title="View profile" onClick={() => setShowProfile(true)}>
              <div className="size-10 rounded-full relative ring-2 ring-offset-base-100 ring-offset-1 hover:ring-primary transition-all duration-200">
                <img src={selectedUser.profilePic || "/avatar.png"} alt={selectedUser.fullName} className="rounded-full" />
              </div>
            </div>

            {/* Name + status */}
            <div className="cursor-pointer min-w-0" onClick={() => setShowProfile(true)}>
              <h3 className="font-medium hover:text-primary transition-colors truncate">{selectedUser.fullName}</h3>
              <p className={`text-sm ${isOnline ? "text-green-500" : "text-base-content/50"}`}>
                {isOnline ? "Online" : selectedUser.username ? `@${selectedUser.username}` : "Offline"}
                {timerSeconds > 0 && (
                  <span className="ml-2 inline-flex items-center gap-0.5 text-base-content/60" title={`New messages disappear after ${timerLabel(timerSeconds)}`}>
                    <Timer className="size-3.5" aria-hidden="true" /> {timerLabel(timerSeconds)}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Voice call */}
            <button
              onClick={() => startCall(selectedUser, "voice")}
              disabled={isBusy || !isOnline}
              title={!isOnline ? "User is offline" : "Voice call"}
              className={`btn btn-ghost btn-sm btn-circle transition-colors ${
                isBusy || !isOnline ? "opacity-30 cursor-not-allowed" : "text-green-500 hover:bg-green-500/10"
              }`}
            >
              <Phone className="size-4" />
            </button>

            {/* Video call */}
            <button
              onClick={() => startCall(selectedUser, "video")}
              disabled={isBusy || !isOnline}
              title={!isOnline ? "User is offline" : "Video call"}
              className={`btn btn-ghost btn-sm btn-circle transition-colors ${
                isBusy || !isOnline ? "opacity-30 cursor-not-allowed" : "text-blue-500 hover:bg-blue-500/10"
              }`}
            >
              <Video className="size-4" />
            </button>

            {/* Search toggle */}
            <button
              className={`btn btn-ghost btn-sm btn-circle ${isSearchOpen ? "text-primary" : "text-base-content/60"}`}
              onClick={onToggleSearch}
              title="Search messages"
            >
              <Search className="size-4" />
            </button>

            {/* More: remove / block */}
            <div className="relative">
              <button className="btn btn-ghost btn-sm btn-circle text-base-content/60" onClick={() => setMenuOpen((o) => !o)} title="More" aria-haspopup="menu" aria-expanded={menuOpen}>
                <MoreVertical className="size-4" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                  <ul className="absolute right-0 top-full mt-1 z-40 menu bg-base-100 rounded-box shadow-lg border border-base-300 w-52 p-1" role="menu">
                    <li>
                      <button onClick={() => { setMenuOpen(false); setShowGallery(true); }}>
                        <Images className="size-4" /> Media, links and docs
                      </button>
                    </li>
                    <li>
                      <button onClick={() => { setMenuOpen(false); setShowTimer(true); }}>
                        <Timer className="size-4" /> Disappearing messages
                      </button>
                    </li>
                    <li>
                      <button onClick={() => { setMenuOpen(false); if (window.confirm(`Remove ${selectedUser.fullName} from your contacts? You won't be able to message each other until you reconnect.`)) remove(selectedUser._id); }}>
                        <UserMinus className="size-4" /> Remove contact
                      </button>
                    </li>
                    <li>
                      <button className="text-error" onClick={() => { setMenuOpen(false); if (window.confirm(`Block ${selectedUser.fullName}? They won't be able to find, message or call you.`)) block(selectedUser._id); }}>
                        <Ban className="size-4" /> Block
                      </button>
                    </li>
                  </ul>
                </>
              )}
            </div>

            {/* Close — desktop */}
            <button className="hidden lg:flex btn btn-ghost btn-sm btn-circle" onClick={() => setSelectedUser(null)}>
              <X className="size-5" />
            </button>
          </div>
        </div>
      </div>

      {showProfile && (
        <UserProfileModal user={selectedUser} isOnline={isOnline} onClose={() => setShowProfile(false)} />
      )}
      {showTimer && (
        <DisappearingModal
          title={selectedUser.fullName}
          current={timerSeconds}
          onPick={(seconds) => useChatStore.getState().setTimer(selectedUser._id, seconds)}
          onClose={() => setShowTimer(false)}
        />
      )}
      {showGallery && (
        <MediaGalleryModal
          kind="user"
          chatId={selectedUser._id}
          title={selectedUser.fullName}
          onShow={(m) => useChatStore.getState().setFocus({ id: m._id, createdAt: m.createdAt })}
          onClose={() => setShowGallery(false)}
        />
      )}
    </>
  );
};

export default ChatHeader;
