import { createRequire } from "node:module";
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { io } = require("socket.io-client");

const BASE = process.env.BASE || "http://localhost:5001";
const API = BASE + "/api";
const SOCK = BASE;
const results = [];
const log = (area, name, pass, detail = "") => {
  results.push({ area, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${area}] ${name}${detail ? " — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  }
  connect(asUserId, { cookie = this.cookie } = {}) {
    return new Promise((resolve) => {
      this.sock = io(SOCK, { query: asUserId ? { userId: asUserId } : {}, transports: ["websocket"], extraHeaders: cookie ? { Cookie: cookie } : {}, reconnection: false });
      this.sock.onAny((ev, payload) => this.events.push({ ev, payload }));
      this.sock.on("connect", () => { this.connected = true; resolve(true); });
      this.sock.on("connect_error", (e) => { this.connected = false; this.connectError = e.message; resolve(false); });
    });
  }
  got(ev) { return this.events.filter((e) => e.ev === ev); }
  clear() { this.events = []; }
}

const stamp = Date.now();
const befriend = async (a, b) => { await a.req("POST", `/contacts/request/${b.user._id}`); const r = await b.req("POST", `/contacts/accept/${a.user._id}`); return r.status === 200; };
const mk = async (label) => {
  const c = new Client(label);
  c.username = `${label.toLowerCase().slice(0, 7)}${String(stamp).slice(-9)}`;
  const r = await c.req("POST", "/auth/signup", { username: c.username, fullName: label, password: "secret123" });
  c.user = r.data;
  return c;
};

// ───────────────────────── AUTH ─────────────────────────
console.log("\n=== AUTH ===");
const alice = await mk("Alice");
log("auth", "signup returns 201-style user object", !!alice.user?._id);
const bob = await mk("Bob");
const carol = await mk("Carol");
await befriend(alice, bob); await befriend(alice, carol);

let r = await new Client("t").req("POST", "/auth/signup", { username: alice.username, fullName: "Dup", password: "secret123" });
log("auth", "duplicate username rejected", r.status === 400, r.data?.message);

{ const t = new Client("t"); r = await t.req("POST", "/auth/signup", { username: "@" + alice.username.toUpperCase(), fullName: "Dup", password: "secret123" });
log("auth", "duplicate username with different CASE / leading @ rejected", r.status === 400, `got ${r.status}`); }

r = await alice.req("GET", "/auth/check");
log("auth", "check auth with cookie", r.status === 200 && r.data._id === alice.user._id);
log("auth", "check response has no password hash", !r.data.password, r.data.password ? "LEAKS HASH" : "");

const noAuth = new Client("anon");
r = await noAuth.req("GET", "/auth/check");
log("auth", "unauthenticated request → 401", r.status === 401);

r = await alice.req("PUT", "/auth/update-profile", { fullName: "Alice Renamed" });
log("auth", "update name works", r.status === 200 && r.data.fullName === "Alice Renamed");
log("auth", "update-profile response does NOT leak password hash", !r.data.password, r.data.password ? `LEAKS bcrypt hash: ${String(r.data.password).slice(0, 15)}…` : "");

r = await alice.req("POST", "/auth/login", { username: alice.username, password: "wrong" });
log("auth", "wrong password rejected", r.status === 400);

// brute force: 25 rapid attempts, any lockout / 429?
let locked = false;
for (let i = 0; i < 25; i++) { const x = await alice.req("POST", "/auth/login", { username: `brute${String(stamp).slice(-9)}`, password: "guess" + i }); if (x.status === 429) locked = true; }
log("auth", "login rate-limiting / lockout after 25 bad attempts", locked, locked ? "" : "no rate limit — password guessing is unlimited");

{ const t = new Client("t"); r = await t.req("POST", "/auth/login", { username: { $ne: null }, password: "secret123" });
log("auth", "login rejects non-string email (NoSQL operator injection)", r.status === 400 && !r.data?._id, r.data?._id ? `logged in as ${r.data.email} using {"email":{"$ne":null}} — operator accepted as the lookup` : `status ${r.status}`); }

r = await alice.req("POST", "/auth/login", { username: alice.username, password: "secret123" });
const sc = r.headers.get("set-cookie") || "";
log("auth", "login sets httpOnly cookie", /HttpOnly/i.test(sc));
log("auth", "cookie SameSite=Strict", /SameSite=Strict/i.test(sc), sc.split(";").slice(1).join(";"));

// ───────────────────────── SIDEBAR / PRIVACY ─────────────────────────
console.log("\n=== USER DIRECTORY / PRIVACY ===");
r = await alice.req("GET", "/messages/users");
const sees = r.data || [];
log("privacy", "Alice sees Bob+Carol in sidebar", sees.some((u) => u._id === bob.user._id));
log("privacy", "sidebar exposes other users' EMAIL addresses", !sees.some((u) => u.email), sees.length ? `emails visible for ${sees.filter(u=>u.email).length}/${sees.length} users — every stranger is listed with their email` : "");
log("privacy", "sidebar lists ONLY my contacts, not everyone on the server", sees.length === 2, `Alice has 2 contacts and sees ${sees.length}`);
log("privacy", "contact list shows usernames", sees.every((u) => !!u.username));

// ───────────────────────── DM ─────────────────────────
console.log("\n=== DIRECT MESSAGES ===");
await alice.connect(); await bob.connect(); await carol.connect();
await sleep(300);
log("dm", "online presence broadcast", alice.got("getOnlineUsers").length > 0 && alice.got("getOnlineUsers").at(-1).payload.includes(bob.user._id));

bob.clear();
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "hello bob" });
await sleep(200);
log("dm", "send text message", r.status === 201 && r.data.text === "hello bob");
log("dm", "recipient gets realtime newMessage", bob.got("newMessage").length === 1);
const m1 = r.data;

