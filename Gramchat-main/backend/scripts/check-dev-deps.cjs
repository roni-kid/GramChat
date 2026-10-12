const fs = require("node:fs");
const path = require("node:path");

const nodemonBin = process.platform === "win32" ? "nodemon.cmd" : "nodemon";
const nodemonPath = path.join(__dirname, "..", "node_modules", ".bin", nodemonBin);

if (!fs.existsSync(nodemonPath)) {
  console.error(
    [
      "",
      "Backend dependencies are not installed.",
      "Run this once from the project root:",
      "",
      "  npm run setup",
      "",
      "Or install only the backend:",
      "",
      "  cd backend",
      "  npm install",
      "",
    ].join("\n")
  );
  process.exit(1);
}
