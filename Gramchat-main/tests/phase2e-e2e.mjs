// Phase 2E API checks: disappearing messages and view-once media.
// Runs against a live server like the other suites (see tests/README.md): restart the server between runs and start it with
// SIGNUP_LIMIT_PER_HOUR=500.
//
// Two modes (like 2D):
//  * normal server: everything except "watch a message actually expire" (24 hours is too long to wait).
//  * test-switch server: start it with DISAPPEAR_ALLOW_SHORT_TIMERS=1 and DISAPPEAR_SWEEP_SECONDS=2, then run this with SHORT=1.
//    That allows a 5-second timer and checks that messages vanish, files are deleted and chats are told.
//    NEVER run a real server with DISAPPEAR_ALLOW_SHORT_TIMERS=1.
import { createRequire } from "node:module";
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { io } = require("socket.io-client");

const BASE = process.env.BASE || "http://localhost:5001";
const API = BASE + "/api";
const SHORT = process.env.SHORT === "1";
const results = [];
const log = (area, name, pass, detail = "") => {
  results.push({ area, name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} [${area}] ${name}${detail ? " — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s).toString("base64");
// Not real media: the server checks the declared type, not the bytes
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const AUDIO = (type = "audio/webm") => `data:${type};base64,${b64("not really opus but good enough for a type check")}`;
const VIDEO = `data:video/mp4;base64,${b64("not really a video but good enough for a type check")}`;
const PDF = `data:application/pdf;base64,${b64("%PDF-1.4 fake")}`;

class Client {
  constructor(label) { this.label = label; this.cookie = ""; this.user = null; this.sock = null; this.events = []; }
  async req(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get("set-cookie");
    if (sc && sc.startsWith("jwt=")) this.cookie = sc.split(";")[0];
    let data = null; try { data = await res.json(); } catch { /* binary / empty */ }
    return { status: res.status, data };
  }
  // A GET of a full path (e.g. a media link), returning status + headers, never parsing the body
  async raw(url) {
    const res = await fetch(BASE + url, { headers: this.cookie ? { Cookie: this.cookie } : {} });
    const size = (await res.arrayBuffer()).byteLength;
    return { status: res.status, type: res.headers.get("content-type") || "", cache: res.headers.get("cache-control") || "", size };
  }
  connect() {
    return new Promise((resolve) => {
      this.sock = io(BASE, { transports: ["websocket"], extraHeaders: { Cookie: this.cookie }, reconnection: false });
      this.sock.onAny((ev, payload) => this.events.push({ ev, payload }));
      this.sock.on("connect", () => resolve(true));
      this.sock.on("connect_error", () => resolve(false));
    });
  }
  async waitFor(ev, pred = () => true, ms = 1500) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = this.events.filter((e) => e.ev === ev).map((e) => e.payload).find(pred);
      if (hit) return hit;
      await sleep(40);
    }
    return null;
  }
}

const stamp = Date.now();
const mk = async (label) => {
  const c = new Client(label);
  const r = await c.req("POST", "/auth/signup", { username: `${label.toLowerCase().slice(0, 6)}${String(stamp).slice(-9)}`, fullName: label, password: "secret123" });
  c.user = r.data;
  return c;
};
const befriend = async (a, b) => { await a.req("POST", `/contacts/request/${b.user._id}`); return (await b.req("POST", `/contacts/accept/${a.user._id}`)).status === 200; };
const sendDM = (from, to, body) => from.req("POST", `/messages/send/${to.user._id}`, body);
const dmHistory = async (c, other) => (await c.req("GET", `/messages/${other.user._id}`)).data || [];
const secondsFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / 1000;
const near = (iso, seconds) => !!iso && Math.abs(secondsFromNow(iso) - seconds) < 120;
const DAY = 86400;

const alice = await mk("Alice2e"), bob = await mk("Bob2e"), carol = await mk("Carol2e"), dave = await mk("Dave2e");
await befriend(alice, bob); await befriend(alice, carol);
await alice.connect(); await bob.connect(); await carol.connect(); await dave.connect();
log("setup", "four users; alice is a contact of bob and carol, dave is nobody's contact", !!(alice.user && bob.user && carol.user && dave.user));
const anon = new Client("anon");

// ───────────────────────── DISAPPEARING: timers ─────────────────────────
console.log("\n=== DISAPPEARING MESSAGES: TIMERS ===");
let r = await alice.req("GET", "/chats/timers");
log("timer", "no timers to begin with", r.status === 200 && Array.isArray(r.data) && r.data.length === 0);
r = await anon.req("GET", "/chats/timers");
log("timer", "timers require login", r.status === 401);
r = await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: 123 });
log("timer", "an arbitrary duration is refused", r.status === 400, r.data?.message);
r = await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: String(DAY) });
log("timer", "a non-number is refused", r.status === 400);
r = await alice.req("PUT", `/chats/timer/user/${dave.user._id}`, { seconds: DAY });
log("timer", "you can't set it for someone who isn't your contact", r.status === 404);
r = await alice.req("PUT", `/chats/timer/user/${alice.user._id}`, { seconds: DAY });
log("timer", "…or for yourself", r.status === 404);

