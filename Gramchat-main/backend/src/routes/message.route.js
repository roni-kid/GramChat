import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { validIdParams } from "../middleware/validate.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  getMessages, getUsersForSidebar, getConversations, sendMessage, markMessagesAsRead, addReaction,
  editMessage, deleteMessage, starMessage, pinMessage, getStarred, getPinnedForUser, getPinnedForGroup, forwardMessage,
  searchMessages, getMediaForUser, getMediaForGroup, openViewOnce, closeViewOnce, keepMessage, getMessageInfo,
} from "../controllers/message.controller.js";

const router = express.Router();

// Search runs a text scan over the caller's chats: 60 searches a minute is plenty for typing-as-you-search
const searchLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, key: (req) => req.user._id.toString(), message: "Slow down a little." });
// Opening view-once media hands out a signed link: no reason to do that more than a few times a minute
const viewLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, key: (req) => req.user._id.toString(), message: "Slow down a little." });

router.get("/users", protectRoute, getUsersForSidebar);
router.get("/conversations", protectRoute, getConversations);
// Fixed paths must be declared before "/:id"
router.get("/starred", protectRoute, getStarred);
router.get("/search", protectRoute, searchLimiter, searchMessages);
router.get("/media/user/:id", protectRoute, validIdParams("id"), getMediaForUser);
router.get("/media/group/:groupId", protectRoute, validIdParams("groupId"), getMediaForGroup);
router.get("/pinned/user/:id", protectRoute, validIdParams("id"), getPinnedForUser);
router.get("/pinned/group/:groupId", protectRoute, validIdParams("groupId"), getPinnedForGroup);
router.get("/info/:id", protectRoute, validIdParams("id"), getMessageInfo); // Phase 2F: who received / read my group message
router.get("/:id", protectRoute, validIdParams("id"), getMessages);
router.post("/send/:id", protectRoute, validIdParams("id"), sendMessage);
router.put("/read/:id", protectRoute, validIdParams("id"), markMessagesAsRead);
router.post("/react/:id", protectRoute, validIdParams("id"), addReaction);

// Phase 2A: message actions (the :id here is a MESSAGE id; authorisation is checked per message)
router.put("/edit/:id", protectRoute, validIdParams("id"), editMessage);
router.put("/star/:id", protectRoute, validIdParams("id"), starMessage);
router.put("/pin/:id", protectRoute, validIdParams("id"), pinMessage);
router.put("/keep/:id", protectRoute, validIdParams("id"), keepMessage); // Phase 2F: keep a disappearing message
router.post("/forward", protectRoute, forwardMessage);

// Phase 2E: view-once media (the :id is a MESSAGE id)
router.post("/view-once/:id/open", protectRoute, viewLimiter, validIdParams("id"), openViewOnce);
router.post("/view-once/:id/close", protectRoute, validIdParams("id"), closeViewOnce);

router.delete("/:id", protectRoute, validIdParams("id"), deleteMessage);

export default router;
