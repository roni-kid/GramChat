// Voice-note waveform (Phase 2F): 48 bars, each an integer 0..100, computed on the SENDER's device right after recording
// (decoding the recording with the browser's own audio decoder). It's cosmetic: it is sent along with the voice note so every
// recipient can draw the same bars without downloading and decoding the audio first. If decoding fails, no waveform is sent
// and the player falls back to a plain progress bar.
export const WAVEFORM_BARS = 48;

export const computePeaks = async (blob, bars = WAVEFORM_BARS) => {
  const Ctx = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
  if (!Ctx || !blob?.size) return null;
  let ctx;
  try {
    ctx = new Ctx();
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = audio.getChannelData(0);
    if (!data.length) return null;
    const size = Math.max(1, Math.floor(data.length / bars));
    const rms = [];
    for (let i = 0; i < bars; i++) {
      const start = Math.min(data.length - 1, i * size);
      const end = Math.min(data.length, start + size);
      let sum = 0;
      for (let j = start; j < end; j++) sum += data[j] * data[j];
      rms.push(Math.sqrt(sum / Math.max(1, end - start)));
    }
    const max = Math.max(...rms, 1e-6);
    // The square root keeps quiet passages visible next to loud ones
    return rms.map((v) => Math.round(Math.min(1, Math.sqrt(v / max)) * 100));
  } catch {
    return null;
  } finally {
    try { ctx?.close(); } catch { /* already closed */ }
  }
};