const before = (await sendDM(alice, bob, { text: "sent before the timer" })).data;
log("timer", "a message sent while the timer is off has no expiry", before && !before.expiresAt);

r = await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: DAY });
log("timer", "alice turns on 24 hours for her chat with bob", r.status === 200 && r.data?.seconds === DAY);
const evBob = await bob.waitFor("chatTimer", (p) => p.id === alice.user._id && p.seconds === DAY);
log("timer", "bob is told live, including who changed it", evBob?.by === alice.user._id && evBob?.kind === "user");
log("timer", "alice's own devices are told too", !!(await alice.waitFor("chatTimer", (p) => p.id === bob.user._id && p.seconds === DAY)));
r = await bob.req("GET", "/chats/timers");
log("timer", "bob's list of timers has it", r.data?.some((t) => t.id === alice.user._id && t.seconds === DAY));

const timed = (await sendDM(alice, bob, { text: "this one will disappear" })).data;
log("timer", "a new message expires in 24 hours", near(timed?.expiresAt, DAY), timed?.expiresAt);
const hist = await dmHistory(bob, alice);
log("timer", "…and bob sees the same expiry", near(hist.find((m) => m._id === timed?._id)?.expiresAt, DAY));
log("timer", "…while the older message keeps no expiry (a change is never retroactive)", !hist.find((m) => m._id === before?._id)?.expiresAt);
const bobMsg = (await sendDM(bob, alice, { text: "bob writes too" })).data;
log("timer", "the timer is shared: bob's message expires as well", near(bobMsg?.expiresAt, DAY));

r = await bob.req("PUT", `/chats/timer/user/${alice.user._id}`, { seconds: 0 });
log("timer", "either person can change it: bob turns it off", r.status === 200);
const untimed = (await sendDM(alice, bob, { text: "no timer again" })).data;
log("timer", "after switching off, new messages don't expire", untimed && !untimed.expiresAt);
r = await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: 7 * DAY });
log("timer", "7 days is accepted", r.status === 200);
r = await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: 90 * DAY });
log("timer", "90 days is accepted", r.status === 200);
r = await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: 7 * DAY });

// Group timers
r = await alice.req("POST", "/groups", { name: "Timers 2E", memberIds: [bob.user._id, carol.user._id] });
const gid = r.data?._id;
log("timer", "setup: group alice (admin) + bob + carol", r.status === 201 && !!gid && r.data.disappearAfter === 0);
r = await bob.req("PUT", `/groups/${gid}/disappearing`, { seconds: 7 * DAY });
log("timer", "only the admin can change a group's timer", r.status === 403);
r = await dave.req("PUT", `/groups/${gid}/disappearing`, { seconds: 7 * DAY });
log("timer", "an outsider gets 404", r.status === 404);
r = await alice.req("PUT", `/groups/${gid}/disappearing`, { seconds: 5000 });
log("timer", "an arbitrary group duration is refused", r.status === 400);
bob.events = [];
r = await alice.req("PUT", `/groups/${gid}/disappearing`, { seconds: 7 * DAY });
log("timer", "the admin turns on 7 days", r.status === 200 && r.data?.disappearAfter === 7 * DAY);
log("timer", "members get the group update with the new timer", !!(await bob.waitFor("groupUpdated", (p) => p._id === gid && p.disappearAfter === 7 * DAY)));
log("timer", "…and a chatTimer event naming the admin", !!(await bob.waitFor("chatTimer", (p) => p.kind === "group" && p.id === gid && p.by === alice.user._id)));
log("timer", "the group list carries the timer", ((await bob.req("GET", "/groups")).data || []).find((g) => g._id === gid)?.disappearAfter === 7 * DAY);
r = await alice.req("POST", `/groups/${gid}/messages`, { text: "group message that will disappear" });
log("timer", "a group message expires in 7 days", near(r.data?.expiresAt, 7 * DAY));

