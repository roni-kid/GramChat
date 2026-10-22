import express from "express";
import { login, logout, signup, updateProfile, checkAuth, checkUsername, updateUsername, updatePrivacy } from "../controllers/auth.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = express.Router();

// 10 login attempts / 15 min per IP+username; 20 signups / hour per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  key: (req) => `${req.ip}|${String(req.body?.username ?? req.body?.email ?? "").toLowerCase()}`,
  message: "Too many login attempts. Try again in a few minutes.",
});
const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: Number(process.env.SIGNUP_LIMIT_PER_HOUR) || 20, message: "Too many signups from this network. Try again later." });
const lookupLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, message: "Slow down a little." });

router.post("/signup", signupLimiter, signup);
router.post("/login", loginLimiter, login);
router.post("/logout", logout);
router.get("/username-available", lookupLimiter, checkUsername);
router.put("/update-profile", protectRoute, updateProfile);
router.put("/username", protectRoute, lookupLimiter, updateUsername);
router.put("/privacy", protectRoute, updatePrivacy);
router.get("/check", protectRoute, checkAuth);

export default router;
