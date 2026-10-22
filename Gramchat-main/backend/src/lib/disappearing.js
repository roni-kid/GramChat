// Disappearing messages (Phase 2E): the timer choices, the read-time filter, and the sweeper that deletes what has expired.
//
// A chat has a timer in seconds (0 = off): on the Contact row for a 1:1 chat (either person can change it) and on the Group
// for a group (admin only). A NEW message gets `expiresAt = now + timer` when the server stores it; messages already in
// the chat are not touched, and later changes of the timer don't change a message's expiry.
//
// Two layers make "gone" reliable: every query that lists messages hides anything past `expiresAt` right away
// (notExpired), and the sweeper deletes the rows and their files a few seconds later and tells the open chats.
import Message from "../models/message.model.js";
import Group from "../models/group.model.js";
import Contact from "../models/contact.model.js";
import { pairKey } from "./relations.js";
import { deleteUpload } from "./storage.js";
import { emitToUser, emitToGroup } from "./socket.js";
import { wipeViewOnceMedia } from "./viewOnce.js";

const DAY = 24 * 60 * 60;
const CHOICES = [0, DAY, 7 * DAY, 90 * DAY]; // off, 24 hours, 7 days, 90 days (like WhatsApp)

/** Allowed timers, in seconds. DISAPPEAR_ALLOW_SHORT_TIMERS=1 adds 5 seconds so the test suite can watch a message expire;
 *  never set it on a real server. (Read at call time, so it works whenever dotenv has loaded.) */
export const timerChoices = () => (process.env.DISAPPEAR_ALLOW_SHORT_TIMERS === "1" ? [...CHOICES, 5] : CHOICES);
export const isValidTimer = (n) => Number.isInteger(n) && timerChoices().includes(n);

/** Mongo filter fragment: messages that haven't expired (no expiry at all counts). Spread it into a find() filter. */
export const notExpired = () => ({ expiresAt: { $not: { $lte: new Date() } } });

/** The `expiresAt` for a message sent now into a chat with this timer (undefined = never). */
export const expiryFor = (seconds) => (seconds > 0 ? new Date(Date.now() + seconds * 1000) : undefined);

/** The timer of the 1:1 chat between two people (0 when off or when they aren't contacts). */
export const dmDisappearAfter = async (a, b) => {
  const row = await Contact.findOne({ pairKey: pairKey(a, b), status: "accepted" }).select("disappearAfter").lean();
  return row?.disappearAfter || 0;
};

const push = (map, key, id) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(id);
};

let running = false;

/** One pass: delete expired messages (rows, files, group previews) and tell the chats; wipe view-once media that is past its time. */
export const sweepOnce = async () => {
  if (running) return;
  running = true;
  try {
    const now = new Date();

    const due = await Message.find({ expiresAt: { $lte: now } })
      .select("senderId receiverId groupId image fileUrl linkPreview.image")
      .limit(500)
      .lean();
    if (due.length) {
      const ids = due.map((d) => d._id);
      await Message.deleteMany({ _id: { $in: ids } });
      for (const d of due) [d.image, d.fileUrl, d.linkPreview?.image].forEach((f) => f && deleteUpload(f));

      // A group's list preview points at its last message: move it back to the newest one that is still there
      const groupIds = [...new Set(due.filter((d) => d.groupId).map((d) => d.groupId.toString()))];
      for (const gid of groupIds) {
        const g = await Group.findById(gid).select("lastMessage").lean();
        if (g?.lastMessage && ids.some((i) => i.equals(g.lastMessage))) {
          const prev = await Message.findOne({ groupId: gid, ...notExpired() }).sort({ createdAt: -1 }).select("_id").lean();
          await Group.updateOne({ _id: gid }, prev ? { $set: { lastMessage: prev._id } } : { $unset: { lastMessage: 1 } }, { timestamps: false });
        }
      }

      // Tell the chats (1:1: both people; group: the room)
      const dm = new Map();
      const grp = new Map();
      for (const d of due) {
        const id = d._id.toString();
        if (d.groupId) push(grp, d.groupId.toString(), id);
        else push(dm, [d.senderId, d.receiverId].map(String).sort().join(":"), id);
      }
      for (const [pair, messageIds] of dm) pair.split(":").forEach((u) => emitToUser(u, "messagesExpired", { messageIds }));
      for (const [groupId, messageIds] of grp) emitToGroup(groupId, "messagesExpired", { messageIds, groupId });
    }

    // View-once media that is past its wipe time (never opened for 14 days, or opened and never closed)
    const stale = await Message.find({ viewOnce: true, mediaWiped: { $ne: true }, wipeAt: { $lte: now } }).limit(200);
    for (const m of stale) await wipeViewOnceMedia(m);
  } finally {
    running = false;
  }
};

/** Starts the background sweeper (every 30 s; DISAPPEAR_SWEEP_SECONDS changes that). Call once after the database is connected. */
export const startSweeper = () => {
  const every = Math.max(1, Number(process.env.DISAPPEAR_SWEEP_SECONDS) || 30) * 1000;
  if (process.env.DISAPPEAR_ALLOW_SHORT_TIMERS === "1") {
    console.log("WARNING: DISAPPEAR_ALLOW_SHORT_TIMERS is on (5-second timers are allowed). This is for the test suite only; never use it on a real server.");
  }
  const tick = () => sweepOnce().catch((e) => console.log("disappearing-messages sweep failed:", e.message));
  tick();
  setInterval(tick, every).unref();
};
