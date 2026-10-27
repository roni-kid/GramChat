import "./loadEnv.js";

const DEFAULT_CLIENT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export const getPort = () => process.env.PORT || "5001";

export const getClientOrigins = () => {
  const rawOrigins = process.env.CLIENT_URL || process.env.CORS_ORIGIN;
  if (!rawOrigins) return DEFAULT_CLIENT_ORIGINS;
  return rawOrigins.split(",").map((o) => o.trim()).filter(Boolean);
};

export const validateRequiredEnv = () => {
  const missing = ["MONGODB_URI", "JWT_SECRET"].filter((key) => !process.env[key]);
  if (missing.length > 0) throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);

  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production" && (secret.length < 24 || /replace_with|your_jwt_secret/i.test(secret))) {
    throw new Error(
      "JWT_SECRET is too weak for production. Generate one with:\n  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }
};