r = await bob.req("GET", `/messages/${alice.user._id}`);
log("dm", "fetch history", r.status === 200 && r.data.length === 1);

alice.clear();
r = await bob.req("PUT", `/messages/read/${alice.user._id}`);
await sleep(200);
log("dm", "read receipt emitted to sender", alice.got("messagesRead").length === 1);

r = await bob.req("POST", `/messages/send/${alice.user._id}`, { text: "replying", replyToId: m1._id });
log("dm", "reply-to quoted message", r.status === 201 && r.data.replyTo?.text === "hello bob");

alice.clear();
r = await bob.req("POST", `/messages/react/${m1._id}`, { emoji: "❤️" });
await sleep(200);
log("dm", "react to message + realtime update", r.status === 200 && alice.got("messageReaction").length === 1);
r = await bob.req("POST", `/messages/react/${m1._id}`, { emoji: "❤️" });
log("dm", "same emoji again toggles reaction off", r.data.reactions.length === 0);

alice.clear(); bob.clear(); carol.clear();
r = await carol.req("POST", `/messages/react/${m1._id}`, { emoji: "😂" });
log("dm", "AUTHZ: third party (Carol) cannot react to Alice↔Bob message", r.status === 403 || r.status === 404, `got ${r.status} — Carol is in neither party`);

r = await carol.req("GET", `/messages/${alice.user._id}`);
log("dm", "Carol only sees her own conversation with Alice (empty)", r.data?.length === 0);

r = await alice.req("POST", `/messages/send/000000000000000000000000`, { text: "ghost" });
log("dm", "sending to non-existent user rejected", r.status === 403 || r.status === 404 || r.status === 400, `got ${r.status}`);

r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "" });
log("dm", "empty message (no text/image/file) rejected", r.status === 400, `got ${r.status}`);

r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "x".repeat(200000) });
log("dm", "200 KB single text message rejected (length limit)", r.status === 400 || r.status === 413, `got ${r.status}`);

r = await alice.req("POST", `/messages/send/${bob.user._id}`, { image: "data:image/png;base64,iVBORw0KGgo=" });
log("media", "image message stored locally (no 3rd-party)", r.status === 201 && String(r.data?.image).startsWith("/api/uploads/"), `got ${r.status} ${r.data?.image || r.data?.message}`);
const imgPath = r.data?.image;
{ const t = await fetch(BASE + imgPath); log("media", "uploaded file is NOT downloadable without login", t.status === 401, `status ${t.status}`);
  const t2 = await fetch(BASE + imgPath, { headers: { Cookie: bob.cookie } });
  log("media", "uploaded file downloadable by a logged-in user with correct type", t2.status === 200 && t2.headers.get("content-type") === "image/png", `${t2.status} ${t2.headers.get("content-type")}`);
  const t3 = await fetch(BASE + "/api/uploads/..%2f..%2f.env", { headers: { Cookie: bob.cookie } });
  log("media", "path traversal in upload name blocked", t3.status === 404 || t3.status === 400, `status ${t3.status}`); }
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { image: "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+" });
log("media", "SVG (script-capable) upload rejected", r.status === 400, `got ${r.status} ${r.data?.message}`);
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { fileUrl: "data:text/html;base64,PGgxPng8L2gxPg==", fileName: "x.html" });
log("media", "HTML file upload rejected", r.status === 400, `got ${r.status} ${r.data?.message}`);
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { fileUrl: "https://evil.example/x.png" });
log("media", "remote URL as attachment rejected (only data URLs)", r.status === 400, `got ${r.status}`);
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { fileUrl: "data:application/pdf;base64,JVBERi0xLjQK", fileName: "doc.pdf" });
log("media", "PDF attachment accepted, type derived by server", r.status === 201 && r.data.fileType === "pdf", `got ${r.status} ${r.data?.fileType}`);

