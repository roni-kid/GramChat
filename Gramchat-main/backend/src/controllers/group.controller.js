import Group from "../models/group.model.js";
import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import ChatPref from "../models/chatPref.model.js";
import { emitToUser, emitToGroup, joinUserToGroup, removeUserFromGroup, isUserOnline } from "../lib/socket.js";
import { saveDataUrl, deleteUpload, UploadError } from "../lib/storage.js";
import { buildMessageFields, replyBelongsTo, readClientId, findSentByClientId, isDuplicateKeyError, POPULATE_REPLY } from "../lib/messageUtils.js";
import { isId } from "../middleware/validate.js";
import { getContactIds } from "../lib/relations.js";
import { forViewer } from "../lib/messageOps.js";
import { notifyGroup } from "../lib/push.js";
import { schedulePreview } from "../lib/linkPreviewService.js";
import { isValidTimer, timerChoices, notExpired, expiryFor } from "../lib/disappearing.js";
import { receiptContext, ticksFor, freshTicks, deliveredNow, recordRead, emitReceiptBatches } from "../lib/groupReceipts.js";

const MEMBER_FIELDS = "username fullName profilePic"; // never email / password
const MAX_MEMBERS = 256;

const POP = [{ path: "members", select: MEMBER_FIELDS }, { path: "admin", select: MEMBER_FIELDS }];
const notifyMembers = (group, event) => group.members.forEach((m) => emitToUser(m._id || m, event, group));

