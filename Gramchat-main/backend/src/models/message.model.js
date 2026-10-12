import mongoose from "mongoose";

const reactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  emoji: { type: String, required: true },
});

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
    },
    text: { type: String },
    image: { type: String },
    fileUrl: { type: String },
    fileType: { type: String },
    fileName: { type: String },
    fileSize: { type: Number },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    reactions: [reactionSchema],
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ── Indexes for fast message fetching ────────────────────────────────────────
// Speeds up getMessages (DM conversation queries)
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: 1 });
messageSchema.index({ receiverId: 1, senderId: 1, createdAt: 1 });

// Speeds up markMessagesAsRead
messageSchema.index({ senderId: 1, receiverId: 1, isRead: 1 });

// Speeds up group message fetching
messageSchema.index({ groupId: 1, createdAt: 1 });

const Message = mongoose.model("Message", messageSchema);
export default Message;
