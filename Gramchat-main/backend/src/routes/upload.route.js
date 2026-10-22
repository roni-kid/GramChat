import express from "express";
import path from "path";
import fs from "fs";
import { protectRoute } from "../middleware/auth.middleware.js";
import { UPLOAD_DIR, MIME_BY_EXT, INLINE_KINDS } from "../lib/storage.js";
import { verifyViewLink } from "../lib/viewOnce.js";

const router = express.Router();
const NAME_RE = /^[a-f0-9]{32}\.[a-z0-9]{2,5}$/;

// View-once media (files named v<hex>, see lib/viewOnce.js) is never served by name: only through the signed, short-lived,
// per-person link that POST /messages/view-once/:id/open hands out. Declared before "/:name"; "/:name" itself refuses v-names.
router.get("/view-once/:token", protectRoute, (req, res) => {
  const p = verifyViewLink(req.params.token);
  if (!p || p.u !== req.user._id.toString()) return res.status(404).json({ message: "Not found" });
  const mime = MIME_BY_EXT[p.f.split(".")[1]];
  const file = path.join(UPLOAD_DIR, p.f);
  if (!mime || !INLINE_KINDS.some((k) => mime.startsWith(k)) || !fs.existsSync(file)) return res.status(404).json({ message: "Not found" });

  res.set("Content-Type", mime);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", "private, no-store"); // never kept by the browser or a proxy
  res.set("Content-Disposition", "inline");
  res.sendFile(file, { cacheControl: false }); // still handles Range requests, so video seeking works
});

// Media is only served to logged-in users; filenames are 128-bit random so they can't be guessed.
router.get("/:name", protectRoute, (req, res) => {
  const { name } = req.params;
  const mime = NAME_RE.test(name) && MIME_BY_EXT[name.split(".")[1]];
  const file = path.join(UPLOAD_DIR, name);
  if (!mime || !fs.existsSync(file)) return res.status(404).json({ message: "Not found" });

  res.set("Content-Type", mime);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", "private, max-age=31536000, immutable");
  // Only images/audio/video render inline; documents always download (can't run in our origin)
  if (!INLINE_KINDS.some((k) => mime.startsWith(k))) res.set("Content-Disposition", "attachment");
  res.sendFile(file); // handles Range requests for video seeking
});

export default router;
