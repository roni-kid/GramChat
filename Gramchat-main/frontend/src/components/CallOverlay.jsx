import { useEffect, useRef } from "react";
import { useCallStore } from "../store/useCallStore";
import { useAuthStore } from "../store/useAuthStore";
import {
  Phone, PhoneOff, PhoneMissed, Mic, MicOff,
  Video, VideoOff, PhoneIncoming,
} from "lucide-react";

const formatDuration = (secs) => {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

const useRingtone = (active) => {
  const ctxRef = useRef(null);
  const intervalRef = useRef(null);

  const playRing = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctxRef.current = ctx;
      const ring = () => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        osc.frequency.setValueAtTime(440, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.6);
      };
      ring();
      intervalRef.current = setInterval(ring, 1200);
    } catch {
      /* audio may be blocked until the user interacts with the page */
    }
  };

  const stopRing = () => {
    clearInterval(intervalRef.current);
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
  };

  useEffect(() => {
    if (active) playRing();
    else stopRing();
    return () => stopRing();
  }, [active]);
};

const RemoteAudio = ({ stream }) => {
  const audioRef = useRef(null);
  useEffect(() => {
    if (audioRef.current && stream) audioRef.current.srcObject = stream;
  }, [stream]);
  return <audio ref={audioRef} autoPlay playsInline className="hidden" />;
};

const VideoEl = ({ stream, muted = false, className = "" }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
};

const Avatar = ({ user, size = "lg" }) => {
  const sz = size === "lg" ? "size-28" : "size-16";
  return (
    <img
      src={user?.profilePic || "/avatar.png"}
      alt={user?.fullName}
      className={`${sz} rounded-full object-cover border-4 border-white/20 shadow-xl`}
    />
  );
};

