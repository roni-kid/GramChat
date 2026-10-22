// Phase 2B API checks: voice notes and push-subscription handling.
// Runs against a live server like api-e2e.mjs (see tests/README.md). Restart the server between runs and start it with
// SIGNUP_LIMIT_PER_HOUR=500. It never leaves a push subscription behind and never sends a real push.
import crypto from "node:crypto";
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
// Not real audio: the server checks the declared type, not the bytes
const AUDIO = (type = "audio/webm") => `data:${type};base64,${Buffer.from("not really opus but good enough for a type check").toString("base64")}`;
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

const alice = await mk("Alice2b"), bob = await mk("Bob2b"), carol = await mk("Carol2b");
await befriend(alice, bob); await befriend(alice, carol);
await alice.connect(); await bob.connect(); await carol.connect();
log("setup", "three users, alice↔bob and alice↔carol are contacts", !!(alice.user && bob.user && carol.user));

// ───────────────────────── VOICE NOTES ─────────────────────────
console.log("\n=== VOICE NOTES ===");
let r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "", fileUrl: AUDIO(), fileName: "whatever.webm", voice: true, voiceDuration: 12 });
const v = r.data;
log("voice", "send a voice note → 201", r.status === 201 && v?.voice === true);
log("voice", "stored as audio with its duration, no text", v?.fileType === "audio" && v?.voiceDuration === 12 && !v?.text);
log("voice", "client-supplied file name is replaced", v?.fileName === "Voice message");
log("voice", "recipient receives it live as a voice note", !!(await bob.waitFor("newMessage", (p) => p._id === v?._id && p.voice === true)));
log("voice", "the audio file can be downloaded", v?.fileUrl ? (await alice.req("GET", v.fileUrl.replace("/api", ""))).status === 200 : false);
const thread = (await bob.req("GET", `/messages/${alice.user._id}`)).data || [];
log("voice", "history keeps voice + duration", thread.find((m) => m._id === v?._id)?.voiceDuration === 12);
const convs = (await bob.req("GET", "/messages/conversations")).data || [];
log("voice", "chat-list preview knows it's a voice note", convs.find((c) => c.userId === alice.user._id)?.lastMessage?.voice === true);

r = await alice.req("POST", `/messages/send/${bob.user._id}`, { fileUrl: AUDIO(), voice: true, voiceDuration: 99999 });
log("voice", "absurd duration is clamped to 15 minutes", r.status === 201 && r.data.voiceDuration === 900, `got ${r.data?.voiceDuration}`);
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { fileUrl: AUDIO(), voice: true, voiceDuration: -5 });
log("voice", "negative duration is ignored", r.status === 201 && r.data.voiceDuration === undefined);
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { fileUrl: AUDIO("audio/mp4"), voice: true, voiceDuration: 3 });
log("voice", "MP4/AAC recordings (Safari) are accepted", r.status === 201 && r.data.voice === true);

r = await alice.req("POST", `/messages/send/${bob.user._id}`, { fileUrl: PNG, voice: true });
log("voice", "an image can't pose as a voice note", r.status === 400, r.data?.message);
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "hi", voice: true });
log("voice", "voice flag without a recording → 400", r.status === 400);
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { fileUrl: AUDIO(), image: PNG, voice: true });
log("voice", "voice note + image together → 400", r.status === 400);
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { fileUrl: AUDIO(), voice: "yes" });
log("voice", "non-boolean voice flag → 400", r.status === 400);
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { fileUrl: AUDIO("audio/webm;codecs=opus"), voice: true });
log("voice", "codec parameters in the data URL are refused (the app strips them before sending)", r.status === 400, `got ${r.status}`);
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { fileUrl: AUDIO("audio/mpeg"), fileName: "song.mp3" });
log("voice", "a plain audio attachment is still just a file (voice=false)", r.status === 201 && !r.data.voice && r.data.fileType === "audio");
r = await alice.req("POST", `/messages/send/${bob.user._id}`, { text: "voice with caption?", fileUrl: AUDIO(), voice: true });
log("voice", "text sent along with a voice note is dropped", r.status === 201 && !r.data.text);

r = await alice.req("PUT", `/messages/edit/${v._id}`, { text: "caption" });
log("voice", "voice notes can't be edited", r.status === 400);

carol.events = [];
r = await alice.req("POST", "/messages/forward", { messageId: v._id, targets: [{ type: "user", id: carol.user._id }] });
const fwd = await carol.waitFor("newMessage", (p) => p.forwarded === true);
log("voice", "forwarding keeps it a voice note with its duration", r.status === 200 && fwd?.voice === true && fwd?.voiceDuration === 12);
log("voice", "…with its own copy of the file", !!fwd?.fileUrl && fwd.fileUrl !== v.fileUrl);

r = await alice.req("POST", "/groups", { name: "Voice 2B", memberIds: [bob.user._id, carol.user._id] });
const gid = r.data?._id;
r = await alice.req("POST", `/groups/${gid}/messages`, { fileUrl: AUDIO(), voice: true, voiceDuration: 5 });
log("voice", "voice note in a group", r.status === 201 && r.data.voice === true);
const gmsg = (await carol.req("GET", `/groups/${gid}/messages`)).data?.find((m) => m._id === r.data?._id);
log("voice", "group members see voice + duration", gmsg?.voice === true && gmsg?.voiceDuration === 5);

