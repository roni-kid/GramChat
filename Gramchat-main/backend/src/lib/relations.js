import Contact from "../models/contact.model.js";
import Block from "../models/block.model.js";

export const pairKey = (a, b) => [a.toString(), b.toString()].sort().join(":");

// Tiny TTL cache: typing/call events check "are these two contacts?" very often.
const CACHE_MS = 5000;
const cache = new Map();
export const clearRelationCache = () => cache.clear();

export const areContacts = async (a, b) => {
  if (!a || !b) return false;
  const key = pairKey(a, b);
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = !!(await Contact.exists({ pairKey: key, status: "accepted" }));
  cache.set(key, { value, until: Date.now() + CACHE_MS });
  return value;
};

/** Ids of everyone I have an accepted contact with. */
export const getContactIds = async (userId) => {
  const rows = await Contact.find({ status: "accepted", $or: [{ requester: userId }, { recipient: userId }] }).select("requester recipient").lean();
  const me = userId.toString();
  return new Set(rows.map((r) => (r.requester.toString() === me ? r.recipient : r.requester).toString()));
};

export const isBlockedEitherWay = async (a, b) =>
  !!(await Block.exists({ key: { $in: [`${a}:${b}`, `${b}:${a}`] } }));

export const blockedByMe = async (me, other) => !!(await Block.exists({ key: `${me}:${other}` }));
export const hasBlockedMe = async (me, other) => !!(await Block.exists({ key: `${other}:${me}` }));
