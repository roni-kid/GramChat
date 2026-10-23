// Phase 2F API checks: group per-member ticks, voice-note waveforms, and "Keep" for disappearing messages.
// Runs against a live server like the other suites (see tests/README.md): restart the server between runs and start it with
// SIGNUP_LIMIT_PER_HOUR=500.
//
// The part of "Keep" that needs a message to actually reach its expiry runs only with the short-timer test switch
// (start the server with DISAPPEAR_ALLOW_SHORT_TIMERS=1 DISAPPEAR_SWEEP_SECONDS=2, run this with SHORT=1; never on a real server).
//
// Not covered here: on-device transcripts (they run in the browser; there is no server part to test).
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
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const AUDIO = `data:audio/webm;base64,${b64("not really opus but good enough for a type check")}`;
const PEAKS = Array.from({ length: 48 }, (_, i) => Math.round(50 + 45 * Math.sin(i / 3)));

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
    let data = null; try { data = await res.json(); } catch { /* empty */ }
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
  async waitFor(ev, pred = () => true, ms = 2500) {
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
const sendGroup = (from, gid, body) => from.req("POST", `/groups/${gid}/messages`, body);
const groupHistory = async (c, gid) => (await c.req("GET", `/groups/${gid}/messages`)).data || [];
const dmHistory = async (c, other) => (await c.req("GET", `/messages/${other.user._id}`)).data || [];
const DAY = 86400;
const near = (iso, seconds) => !!iso && Math.abs((new Date(iso).getTime() - Date.now()) / 1000 - seconds) < 120;
const tickEvent = (c, messageId, pred = () => true) => c.waitFor("groupReceipt", (p) => p.updates?.some((u) => u.messageId === messageId && pred(u.ticks)));

const alice = await mk("Alice2f"), bob = await mk("Bob2f"), carol = await mk("Carol2f"), dave = await mk("Dave2f");
await befriend(alice, bob); await befriend(alice, carol);
await alice.connect(); await bob.connect(); await dave.connect(); // carol connects later, on purpose
log("setup", "four users; alice is a contact of bob and carol; carol's device is offline for now", !!(alice.user && bob.user && carol.user && dave.user));
const anon = new Client("anon");

let r = await alice.req("POST", "/groups", { name: "Ticks 2F", memberIds: [bob.user._id, carol.user._id] });
const gid = r.data?._id;
log("setup", "group: alice (admin), bob, carol", r.status === 201 && !!gid);

// ───────────────────────── GROUP TICKS ─────────────────────────
console.log("\n=== GROUP TICKS ===");
r = await sendGroup(alice, gid, { text: "who is here?" });
const g1 = r.data;
log("ticks", "a new group message: 2 other members, 1 online already has it", r.status === 201 && g1?.ticks?.total === 2 && g1?.ticks?.delivered === 1 && g1?.ticks?.read === 0);
log("ticks", "the raw lists never appear in the payload", g1 && g1.deliveredTo === undefined && g1.readBy === undefined);
let h = (await groupHistory(alice, gid)).find((m) => m._id === g1._id);
log("ticks", "history gives the sender the same counts", h?.ticks?.total === 2 && h?.ticks?.delivered === 1 && h.deliveredTo === undefined && h.readBy === undefined);
const bobsView = (await groupHistory(bob, gid)).find((m) => m._id === g1._id);
log("ticks", "other members don't get ticks on someone else's message", !!bobsView && bobsView.ticks === undefined && bobsView.deliveredTo === undefined);

await carol.connect();
const dEv = await tickEvent(alice, g1._id, (t) => t.delivered === 2);
log("ticks", "when carol's device connects it is delivered to her, and alice is told", !!dEv && dEv.groupId === gid);
h = (await groupHistory(alice, gid)).find((m) => m._id === g1._id);
log("ticks", "…delivered 2 of 2, read 0", h?.ticks?.delivered === 2 && h?.ticks?.read === 0);

r = await anon.req("PUT", `/groups/${gid}/read`);
log("ticks", "marking read requires login", r.status === 401);
r = await dave.req("PUT", `/groups/${gid}/read`);
log("ticks", "a non-member can't mark a group read", r.status === 403);

alice.events = [];
r = await bob.req("PUT", `/groups/${gid}/read`);
log("ticks", "bob reads the group", r.status === 200 && r.data?.updated >= 1);
const rEv1 = await tickEvent(alice, g1._id, (t) => t.read === 1);
log("ticks", "alice is told: read by 1 of 2", rEv1?.updates?.find((u) => u.messageId === g1._id)?.ticks?.readTotal === 2);
r = await bob.req("PUT", `/groups/${gid}/read`);
log("ticks", "reading again changes nothing (idempotent)", r.status === 200 && r.data?.updated === 0);

alice.events = [];
await carol.req("PUT", `/groups/${gid}/read`);
const rEv2 = await tickEvent(alice, g1._id, (t) => t.read === 2);
log("ticks", "carol reads: everyone has read it", !!rEv2);
h = (await groupHistory(alice, gid)).find((m) => m._id === g1._id);
log("ticks", "history: read 2 of 2", h?.ticks?.read === 2 && h?.ticks?.readTotal === 2);

// message info
r = await alice.req("GET", `/messages/info/${g1._id}`);
const names = (list) => (list || []).map((e) => e.user?.fullName).sort().join(",");
log("ticks", "message info lists who read it (sender only)", r.status === 200 && names(r.data?.read) === "Bob2f,Carol2f" && r.data?.pending?.length === 0 && r.data?.total === 2);
r = await bob.req("GET", `/messages/info/${g1._id}`);
log("ticks", "other members can't see a message's info", r.status === 403);
r = await dave.req("GET", `/messages/info/${g1._id}`);
log("ticks", "an outsider gets 404", r.status === 404);
const dm1 = (await sendDM(alice, bob, { text: "just a 1:1 message" })).data;
r = await alice.req("GET", `/messages/info/${dm1._id}`);
log("ticks", "info is for group messages only", r.status === 404);

// a member who reads before the sender's other members: partial states
const g2 = (await sendGroup(alice, gid, { text: "second one" })).data;
alice.events = [];
await bob.req("PUT", `/groups/${gid}/read`);
await tickEvent(alice, g2._id, (t) => t.read === 1);
r = await alice.req("GET", `/messages/info/${g2._id}`);
log("ticks", "info: bob under 'read by', carol under 'delivered to'", names(r.data?.read) === "Bob2f" && names(r.data?.delivered) === "Carol2f");

// read receipts are reciprocal and private
r = await carol.req("PUT", "/auth/privacy", { readReceipts: false });
log("privacy", "carol turns read receipts off", r.status === 200);
const g3 = (await sendGroup(alice, gid, { text: "third, after carol turned receipts off" })).data;
await bob.req("PUT", `/groups/${gid}/read`);
await carol.req("PUT", `/groups/${gid}/read`);
await sleep(300);
h = (await groupHistory(alice, gid)).find((m) => m._id === g3._id);
log("privacy", "carol doesn't count: 'seen' needs only the people who share receipts (bob)", h?.ticks?.readTotal === 1 && h?.ticks?.read === 1 && h?.ticks?.delivered === 2);
r = await alice.req("GET", `/messages/info/${g3._id}`);
log("privacy", "carol's read is never revealed: she shows under 'delivered to'", names(r.data?.read) === "Bob2f" && names(r.data?.delivered) === "Carol2f");
await carol.req("PUT", "/auth/privacy", { readReceipts: true });

await alice.req("PUT", "/auth/privacy", { readReceipts: false });
h = (await groupHistory(alice, gid)).find((m) => m._id === g1._id);
log("privacy", "a sender with receipts off sees no read information at all", h?.ticks?.read === 0 && h?.ticks?.readTotal === 0 && h?.ticks?.delivered === 2);
r = await alice.req("GET", `/messages/info/${g1._id}`);
log("privacy", "…and message info says so (delivery is still shown)", r.data?.readHidden === true && r.data?.read?.length === 0 && r.data?.delivered?.length === 2);
await alice.req("PUT", "/auth/privacy", { readReceipts: true });

// ───────────────────────── VOICE WAVEFORM ─────────────────────────
console.log("\n=== VOICE WAVEFORMS ===");
r = await sendDM(alice, bob, { fileUrl: AUDIO, fileName: "Voice message", voice: true, voiceDuration: 9, voiceWaveform: PEAKS });
const v1 = r.data;
log("wave", "a voice note keeps its waveform", r.status === 201 && Array.isArray(v1?.voiceWaveform) && v1.voiceWaveform.length === 48 && v1.voiceWaveform[5] === PEAKS[5]);
log("wave", "the recipient gets it too (live and in history)", ((await dmHistory(bob, alice)).find((m) => m._id === v1._id)?.voiceWaveform || []).length === 48);
const bad = {
  "not numbers": Array.from({ length: 48 }, () => "x"),
  "too short": [10, 20, 30],
  "too long": Array.from({ length: 300 }, () => 50),
  "out of range": Array.from({ length: 48 }, () => 150),
  "fractions": Array.from({ length: 48 }, () => 12.5),
};
for (const [label, peaks] of Object.entries(bad)) {
  r = await sendDM(alice, bob, { fileUrl: AUDIO, fileName: "Voice message", voice: true, voiceDuration: 3, voiceWaveform: peaks });
  log("wave", `a bad waveform (${label}) is dropped, the voice note still sends`, r.status === 201 && r.data?.voice === true && r.data?.voiceWaveform === undefined);
}
r = await sendDM(alice, bob, { text: "no waveform here", voiceWaveform: PEAKS });
log("wave", "a waveform on a message that isn't a voice note is ignored", r.status === 201 && r.data?.voiceWaveform === undefined);
r = await sendDM(alice, bob, { fileUrl: AUDIO, fileName: "Voice message", voice: true, voiceDuration: 4, voiceWaveform: PEAKS, viewOnce: true });
log("wave", "a view-once voice note carries no waveform", r.status === 201 && r.data?.viewOnce === true && r.data?.voiceWaveform === undefined);
r = await sendGroup(alice, gid, { fileUrl: AUDIO, fileName: "Voice message", voice: true, voiceDuration: 6, voiceWaveform: PEAKS });
log("wave", "voice notes in groups too", r.status === 201 && r.data?.voiceWaveform?.length === 48);
r = await bob.req("POST", "/messages/forward", { messageId: v1._id, targets: [{ type: "user", id: alice.user._id }] });
const fw = (await dmHistory(alice, bob)).find((m) => m.forwarded && m.voice);
log("wave", "a forwarded voice note keeps the waveform", r.status === 200 && fw?.voiceWaveform?.length === 48);

// ───────────────────────── KEEP ─────────────────────────
console.log("\n=== KEEP ===");
const plain = (await sendDM(alice, bob, { text: "no timer on this chat yet" })).data;
r = await bob.req("PUT", `/messages/keep/${plain._id}`, { kept: true });
log("keep", "only disappearing messages can be kept", r.status === 400, r.data?.message);

await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: DAY });
const k1 = (await sendDM(alice, bob, { text: "keep me" })).data;
log("keep", "setup: a message set to disappear in 24 h", near(k1?.expiresAt, DAY));
r = await bob.req("PUT", `/messages/keep/${k1._id}`, { kept: "yes" });
log("keep", "kept must be a boolean", r.status === 400);
r = await anon.req("PUT", `/messages/keep/${k1._id}`, { kept: true });
log("keep", "keeping requires login", r.status === 401);
r = await carol.req("PUT", `/messages/keep/${k1._id}`, { kept: true });
log("keep", "an outsider gets 404", r.status === 404);

