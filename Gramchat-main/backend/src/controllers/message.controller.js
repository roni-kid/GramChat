import mongoose from "mongoose";
import User from "../models/user.model.js";
import Group from "../models/group.model.js";
import Message from "../models/message.model.js";
import { emitToUser, emitToGroup } from "../lib/socket.js";
import { UploadError } from "../lib/storage.js";
import { buildMessageFields, replyBelongsTo, POPULATE_REPLY } from "../lib/messageUtils.js";

// Directory of people you can chat with. Public fields only: no email addresses.
export const getUsersForSidebar = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } }).select("fullName profilePic createdAt").lean();
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
    const msgs = await Message.find({ groupId: null, $or: [{ senderId: me }, { receiverId: me }] })
      .sort({ createdAt: -1 })
      .select("senderId receiverId text image fileName fileType createdAt isRead")
      .lean();
    const byUser = new Map();
    for (const m of msgs) {
      const other = (m.senderId.toString() === me.toString() ? m.receiverId : m.senderId)?.toString();
      if (!other) continue;
      if (!byUser.has(other)) {
        byUser.set(other, {
          userId: other,
          unread: 0,
          lastMessage: { text: m.text, image: !!m.image, fileName: m.fileName, senderId: m.senderId, createdAt: m.createdAt },
        });
      }
      if (!m.isRead && m.receiverId?.toString() === me.toString()) byUser.get(other).unread++;
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
      $or: [
        { senderId: myId, receiverId: userToChatId },
        { senderId: userToChatId, receiverId: myId },
      ],
    };
    if (before && !isNaN(before)) filter.createdAt = { $lt: before };

    const messages = await Message.find(filter).sort({ createdAt: -1 }).limit(limit).populate("replyTo", POPULATE_REPLY).lean();
    res.status(200).json(messages.reverse());
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
    if (!(await User.exists({ _id: receiverId }))) return res.status(404).json({ message: "User not found" });

    const { fields, error } = await buildMessageFields(req.body);
    if (error) return res.status(400).json({ message: error });
    if (!(await replyBelongsTo(fields.replyTo, { a: senderId, b: receiverId }))) {
      return res.status(400).json({ message: "Invalid reply target" });
    }

    const newMessage = await Message.create({ senderId, receiverId, ...fields });
    await newMessage.populate("replyTo", POPULATE_REPLY);

    emitToUser(receiverId, "newMessage", newMessage);
    emitToUser(senderId, "newMessage", newMessage); // sender's other tabs/devices
    res.status(201).json(newMessage);
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
      emitToUser(senderId, "messagesRead", { readBy: myId.toString() });
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
