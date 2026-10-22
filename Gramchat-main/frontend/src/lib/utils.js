export function formatMessageTime(date) {
  return new Date(date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// "Today" → time, "Yesterday", otherwise a short date. Used in the chat list.
export function formatListTime(date) {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days === 0) return formatMessageTime(d);
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

// 75 → "1:15"
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// One-line description of a message for previews / quoted replies
export function previewOf(m) {
  if (!m) return "";
  if (m.deletedForEveryone) return "🚫 This message was deleted";
  if (m.viewOnce) return `👁 View-once ${m.viewOnceKind === "video" ? "video" : m.viewOnceKind === "audio" ? "voice message" : "photo"}`;
  if (m.voice) return "🎤 Voice message";
  if (m.text) return m.text;
  if (m.image) return "📷 Photo";
  if (m.fileName) return `📎 ${m.fileName}`;
  return "Attachment";
}

// A short piece of `text` around the first match of `query`, for search results: "…ng the report on Friday, then…"
export function snippetAround(text, query, radius = 45) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const q = String(query || "").trim().toLowerCase();
  const at = q ? t.toLowerCase().indexOf(q) : -1;
  if (at < 0 || t.length <= radius * 2 + q.length) return t.slice(0, radius * 2 + q.length);
  const start = Math.max(0, at - radius);
  const end = Math.min(t.length, at + q.length + radius);
  return `${start > 0 ? "…" : ""}${t.slice(start, end)}${end < t.length ? "…" : ""}`;
}

// Only http(s) links are ever put in an href (never javascript: or data:)
export function safeHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:" ? x.href : null;
  } catch {
    return null;
  }
}

// The first http(s) link in a message's text, or null
export function firstUrl(text) {
  const m = typeof text === "string" ? text.match(/https?:\/\/[^\s<>"'`]+/i) : null;
  if (!m) return null;
  return safeHttpUrl(m[0].replace(/[.,;:!?'")\]}]+$/, ""));
}

// Chat-list time for a mute: "Muted until 18:30" / "Muted until 27 Oct" / "Muted"
export function muteLabel(mutedUntil) {
  if (!mutedUntil) return "";
  const d = new Date(mutedUntil);
  if (d.getFullYear() >= 2900) return "Muted";
  const sameDay = d.toDateString() === new Date().toDateString();
  return `Muted until ${sameDay ? formatMessageTime(d) : d.toLocaleDateString("en-US", { day: "numeric", month: "short" })}`;
}