alice.events = []; bob.events = [];
r = await bob.req("PUT", `/messages/keep/${k1._id}`, { kept: true });
log("keep", "the recipient keeps it", r.status === 200 && r.data?.keptBy === bob.user._id);
const ke = await alice.waitFor("messageKept", (p) => p.messageId === k1._id);
log("keep", "the sender is told who kept it", ke?.keptBy === bob.user._id && ke?.by === bob.user._id && ke?.expiresAt === null);
log("keep", "bob's own devices are told too", !!(await bob.waitFor("messageKept", (p) => p.messageId === k1._id)));
let ah = (await dmHistory(alice, bob)).find((m) => m._id === k1._id);
let bh = (await dmHistory(bob, alice)).find((m) => m._id === k1._id);
log("keep", "it no longer has an expiry for either of them, and shows who kept it", !ah?.expiresAt && !bh?.expiresAt && ah?.keptBy === bob.user._id && bh?.keptBy === bob.user._id);
r = await bob.req("PUT", `/messages/keep/${k1._id}`, { kept: true });
log("keep", "keeping a kept message is harmless", r.status === 200 && r.data?.keptBy === bob.user._id);

alice.events = [];
r = await alice.req("PUT", `/messages/keep/${k1._id}`, { kept: false });
log("keep", "the sender can unkeep it", r.status === 200 && r.data?.keptBy === null && near(r.data?.expiresAt, DAY));
const ue = await bob.waitFor("messageKept", (p) => p.messageId === k1._id && p.keptBy === null);
log("keep", "bob is told, with the fresh expiry (the chat's timer, counted from now)", near(ue?.expiresAt, DAY));
ah = (await dmHistory(alice, bob)).find((m) => m._id === k1._id);
log("keep", "the message is back to expiring", near(ah?.expiresAt, DAY) && !ah?.keptBy);

