import { Server } from "socket.io";
import http from "http";
import express from "express";
import jwt from "jsonwebtoken";
import { getClientOrigins } from "./config.js";
import User from "../models/user.model.js";
import Group from "../models/group.model.js";
import Message from "../models/message.model.js";
import { areContacts, getContactIds } from "./relations.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: getClientOrigins(), credentials: true },
  maxHttpBufferSize: 1e6,
});

// Every socket of a user joins the room `user:<id>`, so a user can be connected from
// several tabs/devices at once and each of them receives every event.
const userRoom = (id) => `user:${id}`;
const groupRoom = (id) => `group:${id}`;

export const emitToUser = (userId, event, payload) => {
  if (!userId) return;
  io.to(userRoom(userId.toString())).emit(event, payload);
};
export const emitToGroup = (groupId, event, payload) => io.to(groupRoom(groupId.toString())).emit(event, payload);
export const joinUserToGroup = (userId, groupId) => io.in(userRoom(userId.toString())).socketsJoin(groupRoom(groupId.toString()));
export const removeUserFromGroup = (userId, groupId) => io.in(userRoom(userId.toString())).socketsLeave(groupRoom(groupId.toString()));
export const isUserOnline = (userId) => (io.sockets.adapter.rooms.get(userRoom(userId.toString()))?.size || 0) > 0;

// Presence is only shared between contacts, and never for people who switched "show when I'm online" off.
const emitPresence = async (userId) => {
  const contacts = await getContactIds(userId);
  const online = [...contacts].filter(isUserOnline);
  let visible = online;
  if (online.length) {
    const hidden = new Set((await User.find({ _id: { $in: online }, "privacy.showOnline": false }).select("_id").lean()).map((u) => u._id.toString()));
    visible = online.filter((id) => !hidden.has(id));
  }
  emitToUser(userId, "getOnlineUsers", visible);
};

/** Recompute what `userId` sees, and what each of their contacts sees about them. */
export const refreshPresence = async (userId) => {
  try {
    await emitPresence(userId);
    for (const c of await getContactIds(userId)) if (isUserOnline(c)) await emitPresence(c);
  } catch (e) {
    console.log("presence refresh failed:", e.message);
  }
};

const parseCookies = (header = "") =>
  Object.fromEntries(
    header.split(";").map((c) => c.trim()).filter(Boolean).map((c) => {
      const i = c.indexOf("=");
      return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
    })
  );

// ── Authentication: identity comes ONLY from the signed login cookie, never from the client ──
io.use(async (socket, next) => {
  try {
    const token = parseCookies(socket.handshake.headers.cookie).jwt;
    if (!token) return next(new Error("unauthorized"));
    const { userId } = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(userId).select("_id fullName profilePic").lean();
    if (!user) return next(new Error("unauthorized"));
    socket.data.userId = user._id.toString();
    socket.data.user = user;
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});

// Delivery receipts: anything sent to `userId` while they had no connection is now delivered (second tick for the sender).
const markDelivered = async (userId) => {
  try {
    const pending = { receiverId: userId, groupId: null, deliveredAt: null };
    const senders = await Message.distinct("senderId", pending);
    if (!senders.length) return;
    await Message.updateMany(pending, { $set: { deliveredAt: new Date() } });
    senders.forEach((s) => emitToUser(s, "messagesDelivered", { to: userId.toString() }));
  } catch (e) {
    console.log("delivery sweep failed:", e.message);
  }
};

const isMember = async (groupId, userId) => {
  if (!/^[a-f\d]{24}$/i.test(String(groupId))) return false;
  return !!(await Group.exists({ _id: groupId, members: userId }));
};

io.on("connection", async (socket) => {
  const userId = socket.data.userId;
  socket.join(userRoom(userId));

  // Join the rooms of every group this user belongs to (server decides, client can't choose)
  const groups = await Group.find({ members: userId }).select("_id").lean();
  groups.forEach((g) => socket.join(groupRoom(g._id.toString())));

  refreshPresence(userId);
  markDelivered(userId);

  // ── Typing (DM) ──
  const toContact = async (to, event, payload) => {
    if (typeof to === "string" && (await areContacts(userId, to))) emitToUser(to, event, payload);
  };
  socket.on("typing", ({ receiverId } = {}) => toContact(receiverId, "userTyping", { senderId: userId }));
  socket.on("stopTyping", ({ receiverId } = {}) => toContact(receiverId, "userStopTyping", { senderId: userId }));

  // ── Typing (group): only members may emit into a group room ──
  socket.on("groupTyping", ({ groupId } = {}) => {
    if (socket.rooms.has(groupRoom(groupId))) socket.to(groupRoom(groupId)).emit("groupUserTyping", { senderId: userId, groupId });
  });
  socket.on("groupStopTyping", ({ groupId } = {}) => {
    if (socket.rooms.has(groupRoom(groupId))) socket.to(groupRoom(groupId)).emit("groupUserStopTyping", { senderId: userId, groupId });
  });

  // Kept for client compatibility, but membership is verified server-side.
  socket.on("joinGroup", async ({ groupId } = {}) => {
    if (await isMember(groupId, userId)) socket.join(groupRoom(groupId));
  });
  socket.on("leaveGroup", () => {});

  // ── WebRTC signalling. Caller identity/name/photo come from the server, not the client ──
  socket.on("call:offer", async ({ to, offer, callType } = {}) => {
    if (typeof to !== "string" || !offer || !["voice", "video"].includes(callType)) return;
    if (!(await areContacts(userId, to)) || !isUserOnline(to)) return socket.emit("call:unavailable", { to });
    emitToUser(to, "call:incoming", {
      from: userId,
      offer,
      callType,
      callerInfo: { fullName: socket.data.user.fullName, profilePic: socket.data.user.profilePic },
    });
  });
  socket.on("call:answer", ({ to, answer } = {}) => toContact(to, "call:answered", { from: userId, answer }));
  socket.on("call:reject", ({ to } = {}) => toContact(to, "call:rejected", { from: userId }));
  socket.on("call:end", ({ to } = {}) => toContact(to, "call:ended", { from: userId }));
  socket.on("call:ice-candidate", ({ to, candidate } = {}) => toContact(to, "call:ice-candidate", { from: userId, candidate }));

  socket.on("disconnect", () => {
    // The adapter removes this socket from its rooms *after* this event, so recompute next tick.
    setImmediate(() => refreshPresence(userId));
  });
});

export { io, app, server };
