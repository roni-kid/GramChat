// Web Push (RFC 8030 + VAPID). The `web-push` package is loaded lazily so the server still starts if it
// hasn't been installed yet (run `npm install --prefix backend`); push is then simply off.
import fs from "fs";
import path from "path";
import PushSubscription from "../models/pushSubscription.model.js";
import { mutedUserIds } from "./chatPrefs.js";
import { BACKEND_ROOT } from "./loadEnv.js";

let webpush = null;
let publicKey = null;

export const pushEnabled = () => !!webpush && !!publicKey;
export const getPublicKey = () => publicKey;

export const initPush = async () => {
  try {
    webpush = (await import("web-push")).default;
  } catch {
    console.log("Push notifications are OFF: the web-push package isn't installed. Run `npm install --prefix backend`.");
    return;
  }

  let pub = process.env.VAPID_PUBLIC_KEY;
  let priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    // No keys in .env: create them once and keep them in a file next to the server (never commit it).
    // Relative paths are relative to the backend folder: starting the server from another folder must not create a second key file
    // (new keys would silently break every device that already enabled notifications).
    const file = path.resolve(BACKEND_ROOT, process.env.VAPID_FILE || "vapid.json");
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      pub = saved.publicKey;
      priv = saved.privateKey;
    } catch { /* first run */ }
    if (!pub || !priv) {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
      console.log(`Created push (VAPID) keys in ${file}. Keep this file: if it is lost, every device must re-enable notifications.`);
    }
  }

  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);
    publicKey = pub;
    console.log("Push notifications are ON");
  } catch (e) {
    webpush = null;
    console.log("Push notifications are OFF: invalid VAPID settings:", e.message);
  }
};

// ── Subscription validation ──
// The server will POST to whatever endpoint a client registers, so only the browsers' own push services are accepted
// (otherwise a user could aim the server at internal addresses: SSRF).
const EXACT_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com"];
const HOST_SUFFIXES = [".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];

export const isAllowedEndpoint = (endpoint) => {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  const extra = (process.env.PUSH_EXTRA_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [...EXACT_HOSTS, ...extra].includes(host) || HOST_SUFFIXES.some((s) => host.endsWith(s));
};

const b64uLength = (s) => (typeof s === "string" && /^[A-Za-z0-9_-]+={0,2}$/.test(s) ? Buffer.from(s, "base64url").length : -1);

/** Returns the cleaned { endpoint, keys } or null. p256dh must be a 65-byte P-256 point, auth 16 bytes. */
export const cleanSubscription = (sub) => {
  if (!sub || typeof sub !== "object" || !isAllowedEndpoint(sub.endpoint)) return null;
  const { p256dh, auth } = sub.keys || {};
  if (b64uLength(p256dh) !== 65 || b64uLength(auth) !== 16) return null;
  return { endpoint: sub.endpoint, keys: { p256dh, auth } };
};

// ── Sending ──
const clip = (s, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const previewText = (m) =>
  m.viewOnce ? `👁 View-once ${m.viewOnceKind === "video" ? "video" : m.viewOnceKind === "audio" ? "voice message" : "photo"}` :
  m.voice ? "🎤 Voice message" : m.text ? clip(m.text) : m.image ? "📷 Photo" : m.fileName ? `📎 ${clip(m.fileName, 60)}` : "New message";

/** Sends build(sub) to every subscription of `userIds`. Dead subscriptions (404/410) are removed. Never throws. */
const sendToUsers = async (userIds, build) => {
  if (!pushEnabled() || !userIds.length) return;
  try {
    const subs = await PushSubscription.find({ userId: { $in: userIds } }).lean();
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(build(s)), { TTL: 24 * 60 * 60, urgency: "high", timeout: 10000 });
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) await PushSubscription.deleteOne({ _id: s._id });
          else console.log("push failed:", e.statusCode || e.message);
        }
      })
    );
  } catch (e) {
    console.log("push error:", e.message);
  }
};

/** New 1:1 message → the recipient's devices (unless they muted this chat). The service worker stays silent if the app is open and focused. */
export const notifyDM = async (msg, sender) => {
  if (!pushEnabled()) return;
  if ((await mutedUserIds([msg.receiverId], "user", sender._id)).has(msg.receiverId.toString())) return;
  await sendToUsers([msg.receiverId], (s) => ({
    v: 1, kind: "dm", chatId: sender._id.toString(), messageId: msg._id.toString(), tag: `dm:${sender._id}`,
    title: sender.fullName, body: s.preview ? previewText(msg) : "New message",
  }));
};

/** New group message → every member's devices except the sender's account and anyone who muted the group. */
export const notifyGroup = async (msg, sender, group) => {
  if (!pushEnabled()) return;
  const members = group.members.filter((id) => id.toString() !== sender._id.toString());
  const muted = await mutedUserIds(members, "group", group._id);
  await sendToUsers(members.filter((id) => !muted.has(id.toString())), (s) => ({
    v: 1, kind: "group", chatId: group._id.toString(), messageId: msg._id.toString(), tag: `group:${group._id}`,
    title: `${sender.fullName} · ${group.name}`, body: s.preview ? previewText(msg) : "New message",
  }));
};

/** "Send test notification" button in Settings. */
export const notifyTest = (userId) =>
  sendToUsers([userId], () => ({ v: 1, kind: "test", tag: "test", title: "Gramchat", body: "Notifications are working on this device." }));
