// Phase 2D API checks: link previews, search across chats, the media gallery, and pin / archive / mute for chats.
// Runs against a live server like the other suites (see tests/README.md): restart the server between runs and start it with
// SIGNUP_LIMIT_PER_HOUR=500.
//
// Link previews need the server to fetch a page from THIS machine, which the SSRF guard normally forbids. So there are two modes:
//   normal run:                         server started normally           -> proves the guard holds (no fetch, no card)
//   ALLOW_PRIVATE=1 npm run test:api:2d server started with LINK_PREVIEW_ALLOW_PRIVATE=1 -> proves cards are built, stored,
//                                       edited, deleted and forwarded correctly
// Never run a real deployment with LINK_PREVIEW_ALLOW_PRIVATE=1.
import { createRequire } from "node:module";
import http from "node:http";

delete process.env.LINK_PREVIEW_ALLOW_PRIVATE; // the unit checks below must see the real guard
const { isPrivateAddress, extractFirstUrl, trimUrl, parseHtml, sniffImage, fetchPreview } = await import("../backend/src/lib/linkPreview.js");
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { io } = require("socket.io-client");

const BASE = process.env.BASE || "http://localhost:5001";
const API = BASE + "/api";
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === "1";
const results = [];
const log = (area, name, pass, detail = "") => {
  results.push({ area, name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} [${area}] ${name}${detail ? " — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG = `data:image/png;base64,${PNG_B64}`;
const PDF = "data:application/pdf;base64,JVBERi0xLjQK";
const MP4 = "data:video/mp4;base64,AAAAIGZ0eXBpc29t";
const MP3 = "data:audio/mpeg;base64,SUQzAwAAAAAA";
const WEBM = "data:audio/webm;base64,AAAA";
const TXT = "data:text/plain;base64,aGVsbG8=";
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
  async raw(path) {
    const res = await fetch(BASE + path, { headers: this.cookie ? { Cookie: this.cookie } : {} });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get("content-type") || "", size: buf.length };
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
const send = (from, to, body) => from.req("POST", `/messages/send/${to.user._id}`, { clientId: cid("s"), ...body });
const gsend = (from, gid, body) => from.req("POST", `/groups/${gid}/messages`, { clientId: cid("g"), ...body });

// ───────────────────────── a tiny website for the link-preview checks ─────────────────────────
const hits = {};
const site = http.createServer((req, res) => {
  const path = req.url.split("?")[0];
  hits[path] = (hits[path] || 0) + 1;
  const html = (body, extra = {}) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...extra }); res.end(body); };
  if (path === "/page") return html(`<html><head><title>Fallback title</title><meta property="og:title" content="Hello &amp; Welcome"><meta property="og:description" content="A page used by the tests"><meta property="og:site_name" content="Test Site"><meta property="og:image" content="/img.png"></head><body>x</body></html>`);
  if (path === "/page2") return html(`<html><head><meta property="og:title" content="Second page"><meta property="og:description" content="Another one"></head></html>`);
  if (path === "/svgpage") return html(`<html><head><meta property="og:title" content="SVG image page"><meta property="og:image" content="/x.svg"></head></html>`);
  if (path === "/img.png") { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(Buffer.from(PNG_B64, "base64")); }
  if (path === "/x.svg") { res.writeHead(200, { "Content-Type": "image/svg+xml" }); return res.end("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><script>alert(1)</script></svg>"); }
  if (path === "/json") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{}"); }
  if (path === "/redir") { res.writeHead(302, { Location: "/page2" }); return res.end(); }
  if (path === "/loop") { res.writeHead(302, { Location: "/loop" }); return res.end(); }
  res.writeHead(404); res.end("nope");
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const SITE = `http://127.0.0.1:${site.address().port}`;

// ───────────────────────── UNIT: the link-preview parser and the SSRF guard ─────────────────────────
console.log("\n=== LINK PREVIEW: PARSER AND GUARD (no server needed) ===");
const privateIps = ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.9", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:db8::1", "not-an-ip"];
const publicIps = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"];
log("guard", "loopback / private / link-local / reserved addresses are refused", privateIps.every((ip) => isPrivateAddress(ip)), privateIps.filter((ip) => !isPrivateAddress(ip)).join(" "));
log("guard", "ordinary public addresses are allowed", publicIps.every((ip) => !isPrivateAddress(ip)), publicIps.filter((ip) => isPrivateAddress(ip)).join(" "));
const refused = async (url) => { try { await fetchPreview(url); return false; } catch { return true; } };
const before = hits["/page"] || 0;
log("guard", "127.0.0.1, localhost and [::1] are refused (and the site was never contacted)",
  (await refused(`${SITE}/page`)) && (await refused(`http://localhost:${site.address().port}/page`)) && (await refused(`http://[::1]:${site.address().port}/page`)) && (hits["/page"] || 0) === before);
log("guard", "cloud-metadata address, other ports, credentials in the URL and non-http schemes are refused",
  (await refused("http://169.254.169.254/latest/meta-data/")) && (await refused("http://example.com:8080/")) && (await refused("http://user:pw@example.com/")) && (await refused("file:///etc/passwd")) && (await refused("ftp://example.com/")));
log("guard", "numeric tricks for 127.0.0.1 (2130706433, 0x7f.1, 0177.0.0.1) are refused", (await refused("http://2130706433/")) && (await refused("http://0x7f.1/")) && (await refused("http://0177.0.0.1/")));

log("parse", "extractFirstUrl finds the first http(s) link and drops trailing punctuation", extractFirstUrl("see https://example.com/a, then http://b.org") === "https://example.com/a");
log("parse", "…and returns null for plain text, ftp:, javascript: and data:", [extractFirstUrl("no link here"), extractFirstUrl("ftp://x.org/f"), extractFirstUrl("javascript:alert(1)"), extractFirstUrl("data:text/html,hi")].every((v) => v === null));
log("parse", "trimUrl keeps a closing bracket that belongs to the URL", trimUrl("https://en.wikipedia.org/wiki/Foo_(bar)")[0] === "https://en.wikipedia.org/wiki/Foo_(bar)" && trimUrl("https://x.com/a).")[0] === "https://x.com/a");
const parsed = parseHtml(`<html><head><title>T</title><meta property="og:title" content="Fish &amp; Chips"><meta name="description" content="Tasty"><meta property="og:image" content="/pic.jpg"></head></html>`, "https://shop.example.com/menu");
log("parse", "Open Graph title / description / image are read, entities decoded, relative image resolved",
  parsed?.title === "Fish & Chips" && parsed?.description === "Tasty" && parsed?.imageUrl === "https://shop.example.com/pic.jpg" && parsed?.siteName === "shop.example.com");
log("parse", "a page with no title and no description gives no card", parseHtml("<html><head></head></html>", "https://x.org/") === null);
log("parse", "images are recognised by their bytes: PNG yes, SVG and text no", sniffImage(Buffer.from(PNG_B64, "base64")) === "image/png" && sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")) === null);

// ───────────────────────── users ─────────────────────────
const alice = await mk("Alice2d"), bob = await mk("Bob2d"), carol = await mk("Carol2d"), dave = await mk("Dave2d"), erin = await mk("Erin2d"), pia = await mk("Pia2d");
await befriend(alice, bob); await befriend(alice, carol); await befriend(alice, erin); await befriend(dave, bob);
await befriend(pia, bob); await befriend(pia, carol); await befriend(pia, erin);
await alice.connect(); await bob.connect(); await pia.connect();
log("setup", "six users, contacts connected", [alice, bob, carol, dave, erin, pia].every((c) => c.user?._id));
const g1 = (await alice.req("POST", "/groups", { name: "Search 2D", memberIds: [bob.user._id] })).data?._id;

// ───────────────────────── LINK PREVIEWS (API) ─────────────────────────
console.log(`\n=== LINK PREVIEWS (${ALLOW_PRIVATE ? "server allows localhost: cards are built" : "normal server: the guard must hold"}) ===`);
const wantsCard = (c, id) => c.waitFor("messagePreview", (p) => p.messageId === id, 5000);

if (!ALLOW_PRIVATE) {
  const r = await send(alice, bob, { text: `look ${SITE}/page` });
  await sleep(1800);
  log("preview", "the message itself is delivered normally", r.status === 201);
  log("preview", "a link to a private address never makes the server fetch it (no request reached the site)", !hits["/page"], `hits ${hits["/page"] || 0}`);
  log("preview", "…and no card is attached", !bob.events.some((e) => e.ev === "messagePreview"));
  const hist = (await bob.req("GET", `/messages/${alice.user._id}`)).data || [];
  log("preview", "…nor stored", hist.every((m) => m.linkPreview === undefined));
  console.log("   (run again with ALLOW_PRIVATE=1 and a server started with LINK_PREVIEW_ALLOW_PRIVATE=1 to check how cards are built)");
} else {
  const r = await send(alice, bob, { text: `look at ${SITE}/page please` });
  const id = r.data?._id;
  log("preview", "the message is delivered at once, without waiting for the page", r.status === 201 && r.data?.linkPreview === undefined);
  const bp = await wantsCard(bob, id), ap = await wantsCard(alice, id);
  log("preview", "recipient and sender both get a `messagePreview` event", !!bp && !!ap);
  log("preview", "the card has the page's title (entities decoded), description and site name", bp?.linkPreview?.title === "Hello & Welcome" && bp?.linkPreview?.description === "A page used by the tests" && bp?.linkPreview?.siteName === "Test Site");
  log("preview", "the card's link is the one the sender typed", bp?.linkPreview?.url === `${SITE}/page`);
  log("preview", "the thumbnail was downloaded by the server and is served from our own uploads", /^\/api\/uploads\/[a-f0-9]{32}\.png$/.test(bp?.linkPreview?.image || ""));
  const img = await bob.raw(bp?.linkPreview?.image || "/x");
  log("preview", "…and the recipient can load it (image/png)", img.status === 200 && img.type.startsWith("image/png"));
  log("preview", "…but not without being logged in", (await fetch(BASE + (bp?.linkPreview?.image || "/x"))).status === 401);
  const hist = (await bob.req("GET", `/messages/${alice.user._id}`)).data || [];
  log("preview", "history includes the card", hist.find((m) => m._id === id)?.linkPreview?.title === "Hello & Welcome");
  log("preview", "the page was fetched exactly once", hits["/page"] === 1, `hits ${hits["/page"]}`);

  // privacy switch
  await alice.req("PUT", "/auth/privacy", { linkPreviews: false });
  const off = await send(alice, bob, { text: `${SITE}/page2` });
  await sleep(1500);
  log("preview", "with Link previews switched off nothing is fetched and no card appears", !hits["/page2"] && off.status === 201);
  await alice.req("PUT", "/auth/privacy", { linkPreviews: true });

  // things that must give no card
  const none = async (text) => { const m = (await send(alice, bob, { text })).data; await sleep(1200); return !bob.events.some((e) => e.ev === "messagePreview" && e.payload.messageId === m?._id); };
  log("preview", "a page that is not HTML (JSON), a 404 and a redirect loop give no card", (await none(`${SITE}/json`)) && (await none(`${SITE}/missing`)) && (await none(`${SITE}/loop`)));
  const sv = (await send(alice, bob, { text: `${SITE}/svgpage` })).data;
  const svp = await wantsCard(bob, sv?._id);
  log("preview", "an SVG thumbnail is refused: the card is built without a picture", svp?.linkPreview?.title === "SVG image page" && !svp?.linkPreview?.image);
  const rd = (await send(alice, bob, { text: `${SITE}/redir` })).data;
  const rdp = await wantsCard(bob, rd?._id);
  log("preview", "a redirect is followed and the card still opens the link that was typed", rdp?.linkPreview?.title === "Second page" && rdp?.linkPreview?.url === `${SITE}/redir`);

  // edit
  const e0 = (await send(alice, bob, { text: `v1 ${SITE}/page` })).data;
  await wantsCard(bob, e0?._id);
  bob.clear();
  await alice.req("PUT", `/messages/edit/${e0._id}`, { text: `v2 ${SITE}/page2` });
  const cleared = await bob.waitFor("messagePreview", (p) => p.messageId === e0._id && p.linkPreview === null, 3000);
  const fresh = await bob.waitFor("messagePreview", (p) => p.messageId === e0._id && p.linkPreview?.title === "Second page", 5000);
  log("preview", "editing the link removes the old card and builds the new one", !!cleared && !!fresh);
  bob.clear();
  await alice.req("PUT", `/messages/edit/${e0._id}`, { text: "no link any more" });
  log("preview", "editing the link away removes the card", !!(await bob.waitFor("messagePreview", (p) => p.messageId === e0._id && p.linkPreview === null, 3000)));
  const afterEdit = ((await bob.req("GET", `/messages/${alice.user._id}`)).data || []).find((m) => m._id === e0._id);
  log("preview", "…and it is gone from history too", afterEdit && afterEdit.linkPreview === undefined);

  // delete for everyone
  const d0 = (await send(alice, bob, { text: `bye ${SITE}/page` })).data;
  const dp = await wantsCard(bob, d0?._id);
  await alice.req("DELETE", `/messages/${d0._id}?scope=everyone`);
  await sleep(300);
  const tomb = ((await bob.req("GET", `/messages/${alice.user._id}`)).data || []).find((m) => m._id === d0._id);
  log("preview", "delete for everyone removes the card from the message", tomb?.deletedForEveryone === true && tomb.linkPreview === undefined);
  log("preview", "…and deletes the stored thumbnail", (await alice.raw(dp?.linkPreview?.image || "/x")).status === 404);

  // forward
  const f0 = (await send(alice, bob, { text: `fwd ${SITE}/page` })).data;
  const fp = await wantsCard(bob, f0?._id);
  const fw = await alice.req("POST", "/messages/forward", { messageId: f0._id, targets: [{ type: "user", id: carol.user._id }] });
  const carolHist = (await carol.req("GET", `/messages/${alice.user._id}`)).data || [];
  const copy = carolHist.find((m) => m.forwarded);
  log("preview", "a forwarded message keeps its card", fw.status === 200 && copy?.linkPreview?.title === "Hello & Welcome");
  log("preview", "…with its own copy of the thumbnail", !!copy?.linkPreview?.image && copy.linkPreview.image !== fp?.linkPreview?.image);
  await alice.req("DELETE", `/messages/${f0._id}?scope=everyone`);
  log("preview", "…which survives the original being deleted for everyone", (await carol.raw(copy?.linkPreview?.image || "/x")).status === 200);

  // groups
  const gm = (await gsend(alice, g1, { text: `team ${SITE}/page2` })).data;
  const gp = await bob.waitFor("messagePreview", (p) => p.messageId === gm?._id && p.groupId === g1, 5000);
  log("preview", "group messages get cards too (event carries the groupId)", gp?.linkPreview?.title === "Second page");

  // limits
  hits["/page"] = 0;
  for (let i = 0; i < 26; i++) await send(dave, bob, { text: `n${i} ${SITE}/page?i=${i}` });
  await sleep(2500);
  log("preview", "a user can only make the server fetch 20 pages a minute", hits["/page"] > 0 && hits["/page"] <= 20, `${hits["/page"]} fetches for 26 links`);
}

// ───────────────────────── SEARCH ─────────────────────────
console.log("\n=== SEARCH ACROSS CHATS ===");
const tok = `zq${String(stamp).slice(-8)}`;
await send(alice, bob, { text: `hello ${tok} alpha` });
await sleep(15);
await send(bob, alice, { text: `${tok.toUpperCase()} beta` });
await sleep(15);
await gsend(alice, g1, { text: `group ${tok} gamma` });
await sleep(15);
await send(alice, carol, { text: `carol ${tok} delta` });
const s = (c, q, extra = "") => c.req("GET", `/messages/search?q=${encodeURIComponent(q)}${extra}`);
let r = await s(alice, tok);
log("search", "finds matches in 1:1 chats and groups, newest first", r.status === 200 && r.data.length === 4 && r.data[0].text.includes("delta") && r.data[3].text.includes("alpha"), `got ${r.data?.length}`);
log("search", "matching ignores upper / lower case", r.data?.some((m) => m.text?.includes(tok.toUpperCase())));
log("search", "results say which chat they belong to (group name / other person) and never expose emails or passwords",
  r.data?.find((m) => m.groupId)?.groupId?.name === "Search 2D" && r.data?.every((m) => !JSON.stringify(m).includes("password") && !JSON.stringify(m).includes("email")));
r = await s(bob, tok);
log("search", "you only see chats you are in (bob does not see alice↔carol)", r.data?.length === 3 && !r.data.some((m) => m.text?.includes("delta")));
r = await s(carol, tok);
log("search", "…carol sees only her own chat", r.data?.length === 1 && r.data[0].text.includes("delta"));
r = await s(dave, tok);
log("search", "…and a stranger sees nothing", r.status === 200 && r.data.length === 0);

await send(alice, bob, { text: `dot x${tok}.y` });
await send(alice, bob, { text: `no dot x${tok}zy` });
r = await s(alice, `x${tok}.y`);
log("search", "special characters are searched literally (a dot is not a wildcard)", r.data?.length === 1 && r.data[0].text.includes("dot"));

for (const [name, q] of [["one character", "a"], ["empty", ""], ["101 characters", "x".repeat(101)]]) {
  r = await s(alice, q);
  log("search", `a search with ${name} → 400`, r.status === 400, `got ${r.status}`);
}
r = await alice.req("GET", "/messages/search");
log("search", "a search with no query → 400", r.status === 400);

const pageTok = `pg${String(stamp).slice(-8)}`;
for (let i = 1; i <= 5; i++) { await send(alice, bob, { text: `${pageTok} #${i}` }); await sleep(12); }
const p1 = (await s(alice, pageTok, "&limit=2")).data || [];
const p2 = (await s(alice, pageTok, `&limit=2&before=${encodeURIComponent(p1[1]?.createdAt)}`)).data || [];
const p3 = (await s(alice, pageTok, `&limit=2&before=${encodeURIComponent(p2[1]?.createdAt)}`)).data || [];
log("search", "paging with `before`: 2 + 2 + 1, newest first, no overlap, no gaps",
  p1.length === 2 && p2.length === 2 && p3.length === 1 && p1[0].text.endsWith("#5") && p2[0].text.endsWith("#3") && p3[0].text.endsWith("#1"));
log("search", "an absurd limit is capped", ((await s(alice, tok, "&limit=100000")).data || []).length <= 50);

const del = (await send(alice, bob, { text: `gone ${tok} forever` })).data;
const mine = (await send(bob, alice, { text: `mine ${tok} hidden` })).data;
await alice.req("DELETE", `/messages/${del._id}?scope=everyone`);
await alice.req("DELETE", `/messages/${mine._id}?scope=me`);
r = await s(bob, "forever");
log("search", "messages deleted for everyone are not found (by anyone)", r.data?.length === 0 && (await s(alice, "forever")).data?.length === 0);
log("search", "a message deleted for me is not found by me…", (await s(alice, "hidden")).data?.length === 0);
log("search", "…but still by the other person", (await s(bob, "hidden")).data?.length === 1);

const fileTok = `quarterly-${String(stamp).slice(-6)}`;
await send(alice, bob, { fileUrl: PDF, fileName: `${fileTok}.pdf` });
await send(alice, bob, { fileUrl: WEBM, voice: true, voiceDuration: 3 });
log("search", "file names are searched", (await s(bob, fileTok)).data?.length === 1);
log("search", "voice notes are not matched by their placeholder name", (await s(bob, "Voice message")).data?.length === 0);

await send(alice, erin, { text: `erin ${tok}` });
await alice.req("DELETE", `/contacts/${erin.user._id}`);
r = await s(alice, `erin ${tok}`);
log("search", "chats with a removed contact are not searched", r.data?.length === 0);
await alice.req("POST", `/groups/${g1}/members`, { userId: carol.user._id }); // carol joins g1 later and sees its history
r = await s(carol, "gamma");
log("search", "group members can find group messages", r.data?.some((m) => m.text?.includes("gamma")));
await alice.req("DELETE", `/groups/${g1}/members/${carol.user._id}`);
log("search", "…and lose access when removed from the group", (await s(carol, "gamma")).data?.length === 0);

// ───────────────────────── MEDIA GALLERY ─────────────────────────
console.log("\n=== MEDIA GALLERY ===");
const gal = await mk("Gail2d"), hal = await mk("Hal2d");
await befriend(gal, hal);
const g2 = (await gal.req("POST", "/groups", { name: "Gallery 2D", memberIds: [hal.user._id] })).data?._id;
await send(gal, hal, { image: PNG, text: "a photo" });
await sleep(10);
await send(hal, gal, { fileUrl: MP4, fileName: "clip.mp4" });
await sleep(10);
await send(gal, hal, { fileUrl: PDF, fileName: "report.pdf" });
await sleep(10);
await send(hal, gal, { fileUrl: MP3, fileName: "song.mp3" });
await sleep(10);
await send(gal, hal, { fileUrl: TXT, fileName: "notes.txt" });
await sleep(10);
await send(gal, hal, { fileUrl: WEBM, voice: true, voiceDuration: 2 });
await sleep(10);
await send(hal, gal, { text: "read https://example.com/article now" });
await sleep(10);
await send(gal, hal, { text: "no links in this one" });
const media = (c, other, type, extra = "") => c.req("GET", `/messages/media/user/${other.user._id}?type=${type}${extra}`);
r = await media(gal, hal, "media");
log("gallery", "Media: photos and videos only", r.status === 200 && r.data.length === 2 && r.data.some((m) => m.image) && r.data.some((m) => m.fileType === "video"), `got ${r.data?.length}`);
r = await media(gal, hal, "docs");
log("gallery", "Docs: PDF, text and audio files (not the voice note)", r.data?.length === 3 && r.data.every((m) => !m.voice) && ["report.pdf", "song.mp3", "notes.txt"].every((n) => r.data.some((m) => m.fileName === n)), `got ${r.data?.map((m) => m.fileName)}`);
r = await media(hal, gal, "links");
log("gallery", "Links: messages containing an http(s) link", r.data?.length === 1 && r.data[0].text.includes("example.com/article"));
r = await gal.req("GET", `/messages/media/user/${hal.user._id}`);
log("gallery", "the default tab is Media", r.status === 200 && r.data.length === 2);
r = await media(gal, hal, "other");
log("gallery", "an unknown tab → 400", r.status === 400);
r = await media(gal, hal, "media", "&limit=1");
const r2 = await media(gal, hal, "media", `&limit=1&before=${encodeURIComponent(r.data?.[0]?.createdAt)}`);
log("gallery", "paging works (newest first, `before`)", r.data?.length === 1 && r2.data?.length === 1 && r.data[0]._id !== r2.data[0]._id && r2.data[0].createdAt < r.data[0].createdAt);
log("gallery", "a third person gets nothing from someone else's 1:1 chat", (await media(dave, hal, "media")).data?.length === 0 && (await media(dave, gal, "docs")).data?.length === 0);
const pdf = (await media(gal, hal, "docs")).data.find((m) => m.fileName === "report.pdf");
await gal.req("DELETE", `/messages/${pdf._id}?scope=everyone`);
log("gallery", "deleted-for-everyone items disappear from the gallery", (await media(hal, gal, "docs")).data?.length === 2);
const note = (await media(gal, hal, "docs")).data.find((m) => m.fileName === "notes.txt");
await hal.req("DELETE", `/messages/${note._id}?scope=me`);
log("gallery", "items deleted for me disappear for me only", (await media(hal, gal, "docs")).data?.length === 1 && (await media(gal, hal, "docs")).data?.length === 2);

await gsend(gal, g2, { image: PNG });
await gsend(hal, g2, { fileUrl: PDF, fileName: "agenda.pdf" });
await gsend(hal, g2, { text: "https://example.org/group-link" });
const gm2 = (t) => hal.req("GET", `/messages/media/group/${g2}?type=${t}`);
r = await gm2("media");
log("gallery", "groups have a gallery too, with the sender's name (no email)", r.status === 200 && r.data.length === 1 && r.data[0].senderId?.fullName === "Gail2d" && !JSON.stringify(r.data).includes("email"));
log("gallery", "…docs and links as well", (await gm2("docs")).data?.length === 1 && (await gm2("links")).data?.length === 1);
r = await dave.req("GET", `/messages/media/group/${g2}?type=media`);
log("gallery", "non-members can't open a group's gallery", r.status === 403);
r = await gal.req("GET", "/messages/media/user/not-an-id?type=media");
log("gallery", "a malformed id → 400", r.status === 400, `got ${r.status}`);

// ───────────────────────── PIN / ARCHIVE / MUTE ─────────────────────────
console.log("\n=== PIN, ARCHIVE, MUTE ===");
const gp1 = (await pia.req("POST", "/groups", { name: "Pins 2D", memberIds: [bob.user._id] })).data?._id;
const put = (c, kind, id, body) => c.req("PUT", `/chats/prefs/${kind}/${id}`, body);
r = await pia.req("GET", "/chats/prefs");
log("prefs", "a new account has no pinned, archived or muted chats", r.status === 200 && Array.isArray(r.data) && r.data.length === 0);

pia.clear();
r = await put(pia, "user", bob.user._id, { pinned: true });
log("prefs", "pin a chat", r.status === 200 && !!r.data.pinnedAt && r.data.archived === false && r.data.id === bob.user._id && r.data.kind === "user");
log("prefs", "…other tabs and devices are told (`chatPref` event)", !!(await pia.waitFor("chatPref", (p) => p.id === bob.user._id && !!p.pinnedAt)));
r = await put(pia, "user", bob.user._id, { pinned: true });
log("prefs", "pinning an already pinned chat is fine", r.status === 200 && !!r.data.pinnedAt);
await put(pia, "user", carol.user._id, { pinned: true });
await put(pia, "group", gp1, { pinned: true });
r = await put(pia, "user", erin.user._id, { pinned: true });
log("prefs", "a fourth pin is refused (limit 3)", r.status === 400 && /3/.test(r.data?.message || ""), r.data?.message);

r = await put(pia, "user", bob.user._id, { archived: true });
log("prefs", "archiving a pinned chat unpins it", r.status === 200 && r.data.archived === true && r.data.pinnedAt === null);
r = await put(pia, "user", erin.user._id, { pinned: true });
log("prefs", "…which frees a pin", r.status === 200);
r = await put(pia, "user", bob.user._id, { pinned: true });
log("prefs", "pinning needs a free pin (3 used again)", r.status === 400);
await put(pia, "user", erin.user._id, { pinned: false });
r = await put(pia, "user", bob.user._id, { pinned: true });
log("prefs", "pinning an archived chat brings it back out of the archive", r.status === 200 && r.data.archived === false && !!r.data.pinnedAt);
r = await put(pia, "user", carol.user._id, { pinned: true, archived: true });
log("prefs", "pinned + archived in one request → 400", r.status === 400);

const near = (d, ms) => Math.abs(new Date(d).getTime() - (Date.now() + ms)) < 90 * 1000;
r = await put(pia, "user", carol.user._id, { mute: "8h" });
log("prefs", "mute for 8 hours", r.status === 200 && near(r.data.mutedUntil, 8 * 3600 * 1000));
r = await put(pia, "user", carol.user._id, { mute: "1w" });
log("prefs", "mute for 1 week", r.status === 200 && near(r.data.mutedUntil, 7 * 24 * 3600 * 1000));
r = await put(pia, "user", carol.user._id, { mute: "always" });
log("prefs", "mute always", r.status === 200 && new Date(r.data.mutedUntil).getFullYear() >= 2900);
const listed = (await pia.req("GET", "/chats/prefs")).data || [];
log("prefs", "the list shows exactly the chats that have something set", listed.length === 3 && listed.find((p) => p.id === carol.user._id)?.mutedUntil && listed.find((p) => p.id === gp1)?.pinnedAt);
r = await put(pia, "user", carol.user._id, { mute: "off" });
log("prefs", "unmute", r.status === 200 && r.data.mutedUntil === null);

for (const [name, body] of [["an unknown mute length", { mute: "2h" }], ["pinned as text", { pinned: "yes" }], ["archived as a number", { archived: 1 }], ["an empty body", {}]]) {
  r = await put(pia, "user", bob.user._id, body);
  log("prefs", `${name} → 400`, r.status === 400, `got ${r.status}`);
}
r = await put(pia, "chat", bob.user._id, { pinned: true });
log("prefs", "an unknown chat type → 400", r.status === 400);
r = await put(pia, "user", "not-an-id", { pinned: true });
log("prefs", "a malformed id → 400", r.status === 400, `got ${r.status}`);
r = await put(pia, "user", dave.user._id, { pinned: true });
log("prefs", "you can't organise a chat with someone who isn't your contact (404)", r.status === 404);
r = await put(pia, "user", pia.user._id, { pinned: true });
log("prefs", "…or with yourself (404)", r.status === 404);
r = await put(dave, "group", gp1, { pinned: true });
log("prefs", "…or a group you aren't in (404)", r.status === 404);
log("prefs", "settings are private: bob sees none of pia's pins", ((await bob.req("GET", "/chats/prefs")).data || []).length === 0);
log("prefs", "login is required", (await fetch(API + "/chats/prefs")).status === 401);

for (const [kind, id] of [["user", bob.user._id], ["user", carol.user._id], ["group", gp1]]) await put(pia, kind, id, { pinned: false });
log("prefs", "when nothing is set any more the entry disappears", ((await pia.req("GET", "/chats/prefs")).data || []).length === 0);

const gp2 = (await bob.req("POST", "/groups", { name: "Leave 2D", memberIds: [pia.user._id] })).data?._id;
await put(pia, "group", gp2, { archived: true, mute: "always" });
await pia.req("DELETE", `/groups/${gp2}/members/${pia.user._id}`);
log("prefs", "leaving a group removes its pin / archive / mute", ((await pia.req("GET", "/chats/prefs")).data || []).length === 0);

// ───────────────────────── summary ─────────────────────────
for (const c of [alice, bob, pia]) c.sock?.disconnect();
site.close();
const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("FAILED:"); failed.forEach((f) => console.log(` - [${f.area}] ${f.name}`)); }
process.exit(failed.length ? 1 : 0);
