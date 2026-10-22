import mongoose from "mongoose";

// Per-person settings for one chat: pinned to the top of the list, archived, muted.
// Private to each user (the other person never learns you muted or archived them). A row only exists while at least
// one of the three is set; when everything is back to normal the row is deleted.
const chatPrefSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["user", "group"], required: true }, // "user" = the 1:1 chat with that contact
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true }, // the contact's id, or the group's id
    pinnedAt: { type: Date },
    archived: { type: Boolean, default: false },
    mutedUntil: { type: Date }, // "always" is stored as a date far in the future (see lib/chatPrefs.js)
  },
  { timestamps: true }
);

chatPrefSchema.index({ userId: 1, kind: 1, targetId: 1 }, { unique: true });
// push notifications look up "who muted this chat" by chat
chatPrefSchema.index({ kind: 1, targetId: 1, mutedUntil: 1 });

const ChatPref = mongoose.model("ChatPref", chatPrefSchema);
export default ChatPref;