r = await alice.req("GET", `/messages/${bob.user._id}?limit=1`);
log("dm", "pagination: ?limit=1 returns 1", r.data?.length === 1);

// ───────────────────────── SOCKET SPOOFING ─────────────────────────
console.log("\n=== SOCKET AUTHENTICATION ===");
const mallory = await mk("Mallory");
const dave = await mk("Dave"); await befriend(alice, dave); await dave.connect(); await sleep(200);
const spy = new Client("spy");
const spyConnected = await spy.connect(dave.user._id); // claiming to be Dave with NO cookie/token
log("security", "socket without a login cookie is refused", spyConnected === false, spy.connectError || "");
const spy2 = new Client("spy2"); spy2.cookie = mallory.cookie; await spy2.connect(dave.user._id); // valid login as Mallory, spoofed query userId=Dave
spy2.clear(); dave.clear();
await alice.req("POST", `/messages/send/${dave.user._id}`, { text: "secret for bob only" });
await sleep(300);
const intercepted = spy2.got("newMessage").some((e) => e.payload.text === "secret for bob only");
log("security", "CRITICAL: unauthenticated socket claiming Dave's userId cannot receive Dave's messages", !intercepted, intercepted ? "spy received Dave's private message with no login" : "");
const bobStillGetsIt = dave.got("newMessage").some((e) => e.payload.text === "secret for bob only");
log("security", "real Dave still receives it while an impersonator is connected", bobStillGetsIt, bobStillGetsIt ? "" : "the spoofing socket REPLACED the real user's socket slot — victim stops receiving realtime messages");

// spoof a call
spy2.clear(); alice.clear();
spy2.sock.emit("call:offer", { to: alice.user._id, offer: { type: "offer", sdp: "x" }, callType: "video", callerInfo: { fullName: "Your Bank", profilePic: "" } });
await sleep(300);
const fakeCall = alice.got("call:incoming").find((e) => e.payload.callerInfo.fullName === "Your Bank");
log("security", "caller name/photo can't be forged (server fills them from the account)", !fakeCall, fakeCall ? `Alice got incoming call from userId=${fakeCall.payload.from} named "${fakeCall.payload.callerInfo.fullName}"` : "");

// ───────────────────────── GROUPS ─────────────────────────
console.log("\n=== GROUPS ===");
carol.clear(); bob.clear();
r = await alice.req("POST", "/groups", { name: "Test Group", memberIds: [bob.user._id, carol.user._id] });
await sleep(300);
const g = r.data;
log("groups", "create group", r.status === 201 && g.members.length === 3);
log("groups", "members notified of new group in realtime", bob.got("groupCreated").length === 1 && carol.got("groupCreated").length === 1);
log("groups", "group payload leaks member emails", !g.members.some((m) => m.email), `members' emails included in group object sent to every member`);

await alice.sock.emit("joinGroup", { groupId: g._id });
await bob.sock.emit("joinGroup", { groupId: g._id });
await sleep(200);
alice.clear(); bob.clear();
r = await alice.req("POST", `/groups/${g._id}/messages`, { text: "hi group" });
await sleep(300);
log("groups", "send group message", r.status === 201);
log("groups", "other member receives it in realtime", bob.got("newGroupMessage").length === 1);
const dupes = alice.got("newGroupMessage").length;
log("groups", "BUG: sender does NOT also get own message via socket (would render twice)", dupes === 0, dupes ? `sender received ${dupes} socket echo + the HTTP response = message shown twice, same _id (React duplicate-key)` : "");

