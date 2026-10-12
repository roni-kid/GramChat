import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { validIdParams } from "../middleware/validate.js";
import { getMessages, getUsersForSidebar, getConversations, sendMessage, markMessagesAsRead, addReaction } from "../controllers/message.controller.js";

const router = express.Router();

router.get("/users", protectRoute, getUsersForSidebar);
router.get("/conversations", protectRoute, getConversations);
router.get("/:id", protectRoute, validIdParams("id"), getMessages);
router.post("/send/:id", protectRoute, validIdParams("id"), sendMessage);
router.put("/read/:id", protectRoute, validIdParams("id"), markMessagesAsRead);
router.post("/react/:id", protectRoute, validIdParams("id"), addReaction);

export default router;
