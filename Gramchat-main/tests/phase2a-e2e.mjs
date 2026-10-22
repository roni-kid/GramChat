// Phase 2A API checks: delivered ticks, edit, delete (me / everyone), star, pin, forward.
// Runs against a live server like api-e2e.mjs (see tests/README.md). Restart the server between runs
// (signup rate limit is per process) and start it with SIGNUP_LIMIT_PER_HOUR=500.
import { createRequire } from "node:module";
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { io } = require("socket.io-client");

const BASE = process.env.BASE || "http://localhost:5001";
const API = BASE + "/api";
const results = [];
const log = (area, name, pass, detail = "") => {
  results.push({ area, name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} [${area}] ${name}${detail ? " — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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
  connect() {
    return new Promise((resolve) => {
      this.sock = io(BASE, { transports: ["websocket"], extraHeaders: { Cookie: this.cookie }, reconnection: false });
      this.sock.onAny((ev, payload) => this.events.push({ ev, payload }));
      this.sock.on("connect", () => resolve(true));
      this.sock.on("connect_error", () => resolve(false));
    });
  }
  got(ev) { return this.events.filter((e) => e.ev === ev).map((e) => e.payload); }
  async waitFor(ev, pred = () => true, ms = 1500) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = this.got(ev).find(pred);
      if (hit) return hit;
      await sleep(40);
    }
    return null;
  }
  clear() { this.events = []; }
}

const stamp = Date.now();
const mk = async (label) => {
  const c = new Client(label);
  const r = await c.req("POST", "/auth/signup", { username: `${label.toLowerCase().slice(0, 6)}${String(stamp).slice(-9)}`, fullName: label, password: "secret123" });
  c.user = r.data;
  return c;
};
const befriend = async (a, b) => { await a.req("POST", `/contacts/request/${b.user._id}`); return (await b.req("POST", `/contacts/accept/${a.user._id}`)).status === 200; };
const dm = async (from, to, body) => (await from.req("POST", `/messages/send/${to.user._id}`, body)).data;
const thread = async (viewer, other) => (await viewer.req("GET", `/messages/${other.user._id}`)).data || [];

// ───────────────────────── setup ─────────────────────────
const alice = await mk("Alice2a"), bob = await mk("Bob2a"), carol = await mk("Carol2a"), dave = await mk("Dave2a"); // dave: not anyone's contact
await befriend(alice, bob); await befriend(alice, carol);
log("setup", "four users created, alice↔bob and alice↔carol are contacts", !!(alice.user && bob.user && carol.user && dave.user));

// ───────────────────────── DELIVERED TICKS ─────────────────────────
console.log("\n=== DELIVERED ===");
await alice.connect();
let m = await dm(alice, bob, { text: "bob is offline" });
log("delivered", "message to an offline recipient has no deliveredAt", !!m?._id && !m.deliveredAt);
alice.clear();
await bob.connect();
const del = await alice.waitFor("messagesDelivered", (p) => p.to === bob.user._id);
log("delivered", "sender is told when the recipient connects", !!del);
let t = await thread(alice, bob);
log("delivered", "message now carries deliveredAt", !!t.find((x) => x._id === m._id)?.deliveredAt);
m = await dm(alice, bob, { text: "bob is online" });
log("delivered", "message to an online recipient is delivered immediately", !!m?.deliveredAt);
await carol.connect(); await dave.connect();

// ───────────────────────── EDIT ─────────────────────────
console.log("\n=== EDIT ===");
m = await dm(alice, bob, { text: "typo hre" });
bob.clear();
let r = await alice.req("PUT", `/messages/edit/${m._id}`, { text: "typo here" });
log("edit", "sender can edit", r.status === 200 && r.data.text === "typo here");
log("edit", "recipient receives messageEdited", !!(await bob.waitFor("messageEdited", (p) => p.messageId === m._id && p.text === "typo here")));
t = await thread(bob, alice);
const edited = t.find((x) => x._id === m._id);
log("edit", "history shows new text + editedAt", edited?.text === "typo here" && !!edited?.editedAt);
r = await bob.req("PUT", `/messages/edit/${m._id}`, { text: "hijack" });
log("edit", "recipient cannot edit someone else's message", r.status === 403);
r = await dave.req("PUT", `/messages/edit/${m._id}`, { text: "hijack" });
log("edit", "outsider gets 404 (existence not revealed)", r.status === 404);
r = await alice.req("PUT", `/messages/edit/${m._id}`, { text: "   " });
log("edit", "can't edit a text-only message to empty", r.status === 400);
r = await alice.req("PUT", `/messages/edit/${m._id}`, { text: 123 });
log("edit", "non-string text rejected", r.status === 400);
r = await alice.req("PUT", `/messages/edit/${m._id}`, { text: "x".repeat(10001) });
log("edit", "over-long text rejected", r.status === 400);
r = await alice.req("PUT", "/messages/edit/not-an-id", { text: "x" });
log("edit", "malformed id → 400", r.status === 400);

