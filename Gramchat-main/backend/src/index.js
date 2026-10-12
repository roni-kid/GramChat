import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { connectDB } from "./lib/db.js";
import authRoutes from "./routes/auth.route.js";
import messageRoutes from "./routes/message.route.js";
import groupRoutes from "./routes/group.route.js";
import statusRoutes from "./routes/status.route.js";
import uploadRoutes from "./routes/upload.route.js";
import callRoutes from "./routes/call.route.js";
import { app, server } from "./lib/socket.js";
import { getClientOrigins, getPort, validateRequiredEnv } from "./lib/config.js";

dotenv.config();
validateRequiredEnv();

const PORT = getPort();
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../../frontend/dist");

app.set("trust proxy", 1); // we sit behind a tunnel / reverse proxy when shared
app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
  });
  next();
});

// 20 MB file + base64 overhead ≈ 27 MB
app.use(express.json({ limit: "30mb" }));
app.use(cookieParser());
app.use(cors({ origin: getClientOrigins(), credentials: true }));

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/status", statusRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/calls", callRoutes);

app.get("/api/health", (_req, res) => res.status(200).json({ status: "ok" }));
app.use("/api", (_req, res) => res.status(404).json({ message: "Not found" }));

if (process.env.NODE_ENV === "production") {
  app.use(express.static(distDir, { index: false, maxAge: "1h", setHeaders: (res, p) => { if (p.endsWith("sw.js")) res.set("Cache-Control", "no-cache"); } }));
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ message: "File too large" });
  if (err.type === "entity.parse.failed") return res.status(400).json({ message: "Malformed request" });
  console.error("Unhandled error:", err.message);
  res.status(500).json({ message: "Internal server error" });
});

await connectDB();
server.listen(PORT, () => console.log("server is running on PORT:" + PORT));