const CallOverlay = () => {
  const {
    callState, callType, remoteUser, localStream, remoteStream,
    isMuted, isCameraOff, callDuration,
    acceptCall, rejectCall, endCall, toggleMute, toggleCamera,
    getPendingOffer, subscribeToCallEvents, unsubscribeFromCallEvents,
  } = useCallStore();

  const socket = useAuthStore((s) => s.socket);
  useEffect(() => {
    if (!socket) return;
    subscribeToCallEvents();
    return () => unsubscribeFromCallEvents();
  }, [socket, subscribeToCallEvents, unsubscribeFromCallEvents]);

  useRingtone(callState === "incoming" || callState === "calling");

  if (callState === "idle") return null;

  const isVideo = callType === "video";

  // ── INCOMING ──────────────────────────────────────────────────────────────
  if (callState === "incoming") {
    return (
      <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="relative bg-base-100 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
          <div className="h-2 bg-gradient-to-r from-green-400 to-emerald-500" />
          <div className="p-8 flex flex-col items-center gap-5">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-green-400/30 animate-ping scale-110" />
              <Avatar user={remoteUser} size="lg" />
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{remoteUser?.fullName}</p>
              <p className="text-base-content/60 mt-1 flex items-center justify-center gap-1.5">
                <PhoneIncoming className="size-4 text-green-500 animate-bounce" />
                Incoming {isVideo ? "video" : "voice"} call…
              </p>
            </div>
            <div className="flex gap-8 mt-2">
              <div className="flex flex-col items-center gap-2">
                <button onClick={rejectCall}
                  className="size-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 transition-all flex items-center justify-center shadow-lg">
                  <PhoneMissed className="size-7 text-white" />
                </button>
                <span className="text-xs text-base-content/50">Decline</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button onClick={() => acceptCall(getPendingOffer(), callType)}
                  className="size-16 rounded-full bg-green-500 hover:bg-green-600 active:scale-95 transition-all flex items-center justify-center shadow-lg">
                  {isVideo ? <Video className="size-7 text-white" /> : <Phone className="size-7 text-white" />}
                </button>
                <span className="text-xs text-base-content/50">Accept</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── CALLING ───────────────────────────────────────────────────────────────
  if (callState === "calling") {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
        <div className="relative flex flex-col items-center gap-6">
          <div className="relative flex items-center justify-center">
            {[1, 2, 3].map((i) => (
              <div key={i} className="absolute rounded-full border border-white/10 animate-ping"
                style={{ width: `${i * 80 + 100}px`, height: `${i * 80 + 100}px`,
                  animationDelay: `${(i - 1) * 400}ms`, animationDuration: "2s" }} />
            ))}
            <Avatar user={remoteUser} size="lg" />
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-white">{remoteUser?.fullName}</p>
            <p className="text-white/60 mt-2 animate-pulse">{isVideo ? "📹" : "📞"} Calling…</p>
          </div>
          <button onClick={endCall}
            className="size-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 transition-all flex items-center justify-center shadow-xl mt-4">
            <PhoneOff className="size-7 text-white" />
          </button>
          <span className="text-white/40 text-sm">Tap to cancel</span>
        </div>
      </div>
    );
  }

  // ── ACTIVE VIDEO ──────────────────────────────────────────────────────────
  if (callState === "active" && isVideo) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col">
        <div className="flex-1 relative bg-slate-900 flex items-center justify-center">
          {remoteStream && remoteStream.getVideoTracks().length > 0 ? (
            <VideoEl stream={remoteStream} className="w-full h-full object-cover" />
          ) : (
            <Avatar user={remoteUser} size="lg" />
          )}
          <div className="absolute top-6 left-0 right-0 flex flex-col items-center gap-1 pointer-events-none">
            <p className="text-white font-semibold text-lg drop-shadow">{remoteUser?.fullName}</p>
            <p className="text-white/70 text-sm font-mono">{formatDuration(callDuration)}</p>
          </div>
          {/* PiP local video */}
          <div className="absolute bottom-24 right-4 rounded-2xl overflow-hidden border-2 border-white/20 shadow-xl"
            style={{ width: 100, height: 140 }}>
            {localStream && !isCameraOff ? (
              <VideoEl stream={localStream} muted className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-slate-700 flex items-center justify-center">
                <VideoOff className="size-5 text-white/50" />
              </div>
            )}
          </div>
        </div>
        <div className="bg-black/80 backdrop-blur px-8 py-6 flex items-center justify-center gap-6">
          <div className="flex flex-col items-center gap-1">
            <button onClick={toggleMute}
              className={`size-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${isMuted ? "bg-red-500/20 border border-red-500" : "bg-white/10 hover:bg-white/20"}`}>
              {isMuted ? <MicOff className="size-6 text-red-400" /> : <Mic className="size-6 text-white" />}
            </button>
            <span className="text-white/50 text-xs">{isMuted ? "Unmute" : "Mute"}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <button onClick={endCall}
              className="size-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 transition-all flex items-center justify-center shadow-xl">
              <PhoneOff className="size-7 text-white" />
            </button>
            <span className="text-white/50 text-xs">End</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <button onClick={toggleCamera}
              className={`size-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${isCameraOff ? "bg-red-500/20 border border-red-500" : "bg-white/10 hover:bg-white/20"}`}>
              {isCameraOff ? <VideoOff className="size-6 text-red-400" /> : <Video className="size-6 text-white" />}
            </button>
            <span className="text-white/50 text-xs">{isCameraOff ? "Camera on" : "Camera off"}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── ACTIVE VOICE ──────────────────────────────────────────────────────────
  if (callState === "active") {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-green-900 via-slate-900 to-slate-900" />
        <RemoteAudio stream={remoteStream} />
        <div className="relative flex flex-col items-center gap-6 w-full max-w-sm px-8">
          <Avatar user={remoteUser} size="lg" />
          <div className="text-center">
            <p className="text-3xl font-bold text-white">{remoteUser?.fullName}</p>
            <p className="text-green-400 mt-1 text-sm font-mono">{formatDuration(callDuration)}</p>
          </div>
          <div className="flex items-center gap-6 mt-4">
            <div className="flex flex-col items-center gap-1">
              <button onClick={toggleMute}
                className={`size-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${isMuted ? "bg-red-500/20 border border-red-500" : "bg-white/10 hover:bg-white/20"}`}>
                {isMuted ? <MicOff className="size-6 text-red-400" /> : <Mic className="size-6 text-white" />}
              </button>
              <span className="text-white/50 text-xs">{isMuted ? "Unmute" : "Mute"}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <button onClick={endCall}
                className="size-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 transition-all flex items-center justify-center shadow-xl">
                <PhoneOff className="size-7 text-white" />
              </button>
              <span className="text-white/50 text-xs">End</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default CallOverlay;