r = await alice.req("DELETE", `/messages/${v._id}?scope=everyone`);
await sleep(200);
const tomb = ((await bob.req("GET", `/messages/${alice.user._id}`)).data || []).find((m) => m._id === v._id);
log("voice", "deleting for everyone wipes voice data from the tombstone", r.status === 200 && tomb?.deletedForEveryone === true && !tomb?.voice && !tomb?.fileUrl && tomb?.voiceDuration === undefined);
log("voice", "…and removes the audio file from disk", (await alice.req("GET", v.fileUrl.replace("/api", ""))).status === 404);
log("voice", "…but the forwarded copy still plays", fwd?.fileUrl ? (await carol.req("GET", fwd.fileUrl.replace("/api", ""))).status === 200 : false);

// ───────────────────────── PUSH ─────────────────────────
console.log("\n=== PUSH SUBSCRIPTIONS ===");
const anon = new Client("anon");
r = await anon.req("GET", "/push/key");
log("push", "key endpoint requires login", r.status === 401);
r = await alice.req("GET", "/push/key");
const pushOn = r.status === 200 && r.data?.enabled === true && typeof r.data.publicKey === "string" && r.data.publicKey.length > 60;
log("push", "push is enabled on this server (web-push installed, VAPID keys present)", pushOn, pushOn ? "" : "run `npm install --prefix backend` and restart");

if (pushOn) {
  const newKeys = () => {
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.generateKeys();
    return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
  };
  const ep = (n) => `https://fcm.googleapis.com/fcm/send/test-${stamp}-${n}`;
  const sub = (endpoint, keys = newKeys()) => ({ subscription: { endpoint, keys } });

  for (const [name, endpoint] of [
    ["a non-push host", "https://evil.example.com/push/abc"],
    ["plain http", "http://fcm.googleapis.com/fcm/send/x"],
    ["an internal address (SSRF)", "https://127.0.0.1/x"],
    ["a look-alike host", "https://fcm.googleapis.com.evil.com/x"],
    ["the push host only in the path", "https://evil.com/fcm.googleapis.com"],
    ["credentials in the URL", "https://user:pw@fcm.googleapis.com/x"],
    ["a non-standard port", "https://fcm.googleapis.com:8443/x"],
  ]) {
    r = await alice.req("POST", "/push/subscribe", sub(endpoint));
    log("push", `rejects ${name}`, r.status === 400, `got ${r.status}`);
  }
  r = await alice.req("POST", "/push/subscribe", { subscription: { endpoint: ep(0), keys: { p256dh: "abc", auth: "def" } } });
  log("push", "rejects malformed keys", r.status === 400);
  r = await alice.req("POST", "/push/subscribe", {});
  log("push", "rejects an empty body", r.status === 400);
  r = await anon.req("POST", "/push/subscribe", sub(ep(0)));
  log("push", "subscribing requires login", r.status === 401);

  const e1 = ep(1);
  r = await alice.req("POST", "/push/subscribe", sub(e1));
  log("push", "valid subscription accepted", r.status === 200 && r.data.subscribed === true);
  r = await alice.req("GET", `/push/status?endpoint=${encodeURIComponent(e1)}`);
  log("push", "status: subscribed, text preview off by default", r.data?.subscribed === true && r.data?.preview === false);
  r = await alice.req("PUT", "/push/prefs", { endpoint: e1, preview: true });
  log("push", "preference can be changed", r.status === 200 && r.data.preview === true);
  r = await alice.req("PUT", "/push/prefs", { endpoint: e1, preview: "yes" });
  log("push", "non-boolean preference rejected", r.status === 400);
  log("push", "status reflects the new preference", (await alice.req("GET", `/push/status?endpoint=${encodeURIComponent(e1)}`)).data?.preview === true);

  r = await bob.req("GET", `/push/status?endpoint=${encodeURIComponent(e1)}`);
  log("push", "another account can't see this device as theirs", r.data?.subscribed === false);
  await bob.req("POST", "/push/unsubscribe", { endpoint: e1 });
  log("push", "another account can't unsubscribe it", (await alice.req("GET", `/push/status?endpoint=${encodeURIComponent(e1)}`)).data?.subscribed === true);
  r = await bob.req("PUT", "/push/prefs", { endpoint: e1, preview: false });
  log("push", "another account can't change its preferences", r.status === 404);

  r = await bob.req("POST", "/push/subscribe", sub(e1));
  log("push", "logging in on the same device with another account moves the subscription", r.status === 200
    && (await alice.req("GET", `/push/status?endpoint=${encodeURIComponent(e1)}`)).data?.subscribed === false
    && (await bob.req("GET", `/push/status?endpoint=${encodeURIComponent(e1)}`)).data?.subscribed === true);
  await bob.req("POST", "/push/unsubscribe", { endpoint: e1 });
  log("push", "unsubscribe works", (await bob.req("GET", `/push/status?endpoint=${encodeURIComponent(e1)}`)).data?.subscribed === false);

  for (let i = 10; i < 22; i++) await alice.req("POST", "/push/subscribe", sub(ep(i)));
  log("push", "at most 10 devices per account (oldest dropped)",
    (await alice.req("GET", `/push/status?endpoint=${encodeURIComponent(ep(10))}`)).data?.subscribed === false
    && (await alice.req("GET", `/push/status?endpoint=${encodeURIComponent(ep(21))}`)).data?.subscribed === true);
  for (let i = 10; i < 22; i++) await alice.req("POST", "/push/unsubscribe", { endpoint: ep(i) });

  r = await alice.req("POST", "/push/test");
  log("push", "test notification with no device subscribed → 400", r.status === 400);
  r = await alice.req("POST", "/push/test");
  log("push", "test notification is rate-limited", r.status === 429);
}

// ───────────────────────── summary ─────────────────────────
for (const c of [alice, bob, carol]) c.sock?.disconnect();
const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("FAILED:"); failed.forEach((f) => console.log(` - [${f.area}] ${f.name}`)); }
process.exit(failed.length ? 1 : 0);
