import { useChatStore } from "../store/useChatStore";
import { useEffect, useRef, useState } from "react";
import ChatHeader from "./ChatHeader";
import MessageInput from "./MessageInput";
import { REACTION_EMOJIS } from "../constants/emoji";
import MessageSkeleton from "./Skeletons/MessageSkeleton";
import { useAuthStore } from "../store/useAuthStore";
import { formatMessageTime } from "../lib/utils";
import { Search, X, ChevronUp, ChevronDown, CornerUpLeft, FileText, Film, Download } from "lucide-react";

// Renders a file attachment inside a message bubble
const FileAttachment = ({ fileUrl, fileType, fileName, fileSize }) => {
  if (!fileUrl) return null;
  const sizeStr = fileSize ? `${(fileSize / 1024 / 1024).toFixed(1)} MB` : "";

  if (fileType === "video") {
    return (
      <video controls className="max-w-xs rounded-lg mb-1" src={fileUrl}>
        Your browser does not support video.
      </video>
    );
  }
  if (fileType === "audio") {
    return <audio controls className="w-full mb-1" src={fileUrl} />;
  }
  return (
    <a href={fileUrl} target="_blank" rel="noreferrer"
      className="flex items-center gap-2 bg-black/10 hover:bg-black/20 transition rounded-lg px-3 py-2 mb-1 min-w-0">
      <FileText className="size-5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{fileName || "File"}</p>
        {sizeStr && <p className="text-xs opacity-60">{sizeStr}</p>}
      </div>
      <Download className="size-4 flex-shrink-0 opacity-60" />
    </a>
  );
};

// Quoted reply preview inside a bubble
const ReplyPreview = ({ replyTo, authUserId }) => {
  if (!replyTo) return null;
  const isOwn = replyTo.senderId === authUserId || replyTo.senderId?._id === authUserId;
  return (
    <div className="bg-black/10 border-l-2 border-white/40 rounded px-2 py-1 mb-1 text-xs opacity-80 max-w-xs">
      <p className="font-medium mb-0.5">{isOwn ? "You" : "Them"}</p>
      <p className="truncate">
        {replyTo.text || (replyTo.image ? "📷 Photo" : replyTo.fileName || "Attachment")}
      </p>
    </div>
  );
};