// ───────────────────────── DELETE FOR ME ─────────────────────────
console.log("\n=== DELETE FOR ME ===");
m = await dm(alice, bob, { text: "delete for me only" });
r = await alice.req("DELETE", `/messages/${m._id}?scope=me`);
log("delete-me", "delete for me → 200", r.status === 200);
log("delete-me", "gone from my history", !(await thread(alice, bob)).some((x) => x._id === m._id));
log("delete-me", "still visible to the other person", (await thread(bob, alice)).some((x) => x._id === m._id && x.text === "delete for me only"));
r = await alice.req("DELETE", `/messages/${m._id}?scope=bogus`);
log("delete-me", "bad scope → 400", r.status === 400);
r = await dave.req("DELETE", `/messages/${m._id}?scope=me`);
log("delete-me", "outsider → 404", r.status === 404);
r = await bob.req("POST", `/messages/react/${m._id}`, { emoji: "👍" });
log("delete-me", "other person can still react", r.status === 200);
const convs = (await alice.req("GET", "/messages/conversations")).data || [];
log("delete-me", "chat-list preview ignores the hidden message", convs.find((c) => c.userId === bob.user._id)?.lastMessage?._id !== m._id);

// ───────────────────────── DELETE FOR EVERYONE ─────────────────────────
console.log("\n=== DELETE FOR EVERYONE ===");
m = await dm(alice, bob, { text: "secret", image: PNG });
const imgUrl = m.image;
log("delete-all", "image message stored", !!imgUrl && (await alice.req("GET", imgUrl.replace("/api", ""))).status === 200);
await bob.req("PUT", `/messages/star/${m._id}`, { starred: true });
bob.clear();
r = await bob.req("DELETE", `/messages/${m._id}?scope=everyone`);
log("delete-all", "recipient cannot delete for everyone", r.status === 403);
r = await alice.req("DELETE", `/messages/${m._id}?scope=everyone`);
log("delete-all", "sender can delete for everyone", r.status === 200);
log("delete-all", "recipient receives messageDeleted", !!(await bob.waitFor("messageDeleted", (p) => p.messageId === m._id)));
const tomb = (await thread(bob, alice)).find((x) => x._id === m._id);
log("delete-all", "history keeps a tombstone", tomb?.deletedForEveryone === true);
log("delete-all", "tombstone carries no text/image/file", !tomb?.text && !tomb?.image && !tomb?.fileUrl);
log("delete-all", "uploaded file is removed from disk", (await alice.req("GET", imgUrl.replace("/api", ""))).status === 404);
log("delete-all", "tombstone leaks no private arrays", !("starredBy" in (tomb || {})) && !("deletedFor" in (tomb || {})));
r = await bob.req("POST", `/messages/react/${m._id}`, { emoji: "👍" });
log("delete-all", "can't react to a deleted message", r.status === 400);
r = await alice.req("PUT", `/messages/edit/${m._id}`, { text: "undelete" });
log("delete-all", "can't edit a deleted message", r.status === 400);
log("delete-all", "deleted message disappears from the starred list", !((await bob.req("GET", "/messages/starred")).data || []).some((x) => x._id === m._id));
r = await alice.req("DELETE", `/messages/${m._id}?scope=everyone`);
log("delete-all", "deleting twice is harmless", r.status === 200);
const convs2 = (await bob.req("GET", "/messages/conversations")).data || [];
log("delete-all", "chat-list preview marks it deleted", convs2.find((c) => c.userId === alice.user._id)?.lastMessage?.deletedForEveryone === true || convs2.find((c) => c.userId === alice.user._id)?.lastMessage?._id !== m._id);

