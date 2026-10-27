import PushSubscription from "../models/pushSubscription.model.js";
import { pushEnabled, getPublicKey, cleanSubscription, isAllowedEndpoint, notifyTest } from "../lib/push.js";

const MAX_DEVICES = 10; // per account; the oldest is dropped beyond this

/** GET /api/push/key → { enabled, publicKey } */
export const getKey = (_req, res) => res.status(200).json({ enabled: pushEnabled(), publicKey: pushEnabled() ? getPublicKey() : null });

/** POST /api/push/subscribe { subscription: { endpoint, keys }, preview? } — registers (or moves) this device to the caller's account. */
export const subscribe = async (req, res) => {
  try {
    if (!pushEnabled()) return res.status(503).json({ message: "Push notifications aren't enabled on this server" });
    const { subscription, preview } = req.body || {};
    const sub = cleanSubscription(subscription);
    if (!sub) return res.status(400).json({ message: "Invalid or unsupported push subscription" });

    // Upsert by endpoint: if another account used this device before, the device now belongs to the caller.
    await PushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      { userId: req.user._id, keys: sub.keys, preview: preview === true, userAgent: (req.get("user-agent") || "").slice(0, 200), lastSeenAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const mine = await PushSubscription.find({ userId: req.user._id }).sort({ updatedAt: -1 }).select("_id").lean();
    if (mine.length > MAX_DEVICES) await PushSubscription.deleteMany({ _id: { $in: mine.slice(MAX_DEVICES).map((m) => m._id) } });
    res.status(200).json({ subscribed: true, preview: preview === true });
  } catch (error) {
    console.log("Error in push subscribe:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/push/unsubscribe { endpoint } — only removes the caller's own subscription. */
export const unsubscribe = async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (typeof endpoint !== "string" || endpoint.length > 2048) return res.status(400).json({ message: "Invalid endpoint" });
    await PushSubscription.deleteOne({ endpoint, userId: req.user._id });
    res.status(200).json({ subscribed: false });
  } catch (error) {
    console.log("Error in push unsubscribe:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/push/status?endpoint=... → is this device subscribed for the caller, and its preview setting */
export const status = async (req, res) => {
  try {
    const { endpoint } = req.query;
    if (typeof endpoint !== "string" || !isAllowedEndpoint(endpoint)) return res.status(200).json({ subscribed: false, preview: false });
    const row = await PushSubscription.findOne({ endpoint, userId: req.user._id }).select("preview").lean();
    res.status(200).json({ subscribed: !!row, preview: !!row?.preview });
  } catch (error) {
    console.log("Error in push status:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /api/push/prefs { endpoint, preview } */
export const setPrefs = async (req, res) => {
  try {
    const { endpoint, preview } = req.body || {};
    if (typeof endpoint !== "string" || typeof preview !== "boolean") return res.status(400).json({ message: "Invalid request" });
    const row = await PushSubscription.findOneAndUpdate({ endpoint, userId: req.user._id }, { preview }, { new: true }).select("preview").lean();
    if (!row) return res.status(404).json({ message: "This device isn't subscribed" });
    res.status(200).json({ subscribed: true, preview: row.preview });
  } catch (error) {
    console.log("Error in push prefs:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

const lastTest = new Map();
/** POST /api/push/test — sends a test notification to all of the caller's devices (10 s cooldown). */
export const sendTest = async (req, res) => {
  try {
    const id = req.user._id.toString();
    if (Date.now() - (lastTest.get(id) || 0) < 10_000) return res.status(429).json({ message: "Wait a few seconds before sending another test" });
    lastTest.set(id, Date.now());
    if (lastTest.size > 1000) for (const [k, t] of lastTest) if (Date.now() - t > 10_000) lastTest.delete(k); // keep the map small
    if (!pushEnabled()) return res.status(503).json({ message: "Push notifications aren't enabled on this server" });
    const count = await PushSubscription.countDocuments({ userId: req.user._id });
    if (!count) return res.status(400).json({ message: "No device is subscribed yet" });
    notifyTest(req.user._id); // fire and forget
    res.status(200).json({ sentTo: count });
  } catch (error) {
    // Express 4 doesn't catch errors thrown in async handlers: without this a database hiccup leaves the request hanging
    console.log("Error in push test:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};
