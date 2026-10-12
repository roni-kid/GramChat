import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { validIdParams } from "../middleware/validate.js";
import { getMyGroups, createGroup, getGroupMessages, sendGroupMessage, addGroupMember, removeGroupMember, updateGroup } from "../controllers/group.controller.js";

const router = express.Router();

router.get("/", protectRoute, getMyGroups);
router.post("/", protectRoute, createGroup);
router.get("/:groupId/messages", protectRoute, validIdParams("groupId"), getGroupMessages);
router.post("/:groupId/messages", protectRoute, validIdParams("groupId"), sendGroupMessage);
router.post("/:groupId/members", protectRoute, validIdParams("groupId"), addGroupMember);
router.delete("/:groupId/members/:userId", protectRoute, validIdParams("groupId", "userId"), removeGroupMember);
router.put("/:groupId", protectRoute, validIdParams("groupId"), updateGroup);

export default router;
