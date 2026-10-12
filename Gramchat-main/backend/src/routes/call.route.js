import express from "express";
import crypto from "crypto";
import { protectRoute } from "../middleware/auth.middleware.js";

const router = express.Router();

// ICE servers for WebRTC calls. STUN is free; TURN (needed when both people are behind strict NATs)
// is configured through the server environment so credentials never ship in the frontend bundle.
router.get("/ice", protectRoute, (req, res) => {
  const stun = (process.env.STUN_URLS || "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const iceServers = [{ urls: stun }];

  const turnUrls = (process.env.TURN_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (turnUrls.length) {
    if (process.env.TURN_SECRET) {
      // coturn "use-auth-secret" mode: short-lived credentials derived from a shared secret
      const username = `${Math.floor(Date.now() / 1000) + 6 * 3600}:${req.user._id}`;
      const credential = crypto.createHmac("sha1", process.env.TURN_SECRET).update(username).digest("base64");
      iceServers.push({ urls: turnUrls, username, credential });
    } else if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      iceServers.push({ urls: turnUrls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
    }
  }
  res.status(200).json({ iceServers, relay: iceServers.length > 1 });
});

export default router;