export const getMyGroups = async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user._id }).populate(POP).populate("lastMessage").sort({ updatedAt: -1 });
    // lastMessage is a full message: strip per-user private fields (who starred it, who deleted it)
    res.status(200).json(groups.map((g) => {
      const o = g.toObject();
      if (o.lastMessage?.expiresAt && new Date(o.lastMessage.expiresAt) <= new Date()) o.lastMessage = null; // disappeared, not swept yet
      if (o.lastMessage) o.lastMessage = forViewer(o.lastMessage, req.user._id);
      return o;
    }));
  } catch (error) {
    console.log("Error in getMyGroups:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const createGroup = async (req, res) => {
  try {
    const { name, description, memberIds, groupPic } = req.body || {};
    const adminId = req.user._id;
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ message: "Group name is required" });
    if (name.trim().length > 60) return res.status(400).json({ message: "Group name is too long (max 60)" });
    if (description != null && (typeof description !== "string" || description.length > 500)) return res.status(400).json({ message: "Description too long (max 500)" });
    if (memberIds != null && (!Array.isArray(memberIds) || !memberIds.every(isId))) return res.status(400).json({ message: "Invalid members" });

    const myContacts = await getContactIds(adminId);
    if ((memberIds || []).some((id) => !myContacts.has(id) && id !== adminId.toString())) {
      return res.status(400).json({ message: "You can only add people from your contacts" });
    }
    const wanted = [...new Set([adminId.toString(), ...(memberIds || [])])];
    if (wanted.length > MAX_MEMBERS) return res.status(400).json({ message: `Groups are limited to ${MAX_MEMBERS} members` });
    const existing = await User.find({ _id: { $in: wanted } }).select("_id").lean();
    const allMembers = existing.map((u) => u._id.toString());

    const picUrl = groupPic ? (await saveDataUrl(groupPic, { maxBytes: 5 * 1024 * 1024, only: "image/" })).url : "";
    const group = await Group.create({ name: name.trim(), description: description || "", groupPic: picUrl, admin: adminId, members: allMembers });
    await group.populate(POP);

    allMembers.forEach((m) => joinUserToGroup(m, group._id));
    notifyMembers(group, "groupCreated");
    res.status(201).json(group);
  } catch (error) {
    if (error instanceof UploadError) return res.status(400).json({ message: error.message });
    console.log("Error in createGroup:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getGroupMessages = async (req, res) => {
  try {
    const { groupId } = req.params;
    const me = req.user._id;
    const group = await Group.findOne({ _id: groupId, members: me }).select("members").lean();
    if (!group) return res.status(403).json({ message: "Not a member of this group" });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before ? new Date(req.query.before) : null;
    const filter = { groupId, deletedFor: { $ne: req.user._id }, ...notExpired() }; // "delete for me" hides a message from me only; disappeared messages are gone
    if (before && !isNaN(before)) filter.createdAt = { $lt: before };

    const messages = await Message.find(filter).sort({ createdAt: -1 }).limit(limit)
      .populate("senderId", MEMBER_FIELDS).populate("replyTo", POPULATE_REPLY).lean();
    // The sender's own messages carry `ticks` (counts for the per-member ticks); the raw lists never leave the server
    const ctx = await receiptContext(group);
    res.status(200).json(messages.reverse().map((m) => {
      const o = forViewer(m, me);
      if (String(m.senderId?._id || m.senderId) === String(me)) o.ticks = ticksFor(m, ctx);
      return o;
    }));
  } catch (error) {
    console.log("Error in getGroupMessages:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const sendGroupMessage = async (req, res) => {
  try {
    const { groupId } = req.params;
    const senderId = req.user._id;
    const group = await Group.findOne({ _id: groupId, members: senderId });
    if (!group) return res.status(403).json({ message: "Not a member of this group" });

    // Retry safety (see sendMessage): a re-sent clientId returns the original message instead of creating a second one
    const { clientId, error: idError } = readClientId(req.body);
    if (idError) return res.status(400).json({ message: idError });
    const replay = async () => {
      const dup = await findSentByClientId(senderId, clientId);
      if (!dup) return false;
      if (!dup.groupId || dup.groupId.toString() !== group._id.toString()) {
        res.status(409).json({ message: "That clientId was used for a different message" });
      } else {
        await dup.populate("senderId", MEMBER_FIELDS);
        await dup.populate("replyTo", POPULATE_REPLY);
        res.status(200).json({ ...forViewer(dup, senderId), ticks: ticksFor(dup, await receiptContext(group)) });
      }
      return true;
    };
    if (await replay()) return;

    const { fields, error } = await buildMessageFields(req.body);
    if (error) return res.status(400).json({ message: error });
    if (!(await replyBelongsTo(fields.replyTo, { groupId }))) return res.status(400).json({ message: "Invalid reply target" });

    let newMessage;
    try {
      newMessage = await Message.create({
        senderId, groupId, ...fields, clientId,
        expiresAt: expiryFor(group.disappearAfter),
        deliveredTo: deliveredNow(group.members, senderId, isUserOnline), // members connected right now already have it
      });
    } catch (e) {
      if (clientId && isDuplicateKeyError(e)) {
        [fields.image, fields.fileUrl].forEach((f) => f && deleteUpload(f));
        if (await replay()) return;
      }
      throw e;
    }
    await newMessage.populate("senderId", MEMBER_FIELDS);
    await newMessage.populate("replyTo", POPULATE_REPLY);

    group.lastMessage = newMessage._id;
    await group.save();

    emitToGroup(group._id, "newGroupMessage", { groupId: group._id, message: forViewer(newMessage, senderId) });
    notifyGroup(newMessage, req.user, group); // web push to members who enabled it
    schedulePreview(newMessage, req.user); // link card follows as a `messagePreview` event
    res.status(201).json({ ...forViewer(newMessage, senderId), ticks: freshTicks(group, newMessage) });
  } catch (error) {
    if (error instanceof UploadError) return res.status(400).json({ message: error.message });
    console.log("Error in sendGroupMessage:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const addGroupMember = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body || {};
    if (!isId(userId)) return res.status(400).json({ message: "Invalid user" });

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "Group not found" });
    if (group.admin.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Only admin can add members" });
    if (group.members.map(String).includes(userId)) return res.status(400).json({ message: "User already in group" });
    if (group.members.length >= MAX_MEMBERS) return res.status(400).json({ message: `Groups are limited to ${MAX_MEMBERS} members` });
    if (!(await getContactIds(req.user._id)).has(userId)) return res.status(400).json({ message: "You can only add people from your contacts" });

    group.members.push(userId);
    await group.save();
    await group.populate(POP);

    joinUserToGroup(userId, group._id);
    emitToUser(userId, "groupCreated", group);
    group.members.filter((m) => m._id.toString() !== userId).forEach((m) => emitToUser(m._id, "groupUpdated", group));
    res.status(200).json(group);
  } catch (error) {
    console.log("Error in addGroupMember:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const removeGroupMember = async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const requesterId = req.user._id.toString();
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "Group not found" });

    const isSelf = requesterId === userId;
    const isAdmin = group.admin.toString() === requesterId;
    if (!isSelf && !isAdmin) return res.status(403).json({ message: "Not authorized" });
    if (!group.members.map(String).includes(userId)) return res.status(404).json({ message: "Not a member" });
    if (!isSelf && userId === group.admin.toString()) return res.status(403).json({ message: "Can't remove the admin" });

    group.members = group.members.filter((m) => m.toString() !== userId);

    if (group.members.length === 0) {
      await Group.deleteOne({ _id: group._id });
      await Message.deleteMany({ groupId: group._id });
      await ChatPref.deleteMany({ kind: "group", targetId: group._id });
      emitToUser(userId, "removedFromGroup", { groupId });
      removeUserFromGroup(userId, group._id);
      return res.status(200).json({ ...group.toObject(), members: [] });
    }
    if (isAdmin && isSelf) group.admin = group.members[0];

    await group.save();
    await group.populate(POP);

    emitToUser(userId, "removedFromGroup", { groupId });
    removeUserFromGroup(userId, group._id);
    await ChatPref.deleteOne({ userId, kind: "group", targetId: group._id }).catch(() => {}); // their pin / archive / mute for this group
    notifyMembers(group, "groupUpdated");
    res.status(200).json(group);
  } catch (error) {
    console.log("Error in removeGroupMember:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const updateGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name, description, groupPic } = req.body || {};
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "Group not found" });
    if (group.admin.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Only admin can update group" });

    if (name != null) {
      if (typeof name !== "string" || !name.trim() || name.trim().length > 60) return res.status(400).json({ message: "Invalid group name" });
      group.name = name.trim();
    }
    if (description !== undefined) {
      if (typeof description !== "string" || description.length > 500) return res.status(400).json({ message: "Description too long (max 500)" });
      group.description = description;
    }
    let oldPic;
    if (groupPic) {
      oldPic = group.groupPic;
      group.groupPic = (await saveDataUrl(groupPic, { maxBytes: 5 * 1024 * 1024, only: "image/" })).url;
    }
    await group.save();
    if (oldPic) deleteUpload(oldPic);
    await group.populate(POP);
    notifyMembers(group, "groupUpdated");
    res.status(200).json(group);
  } catch (error) {
    if (error instanceof UploadError) return res.status(400).json({ message: error.message });
    console.log("Error in updateGroup:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /groups/:groupId/disappearing  { seconds } — admin only. Seconds new messages live (0 = off). Messages already sent keep their
 *  own expiry. Members learn about it through `groupUpdated` (the group now carries `disappearAfter`) and a `chatTimer` event. */
export const setGroupDisappearing = async (req, res) => {
  try {
    const { groupId } = req.params;
    const me = req.user._id.toString();
    const seconds = req.body?.seconds;
    if (!isValidTimer(seconds)) return res.status(400).json({ message: `seconds must be one of ${timerChoices().join(", ")}` });
    const group = await Group.findById(groupId);
    if (!group || !group.members.map(String).includes(me)) return res.status(404).json({ message: "Group not found" });
    if (group.admin.toString() !== me) return res.status(403).json({ message: "Only the group admin can change disappearing messages" });

    const changed = (group.disappearAfter || 0) !== seconds;
    if (changed) {
      group.disappearAfter = seconds;
      await group.save();
    }
    await group.populate(POP);
    if (changed) {
      notifyMembers(group, "groupUpdated");
      emitToGroup(group._id, "chatTimer", { kind: "group", id: group._id.toString(), seconds, by: me });
    }
    res.status(200).json(group);
  } catch (error) {
    console.log("Error in setGroupDisappearing:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /groups/:groupId/read — I'm looking at this group: everything from other members that I hadn't read is now read (and delivered).
 *  The senders get `groupReceipt` events with their messages' new tick counts. Cheap to call repeatedly: it only touches what's new. */
export const markGroupRead = async (req, res) => {
  try {
    const { groupId } = req.params;
    const me = req.user._id;
    if (!(await Group.exists({ _id: groupId, members: me }))) return res.status(403).json({ message: "Not a member of this group" });
    const batches = await recordRead(me, groupId);
    emitReceiptBatches(batches, emitToUser);
    res.status(200).json({ success: true, updated: batches.reduce((n, b) => n + b.updates.length, 0) });
  } catch (error) {
    console.log("Error in markGroupRead:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};