// non-member joins room
await mallory.connect();
mallory.sock.emit("joinGroup", { groupId: g._id });
await sleep(200);
mallory.clear();
await alice.req("POST", `/groups/${g._id}/messages`, { text: "members only" });
await sleep(300);
const leak = mallory.got("newGroupMessage").some((e) => e.payload.message.text === "members only");
log("security", "CRITICAL: non-member cannot join a group's socket room and eavesdrop", !leak, leak ? "Mallory (not in group) received the group message" : "");

r = await mallory.req("GET", `/groups/${g._id}/messages`);
log("groups", "non-member blocked from HTTP group history", r.status === 403);

r = await mallory.req("POST", `/groups/${g._id}/messages`, { text: "intruder" });
log("groups", "non-member cannot post", r.status === 403);

// group reaction realtime
const gm = (await alice.req("GET", `/groups/${g._id}/messages`)).data[0];
bob.clear(); carol.clear();
r = await alice.req("POST", `/messages/react/${gm._id}`, { emoji: "🔥" });
await sleep(300);
log("groups", "reaction on a group message reaches other members live", bob.got("messageReaction").length > 0, bob.got("messageReaction").length ? "" : "no event — group reactions only visible after reload");
r = await mallory.req("POST", `/messages/react/${gm._id}`, { emoji: "💀" });
log("security", "non-member cannot react to a group message", r.status === 403 || r.status === 404, `got ${r.status}`);

// admin controls
r = await bob.req("POST", `/groups/${g._id}/members`, { userId: mallory.user._id });
log("groups", "non-admin cannot add member", r.status === 403);
r = await alice.req("POST", `/groups/${g._id}/members`, { userId: mallory.user._id });
log("groups", "admin cannot add someone who is not their contact", r.status === 400, `got ${r.status}`);
await befriend(alice, mallory);
r = await alice.req("POST", `/groups/${g._id}/members`, { userId: mallory.user._id });
log("groups", "admin can add a contact", r.status === 200);
r = await alice.req("DELETE", `/groups/${g._id}/members/${mallory.user._id}`);
log("groups", "admin can remove member", r.status === 200);
r = await bob.req("DELETE", `/groups/${g._id}/members/${carol.user._id}`);
log("groups", "non-admin cannot remove others", r.status === 403);

// ───────────────────────── STATUS ─────────────────────────
console.log("\n=== STATUS / STORIES ===");
r = await alice.req("POST", "/status", { text: "my status", bgColor: "#123456" });
const st = r.data;
log("status", "post text status", r.status === 201);
r = await bob.req("POST", `/status/view/${st._id}`);
log("status", "mark viewed", r.status === 200);
const outsider = await mk("Outsider");
r = await outsider.req("GET", "/status");
const mseen = (r.data || []).find((s) => s._id === st._id);
log("privacy", "a stranger (not Alice's contact) cannot see Alice's status", !mseen, mseen ? "an outsider sees it" : "");
log("privacy", "viewedBy list hidden from non-owners", !(mseen?.viewedBy?.length), mseen?.viewedBy?.length ? `outsider can see the viewer list (${mseen.viewedBy.length})` : "");
r = await bob.req("DELETE", `/status/${st._id}`);
log("status", "non-owner cannot delete someone's status", r.status === 404 || r.status === 403);
r = await alice.req("DELETE", `/status/${st._id}`);
log("status", "owner can delete", r.status === 200);

// ───────────────────────── CALLS ─────────────────────────
console.log("\n=== CALL SIGNALING ===");
alice.clear(); bob.clear();
alice.sock.emit("call:offer", { to: bob.user._id, offer: { type: "offer", sdp: "v=0" }, callType: "voice", callerInfo: { fullName: "Alice", profilePic: "" } });
await sleep(300);
log("calls", "offer → callee gets call:incoming", bob.got("call:incoming").length === 1);
bob.sock.emit("call:answer", { to: alice.user._id, answer: { type: "answer", sdp: "v=0" } });
await sleep(200);
log("calls", "answer → caller gets call:answered", alice.got("call:answered").length === 1);
alice.sock.emit("call:end", { to: bob.user._id });
await sleep(200);
log("calls", "end → callee gets call:ended", bob.got("call:ended").length === 1);
carol.sock.disconnect(); await sleep(300);
alice.clear();
alice.sock.emit("call:offer", { to: carol.user._id, offer: {}, callType: "voice", callerInfo: {} });
await sleep(200);
log("calls", "calling offline user → call:unavailable", alice.got("call:unavailable").length === 1);

