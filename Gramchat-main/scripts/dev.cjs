const { spawn } = require("node:child_process");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const processes = [
  spawn(npm, ["run", "dev", "--prefix", "backend"], { stdio: "inherit" }),
  spawn(npm, ["run", "dev", "--prefix", "frontend"], { stdio: "inherit" }),
];

let shuttingDown = false;

function stopAll(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of processes) {
    if (!child.killed) child.kill(signal);
  }
}

for (const child of processes) {
  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      stopAll();
      process.exitCode = code || 1;
    }
  });
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
