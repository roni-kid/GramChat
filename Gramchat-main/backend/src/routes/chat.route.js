import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { validIdParams } from "../middleware/validate.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { getChatPrefs, setChatPref, getChatTimers, setUserTimer } from "../controllers/chat.controller.js";

const router = express.Router();

const prefLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, key: (req) => req.user._id.toString(), message: "Slow down a little." });

// Pin / archive / mute chats (private to the caller)
router.get("/prefs", protectRoute, getChatPrefs);
router.put("/prefs/:kind/:id", protectRoute, prefLimiter, validIdParams("id"), setChatPref);

// Phase 2E: disappearing messages for 1:1 chats (shared by both people). Groups use PUT /groups/:groupId/disappearing.
router.get("/timers", protectRoute, getChatTimers);
router.put("/timer/user/:id", protectRoute, prefLimiter, validIdParams("id"), setUserTimer);

export default router;
