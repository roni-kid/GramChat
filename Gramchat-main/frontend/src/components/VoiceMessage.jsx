import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Mic, Pause, Play } from "lucide-react";
import { formatDuration } from "../lib/utils";

const RATES = [1, 1.5, 2];
let nowPlaying = null; // only one voice note plays at a time

/** Player for a voice note: play/pause, seek, 1x / 1.5x / 2x. The duration comes from the recorder because
 *  browsers often can't tell the length of a freshly recorded WebM file. */
const VoiceMessage = ({ message }) => {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [browserDuration, setBrowserDuration] = useState(0);
  const total = message.voiceDuration || browserDuration || 0;

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

  const seek = (e) => {
    const v = Number(e.target.value);
    setTime(v);
    if (audioRef.current) audioRef.current.currentTime = v;
  };

  return (
    <div className="flex items-center gap-2 min-w-[14rem] max-w-full">
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
        <input
          type="range" min={0} max={total || 1} step={0.1} value={Math.min(time, total || 1)} onChange={seek}
          className="range range-xs w-full" aria-label="Seek" disabled={!total}
        />
        <div className="flex items-center justify-between text-[10px] opacity-70 mt-0.5">
          <span className="flex items-center gap-1"><Mic className="size-3" /> {formatDuration(playing || time ? time : total)}</span>
          <button type="button" onClick={cycleRate} className="px-1 rounded hover:bg-black/10" aria-label="Playback speed">{rate}x</button>
        </div>
      </div>
    </div>
  );
};

export default VoiceMessage;
