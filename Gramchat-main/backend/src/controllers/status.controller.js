import Status from "../models/status.model.js";
import { emitToUser } from "../lib/socket.js";
import { saveDataUrl, deleteUpload, UploadError } from "../lib/storage.js";
import { getContactIds } from "../lib/relations.js";
import User from "../models/user.model.js";

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Owners see who viewed; everyone else only learns whether *they* have viewed it.
const shape = (status, viewerId) => {
  const o = status.toObject ? status.toObject() : status;
  const isOwner = (o.userId?._id || o.userId).toString() === viewerId.toString();
  const viewedByMe = (o.viewedBy || []).some((v) => v.toString() === viewerId.toString());
  return { ...o, viewedBy: isOwner ? o.viewedBy : [], viewedByMe };
};

// People whose statuses I may see: my contacts, except those who set their status audience to "nobody"
const visibleAuthors = async (me) => {
  const contacts = [...(await getContactIds(me))];
  if (!contacts.length) return [];
  const hidden = new Set((await User.find({ _id: { $in: contacts }, "privacy.statusAudience": "nobody" }).select("_id").lean()).map((u) => u._id.toString()));
  return contacts.filter((c) => !hidden.has(c));
};

// Statuses are visible to: yourself + your contacts (who allow it).
export const getStatuses = async (req, res) => {
  try {
    const me = req.user._id;
    const contacts = await visibleAuthors(me);
    const statuses = await Status.find({ expiresAt: { $gt: new Date() }, userId: { $in: [me, ...contacts] } })
      .populate("userId", "fullName profilePic")
      .sort({ createdAt: -1 });
    res.status(200).json(statuses.map((s) => shape(s, me)));
  } catch (error) {
    console.log("Error in getStatuses:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const createStatus = async (req, res) => {
  try {
    const { text, image, bgColor } = req.body || {};
    const userId = req.user._id;
    if (text != null && (typeof text !== "string" || text.length > 200)) return res.status(400).json({ message: "Status text too long (max 200)" });
    if (!text?.trim() && !image) return res.status(400).json({ message: "Status must have text or image" });
    if (bgColor != null && !COLOR_RE.test(bgColor)) return res.status(400).json({ message: "Invalid colour" });

    const imageUrl = image ? (await saveDataUrl(image, { maxBytes: 5 * 1024 * 1024, only: "image/" })).url : undefined;
    let status;
    try {
      status = await Status.create({ userId, text: text?.trim() || undefined, image: imageUrl, bgColor: bgColor || "#1a1a2e" });
    } catch (e) {
      if (imageUrl) deleteUpload(imageUrl); // the status wasn't stored: don't leave its picture on disk
      throw e;
    }
    await status.populate("userId", "fullName profilePic");

    if (req.user.privacy?.statusAudience !== "nobody") {
      (await getContactIds(userId)).forEach((c) => emitToUser(c, "newStatus", shape(status, c)));
    }
    res.status(201).json(shape(status, userId));
  } catch (error) {
    if (error instanceof UploadError) return res.status(400).json({ message: error.message });
    console.log("Error in createStatus:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const viewStatus = async (req, res) => {
  try {
    const { statusId } = req.params;
    const viewerId = req.user._id;
    const status = await Status.findById(statusId);
    if (!status || status.expiresAt <= new Date()) return res.status(404).json({ message: "Status not found" });

    const ownerId = status.userId.toString();
    if (ownerId !== viewerId.toString() && !(await visibleAuthors(viewerId)).includes(ownerId)) {
      return res.status(404).json({ message: "Status not found" });
    }
    if (ownerId !== viewerId.toString()) {
      // One atomic update: two quick views (or two devices) can't both add the viewer, and a concurrent save can't fail with a version error
      const added = await Status.updateOne({ _id: status._id, viewedBy: { $ne: viewerId } }, { $addToSet: { viewedBy: viewerId } });
      if (added.modifiedCount) emitToUser(ownerId, "statusViewed", { statusId, viewerId: viewerId.toString() });
    }
    res.status(200).json({ success: true });
  } catch (error) {
    console.log("Error in viewStatus:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteStatus = async (req, res) => {
  try {
    const { statusId } = req.params;
    const userId = req.user._id;
    const status = await Status.findOneAndDelete({ _id: statusId, userId });
    if (!status) return res.status(404).json({ message: "Status not found" });
    if (status.image) deleteUpload(status.image);

    const contacts = await getContactIds(userId);
    [userId.toString(), ...contacts].forEach((c) => emitToUser(c, "statusDeleted", { statusId }));
    res.status(200).json({ success: true });
  } catch (error) {
    console.log("Error in deleteStatus:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};
