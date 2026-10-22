import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // Public identity. Lowercase, 3-20 chars: letters, digits, underscore, starting with a letter.
    // (Its unique index is created by lib/migrate.js, after legacy accounts have been given usernames.)
    username: { type: String, required: true, lowercase: true, trim: true },
    // Optional and no longer unique: kept so accounts created before usernames can still log in with their email.
    email: { type: String, lowercase: true, trim: true },
    fullName: { type: String, required: true, trim: true, maxlength: 60 },
    password: { type: String, required: true, minlength: 6 },
    profilePic: { type: String, default: "" },
    privacy: {
      showOnline: { type: Boolean, default: true }, // contacts can see when I'm online
      statusAudience: { type: String, enum: ["contacts", "nobody"], default: "contacts" },
      readReceipts: { type: Boolean, default: true }, // reciprocal, like WhatsApp
      linkPreviews: { type: Boolean, default: true }, // the server fetches a preview for links I send
    },
  },
  { timestamps: true, autoIndex: false }
);

const User = mongoose.model("User", userSchema);
export default User;
