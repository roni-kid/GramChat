// Idempotent startup migration so accounts/data created before Phase 1 keep working.
import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import Contact from "../models/contact.model.js";
import { suggestUsername } from "./username.js";
import { pairKey } from "./relations.js";
import mongoose from "mongoose";

export const runMigrations = async () => {
  // 1. email is no longer unique (usernames are the identity). Drop the old unique index if present.
  try {
    await User.collection.dropIndex("email_1");
    console.log("[migrate] dropped legacy unique email index");
  } catch {
    /* not present: fine */
  }

  // 2. give every legacy account a username (derived from its email/name), unique
  const missing = await User.find({ $or: [{ username: { $exists: false } }, { username: null }, { username: "" }] }).select("email fullName createdAt").sort({ createdAt: 1 });
  if (missing.length) {
    const taken = new Set((await User.find({ username: { $type: "string" } }).select("username").lean()).map((u) => u.username));
    for (const u of missing) {
      const base = suggestUsername(u.email || u.fullName);
      let name = base, n = 1;
      while (taken.has(name)) name = `${base.slice(0, 16)}${++n}`;
      taken.add(name);
      await User.updateOne({ _id: u._id }, { $set: { username: name } });
    }
    console.log(`[migrate] assigned usernames to ${missing.length} existing account(s)`);
  }
  await User.collection.createIndex({ username: 1 }, { unique: true, name: "username_1" });

  // 3. one-time: people who already chatted become contacts, so existing conversations keep working
  const metaCol = mongoose.connection.collection("meta");
  if (!(await metaCol.findOne({ _id: "contacts_from_dms_v1" }))) {
    const msgs = await Message.find({ groupId: null, receiverId: { $ne: null } }).select("senderId receiverId").lean();
    const pairs = new Map();
    for (const m of msgs) {
      if (!m.receiverId) continue;
      pairs.set(pairKey(m.senderId, m.receiverId), [m.senderId, m.receiverId]);
    }
    let made = 0;
    for (const [key, [a, b]] of pairs) {
      try {
        await Contact.create({ requester: a, recipient: b, pairKey: key, status: "accepted" });
        made++;
      } catch {
        /* already exists */
      }
    }
    await metaCol.insertOne({ _id: "contacts_from_dms_v1", at: new Date(), made });
    if (made) console.log(`[migrate] turned ${made} existing conversation(s) into contacts`);
  }
};
