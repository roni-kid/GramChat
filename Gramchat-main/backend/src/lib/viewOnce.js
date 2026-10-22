// View-once media (Phase 2E): a photo, video or voice note the recipient can open ONE time.
//
// How it stays "once":
//  * The file is stored under a name starting with "v" (see storage.js). The normal upload route refuses those names, and
//    message payloads never contain the file's URL (see forViewer in messageOps.js).
//  * To look at it the recipient asks POST /messages/view-once/:id/open. The server records the view, and answers with a
//    short-lived link signed for THAT person (HMAC over message, user, file and expiry; served by routes/upload.route.js).
//  * When the viewer closes it (DM) or everyone has seen it (group), the file is deleted from disk. If nobody ever opens it,
//    or someone opens it and never presses close, the sweeper (lib/disappearing.js) deletes it at `wipeAt` anyway.
//
// What it can NOT do (say this to users, don't hide it): stop a screenshot, a screen recording, a photo of the screen, or a
// modified client that saves the file while the link is valid. It stops the normal "save / forward / open again" paths.
import crypto from "crypto";
import Message from "../models/message.model.js";
import Group from "../models/group.model.js";
import { deleteUpload } from "./storage.js";
import { emitToConversation } from "./messageOps.js";

export const UNOPENED_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // never opened: the file is removed after 14 days
export const LINK_TTL_MS = 5 * 60 * 1000;                    // how long the signed link works after opening
export const WIPE_AFTER_OPEN_MS = 6 * 60 * 1000;             // safety net: file removed this long after the (last) open even if "close" was never pressed
export const VIEW_FILE_RE = /^v[a-f0-9]{32}\.[a-z0-9]{2,5}$/;

const same = (a, b) => !!a && !!b && a.toString() === b.toString();

// A key derived from JWT_SECRET (required at startup), separate from the login signing key
const key = () => crypto.createHash("sha256").update(`gramchat-view-once:${process.env.JWT_SECRET}`).digest();

/** A link token for `file`, valid for `userId` only, for `ttlMs`. */
export const signViewLink = ({ messageId, userId, file, ttlMs = LINK_TTL_MS }) => {
  const body = Buffer.from(JSON.stringify({ m: String(messageId), u: String(userId), f: file, e: Date.now() + ttlMs })).toString("base64url");
  const sig = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${sig}`;
};

/** The payload { m, u, f, e } of a valid, unexpired token, or null. */
export const verifyViewLink = (token) => {
  if (typeof token !== "string" || token.length > 600) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  const want = Buffer.from(crypto.createHmac("sha256", key()).update(body).digest("base64url"));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p || typeof p.e !== "number" || p.e < Date.now() || typeof p.u !== "string" || !VIEW_FILE_RE.test(p.f)) return null;
    return p;
  } catch {
    return null;
  }
};

/** The stored public path of a view-once message's media (photos live in `image`, videos and voice notes in `fileUrl`). */
export const mediaFileOf = (m) => (m.viewOnceKind === "image" ? m.image : m.fileUrl);

/** Everyone in the message's group except the sender (current members only). */
export const otherMemberIds = async (m) => {
  const g = await Group.findById(m.groupId).select("members").lean();
  return (g?.members || []).filter((id) => !same(id, m.senderId));
};

/** Deletes the media of a view-once message from disk and from the row (the row stays as an "Opened" / "Expired" placeholder),
 *  then tells the chat. Safe to call twice. Returns whether this call did the wipe. */
export const wipeViewOnceMedia = async (msg) => {
  const doc = await Message.findOneAndUpdate(
    { _id: msg._id, viewOnce: true, mediaWiped: { $ne: true } },
    { $set: { mediaWiped: true }, $unset: { image: 1, fileUrl: 1, fileType: 1, fileName: 1, fileSize: 1, wipeAt: 1 } },
    { new: false } // hand back the row as it was, so we know which files to delete
  );
  if (!doc) return false;
  [doc.image, doc.fileUrl].forEach((f) => f && deleteUpload(f));
  emitToConversation(doc, "messageViewWiped", { messageId: doc._id.toString() });
  return true;
};