// ───────────────────────── MULTI-TAB ─────────────────────────
console.log("\n=== PRESENCE / MULTI-DEVICE ===");
const erin = await mk("Erin"); const watcher = await mk("Watcher"); await befriend(watcher, erin);
await erin.connect(); await watcher.connect(); await sleep(200);
const erinTab2 = new Client("erintab2"); erinTab2.user = erin.user; await erinTab2.connect(); await sleep(200);
erinTab2.sock.disconnect(); await sleep(400);
watcher.clear(); watcher.sock.disconnect(); await watcher.connect(); await sleep(300);
const online = watcher.got("getOnlineUsers").at(-1).payload;
log("presence", "user still ONLINE after closing one of two tabs/devices", online.includes(erin.user._id), online.includes(erin.user._id) ? "" : "Erin shows OFFLINE while still connected in her other tab/device");
erin.clear(); await watcher.req("POST", `/messages/send/${erin.user._id}`, { text: "are you there" }); await sleep(300);
log("presence", "...and she still receives realtime messages on her remaining tab", erin.got("newMessage").length === 1, erin.got("newMessage").length ? "" : "she silently misses messages until refresh");


// ───────────────────────── NEW CHECKS ─────────────────────────
console.log("\n=== NEW: CONVERSATIONS / VALIDATION / STATUS SCOPE / ICE / RATE LIMIT ===");
r = await bob.req("GET", "/messages/conversations");
const conv = (r.data || []).find((c) => c.userId === alice.user._id);
log("dm", "conversations endpoint returns last message + unread count", !!conv && typeof conv.unread === "number" && !!conv.lastMessage, JSON.stringify(conv)?.slice(0, 120));
r = await alice.req("GET", "/messages/not-an-id");
log("validation", "malformed id → 400 (not 500)", r.status === 400, `got ${r.status}`);
r = await alice.req("POST", `/messages/send/${alice.user._id}`, { text: "me" });
log("validation", "can't message yourself", r.status === 400);
r = await alice.req("GET", "/calls/ice");
log("calls", "ICE config endpoint returns STUN servers", r.status === 200 && r.data.iceServers?.length >= 1, JSON.stringify(r.data).slice(0, 100));
r = await new Client("x").req("GET", "/calls/ice");
log("calls", "ICE config requires login", r.status === 401);

// status scoping: Alice posts; Bob (has chatted with her) sees it, a stranger doesn't, viewedBy hidden from non-owner
const stranger = await mk("Stranger");
r = await alice.req("POST", "/status", { text: "scoped status" }); const st2 = r.data;
let a = (await bob.req("GET", "/status")).data.find((x) => x._id === st2._id);
let b = (await stranger.req("GET", "/status")).data.find((x) => x._id === st2._id);
log("privacy", "status visible to someone Alice has chatted with", !!a);
log("privacy", "status NOT visible to a stranger", !b, b ? "stranger can see it" : "");
r = await stranger.req("POST", `/status/view/${st2._id}`);
log("privacy", "stranger can't mark/view a status they can't see", r.status === 404, `got ${r.status}`);
await bob.req("POST", `/status/view/${st2._id}`);
a = (await bob.req("GET", "/status")).data.find((x) => x._id === st2._id);
log("privacy", "viewer sees viewedByMe but not the viewer list", a.viewedByMe === true && a.viewedBy.length === 0);
const own = (await alice.req("GET", "/status")).data.find((x) => x._id === st2._id);
log("privacy", "owner sees who viewed", own.viewedBy.length === 1);
r = await alice.req("POST", "/status", { text: "x", bgColor: "red;background:url(x)" });
log("validation", "status colour must be a hex value", r.status === 400);

// login rate limit
const rl = new Client("rl"); let limited = false;
for (let i = 0; i < 14; i++) { const x = await rl.req("POST", "/auth/login", { username: "nobody_x", password: "nope" + i }); if (x.status === 429) limited = true; }
log("auth", "login is rate limited after repeated failures", limited);

// group membership removal revokes live access
const gx = (await alice.req("POST", "/groups", { name: "Revoke", memberIds: [bob.user._id] })).data;
await sleep(200);
await alice.req("DELETE", `/groups/${gx._id}/members/${bob.user._id}`); await sleep(200);
bob.clear(); await alice.req("POST", `/groups/${gx._id}/messages`, { text: "after removal" }); await sleep(300);
log("groups", "removed member stops receiving the group's live messages", bob.got("newGroupMessage").length === 0);
// group message reaches members even if they never "opened" the group (server-side rooms)
const gy = (await alice.req("POST", "/groups", { name: "AutoRoom", memberIds: [bob.user._id] })).data; await sleep(200);
bob.clear(); await alice.req("POST", `/groups/${gy._id}/messages`, { text: "ping" }); await sleep(300);
log("groups", "member receives live group message without opening the group", bob.got("newGroupMessage").length === 1);
r = await alice.req("GET", `/groups`);
log("groups", "group payload no longer exposes member emails", !r.data.some((g) => g.members.some((m) => m.email)));


