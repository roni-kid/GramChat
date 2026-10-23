#!/usr/bin/env node
// Sets up on-device voice-note transcripts (Phase 2F). Run it ONCE on the machine that builds / serves the app:
//
//     npm run setup:transcripts                      (default model: Xenova/whisper-tiny, multilingual, about 40 MB)
//     npm run setup:transcripts -- Xenova/whisper-base   (better accuracy, about 80 MB, slower)
//
// What it does (this is the only time anything is downloaded; the app itself never contacts a third party):
//   1. installs the pinned transformers.js runtime into frontend/node_modules WITHOUT touching package.json or the lockfile
//   2. copies the runtime and its WebAssembly files to frontend/public/vendor/transcribe/
//   3. downloads the speech model files from huggingface.co into frontend/public/models/<model>/
//   4. writes frontend/public/models/transcribe.json, which is how the app knows the feature is installed
// All of that is git-ignored. Afterwards rebuild (`npm run build`) so the files are served, and restart the server.
// To remove the feature, delete frontend/public/vendor and frontend/public/models.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const ROOT = path.join(__dirname, "..");
const FRONT = path.join(ROOT, "frontend");
const PKG = "@huggingface/transformers";
const PKG_VERSION = "3.8.1"; // pinned: the worker (frontend/public/transcribe-worker.js) is written against this API
const MODEL = process.argv[2] || "Xenova/whisper-tiny";
const VENDOR = path.join(FRONT, "public", "vendor", "transcribe");
const MODEL_DIR = path.join(FRONT, "public", "models", ...MODEL.split("/"));
const MANIFEST = path.join(FRONT, "public", "models", "transcribe.json");

const die = (msg) => {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
};
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

if (!/^[\w.-]+\/[\w.-]+$/.test(MODEL)) die(`"${MODEL}" doesn't look like a Hugging Face model id (like Xenova/whisper-tiny).`);

async function main() {
  console.log(`Setting up on-device transcripts with ${MODEL}\n`);

  // 1. the runtime
  const pkgDir = path.join(FRONT, "node_modules", ...PKG.split("/"));
  if (!fs.existsSync(path.join(pkgDir, "package.json"))) {
    console.log(`1/4 Installing ${PKG}@${PKG_VERSION} (not saved to package.json) ...`);
    execSync(`npm install --no-save --no-audit --no-fund ${PKG}@${PKG_VERSION}`, { cwd: FRONT, stdio: "inherit" });
  } else {
    console.log(`1/4 ${PKG} is already installed.`);
  }
  const installed = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
  if (installed !== PKG_VERSION) console.log(`    note: version ${installed} is installed, the worker was written for ${PKG_VERSION}. If transcription fails, run: npm install --no-save --prefix frontend ${PKG}@${PKG_VERSION}`);

  // 2. runtime + wasm files into public/vendor/transcribe
  fs.mkdirSync(VENDOR, { recursive: true });
  const dist = path.join(pkgDir, "dist");
  const entry = ["transformers.min.js", "transformers.js"].find((f) => fs.existsSync(path.join(dist, f)));
  if (!entry) die(`Couldn't find the runtime in ${dist} (it has: ${fs.existsSync(dist) ? fs.readdirSync(dist).join(", ") : "nothing"}).`);
  fs.copyFileSync(path.join(dist, entry), path.join(VENDOR, "transformers.min.js"));

  const ortDirs = [path.join(FRONT, "node_modules", "onnxruntime-web", "dist"), path.join(pkgDir, "node_modules", "onnxruntime-web", "dist")];
  const ortDir = ortDirs.find((d) => fs.existsSync(d));
  if (!ortDir) die("Couldn't find onnxruntime-web (a dependency of transformers.js) in frontend/node_modules.");
  const ortFiles = fs.readdirSync(ortDir).filter((f) => /^ort-wasm.*\.(wasm|mjs)$/.test(f));
  if (!ortFiles.length) die(`No ort-wasm files in ${ortDir}.`);
  ortFiles.forEach((f) => fs.copyFileSync(path.join(ortDir, f), path.join(VENDOR, f)));
  console.log(`2/4 Copied the runtime and ${ortFiles.length} WebAssembly files to ${path.relative(ROOT, VENDOR)}`);

  // 3. the model
  console.log(`3/4 Looking up ${MODEL} on huggingface.co ...`);
  const infoRes = await fetch(`https://huggingface.co/api/models/${MODEL}`);
  if (!infoRes.ok) die(`Hugging Face answered ${infoRes.status} for ${MODEL}. Check the name and your internet connection.`);
  const names = ((await infoRes.json()).siblings || []).map((s) => s.rfilename);
  const needOnnx = ["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"];
  const missing = needOnnx.filter((f) => !names.includes(f));
  if (missing.length) die(`${MODEL} has no ${missing.join(" / ")}. Use a Whisper model from the Xenova organisation (for example Xenova/whisper-tiny or Xenova/whisper-base).`);
  const wanted = names.filter((f) => (f.startsWith("onnx/") ? needOnnx.includes(f) : /\.(json|txt)$/i.test(f)));

  for (const file of wanted) {
    const dest = path.join(MODEL_DIR, ...file.split("/"));
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`    have ${file}`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const res = await fetch(`https://huggingface.co/${MODEL}/resolve/main/${file}`, { redirect: "follow" });
    if (!res.ok || !res.body) die(`Couldn't download ${file} (HTTP ${res.status}).`);
    const part = `${dest}.part`;
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
    fs.renameSync(part, dest);
    console.log(`    got  ${file} (${mb(fs.statSync(dest).size)})`);
  }

  // 4. the manifest the app looks for
  fs.writeFileSync(MANIFEST, JSON.stringify({ model: MODEL, dtype: "q8", multilingual: !MODEL.endsWith(".en"), runtime: installed, createdAt: new Date().toISOString() }, null, 2));
  console.log(`4/4 Wrote ${path.relative(ROOT, MANIFEST)}\n`);
  console.log("Done. Now rebuild and restart so the files are served:");
  console.log("    npm run build");
  console.log("    npm run start");
  console.log("(In development, `npm run dev` serves them straight away.)");
  console.log("Then each person turns it on in Settings > Voice-note transcripts.");
}

main().catch((e) => die(e.message));
