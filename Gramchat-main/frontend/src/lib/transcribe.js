// Phase 2F: on-device voice-note transcription, main-thread side.
//
// The speech model (Whisper, via transformers.js) runs inside this browser, in a Web Worker (public/transcribe-worker.js).
// The audio never leaves the device: it is fetched from this server like any playback, decoded here, and handed to the worker.
// The model files and the runtime are served by THIS server too (nothing is loaded from a CDN or from Hugging Face at run
// time). They are put in place once by the server owner with `npm run setup:transcripts`. Until then the feature is
// simply unavailable (checkTranscriptionSetup() returns null) and nothing else is affected.

/** Is the on-device engine installed on this server and usable in this browser? Returns the manifest or null. */
export const checkTranscriptionSetup = async () => {
  if (typeof Worker === "undefined" || !(window.AudioContext || window.webkitAudioContext)) return null;
  try {
    // A missing file is answered with the app's index.html (single-page-app fallback): only real JSON counts
    const res = await fetch("/models/transcribe.json", { cache: "no-cache", headers: { Accept: "application/json" } });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) return null;
    const manifest = await res.json();
    return manifest && typeof manifest.model === "string" ? manifest : null;
  } catch {
    return null;
  }
};

// The recording as 16 kHz mono samples, which is what the speech model wants
const decode16k = async (url) => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Couldn't download the voice note");
  const bytes = await res.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 16000 });
  try {
    const audio = await ctx.decodeAudioData(bytes);
    return new Float32Array(audio.getChannelData(0)); // a copy, so it can be handed to the worker without copying again
  } catch {
    throw new Error("This browser can't decode the voice note");
  } finally {
    try { ctx.close(); } catch { /* already closed */ }
  }
};

let worker = null;
let seq = 0;
const waiting = new Map(); // request id -> { resolve, reject, onProgress }

const failAll = (message) => {
  for (const w of waiting.values()) w.reject(new Error(message));
  waiting.clear();
  worker?.terminate();
  worker = null; // the next request starts a fresh worker
};

const getWorker = () => {
  if (worker) return worker;
  worker = new Worker("/transcribe-worker.js", { type: "module" });
  worker.onmessage = ({ data }) => {
    const w = waiting.get(data.id);
    if (!w) return;
    if (data.type === "progress") return w.onProgress?.(data.progress);
    waiting.delete(data.id);
    if (data.type === "result") w.resolve(data.text);
    else w.reject(new Error(data.error || "Transcription failed"));
  };
  worker.onerror = () => failAll("The transcription engine couldn't start. Ask the server owner to run npm run setup:transcripts again.");
  return worker;
};

/** Transcribes the voice note at `url` (same-origin). onProgress(0..1) reports the one-time model download/loading. Resolves the text. */
export const transcribeAudio = async (url, { onProgress } = {}) => {
  const samples = await decode16k(url);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ type: "transcribe", id, samples }, [samples.buffer]);
  });
};