// ───────────────────────── PHASE 1: USERNAMES / CONTACTS / BLOCK / PRIVACY ─────────────────────────
console.log("\n=== PHASE 1: USERNAMES, CONTACTS, BLOCKING, PRIVACY ===");
const anon = new Client("anon2");
for (const [u, why] of [["ab", "too short"], ["1abcdef", "starts with digit"], ["bad name", "space"], ["a".repeat(21), "too long"], ["admin", "reserved"], ["héllo", "non-ascii"]]) {
  r = await anon.req("POST", "/auth/signup", { username: u, password: "secret123" });
  log("username", `signup rejects username (${why})`, r.status === 400, r.data?.message?.slice(0, 50));
}
r = await anon.req("GET", `/auth/username-available?username=${alice.username}`);
log("username", "availability check says taken for an existing username", r.data?.available === false);
r = await anon.req("GET", `/auth/username-available?username=free${String(stamp).slice(-9)}`);
log("username", "availability check says free for an unused username", r.data?.available === true);
r = await alice.req("PUT", "/auth/username", { username: bob.username });
log("username", "can't rename to a taken username", r.status === 400);
const newName = `ali${String(stamp).slice(-9)}x`;
r = await alice.req("PUT", "/auth/username", { username: newName });
log("username", "can change own username", r.status === 200 && r.data.username === newName);
alice.username = newName;
log("username", "signup response/user object has no password hash", !r.data.password);

// search
const dana = await mk("Dana"), eli = await mk("Eli"), fay = await mk("Fay");
r = await dana.req("GET", `/contacts/search?username=${eli.username}`);
log("contacts", "exact username search finds the person (relation none)", r.status === 200 && r.data._id === eli.user._id && r.data.relation === "none");
r = await dana.req("GET", `/contacts/search?username=@${eli.username.toUpperCase()}`);
log("contacts", "search ignores @ and case", r.status === 200);
r = await dana.req("GET", `/contacts/search?username=${eli.username.slice(0, 6)}`);
log("contacts", "partial username finds nobody (no browsing/scraping)", r.status === 404);
r = await dana.req("GET", `/contacts/search?username=${dana.username}`);
log("contacts", "searching yourself finds nothing", r.status === 404);
r = await dana.req("GET", "/contacts/search?username=");
log("contacts", "empty search → 400", r.status === 400);
log("contacts", "search result exposes no email/password", !("email" in (await dana.req("GET", `/contacts/search?username=${eli.username}`)).data) );

// strangers can't do anything yet
r = await dana.req("POST", `/messages/send/${eli.user._id}`, { text: "hi stranger" });
log("contacts", "non-contact cannot send a message", r.status === 403, `got ${r.status}`);
await dana.connect(); await eli.connect(); await sleep(200);
eli.clear(); dana.clear();
dana.sock.emit("call:offer", { to: eli.user._id, offer: { type: "offer", sdp: "x" }, callType: "voice" }); await sleep(250);
log("contacts", "non-contact cannot ring you (call:offer refused)", eli.got("call:incoming").length === 0 && dana.got("call:unavailable").length === 1);
dana.sock.emit("typing", { receiverId: eli.user._id }); await sleep(250);
log("contacts", "non-contact typing events are not delivered", eli.got("userTyping").length === 0);
log("contacts", "non-contacts are not shown as online to each other", !(dana.got("getOnlineUsers").at(-1)?.payload || []).includes(eli.user._id));
r = await eli.req("GET", "/messages/users");
log("contacts", "a new account's contact list is empty", r.data.length === 0);

