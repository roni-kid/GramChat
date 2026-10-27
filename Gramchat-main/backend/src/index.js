import "./lib/loadEnv.js"; // must stay the first import: it loads backend/.env before other modules read process.env
import express from "express";
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
import contactRoutes from "./routes/contact.route.js";
import pushRoutes from "./routes/push.route.js";
import chatRoutes from "./routes/chat.route.js";
import { initPush } from "./lib/push.js";
import { startSweeper } from "./lib/disappearing.js";
import { runMigrations } from "./lib/migrate.js";
import { app, server } from "./lib/socket.js";
import { getClientOrigins, getPort, validateRequiredEnv } from "./lib/config.js";

validateRequiredEnv();

// Safety net: one failed background task (a database hiccup in a fire-and-forget call, say) is logged instead of taking down
// the whole server, which is what Node does with an unhandled promise rejection by default.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason instanceof Error ? reason.message : reason);
});

const PORT = getPort();
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../../frontend/dist");

// We sit behind a tunnel / reverse proxy when shared, so one proxy hop is trusted by default (req.ip is what the rate limiters use).
// If the server is reachable DIRECTLY (no proxy in front), set TRUST_PROXY=false: otherwise a client could fake its address
// with an X-Forwarded-For header and get around the login / signup limits.
const trustProxy = process.env.TRUST_PROXY;
app.set("trust proxy", trustProxy === undefined || trustProxy === "" ? 1 : trustProxy === "false" ? false : /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
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
app.use("/api/contacts", contactRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/chats", chatRoutes);

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
await runMigrations();
await initPush();
server.listen(PORT, () => console.log("server is running on PORT:" + PORT));
startSweeper(); // deletes disappeared messages and view-once media that is past its time
