import express from "express";
import { login, logout, signup, updateProfile, checkAuth } from "../controllers/auth.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = express.Router();

// 10 login attempts / 15 min per IP+email; 20 signups / hour per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  key: (req) => `${req.ip}|${String(req.body?.email || "").toLowerCase()}`,
  message: "Too many login attempts. Try again in a few minutes.",
});
const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: "Too many signups from this network. Try again later." });

router.post("/signup", signupLimiter, signup);
router.post("/login", loginLimiter, login);
router.post("/logout", logout);
router.put("/update-profile", protectRoute, updateProfile);
router.get("/check", protectRoute, checkAuth);

export default router;
