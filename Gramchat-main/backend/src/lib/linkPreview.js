// Link previews, fetched by the SERVER. A recipient's device never contacts the linked site, so the site only ever
// sees this server's address, and the preview can't be forged by the sender (the server builds it itself).
//
// The server will fetch whatever URL a user types, so this file is the SSRF boundary:
//   - http/https only, no credentials in the URL, default ports only (80 / 443)
//   - every address the host resolves to is checked, and the connection is made through the SAME checked lookup
//     (so a DNS answer can't change between "check" and "connect"): loopback, private, link-local, CGNAT, multicast,
//     documentation and reserved ranges are refused, for IPv4 and IPv6 (including IPv4-mapped IPv6)
//   - redirects are followed manually (max 3) and every hop goes through the same checks
//   - hard limits: 8 s total, 512 KB of HTML, 1 MB of image, no compressed responses
//
// This module has no database or app imports on purpose, so it can be tested on its own.
import dns from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";

const TOTAL_TIMEOUT_MS = 8000;
const SOCKET_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 512 * 1024;
export const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const UA = "Mozilla/5.0 (compatible; GramchatLinkPreview/1.0)";

// TESTING ONLY: lets the test-suite point the fetcher at a server on localhost. Never set this in a real deployment.
let warned = false;
const allowPrivate = () => {
  if (process.env.LINK_PREVIEW_ALLOW_PRIVATE !== "1") return false;
  if (!warned) {
    warned = true;
    console.warn("WARNING: LINK_PREVIEW_ALLOW_PRIVATE=1: link previews can reach private addresses. Testing only!");
  }
  return true;
};

// ───────────────────────── addresses ─────────────────────────

const isPrivateV4 = (ip) => {
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || // "this" network, private, loopback, multicast + reserved
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local (cloud metadata lives here)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) // documentation
  );
};

/** Expands an IPv6 address into its 8 groups (numbers), or null if it can't be parsed. */
const v6Groups = (ip) => {
  let s = ip.toLowerCase().split("%")[0];
  const tail = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/); // embedded IPv4, e.g. ::ffff:10.0.0.1
  if (tail) {
    const [p, q, r, t] = tail.slice(1).map(Number);
    s = `${s.slice(0, s.length - tail[0].length)}${((p << 8) | q).toString(16)}:${((r << 8) | t).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  if (halves.length === 1) return head.length === 8 ? head.map((x) => parseInt(x, 16)) : null;
  const rest = halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (fill < 1) return null;
  return [...head, ...Array(fill).fill("0"), ...rest].map((x) => parseInt(x, 16));
};

const isPrivateV6 = (ip) => {
  const g = v6Groups(ip);
  if (!g || g.length !== 8 || g.some((x) => !Number.isInteger(x))) return true; // can't parse: refuse
  const zeros = (from, to) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 5) && g[5] === 0xffff) return isPrivateV4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`); // IPv4-mapped
  if (zeros(0, 6)) return true; // ::, ::1, IPv4-compatible
  if ((g[0] & 0xe000) !== 0x2000) return true; // only global unicast (2000::/3) is allowed: refuses fc00::/7, fe80::/10, ff00::/8, 64:ff9b::/96 ...
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo, documentation
  if (g[0] === 0x2002) return true; // 6to4 (embeds an IPv4 address)
  return false;
};

/** true when the address must NOT be fetched (private, loopback, link-local, reserved, or not an IP at all). */
export const isPrivateAddress = (ip) => {
  if (typeof ip !== "string") return true;
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  if (net.isIPv6(ip)) return isPrivateV6(ip);
  return true;
};

// The only place DNS is resolved for a fetch. net.connect uses THIS result, so the address that was checked is the
// address that is connected to.
const guardedLookup = (hostname, options, callback) => {
  if (typeof options === "function") { callback = options; options = {}; }
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return callback(err);
    if (!addrs?.length) return callback(new Error("no address"));
    if (!allowPrivate() && addrs.some((a) => isPrivateAddress(a.address))) return callback(new Error("blocked address"));
    if (options?.all) return callback(null, addrs);
    callback(null, addrs[0].address, addrs[0].family);
  });
};

// ───────────────────────── urls in text ─────────────────────────

const URL_RE = /https?:\/\/[^\s<>"'`]+/i;

/** Splits trailing punctuation off a matched URL: "https://x.com/a)." → ["https://x.com/a", ")."]. A ")" stays when the URL has a "(". */
export const trimUrl = (raw) => {
  let end = raw.length;
  while (end > 0) {
    const ch = raw[end - 1];
    if (".,;:!?'\"]}".includes(ch)) end--;
    else if (ch === ")" && !raw.slice(0, end).includes("(")) end--;
    else break;
  }
  return [raw.slice(0, end), raw.slice(end)];
};

/** The first http(s) link in a message, normalised, or null. */
export const extractFirstUrl = (text) => {
  if (typeof text !== "string") return null;
  const m = text.match(URL_RE);
  if (!m) return null;
  const [raw] = trimUrl(m[0]);
  if (!raw || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
};

// ───────────────────────── the guarded request ─────────────────────────

const request = (urlStr, accept, ctx) =>
  new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { return reject(new Error("bad url")); }
    if (u.protocol !== "http:" && u.protocol !== "https:") return reject(new Error("bad protocol"));
    if (u.username || u.password) return reject(new Error("credentials in url"));
    const defaultPort = u.protocol === "https:" ? 443 : 80;
    const port = u.port ? Number(u.port) : defaultPort;
    if (!allowPrivate() && port !== 80 && port !== 443) return reject(new Error("port not allowed"));
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (!host) return reject(new Error("no host"));
    if (net.isIP(host) && !allowPrivate() && isPrivateAddress(host)) return reject(new Error("blocked address"));

    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: host,
        port,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        agent: false,
        lookup: guardedLookup,
        timeout: SOCKET_TIMEOUT_MS,
        headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en", "Accept-Encoding": "identity" },
      },
      (res) => resolve({ res, url: u })
    );
    ctx.reqs.add(req);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });

const followRedirects = async (startUrl, accept, ctx) => {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { res, url } = await request(current, accept, ctx);
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      current = new URL(res.headers.location, url).href; // the next hop goes through the same checks
      continue;
    }
    return { res, url };
  }
  throw new Error("too many redirects");
};

const runWithDeadline = async (fn) => {
  const ctx = { reqs: new Set() };
  const timer = setTimeout(() => ctx.reqs.forEach((r) => r.destroy(new Error("deadline"))), TOTAL_TIMEOUT_MS);
  try {
    return await fn(ctx);
  } finally {
    clearTimeout(timer);
    ctx.reqs.forEach((r) => r.destroy());
  }
};

const readBody = (res, maxBytes, truncateOk) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    res.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        if (truncateOk) { chunks.push(c.subarray(0, c.length - (size - maxBytes))); done(resolve, Buffer.concat(chunks)); }
        else done(reject, new Error("too large"));
        res.destroy();
        return;
      }
      chunks.push(c);
    });
    res.on("end", () => done(resolve, Buffer.concat(chunks)));
    res.on("error", (e) => done(reject, e));
    res.on("close", () => done(reject, new Error("connection closed")));
  });

const plainEncoding = (res) => {
  const enc = res.headers["content-encoding"];
  return !enc || enc === "identity";
};

// ───────────────────────── html → preview ─────────────────────────

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""; } catch { return ""; }
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]+/g;
const clean = (s, max) => {
  if (typeof s !== "string") return undefined;
  const t = decodeEntities(s).replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

const parseAttrs = (s) => {
  const out = {};
  for (const m of s.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
};

/** Reads Open Graph / Twitter / plain meta tags from the <head>. Returns { url, title, description, siteName, imageUrl } or null. */
export const parseHtml = (html, pageUrl) => {
  const end = html.search(/<\/head>/i);
  const head = end > 0 ? html.slice(0, end) : html.slice(0, 100000);
  const tags = {};
  for (const m of head.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1]);
    const key = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (key && a.content != null && !(key in tags)) tags[key] = a.content;
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]{0,1000}?)<\/title>/i)?.[1];

  const title = clean(tags["og:title"] || tags["twitter:title"] || titleTag, 150);
  const description = clean(tags["og:description"] || tags["twitter:description"] || tags.description, 300);
  if (!title && !description) return null;

  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  const siteName = clean(tags["og:site_name"], 60) || host;

  let imageUrl;
  const rawImg = tags["og:image"] || tags["og:image:url"] || tags["twitter:image"] || tags["twitter:image:src"];
  if (rawImg) {
    try {
      const iu = new URL(decodeEntities(rawImg).trim(), pageUrl);
      if (iu.protocol === "http:" || iu.protocol === "https:") imageUrl = iu.href;
    } catch { /* ignore a bad image url */ }
  }
  return { url: pageUrl, title, description, siteName, imageUrl };
};

const decodeBody = (buf, contentType) => {
  let cs = contentType.match(/charset=["']?([\w-]+)/i)?.[1];
  if (!cs) cs = buf.subarray(0, 4096).toString("latin1").match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  try { return new TextDecoder(cs || "utf-8").decode(buf); } catch { return buf.toString("utf8"); }
};

/** Fetches `url` and returns { url, title, description, siteName, imageUrl } or null when the page has nothing to preview.
 *  Throws on blocked addresses, timeouts and network errors. */
export const fetchPreview = (url) =>
  runWithDeadline(async (ctx) => {
    const { res } = await followRedirects(url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", ctx);
    if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return null; }
    const type = String(res.headers["content-type"] || "").toLowerCase();
    if (!/^(text\/html|application\/xhtml\+xml)/.test(type) || !plainEncoding(res)) { res.resume(); return null; }
    const body = await readBody(res, MAX_HTML_BYTES, true);
    // The link the sender typed is what the card opens, not whatever it redirected to
    return parseHtml(decodeBody(body, type), url);
  });

// ───────────────────────── images ─────────────────────────

/** Looks at the first bytes instead of trusting the Content-Type header. */
export const sniffImage = (b) => {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.toString("latin1", 0, 4) === "GIF8") return "image/gif";
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null; // SVG and anything else is refused
};

/** Downloads a preview thumbnail (max 1 MB, png/jpeg/gif/webp only). Returns { buf, mime } or null. */
export const fetchImage = (url) =>
  runWithDeadline(async (ctx) => {
    const { res } = await followRedirects(url, "image/png,image/jpeg,image/gif,image/webp", ctx);
    if (res.statusCode < 200 || res.statusCode >= 300 || !plainEncoding(res) || Number(res.headers["content-length"]) > MAX_IMAGE_BYTES) {
      res.destroy();
      return null;
    }
    const buf = await readBody(res, MAX_IMAGE_BYTES, false).catch(() => null);
    const mime = buf?.length ? sniffImage(buf) : null;
    return mime ? { buf, mime } : null;
  });