// A forwarded copy lives by the TARGET chat's timer, not the source's
r = await bob.req("POST", "/messages/forward", { messageId: untimed._id, targets: [{ type: "group", id: gid }] });
const fwdMsg = ((await carol.req("GET", `/groups/${gid}/messages`)).data || []).find((m) => m.forwarded);
log("timer", "forwarding into a chat with a timer applies that chat's timer", r.status === 200 && near(fwdMsg?.expiresAt, 7 * DAY));

// ───────────────────────── DISAPPEARING: actually expiring ─────────────────────────
console.log("\n=== DISAPPEARING MESSAGES: EXPIRY ===");
if (!SHORT) {
  console.log("SKIPPED (needs a server started with DISAPPEAR_ALLOW_SHORT_TIMERS=1 DISAPPEAR_SWEEP_SECONDS=2, and SHORT=1; see tests/README.md)");
  r = await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: 5 });
  log("expiry", "a 5-second timer is refused on a normal server", r.status === 400);
} else {
  r = await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: 5 });
  log("expiry", "the test server accepts a 5-second timer", r.status === 200, r.data?.message);
  const img = (await sendDM(alice, bob, { image: PNG })).data;
  const imgUrl = img?.image;
  log("expiry", "an image with a 5-second timer was stored", near(img?.expiresAt, 5) && !!imgUrl);
  log("expiry", "…and its file can be fetched before it expires", imgUrl ? (await bob.raw(imgUrl)).status === 200 : false);
  bob.events = []; alice.events = [];
  await sleep(6500);
  const hist2 = await dmHistory(bob, alice);
  log("expiry", "after 5 s the message is already hidden from history (read-time filter)", !hist2.some((m) => m._id === img?._id));
  const convs = (await bob.req("GET", "/messages/conversations")).data || [];
  log("expiry", "…and from the chat-list preview", convs.find((c) => c.userId === alice.user._id)?.lastMessage?._id !== img?._id);
  r = await bob.req("POST", `/messages/react/${img?._id}`, { emoji: "👍" });
  log("expiry", "an expired message can't be reacted to", r.status === 404);
  r = await alice.req("PUT", `/messages/edit/${img?._id}`, { text: "too late" });
  log("expiry", "…or edited", r.status === 404 || r.status === 400);
  const ev = await bob.waitFor("messagesExpired", (p) => p.messageIds?.includes(img?._id), 40000);
  log("expiry", "bob is told the message is gone", !!ev);
  log("expiry", "alice is told too", !!(await alice.waitFor("messagesExpired", (p) => p.messageIds?.includes(img?._id), 3000)));
  log("expiry", "the file was deleted from disk", imgUrl ? (await bob.raw(imgUrl)).status === 404 : false);
  await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: 0 });

  // group: expiry also repairs the list preview
  await alice.req("PUT", `/groups/${gid}/disappearing`, { seconds: 5 });
  const gm = (await alice.req("POST", `/groups/${gid}/messages`, { text: "short-lived group message" })).data;
  log("expiry", "group message with a 5-second timer", near(gm?.expiresAt, 5));
  carol.events = [];
  await sleep(6500);
  const gh = (await carol.req("GET", `/groups/${gid}/messages`)).data || [];
  log("expiry", "hidden from the group history after 5 s", !gh.some((m) => m._id === gm?._id));
  const gev = await carol.waitFor("messagesExpired", (p) => p.groupId === gid && p.messageIds?.includes(gm?._id), 40000);
  log("expiry", "group members are told, with the group id", !!gev);
  const glist = ((await carol.req("GET", "/groups")).data || []).find((g) => g._id === gid);
  log("expiry", "the group's preview no longer points at the expired message", glist?.lastMessage?._id !== gm?._id);
  await alice.req("PUT", `/groups/${gid}/disappearing`, { seconds: 0 });
}

