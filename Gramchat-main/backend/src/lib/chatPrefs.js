// Helpers for per-chat settings (pin / archive / mute). The model is in models/chatPref.model.js.
import ChatPref from "../models/chatPref.model.js";

export const MAX_PINNED_CHATS = 3; // like WhatsApp: pin up to 3 chats to the top of the list
export const MUTE_FOREVER = new Date("2999-01-01T00:00:00.000Z"); // "mute always"
export const MUTE_CHOICES = { "8h": 8 * 60 * 60 * 1000, "1w": 7 * 24 * 60 * 60 * 1000 };

export const isMutedNow = (pref, now = Date.now()) => !!pref?.mutedUntil && new Date(pref.mutedUntil).getTime() > now;

/** What the app sees for one chat. An expired mute reads as "not muted". */
export const prefForClient = (kind, targetId, pref) => ({
  kind,
  id: targetId.toString(),
  pinnedAt: pref?.pinnedAt || null,
  archived: !!pref?.archived,
  mutedUntil: isMutedNow(pref) ? pref.mutedUntil : null,
});

/** Which of `userIds` currently have this chat muted. Fails open (empty set) so a database hiccup never blocks a notification. */
export const mutedUserIds = async (userIds, kind, targetId) => {
  if (!userIds.length) return new Set();
  try {
    const rows = await ChatPref.find({ userId: { $in: userIds }, kind, targetId, mutedUntil: { $gt: new Date() } }).select("userId").lean();
    return new Set(rows.map((r) => r.userId.toString()));
  } catch (e) {
    console.log("mute lookup failed:", e.message);
    return new Set();
  }
};
