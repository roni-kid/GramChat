import { generateToken, cookieOptions } from "../utils/jwt.js";
import User from "../models/user.model.js";
import bcrypt from "bcryptjs";
import { saveDataUrl, deleteUpload, UploadError } from "../lib/storage.js";
import { normalizeUsername, usernameError } from "../lib/username.js";
import { refreshPresence } from "../lib/socket.js";

const isStr = (v) => typeof v === "string";
// A REAL bcrypt hash (of a random value) to compare against when the account doesn't exist, so an unknown username costs the
// same ~60 ms as a wrong password. (A malformed hash makes bcryptjs return instantly, which reveals which usernames exist.)
const DUMMY_HASH = bcrypt.hashSync(`dummy-${Math.random()}`, 10);
const publicUser = (u) => ({
  _id: u._id,
  username: u.username,
  fullName: u.fullName,
  email: u.email, // only present on legacy accounts; only ever returned to the account owner
  profilePic: u.profilePic,
  privacy: { showOnline: u.privacy?.showOnline !== false, statusAudience: u.privacy?.statusAudience || "contacts", readReceipts: u.privacy?.readReceipts !== false, linkPreviews: u.privacy?.linkPreviews !== false },
  createdAt: u.createdAt,
});

export const signup = async (req, res) => {
  try {
    const { username, fullName, password } = req.body || {};
    if (!isStr(username) || !isStr(password)) return res.status(400).json({ message: "Username and password are required" });
    if (fullName != null && !isStr(fullName)) return res.status(400).json({ message: "Invalid name" });

    const uname = normalizeUsername(username);
    const err = usernameError(uname);
    if (err) return res.status(400).json({ message: err });
    const display = (fullName || "").trim() || uname;
    if (display.length > 60) return res.status(400).json({ message: "Name is too long (max 60)" });
    if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
    if (password.length > 72) return res.status(400).json({ message: "Password must be at most 72 characters" });

    if (await User.exists({ username: uname })) return res.status(400).json({ message: "That username is taken" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ username: uname, fullName: display, password: hashedPassword });
    generateToken(newUser._id, res);
    res.status(201).json(publicUser(newUser));
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: "That username is taken" });
    console.log("Error in signup controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const login = async (req, res) => {
  try {
    // `username` (new) or `email` (older clients / legacy accounts). Strings only: blocks operator injection.
    const id = req.body?.username ?? req.body?.email;
    const { password } = req.body || {};
    if (!isStr(id) || !isStr(password)) return res.status(400).json({ message: "Invalid credentials" });

    const ident = id.trim().toLowerCase();
    // "name@host" = legacy email login; anything else (incl. "@name") is a username
    const looksLikeEmail = /^[^@\s]+@[^@\s]+$/.test(ident);
    const user = await User.findOne(looksLikeEmail ? { email: ident } : { username: normalizeUsername(ident) });
    // Always run a bcrypt compare so response time doesn't reveal whether the account exists
    const hash = user?.password || DUMMY_HASH;
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

export const checkUsername = async (req, res) => {
  try {
    const uname = normalizeUsername(req.query.username);
    const err = usernameError(uname);
    if (err) return res.status(200).json({ available: false, reason: err });
    const taken = await User.exists({ username: uname });
    res.status(200).json({ available: !taken, reason: taken ? "That username is taken" : null });
  } catch (error) {
    // Express 4 doesn't catch errors thrown in async handlers: without this a database hiccup leaves the request hanging
    console.log("Error in checkUsername:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const updateUsername = async (req, res) => {
  try {
    const uname = normalizeUsername(req.body?.username);
    const err = usernameError(uname);
    if (err) return res.status(400).json({ message: err });
    if (await User.exists({ username: uname, _id: { $ne: req.user._id } })) return res.status(400).json({ message: "That username is taken" });
    const user = await User.findByIdAndUpdate(req.user._id, { username: uname }, { new: true });
    res.status(200).json(publicUser(user));
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: "That username is taken" });
    console.log("Error in updateUsername:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const updatePrivacy = async (req, res) => {
  try {
    const { showOnline, statusAudience, readReceipts, linkPreviews } = req.body || {};
    const set = {};
    if (linkPreviews !== undefined) {
      if (typeof linkPreviews !== "boolean") return res.status(400).json({ message: "Invalid setting" });
      set["privacy.linkPreviews"] = linkPreviews;
    }
    if (showOnline !== undefined) {
      if (typeof showOnline !== "boolean") return res.status(400).json({ message: "Invalid setting" });
      set["privacy.showOnline"] = showOnline;
    }
    if (readReceipts !== undefined) {
      if (typeof readReceipts !== "boolean") return res.status(400).json({ message: "Invalid setting" });
      set["privacy.readReceipts"] = readReceipts;
    }
    if (statusAudience !== undefined) {
      if (!["contacts", "nobody"].includes(statusAudience)) return res.status(400).json({ message: "Invalid setting" });
      set["privacy.statusAudience"] = statusAudience;
    }
    if (!Object.keys(set).length) return res.status(400).json({ message: "Nothing to update" });
    const user = await User.findByIdAndUpdate(req.user._id, { $set: set }, { new: true });
    if (set["privacy.showOnline"] !== undefined) refreshPresence(user._id);
    res.status(200).json(publicUser(user));
  } catch (error) {
    console.log("Error in updatePrivacy:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
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
