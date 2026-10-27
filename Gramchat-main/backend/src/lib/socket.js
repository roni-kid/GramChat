import { Server } from "socket.io";
import http from "http";
import express from "express";
import jwt from "jsonwebtoken";
import { getClientOrigins } from "./config.js";
import User from "../models/user.model.js";
import Group from "../models/group.model.js";
import Message from "../models/message.model.js";
import { areContacts, getContactIds } from "./relations.js";
import { recordDelivered, emitReceiptBatches } from "./groupReceipts.js";

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
    header.split(";").map((c) => c.trim()).filter((c) => c.includes("=")).map((c) => {
      const i = c.indexOf("=");
      const raw = c.slice(i + 1);
      let value = raw;
      try { value = decodeURIComponent(raw); } catch { /* an unrelated, badly encoded cookie must not block the login cookie */ }
      return [c.slice(0, i), value];
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

// Group delivery receipts (Phase 2F): this device is connected now, so group messages it hasn't been told about are delivered.
const markGroupDelivered = async (userId) => {
  try {
    emitReceiptBatches(await recordDelivered(userId), emitToUser);
  } catch (e) {
    console.log("group delivery sweep failed:", e.message);
  }
};

const isMember = async (groupId, userId) => {
  if (!/^[a-f\d]{24}$/i.test(String(groupId))) return false;
  return !!(await Group.exists({ _id: groupId, members: userId }));
};

io.on("connection", (socket) => {
  const userId = socket.data.userId;
  socket.join(userRoom(userId));

  // A malformed payload (`null`, a string, ...) must never throw out of a handler: in Socket.IO an exception inside an event listener is an
  // uncaught exception and takes the whole server down. Every client event goes through `on`, which hands the handler a plain object
  // and logs (instead of throwing) anything that goes wrong.
  const on = (event, fn) =>
    socket.on(event, (payload) => {
      const fail = (e) => console.log(`socket ${event} failed:`, e?.message);
      try {
        const out = fn(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {});
        if (out && typeof out.catch === "function") out.catch(fail);
      } catch (e) {
        fail(e);
      }
    });

  // ── Typing (DM) ──
  const toContact = async (to, event, payload) => {
    try {
      if (typeof to === "string" && (await areContacts(userId, to))) emitToUser(to, event, payload);
    } catch (e) {
      console.log(`socket ${event} failed:`, e.message); // a database hiccup must never take the server down
    }
  };
  on("typing", ({ receiverId }) => toContact(receiverId, "userTyping", { senderId: userId }));
  on("stopTyping", ({ receiverId }) => toContact(receiverId, "userStopTyping", { senderId: userId }));

  // ── Typing (group): only members may emit into a group room ──
  on("groupTyping", ({ groupId }) => {
    if (typeof groupId === "string" && socket.rooms.has(groupRoom(groupId))) socket.to(groupRoom(groupId)).emit("groupUserTyping", { senderId: userId, groupId });
  });
  on("groupStopTyping", ({ groupId }) => {
    if (typeof groupId === "string" && socket.rooms.has(groupRoom(groupId))) socket.to(groupRoom(groupId)).emit("groupUserStopTyping", { senderId: userId, groupId });
  });

  // Kept for client compatibility, but membership is verified server-side.
  on("joinGroup", async ({ groupId }) => {
    if (await isMember(groupId, userId)) socket.join(groupRoom(groupId));
  });
  socket.on("leaveGroup", () => {});

  // ── WebRTC signalling. Caller identity/name/photo come from the server, not the client ──
  on("call:offer", async ({ to, offer, callType }) => {
    if (typeof to !== "string" || !offer || !["voice", "video"].includes(callType)) return;
    try {
      if (!(await areContacts(userId, to)) || !isUserOnline(to)) return socket.emit("call:unavailable", { to });
    } catch (e) {
      console.log("call:offer failed:", e.message);
      return socket.emit("call:unavailable", { to });
    }
    emitToUser(to, "call:incoming", {
      from: userId,
      offer,
      callType,
      callerInfo: { fullName: socket.data.user.fullName, profilePic: socket.data.user.profilePic },
    });
  });
  on("call:answer", ({ to, answer }) => toContact(to, "call:answered", { from: userId, answer }));
  on("call:reject", ({ to }) => toContact(to, "call:rejected", { from: userId }));
  on("call:end", ({ to }) => toContact(to, "call:ended", { from: userId }));
  on("call:ice-candidate", ({ to, candidate }) => toContact(to, "call:ice-candidate", { from: userId, candidate }));

  socket.on("disconnect", () => {
    // The adapter removes this socket from its rooms *after* this event, so recompute next tick.
    setImmediate(() => refreshPresence(userId));
  });

  // Join the group rooms (the server decides, the client can't choose) and run the catch-up sweeps AFTER all handlers above are
  // registered. Awaiting the database first used to drop any event the client sent in that gap, and a database error here
  // was an unhandled promise rejection.
  (async () => {
    try {
      const groups = await Group.find({ members: userId }).select("_id").lean();
      groups.forEach((g) => socket.join(groupRoom(g._id.toString())));
    } catch (e) {
      console.log("joining group rooms failed:", e.message);
    }
    refreshPresence(userId);
    markDelivered(userId);
    markGroupDelivered(userId);
  })();
});

export { io, app, server };
