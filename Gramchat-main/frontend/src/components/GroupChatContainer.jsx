import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGroupStore } from "../store/useGroupStore";
import { useAuthStore } from "../store/useAuthStore";
import { formatMessageTime } from "../lib/utils";
import { timerLabel, groupTick } from "../lib/messageRules";
import DisappearingModal from "./DisappearingModal";
import MessageInfoModal from "./MessageInfoModal";
import ViewOnceBubble from "./ViewOnceBubble";
import MessageInput from "./MessageInput";
import { REACTION_EMOJIS } from "../constants/emoji";
import MessageSkeleton from "./Skeletons/MessageSkeleton";
import GroupInfoModal from "./GroupInfoModal";
import { ArrowLeft, Info, FileText, Film, Download, CornerUpLeft, Images, Timer, X } from "lucide-react";
import toast from "react-hot-toast";
import MessageMenu from "./MessageMenu";
import PinnedBar from "./PinnedBar";
import VoiceMessage from "./VoiceMessage";
import { MessageFlags, ForwardedLabel, DeletedNote, InlineEditor, PendingFooter, LinkPreviewCard } from "./MessageParts";
import MediaGalleryModal from "./MediaGalleryModal";
import { useOutboxStore, toPendingMessage } from "../store/useOutboxStore";

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
      <p className="truncate">{replyTo.deletedForEveryone ? "🚫 This message was deleted" : replyTo.text || (replyTo.image ? "📷 Photo" : replyTo.fileName || "Attachment")}</p>
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
    getGroupMessages, addGroupReaction, isGroupTyping, groupTypingUser, setReplyingTo, pinned, getPinned, togglePin,
    hasMore, isLoadingOlder, loadOlder, loadUntil,
  } = useGroupStore();
  const { authUser, onlineUsers } = useAuthStore();
  const messageEndRef = useRef(null);
  const messageRefs = useRef({});
  const scrollRef = useRef(null);
  const scrollAnchor = useRef(null); // scroll position to restore after older messages are added above
  const lastTop = useRef(0);
  const [showInfo, setShowInfo] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showTimer, setShowTimer] = useState(false);
  const [infoFor, setInfoFor] = useState(null); // the message whose "Message info" is open (from the ticks under it)
  const [editingId, setEditingId] = useState(null);
  const [flashId, setFlashId] = useState(null); // the message a search result or gallery tap just jumped to
  const focus = useGroupStore((s) => s.focus);

  const groupId = selectedGroup?._id;

  // Messages still in the send queue are shown at the end of the chat
  const outbox = useOutboxStore((s) => s.items);
  const pendingMsgs = useMemo(
    () => outbox
      .filter((i) => i.kind === "group" && i.targetId === groupId && !groupMessages.some((m) => m.clientId === i.clientId))
      .map((i) => toPendingMessage(i, authUser)),
    [outbox, groupMessages, groupId, authUser]
  );
  const shown = useMemo(() => [...groupMessages, ...pendingMsgs], [groupMessages, pendingMsgs]);
  const lastShownId = shown[shown.length - 1]?._id;
  const lastHasPreview = !!shown[shown.length - 1]?.linkPreview; // the card arrives after the message and makes it taller
  useEffect(() => {
    if (groupId) {
      getGroupMessages(groupId).then(() => useGroupStore.getState().markRead(groupId)); // opening the group reads it
      getPinned(groupId);
      setEditingId(null);
    }
  }, [groupId, getGroupMessages, getPinned]);

  // Jump to a message (a pin, a search result, a gallery item). If it's older than what's loaded, load older pages until it's there.
  // Returns whether it was found.
  const jumpToMessage = async (id, createdAtHint) => {
    if (!messageRefs.current[id]) {
      const createdAt = createdAtHint || pinned.find((p) => p._id === id)?.createdAt;
      if (createdAt) {
        await loadUntil(createdAt);
        await new Promise((r) => setTimeout(r, 60)); // let the new messages render
      }
    }
    const el = messageRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }
    toast("Couldn't find that message");
    return false;
  };

  // A search result or the media gallery asked for a message: scroll to it once the group has loaded, then flash it
  const jumpRef = useRef(null);
  useEffect(() => { jumpRef.current = jumpToMessage; });
  useEffect(() => {
    if (!focus || isGroupMessagesLoading || useGroupStore.getState().isGroupMessagesLoading) return; // runs again when loading ends
    let alive = true;
    (async () => {
      await new Promise((r) => setTimeout(r, 150)); // let the first page render (and its own scroll-to-bottom finish)
      const found = await jumpRef.current(focus.id, focus.createdAt);
      if (!alive) return;
      if (found) setFlashId(focus.id);
      useGroupStore.getState().clearFocus();
    })();
    return () => { alive = false; };
  }, [focus, isGroupMessagesLoading]);
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 2200);
    return () => clearTimeout(t);
  }, [flashId]);

  // Infinite scroll (see ChatContainer): only upward scrolling near the top loads older messages
  const onScroll = (e) => {
    const el = e.currentTarget;
    const goingUp = el.scrollTop < lastTop.current;
    lastTop.current = el.scrollTop;
    if (!goingUp || el.scrollTop > 120 || !hasMore || isLoadingOlder) return;
    scrollAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
    loadOlder().then((added) => { if (!added) scrollAnchor.current = null; });
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!scrollAnchor.current || !el) return;
    el.scrollTop = scrollAnchor.current.top + (el.scrollHeight - scrollAnchor.current.height);
    scrollAnchor.current = null;
  }, [groupMessages]);

  // Scroll to the bottom when a new message ends the chat (not when older ones are added at the top)
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastShownId, isGroupTyping, lastHasPreview]);

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
                {selectedGroup.disappearAfter > 0 && (
                  <span className="ml-1 inline-flex items-center gap-0.5" title={`New messages disappear after ${timerLabel(selectedGroup.disappearAfter)}`}>
                    · <Timer className="size-3" aria-hidden="true" /> {timerLabel(selectedGroup.disappearAfter)}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-1">
            <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setShowTimer(true)} title="Disappearing messages" aria-label="Disappearing messages">
              <Timer className={`size-4 ${selectedGroup.disappearAfter > 0 ? "text-primary" : ""}`} />
            </button>
            <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setShowGallery(true)} title="Media, links and docs" aria-label="Media, links and docs">
              <Images className="size-4" />
            </button>
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

      {/* Pinned messages */}
      <PinnedBar pinned={pinned} onJump={jumpToMessage} onUnpin={(id) => togglePin(id, false)} />

      {/* Messages */}
      {isGroupMessagesLoading ? (
        <MessageSkeleton />
      ) : (
        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoadingOlder && (
            <div className="text-center"><span className="loading loading-spinner loading-xs" aria-label="Loading older messages" /></div>
          )}
          {shown.map((message) => {
            const isOwn = (message.senderId?._id || message.senderId) === authUser._id;
            const sender = message.senderId;
            return (
              <div key={message._id} ref={(el) => (messageRefs.current[message._id] = el)} className={`chat group ${isOwn ? "chat-end" : "chat-start"}`}>
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
                  <div className={`chat-bubble flex flex-col max-w-xs lg:max-w-sm ${flashId === message._id ? "ring-2 ring-primary ring-offset-1" : ""}`}>
                    {message.deletedForEveryone ? (
                      <DeletedNote isOwn={isOwn} />
                    ) : (
                      <>
                        <ForwardedLabel message={message} />
                        {/* View-once: a placeholder; the media itself is only ever fetched when a member opens it */}
                        {message.viewOnce && <ViewOnceBubble message={message} isOwn={isOwn} store="group" />}
                        {message.replyTo && <ReplyPreview replyTo={message.replyTo} />}
                        {message.image && <img src={message.image} alt="Attachment" className="max-w-[200px] rounded-md mb-1" />}
                        {message.fileUrl && (
                          message.voice ? (
                            <VoiceMessage message={message} />
                          ) : (
                            <FileAttachment fileUrl={message.fileUrl} fileType={message.fileType}
                              fileName={message.fileName} fileSize={message.fileSize} />
                          )
                        )}
                        {editingId === message._id ? (
                          <InlineEditor message={message} store="group" onDone={() => setEditingId(null)} />
                        ) : (
                          message.text && <p>{message.text}</p>
                        )}
                        {message.linkPreview && editingId !== message._id && <LinkPreviewCard preview={message.linkPreview} />}
                        <MessageFlags message={message} />
                      </>
                    )}
                  </div>
                  {!message.deletedForEveryone && !message.viewOnce && !message.pending && (
                    <button onClick={() => setReplyingTo(message)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity btn btn-ghost btn-xs btn-circle"
                      title="Reply">
                      <CornerUpLeft className="size-3" />
                    </button>
                  )}
                  {!message.pending && <MessageMenu message={message} isOwn={isOwn} store="group" onReply={setReplyingTo} onEdit={(m) => setEditingId(m._id)} />}
                </div>

                <PendingFooter message={message} />
                {/* Per-member ticks (Phase 2F): tap for who received / read it */}
                {isOwn && !message.pending && !message.deletedForEveryone && (() => {
                  const tick = groupTick(message.ticks);
                  return (
                    <button type="button" onClick={() => setInfoFor(message)} title="Message info"
                      className={`chat-footer text-xs mt-0.5 text-left hover:underline ${tick.state === "read" ? "text-primary opacity-90" : "opacity-50"}`}>
                      {tick.label}
                    </button>
                  );
                })()}
                {!message.deletedForEveryone && !message.pending && (
                  <ReactionBar reactions={message.reactions || []} onReact={handleReact}
                    messageId={message._id} authUserId={authUser._id} />
                )}
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

      <MessageInput key={selectedGroup._id} store="group" groupId={selectedGroup._id} />

      {infoFor && <MessageInfoModal message={groupMessages.find((m) => m._id === infoFor._id) || infoFor} onClose={() => setInfoFor(null)} />}
      {showTimer && (
        <DisappearingModal
          title={selectedGroup.name}
          current={selectedGroup.disappearAfter || 0}
          canChange={(selectedGroup.admin?._id || selectedGroup.admin) === authUser._id}
          who="You're the group admin, so you can change this."
          onPick={(seconds) => useGroupStore.getState().setDisappearing(selectedGroup._id, seconds)}
          onClose={() => setShowTimer(false)}
        />
      )}
      {showInfo && (
        <GroupInfoModal group={selectedGroup} onClose={() => setShowInfo(false)} />
      )}
      {showGallery && (
        <MediaGalleryModal
          kind="group"
          chatId={selectedGroup._id}
          title={selectedGroup.name}
          onShow={(m) => useGroupStore.getState().setFocus({ id: m._id, createdAt: m.createdAt })}
          onClose={() => setShowGallery(false)}
        />
      )}
    </div>
  );
};

export default GroupChatContainer;