// ───────────────────────── VIEW-ONCE: sending ─────────────────────────
console.log("\n=== VIEW-ONCE: SENDING ===");
await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: 0 });
bob.events = []; alice.events = [];
r = await sendDM(alice, bob, { image: PNG, viewOnce: true, text: "secret caption" });
const vo = r.data;
log("once", "send a view-once photo → 201", r.status === 201 && vo?.viewOnce === true && vo?.viewOnceKind === "image");
log("once", "the sender's copy carries no media, name or caption", !vo?.image && !vo?.fileUrl && !vo?.fileName && !vo?.text);
log("once", "…just a state and a view count", vo?.viewOnceState === "unopened" && vo?.viewCount === 0);
const live = await bob.waitFor("newMessage", (p) => p._id === vo?._id);
log("once", "the recipient is told live, without the media", !!live && !live.image && !live.fileUrl && live.viewOnce === true && live.viewedByMe === false && live.viewOnceState === "unopened");
const bh = (await dmHistory(bob, alice)).find((m) => m._id === vo?._id);
log("once", "history never contains the media either", !!bh && !bh.image && !bh.fileUrl && bh.viewOnceState === "unopened");
const convs2 = (await bob.req("GET", "/messages/conversations")).data || [];
const lm = convs2.find((c) => c.userId === alice.user._id)?.lastMessage;
log("once", "the chat-list preview knows it's view-once and has no image", lm?.viewOnce === true && !lm?.image);
const gallery = await bob.req("GET", `/messages/media/user/${alice.user._id}?type=media`);
log("once", "view-once media never shows in the media gallery", gallery.status === 200 && !JSON.stringify(gallery.data).includes(vo?._id));
const search = await bob.req("GET", "/messages/search?q=secret");
log("once", "its caption was dropped, so search finds nothing", search.status === 200 && !JSON.stringify(search.data).includes(vo?._id));

r = await sendDM(alice, bob, { fileUrl: PDF, fileName: "a.pdf", viewOnce: true });
log("once", "a document can't be view-once", r.status === 400);
r = await sendDM(alice, bob, { fileUrl: AUDIO("audio/mpeg"), fileName: "song.mp3", viewOnce: true });
log("once", "a plain audio file can't be view-once (only voice notes)", r.status === 400);
r = await sendDM(alice, bob, { image: PNG, fileUrl: VIDEO, viewOnce: true });
log("once", "a photo and a video together → 400", r.status === 400);
r = await sendDM(alice, bob, { image: PNG, viewOnce: "yes" });
log("once", "a non-boolean flag → 400", r.status === 400);
r = await sendDM(alice, bob, { text: "just text", viewOnce: true });
log("once", "text alone can't be view-once", r.status === 400);
r = await sendDM(alice, bob, { image: PNG, viewOnce: true, replyToId: before._id });
log("once", "a view-once message can't be a reply", r.status === 400);
r = await sendDM(bob, alice, { text: "replying to a secret", replyToId: vo._id });
log("once", "nobody can reply to a view-once message (a quote would leak it)", r.status === 400);

r = await alice.req("PUT", `/messages/edit/${vo._id}`, { text: "x" });
log("once", "can't be edited", r.status === 400);
r = await alice.req("PUT", `/messages/star/${vo._id}`, { starred: true });
log("once", "can't be starred", r.status === 400);
r = await alice.req("PUT", `/messages/pin/${vo._id}`, { pinned: true });
log("once", "can't be pinned", r.status === 400);
r = await alice.req("POST", "/messages/forward", { messageId: vo._id, targets: [{ type: "user", id: carol.user._id }] });
log("once", "can't be forwarded", r.status === 400);
r = await bob.req("POST", `/messages/react/${vo._id}`, { emoji: "👍" });
log("once", "a reaction is fine", r.status === 200);

