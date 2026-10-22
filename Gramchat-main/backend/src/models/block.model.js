import mongoose from "mongoose";

const blockSchema = new mongoose.Schema(
  {
    blocker: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    blocked: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    key: { type: String, required: true, unique: true }, // "<blocker>:<blocked>"
  },
  { timestamps: true }
);
blockSchema.index({ blocker: 1 });
blockSchema.index({ blocked: 1 });

export default mongoose.model("Block", blockSchema);
