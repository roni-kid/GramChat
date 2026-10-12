#!/usr/bin/env node
/**
 * npm run share
 * Builds the app, starts it in production mode and (if `cloudflared` is installed) opens a free
 * public HTTPS link so someone on another network can use your Gramchat. No account needed.
 *
 *   npm run share              build if needed, start, open tunnel
 *   npm run share -- --build   force a fresh frontend build
 *   npm run share -- --no-tunnel   just run locally (LAN / localhost)
 */
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const backendDir = path.join(root, "backend");
const frontendDir = path.join(root, "frontend");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const args = new Set(process.argv.slice(2));

const say = (m = "") => console.log(m);
const die = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };

// 1. dependencies
for (const dir of [backendDir, frontendDir]) {
  if (!fs.existsSync(path.join(dir, "node_modules"))) die("Dependencies are not installed. Run:  npm run setup");
}

// 2. backend/.env — create one with a random secret if missing
const envPath = path.join(backendDir, ".env");
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(
    envPath,
    `PORT=5001\nMONGODB_URI=mongodb://127.0.0.1:27017/gramchat\nJWT_SECRET=${crypto.randomBytes(48).toString("hex")}\n`
  );
  say("Created backend/.env with a freshly generated JWT_SECRET.");
}
const envText = fs.readFileSync(envPath, "utf8");
const PORT = (envText.match(/^PORT=(\d+)/m) || [])[1] || "5001";

// 3. frontend build
const dist = path.join(frontendDir, "dist", "index.html");
if (args.has("--build") || !fs.existsSync(dist)) {
  say("Building the frontend…");
  const r = spawnSync(npm, ["run", "build"], { cwd: frontendDir, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) die("Frontend build failed.");
}

// 4. start the server (production mode: serves the built app + API + sockets from ONE address)
const server = spawn(process.execPath, ["src/index.js"], {
  cwd: backendDir,
  stdio: ["ignore", "pipe", "inherit"],
  env: { ...process.env, NODE_ENV: "production" },
});
let ready = false;
server.stdout.on("data", (d) => {
  process.stdout.write(d);
  if (!ready && String(d).includes("server is running")) { ready = true; onReady(); }
});
server.on("exit", (code) => { if (!ready) die("The server failed to start (is MongoDB running? see the error above)."); process.exit(code || 0); });

let tunnel;
function onReady() {
  const local = `http://localhost:${PORT}`;
  say(`\n✔ Gramchat is running locally:  ${local}`);

  if (args.has("--no-tunnel")) return say("  (tunnel disabled)  On your Wi-Fi others can try http://<this-PC-ip>:" + PORT + " — set COOKIE_SECURE=false in backend/.env for plain http.");

  const probe = spawnSync("cloudflared", ["--version"], { shell: process.platform === "win32" });
  if (probe.error || probe.status !== 0) {
    return say(
      `\n  To let someone on ANOTHER network connect, install the free Cloudflare tunnel tool once:\n` +
      `    Windows:  winget install --id Cloudflare.cloudflared\n` +
      `    macOS:    brew install cloudflared\n` +
      `    Linux:    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n` +
      `  then run  npm run share  again. See docs/SHARING.md.`
    );
  }
  say("  Opening a public link (no account needed)…");
  tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", local], { shell: process.platform === "win32" });
  let announced = false;
  const scan = (d) => {
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (m && !announced) {
      announced = true;
      say(`\n┌────────────────────────────────────────────────────────────┐`);
      say(`  Share this link with your friend:\n\n    ${m[0]}\n`);
      say(`  • Works from any network, phone or PC, over HTTPS.`);
      say(`  • The link changes every time you run this. Keep this window open.`);
      say(`  • Anyone with the link can create an account on YOUR server.`);
      say(`└────────────────────────────────────────────────────────────┘`);
    }
  };
  tunnel.stdout.on("data", scan);
  tunnel.stderr.on("data", scan);
  tunnel.on("exit", () => say("\nTunnel closed."));
}

const stop = () => { tunnel?.kill(); server.kill(); setTimeout(() => process.exit(0), 300); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
