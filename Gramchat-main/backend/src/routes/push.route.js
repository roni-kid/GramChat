import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { getKey, subscribe, unsubscribe, status, setPrefs, sendTest } from "../controllers/push.controller.js";

const router = express.Router();

router.get("/key", protectRoute, getKey);
router.get("/status", protectRoute, status);
router.post("/subscribe", protectRoute, subscribe);
router.post("/unsubscribe", protectRoute, unsubscribe);
router.put("/prefs", protectRoute, setPrefs);
router.post("/test", protectRoute, sendTest);

export default router;