// request → accept
eli.clear();
r = await dana.req("POST", `/contacts/request/${eli.user._id}`);
await sleep(250);
log("contacts", "send contact request", r.status === 201 && r.data.status === "pending");
log("contacts", "recipient is notified in realtime", eli.got("contactsChanged").some((e) => e.payload.type === "request" && e.payload.user.username === dana.username));
r = await eli.req("GET", "/contacts");
log("contacts", "recipient sees it under incoming", r.data.incoming.some((u) => u._id === dana.user._id));
r = await dana.req("GET", "/contacts");
log("contacts", "sender sees it under outgoing", r.data.outgoing.some((u) => u._id === eli.user._id));
r = await dana.req("GET", `/contacts/search?username=${eli.username}`);
log("contacts", "search shows pending_out", r.data.relation === "pending_out");
r = await dana.req("POST", `/messages/send/${eli.user._id}`, { text: "still pending" });
log("contacts", "pending request does not allow messaging", r.status === 403);
r = await dana.req("POST", `/contacts/accept/${eli.user._id}`);
log("contacts", "requester cannot accept their own request", r.status === 404);
r = await dana.req("POST", `/contacts/request/${eli.user._id}`);
log("contacts", "duplicate request is idempotent", r.status === 200 && r.data.status === "pending");
dana.clear();
r = await eli.req("POST", `/contacts/accept/${dana.user._id}`);
await sleep(300);
log("contacts", "recipient accepts", r.status === 200);
log("contacts", "requester is notified of acceptance", dana.got("contactsChanged").some((e) => e.payload.type === "accepted"));
r = await dana.req("POST", `/messages/send/${eli.user._id}`, { text: "now we can talk" });
log("contacts", "contacts can message each other", r.status === 201);
r = await eli.req("GET", "/messages/users");
log("contacts", "each now appears in the other's contact list", r.data.some((u) => u._id === dana.user._id));
log("presence", "contacts see each other online", (dana.got("getOnlineUsers").at(-1)?.payload || []).includes(eli.user._id));
r = await dana.req("POST", `/contacts/request/${eli.user._id}`);
log("contacts", "requesting an existing contact → 400", r.status === 400);
const stranger3 = await mk("Gus");
r = await stranger3.req("GET", `/messages/${dana.user._id}`);
log("privacy", "non-contact reading history with someone sees nothing", r.status === 200 && r.data.length === 0);

// mutual request auto-accepts
r = await dana.req("POST", `/contacts/request/${fay.user._id}`);
r = await fay.req("POST", `/contacts/request/${dana.user._id}`);
log("contacts", "both asking each other becomes a contact straight away", r.status === 200 && r.data.status === "accepted");

// decline / remove
const hal = await mk("Hal");
await hal.req("POST", `/contacts/request/${dana.user._id}`);
r = await dana.req("DELETE", `/contacts/${hal.user._id}`);
log("contacts", "recipient can decline a request", r.status === 200);
r = await hal.req("POST", `/messages/send/${dana.user._id}`, { text: "x" });
log("contacts", "declined requester still cannot message", r.status === 403);
r = await dana.req("DELETE", `/contacts/${fay.user._id}`);
log("contacts", "contact can be removed", r.status === 200);
r = await fay.req("POST", `/messages/send/${dana.user._id}`, { text: "x" });
log("contacts", "removed contact can no longer message", r.status === 403);
r = await dana.req("DELETE", `/contacts/${stranger3.user._id}`);
log("contacts", "removing a non-relationship → 404", r.status === 404);

// block
const ivy = await mk("Ivy");
await befriend(dana, ivy); await ivy.connect(); await sleep(200);
r = await dana.req("POST", `/contacts/block/${ivy.user._id}`);
log("block", "block a contact", r.status === 200);
r = await ivy.req("POST", `/messages/send/${dana.user._id}`, { text: "unblock me" });
log("block", "blocked person cannot message", r.status === 403);
r = await dana.req("POST", `/messages/send/${ivy.user._id}`, { text: "x" });
log("block", "blocking also stops me messaging them", r.status === 403);
r = await ivy.req("GET", `/contacts/search?username=${dana.username}`);
log("block", "blocked person can't find me by username", r.status === 404);
r = await ivy.req("POST", `/contacts/request/${dana.user._id}`);
log("block", "blocked person's request looks successful (block stays invisible)", r.status === 200);
r = await dana.req("GET", "/contacts");
log("block", "...but nothing reaches my incoming list", !r.data.incoming.some((u) => u._id === ivy.user._id));
log("block", "blocked list shows who I blocked", r.data.blocked.some((u) => u._id === ivy.user._id));
r = await dana.req("POST", `/contacts/request/${ivy.user._id}`);
log("block", "I must unblock before requesting them", r.status === 400);
r = await dana.req("GET", `/contacts/search?username=${ivy.username}`);
log("block", "search shows relation=blocked for the person I blocked", r.data.relation === "blocked");
r = await dana.req("POST", `/contacts/block/${dana.user._id}`);
log("block", "can't block yourself", r.status === 400);
r = await dana.req("DELETE", `/contacts/block/${ivy.user._id}`);
log("block", "unblock", r.status === 200);
r = await ivy.req("GET", `/contacts/search?username=${dana.username}`);
log("block", "after unblock they can find me again, but are not contacts", r.status === 200 && r.data.relation === "none");

