import mongoose from "mongoose";
export const isId = (v) => typeof v === "string" && mongoose.isValidObjectId(v) && /^[a-f\d]{24}$/i.test(v);
// Router param guard: rejects malformed ids with 400 instead of a 500 CastError.
export const validIdParams = (...names) => (req, res, next) => {
  for (const n of names) if (!isId(req.params[n])) return res.status(400).json({ message: "Invalid id" });
  next();
};
