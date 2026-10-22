import mongoose from "mongoose";

// One document per pair of people. `pending` until the recipient accepts.
const contactSchema = new mongoose.Schema(
  {
    requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    pairKey: { type: String, required: true, unique: true }, // "<smallerId>:<largerId>"
    status: { type: String, enum: ["pending", "accepted"], default: "pending" },
    // Phase 2D: disappearing messages for this 1:1 chat. Seconds new messages live (0 = off); either person can change it.
    disappearAfter: { type: Number, default: 0 },
    disappearSetBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);
contactSchema.index({ requester: 1, status: 1 });
contactSchema.index({ recipient: 1, status: 1 });

export default mongoose.model("Contact", contactSchema);
