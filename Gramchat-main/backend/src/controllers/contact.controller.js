import mongoose from "mongoose";
import User from "../models/user.model.js";
import Contact from "../models/contact.model.js";
import Block from "../models/block.model.js";
import { pairKey, clearRelationCache, blockedByMe, hasBlockedMe } from "../lib/relations.js";
import { normalizeUsername } from "../lib/username.js";
import { emitToUser, refreshPresence } from "../lib/socket.js";

const PUB = "username fullName profilePic";
const MAX_PENDING_OUT = 50;
const idStr = (v) => v.toString();

const changed = (userIds, event) => userIds.forEach((id) => emitToUser(id, "contactsChanged", event));

// Everything the contacts screen needs in one call
export const listContacts = async (req, res) => {
  try {
    const me = req.user._id;
    const rows = await Contact.find({ $or: [{ requester: me }, { recipient: me }] }).populate("requester", PUB).populate("recipient", PUB).sort({ updatedAt: -1 }).lean();
    const out = { contacts: [], incoming: [], outgoing: [], blocked: [] };
    for (const r of rows) {
      const mine = idStr(r.requester._id) === idStr(me);
      const other = mine ? r.recipient : r.requester;
      if (r.status === "accepted") out.contacts.push(other);
      else if (mine) out.outgoing.push(other);
      else out.incoming.push(other);
    }
    const blocks = await Block.find({ blocker: me }).populate("blocked", PUB).lean();
    out.blocked = blocks.map((b) => b.blocked).filter(Boolean);
    res.status(200).json(out);
  } catch (error) {
    console.log("Error in listContacts:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Exact-username lookup only (no browsing/prefix search, so the user base can't be scraped)
export const searchUser = async (req, res) => {
  try {
    const me = req.user._id;
    const uname = normalizeUsername(req.query.username);
    if (!uname) return res.status(400).json({ message: "Enter a username" });
    const user = await User.findOne({ username: uname }).select(PUB).lean();
    if (!user || idStr(user._id) === idStr(me) || (await hasBlockedMe(me, user._id))) return res.status(404).json({ message: "No user with that username" });

    let relation = "none";
    if (await blockedByMe(me, user._id)) relation = "blocked";
    else {
      const c = await Contact.findOne({ pairKey: pairKey(me, user._id) }).lean();
      if (c) relation = c.status === "accepted" ? "contact" : idStr(c.requester) === idStr(me) ? "pending_out" : "pending_in";
    }
    res.status(200).json({ ...user, relation });
  } catch (error) {
    console.log("Error in searchUser:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const sendRequest = async (req, res) => {
  try {
    const me = req.user._id;
    const target = await User.findById(req.params.userId).select(PUB).lean();
    if (!target || idStr(target._id) === idStr(me)) return res.status(404).json({ message: "User not found" });

    if (await blockedByMe(me, target._id)) return res.status(400).json({ message: "Unblock this person first" });
    // If THEY blocked me, answer as if it worked, so a block never reveals itself
    if (await hasBlockedMe(me, target._id)) return res.status(200).json({ status: "pending" });

    const key = pairKey(me, target._id);
    const existing = await Contact.findOne({ pairKey: key });
    if (existing) {
      if (existing.status === "accepted") return res.status(400).json({ message: "Already in your contacts" });
      if (idStr(existing.requester) === idStr(me)) return res.status(200).json({ status: "pending" });
      // they already asked me: asking back = accept
      existing.status = "accepted";
      await existing.save();
      clearRelationCache();
      changed([me, target._id], { type: "accepted", user: { _id: idStr(me), username: req.user.username, fullName: req.user.fullName } });
      refreshPresence(me); refreshPresence(target._id);
      return res.status(200).json({ status: "accepted" });
    }

    if ((await Contact.countDocuments({ requester: me, status: "pending" })) >= MAX_PENDING_OUT) {
      return res.status(429).json({ message: "Too many pending requests. Wait for replies first." });
    }
    await Contact.create({ requester: me, recipient: target._id, pairKey: key, status: "pending" });
    clearRelationCache();
    emitToUser(target._id, "contactsChanged", { type: "request", user: { _id: idStr(me), username: req.user.username, fullName: req.user.fullName } });
    emitToUser(me, "contactsChanged", { type: "sent" });
    res.status(201).json({ status: "pending" });
  } catch (error) {
    if (error.code === 11000) return res.status(200).json({ status: "pending" });
    console.log("Error in sendRequest:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const acceptRequest = async (req, res) => {
  try {
    const me = req.user._id;
    const other = req.params.userId;
    const c = await Contact.findOne({ pairKey: pairKey(me, other), status: "pending", recipient: me });
    if (!c) return res.status(404).json({ message: "No pending request from this person" });
    c.status = "accepted";
    await c.save();
    clearRelationCache();
    changed([me, other], { type: "accepted", user: { _id: idStr(me), username: req.user.username, fullName: req.user.fullName } });
    refreshPresence(me); refreshPresence(other);
    res.status(200).json({ status: "accepted" });
  } catch (error) {
    console.log("Error in acceptRequest:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Decline an incoming request, cancel an outgoing one, or remove an existing contact
export const removeContact = async (req, res) => {
  try {
    const me = req.user._id;
    const other = req.params.userId;
    const r = await Contact.deleteOne({ pairKey: pairKey(me, other) });
    if (!r.deletedCount) return res.status(404).json({ message: "Not found" });
    clearRelationCache();
    changed([me, other], { type: "removed", userId: idStr(me) });
    refreshPresence(me); refreshPresence(other);
    res.status(200).json({ success: true });
  } catch (error) {
    console.log("Error in removeContact:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const blockUser = async (req, res) => {
  try {
    const me = req.user._id;
    const other = req.params.userId;
    if (idStr(me) === other) return res.status(400).json({ message: "You can't block yourself" });
    if (!(await User.exists({ _id: other }))) return res.status(404).json({ message: "User not found" });
    await Block.updateOne({ key: `${me}:${other}` }, { $setOnInsert: { blocker: me, blocked: other, key: `${me}:${other}` } }, { upsert: true });
    await Contact.deleteOne({ pairKey: pairKey(me, other) }); // blocking ends the relationship (and any request)
    clearRelationCache();
    changed([me, other], { type: "removed", userId: idStr(me) }); // they just see you disappear; no "blocked" signal
    refreshPresence(me); refreshPresence(other);
    res.status(200).json({ success: true });
  } catch (error) {
    console.log("Error in blockUser:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const unblockUser = async (req, res) => {
  try {
    await Block.deleteOne({ key: `${req.user._id}:${req.params.userId}` });
    emitToUser(req.user._id, "contactsChanged", { type: "unblocked" });
    res.status(200).json({ success: true });
  } catch (error) {
    console.log("Error in unblockUser:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};
