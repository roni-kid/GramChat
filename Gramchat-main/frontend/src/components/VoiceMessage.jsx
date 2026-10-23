import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { FileText, Mic, Pause, Play } from "lucide-react";
import { formatDuration } from "../lib/utils";
import { useTranscriptStore } from "../store/useTranscriptStore";

const RATES = [1, 1.5, 2];
let nowPlaying = null; // only one voice note plays at a time

/** The bars of a voice note (Phase 2F). Tap or drag to seek; arrow keys jump 5 seconds. The bars were measured on the sender's
 *  device and sent with the message; notes recorded before that have none and get the plain slider instead. */
const Waveform = ({ peaks, progress, total, onSeek, onNudge }) => {
  const ref = useRef(null);
  const seekTo = (e) => {
    const r = ref.current.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); onNudge(5); }
    if (e.key === "ArrowLeft") { e.preventDefault(); onNudge(-5); }
  };
  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={total ? 0 : -1}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => { if (!total) return; e.currentTarget.setPointerCapture(e.pointerId); seekTo(e); }}
      onPointerMove={(e) => { if (total && e.buttons) seekTo(e); }}
      className="flex items-center gap-[2px] h-8 cursor-pointer select-none touch-none"
    >
      {peaks.map((p, i) => (
        <span
          key={i}
          style={{ height: `${Math.max(14, p)}%` }}
          className={`flex-1 min-w-[2px] rounded-full bg-current ${(i + 0.5) / peaks.length <= progress ? "opacity-100" : "opacity-30"}`}
        />
      ))}
    </div>
  );
};

/** On-device transcript of a voice note: only shown when the server has the engine installed and this device switched it on. */
const Transcript = ({ message }) => {
  const available = useTranscriptStore((s) => s.available);
  const enabled = useTranscriptStore((s) => s.enabled);
  const item = useTranscriptStore((s) => s.items[message._id]);
  const { transcribe, hide, loadCached } = useTranscriptStore.getState();
  const can = available && enabled && !message.pending && !message.viewOnce;

  useEffect(() => {
    if (can && !message.expiresAt) loadCached(message._id); // a transcript this device made earlier (never kept for disappearing notes)
  }, [can, message._id, message.expiresAt, loadCached]);

  if (!can) return null;
  const btn = "text-xs underline opacity-80 hover:opacity-100";
  return (
    <div className="mt-1.5 min-w-0">
      {!item && (
        <button type="button" onClick={() => transcribe(message)} className={`${btn} flex items-center gap-1`}>
          <FileText className="size-3" /> Transcribe
        </button>
      )}
      {item?.status === "working" && (
        <p className="text-xs opacity-70">
          {item.progress > 0 && item.progress < 1 ? `Loading the speech model… ${Math.round(item.progress * 100)}%` : "Transcribing on this device…"}
        </p>
      )}
      {item?.status === "done" && (
        <>
          <p className="text-sm whitespace-pre-wrap break-words">{item.text}</p>
          <button type="button" onClick={() => hide(message._id)} className={btn}>Hide</button>
        </>
      )}
      {item?.status === "error" && (
        <p className="text-xs">
          <span className="text-error">{item.error}</span>{" "}
          <button type="button" onClick={() => transcribe(message)} className={btn}>Try again</button>
        </p>
      )}
    </div>
  );
};

/** Player for a voice note: play/pause, seek (waveform or slider), 1x / 1.5x / 2x, optional on-device transcript. The duration
 *  comes from the recorder because browsers often can't tell the length of a freshly recorded WebM file. */
const VoiceMessage = ({ message }) => {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [browserDuration, setBrowserDuration] = useState(0);
  const total = message.voiceDuration || browserDuration || 0;
  const peaks = message.voiceWaveform?.length ? message.voiceWaveform : null;

  useEffect(() => () => {
    if (nowPlaying === audioRef.current) nowPlaying = null; // leaving the chat stops it (the element is removed)
  }, []);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) return a.pause();
    if (nowPlaying && nowPlaying !== a) nowPlaying.pause();
    nowPlaying = a;
    try {
      await a.play();
    } catch {
      toast.error("Couldn't play this voice message in your browser");
    }
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const seekSeconds = (v) => {
    const t = Math.min(Math.max(0, v), total || 0);
    setTime(t);
    if (audioRef.current) audioRef.current.currentTime = t;
  };

  return (
    <div className="min-w-[14rem] max-w-full">
      <div className="flex items-center gap-2">
        <audio
          ref={audioRef}
          src={message.fileUrl}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setTime(0); }}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setBrowserDuration(e.currentTarget.duration)}
        />
        <button type="button" onClick={toggle} className="btn btn-circle btn-sm btn-ghost bg-black/10 shrink-0" aria-label={playing ? "Pause voice message" : "Play voice message"}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <div className="flex-1 min-w-0">
          {peaks ? (
            <Waveform peaks={peaks} progress={total ? Math.min(1, time / total) : 0} total={total} onSeek={(f) => seekSeconds(f * total)} onNudge={(d) => seekSeconds(time + d)} />
          ) : (
            <input
              type="range" min={0} max={total || 1} step={0.1} value={Math.min(time, total || 1)} onChange={(e) => seekSeconds(Number(e.target.value))}
              className="range range-xs w-full" aria-label="Seek" disabled={!total}
            />
          )}
          <div className="flex items-center justify-between text-[10px] opacity-70 mt-0.5">
            <span className="flex items-center gap-1"><Mic className="size-3" /> {formatDuration(playing || time ? time : total)}</span>
            <button type="button" onClick={cycleRate} className="px-1 rounded hover:bg-black/10" aria-label="Playback speed">{rate}x</button>
          </div>
        </div>
      </div>
      <Transcript message={message} />
    </div>
  );
};

export default VoiceMessage;
