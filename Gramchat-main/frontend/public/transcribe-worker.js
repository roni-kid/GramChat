// On-device speech-to-text worker (Phase 2F). Served as a plain static file: it is NOT part of the app bundle, so the app builds
// and runs exactly the same whether or not transcripts have been set up. See lib/transcribe.js and scripts/setup-transcripts.cjs.
//
// Everything it loads comes from THIS server: the runtime and the WebAssembly files from /vendor/transcribe/, the model from
// /models/. Remote model downloads are switched off, so it can never fetch anything from Hugging Face or a CDN.
import { pipeline, env } from "/vendor/transcribe/transformers.min.js";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
env.backends.onnx.wasm.wasmPaths = "/vendor/transcribe/";

let transcriber = null;
let loading = null;
let manifest = null;
let report = () => {};

// transformers.js reports progress per file: fold it into one number for the whole model
const files = {};
const onModelProgress = (p) => {
  if (!p || !p.file || !p.total) return;
  files[p.file] = { loaded: p.loaded || 0, total: p.total };
  const all = Object.values(files);
  const total = all.reduce((n, f) => n + f.total, 0);
  report(total ? all.reduce((n, f) => n + f.loaded, 0) / total : 0);
};

const load = () => {
  if (transcriber) return Promise.resolve(transcriber);
  if (!loading) {
    loading = (async () => {
      const res = await fetch("/models/transcribe.json", { cache: "no-cache" });
      manifest = await res.json();
      transcriber = await pipeline("automatic-speech-recognition", manifest.model, {
        dtype: manifest.dtype || "q8",
        device: "wasm",
        progress_callback: onModelProgress,
      });
      return transcriber;
    })().catch((e) => {
      loading = null; // allow a retry
      throw e;
    });
  }
  return loading;
};

const run = async (t, samples) => {
  // Long notes are cut into 30 s windows with a little overlap. A multilingual model detects the language by itself.
  const options = { chunk_length_s: 30, stride_length_s: 5 };
  if (manifest.multilingual) options.task = "transcribe";
  const out = await t(samples, options);
  return (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text || "").trim();
};

// One note at a time (the model is single-threaded here)
let chain = Promise.resolve();
self.onmessage = ({ data }) => {
  if (!data || data.type !== "transcribe") return;
  chain = chain.then(async () => {
    try {
      report = (progress) => self.postMessage({ type: "progress", id: data.id, progress });
      const t = await load();
      const text = await run(t, data.samples);
      self.postMessage({ type: "result", id: data.id, text });
    } catch (e) {
      self.postMessage({ type: "error", id: data.id, error: String((e && e.message) || e) });
    }
  });
};
