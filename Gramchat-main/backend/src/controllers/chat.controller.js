import Group from "../models/group.model.js";
import ChatPref from "../models/chatPref.model.js";
import Contact from "../models/contact.model.js";
import { areContacts, pairKey } from "../lib/relations.js";
import { isValidTimer, timerChoices } from "../lib/disappearing.js";
import { emitToUser } from "../lib/socket.js";
import { MAX_PINNED_CHATS, MUTE_CHOICES, MUTE_FOREVER, isMutedNow, prefForClient } from "../lib/chatPrefs.js";

const KINDS = ["user", "group"];

/** GET /chats/prefs: every chat I pinned, archived or muted. Chats with no settings aren't listed. */
export const getChatPrefs = async (req, res) => {
  try {
    const rows = await ChatPref.find({ userId: req.user._id }).lean();
    const out = rows
      .map((r) => prefForClient(r.kind, r.targetId, r))
      .filter((p) => p.pinnedAt || p.archived || p.mutedUntil);
    res.status(200).json(out);
  } catch (error) {
    console.log("Error in getChatPrefs:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /chats/prefs/:kind/:id  { pinned?: boolean, archived?: boolean, mute?: "off" | "8h" | "1w" | "always" }
 *  kind: "user" (the chat with that contact) or "group". Only touches the settings you send.
 *  A chat can't be pinned and archived at once: archiving unpins it, pinning brings it back out of the archive. */
export const setChatPref = async (req, res) => {
  try {
    const me = req.user._id;
    const { kind, id } = req.params;
    if (!KINDS.includes(kind)) return res.status(400).json({ message: "Invalid chat type" });

    const { pinned, archived, mute } = req.body || {};
    if (pinned !== undefined && typeof pinned !== "boolean") return res.status(400).json({ message: "pinned must be true or false" });
    if (archived !== undefined && typeof archived !== "boolean") return res.status(400).json({ message: "archived must be true or false" });
    if (mute !== undefined && !["off", "always", ...Object.keys(MUTE_CHOICES)].includes(mute)) return res.status(400).json({ message: "mute must be off, 8h, 1w or always" });
    if (pinned === undefined && archived === undefined && mute === undefined) return res.status(400).json({ message: "Nothing to update" });
    if (pinned === true && archived === true) return res.status(400).json({ message: "A chat can't be pinned and archived at the same time" });

    // You can only organise chats you are part of (a 404 never reveals whether the other chat exists)
    if (kind === "user") {
      if (id === me.toString() || !(await areContacts(me, id))) return res.status(404).json({ message: "Chat not found" });
    } else if (!(await Group.exists({ _id: id, members: me }))) {
      return res.status(404).json({ message: "Chat not found" });
    }

    const pref = (await ChatPref.findOne({ userId: me, kind, targetId: id })) || new ChatPref({ userId: me, kind, targetId: id });

    if (archived === true) {
      pref.archived = true;
      pref.pinnedAt = undefined;
    } else if (archived === false) {
      pref.archived = false;
    }

    if (pinned === true) {
      if (!pref.pinnedAt) {
        const others = await ChatPref.countDocuments({ userId: me, pinnedAt: { $ne: null }, _id: { $ne: pref._id } });
        if (others >= MAX_PINNED_CHATS) return res.status(400).json({ message: `You can pin up to ${MAX_PINNED_CHATS} chats. Unpin one first.` });
        pref.pinnedAt = new Date();
      }
      pref.archived = false;
    } else if (pinned === false) {
      pref.pinnedAt = undefined;
    }

    if (mute === "off") pref.mutedUntil = undefined;
    else if (mute === "always") pref.mutedUntil = MUTE_FOREVER;
    else if (mute) pref.mutedUntil = new Date(Date.now() + MUTE_CHOICES[mute]);

    // Nothing special left: keep the collection clean
    if (!pref.pinnedAt && !pref.archived && !isMutedNow(pref)) {
      if (!pref.isNew) await ChatPref.deleteOne({ _id: pref._id });
    } else {
      await pref.save();
    }

    const out = prefForClient(kind, id, pref.pinnedAt || pref.archived || isMutedNow(pref) ? pref : null);
    emitToUser(me, "chatPref", out); // keeps my other tabs and devices in sync
    res.status(200).json(out);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Try again" }); // two requests created the row at once
    console.log("Error in setChatPref:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ── Phase 2E: disappearing messages for 1:1 chats ──
const sameId = (a, b) => a?.toString() === b?.toString();

/** GET /chats/timers: my 1:1 chats that have disappearing messages on, as [{ kind: "user", id, seconds }].
 *  (Groups carry `disappearAfter` in their own payload.) */
export const getChatTimers = async (req, res) => {
  try {
    const me = req.user._id;
    const rows = await Contact.find({ status: "accepted", disappearAfter: { $gt: 0 }, $or: [{ requester: me }, { recipient: me }] })
      .select("requester recipient disappearAfter").lean();
    res.status(200).json(rows.map((r) => ({ kind: "user", id: (sameId(r.requester, me) ? r.recipient : r.requester).toString(), seconds: r.disappearAfter })));
  } catch (error) {
    console.log("Error in getChatTimers:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /chats/timer/user/:id  { seconds } — either person can change the timer of their 1:1 chat. 0 = off.
 *  Only NEW messages are affected. Both people get a `chatTimer` event (with `by`, who changed it). */
export const setUserTimer = async (req, res) => {
  try {
    const me = req.user._id;
    const other = req.params.id;
    const seconds = req.body?.seconds;
    if (!isValidTimer(seconds)) return res.status(400).json({ message: `seconds must be one of ${timerChoices().join(", ")}` });
    if (other === me.toString() || !(await areContacts(me, other))) return res.status(404).json({ message: "Chat not found" });

    const before = await Contact.findOneAndUpdate(
      { pairKey: pairKey(me, other), status: "accepted" },
      { $set: { disappearAfter: seconds, disappearSetBy: me } },
      { new: false }
    );
    if (!before) return res.status(404).json({ message: "Chat not found" });

    if ((before.disappearAfter || 0) !== seconds) {
      emitToUser(me, "chatTimer", { kind: "user", id: other, seconds, by: me.toString() });
      emitToUser(other, "chatTimer", { kind: "user", id: me.toString(), seconds, by: me.toString() });
    }
    res.status(200).json({ kind: "user", id: other, seconds });
  } catch (error) {
    console.log("Error in setUserTimer:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};
