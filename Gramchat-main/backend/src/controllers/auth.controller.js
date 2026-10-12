import { generateToken, cookieOptions } from "../utils/jwt.js";
import User from "../models/user.model.js";
import bcrypt from "bcryptjs";
import { saveDataUrl, deleteUpload, UploadError } from "../lib/storage.js";
import { io } from "../lib/socket.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isStr = (v) => typeof v === "string";
const publicUser = (u) => ({ _id: u._id, fullName: u.fullName, email: u.email, profilePic: u.profilePic, createdAt: u.createdAt });

export const signup = async (req, res) => {
  try {
    const { fullName, email, password } = req.body || {};
    if (![fullName, email, password].every(isStr) || !fullName.trim() || !email.trim() || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ message: "Invalid email format" });
    if (fullName.trim().length > 60) return res.status(400).json({ message: "Name is too long (max 60)" });
    if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
    if (password.length > 72) return res.status(400).json({ message: "Password must be at most 72 characters" });

    if (await User.findOne({ email: cleanEmail })) return res.status(400).json({ message: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ fullName: fullName.trim(), email: cleanEmail, password: hashedPassword });
    generateToken(newUser._id, res);

    // Tell connected clients so the new person shows up without a reload (public fields only)
    io.emit("userJoined", { _id: newUser._id, fullName: newUser.fullName, profilePic: newUser.profilePic, createdAt: newUser.createdAt });
    res.status(201).json(publicUser(newUser));
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: "Email already exists" });
    console.log("Error in signup controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    // Strings only: blocks operator-injection such as {"email":{"$ne":null}}
    if (!isStr(email) || !isStr(password)) return res.status(400).json({ message: "Invalid credentials" });
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    // Always run a bcrypt compare so response time doesn't reveal whether the email exists
    const hash = user?.password || "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok) return res.status(400).json({ message: "Invalid credentials" });

    generateToken(user._id, res);
    res.status(200).json(publicUser(user));
  } catch (error) {
    console.log("Error in login controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const logout = (req, res) => {
  res.clearCookie("jwt", cookieOptions());
  res.status(200).json({ message: "Logged out successfully" });
};

export const updateProfile = async (req, res) => {
  try {
    const { profilePic, fullName } = req.body || {};
    const updates = {};

    if (profilePic) updates.profilePic = (await saveDataUrl(profilePic, { maxBytes: 5 * 1024 * 1024, only: "image/" })).url;
    if (isStr(fullName) && fullName.trim()) {
      if (fullName.trim().length > 60) return res.status(400).json({ message: "Name is too long (max 60)" });
      updates.fullName = fullName.trim();
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ message: "Nothing to update" });

    const old = req.user.profilePic;
    const updatedUser = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    if (updates.profilePic && old) deleteUpload(old);
    res.status(200).json(publicUser(updatedUser)); // never includes the password hash
  } catch (error) {
    if (error instanceof UploadError) return res.status(400).json({ message: error.message });
    console.log("error in update profile:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const checkAuth = (req, res) => res.status(200).json(publicUser(req.user));
