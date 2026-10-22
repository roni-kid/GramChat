import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { validIdParams } from "../middleware/validate.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { listContacts, searchUser, sendRequest, acceptRequest, removeContact, blockUser, unblockUser } from "../controllers/contact.controller.js";

const router = express.Router();
const searchLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, key: (req) => `${req.user?._id || req.ip}`, message: "Too many searches. Slow down a little." });
const requestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 40, key: (req) => `${req.user?._id || req.ip}`, message: "Too many contact requests. Try again later." });

router.get("/", protectRoute, listContacts);
router.get("/search", protectRoute, searchLimiter, searchUser);
router.post("/request/:userId", protectRoute, requestLimiter, validIdParams("userId"), sendRequest);
router.post("/accept/:userId", protectRoute, validIdParams("userId"), acceptRequest);
router.post("/block/:userId", protectRoute, validIdParams("userId"), blockUser);
router.delete("/block/:userId", protectRoute, validIdParams("userId"), unblockUser);
router.delete("/:userId", protectRoute, validIdParams("userId"), removeContact);

export default router;
