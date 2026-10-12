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

// One-line description of a message for previews / quoted replies
export function previewOf(m) {
  if (!m) return "";
  if (m.text) return m.text;
  if (m.image) return "📷 Photo";
  if (m.fileName) return `📎 ${m.fileName}`;
  return "Attachment";
}
