// Attaches a link preview to a message AFTER it was sent (the message is delivered immediately; the card follows a moment later
// as a `messagePreview` socket event). All the fetching and the SSRF protection live in lib/linkPreview.js; this file is the
// glue: who may trigger a fetch, limits, saving the thumbnail, and telling the chat.
import Message from "../models/message.model.js";
import { extractFirstUrl, fetchPreview, fetchImage } from "./linkPreview.js";
import { saveBuffer, deleteUpload } from "./storage.js";
import { emitToConversation } from "./messageOps.js";

const PER_USER_PER_MINUTE = 20; // a user can't make the server fetch pages without limit
const MAX_ACTIVE = 8; // and the server never runs more than this many fetches at once (extra links just get no card)

const recent = new Map(); // userId -> timestamps of this minute's fetches
let active = 0;

setInterval(() => {
  const cutoff = Date.now() - 60 * 1000;
  for (const [k, v] of recent) if (!v.some((t) => t > cutoff)) recent.delete(k);
}, 60 * 1000).unref();

const underLimit = (userId) => {
  const now = Date.now();
  const list = (recent.get(userId) || []).filter((t) => t > now - 60 * 1000);
  if (list.length >= PER_USER_PER_MINUTE) {
    recent.set(userId, list);
    return false;
  }
  list.push(now);
  recent.set(userId, list);
  return true;
};

const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

const attach = async (messageId, url) => {
  const p = await fetchPreview(url); // throws on blocked addresses / timeouts; null when the page has nothing to show
  if (!p) return;

  let image;
  if (p.imageUrl) {
    try {
      const img = await fetchImage(p.imageUrl);
      if (img) image = (await saveBuffer(img.buf, img.mime)).url;
    } catch { /* a missing thumbnail is fine: the card just has no picture */ }
  }
  const linkPreview = compact({ url: p.url, title: p.title, description: p.description, siteName: p.siteName, image });

  // The message may have been edited or deleted while we were fetching: only attach if it still starts with this link
  const cur = await Message.findById(messageId).select("text deletedForEveryone linkPreview senderId receiverId groupId");
  const drop = () => { if (image) deleteUpload(image); };
  if (!cur || cur.deletedForEveryone || extractFirstUrl(cur.text) !== url) return drop();
  const oldImage = cur.linkPreview?.image;
  const res = await Message.updateOne({ _id: messageId, text: cur.text, deletedForEveryone: { $ne: true } }, { $set: { linkPreview } });
  if (!res.modifiedCount) return drop();
  if (oldImage && oldImage !== image) deleteUpload(oldImage);
  emitToConversation(cur, "messagePreview", { messageId: messageId.toString(), linkPreview });
};

/** Fire and forget. `msg` needs `_id` and `text`; `sender` is the sending user's document (its privacy.linkPreviews is respected).
 *  Never throws and never delays the send. */
export const schedulePreview = (msg, sender) => {
  try {
    if (!msg?.text || !sender || sender.privacy?.linkPreviews === false) return;
    const url = extractFirstUrl(msg.text);
    if (!url) return;
    if (active >= MAX_ACTIVE || !underLimit(sender._id.toString())) return;
    active++;
    attach(msg._id, url)
      .catch((e) => console.log("link preview skipped:", e.message))
      .finally(() => { active--; });
  } catch (e) {
    console.log("link preview error:", e.message);
  }
};

/** The text of a message changed: drop a preview that no longer matches its first link, and fetch one for a new link. */
export const refreshPreviewAfterEdit = async (msg, sender) => {
  const url = extractFirstUrl(msg.text);
  const old = msg.linkPreview;
  if (old?.url && old.url !== url) {
    const img = old.image;
    await Message.updateOne({ _id: msg._id }, { $unset: { linkPreview: 1 } });
    if (img) deleteUpload(img);
    emitToConversation(msg, "messagePreview", { messageId: msg._id.toString(), linkPreview: null });
  }
  if (url && old?.url !== url) schedulePreview(msg, sender);
};
