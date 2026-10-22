import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_VOICE_SECONDS = 5 * 60; // the app stops and sends at 5 minutes (the server allows up to 15)

// AAC in MP4 plays in every browser, so it goes first when the recorder can produce it; Opus in WebM / Ogg otherwise.
const MIME_CANDIDATES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
const pickMime = () => (typeof MediaRecorder === "undefined" ? "" : MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) || "");

/** Why recording can't work here (null = it can try). The microphone is only available on https:// or localhost. */
export const voiceUnavailableReason = () => {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return window.isSecureContext
      ? "Voice notes aren't supported in this browser"
      : "Voice notes need a secure connection. Open Gramchat through the https link (npm run share) instead of http://";
  }
  return null;
};

export const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/**
 * Record from the microphone.
 *   start()  → asks for permission and begins (rejects with a readable Error)
 *   finish() → stops and resolves { blob, seconds } (or null if nothing usable)
 *   cancel() → stops and throws the recording away
 */
export function useVoiceRecorder({ onLimit } = {}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef(null);
  const stream = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const startedAt = useRef(0);
  const onLimitRef = useRef(onLimit);
  useEffect(() => { onLimitRef.current = onLimit; });

  const release = useCallback(() => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop()); // turns the browser's "microphone in use" indicator off
    stream.current = null;
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    const why = voiceUnavailableReason();
    if (why) throw new Error(why);
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      throw new Error(e?.name === "NotAllowedError" ? "Microphone access was blocked. Allow it in your browser's site settings." : "Couldn't open the microphone");
    }
    const mime = pickMime();
    const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => { if (e.data?.size) chunks.current.push(e.data); };
    r.start(500);
    recorder.current = r;
    stream.current = s;
    startedAt.current = Date.now();
    setSeconds(0);
    setRecording(true);
    timer.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(secs);
      if (secs >= MAX_VOICE_SECONDS) {
        clearInterval(timer.current);
        onLimitRef.current?.(); // time's up: the caller stops and sends
      }
    }, 250);
  }, []);

  const stop = useCallback(
    (keep) =>
      new Promise((resolve) => {
        const r = recorder.current;
        if (!r || r.state === "inactive") { release(); return resolve(null); }
        r.onstop = () => {
          // Strip codec parameters ("audio/webm;codecs=opus" → "audio/webm"): the server only accepts the plain type
          const type = (r.mimeType || "audio/webm").split(";")[0];
          const blob = new Blob(chunks.current, { type });
          const secs = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
          recorder.current = null;
          release();
          resolve(keep && blob.size > 0 ? { blob, seconds: secs } : null);
        };
        r.stop();
      }),
    [release]
  );

  const finish = useCallback(() => stop(true), [stop]);
  const cancel = useCallback(() => stop(false), [stop]);

  // Leaving the chat (unmount) discards an unfinished recording and frees the microphone
  useEffect(() => () => {
    const r = recorder.current;
    if (r && r.state !== "inactive") { r.onstop = null; r.stop(); }
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return { recording, seconds, start, finish, cancel };
}
