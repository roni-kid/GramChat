// Client-side message rules + small state helpers shared by the DM and group stores.
// EDIT_WINDOW_MS / DELETE_FOR_EVERYONE_MS mirror backend/src/lib/messageOps.js. The server is the authority:
// these only decide which menu items to show.
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const DELETE_FOR_EVERYONE_MS = 48 * 60 * 60 * 1000;
export const MAX_FORWARD_TARGETS = 5;

export const idOf = (v) => (v && v._id) || v;
export const isMine = (m, myId) => idOf(m.senderId) === myId;
const age = (m) => Date.now() - new Date(m.createdAt).getTime();

export const canEdit = (m, myId) => isMine(m, myId) && !m.deletedForEveryone && !m.voice && !m.viewOnce && age(m) <= EDIT_WINDOW_MS && !!(m.text || m.image || m.fileUrl);
export const canDeleteForEveryone = (m, myId) => isMine(m, myId) && !m.deletedForEveryone && age(m) <= DELETE_FOR_EVERYONE_MS;

/** "sent" (✓) → "delivered" (✓✓) → "read" (✓✓ in the accent colour) */
export const tickState = (m) => (m.isRead ? "read" : m.deliveredAt ? "delivered" : "sent");

// ── state helpers (pure) ──
export const patchById = (list, id, patch) => list.map((m) => (m._id === id ? { ...m, ...patch } : m));

const tombstone = (m) => ({
  _id: m._id, senderId: m.senderId, receiverId: m.receiverId, groupId: m.groupId,
  createdAt: m.createdAt, deliveredAt: m.deliveredAt, isRead: m.isRead,
  deletedForEveryone: true, reactions: [],
});

/** Message `id` was deleted for everyone: turn it into a tombstone and blank any quoted copy of it. */
export const applyDeletedToList = (list, id) =>
  list.map((m) => {
    if (m._id === id) return tombstone(m);
    if (m.replyTo?._id === id) return { ...m, replyTo: { ...m.replyTo, deletedForEveryone: true, text: undefined, image: undefined, fileName: undefined } };
    return m;
  });

/** Chat-list previews hold a lightweight copy of the last message: patch it if it is message `id`. */
export const patchLast = (conversations, id, patch) =>
  Object.fromEntries(Object.entries(conversations).map(([k, v]) => [k, v.lastMessage?._id === id ? { ...v, lastMessage: { ...v.lastMessage, ...patch } } : v]));

export const DELETED_PREVIEW_PATCH = { deletedForEveryone: true, text: undefined, image: false, fileName: undefined, voice: false };

// ── Phase 2E: disappearing messages ──
// The timers a chat can be set to, in seconds (0 = off). The server is the authority; these only fill the picker.
export const TIMER_CHOICES = [0, 24 * 3600, 7 * 24 * 3600, 90 * 24 * 3600];

/** 0 → "Off", 86400 → "24 hours", 604800 → "7 days", 7776000 → "90 days" */
export const timerLabel = (seconds) => {
  if (!seconds) return "Off";
  if (seconds === 24 * 3600) return "24 hours";
  if (seconds % 86400 === 0) return `${seconds / 86400} days`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`;
  return `${seconds} seconds`;
};

/** `ids` is a Set of message ids that disappeared: drop them from a list. */
export const removeIds = (list, ids) => list.filter((m) => !ids.has(m._id));
