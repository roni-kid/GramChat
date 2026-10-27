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
    // Expires 24 hours after creation. Lists already hide anything past this time; the sweeper (lib/disappearing.js) deletes the row
    // AND its picture file shortly after. (A MongoDB TTL index used to delete the rows by itself, which left the pictures on disk forever.
    // The plain index below is created by lib/migrate.js, which also drops the old TTL index.)
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true, autoIndex: false }
);

const Status = mongoose.model("Status", statusSchema);
export default Status;
