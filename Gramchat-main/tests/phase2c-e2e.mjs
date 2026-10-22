// Phase 2C API checks: idempotent sends (clientId) and message paging (infinite scroll).
// Runs against a live server like api-e2e.mjs (see tests/README.md). Restart the server between runs and start it with
// SIGNUP_LIMIT_PER_HOUR=500. The Message model gained a unique (senderId, clientId) index: a freshly started server builds it.
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
const cid = (tag) => `c${Date.now().toString(36)}${tag}${Math.random().toString(36).slice(2, 10)}`;

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

const alice = await mk("Alice2c"), bob = await mk("Bob2c"), carol = await mk("Carol2c");
await befriend(alice, bob); await befriend(alice, carol);
await alice.connect(); await bob.connect();
log("setup", "three users, alice↔bob and alice↔carol are contacts", !!(alice.user && bob.user && carol.user));

// ───────────────────────── IDEMPOTENT DM SENDS ─────────────────────────
console.log("\n=== IDEMPOTENT SENDS (1:1) ===");
const id1 = cid("a");
let r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "hello once", clientId: id1 });
const first = r.data;
log("dm", "send with a clientId → 201", r.status === 201 && !!first?._id);
log("dm", "the sender gets the clientId back", first?.clientId === id1);
const bobGot = await bob.waitFor("newMessage", (p) => p._id === first?._id);
log("dm", "the recipient's copy does not carry the clientId", !!bobGot && bobGot.clientId === undefined);

bob.events = [];
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "hello once", clientId: id1 });
log("dm", "re-sending the same clientId → 200 with the original message", r.status === 200 && r.data?._id === first?._id && r.data?.clientId === id1);
await sleep(300);
log("dm", "…and the recipient is not notified a second time", bob.events.filter((e) => e.ev === "newMessage").length === 0);

r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "a different text, same clientId", clientId: id1 });
log("dm", "a retry never changes the stored message", r.status === 200 && r.data?._id === first?._id && r.data?.text === "hello once");

const thread = (await bob.req("GET", `/messages/${alice.user._id}`)).data || [];
log("dm", "the conversation holds exactly one copy", thread.filter((m) => m.text === "hello once").length === 1);
log("dm", "history for the recipient has no clientId", thread.every((m) => m.clientId === undefined));
const mine = (await alice.req("GET", `/messages/${bob.user._id}`)).data || [];
log("dm", "history for the sender keeps the clientId", mine.find((m) => m._id === first?._id)?.clientId === id1);

r = await alice.req("POST", `/messages/send/${carol.user._id}`, { text: "to carol", clientId: id1 });
log("dm", "the same clientId for a different chat → 409", r.status === 409, `got ${r.status}`);
r = await bob.req("POST", `/messages/send/${alice.user._id}`, { text: "bob reuses it", clientId: id1 });
log("dm", "clientIds are per sender: another user can use the same one", r.status === 201 && r.data?.text === "bob reuses it");

for (const [name, v] of [["too short", "abc"], ["bad characters", "has spaces and $$$ in it"], ["not a string", 12345678], ["too long", "x".repeat(65)]]) {
  r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "x", clientId: v });
  log("dm", `clientId ${name} → 400`, r.status === 400, `got ${r.status}`);
}
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "no id" });
const r2 = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "no id" });
log("dm", "sending without a clientId still works (and is not de-duplicated)", r.status === 201 && r2.status === 201 && r.data._id !== r2.data._id);

// attachment: the retry must not store the file twice
const id2 = cid("b");
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "with picture", image: PNG, clientId: id2 });
const pic = r.data;
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "with picture", image: PNG, clientId: id2 });
log("dm", "retrying a message with an attachment returns the same message and the same file", r.status === 200 && r.data?._id === pic?._id && r.data?.image === pic?.image);

// a burst of identical sends at once (the "request got stuck, user tapped Retry" case)
const id3 = cid("c");
const burst = await Promise.all(Array.from({ length: 6 }, () => alice.req("POST", `/messages/send/${bob.user._id}`, { text: "burst", image: PNG, clientId: id3 })));
const ids = new Set(burst.map((b) => b.data?._id));
log("dm", "six simultaneous identical sends → every answer is the same message", burst.every((b) => [200, 201].includes(b.status)) && ids.size === 1, `statuses ${burst.map((b) => b.status).join(",")}`);
log("dm", "…and only one of them was created (201)", burst.filter((b) => b.status === 201).length === 1);
const afterBurst = (await bob.req("GET", `/messages/${alice.user._id}`)).data || [];
log("dm", "…and the conversation holds a single \"burst\" message", afterBurst.filter((m) => m.text === "burst").length === 1);
const burstFiles = new Set(burst.map((b) => b.data?.image));
log("dm", "…all pointing at one image file", burstFiles.size === 1);

// retry after "delete for everyone" must not resurrect the message
const id4 = cid("d");
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "to be deleted", clientId: id4 });
await alice.req("DELETE", `/messages/${r.data._id}?scope=everyone`);
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "to be deleted", clientId: id4 });
log("dm", "a retry after the message was deleted for everyone returns the tombstone, not a new message", r.status === 200 && r.data?.deletedForEveryone === true && !r.data?.text);

// a retry still works after the contact was removed (the first attempt had succeeded)
const id5 = cid("e");
await alice.req("POST", `/messages/send/${carol.user._id}`, { text: "before the split", clientId: id5 });
await alice.req("DELETE", `/contacts/${carol.user._id}`);
r = await alice.req("POST", `/messages/send/${carol.user._id}`, { text: "before the split", clientId: id5 });
log("dm", "a retry of an already-sent message still answers after the contact was removed", r.status === 200 && r.data?.text === "before the split", `got ${r.status}`);
r = await alice.req("POST", `/messages/send/${carol.user._id}`, { text: "brand new", clientId: cid("f") });
log("dm", "…but a NEW message to a removed contact is still refused", r.status === 403);