// groups: only contacts
const gg = (await dana.req("POST", "/groups", { name: "FriendsOnly", memberIds: [eli.user._id, stranger3.user._id] }));
log("groups", "can't create a group with someone who isn't my contact", gg.status === 400, gg.data?.message);
const g2 = (await dana.req("POST", "/groups", { name: "Friends", memberIds: [eli.user._id] }));
log("groups", "can create a group with contacts", g2.status === 201);
r = await dana.req("POST", `/groups/${g2.data._id}/members`, { userId: stranger3.user._id });
log("groups", "can't add a non-contact to an existing group", r.status === 400);
log("groups", "group payload carries usernames, no emails", g2.data.members.every((m) => m.username && !m.email));

// privacy: online, status audience, read receipts
r = await eli.req("PUT", "/auth/privacy", { showOnline: "maybe" });
log("privacy", "invalid privacy value rejected", r.status === 400);
dana.clear();
r = await eli.req("PUT", "/auth/privacy", { showOnline: false });
await sleep(400);
log("privacy", "can switch 'show online' off", r.status === 200 && r.data.privacy.showOnline === false);
log("privacy", "contacts stop seeing me online when I switch it off", !(dana.got("getOnlineUsers").at(-1)?.payload || []).includes(eli.user._id));
await eli.req("PUT", "/auth/privacy", { showOnline: true }); await sleep(300);
log("privacy", "...and see me again when switched back on", (dana.got("getOnlineUsers").at(-1)?.payload || []).includes(eli.user._id));

await eli.req("PUT", "/auth/privacy", { statusAudience: "nobody" });
const stE = (await eli.req("POST", "/status", { text: "private-ish" })).data;
r = await dana.req("GET", "/status");
log("privacy", "status audience 'nobody' hides my status from contacts", !r.data.some((x) => x._id === stE._id));
r = await eli.req("GET", "/status");
log("privacy", "...but I still see my own", r.data.some((x) => x._id === stE._id));
await eli.req("PUT", "/auth/privacy", { statusAudience: "contacts" });
r = await dana.req("GET", "/status");
log("privacy", "status audience 'contacts' shows it to contacts", r.data.some((x) => x._id === stE._id));

// read receipts (reciprocal)
dana.clear();
await dana.req("POST", `/messages/send/${eli.user._id}`, { text: "receipt check 1" });
await eli.req("PUT", `/messages/read/${dana.user._id}`); await sleep(300);
log("privacy", "read receipts ON: sender is told when read", dana.got("messagesRead").length === 1);
await eli.req("PUT", "/auth/privacy", { readReceipts: false });
dana.clear();
await dana.req("POST", `/messages/send/${eli.user._id}`, { text: "receipt check 2" });
await eli.req("PUT", `/messages/read/${dana.user._id}`); await sleep(300);
log("privacy", "read receipts OFF: sender is NOT told", dana.got("messagesRead").length === 0);
r = await dana.req("GET", `/messages/${eli.user._id}`);
log("privacy", "...and history doesn't reveal 'read' either", r.data.filter((m) => m.senderId === dana.user._id).every((m) => m.isRead === false));
await eli.req("PUT", "/auth/privacy", { readReceipts: true });

// legacy-style login by email still possible only for accounts that have an email; unknown email fails cleanly
r = await new Client("l").req("POST", "/auth/login", { email: "nobody@example.com", password: "secret123" });
log("auth", "login with an unknown email fails cleanly (400, no crash)", r.status === 400);

// ───────────────────────── SUMMARY ─────────────────────────
const fails = results.filter((x) => !x.pass);
console.log(`\n\n===== ${results.length - fails.length}/${results.length} passed, ${fails.length} failed =====`);
for (const f of fails) console.log(`  ✗ [${f.area}] ${f.name}${f.detail ? " — " + f.detail : ""}`);
await import("node:fs").then((fs) => fs.writeFileSync("tests/last-api-results.json", JSON.stringify(results, null, 2)));
process.exit(0);