// ───────────────────────── VIEW-ONCE: opening (1:1) ─────────────────────────
console.log("\n=== VIEW-ONCE: OPENING ===");
r = await alice.req("POST", `/messages/view-once/${vo._id}/open`);
log("once", "the sender can't open their own message", r.status === 403);
r = await carol.req("POST", `/messages/view-once/${vo._id}/open`);
log("once", "an outsider gets 404", r.status === 404);
r = await anon.req("POST", `/messages/view-once/${vo._id}/open`);
log("once", "opening requires login", r.status === 401);
r = await bob.req("POST", `/messages/view-once/${bobMsg._id}/open`);
log("once", "an ordinary message can't be 'opened'", r.status === 404);

r = await bob.req("POST", `/messages/view-once/${vo._id}/open`);
const link = r.data?.url;
log("once", "the recipient opens it: 200 with a signed link", r.status === 200 && r.data?.kind === "image" && link?.startsWith("/api/uploads/view-once/"));
const seen = await alice.waitFor("messageViewed", (p) => p.messageId === vo._id);
log("once", "the sender is told, with the view count", seen?.viewCount === 1);
log("once", "the opener's own devices are told too", !!(await bob.waitFor("messageViewed", (p) => p.messageId === vo._id && p.viewedByMe === true)));
const got = link ? await bob.raw(link) : null;
log("once", "the link serves the image to the recipient", got?.status === 200 && got.type.startsWith("image/png") && got.size > 0);
log("once", "…marked no-store so nothing keeps a copy", /no-store/.test(got?.cache || ""));
log("once", "the same link is useless to another logged-in user", link ? (await alice.raw(link)).status === 404 : false);
log("once", "…and to someone not logged in", link ? (await anon.raw(link)).status === 401 : false);
log("once", "a tampered link is refused", link ? (await bob.raw(link.slice(0, -2) + "xx")).status === 404 : false);
log("once", "a made-up link is refused", (await bob.raw("/api/uploads/view-once/AAAA.BBBB")).status === 404);
const payload = link ? JSON.parse(Buffer.from(link.split("/").pop().split(".")[0], "base64url").toString("utf8")) : null;
log("once", "the file can't be fetched by its stored name through the normal route", payload ? (await bob.raw(`/api/uploads/${payload.f}`)).status === 404 : false);

r = await bob.req("POST", `/messages/view-once/${vo._id}/open`);
log("once", "opening again right away (a reload) hands the same window back", r.status === 200 && !!r.data?.url);
const ah = (await dmHistory(alice, bob)).find((m) => m._id === vo._id);
const bh2 = (await dmHistory(bob, alice)).find((m) => m._id === vo._id);
log("once", "history now says opened for both, still without media", ah?.viewOnceState === "opened" && ah?.viewCount === 1 && bh2?.viewOnceState === "opened" && bh2?.viewedByMe === true && !bh2?.image && !bh2?.fileUrl);

r = await alice.req("POST", `/messages/view-once/${vo._id}/close`);
log("once", "closing without having opened → 400", r.status === 400);
alice.events = []; bob.events = [];
r = await bob.req("POST", `/messages/view-once/${vo._id}/close`);
log("once", "the recipient closes it", r.status === 200);
log("once", "both people are told the file is gone", !!(await alice.waitFor("messageViewWiped", (p) => p.messageId === vo._id)) && !!(await bob.waitFor("messageViewWiped", (p) => p.messageId === vo._id)));
log("once", "the link stops working (file deleted)", link ? (await bob.raw(link)).status === 404 : false);
r = await bob.req("POST", `/messages/view-once/${vo._id}/open`);
log("once", "opening after closing → 410 Gone", r.status === 410);
const ah2 = (await dmHistory(alice, bob)).find((m) => m._id === vo._id);
log("once", "the placeholder stays as 'opened' for the sender", ah2?.viewOnceState === "opened" && !ah2?.image);

// retract before it was opened
const vo2 = (await sendDM(alice, bob, { image: PNG, viewOnce: true })).data;
r = await alice.req("DELETE", `/messages/${vo2._id}?scope=everyone`);
const tomb = (await dmHistory(bob, alice)).find((m) => m._id === vo2._id);
log("once", "deleting a never-opened view-once message for everyone leaves a plain tombstone", r.status === 200 && tomb?.deletedForEveryone === true && !tomb?.viewOnce);
r = await bob.req("POST", `/messages/view-once/${vo2._id}/open`);
log("once", "…which can't be opened", r.status === 404);

