// Usernames: lowercase, 3-20 chars, letters/digits/underscore, must start with a letter.
export const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;
const RESERVED = new Set(["admin", "administrator", "root", "support", "help", "gramchat", "system", "moderator", "official", "security", "null", "undefined", "me", "api"]);

export const normalizeUsername = (v) => (typeof v === "string" ? v.trim().replace(/^@/, "").toLowerCase() : "");

/** Returns an error message, or null if the (normalised) username is acceptable. */
export const usernameError = (u) => {
  if (!USERNAME_RE.test(u)) return "Username must be 3-20 characters: letters, numbers or underscore, starting with a letter";
  if (RESERVED.has(u)) return "That username is reserved";
  return null;
};

/** Best-effort username from arbitrary text (used for migrating legacy accounts and seeding). */
export const suggestUsername = (text) => {
  let base = String(text || "user").split("@")[0].toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(base)) base = "u" + base;
  base = base.slice(0, 16);
  while (base.length < 3) base += "x";
  return RESERVED.has(base) ? base + "_1" : base;
};