// ───────────────────────── IDEMPOTENT GROUP SENDS ─────────────────────────
console.log("\n=== IDEMPOTENT SENDS (group) ===");
r = await alice.req("POST", "/groups", { name: "Retry 2C", memberIds: [bob.user._id] });
const gid = r.data?._id;
const gid2 = (await alice.req("POST", "/groups", { name: "Other 2C", memberIds: [bob.user._id] })).data?._id;
const g1 = cid("g");
r = await alice.req("POST", `/groups/${gid}/messages`, { text: "group once", clientId: g1 });
const gfirst = r.data;
log("group", "send with a clientId → 201 and the sender gets it back", r.status === 201 && gfirst?.clientId === g1);
bob.events = [];
r = await alice.req("POST", `/groups/${gid}/messages`, { text: "group once", clientId: g1 });
log("group", "re-sending the same clientId → 200 with the original", r.status === 200 && r.data?._id === gfirst?._id);
await sleep(300);
log("group", "…and members are not notified twice", bob.events.filter((e) => e.ev === "newGroupMessage").length === 0);
const gthread = (await bob.req("GET", `/groups/${gid}/messages`)).data || [];
log("group", "the group holds one copy, and members don't see the clientId", gthread.filter((m) => m.text === "group once").length === 1 && gthread.every((m) => m.clientId === undefined));
r = await alice.req("POST", `/groups/${gid2}/messages`, { text: "other group", clientId: g1 });
log("group", "the same clientId for another group → 409", r.status === 409);
r = await alice.req("POST", `/groups/${gid}/messages`, { text: "x", clientId: "short" });
log("group", "invalid clientId → 400", r.status === 400);
const gb = await Promise.all(Array.from({ length: 5 }, () => alice.req("POST", `/groups/${gid}/messages`, { text: "group burst", clientId: cid("h") })));
// each call has its own clientId, so these are 5 different messages: sanity check that they don't collapse
log("group", "different clientIds are different messages", new Set(gb.map((x) => x.data?._id)).size === 5);
const gsame = cid("i");
const gb2 = await Promise.all(Array.from({ length: 5 }, () => alice.req("POST", `/groups/${gid}/messages`, { text: "group race", clientId: gsame })));
log("group", "five simultaneous identical sends → one message", new Set(gb2.map((x) => x.data?._id)).size === 1 && gb2.filter((x) => x.status === 201).length === 1);
const carolGroupTry = await carol.req("POST", `/groups/${gid}/messages`, { text: "not a member", clientId: cid("j") });
log("group", "a non-member still can't send", carolGroupTry.status === 403);

// ───────────────────────── PAGING (infinite scroll) ─────────────────────────
console.log("\n=== PAGING ===");
r = await alice.req("POST", "/groups", { name: "Paging 2C", memberIds: [bob.user._id] });
const pg = r.data?._id;
for (let i = 1; i <= 60; i++) await alice.req("POST", `/groups/${pg}/messages`, { text: `m${String(i).padStart(2, "0")}`, clientId: cid("p") });
const p1 = (await bob.req("GET", `/groups/${pg}/messages?limit=25`)).data || [];
log("paging", "first page: the 25 newest, oldest first", p1.length === 25 && p1[0].text === "m36" && p1[24].text === "m60");
const p2 = (await bob.req("GET", `/groups/${pg}/messages?limit=25&before=${encodeURIComponent(p1[0].createdAt)}`)).data || [];
log("paging", "second page: the 25 before it, no overlap, no gap", p2.length === 25 && p2[0].text === "m11" && p2[24].text === "m35");
const p3 = (await bob.req("GET", `/groups/${pg}/messages?limit=25&before=${encodeURIComponent(p2[0].createdAt)}`)).data || [];
log("paging", "last page is shorter (10 left): the app stops asking", p3.length === 10 && p3[0].text === "m01" && p3[9].text === "m10");
const p4 = (await bob.req("GET", `/groups/${pg}/messages?limit=25&before=${encodeURIComponent(p3[0].createdAt)}`)).data || [];
log("paging", "beyond the oldest message: empty", p4.length === 0);
const big = (await bob.req("GET", `/groups/${pg}/messages?limit=100000`)).data || [];
log("paging", "an absurd limit is capped (all 60 fit under the cap of 100)", big.length === 60);
const junk = await bob.req("GET", `/groups/${pg}/messages?before=not-a-date&limit=5`);
log("paging", "a garbage `before` is ignored", junk.status === 200 && junk.data.length === 5 && junk.data[4].text === "m60");
const outsider = await carol.req("GET", `/groups/${pg}/messages?limit=5`);
log("paging", "non-members can't page through a group", outsider.status === 403);

// same for 1:1
const dmp1 = (await alice.req("GET", `/messages/${bob.user._id}?limit=3`)).data || [];
const dmp2 = (await alice.req("GET", `/messages/${bob.user._id}?limit=3&before=${encodeURIComponent(dmp1[0].createdAt)}`)).data || [];
log("paging", "1:1 chats page the same way (no overlap)", dmp1.length === 3 && dmp2.length === 3 && !dmp2.some((m) => dmp1.some((n) => n._id === m._id)) && dmp2[2].createdAt <= dmp1[0].createdAt);

// ───────────────────────── summary ─────────────────────────
for (const c of [alice, bob]) c.sock?.disconnect();
const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("FAILED:"); failed.forEach((f) => console.log(` - [${f.area}] ${f.name}`)); }
process.exit(failed.length ? 1 : 0);
