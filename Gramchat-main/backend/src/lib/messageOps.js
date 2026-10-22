// Shared helpers for acting on an existing message (edit, delete, star, pin, forward).
// Keep EDIT_WINDOW_MS / DELETE_FOR_EVERYONE_MS in sync with frontend/src/lib/messageRules.js (the server is the authority).
import Message from "../models/message.model.js";
import Group from "../models/group.model.js";
import { emitToUser, emitToGroup } from "./socket.js";

export const EDIT_WINDOW_MS = 15 * 60 * 1000; // sender may edit text for 15 minutes
export const DELETE_FOR_EVERYONE_MS = 48 * 60 * 60 * 1000; // ...and retract for everyone for 48 hours
export const MAX_PINNED = 3; // per conversation; pinning a 4th replaces the oldest pin
export const MAX_FORWARD_TARGETS = 5;

const same = (a, b) => !!a && !!b && a.toString() === b.toString();

/** Loads a message only if `userId` may see it: a participant of the DM / a member of the group,
 *  and the message was not deleted "for me". Returns the mongoose document or null (callers answer 404,
 *  so existence of other people's messages is never revealed). */
export const loadAccessible = async (messageId, userId) => {
  const m = await Message.findById(messageId);
  if (!m) return null;
  if (m.deletedFor?.some((id) => same(id, userId))) return null;
  if (m.expiresAt && new Date(m.expiresAt).getTime() <= Date.now()) return null; // disappeared (the sweeper deletes the row a moment later)
  if (m.groupId) {
    if (!(await Group.exists({ _id: m.groupId, members: userId }))) return null;
  } else if (!same(m.senderId, userId) && !same(m.receiverId, userId)) {
    return null;
  }
  return m;
};

/** Mongo filter matching every message of the same conversation as `m`. */
export const conversationFilter = (m) =>
  m.groupId
    ? { groupId: m.groupId }
    : { groupId: null, $or: [{ senderId: m.senderId, receiverId: m.receiverId }, { senderId: m.receiverId, receiverId: m.senderId }] };

/** Sends a socket event to everyone in the conversation (both people in a DM, the room in a group). */
export const emitToConversation = (m, event, payload) => {
  if (m.groupId) emitToGroup(m.groupId, event, { ...payload, groupId: m.groupId.toString() });
  else {
    emitToUser(m.senderId, event, payload);
    emitToUser(m.receiverId, event, payload);
  }
};

// Fields wiped when a message is retracted for everyone (the row stays as a "This message was deleted" tombstone)
export const WIPE_FIELDS = {
  text: 1, image: 1, fileUrl: 1, fileType: 1, fileName: 1, fileSize: 1, voice: 1, voiceDuration: 1, replyTo: 1, pinnedAt: 1, pinnedBy: 1, editedAt: 1, linkPreview: 1,
  viewOnce: 1, viewOnceKind: 1, views: 1, mediaWiped: 1, wipeAt: 1, // a retracted view-once message is an ordinary tombstone
};

/** What a client may see: per-user data collapses to `starred: boolean`, private arrays are removed, tombstones carry no content. */
export const forViewer = (msg, viewerId) => {
  const o = typeof msg.toObject === "function" ? msg.toObject() : { ...msg };
  o.starred = (o.starredBy || []).some((id) => same(id, viewerId));
  delete o.starredBy;
  delete o.deletedFor;
  // The idempotency key is the sender's business: only the sender's own devices get it back
  if (!same(o.senderId?._id ?? o.senderId, viewerId)) delete o.clientId;
  if (o.deletedForEveryone) {
    for (const k of Object.keys(WIPE_FIELDS)) delete o[k];
    o.reactions = [];
  } else if (o.viewOnce) {
    // View-once: the media (and its file name, size, URL) is NEVER part of a payload; it is only handed out by
    // POST /messages/view-once/:id/open. Clients get a state to draw the placeholder with:
    //   unopened | opened | expired (the file was removed before this person opened it)
    // The sender also gets `viewCount` (how many people opened it); everyone gets `viewedByMe`.
    const mine = same(o.senderId?._id ?? o.senderId, viewerId);
    const views = o.views || [];
    const seenByMe = views.some((v) => same(v.userId, viewerId));
    const opened = mine ? views.length > 0 : seenByMe;
    if (mine) o.viewCount = views.length;
    o.viewedByMe = seenByMe;
    o.viewOnceState = opened ? "opened" : o.mediaWiped ? "expired" : "unopened";
    for (const k of ["views", "image", "fileUrl", "fileType", "fileName", "fileSize", "text", "linkPreview", "wipeAt", "mediaWiped"]) delete o[k];
  }
  return o;
};
