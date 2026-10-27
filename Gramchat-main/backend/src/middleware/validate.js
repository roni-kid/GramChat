import mongoose from "mongoose";
export const isId = (v) => typeof v === "string" && mongoose.isValidObjectId(v) && /^[a-f\d]{24}$/i.test(v);
// Router param guard: rejects malformed ids with 400 instead of a 500 CastError.
// Valid ids are also lower-cased: ObjectIds print in lower case, and the code compares ids as text and builds text keys from them
// (contact pair keys, block keys). An upper-case spelling of the same id would otherwise match the user in the database but miss
// those keys (a block that never takes effect, a contact lookup that finds nothing).
export const validIdParams = (...names) => (req, res, next) => {
  for (const n of names) {
    if (!isId(req.params[n])) return res.status(400).json({ message: "Invalid id" });
    req.params[n] = req.params[n].toLowerCase();
  }
  next();
};