// Reaction bar below a message
const ReactionBar = ({ reactions, onReact, messageId, authUserId }) => {
  const [showPicker, setShowPicker] = useState(false);
  if (!reactions || reactions.length === 0) {
    return (
      <div className="relative">
        <button onClick={() => setShowPicker((v) => !v)}
          className="text-xs opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 hover:bg-base-300 rounded-full px-1.5 py-0.5">
          +
        </button>
        {showPicker && (
          <div className="absolute bottom-6 left-0 z-20 flex gap-1 bg-base-100 border border-base-300 rounded-full shadow-lg px-2 py-1">
            {REACTION_EMOJIS.map((e) => (
              <button key={e} onClick={() => { onReact(messageId, e); setShowPicker(false); }}
                className="text-lg hover:scale-125 transition-transform">{e}</button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Group by emoji
  const grouped = {};
  reactions.forEach((r) => {
    if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, hasMe: false };
    grouped[r.emoji].count++;
    if ((r.userId?._id || r.userId) === authUserId) grouped[r.emoji].hasMe = true;
  });

  return (
    <div className="flex items-center gap-0.5 flex-wrap mt-0.5 relative">
      {Object.entries(grouped).map(([emoji, { count, hasMe }]) => (
        <button key={emoji} onClick={() => onReact(messageId, emoji)}
          className={`flex items-center gap-0.5 text-xs rounded-full px-1.5 py-0.5 border transition-colors ${hasMe ? "bg-primary/20 border-primary/40" : "bg-base-200 border-base-300 hover:bg-base-300"}`}>
          <span>{emoji}</span>
          {count > 1 && <span className="font-medium">{count}</span>}
        </button>
      ))}
      <button onClick={() => setShowPicker((v) => !v)}
        className="text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-base-300 rounded-full px-1.5 py-0.5 border border-transparent">
        +
      </button>
      {showPicker && (
        <div className="absolute bottom-7 left-0 z-20 flex gap-1 bg-base-100 border border-base-300 rounded-full shadow-lg px-2 py-1">
          {REACTION_EMOJIS.map((e) => (
            <button key={e} onClick={() => { onReact(messageId, e); setShowPicker(false); }}
              className="text-lg hover:scale-125 transition-transform">{e}</button>
          ))}
        </div>
      )}
    </div>
  );
};

const ChatContainer = () => {
  const {
    messages, getMessages, isMessagesLoading, selectedUser,
    isTyping, markMessagesAsRead, setReplyingTo, addReaction,
  } = useChatStore();
  const { authUser } = useAuthStore();
  const messageEndRef = useRef(null);

  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchedIndices, setMatchedIndices] = useState([]);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const messageRefs = useRef({});
  const searchInputRef = useRef(null);

  useEffect(() => {
    getMessages(selectedUser._id).then(() => markMessagesAsRead(selectedUser._id));
  }, [selectedUser._id, getMessages, markMessagesAsRead]);

  useEffect(() => {
    if (messageEndRef.current && messages) {
      messageEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isTyping]);

  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) searchInputRef.current.focus();
  }, [isSearchOpen]);

  useEffect(() => {
    if (!searchQuery.trim()) { setMatchedIndices([]); setCurrentMatchIdx(0); return; }
    const q = searchQuery.toLowerCase();
    const indices = messages.map((m, i) => (m.text?.toLowerCase().includes(q) ? i : -1)).filter((i) => i !== -1);
    setMatchedIndices(indices);
    setCurrentMatchIdx(indices.length > 0 ? indices.length - 1 : 0);
  }, [searchQuery, messages]);

  useEffect(() => {
    if (matchedIndices.length === 0) return;
    const msgId = messages[matchedIndices[currentMatchIdx]]?._id;
    if (msgId && messageRefs.current[msgId]) {
      messageRefs.current[msgId].scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentMatchIdx, matchedIndices, messages]);

  const handleToggleSearch = () => {
    setIsSearchOpen((v) => !v);
    if (isSearchOpen) { setSearchQuery(""); setMatchedIndices([]); }
  };
  const goToPrevMatch = () => setCurrentMatchIdx((p) => (p > 0 ? p - 1 : matchedIndices.length - 1));
  const goToNextMatch = () => setCurrentMatchIdx((p) => (p < matchedIndices.length - 1 ? p + 1 : 0));

  const highlightText = (text, query) => {
    if (!query.trim() || !text) return text;
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} className="bg-yellow-300 text-black rounded px-0.5">{part}</mark>
        : part
    );
  };

  if (isMessagesLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-auto">
        <ChatHeader onToggleSearch={handleToggleSearch} isSearchOpen={isSearchOpen} />
        <MessageSkeleton />
        <MessageInput store="dm" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-auto">
      <ChatHeader onToggleSearch={handleToggleSearch} isSearchOpen={isSearchOpen} />

      {/* Search bar */}
      {isSearchOpen && (
        <div className="border-b border-base-300 bg-base-100 px-4 py-2 flex items-center gap-2">
          <Search className="size-4 text-base-content/40 flex-shrink-0" />
          <input ref={searchInputRef} type="text" placeholder="Search in conversation..."
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") goToNextMatch(); if (e.key === "Escape") handleToggleSearch(); }}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-base-content/40" />
          {searchQuery && (
            <span className="text-xs text-base-content/50 flex-shrink-0">
              {matchedIndices.length > 0 ? `${currentMatchIdx + 1}/${matchedIndices.length}` : "0 results"}
            </span>
          )}
          {matchedIndices.length > 0 && (
            <div className="flex gap-0.5">
              <button onClick={goToPrevMatch} className="btn btn-ghost btn-xs btn-circle"><ChevronUp className="size-3" /></button>
              <button onClick={goToNextMatch} className="btn btn-ghost btn-xs btn-circle"><ChevronDown className="size-3" /></button>
            </div>
          )}
          <button onClick={handleToggleSearch} className="btn btn-ghost btn-xs btn-circle"><X className="size-3" /></button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, idx) => {
          const isOwn = message.senderId === authUser._id;
          const isCurrentMatch = matchedIndices.length > 0 && matchedIndices[currentMatchIdx] === idx;
          const isAnyMatch = matchedIndices.includes(idx);

          return (
            <div key={message._id} ref={(el) => (messageRefs.current[message._id] = el)}
              className={`chat group ${isOwn ? "chat-end" : "chat-start"}`}>
              <div className="chat-image avatar">
                <div className="size-10 rounded-full border">
                  <img src={isOwn ? (authUser.profilePic || "/avatar.png") : (selectedUser.profilePic || "/avatar.png")} alt="avatar" />
                </div>
              </div>

              <div className="chat-header mb-1">
                <time className="text-xs opacity-50 ml-1">{formatMessageTime(message.createdAt)}</time>
              </div>

              {/* Bubble + reply action */}
              <div className={`flex items-end gap-1 ${isOwn ? "flex-row-reverse" : "flex-row"}`}>
                <div className={`chat-bubble flex flex-col transition-all duration-200 max-w-xs lg:max-w-sm ${
                  isCurrentMatch ? "ring-2 ring-primary ring-offset-1" : isAnyMatch ? "opacity-60" : ""
                }`}>
                  {/* Quoted reply */}
                  {message.replyTo && (
                    <ReplyPreview replyTo={message.replyTo} authUserId={authUser._id} />
                  )}
                  {/* Image */}
                  {message.image && (
                    <img src={message.image} alt="Attachment" className="max-w-[200px] rounded-md mb-1" />
                  )}
                  {/* File */}
                  {message.fileUrl && (
                    <FileAttachment
                      fileUrl={message.fileUrl}
                      fileType={message.fileType}
                      fileName={message.fileName}
                      fileSize={message.fileSize}
                    />
                  )}
                  {/* Text */}
                  {message.text && (
                    <p>{searchQuery ? highlightText(message.text, searchQuery) : message.text}</p>
                  )}
                </div>

                {/* Reply button — shows on hover */}
                <button
                  onClick={() => setReplyingTo(message)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity btn btn-ghost btn-xs btn-circle"
                  title="Reply">
                  <CornerUpLeft className="size-3" />
                </button>
              </div>

              {/* Reactions */}
              <div className={`${isOwn ? "chat-end" : "chat-start"}`}>
                <ReactionBar
                  reactions={message.reactions || []}
                  onReact={addReaction}
                  messageId={message._id}
                  authUserId={authUser._id}
                />
              </div>

              {/* Read receipts */}
              {isOwn && (
                <div className="chat-footer opacity-50 text-xs mt-0.5">
                  {message.isRead ? "✓✓ Seen" : "✓ Sent"}
                </div>
              )}
            </div>
          );
        })}

        {/* Typing indicator */}
        {isTyping && (
          <div className="chat chat-start">
            <div className="chat-image avatar">
              <div className="size-10 rounded-full border">
                <img src={selectedUser.profilePic || "/avatar.png"} alt="typing" />
              </div>
            </div>
            <div className="chat-bubble bg-base-300 text-base-content flex items-center gap-1 py-3 px-4">
              <span className="animate-bounce inline-block" style={{ animationDelay: "0ms" }}>•</span>
              <span className="animate-bounce inline-block" style={{ animationDelay: "150ms" }}>•</span>
              <span className="animate-bounce inline-block" style={{ animationDelay: "300ms" }}>•</span>
            </div>
          </div>
        )}
        <div ref={messageEndRef} />
      </div>

      <MessageInput store="dm" />
    </div>
  );
};
export default ChatContainer;
