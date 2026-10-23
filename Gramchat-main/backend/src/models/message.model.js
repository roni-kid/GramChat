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
    // Phase 2A: delivery, edit, delete, forward, star, pin
    deliveredAt: { type: Date },                                   // DMs: when the recipient's device received it
    editedAt: { type: Date },
    forwarded: { type: Boolean, default: false },
    deletedForEveryone: { type: Boolean, default: false },         // tombstone: content is wiped, the row stays
    deletedAt: { type: Date },
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // "delete for me" (never sent to clients)
    starredBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],  // per-user; clients only see `starred: boolean`
    pinnedAt: { type: Date },
    pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Voice notes: an audio file in `fileUrl` plus these
    voice: { type: Boolean, default: false },
    voiceDuration: { type: Number }, // seconds, as measured by the recorder
    // Phase 2C: idempotency key picked by the sender's app. A retried send with the same key returns the original
    // message instead of creating a duplicate. Unique per sender (see the index below).
    clientId: { type: String },

    // Phase 2D: link previews, disappearing messages, view-once
    // Preview of the first link in `text`, fetched by the SERVER (never by a recipient's device). Image is a local upload.
    linkPreview: {
      type: new mongoose.Schema({ url: String, title: String, description: String, siteName: String, image: String }, { _id: false }),
    },
    // When set, the sweeper deletes the message (and its files) at this time. Unset = keeps forever.
    expiresAt: { type: Date },
    // View-once: media (photo / video / voice note) the recipient can open one time. The media URL is never put in
    // message payloads: it is handed out by POST /messages/view-once/:id/open as a short-lived signed link.
    viewOnce: { type: Boolean },
    viewOnceKind: { type: String, enum: ["image", "video", "audio"] },
    views: {
      type: [new mongoose.Schema({
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        at: { type: Date, required: true },
        closedAt: { type: Date },
      }, { _id: false })],
      default: undefined,
    },
    mediaWiped: { type: Boolean }, // the view-once file is gone from the server
    wipeAt: { type: Date },        // when the file is removed even if nobody pressed "close"

    // Phase 2F
    // Voice-note waveform: 16 to 128 integers 0..100, computed by the sender's app (cosmetic only)
    voiceWaveform: { type: [Number], default: undefined },
    // "Keep": someone in the chat kept this disappearing message, so it no longer expires (expiresAt is removed while kept)
    keptBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    keptAt: { type: Date },
    // GROUP messages only: who has received / read it (1:1 messages use deliveredAt and isRead). Never sent to clients as is:
    // the sender gets counts (`ticks`) and, through "Message info", the people (read times are hidden for people with read receipts off).
    deliveredTo: {
      type: [new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, at: { type: Date, required: true } }, { _id: false })],
      default: undefined,
    },
    readBy: {
      type: [new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, at: { type: Date, required: true } }, { _id: false })],
      default: undefined,
    },
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

// Phase 2A: starred list, pinned bar, delivery sweep on reconnect
messageSchema.index({ starredBy: 1, createdAt: -1 });
messageSchema.index({ groupId: 1, pinnedAt: 1 });
messageSchema.index({ receiverId: 1, deliveredAt: 1 });

// Phase 2C: one message per (sender, clientId). Partial, so older messages without a clientId aren't indexed.
messageSchema.index({ senderId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: "string" } } });

// Phase 2D: the sweeper looks these up by time (partial: only messages that have the field are indexed)
messageSchema.index({ expiresAt: 1 }, { partialFilterExpression: { expiresAt: { $type: "date" } } });
messageSchema.index({ wipeAt: 1 }, { partialFilterExpression: { wipeAt: { $type: "date" } } });

const Message = mongoose.model("Message", messageSchema);
export default Message;
