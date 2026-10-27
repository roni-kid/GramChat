import mongoose from "mongoose";
import path from "path";
import User from "../models/user.model.js";
import Group from "../models/group.model.js";
import Message from "../models/message.model.js";
import { emitToUser, emitToGroup, isUserOnline } from "../lib/socket.js";
import { areContacts, getContactIds } from "../lib/relations.js";
import { UploadError, copyUpload, deleteUpload } from "../lib/storage.js";
import { buildMessageFields, replyBelongsTo, readClientId, findSentByClientId, isDuplicateKeyError, filesOfFields, POPULATE_REPLY, MAX_TEXT } from "../lib/messageUtils.js";
import {
  loadAccessible, conversationFilter, emitToConversation, forViewer, WIPE_FIELDS,
  EDIT_WINDOW_MS, DELETE_FOR_EVERYONE_MS, MAX_PINNED, MAX_FORWARD_TARGETS,
} from "../lib/messageOps.js";
import { isId } from "../middleware/validate.js";
import { notifyDM, notifyGroup } from "../lib/push.js";
import { schedulePreview, refreshPreviewAfterEdit } from "../lib/linkPreviewService.js";
import { notExpired, expiryFor, dmDisappearAfter } from "../lib/disappearing.js";
import { LINK_TTL_MS, WIPE_AFTER_OPEN_MS, signViewLink, mediaFileOf, otherMemberIds, wipeViewOnceMedia } from "../lib/viewOnce.js";
import { deliveredNow, freshTicks, infoFor } from "../lib/groupReceipts.js";

const PERSON_FIELDS = "username fullName profilePic"; // never email / password
const same = (a, b) => !!a && !!b && a.toString() === b.toString();