// ───────────────────────── STAR ─────────────────────────
console.log("\n=== STAR ===");
m = await dm(alice, bob, { text: "star me" });
bob.clear(); alice.clear();
r = await alice.req("PUT", `/messages/star/${m._id}`, { starred: true });
log("star", "star → 200", r.status === 200 && r.data.starred === true);
log("star", "starring is private: the other person gets no event", !(await bob.waitFor("messageStarred", () => true, 400)));
log("star", "my other tabs/devices are synced", !!(await alice.waitFor("messageStarred", (p) => p.messageId === m._id && p.starred === true)));
log("star", "starred=true for me", (await thread(alice, bob)).find((x) => x._id === m._id)?.starred === true);
const bobsView = (await thread(bob, alice)).find((x) => x._id === m._id);
log("star", "starred=false for the other person, no starredBy exposed", bobsView?.starred === false && !("starredBy" in bobsView));
log("star", "appears in GET /messages/starred", ((await alice.req("GET", "/messages/starred")).data || []).some((x) => x._id === m._id));
log("star", "…but not in the other person's list", !((await bob.req("GET", "/messages/starred")).data || []).some((x) => x._id === m._id));
r = await dave.req("PUT", `/messages/star/${m._id}`, { starred: true });
log("star", "outsider can't star it", r.status === 404);
r = await alice.req("PUT", `/messages/star/${m._id}`, { starred: "yes" });
log("star", "non-boolean rejected", r.status === 400);
r = await alice.req("PUT", `/messages/star/${m._id}`, { starred: false });
log("star", "unstar works", r.status === 200 && (await thread(alice, bob)).find((x) => x._id === m._id)?.starred === false);

// ───────────────────────── PIN ─────────────────────────
console.log("\n=== PIN ===");
const ids = [];
for (let i = 1; i <= 4; i++) { ids.push((await dm(alice, bob, { text: `pin candidate ${i}` }))._id); await sleep(15); }
bob.clear();
r = await bob.req("PUT", `/messages/pin/${ids[0]}`, { pinned: true });
log("pin", "either participant can pin", r.status === 200 && r.data.pinned === true);
log("pin", "the other side sees messagePinned", !!(await alice.waitFor("messagePinned", (p) => p.messageId === ids[0] && p.pinned === true)));
r = await dave.req("PUT", `/messages/pin/${ids[0]}`, { pinned: true });
log("pin", "outsider can't pin", r.status === 404);
await alice.req("PUT", `/messages/pin/${ids[1]}`, { pinned: true });
await alice.req("PUT", `/messages/pin/${ids[2]}`, { pinned: true });
alice.clear();
await alice.req("PUT", `/messages/pin/${ids[3]}`, { pinned: true });
r = await alice.req("GET", `/messages/pinned/user/${bob.user._id}`);
const pins = (r.data || []).map((x) => x._id);
log("pin", "max 3 pinned per chat", pins.length === 3, `got ${pins.length}`);
log("pin", "the oldest pin was replaced", !pins.includes(ids[0]) && pins.includes(ids[3]));
log("pin", "replaced pin is announced as unpinned", !!(await alice.waitFor("messagePinned", (p) => p.messageId === ids[0] && p.pinned === false)));
log("pin", "pinned list is the same for both people", ((await bob.req("GET", `/messages/pinned/user/${alice.user._id}`)).data || []).length === 3);
log("pin", "pinned list of an unrelated pair is empty", ((await dave.req("GET", `/messages/pinned/user/${alice.user._id}`)).data || []).length === 0);
await alice.req("PUT", `/messages/pin/${ids[3]}`, { pinned: false });
log("pin", "unpin works", !(((await alice.req("GET", `/messages/pinned/user/${bob.user._id}`)).data || []).some((x) => x._id === ids[3])));
await alice.req("DELETE", `/messages/${ids[1]}?scope=everyone`);
log("pin", "deleting a pinned message unpins it", !(((await alice.req("GET", `/messages/pinned/user/${bob.user._id}`)).data || []).some((x) => x._id === ids[1])));

