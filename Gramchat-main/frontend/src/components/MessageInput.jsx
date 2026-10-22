import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import { useGroupStore } from "../store/useGroupStore";
import {
  Image, Send, Smile, X, FileText, Film, CornerUpLeft, Paperclip, Mic, Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import { useVoiceRecorder, blobToDataUrl } from "../lib/useVoiceRecorder";
import { formatDuration } from "../lib/utils";
import { useOutboxStore } from "../store/useOutboxStore";
import { useDraftStore } from "../store/useDraftStore";
import { OnceIcon } from "./ViewOnceBubble";

// Drafts are kept per chat. The parents give this component a `key`, so it remounts (and reloads its draft) when the chat changes.
const draftKeyFor = (store, groupId) => (store === "dm" ? `dm:${useChatStore.getState().selectedUser?._id}` : `group:${groupId}`);

const EMOJI_CATEGORIES = {
  "😀": [
    "😀","😁","😂","🤣","😃","😄","😅","😆","😉","😊","😋","😎","😍","🥰","😘",
    "😗","😙","😚","🙂","🤗","🤩","🤔","🤨","😐","😑","😶","🙄","😏","😣","😥",
    "😮","🤐","😯","😪","😫","🥱","😴","😌","😛","😜","😝","🤤","😒","😓","😔",
    "😕","🙃","🤑","😲","☹️","🙁","😖","😞","😟","😤","😢","😭","😦","😧","😨",
    "😩","🤯","😬","😰","😱","🥵","🥶","😳","🤪","😵","🥴","😡","🤬","😷","🤒",
    "🤕","🤢","🤮","🤧","😇","🥳","🥸","🤠","🤡","😈","👿","👹","👺","💀","👻",
  ],
  "👍": [
    "👋","🤚","🖐","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉",
    "👆","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏",
    "✍️","💅","💪","🦾","❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","💕",
    "💞","💓","💗","💖","💝","💘","💟","❣️","💯","💢","💥","💫","💦","💨","💬","💭",
  ],
  "🐶": [
    "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵",
    "🙈","🙉","🙊","🐔","🐧","🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄",
    "🐝","🦋","🐌","🐞","🐜","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦀","🐡",
    "🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🐃",
    "🐄","🐎","🐖","🐏","🐑","🦙","🐐","🦌","🐕","🐩","🐈","🐓","🦃","🦜","🐇",
  ],
  "🍎": [
    "🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥",
    "🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶","🧄","🧅","🥔","🍠","🥐","🥯","🍞",
    "🥖","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🌭","🍔","🍟","🍕",
    "🥪","🥙","🌮","🌯","🥗","🥘","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🍤","🍙",
    "🍚","🍘","🍥","🥮","🍢","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪",
    "☕","🍵","🧃","🥤","🧋","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧉","🍾",
  ],
  "⚽": [
    "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🏓","🏸","🏒","🏑","🥍",
    "🏏","🥅","⛳","🏹","🎣","🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸️","🥌","🎿",
    "⛷️","🏂","🪂","🏋️","🤸","🏄","🚣","🧗","🚵","🚴","🏆","🥇","🥈","🥉","🏅",
    "🎖","🎪","🤹","🎭","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🎷","🎺","🎸","🎻",
    "🎲","♟","🎯","🎳","🎮","🎰","🧩","🧸","♠️","♥️","♦️","♣️",
  ],
  "🚗": [
    "🚗","🚕","🚙","🚌","🏎","🚓","🚑","🚒","🚐","🚚","🚛","🚜","🏍","🛵","🚲",
    "🛴","✈️","🛩","🚁","🚀","🛸","🌍","🌎","🌏","🌐","🗺","🌋","🏔","🏕","🏖",
    "🏜","🏝","🏞","🏟","🏛","🏗","🏘","🏠","🏡","🏢","🏣","🏤","🏥","🏦","🏨",
    "🏩","🏪","🏫","🏬","🏭","🏯","🏰","💒","🗼","🗽","⛪","🕌","⛩","🕋","⛲",
    "⛺","🌁","🌃","🏙","🌄","🌅","🌆","🌇","🌉","🌌","🎠","🎡","🎢","💈","🎪",
  ],
  "💡": [
    "⌚","📱","💻","⌨️","🖥","🖨","🖱","💽","💾","💿","📀","📼","📷","📸","📹",
    "🎥","📞","☎️","📺","📻","🧭","⏱","⏲","⏰","🕰","⌛","⏳","📡","🔋","🔌",
    "💡","🔦","🕯","🛢","💰","💴","💵","💶","💷","💸","💳","🪙","💹","📈","📉",
    "📊","📋","📌","📍","✂️","🔒","🔓","🔑","🗝","🔨","⚒","🛠","⚔️","🔧","🔩",
    "⚙️","⚖️","🔗","🧲","⚗️","🧪","🧫","🧬","🔬","🔭","💉","💊","🩺","🩹","🪥",
  ],
};

const FilePreview = ({ fileType, fileName, fileSize }) => {
  const icon = fileType === "video"
    ? <Film className="size-5 text-primary" />
    : <FileText className="size-5 text-primary" />;
  const sizeStr = fileSize ? `${(fileSize / 1024 / 1024).toFixed(1)} MB` : "";
  return (
    <div className="flex items-center gap-2 bg-base-200 rounded-lg p-2 mb-2">
      {icon}
      <div className="min-w-0">
        <p className="text-xs font-medium truncate">{fileName}</p>
        {sizeStr && <p className="text-xs text-base-content/50">{sizeStr}</p>}
      </div>
    </div>
  );
};

const MessageInput = ({ store = "dm", groupId = null }) => {
  const chatKey = draftKeyFor(store, groupId);
  const [text, setText] = useState(() => useDraftStore.getState().drafts[chatKey]?.text || "");
  const [imagePreview, setImagePreview] = useState(null);
  const [fileData, setFileData] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeCategory, setActiveCategory] = useState("😀");
  const [emojiSearch, setEmojiSearch] = useState("");
  const [viewOnce, setViewOnce] = useState(false);   // the attached photo / video is sent as view-once
  const [voiceOnce, setVoiceOnce] = useState(false); // the voice note being recorded is sent as view-once
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const chatStore = useChatStore();
  // FIX: use static import — require() does not exist in ESM/Vite
  const groupStore = useGroupStore();
  const { replyingTo, clearReplyingTo } = store === "dm" ? chatStore : groupStore;

  // View-once is offered for exactly one photo or video, with no caption and no reply (the server enforces the same rules)
  const canViewOnce = !text.trim() && !replyingTo && !!imagePreview !== !!fileData && (!!imagePreview || fileData?.type === "video");
  const sendViewOnce = viewOnce && canViewOnce;
  useEffect(() => { if (!canViewOnce) setViewOnce(false); }, [canViewOnce]); // the toggle never carries over to the next attachment

  // ── Drafts: save what's typed (shortly after typing stops, and when leaving the chat) ──
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
    const t = setTimeout(() => useDraftStore.getState().setDraft(chatKey, text), 400);
    return () => clearTimeout(t);
  }, [text, chatKey]);
  useEffect(() => () => useDraftStore.getState().setDraft(chatKey, textRef.current), [chatKey]);

  // Hands a message to the send queue: it appears in the chat at once and is sent (and retried if the network drops) from there
  const queueMessage = (data) =>
    useOutboxStore.getState().enqueue(
      store === "dm"
        ? { kind: "dm", targetId: chatStore.selectedUser?._id, data }
        : { kind: "group", targetId: groupId, data }
    );

  // ── Voice notes ──
  const sendVoiceRef = useRef(null);
  const sendingVoice = useRef(false);
  const voice = useVoiceRecorder({ onLimit: () => sendVoiceRef.current?.() });

  const startVoice = async () => {
    try {
      await voice.start();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const sendVoice = async () => {
    if (sendingVoice.current) return;
    sendingVoice.current = true;
    try {
      const rec = await voice.finish();
      if (!rec) return;
      const dataUrl = await blobToDataUrl(rec.blob).catch(() => null);
      if (!dataUrl) return toast.error("Couldn't read the recording");
      const payload = { text: "", fileUrl: dataUrl, fileName: "Voice message", voice: true, voiceDuration: rec.seconds, fileType: "audio", fileSize: rec.blob.size, viewOnce: voiceOnce && !replyingTo ? true : undefined };
      // The queue keeps the recording until it is delivered, so there is nothing to put back if the network is down
      queueMessage(payload);
      setVoiceOnce(false);
    } finally {
      sendingVoice.current = false;
    }
  };
  useEffect(() => { sendVoiceRef.current = sendVoice; });

  const emitTyping = () => {
    const socket = useAuthStore.getState().socket;
    if (!socket) return;
    if (store === "dm") {
      const { selectedUser } = chatStore;
      if (!selectedUser) return;
      socket.emit("typing", { receiverId: selectedUser._id });
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit("stopTyping", { receiverId: selectedUser._id });
      }, 1500);
    } else {
      socket.emit("groupTyping", { groupId });
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit("groupStopTyping", { groupId });
      }, 1500);
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5MB"); return; }
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast.error("File must be under 20MB"); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      const fileType = file.type.startsWith("video/") ? "video"
        : file.type === "application/pdf" ? "pdf"
        : file.type.startsWith("audio/") ? "audio"
        : "document";
      setFileData({ base64: reader.result, type: fileType, name: file.name, size: file.size });
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => { setImagePreview(null); if (imageInputRef.current) imageInputRef.current.value = ""; };
  const removeFile  = () => { setFileData(null);    if (fileInputRef.current)  fileInputRef.current.value  = ""; };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!text.trim() && !imagePreview && !fileData) return;

    const socket = useAuthStore.getState().socket;
    if (socket) {
      if (store === "dm") {
        const { selectedUser } = chatStore;
        if (selectedUser) socket.emit("stopTyping", { receiverId: selectedUser._id });
      } else {
        socket.emit("groupStopTyping", { groupId });
      }
    }
    clearTimeout(typingTimeoutRef.current);
    setShowEmojiPicker(false);

    try {
      const queued = queueMessage({
        text: text.trim(),
        image: imagePreview,
        fileUrl: fileData?.base64 || null,
        fileName: fileData?.name || null,
        voice: fileData?.voice || undefined,
        voiceDuration: fileData?.voiceDuration,
        fileType: fileData?.type,
        fileSize: fileData?.size,
        viewOnce: sendViewOnce || undefined,
      });

      // Only clear the box once the queue has accepted the message, so nothing typed is lost
      if (queued) {
        setText("");
        useDraftStore.getState().setDraft(chatKey, "");
        setViewOnce(false);
        setImagePreview(null);
        setFileData(null);
        if (imageInputRef.current) imageInputRef.current.value = "";
        if (fileInputRef.current)  fileInputRef.current.value  = "";
      }
    } catch (error) {
      console.error("Failed to queue message:", error);
    }
  };

  const getDisplayEmojis = () => {
    if (emojiSearch.trim())
      return Object.values(EMOJI_CATEGORIES).flat().filter((e) => e.includes(emojiSearch));
    return EMOJI_CATEGORIES[activeCategory] || [];
  };

  const handleEmojiClick = (emoji) => {
    setText((prev) => prev + emoji);
    setShowEmojiPicker(false);
    setEmojiSearch("");
  };

  return (
    <div className="p-3 w-full relative">
      {/* Emoji Picker */}
      {showEmojiPicker && (
        <div className="absolute bottom-20 left-3 z-10 bg-base-100 border border-base-300 rounded-2xl shadow-2xl w-80 overflow-hidden">
          <div className="p-2 border-b border-base-300">
            <input
              type="text"
              placeholder="Search emojis..."
              value={emojiSearch}
              onChange={(e) => setEmojiSearch(e.target.value)}
              className="input input-bordered input-xs w-full rounded-full"
              autoFocus
            />
          </div>
          {!emojiSearch && (
            <div className="flex border-b border-base-300 bg-base-200 overflow-x-auto">
              {Object.keys(EMOJI_CATEGORIES).map((cat) => (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  className={`flex-shrink-0 px-3 py-2 text-lg transition-colors hover:bg-base-300 ${activeCategory === cat ? "border-b-2 border-primary bg-base-100" : ""}`}>
                  {cat}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-10 gap-0 p-2 max-h-48 overflow-y-auto">
            {getDisplayEmojis().map((emoji, i) => (
              <button key={i} type="button" onClick={() => handleEmojiClick(emoji)}
                className="text-xl hover:bg-base-300 rounded-lg p-1 transition-colors leading-none aspect-square flex items-center justify-center">
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Reply preview */}
      {replyingTo && (
        <div className="mb-2 flex items-center gap-2 bg-base-200 rounded-xl px-3 py-2 border-l-4 border-primary">
          <CornerUpLeft className="size-4 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-primary font-medium mb-0.5">Replying to message</p>
            <p className="text-xs text-base-content/60 truncate">
              {replyingTo.text || (replyingTo.image ? "📷 Photo" : replyingTo.fileName || "Attachment")}
            </p>
          </div>
          <button onClick={clearReplyingTo} className="btn btn-ghost btn-xs btn-circle flex-shrink-0">
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* Image preview */}
      {imagePreview && (
        <div className="mb-2 flex items-center gap-2">
          <div className="relative">
            <img src={imagePreview} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-base-300" />
            <button onClick={removeImage} type="button"
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-error text-error-content flex items-center justify-center">
              <X className="size-3" />
            </button>
          </div>
        </div>
      )}

      {/* File preview */}
      {fileData && (
        <div className="mb-2 relative">
          <FilePreview fileType={fileData.type} fileName={fileData.name} fileSize={fileData.size} />
          <button onClick={removeFile} type="button"
            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-error text-error-content flex items-center justify-center">
            <X className="size-3" />
          </button>
        </div>
      )}

      {canViewOnce && (
        <button type="button" onClick={() => setViewOnce((v) => !v)} aria-pressed={viewOnce}
          title="They can open it once; it is then deleted from the server"
          className={`btn btn-xs gap-1.5 mb-2 rounded-full ${viewOnce ? "btn-primary" : "btn-ghost border border-base-300"}`}>
          <OnceIcon className="size-4 text-[10px]" /> View once
        </button>
      )}

      {/* Voice recording bar (replaces the text box while recording) */}
      {voice.recording && (
        <div className="flex items-center gap-3 px-1" role="status">
          <button type="button" className="btn btn-circle btn-sm btn-ghost text-error" onClick={() => { setVoiceOnce(false); voice.cancel(); }} title="Discard" aria-label="Discard recording">
            <Trash2 size={18} />
          </button>
          <div className="flex-1 flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-error animate-pulse" />
            <span className="font-mono text-sm">{formatDuration(voice.seconds)}</span>
            <span className="text-xs text-base-content/50">Recording…</span>
          </div>
          {!replyingTo && (
            <button type="button" onClick={() => setVoiceOnce((v) => !v)} aria-pressed={voiceOnce} title="View once" aria-label="View once"
              className={`btn btn-circle btn-sm ${voiceOnce ? "btn-primary" : "btn-ghost"}`}>
              <OnceIcon className="size-5 text-xs" />
            </button>
          )}
          <button type="button" className="btn btn-circle btn-sm btn-primary" onClick={sendVoice} title="Send voice message" aria-label="Send voice message">
            <Send size={18} />
          </button>
        </div>
      )}

      <form onSubmit={handleSendMessage} className={`items-center gap-2 ${voice.recording ? "hidden" : "flex"}`}>
        {/* Emoji */}
        <button type="button"
          className={`btn btn-circle btn-sm btn-ghost ${showEmojiPicker ? "text-primary" : "text-base-content/60"}`}
          onClick={() => { setShowEmojiPicker((v) => !v); setEmojiSearch(""); }}>
          <Smile size={20} />
        </button>

        {/* Text input */}
        <div className="flex-1">
          <input
            type="text"
            className="w-full input input-bordered rounded-full input-sm sm:input-md"
            placeholder="Type a message..."
            maxLength={10000}
            value={text}
            onChange={(e) => { setText(e.target.value); emitTyping(); }}
            onKeyDown={(e) => { if (e.key === "Escape") setShowEmojiPicker(false); }}
          />
        </div>

        {/* Hidden inputs */}
        <input type="file" accept="image/*" className="hidden" ref={imageInputRef} onChange={handleImageChange} />
        <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,video/*,audio/*"
          className="hidden" ref={fileInputRef} onChange={handleFileChange} />

        {/* Image attach */}
        <button type="button"
          className={`btn btn-circle btn-sm btn-ghost ${imagePreview ? "text-emerald-500" : "text-base-content/60"}`}
          onClick={() => imageInputRef.current?.click()}>
          <Image size={20} />
        </button>

        {/* File attach */}
        <button type="button"
          className={`btn btn-circle btn-sm btn-ghost ${fileData ? "text-primary" : "text-base-content/60"}`}
          onClick={() => fileInputRef.current?.click()}>
          <Paperclip size={18} />
        </button>

        {/* Send, or the microphone when there is nothing to send */}
        {text.trim() || imagePreview || fileData ? (
          <button type="submit" className="btn btn-circle btn-sm btn-primary">
            <Send size={18} />
          </button>
        ) : (
          <button type="button" onClick={startVoice} className="btn btn-circle btn-sm btn-primary" title="Record a voice message" aria-label="Record a voice message">
            <Mic size={18} />
          </button>
        )}
      </form>
    </div>
  );
};

export default MessageInput;
