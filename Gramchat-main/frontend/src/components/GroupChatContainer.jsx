import { useEffect, useRef, useState } from "react";
import { useGroupStore } from "../store/useGroupStore";
import { useAuthStore } from "../store/useAuthStore";
import { formatMessageTime } from "../lib/utils";
import MessageInput from "./MessageInput";
import { REACTION_EMOJIS } from "../constants/emoji";
import MessageSkeleton from "./Skeletons/MessageSkeleton";
import GroupInfoModal from "./GroupInfoModal";
import { ArrowLeft, Info, FileText, Film, Download, CornerUpLeft, X } from "lucide-react";

const FileAttachment = ({ fileUrl, fileType, fileName, fileSize }) => {
  if (!fileUrl) return null;
  const sizeStr = fileSize ? `${(fileSize / 1024 / 1024).toFixed(1)} MB` : "";
  if (fileType === "video") return <video controls className="max-w-xs rounded-lg mb-1" src={fileUrl} />;
  if (fileType === "audio") return <audio controls className="w-full mb-1" src={fileUrl} />;
  return (
    <a href={fileUrl} target="_blank" rel="noreferrer"
      className="flex items-center gap-2 bg-black/10 hover:bg-black/20 rounded-lg px-3 py-2 mb-1 min-w-0">
      <FileText className="size-5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{fileName || "File"}</p>
        {sizeStr && <p className="text-xs opacity-60">{sizeStr}</p>}
      </div>
      <Download className="size-4 opacity-60 flex-shrink-0" />
    </a>
  );
};

const ReplyPreview = ({ replyTo }) => {
  if (!replyTo) return null;
  const senderName = replyTo.senderId?.fullName || "Someone";
  return (
    <div className="bg-black/10 border-l-2 border-white/40 rounded px-2 py-1 mb-1 text-xs opacity-80 max-w-xs">
      <p className="font-medium mb-0.5">{senderName}</p>
      <p className="truncate">{replyTo.text || (replyTo.image ? "📷 Photo" : replyTo.fileName || "Attachment")}</p>
    </div>
  );
};

const ReactionBar = ({ reactions, onReact, messageId, authUserId }) => {
  const [showPicker, setShowPicker] = useState(false);
  const grouped = {};
  (reactions || []).forEach((r) => {
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
        className="text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-base-300 rounded-full px-1.5 py-0.5 border border-transparent">+</button>
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

const GroupChatContainer = () => {
  const {
    selectedGroup, groupMessages, isGroupMessagesLoading,
    getGroupMessages, addGroupReaction, isGroupTyping, groupTypingUser, setReplyingTo,
  } = useGroupStore();
  const { authUser, onlineUsers } = useAuthStore();
  const messageEndRef = useRef(null);
  const [showInfo, setShowInfo] = useState(false);

  const groupId = selectedGroup?._id;
  useEffect(() => {
    if (groupId) getGroupMessages(groupId);
  }, [groupId, getGroupMessages]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [groupMessages, isGroupTyping]);

  const typingMember = selectedGroup?.members?.find(
    (m) => (m._id || m) === groupTypingUser
  );

  const handleReact = addGroupReaction;

  if (!selectedGroup) return null;

  const onlineCount = selectedGroup.members?.filter((m) =>
    onlineUsers.includes(m._id || m)
  ).length || 0;

  return (
    <div className="flex-1 flex flex-col overflow-auto">
      {/* Header */}
      <div className="p-2.5 border-b border-base-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Back arrow — mobile only */}
            <button className="lg:hidden btn btn-ghost btn-sm btn-circle"
              onClick={() => useGroupStore.getState().setSelectedGroup(null)}>
              <ArrowLeft className="size-5" />
            </button>
            <div className="avatar cursor-pointer" onClick={() => setShowInfo(true)}>
              <div className="size-10 rounded-full ring-2 ring-offset-base-100 ring-offset-1 hover:ring-primary transition-all">
                <img src={selectedGroup.groupPic || "/avatar.png"} alt={selectedGroup.name} />
              </div>
            </div>
            <div className="cursor-pointer" onClick={() => setShowInfo(true)}>
              <h3 className="font-medium hover:text-primary transition-colors">{selectedGroup.name}</h3>
              <p className="text-xs text-base-content/50">
                {selectedGroup.members?.length || 0} members · {onlineCount} online
              </p>
            </div>
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-1">
            <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setShowInfo(true)}>
              <Info className="size-4" />
            </button>
            {/* Close button — desktop only */}
            <button className="hidden lg:flex btn btn-ghost btn-sm btn-circle"
              onClick={() => useGroupStore.getState().setSelectedGroup(null)}>
              <X className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      {isGroupMessagesLoading ? (
        <MessageSkeleton />
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {groupMessages.map((message) => {
            const isOwn = (message.senderId?._id || message.senderId) === authUser._id;
            const sender = message.senderId;
            return (
              <div key={message._id} className={`chat group ${isOwn ? "chat-end" : "chat-start"}`}>
                <div className="chat-image avatar">
                  <div className="size-10 rounded-full border">
                    <img src={sender?.profilePic || "/avatar.png"} alt="avatar" />
                  </div>
                </div>
                <div className="chat-header mb-1 flex items-center gap-2">
                  {!isOwn && <span className="text-xs font-medium text-primary">{sender?.fullName}</span>}
                  <time className="text-xs opacity-50">{formatMessageTime(message.createdAt)}</time>
                </div>

                <div className={`flex items-end gap-1 ${isOwn ? "flex-row-reverse" : "flex-row"}`}>
                  <div className="chat-bubble flex flex-col max-w-xs lg:max-w-sm">
                    {message.replyTo && <ReplyPreview replyTo={message.replyTo} />}
                    {message.image && <img src={message.image} alt="Attachment" className="max-w-[200px] rounded-md mb-1" />}
                    {message.fileUrl && (
                      <FileAttachment fileUrl={message.fileUrl} fileType={message.fileType}
                        fileName={message.fileName} fileSize={message.fileSize} />
                    )}
                    {message.text && <p>{message.text}</p>}
                  </div>
                  <button onClick={() => setReplyingTo(message)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity btn btn-ghost btn-xs btn-circle"
                    title="Reply">
                    <CornerUpLeft className="size-3" />
                  </button>
                </div>

                <ReactionBar reactions={message.reactions || []} onReact={handleReact}
                  messageId={message._id} authUserId={authUser._id} />
              </div>
            );
          })}

          {/* Typing indicator */}
          {isGroupTyping && (
            <div className="chat chat-start">
              <div className="chat-bubble bg-base-300 text-base-content flex items-center gap-1 py-3 px-4">
                <span className="text-xs opacity-60 mr-1">{typingMember?.fullName || "Someone"}</span>
                <span className="animate-bounce" style={{ animationDelay: "0ms" }}>•</span>
                <span className="animate-bounce" style={{ animationDelay: "150ms" }}>•</span>
                <span className="animate-bounce" style={{ animationDelay: "300ms" }}>•</span>
              </div>
            </div>
          )}
          <div ref={messageEndRef} />
        </div>
      )}

      <MessageInput store="group" groupId={selectedGroup._id} />

      {showInfo && (
        <GroupInfoModal group={selectedGroup} onClose={() => setShowInfo(false)} />
      )}
    </div>
  );
};

export default GroupChatContainer;
