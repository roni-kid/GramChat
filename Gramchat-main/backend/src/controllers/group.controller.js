import Group from "../models/group.model.js";
import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import { emitToUser, emitToGroup, joinUserToGroup, removeUserFromGroup } from "../lib/socket.js";
import { saveDataUrl, deleteUpload, UploadError } from "../lib/storage.js";
import { buildMessageFields, replyBelongsTo, POPULATE_REPLY } from "../lib/messageUtils.js";
import { isId } from "../middleware/validate.js";

const MEMBER_FIELDS = "fullName profilePic"; // never email / password
const MAX_MEMBERS = 256;

const POP = [{ path: "members", select: MEMBER_FIELDS }, { path: "admin", select: MEMBER_FIELDS }];
const notifyMembers = (group, event) => group.members.forEach((m) => emitToUser(m._id || m, event, group));

export const getMyGroups = async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user._id }).populate(POP).populate("lastMessage").sort({ updatedAt: -1 });
    res.status(200).json(groups);
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
    if (!(await Group.exists({ _id: groupId, members: req.user._id }))) return res.status(403).json({ message: "Not a member of this group" });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before ? new Date(req.query.before) : null;
    const filter = { groupId };
    if (before && !isNaN(before)) filter.createdAt = { $lt: before };

    const messages = await Message.find(filter).sort({ createdAt: -1 }).limit(limit)
      .populate("senderId", MEMBER_FIELDS).populate("replyTo", POPULATE_REPLY).lean();
    res.status(200).json(messages.reverse());
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

    const { fields, error } = await buildMessageFields(req.body);
    if (error) return res.status(400).json({ message: error });
    if (!(await replyBelongsTo(fields.replyTo, { groupId }))) return res.status(400).json({ message: "Invalid reply target" });

    const newMessage = await Message.create({ senderId, groupId, ...fields });
    await newMessage.populate("senderId", MEMBER_FIELDS);
    await newMessage.populate("replyTo", POPULATE_REPLY);

    group.lastMessage = newMessage._id;
    await group.save();

    emitToGroup(group._id, "newGroupMessage", { groupId: group._id, message: newMessage });
    res.status(201).json(newMessage);
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
    if (!(await User.exists({ _id: userId }))) return res.status(404).json({ message: "User not found" });

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
      emitToUser(userId, "removedFromGroup", { groupId });
      removeUserFromGroup(userId, group._id);
      return res.status(200).json({ ...group.toObject(), members: [] });
    }
    if (isAdmin && isSelf) group.admin = group.members[0];

    await group.save();
    await group.populate(POP);

    emitToUser(userId, "removedFromGroup", { groupId });
    removeUserFromGroup(userId, group._id);
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
