const fs = require("node:fs");
const path = require("node:path");

const viteBin = process.platform === "win32" ? "vite.cmd" : "vite";
const vitePath = path.join(__dirname, "..", "node_modules", ".bin", viteBin);

if (!fs.existsSync(vitePath)) {
  console.error(
    [
      "",
      "Frontend dependencies are not installed.",
      "Run this once from the project root:",
      "",
      "  npm run setup",
      "",
      "Or install only the frontend:",
      "",
      "  cd frontend",
      "  npm install",
      "",
    ].join("\n")
  );
  process.exit(1);
}