// ───────────────────────── FORWARD ─────────────────────────
console.log("\n=== FORWARD ===");
const orig = await dm(alice, bob, { text: "forward me", image: PNG });
carol.clear();
r = await alice.req("POST", "/messages/forward", { messageId: orig._id, targets: [{ type: "user", id: carol.user._id }] });
log("forward", "forward to a contact → ok", r.status === 200 && r.data.results?.[0]?.ok === true, JSON.stringify(r.data));
const got = await carol.waitFor("newMessage", (p) => p.forwarded === true);
log("forward", "recipient receives a message flagged forwarded", !!got && got.text === "forward me");
log("forward", "the copy has its own file", !!got?.image && got.image !== orig.image);
await alice.req("DELETE", `/messages/${orig._id}?scope=everyone`);
log("forward", "deleting the original keeps the forwarded copy's file", got?.image ? (await carol.req("GET", got.image.replace("/api", ""))).status === 200 : false);
r = await alice.req("POST", "/messages/forward", { messageId: orig._id, targets: [{ type: "user", id: carol.user._id }] });
log("forward", "can't forward a deleted message", r.status === 400);
const live = await dm(alice, bob, { text: "second forward" });
r = await alice.req("POST", "/messages/forward", { messageId: live._id, targets: [{ type: "user", id: dave.user._id }, { type: "user", id: carol.user._id }] });
log("forward", "non-contact target fails, contact target succeeds", r.data?.results?.find((x) => x.id === dave.user._id)?.ok === false && r.data?.results?.find((x) => x.id === carol.user._id)?.ok === true);
r = await alice.req("POST", "/messages/forward", { messageId: live._id, targets: Array.from({ length: 6 }, () => ({ type: "user", id: carol.user._id })) });
log("forward", "more than 5 targets → 400", r.status === 400);
r = await alice.req("POST", "/messages/forward", { messageId: live._id, targets: [] });
log("forward", "no targets → 400", r.status === 400);
r = await dave.req("POST", "/messages/forward", { messageId: live._id, targets: [{ type: "user", id: alice.user._id }] });
log("forward", "outsider can't forward someone else's message", r.status === 404);
r = await alice.req("POST", "/messages/forward", { messageId: live._id, targets: [{ type: "user", id: alice.user._id }] });
log("forward", "can't forward to yourself", r.data?.results?.[0]?.ok === false);

// ───────────────────────── GROUPS ─────────────────────────
console.log("\n=== GROUP MESSAGES ===");
r = await alice.req("POST", "/groups", { name: "Phase 2A", memberIds: [bob.user._id, carol.user._id] });
const gid = r.data?._id;
log("group", "group created", !!gid);
r = await alice.req("POST", `/groups/${gid}/messages`, { text: "group hello" });
const gm = r.data;
bob.clear();
r = await alice.req("PUT", `/messages/edit/${gm._id}`, { text: "group hello (edited)" });
log("group", "edit in a group", r.status === 200);
const ge = await bob.waitFor("messageEdited", (p) => p.messageId === gm._id);
log("group", "members receive messageEdited with groupId", ge?.groupId === gid);
r = await bob.req("PUT", `/messages/edit/${gm._id}`, { text: "nope" });
log("group", "other members can't edit it", r.status === 403);
r = await dave.req("PUT", `/messages/edit/${gm._id}`, { text: "nope" });
log("group", "non-members get 404", r.status === 404);
r = await bob.req("PUT", `/messages/pin/${gm._id}`, { pinned: true });
log("group", "members can pin", r.status === 200);
log("group", "pinned list for members", ((await carol.req("GET", `/messages/pinned/group/${gid}`)).data || []).some((x) => x._id === gm._id));
r = await dave.req("GET", `/messages/pinned/group/${gid}`);
log("group", "pinned list refused for non-members", r.status === 403);
r = await carol.req("PUT", `/messages/star/${gm._id}`, { starred: true });
const gl = (await carol.req("GET", `/groups/${gid}/messages`)).data || [];
log("group", "star in a group is private to the member", r.status === 200 && gl.find((x) => x._id === gm._id)?.starred === true && (await bob.req("GET", `/groups/${gid}/messages`)).data.find((x) => x._id === gm._id)?.starred === false);
r = await carol.req("DELETE", `/messages/${gm._id}?scope=me`);
log("group", "delete for me in a group hides it only for me", !((await carol.req("GET", `/groups/${gid}/messages`)).data || []).some((x) => x._id === gm._id) && ((await bob.req("GET", `/groups/${gid}/messages`)).data || []).some((x) => x._id === gm._id));
bob.clear();
r = await alice.req("DELETE", `/messages/${gm._id}?scope=everyone`);
log("group", "delete for everyone in a group", r.status === 200 && !!(await bob.waitFor("messageDeleted", (p) => p.messageId === gm._id && p.groupId === gid)));
const groups = (await alice.req("GET", "/groups")).data || [];
const lm = groups.find((g) => g._id === gid)?.lastMessage;
log("group", "group list lastMessage exposes no private arrays", !lm || (!("starredBy" in lm) && !("deletedFor" in lm)));
r = await alice.req("POST", "/messages/forward", { messageId: live._id, targets: [{ type: "group", id: gid }] });
log("group", "forward into a group", r.status === 200 && r.data.results?.[0]?.ok === true);

// ───────────────────────── summary ─────────────────────────
for (const c of [alice, bob, carol, dave]) c.sock?.disconnect();
const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("FAILED:"); failed.forEach((f) => console.log(` - [${f.area}] ${f.name}`)); }
process.exit(failed.length ? 1 : 0);
