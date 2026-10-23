// Group delivery and read receipts (Phase 2F): the "per-member ticks".
//
// 1:1 chats keep using `deliveredAt` and `isRead`. A group message records WHO got it (`deliveredTo`) and WHO read it
// (`readBy`). Those arrays never leave the server: the sender gets counts (`ticks`) and, on request, the list of people
// (GET /messages/info/:id).
//
// Privacy, same idea as 1:1 chats: read receipts are reciprocal.
//  * Someone with read receipts OFF is never shown as having read anything, and doesn't count towards "seen by everyone".
//  * A sender with read receipts OFF sees no read information at all.
// Delivery is always shown. Reads are always RECORDED (so the server doesn't rescan the same history on every call) and the
// privacy filter is applied whenever they are turned into counts or lists.
//
// This file doesn't import the socket layer (socket.js imports it): functions return what has to be emitted.
import Message from "../models/message.model.js";
import Group from "../models/group.model.js";
import User from "../models/user.model.js";

const SWEEP_DAYS = 30;   // on connect, messages from the last 30 days that this device hasn't been marked as receiving yet
const BATCH = 500;
const EVENT_CHUNK = 200; // updates per socket event

const sid = (v) => String(v?._id || v);

/** Who is in the group now, and which of them have read receipts turned off. `group` needs `members`. */
export const receiptContext = async (group) => {
  const memberIds = (group?.members || []).map(sid);
  const off = memberIds.length ? await User.find({ _id: { $in: memberIds }, "privacy.readReceipts": false }).select("_id").lean() : [];
  return { memberIds, noReceipts: new Set(off.map((u) => u._id.toString())) };
};

const idSet = (arr) => new Set((arr || []).map((e) => String(e.userId)));

/** Counts for the sender's ticks: { total, delivered, read, readTotal }.
 *  total = other members; delivered = of those, who received it; readTotal = of those, who share read receipts; read = of those, who read it. */
export const ticksFor = (msg, ctx) => {
  const sender = sid(msg.senderId);
  const others = ctx.memberIds.filter((id) => id !== sender);
  const readers = idSet(msg.readBy);
  const got = idSet(msg.deliveredTo);
  readers.forEach((id) => got.add(id)); // reading implies receiving
  const eligible = ctx.noReceipts.has(sender) ? [] : others.filter((id) => !ctx.noReceipts.has(id));
  return {
    total: others.length,
    delivered: others.filter((id) => got.has(id)).length,
    read: eligible.filter((id) => readers.has(id)).length,
    readTotal: eligible.length,
  };
};

/** Ticks of a message that was just sent (nobody has read it yet; readTotal is refined by the first receipt event). */
export const freshTicks = (group, msg) => {
  const total = Math.max(0, (group.members || []).length - 1);
  return { total, delivered: idSet(msg.deliveredTo).size, read: 0, readTotal: total };
};

/** `deliveredTo` entries for the members that are online right now (everyone but the sender), or undefined when nobody is. */
export const deliveredNow = (memberIds, senderId, isOnline) => {
  const at = new Date();
  const list = (memberIds || []).map(sid).filter((id) => id !== sid(senderId) && isOnline(id)).map((id) => ({ userId: id, at }));
  return list.length ? list : undefined;
};

/** Turns updated message ids into one batch per (sender, group): [{ senderId, groupId, updates: [{ messageId, ticks }] }]. */
const buildBatches = async (ids) => {
  const msgs = await Message.find({ _id: { $in: ids } }).select("senderId groupId deliveredTo readBy").lean();
  const contexts = new Map();
  const out = new Map();
  for (const m of msgs) {
    const gid = String(m.groupId);
    if (!contexts.has(gid)) contexts.set(gid, await receiptContext(await Group.findById(gid).select("members").lean()));
    const key = `${m.senderId}|${gid}`;
    if (!out.has(key)) out.set(key, { senderId: String(m.senderId), groupId: gid, updates: [] });
    out.get(key).updates.push({ messageId: String(m._id), ticks: ticksFor(m, contexts.get(gid)) });
  }
  return [...out.values()];
};

/** `userId`'s device is connected: mark what it hasn't received yet as delivered (last 30 days, every group they are in). */
export const recordDelivered = async (userId) => {
  const groups = (await Group.find({ members: userId }).select("_id").lean()).map((g) => g._id);
  if (!groups.length) return [];
  const since = new Date(Date.now() - SWEEP_DAYS * 24 * 60 * 60 * 1000);
  const touched = [];
  for (let i = 0; i < 10; i++) {
    const rows = await Message.find({ groupId: { $in: groups }, senderId: { $ne: userId }, "deliveredTo.userId": { $ne: userId }, createdAt: { $gte: since } })
      .select("_id").limit(BATCH).lean();
    if (!rows.length) break;
    const ids = rows.map((r) => r._id);
    await Message.updateMany({ _id: { $in: ids }, "deliveredTo.userId": { $ne: userId } }, { $push: { deliveredTo: { userId, at: new Date() } } });
    touched.push(...ids);
    if (rows.length < BATCH) break;
  }
  return touched.length ? buildBatches(touched) : [];
};

/** `userId` is looking at the group: everything from other members they haven't read yet is now read (and delivered). */
export const recordRead = async (userId, groupId) => {
  const touched = [];
  for (let i = 0; i < 10; i++) {
    const rows = await Message.find({ groupId, senderId: { $ne: userId }, "readBy.userId": { $ne: userId } }).select("_id").limit(BATCH).lean();
    if (!rows.length) break;
    const ids = rows.map((r) => r._id);
    const at = new Date();
    await Message.updateMany({ _id: { $in: ids }, "deliveredTo.userId": { $ne: userId } }, { $push: { deliveredTo: { userId, at } } });
    await Message.updateMany({ _id: { $in: ids }, "readBy.userId": { $ne: userId } }, { $push: { readBy: { userId, at } } });
    touched.push(...ids);
    if (rows.length < BATCH) break;
  }
  return touched.length ? buildBatches(touched) : [];
};

/** Sends each batch to the sender as `groupReceipt` events (absolute counts, so a repeated event can't double count). */
export const emitReceiptBatches = (batches, emitToUser) => {
  for (const b of batches) {
    for (let i = 0; i < b.updates.length; i += EVENT_CHUNK) {
      emitToUser(b.senderId, "groupReceipt", { groupId: b.groupId, updates: b.updates.slice(i, i + EVENT_CHUNK) });
    }
  }
};

/** The people behind the ticks, for "Message info": { total, readHidden, read, delivered, pending } with { userId, at } entries. */
export const infoFor = async (msg, group) => {
  const ctx = await receiptContext(group);
  const sender = sid(msg.senderId);
  const at = (arr) => new Map((arr || []).map((e) => [String(e.userId), e.at]));
  const readAt = at(msg.readBy);
  const gotAt = at(msg.deliveredTo);
  const readHidden = ctx.noReceipts.has(sender);
  const read = [];
  const delivered = [];
  const pending = [];
  const others = ctx.memberIds.filter((m) => m !== sender);
  for (const id of others) {
    if (!readHidden && !ctx.noReceipts.has(id) && readAt.get(id)) read.push({ userId: id, at: readAt.get(id) });
    else if (gotAt.get(id) || readAt.get(id)) delivered.push({ userId: id, at: gotAt.get(id) || readAt.get(id) });
    else pending.push({ userId: id });
  }
  const newest = (a, b) => new Date(b.at) - new Date(a.at);
  read.sort(newest);
  delivered.sort(newest);
  return { total: others.length, readHidden, read, delivered, pending };
};