// unkeep permissions in a group: the keeper or the sender, nobody else
await alice.req("PUT", `/groups/${gid}/disappearing`, { seconds: 7 * DAY });
const gk = (await sendGroup(alice, gid, { text: "group message to keep" })).data;
r = await bob.req("PUT", `/messages/keep/${gk._id}`, { kept: true });
log("keep", "any group member can keep a message", r.status === 200 && r.data?.keptBy === bob.user._id);
r = await carol.req("PUT", `/messages/keep/${gk._id}`, { kept: false });
log("keep", "another member can't unkeep it", r.status === 403);
r = await bob.req("PUT", `/messages/keep/${gk._id}`, { kept: false });
log("keep", "the keeper can", r.status === 200 && r.data?.keptBy === null);
await bob.req("PUT", `/messages/keep/${gk._id}`, { kept: true });
r = await alice.req("PUT", `/messages/keep/${gk._id}`, { kept: false });
log("keep", "and so can the message's sender", r.status === 200 && near((await groupHistory(alice, gid)).find((m) => m._id === gk._id)?.expiresAt, 7 * DAY));
await alice.req("PUT", `/groups/${gid}/disappearing`, { seconds: 0 });

// if the chat's timer is off by the time it is un-kept, the message simply stays
await bob.req("PUT", `/messages/keep/${k1._id}`, { kept: true });
await bob.req("PUT", `/chats/timer/user/${alice.user._id}`, { seconds: 0 });
r = await bob.req("PUT", `/messages/keep/${k1._id}`, { kept: false });
ah = (await dmHistory(alice, bob)).find((m) => m._id === k1._id);
log("keep", "un-kept after the timer was turned off: no new countdown, it just stays", r.status === 200 && r.data?.expiresAt === null && !ah?.expiresAt && !ah?.keptBy);