// People you can chat with = your accepted contacts. Public fields only.
export const getUsersForSidebar = async (req, res) => {
  try {
    const ids = [...(await getContactIds(req.user._id))];
    const users = await User.find({ _id: { $in: ids } }).select("username fullName profilePic createdAt").lean();
    res.status(200).json(users);
  } catch (error) {
    console.error("Error in getUsersForSidebar:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Last message + unread count per conversation, so the chat list can show previews and badges.
export const getConversations = async (req, res) => {
  try {
    const me = req.user._id;
    const msgs = await Message.find({ groupId: null, deletedFor: { $ne: me }, ...notExpired(), $or: [{ senderId: me }, { receiverId: me }] })
      .sort({ createdAt: -1 })
      .select("senderId receiverId text image fileName fileType voice viewOnce viewOnceKind createdAt isRead deletedForEveryone")
      .lean();
    const byUser = new Map();
    for (const m of msgs) {
      const other = (m.senderId.toString() === me.toString() ? m.receiverId : m.senderId)?.toString();
      if (!other) continue;
      if (!byUser.has(other)) {
        byUser.set(other, {
          userId: other,
          unread: 0,
          lastMessage: m.deletedForEveryone
            ? { _id: m._id, deletedForEveryone: true, senderId: m.senderId, createdAt: m.createdAt }
            : m.viewOnce
            ? { _id: m._id, viewOnce: true, viewOnceKind: m.viewOnceKind, voice: !!m.voice, senderId: m.senderId, createdAt: m.createdAt }
            : { _id: m._id, text: m.text, image: !!m.image, fileName: m.fileName, voice: !!m.voice, senderId: m.senderId, createdAt: m.createdAt },
        });
      }
      if (!m.isRead && !m.deletedForEveryone && m.receiverId?.toString() === me.toString()) byUser.get(other).unread++;
    }
    res.status(200).json([...byUser.values()]);
  } catch (error) {
    console.error("Error in getConversations:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { id: userToChatId } = req.params;
    const myId = req.user._id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before ? new Date(req.query.before) : null;

    const filter = {
      groupId: null,
      deletedFor: { $ne: myId }, // "delete for me"
      ...notExpired(), // disappeared messages are gone at once (the sweeper removes the rows a moment later)
      $or: [
        { senderId: myId, receiverId: userToChatId },
        { senderId: userToChatId, receiverId: myId },
      ],
    };
    if (before && !isNaN(before)) filter.createdAt = { $lt: before };

    const messages = await Message.find(filter).sort({ createdAt: -1 }).limit(limit).populate("replyTo", POPULATE_REPLY).lean();

    // Read receipts are reciprocal: if either of us turned them off, my sent messages never show as read
    const them = await User.findById(userToChatId).select("privacy.readReceipts").lean();
    if (req.user.privacy?.readReceipts === false || them?.privacy?.readReceipts === false) {
      messages.forEach((m) => { if (m.senderId.toString() === myId.toString()) m.isRead = false; });
    }
    res.status(200).json(messages.reverse().map((m) => forViewer(m, myId)));
  } catch (error) {
    console.log("Error in getMessages controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { id: receiverId } = req.params;
    const senderId = req.user._id;
    if (receiverId === senderId.toString()) return res.status(400).json({ message: "You can't message yourself" });

    // Retry safety: the app re-sends a message with the same clientId until it gets an answer. If we already have it,
    // hand the original back (no second copy, no second notification). Checked before the contacts rule and before any
    // file is stored, so a retry after the first attempt succeeded can never fail or leave a stray upload.
    const { clientId, error: idError } = readClientId(req.body);
    if (idError) return res.status(400).json({ message: idError });
    const alreadySent = async () => {
      const dup = await findSentByClientId(senderId, clientId);
      if (!dup) return null;
      if (dup.groupId || !same(dup.receiverId, receiverId)) return "conflict";
      await dup.populate("replyTo", POPULATE_REPLY);
      return dup;
    };
    const replay = async () => {
      const dup = await alreadySent();
      if (!dup) return false;
      if (dup === "conflict") res.status(409).json({ message: "That clientId was used for a different message" });
      else res.status(200).json(forViewer(dup, senderId));
      return true;
    };
    if (await replay()) return;

    // Only contacts can message each other. (Blocking removes the contact, so a block looks identical from the outside.)
    if (!(await areContacts(senderId, receiverId))) return res.status(403).json({ message: "You can only message people in your contacts" });

    const { fields, error } = await buildMessageFields(req.body);
    if (error) return res.status(400).json({ message: error });
    if (!(await replyBelongsTo(fields.replyTo, { a: senderId, b: receiverId }))) {
      filesOfFields(fields).forEach((f) => deleteUpload(f)); // the files were already stored: don't leave them behind
      return res.status(400).json({ message: "Invalid reply target" });
    }

    let newMessage;
    try {
      newMessage = await Message.create({ senderId, receiverId, ...fields, clientId, expiresAt: expiryFor(await dmDisappearAfter(senderId, receiverId)), deliveredAt: isUserOnline(receiverId) ? new Date() : undefined });
    } catch (e) {
      // The message was not stored, so this attempt's files are never used (any failure, not only a duplicate)
      filesOfFields(fields).forEach((f) => deleteUpload(f));
      // Two copies of the same send raced and the other one won: answer with the winner
      if (clientId && isDuplicateKeyError(e) && (await replay())) return;
      throw e;
    }
    await newMessage.populate("replyTo", POPULATE_REPLY);

    emitToUser(receiverId, "newMessage", forViewer(newMessage, receiverId));
    emitToUser(senderId, "newMessage", forViewer(newMessage, senderId)); // sender's other tabs/devices
    notifyDM(newMessage, req.user); // web push (no-op unless the recipient enabled it)
    schedulePreview(newMessage, req.user); // link card follows as a `messagePreview` event (never delays the send)
    res.status(201).json(forViewer(newMessage, senderId));
  } catch (error) {
    if (error instanceof UploadError) return res.status(400).json({ message: error.message });
    console.log("Error in sendMessage controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const markMessagesAsRead = async (req, res) => {
  try {
    const { id: senderId } = req.params;
    const myId = req.user._id;
    const result = await Message.updateMany({ senderId, receiverId: myId, isRead: false }, { $set: { isRead: true } });
    if (result.modifiedCount > 0) {
      const sender = await User.findById(senderId).select("privacy.readReceipts").lean();
      const receiptsOn = req.user.privacy?.readReceipts !== false && sender?.privacy?.readReceipts !== false;
      if (receiptsOn) emitToUser(senderId, "messagesRead", { readBy: myId.toString() });
      emitToUser(myId, "messagesReadByMe", { from: senderId }); // clears unread badge on my other devices
    }
    res.status(200).json({ success: true });
  } catch (error) {
    console.log("Error in markMessagesAsRead controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const addReaction = async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const { emoji } = req.body || {};
    const userId = req.user._id.toString();
    if (typeof emoji !== "string" || !emoji || emoji.length > 16) return res.status(400).json({ message: "Invalid emoji" });

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: "Message not found" });
    if (message.deletedForEveryone) return res.status(400).json({ message: "This message was deleted" });
    if (message.expiresAt && message.expiresAt.getTime() <= Date.now()) return res.status(404).json({ message: "Message not found" });

    // Authorization: you must be a participant of the DM, or a member of the group
    let participants = null;
    if (message.groupId) {
      if (!(await Group.exists({ _id: message.groupId, members: userId }))) return res.status(404).json({ message: "Message not found" });
    } else {
      participants = [message.senderId.toString(), message.receiverId?.toString()];
      if (!participants.includes(userId)) return res.status(404).json({ message: "Message not found" });
    }

    const idx = message.reactions.findIndex((r) => r.userId.toString() === userId);
    if (idx !== -1) {
      if (message.reactions[idx].emoji === emoji) message.reactions.splice(idx, 1);
      else message.reactions[idx].emoji = emoji;
    } else {
      message.reactions.push({ userId, emoji });
    }
    await message.save();

    const payload = { messageId, reactions: message.reactions, groupId: message.groupId || undefined };
    if (message.groupId) emitToGroup(message.groupId, "messageReaction", payload);
    else participants.forEach((p) => emitToUser(p, "messageReaction", payload));

    res.status(200).json({ reactions: message.reactions });
  } catch (error) {
    console.log("Error in addReaction controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ───────────────────────── Phase 2A: edit / delete / star / pin / forward ─────────────────────────

const otherPartyOf = (m, me) => (same(m.senderId, me) ? m.receiverId : m.senderId);

/** PUT /messages/edit/:id  { text } — sender only, text/caption only, within EDIT_WINDOW_MS. */
export const editMessage = async (req, res) => {
  try {
    const me = req.user._id;
    const m = await loadAccessible(req.params.id, me);
    if (!m) return res.status(404).json({ message: "Message not found" });
    if (!same(m.senderId, me)) return res.status(403).json({ message: "You can only edit your own messages" });
    if (m.deletedForEveryone) return res.status(400).json({ message: "This message was deleted" });
    if (m.voice) return res.status(400).json({ message: "Voice messages can't be edited" });
    if (m.viewOnce) return res.status(400).json({ message: "View-once messages can't be edited" });
    if (Date.now() - m.createdAt.getTime() > EDIT_WINDOW_MS) {
      return res.status(400).json({ message: `Messages can only be edited within ${EDIT_WINDOW_MS / 60000} minutes` });
    }
    if (!m.groupId && !(await areContacts(me, m.receiverId))) return res.status(403).json({ message: "You can only edit messages to people in your contacts" });

    const { text } = req.body || {};
    if (typeof text !== "string") return res.status(400).json({ message: "Invalid text" });
    const clean = text.trim();
    if (clean.length > MAX_TEXT) return res.status(400).json({ message: `Message too long (max ${MAX_TEXT} characters)` });
    if (!clean && !m.image && !m.fileUrl) return res.status(400).json({ message: "Message can't be empty" });

    if (clean === (m.text || "")) return res.status(200).json({ messageId: m._id, text: m.text || "", editedAt: m.editedAt }); // nothing changed

    m.text = clean || undefined;
    m.editedAt = new Date();
    await m.save();

    const payload = { messageId: m._id.toString(), text: m.text || "", editedAt: m.editedAt };
    emitToConversation(m, "messageEdited", payload);
    await refreshPreviewAfterEdit(m, req.user).catch((e) => console.log("link preview refresh failed:", e.message));
    res.status(200).json(payload);
  } catch (error) {
    console.log("Error in editMessage controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** DELETE /messages/:id?scope=me|everyone
 *  me: hides it from the caller only. everyone: sender only, within DELETE_FOR_EVERYONE_MS; wipes the content and the file(s). */
export const deleteMessage = async (req, res) => {
  try {
    const me = req.user._id;
    const scope = req.query.scope === "everyone" ? "everyone" : req.query.scope === "me" || req.query.scope == null ? "me" : null;
    if (!scope) return res.status(400).json({ message: "scope must be 'me' or 'everyone'" });
    const m = await loadAccessible(req.params.id, me);
    if (!m) return res.status(404).json({ message: "Message not found" });
    const messageId = m._id.toString();

    if (scope === "me") {
      await Message.updateOne({ _id: m._id }, { $addToSet: { deletedFor: me } });
      emitToUser(me, "messageDeletedForMe", { messageId, groupId: m.groupId?.toString() }); // my other tabs/devices
      return res.status(200).json({ messageId, scope });
    }

    if (!same(m.senderId, me)) return res.status(403).json({ message: "You can only delete your own messages for everyone" });
    if (m.deletedForEveryone) return res.status(200).json({ messageId, scope });
    if (Date.now() - m.createdAt.getTime() > DELETE_FOR_EVERYONE_MS) {
      return res.status(400).json({ message: `Messages can only be deleted for everyone within ${DELETE_FOR_EVERYONE_MS / 3600000} hours` });
    }

    const files = [m.image, m.fileUrl, m.linkPreview?.image];
    await Message.updateOne(
      { _id: m._id },
      { $set: { deletedForEveryone: true, deletedAt: new Date(), reactions: [], starredBy: [] }, $unset: WIPE_FIELDS }
    );
    files.forEach((f) => f && deleteUpload(f));
    emitToConversation(m, "messageDeleted", { messageId });
    res.status(200).json({ messageId, scope });
  } catch (error) {
    console.log("Error in deleteMessage controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /messages/star/:id  { starred: boolean } — private to the caller. */
export const starMessage = async (req, res) => {
  try {
    const me = req.user._id;
    const { starred } = req.body || {};
    if (typeof starred !== "boolean") return res.status(400).json({ message: "starred must be true or false" });
    const m = await loadAccessible(req.params.id, me);
    if (!m) return res.status(404).json({ message: "Message not found" });
    if (starred && m.deletedForEveryone) return res.status(400).json({ message: "This message was deleted" });
    if (starred && m.viewOnce) return res.status(400).json({ message: "View-once messages can't be starred" });

    await Message.updateOne({ _id: m._id }, starred ? { $addToSet: { starredBy: me } } : { $pull: { starredBy: me } });
    const payload = { messageId: m._id.toString(), starred };
    emitToUser(me, "messageStarred", payload); // sync my other tabs/devices only; nobody else learns what I starred
    res.status(200).json(payload);
  } catch (error) {
    console.log("Error in starMessage controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /messages/pin/:id  { pinned: boolean } — visible to everyone in the chat. Max MAX_PINNED; pinning another replaces the oldest. */
export const pinMessage = async (req, res) => {
  try {
    const me = req.user._id;
    const { pinned } = req.body || {};
    if (typeof pinned !== "boolean") return res.status(400).json({ message: "pinned must be true or false" });
    const m = await loadAccessible(req.params.id, me);
    if (!m) return res.status(404).json({ message: "Message not found" });
    if (!m.groupId && !(await areContacts(me, otherPartyOf(m, me)))) return res.status(403).json({ message: "You can only pin in chats with your contacts" });
    const messageId = m._id.toString();

    if (!pinned) {
      if (m.pinnedAt) {
        await Message.updateOne({ _id: m._id }, { $unset: { pinnedAt: 1, pinnedBy: 1 } });
        emitToConversation(m, "messagePinned", { messageId, pinned: false });
      }
      return res.status(200).json({ messageId, pinned: false });
    }

    if (m.deletedForEveryone) return res.status(400).json({ message: "This message was deleted" });
    if (m.viewOnce) return res.status(400).json({ message: "View-once messages can't be pinned" });
    if (m.pinnedAt) return res.status(200).json({ messageId, pinned: true, pinnedAt: m.pinnedAt });

    // Make room: keep at most MAX_PINNED, dropping the oldest pins
    const current = await Message.find({ ...conversationFilter(m), pinnedAt: { $ne: null } }).sort({ pinnedAt: 1 }).select("_id").lean();
    const drop = current.slice(0, Math.max(0, current.length - MAX_PINNED + 1));
    if (drop.length) {
      await Message.updateMany({ _id: { $in: drop.map((d) => d._id) } }, { $unset: { pinnedAt: 1, pinnedBy: 1 } });
      drop.forEach((d) => emitToConversation(m, "messagePinned", { messageId: d._id.toString(), pinned: false }));
    }

    m.pinnedAt = new Date();
    m.pinnedBy = me;
    await m.save();
    const payload = { messageId, pinned: true, pinnedAt: m.pinnedAt, pinnedBy: me.toString() };
    emitToConversation(m, "messagePinned", payload);
    res.status(200).json(payload);
  } catch (error) {
    console.log("Error in pinMessage controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /messages/pinned/user/:id */
export const getPinnedForUser = async (req, res) => {
  try {
    const me = req.user._id;
    const other = req.params.id;
    const msgs = await Message.find({
      groupId: null,
      pinnedAt: { $ne: null },
      ...notExpired(),
      deletedFor: { $ne: me },
      deletedForEveryone: { $ne: true },
      $or: [{ senderId: me, receiverId: other }, { senderId: other, receiverId: me }],
    }).sort({ pinnedAt: -1 }).limit(MAX_PINNED).lean();
    res.status(200).json(msgs.map((m) => forViewer(m, me)));
  } catch (error) {
    console.log("Error in getPinnedForUser controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /messages/pinned/group/:groupId */
export const getPinnedForGroup = async (req, res) => {
  try {
    const me = req.user._id;
    const { groupId } = req.params;
    if (!(await Group.exists({ _id: groupId, members: me }))) return res.status(403).json({ message: "Not a member of this group" });
    const msgs = await Message.find({ groupId, pinnedAt: { $ne: null }, deletedFor: { $ne: me }, deletedForEveryone: { $ne: true }, ...notExpired() })
      .sort({ pinnedAt: -1 }).limit(MAX_PINNED).populate("senderId", PERSON_FIELDS).lean();
    res.status(200).json(msgs.map((m) => forViewer(m, me)));
  } catch (error) {
    console.log("Error in getPinnedForGroup controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /messages/starred — everything I starred, newest first, across chats and groups I'm still in. */
export const getStarred = async (req, res) => {
  try {
    const me = req.user._id;
    const myGroups = (await Group.find({ members: me }).select("_id").lean()).map((g) => g._id);
    const msgs = await Message.find({
      starredBy: me,
      ...notExpired(),
      deletedFor: { $ne: me },
      deletedForEveryone: { $ne: true },
      $or: [{ groupId: null }, { groupId: { $in: myGroups } }],
    })
      .sort({ createdAt: -1 }).limit(200)
      .populate("senderId", PERSON_FIELDS).populate("receiverId", PERSON_FIELDS).populate("groupId", "name groupPic")
      .lean();
    res.status(200).json(msgs.map((m) => forViewer(m, me)));
  } catch (error) {
    console.log("Error in getStarred controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

// A forwarded copy gets its own files (so deleting the original for everyone can't break the copy). Returns null if a file is gone.
const cloneForForward = async (src) => {
  const f = { forwarded: true };
  const fail = () => { filesOfFields(f).forEach((p) => deleteUpload(p)); return null; }; // don't leave half a copy behind
  if (src.text) f.text = src.text;
  if (src.linkPreview?.url) {
    // The copy keeps the card (with its own copy of the thumbnail, for the same reason files are copied)
    const { url, title, description, siteName, image } = src.linkPreview;
    f.linkPreview = Object.fromEntries(Object.entries({ url, title, description, siteName }).filter(([, v]) => v));
    if (image) {
      const copy = await copyUpload(image);
      if (copy) f.linkPreview.image = copy;
    }
  }
  if (src.image) {
    f.image = await copyUpload(src.image);
    if (!f.image) return fail();
  }
  if (src.fileUrl) {
    f.fileUrl = await copyUpload(src.fileUrl);
    if (!f.fileUrl) return fail();
    f.fileType = src.fileType;
    f.fileName = src.fileName;
    f.fileSize = src.fileSize;
    if (src.voice) {
      f.voice = true;
      f.voiceDuration = src.voiceDuration;
      if (src.voiceWaveform?.length) f.voiceWaveform = src.voiceWaveform;
    }
  }
  return f;
};

/** POST /messages/forward  { messageId, targets: [{ type: "user"|"group", id }] } — up to MAX_FORWARD_TARGETS chats at once. */
export const forwardMessage = async (req, res) => {
  try {
    const me = req.user._id;
    const { messageId, targets } = req.body || {};
    const valid = isId(messageId) && Array.isArray(targets) && targets.length > 0 && targets.length <= MAX_FORWARD_TARGETS &&
      targets.every((t) => t && ["user", "group"].includes(t.type) && isId(t.id));
    if (!valid) return res.status(400).json({ message: `Pick 1 to ${MAX_FORWARD_TARGETS} chats to forward to` });

    const src = await loadAccessible(messageId, me);
    if (!src) return res.status(404).json({ message: "Message not found" });
    if (src.deletedForEveryone) return res.status(400).json({ message: "This message was deleted" });
    if (src.viewOnce) return res.status(400).json({ message: "View-once messages can't be forwarded" });

    const contacts = await getContactIds(me);
    const seen = new Set();
    const results = [];
    for (const t of targets) {
      const key = `${t.type}:${t.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const fail = (error) => results.push({ type: t.type, id: t.id, ok: false, error });
      let fields = null;
      let stored = false; // once the message row exists it owns the copied files
      try {
        let group = null;
        if (t.type === "user") {
          if (t.id === me.toString() || !contacts.has(t.id)) { fail("Not in your contacts"); continue; }
        } else {
          group = await Group.findOne({ _id: t.id, members: me });
          if (!group) { fail("Not a member of that group"); continue; }
        }
        fields = await cloneForForward(src);
        if (!fields) { fail("The attachment is no longer available"); continue; }

        if (group) {
          const msg = await Message.create({
            senderId: me, groupId: group._id, ...fields,
            expiresAt: expiryFor(group.disappearAfter),
            deliveredTo: deliveredNow(group.members, me, isUserOnline),
          });
          stored = true;
          await msg.populate("senderId", PERSON_FIELDS);
          group.lastMessage = msg._id;
          await group.save();
          emitToGroup(group._id, "newGroupMessage", { groupId: group._id, message: forViewer(msg, me) });
          // The forwarder's devices need the tick counts too (a normal send gets them in the HTTP answer; a forward's answer is only a summary)
          emitToUser(me, "groupReceipt", { groupId: group._id.toString(), updates: [{ messageId: msg._id.toString(), ticks: freshTicks(group, msg) }] });
          notifyGroup(msg, req.user, group);
        } else {
          const msg = await Message.create({ senderId: me, receiverId: t.id, ...fields, expiresAt: expiryFor(await dmDisappearAfter(me, t.id)), deliveredAt: isUserOnline(t.id) ? new Date() : undefined });
          stored = true;
          emitToUser(t.id, "newMessage", forViewer(msg, t.id));
          emitToUser(me, "newMessage", forViewer(msg, me));
          notifyDM(msg, req.user);
        }
        results.push({ type: t.type, id: t.id, ok: true });
      } catch (e) {
        console.log("forward target failed:", e.message);
        if (fields && !stored) filesOfFields(fields).forEach((f) => deleteUpload(f)); // the copy was made but no message was stored for it
        fail("Couldn't forward");
      }
    }
    res.status(200).json({ results });
  } catch (error) {
    console.log("Error in forwardMessage controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ───────────────────────── Phase 2D: search across chats, media gallery ─────────────────────────

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pageSize = (v, def, max) => Math.min(Math.max(parseInt(v) || def, 1), max);
const beforeDate = (v) => {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d) ? d : null;
};
// Messages nobody should see in a list: hidden by me, deleted for everyone, or (later) view-once media
const VISIBLE = (me) => ({ deletedFor: { $ne: me }, deletedForEveryone: { $ne: true }, viewOnce: { $ne: true }, ...notExpired() });

/** GET /messages/search?q=...&limit=30&before=<ISO date>
 *  Text (and file names) across every chat I'm in: 1:1 chats with my current contacts and the groups I'm a member of.
 *  Newest first. Messages I deleted for myself or that were deleted for everyone never show up. Voice notes have no text. */
export const searchMessages = async (req, res) => {
  try {
    const me = req.user._id;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) return res.status(400).json({ message: "Type at least 2 characters" });
    if (q.length > 100) return res.status(400).json({ message: "That search is too long (max 100 characters)" });
    const limit = pageSize(req.query.limit, 30, 50);
    const before = beforeDate(req.query.before);
    const re = new RegExp(escapeRegex(q), "i");

    const [contacts, groups] = await Promise.all([getContactIds(me), Group.find({ members: me }).select("_id").lean()]);
    const contactIds = [...contacts];
    const inMyChats = {
      $or: [
        { groupId: null, senderId: me, receiverId: { $in: contactIds } },
        { groupId: null, receiverId: me, senderId: { $in: contactIds } },
        { groupId: { $in: groups.map((g) => g._id) } },
      ],
    };
    const matches = { $or: [{ text: re }, { fileName: re, voice: { $ne: true } }] };
    const filter = { ...VISIBLE(me), $and: [inMyChats, matches] };
    if (before) filter.createdAt = { $lt: before };

    const msgs = await Message.find(filter)
      .sort({ createdAt: -1 }).limit(limit)
      .populate("senderId", PERSON_FIELDS).populate("receiverId", PERSON_FIELDS).populate("groupId", "name groupPic")
      .lean();
    res.status(200).json(msgs.map((m) => forViewer(m, me)));
  } catch (error) {
    console.log("Error in searchMessages controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

// What each gallery tab shows. media: photos and videos. docs: PDFs, Office files, other documents and audio files (not voice notes).
// links: any message whose text contains an http(s) link (it doesn't depend on a preview having been fetched).
const GALLERY = {
  media: { $or: [{ image: { $type: "string", $ne: "" } }, { fileUrl: { $type: "string", $ne: "" }, fileType: { $in: ["image", "video"] } }] },
  docs: { fileUrl: { $type: "string", $ne: "" }, fileType: { $in: ["pdf", "document", "audio"] }, voice: { $ne: true } },
  links: { text: /https?:\/\//i },
};

const galleryQuery = async (req, res, conversation, populateSender) => {
  const me = req.user._id;
  const type = req.query.type == null ? "media" : req.query.type;
  if (!Object.hasOwn(GALLERY, type)) return res.status(400).json({ message: "type must be media, docs or links" });
  const limit = pageSize(req.query.limit, 60, 100);
  const before = beforeDate(req.query.before);
  const filter = { ...VISIBLE(me), $and: [conversation, GALLERY[type]] };
  if (before) filter.createdAt = { $lt: before };
  let q = Message.find(filter).sort({ createdAt: -1 }).limit(limit);
  if (populateSender) q = q.populate("senderId", PERSON_FIELDS);
  const msgs = await q.lean();
  res.status(200).json(msgs.map((m) => forViewer(m, me)));
};

/** GET /messages/media/user/:id?type=media|docs|links&limit=60&before=<ISO date>: shared media, documents or links in my chat with :id. */
export const getMediaForUser = async (req, res) => {
  try {
    const me = req.user._id;
    const other = req.params.id;
    await galleryQuery(req, res, { groupId: null, $or: [{ senderId: me, receiverId: other }, { senderId: other, receiverId: me }] }, false);
  } catch (error) {
    console.log("Error in getMediaForUser controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /messages/media/group/:groupId?type=...: the same for a group (members only). */
export const getMediaForGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    if (!(await Group.exists({ _id: groupId, members: req.user._id }))) return res.status(403).json({ message: "Not a member of this group" });
    await galleryQuery(req, res, { groupId }, true);
  } catch (error) {
    console.log("Error in getMediaForGroup controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ───────────────────────── Phase 2E: view-once ─────────────────────────
// How it works is explained at the top of lib/viewOnce.js.
const mediaGone = (res) => res.status(410).json({ message: "This media is no longer available" });

/** POST /messages/view-once/:id/open — a recipient asks to look at a view-once photo / video / voice note.
 *  The first call records the view and returns a signed link that works for this person for a few minutes. Opening again is only
 *  possible while that first link is still valid and the viewer wasn't closed (a page reload in the middle of watching);
 *  after that, or after it was closed, it's 410. The sender can't open their own message. */
export const openViewOnce = async (req, res) => {
  try {
    const me = req.user._id;
    const m = await loadAccessible(req.params.id, me);
    if (!m || !m.viewOnce || m.deletedForEveryone) return res.status(404).json({ message: "Message not found" });
    if (same(m.senderId, me)) return res.status(403).json({ message: "You can't open your own view-once message" });
    if (!m.groupId && !(await areContacts(me, m.senderId))) return res.status(403).json({ message: "You can only open messages from people in your contacts" });
    const file = mediaFileOf(m);
    if (m.mediaWiped || !file) return mediaGone(res);

    const now = Date.now();
    // Claim the single view atomically (two quick taps can't both win)
    const claimed = await Message.updateOne(
      { _id: m._id, mediaWiped: { $ne: true }, "views.userId": { $ne: me } },
      { $push: { views: { userId: me, at: new Date(now) } } }
    );
    let openedAt = now;
    if (!claimed.modifiedCount) {
      const cur = await Message.findById(m._id).select("views mediaWiped");
      const mine = cur?.views?.find((v) => same(v.userId, me));
      if (!cur || cur.mediaWiped || !mine || mine.closedAt || now - mine.at.getTime() > LINK_TTL_MS) return mediaGone(res);
      openedAt = mine.at.getTime(); // re-issue within the same window, never a longer one
    }

    if (claimed.modifiedCount) {
      const cur = await Message.findById(m._id).select("views");
      const everyone = m.groupId ? await otherMemberIds(m) : [m.receiverId];
      // Everyone who can see it has seen it: the file only needs to live for the viewers' remaining time
      if (everyone.every((id) => cur.views.some((v) => same(v.userId, id)))) {
        await Message.updateOne({ _id: m._id }, { $set: { wipeAt: new Date(now + WIPE_AFTER_OPEN_MS) } });
      }
      const messageId = m._id.toString();
      const groupId = m.groupId?.toString();
      emitToUser(m.senderId, "messageViewed", { messageId, viewCount: cur.views.length, groupId });
      emitToUser(me, "messageViewed", { messageId, viewedByMe: true, groupId }); // my other tabs
    }

    const ttlMs = Math.max(1000, openedAt + LINK_TTL_MS - now);
    const token = signViewLink({ messageId: m._id, userId: me, file: path.basename(file), ttlMs });
    res.status(200).json({ url: `/api/uploads/view-once/${token}`, kind: m.viewOnceKind, duration: m.voiceDuration, seconds: Math.round(ttlMs / 1000) });
  } catch (error) {
    console.log("Error in openViewOnce controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /messages/view-once/:id/close — the viewer was closed. In a 1:1 chat the file is deleted right now; in a group once
 *  everyone else has opened it and closed it (otherwise at the latest when the sweeper wipes it). */
export const closeViewOnce = async (req, res) => {
  try {
    const me = req.user._id;
    const m = await loadAccessible(req.params.id, me);
    if (!m || !m.viewOnce || m.deletedForEveryone) return res.status(404).json({ message: "Message not found" });
    const mine = m.views?.find((v) => same(v.userId, me));
    if (!mine) return res.status(400).json({ message: "You haven't opened this message" });
    if (!mine.closedAt) {
      mine.closedAt = new Date();
      await m.save();
    }

    let wipe = !m.groupId;
    if (m.groupId) {
      const others = await otherMemberIds(m);
      wipe = others.every((id) => m.views.some((v) => same(v.userId, id) && v.closedAt));
    }
    if (wipe) await wipeViewOnceMedia(m);
    res.status(200).json({ messageId: m._id.toString() });
  } catch (error) {
    console.log("Error in closeViewOnce controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ───────────────────────── Phase 2F: keep, message info ─────────────────────────

/** PUT /messages/keep/:id  { kept: boolean } — "Keep" a disappearing message so it stays.
 *  Anyone in the chat can keep a message that is set to expire; the chat is told (`messageKept`) so the sender can see it was kept.
 *  Unkeep: the person who kept it, or the message's sender. The message then goes back to the chat's CURRENT rule: it gets a fresh
 *  countdown from the chat's timer now, or stays for good if the chat's timer is off. View-once messages can't be kept. */
export const keepMessage = async (req, res) => {
  try {
    const me = req.user._id;
    const { kept } = req.body || {};
    if (typeof kept !== "boolean") return res.status(400).json({ message: "kept must be true or false" });
    const m = await loadAccessible(req.params.id, me);
    if (!m) return res.status(404).json({ message: "Message not found" });
    if (!m.groupId && !(await areContacts(me, otherPartyOf(m, me)))) return res.status(403).json({ message: "You can only keep messages in chats with your contacts" });
    if (m.deletedForEveryone) return res.status(400).json({ message: "This message was deleted" });
    if (m.viewOnce) return res.status(400).json({ message: "View-once messages can't be kept" });
    const messageId = m._id.toString();
    const by = me.toString();

    if (kept) {
      if (m.keptBy) return res.status(200).json({ messageId, keptBy: m.keptBy.toString() }); // already kept: nothing to do
      if (!m.expiresAt) return res.status(400).json({ message: "Only disappearing messages can be kept" });
      // Atomic: if the sweeper or a second keeper got there first, this changes nothing
      const r = await Message.updateOne(
        { _id: m._id, keptBy: null, expiresAt: { $gt: new Date() } },
        { $set: { keptBy: me, keptAt: new Date() }, $unset: { expiresAt: 1 } }
      );
      if (!r.modifiedCount) {
        const cur = await Message.findById(m._id).select("keptBy");
        if (cur?.keptBy) return res.status(200).json({ messageId, keptBy: cur.keptBy.toString() });
        return res.status(404).json({ message: "Message not found" }); // it disappeared in the meantime
      }
      emitToConversation(m, "messageKept", { messageId, keptBy: by, expiresAt: null, by });
      return res.status(200).json({ messageId, keptBy: by });
    }

    if (!m.keptBy) return res.status(200).json({ messageId, keptBy: null }); // not kept: nothing to do
    if (!same(m.keptBy, me) && !same(m.senderId, me)) return res.status(403).json({ message: "Only the person who kept it, or its sender, can unkeep it" });
    const seconds = m.groupId
      ? (await Group.findById(m.groupId).select("disappearAfter").lean())?.disappearAfter || 0
      : await dmDisappearAfter(m.senderId, m.receiverId);
    const expiresAt = expiryFor(seconds);
    const update = { $unset: { keptBy: 1, keptAt: 1 } };
    if (expiresAt) update.$set = { expiresAt };
    await Message.updateOne({ _id: m._id }, update);
    emitToConversation(m, "messageKept", { messageId, keptBy: null, expiresAt: expiresAt ? expiresAt.toISOString() : null, by });
    res.status(200).json({ messageId, keptBy: null, expiresAt: expiresAt || null });
  } catch (error) {
    console.log("Error in keepMessage controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /messages/info/:id — who has received / read my GROUP message (sender only). Read times are hidden for people with read
 *  receipts off, and all read information is hidden when I have them off (same reciprocity as 1:1 chats). */
export const getMessageInfo = async (req, res) => {
  try {
    const me = req.user._id;
    const m = await loadAccessible(req.params.id, me);
    if (!m || !m.groupId) return res.status(404).json({ message: "Message not found" });
    if (!same(m.senderId, me)) return res.status(403).json({ message: "Only the sender can see this" });
    const group = await Group.findById(m.groupId).select("members");
    if (!group) return res.status(404).json({ message: "Message not found" });

    const info = await infoFor(m, group);
    const ids = [...info.read, ...info.delivered, ...info.pending].map((e) => e.userId);
    const people = new Map((await User.find({ _id: { $in: ids } }).select(PERSON_FIELDS).lean()).map((u) => [u._id.toString(), u]));
    const named = (list) => list.map((e) => ({ user: people.get(e.userId) || { _id: e.userId, fullName: "Unknown" }, at: e.at }));
    res.status(200).json({ total: info.total, readHidden: info.readHidden, read: named(info.read), delivered: named(info.delivered), pending: named(info.pending) });
  } catch (error) {
    console.log("Error in getMessageInfo controller:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};
