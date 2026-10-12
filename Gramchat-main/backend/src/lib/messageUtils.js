import Message from "../models/message.model.js";
import { saveDataUrl, kindOf } from "./storage.js";
import { isId } from "../middleware/validate.js";

export const MAX_TEXT = 10000;
export const POPULATE_REPLY = "text image fileName senderId";

/** Validates the common body of a DM/group message and stores any attachment on local disk.
 *  Returns { error } or { fields } ready for `new Message(...)`. */
export const buildMessageFields = async (body = {}) => {
  const { text, image, fileUrl, fileName, replyToId } = body;
  if (text != null && typeof text !== "string") return { error: "Invalid text" };
  const cleanText = (text || "").trim();
  if (cleanText.length > MAX_TEXT) return { error: `Message too long (max ${MAX_TEXT} characters)` };
  if (!cleanText && !image && !fileUrl) return { error: "Message can't be empty" };

  const fields = { text: cleanText || undefined };
  if (image) {
    const saved = await saveDataUrl(image, { maxBytes: 10 * 1024 * 1024, only: "image/" });
    fields.image = saved.url;
  }
  if (fileUrl) {
    const saved = await saveDataUrl(fileUrl, { maxBytes: 20 * 1024 * 1024 });
    fields.fileUrl = saved.url;
    fields.fileType = kindOf(saved.mime);
    fields.fileSize = saved.size;
    fields.fileName = typeof fileName === "string" ? fileName.replace(/[\r\n]/g, " ").slice(0, 200) : "file";
  }
  if (replyToId) {
    if (!isId(replyToId)) return { error: "Invalid reply target" };
    fields.replyTo = replyToId;
  }
  return { fields };
};

/** A reply must point at a message in the same conversation. */
export const replyBelongsTo = async (replyToId, conv) => {
  if (!replyToId) return true;
  const m = await Message.findById(replyToId).select("senderId receiverId groupId").lean();
  if (!m) return false;
  if (conv.groupId) return m.groupId?.toString() === conv.groupId.toString();
  const pair = [conv.a.toString(), conv.b.toString()];
  return !m.groupId && pair.includes(m.senderId.toString()) && pair.includes(m.receiverId?.toString());
};
