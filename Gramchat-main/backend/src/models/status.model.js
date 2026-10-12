import mongoose from "mongoose";

const statusSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Either text or image status
    text: {
      type: String,
    },
    image: {
      type: String,
    },
    // Background color for text statuses
    bgColor: {
      type: String,
      default: "#1a1a2e",
    },
    // List of userIds who viewed this status
    viewedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Expires 24 hours after creation
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: { expires: 0 }, // MongoDB TTL index auto-deletes
    },
  },
  { timestamps: true }
);

const Status = mongoose.model("Status", statusSchema);
export default Status;