// things that can't be kept
await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: DAY });
const vo = (await sendDM(alice, bob, { image: PNG, viewOnce: true })).data;
r = await bob.req("PUT", `/messages/keep/${vo._id}`, { kept: true });
log("keep", "a view-once message can't be kept", r.status === 400);
const gone = (await sendDM(alice, bob, { text: "retracted" })).data;
await alice.req("DELETE", `/messages/${gone._id}?scope=everyone`);
r = await bob.req("PUT", `/messages/keep/${gone._id}`, { kept: true });
log("keep", "a message deleted for everyone can't be kept", r.status === 400);
await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: 0 });

if (!SHORT) {
  console.log("SKIPPED: a kept message really surviving its expiry (needs a server started with DISAPPEAR_ALLOW_SHORT_TIMERS=1 DISAPPEAR_SWEEP_SECONDS=2, and SHORT=1; see tests/README.md)");
} else {
  console.log("--- SHORT mode: a kept message outlives its timer ---");
  await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: 5 });
  const mortal = (await sendDM(alice, bob, { text: "this one disappears" })).data;
  const saved = (await sendDM(alice, bob, { text: "this one is kept" })).data;
  r = await bob.req("PUT", `/messages/keep/${saved._id}`, { kept: true });
  log("keep", "kept straight away (5 s timer)", r.status === 200);
  await sleep(9000);
  const left = await dmHistory(bob, alice);
  log("keep", "after the timer the kept message is still there, the other one is gone", left.some((m) => m._id === saved._id) && !left.some((m) => m._id === mortal._id));
  const stillKept = left.find((m) => m._id === saved._id);
  log("keep", "…and it has no expiry", !stillKept?.expiresAt && stillKept?.keptBy === bob.user._id);
  await alice.req("PUT", `/chats/timer/user/${bob.user._id}`, { seconds: 0 });
}

for (const c of [alice, bob, carol, dave]) c.sock?.disconnect();
const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("FAILED:"); failed.forEach((f) => console.log(` - [${f.area}] ${f.name}`)); }
process.exit(failed.length ? 1 : 0);