// ───────────────────────── VIEW-ONCE: voice and video ─────────────────────────
console.log("\n=== VIEW-ONCE: VOICE AND VIDEO ===");
r = await sendDM(alice, bob, { fileUrl: AUDIO(), voice: true, voiceDuration: 7, viewOnce: true });
const vv = r.data;
log("once", "a view-once voice note", r.status === 201 && vv?.viewOnceKind === "audio" && vv?.voice === true && vv?.voiceDuration === 7 && !vv?.fileUrl);
r = await sendDM(alice, bob, { fileUrl: VIDEO, fileName: "holiday.mp4", viewOnce: true });
const vid = r.data;
log("once", "a view-once video (its file name is not kept)", r.status === 201 && vid?.viewOnceKind === "video" && !vid?.fileUrl && !vid?.fileName);
r = await bob.req("POST", `/messages/view-once/${vid._id}/open`);
const vl = r.data?.url;
log("once", "the video opens and is served as video", r.status === 200 && r.data?.kind === "video" && vl ? (await bob.raw(vl)).type.startsWith("video/mp4") : false);
await bob.req("POST", `/messages/view-once/${vid._id}/close`);
r = await bob.req("POST", `/messages/view-once/${vv._id}/open`);
log("once", "the voice note opens as audio with its duration", r.status === 200 && r.data?.kind === "audio" && r.data?.duration === 7);
await bob.req("POST", `/messages/view-once/${vv._id}/close`);

// ───────────────────────── VIEW-ONCE: groups ─────────────────────────
console.log("\n=== VIEW-ONCE: GROUPS ===");
r = await alice.req("POST", `/groups/${gid}/messages`, { image: PNG, viewOnce: true });
const gvo = r.data;
log("once", "a view-once photo in a group", r.status === 201 && gvo?.viewOnce === true && !gvo?.image && gvo?.viewCount === 0);
const cg = ((await carol.req("GET", `/groups/${gid}/messages`)).data || []).find((m) => m._id === gvo?._id);
log("once", "members get a placeholder without media", cg?.viewOnceState === "unopened" && !cg?.image && !cg?.fileUrl);
r = await dave.req("POST", `/messages/view-once/${gvo._id}/open`);
log("once", "a non-member can't open it", r.status === 404);
r = await alice.req("POST", `/messages/view-once/${gvo._id}/open`);
log("once", "the sender can't open their own", r.status === 403);

alice.events = []; carol.events = [];
r = await bob.req("POST", `/messages/view-once/${gvo._id}/open`);
log("once", "bob opens it", r.status === 200 && !!r.data?.url);
log("once", "alice sees 1 view, with the group id", !!(await alice.waitFor("messageViewed", (p) => p.messageId === gvo._id && p.viewCount === 1 && p.groupId === gid)));
await bob.req("POST", `/messages/view-once/${gvo._id}/close`);
r = await bob.req("POST", `/messages/view-once/${gvo._id}/open`);
log("once", "bob can't open it a second time", r.status === 410);
r = await carol.req("POST", `/messages/view-once/${gvo._id}/open`);
const gl = r.data?.url;
log("once", "the file survives bob's close, because carol hasn't looked yet", r.status === 200 && gl ? (await carol.raw(gl)).status === 200 : false);
log("once", "alice now sees 2 views", !!(await alice.waitFor("messageViewed", (p) => p.messageId === gvo._id && p.viewCount === 2)));
alice.events = [];
await carol.req("POST", `/messages/view-once/${gvo._id}/close`);
log("once", "once everyone has opened and closed it, the file is wiped and the group is told", !!(await alice.waitFor("messageViewWiped", (p) => p.messageId === gvo._id && p.groupId === gid)));
log("once", "…and the link is dead", gl ? (await carol.raw(gl)).status === 404 : false);
const ag = ((await alice.req("GET", `/groups/${gid}/messages`)).data || []).find((m) => m._id === gvo._id);
log("once", "the sender's placeholder shows both views", ag?.viewOnceState === "opened" && ag?.viewCount === 2);

// ───────────────────────── summary ─────────────────────────
for (const c of [alice, bob, carol, dave]) c.sock?.disconnect();
const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("FAILED:"); failed.forEach((f) => console.log(` - [${f.area}] ${f.name}`)); }
process.exit(failed.length ? 1 : 0);
