import { ArrowLeft, Phone, Search, Video, X } from "lucide-react";
import { useState } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { useChatStore } from "../store/useChatStore";
import { useCallStore } from "../store/useCallStore";
import UserProfileModal from "./UserProfileModal";

const ChatHeader = ({ onToggleSearch, isSearchOpen }) => {
  const { selectedUser, setSelectedUser } = useChatStore();
  const { onlineUsers } = useAuthStore();
  const { startCall, callState } = useCallStore();
  const [showProfile, setShowProfile] = useState(false);

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
                {isOnline ? "Online" : "Offline"}
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
    </>
  );
};

export default ChatHeader;
