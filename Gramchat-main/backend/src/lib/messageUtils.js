import Message from "../models/message.model.js";
import { saveDataUrl, kindOf } from "./storage.js";
import { isId } from "../middleware/validate.js";
import { UNOPENED_EXPIRY_MS } from "./viewOnce.js";

export const MAX_TEXT = 10000;
export const MAX_VOICE_SECONDS = 15 * 60; // hard server cap (the app records up to 5 min)
export const POPULATE_REPLY = "text image fileName senderId deletedForEveryone voice";

// ── Idempotent sends (Phase 2C) ──
// The app gives every outgoing message a random clientId and re-sends it with the same one until the server confirms.
// If the first attempt actually got through (only the answer was lost), the retry gets the original message back.
export const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Reads the optional `clientId` from a request body. Returns { clientId } (maybe undefined) or { error }. */
export const readClientId = (body) => {
  const v = body?.clientId;
  if (v == null) return { clientId: undefined };
  return typeof v === "string" && CLIENT_ID_RE.test(v) ? { clientId: v } : { error: "Invalid clientId" };
};

/** The message this sender already sent under this clientId (a mongoose document), or null. */
export const findSentByClientId = (senderId, clientId) => (clientId ? Message.findOne({ senderId, clientId }) : null);

export const isDuplicateKeyError = (e) => e?.code === 11000;

const dataUrlMime = (s) => (typeof s === "string" ? s.match(/^data:([a-z0-9.+\-/]+);base64,/i)?.[1]?.toLowerCase() : undefined);

/** Validates the common body of a DM/group message and stores any attachment on local disk.
 *  Returns { error } or { fields } ready for `new Message(...)`.
 *  `viewOnce: true` (Phase 2E) turns one photo, video or voice note into a view-once message: no caption, no reply, the file is
 *  stored under a "v…" name that is only ever served through a signed one-time link (see lib/viewOnce.js). */
export const buildMessageFields = async (body = {}) => {
  const { text, image, fileUrl, fileName, replyToId, voice, voiceDuration, viewOnce } = body;
  if (text != null && typeof text !== "string") return { error: "Invalid text" };
  const cleanText = (text || "").trim();
  if (cleanText.length > MAX_TEXT) return { error: `Message too long (max ${MAX_TEXT} characters)` };
  if (!cleanText && !image && !fileUrl) return { error: "Message can't be empty" };
  if (voice != null && voice !== true) return { error: "Invalid voice message" };
  if (voice && (!fileUrl || image)) return { error: "A voice message needs exactly one audio recording" };
  if (viewOnce != null && viewOnce !== true) return { error: "Invalid view-once flag" };

  // View-once: exactly one photo, one video or one voice note; nothing else rides along
  let viewOnceKind;
  if (viewOnce) {
    if (replyToId) return { error: "View-once messages can't be replies" };
    if (image && fileUrl) return { error: "A view-once message holds exactly one photo, video or voice note" };
    const mime = dataUrlMime(fileUrl);
    if (image) viewOnceKind = "image";
    else if (voice && mime?.startsWith("audio/")) viewOnceKind = "audio";
    else if (!voice && mime?.startsWith("video/")) viewOnceKind = "video";
    else return { error: "View-once works for photos, videos and voice notes" };
  }
  const prefix = viewOnce ? "v" : "";

  const fields = { text: voice || viewOnce ? undefined : cleanText || undefined };
  if (image) {
    const saved = await saveDataUrl(image, { maxBytes: 10 * 1024 * 1024, only: "image/", prefix });
    fields.image = saved.url;
  }
  if (fileUrl) {
    // A voice note must really be audio (the "voice" flag alone proves nothing)
    const saved = await saveDataUrl(fileUrl, { maxBytes: voice ? 10 * 1024 * 1024 : 20 * 1024 * 1024, only: voice ? "audio/" : undefined, prefix });
    fields.fileUrl = saved.url;
    fields.fileType = kindOf(saved.mime);
    fields.fileSize = saved.size;
    fields.fileName = voice ? "Voice message" : typeof fileName === "string" ? fileName.replace(/[\r\n]/g, " ").slice(0, 200) : "file";
    if (voice) {
      fields.voice = true;
      const d = Number(voiceDuration);
      if (Number.isFinite(d) && d > 0) fields.voiceDuration = Math.min(Math.round(d), MAX_VOICE_SECONDS);
    }
  }
  if (viewOnce) {
    fields.viewOnce = true;
    fields.viewOnceKind = viewOnceKind;
    fields.wipeAt = new Date(Date.now() + UNOPENED_EXPIRY_MS); // never opened: the file is removed after 14 days
    if (!voice && fields.fileName) fields.fileName = "View-once media"; // the original file name is nobody's business
  }
  if (replyToId) {
    if (!isId(replyToId)) return { error: "Invalid reply target" };
    fields.replyTo = replyToId;
  }
  return { fields };
};

/** A reply must point at a message in the same conversation (and never at a view-once message: a quote would leak it). */
export const replyBelongsTo = async (replyToId, conv) => {
  if (!replyToId) return true;
  const m = await Message.findById(replyToId).select("senderId receiverId groupId viewOnce").lean();
  if (!m || m.viewOnce) return false;
  if (conv.groupId) return m.groupId?.toString() === conv.groupId.toString();
  const pair = [conv.a.toString(), conv.b.toString()];
  return !m.groupId && pair.includes(m.senderId.toString()) && pair.includes(m.receiverId?.toString());
};
