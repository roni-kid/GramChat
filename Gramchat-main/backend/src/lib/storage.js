// Local disk storage for uploaded media. Nothing leaves your own server.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { BACKEND_ROOT } from "./loadEnv.js";

// Relative UPLOAD_DIR values are relative to the backend folder (as .env.example says), not to wherever the server was started from.
export const UPLOAD_DIR = path.resolve(BACKEND_ROOT, process.env.UPLOAD_DIR || "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Allow-list of MIME types -> file extension. Anything else is refused.
// SVG/HTML are deliberately absent (they can carry scripts).
const ALLOWED = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/webm": "weba", "audio/wav": "wav", "audio/mp4": "m4a", "audio/aac": "aac",
  "application/pdf": "pdf", "text/plain": "txt",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};
export const MIME_BY_EXT = Object.fromEntries(Object.entries(ALLOWED).map(([m, e]) => [e, m]));
export const INLINE_KINDS = ["image/", "video/", "audio/"]; // everything else is served as a download

export class UploadError extends Error {}

const dataUrlRe = /^data:([a-z0-9.+\-/]+);base64,([A-Za-z0-9+/=\r\n]+)$/i;

/** Saves a base64 data URL; returns { url, mime, size } where url is e.g. /api/uploads/ab12.png
 *  `prefix` is "" normally, or "v" for view-once media: files named v<hex> are only served with a signed, short-lived link
 *  (see routes/upload.route.js and lib/viewOnce.js). */
export const saveDataUrl = async (dataUrl, { maxBytes = 20 * 1024 * 1024, only, prefix = "" } = {}) => {
  if (typeof dataUrl !== "string") throw new UploadError("Invalid file");
  const m = dataUrl.match(dataUrlRe);
  if (!m) throw new UploadError("Invalid file data");
  const mime = m[1].toLowerCase();
  const ext = ALLOWED[mime];
  if (!ext) throw new UploadError("File type not allowed");
  if (only && !mime.startsWith(only)) throw new UploadError("Wrong file type");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length === 0 || buf.length > maxBytes) throw new UploadError("File too large");
  const name = `${prefix === "v" ? "v" : ""}${crypto.randomBytes(16).toString("hex")}.${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buf);
  return { url: `/api/uploads/${name}`, mime, size: buf.length };
};

/** Saves an image the SERVER downloaded itself (link-preview thumbnails). Same naming and serving rules as any upload. */
export const saveBuffer = async (buf, mime) => {
  const ext = ALLOWED[mime];
  if (!ext || !mime.startsWith("image/")) throw new UploadError("File type not allowed");
  const name = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buf);
  return { url: `/api/uploads/${name}`, mime, size: buf.length };
};

export const deleteUpload = async (publicPath) => {
  if (typeof publicPath !== "string" || !publicPath.startsWith("/api/uploads/")) return;
  const name = path.basename(publicPath);
  await fs.promises.unlink(path.join(UPLOAD_DIR, name)).catch(() => {});
};

const STORED_NAME_RE = /^[a-f0-9]{32}\.[a-z0-9]{2,5}$/;

/** Forwarding gives the copy its own file, so deleting the original for everyone can't break forwarded copies.
 *  Returns the new public url, or the input unchanged for legacy/remote URLs (e.g. old Cloudinary links). Returns null if the file is gone. */
export const copyUpload = async (publicPath) => {
  if (typeof publicPath !== "string" || !publicPath.startsWith("/api/uploads/")) return publicPath;
  const src = path.basename(publicPath);
  if (!STORED_NAME_RE.test(src)) return null;
  const name = `${crypto.randomBytes(16).toString("hex")}${path.extname(src)}`;
  try {
    await fs.promises.copyFile(path.join(UPLOAD_DIR, src), path.join(UPLOAD_DIR, name));
  } catch {
    return null;
  }
  return `/api/uploads/${name}`;
};

export const kindOf = (mime) =>
  mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : mime === "application/pdf" ? "pdf" : mime.startsWith("image/") ? "image" : "document";
