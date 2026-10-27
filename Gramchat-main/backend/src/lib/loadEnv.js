// Loads backend/.env. Import this FIRST (before anything that reads process.env while it is being imported).
//
// Why it exists: ES module imports are evaluated before the importing file's own code, so a `dotenv.config()` call in
// index.js ran AFTER storage.js (UPLOAD_DIR) and routes/auth.route.js (SIGNUP_LIMIT_PER_HOUR) had already read their settings.
// Values set in .env were silently ignored for those. Also, the file is found next to the backend, whatever folder the server
// was started from.
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

/** Absolute path of the backend folder (the one that contains .env, uploads/ and vapid.json). */
export const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

dotenv.config({ path: path.join(BACKEND_ROOT, ".env") });
