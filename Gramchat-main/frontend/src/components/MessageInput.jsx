import { useRef, useState } from "react";
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import { useGroupStore } from "../store/useGroupStore";
import {
  Image, Send, Smile, X, FileText, Film, CornerUpLeft, Paperclip,
} from "lucide-react";
import toast from "react-hot-toast";

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
  const [text, setText] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const [fileData, setFileData] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeCategory, setActiveCategory] = useState("😀");
  const [emojiSearch, setEmojiSearch] = useState("");
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const chatStore = useChatStore();
  // FIX: use static import — require() does not exist in ESM/Vite
  const groupStore = useGroupStore();
  const { replyingTo, clearReplyingTo } = store === "dm" ? chatStore : groupStore;

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
      const payload = {
        text: text.trim(),
        image: imagePreview,
        fileUrl:   fileData?.base64 || null,
        fileName:  fileData?.name   || null,
      };

      const ok = store === "dm"
        ? await chatStore.sendMessage(payload)
        : await useGroupStore.getState().sendGroupMessage(groupId, payload);

      // keep what the user typed if the send failed, so nothing is lost
      if (ok) {
        setText("");
        setImagePreview(null);
        setFileData(null);
        if (imageInputRef.current) imageInputRef.current.value = "";
        if (fileInputRef.current)  fileInputRef.current.value  = "";
      }
    } catch (error) {
      console.error("Failed to send message:", error);
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

      <form onSubmit={handleSendMessage} className="flex items-center gap-2">
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

        {/* Send */}
        <button type="submit" className="btn btn-circle btn-sm btn-primary"
          disabled={!text.trim() && !imagePreview && !fileData}>
          <Send size={18} />
        </button>
      </form>
    </div>
  );
};

export default MessageInput;
