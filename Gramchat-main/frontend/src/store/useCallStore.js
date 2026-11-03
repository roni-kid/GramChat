import { create } from "zustand";
import { useAuthStore } from "./useAuthStore";
import { axiosInstance } from "../lib/axios";
import toast from "react-hot-toast";

// Fallback if the server can't be asked (STUN only; calls across strict NATs need the TURN relay below)
const FALLBACK_ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

// The server decides the ICE/TURN servers, so TURN credentials never ship inside the frontend bundle.
// A short timeout: a stalled request must never leave the caller staring at a frozen screen.
const loadIceConfig = async () => {
  try {
    const { data } = await axiosInstance.get("/calls/ice", { timeout: 4000 });
    return { iceServers: data.iceServers };
  } catch {
    return FALLBACK_ICE;
  }
};

const RING_TIMEOUT_MS = 45_000;
const DISCONNECT_GRACE_MS = 8_000;
const MAX_EARLY_CANDIDATES = 50;
let ringTimer = null;
let disconnectTimer = null;
let startingCall = false; // a second tap on "call" while the first is still starting must not start a second call
let onSocketDisconnect = null;

const stopStream = (stream) => {
  try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
};

export const useCallStore = create((set, get) => ({
  callState: "idle",      // "idle" | "calling" | "incoming" | "active"
  callType: null,         // "voice" | "video"
  remoteUser: null,
  localStream: null,
  remoteStream: null,
  peerConnection: null,
  isMuted: false,
  isCameraOff: false,
  callDuration: 0,
  durationInterval: null,
  _pendingOffer: null,
  // Queue for ICE candidates that arrive before remote description is set
  _iceCandidateQueue: [],
  // Candidates that arrive BEFORE the call:incoming event itself (the server relays them independently, so the order can swap)
  _earlyCandidates: [],

  // ── Build a peer connection with all handlers wired ───────────────────────
  _createPeerConnection: (remoteUserId, iceConfig) => {
    const pc = new RTCPeerConnection(iceConfig);
    const socket = useAuthStore.getState().socket;

    // As remote tracks arrive, add them to a live MediaStream and update state
    const remoteStream = new MediaStream();
    pc.ontrack = (event) => {
      (event.streams[0]?.getTracks() ?? [event.track]).forEach((track) => {
        if (!remoteStream.getTracks().includes(track)) remoteStream.addTrack(track);
      });
      // Force a state update so the video element re-renders with the new stream
      set({ remoteStream: new MediaStream(remoteStream.getTracks()) });
    };

    // Send ICE candidates to the remote peer
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit("call:ice-candidate", {
          to: remoteUserId,
          candidate: event.candidate,
        });
      }
    };

    pc.oniceconnectionstatechange = () => console.log(`[WebRTC] ICE state: ${pc.iceConnectionState}`);

    // Log connection state changes for debugging
    pc.onconnectionstatechange = () => {
      clearTimeout(disconnectTimer);
      if (get().peerConnection !== pc) return; // a call that already ended
      if (pc.connectionState === "failed") {
        toast.error("Call connection failed. The network may be blocking direct calls.");
        get().endCall();
      } else if (pc.connectionState === "disconnected") {
        // brief network blips are normal (wifi↔mobile hand-off); only give up if it doesn't recover
        disconnectTimer = setTimeout(() => {
          if (get().peerConnection === pc && pc.connectionState !== "connected") {
            toast.error("Call connection lost");
            get().endCall();
          }
        }, DISCONNECT_GRACE_MS);
      }
    };

    return { pc, remoteStream };
  },

  // ── Drain queued ICE candidates after remote description is set ────────────
  // The queue is taken out of the store BEFORE the awaits: a candidate that arrives while we are adding the others used to be
  // appended to the old queue and then wiped by the final `set([])`, so it was never added.
  _drainIceCandidateQueue: async (pc) => {
    for (let round = 0; round < 5; round++) {
      const queue = get()._iceCandidateQueue;
      if (queue.length === 0) return;
      set({ _iceCandidateQueue: [] });
      console.log(`[WebRTC] draining ${queue.length} queued ICE candidates`);
      for (const candidate of queue) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error("[WebRTC] queued ICE candidate error:", err);
        }
      }
    }
  },

  // ── Start a call (we are the caller) ─────────────────────────────────────
  startCall: async (remoteUser, callType) => {
    const socket = useAuthStore.getState().socket;
    if (!socket) return;
    if (get().callState !== "idle" || startingCall) return;
    // Without a live connection the offer would go nowhere and the caller would sit on "Calling…" until the timeout
    if (!socket.connected) {
      toast.error("Not connected to the server. Check your connection and try again.");
      return;
    }
    startingCall = true;

    let localStream;
    let pc;
    try {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: callType === "video",
        });
      } catch {
        toast.error("Could not access camera/microphone. Check browser permissions (and that the page is HTTPS).");
        return;
      }

      const created = get()._createPeerConnection(remoteUser._id, await loadIceConfig());
      pc = created.pc;
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      set({
        callState: "calling",
        callType,
        remoteUser,
        localStream,
        remoteStream: created.remoteStream,
        peerConnection: pc,
        isMuted: false,
        isCameraOff: false,
        _iceCandidateQueue: [],
        _earlyCandidates: [],
      });

      socket.emit("call:offer", { to: remoteUser._id, offer, callType }); // server adds our name/photo

      clearTimeout(ringTimer);
      ringTimer = setTimeout(() => {
        if (get().callState === "calling") {
          toast("No answer", { icon: "📞" });
          get().endCall();
        }
      }, RING_TIMEOUT_MS);
    } catch (err) {
      // Anything that goes wrong while setting up must release the camera/microphone and leave the screen usable
      console.error("[WebRTC] startCall error:", err);
      toast.error("Couldn't start the call");
      stopStream(localStream);
      try { pc?.close(); } catch { /* ignore */ }
      get()._cleanup();
    } finally {
      startingCall = false;
    }
  },

  // ── Accept incoming call (we are the callee) ──────────────────────────────
  acceptCall: async (incomingOffer, callType) => {
    const socket = useAuthStore.getState().socket;
    const { remoteUser } = get();
    if (!socket || !remoteUser || get().callState !== "incoming") return;

    let localStream;
    let pc;
    try {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: callType === "video",
        });
      } catch {
        toast.error("Could not access camera/microphone. Check browser permissions (and that the page is HTTPS).");
        get().rejectCall();
        return;
      }
      // The caller may have hung up while the permission prompt was open
      if (get().callState !== "incoming") { stopStream(localStream); return; }

      const created = get()._createPeerConnection(remoteUser._id, await loadIceConfig());
      pc = created.pc;
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

      // Set remote description FIRST, then drain any queued ICE candidates
      await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Publish the connection BEFORE draining: candidates that arrive from now on are added directly (the remote description is set),
      // and the ones queued so far are drained below
      set({
        callState: "active",
        callType,
        localStream,
        remoteStream: created.remoteStream,
        peerConnection: pc,
        isMuted: false,
        isCameraOff: false,
      });
      get()._startDurationTimer();

      socket.emit("call:answer", {
        to: remoteUser._id,
        answer,
      });

      await get()._drainIceCandidateQueue(pc);
    } catch (err) {
      console.error("[WebRTC] acceptCall error:", err);
      toast.error("Couldn't connect the call");
      stopStream(localStream);
      try { pc?.close(); } catch { /* ignore */ }
      get().rejectCall();
    }
  },

  // ── Caller receives answer ────────────────────────────────────────────────
  handleCallAnswered: async (answer) => {
    const { peerConnection } = get();
    if (!peerConnection) return;
    clearTimeout(ringTimer);
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      set({ callState: "active" });
      get()._startDurationTimer();
      // Drain any ICE candidates that came in before the answer
      await get()._drainIceCandidateQueue(peerConnection);
    } catch (err) {
      console.error("[WebRTC] handleCallAnswered error:", err);
      toast.error("Call setup failed");
      get().endCall(); // also tells the other side (a plain cleanup left them on a dead call)
    }
  },

  // ── Handle incoming ICE candidate ─────────────────────────────────────────
  handleIceCandidate: async (candidate) => {
    const { peerConnection } = get();
    if (!candidate) return;

    // If peer connection exists and remote description is set, add immediately
    if (peerConnection && peerConnection.remoteDescription) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("[WebRTC] addIceCandidate error:", err);
      }
    } else {
      // Queue it — will be drained after remote description is set
      console.log("[WebRTC] queueing ICE candidate (no remote description yet)");
      set((state) => ({
        _iceCandidateQueue: [...state._iceCandidateQueue, candidate],
      }));
    }
  },

  // A candidate that beat its own call:incoming: keep it so the call can use it once the offer shows up
  _stashEarlyCandidate: (from, candidate) => {
    if (!from || !candidate) return;
    set((state) => ({ _earlyCandidates: [...state._earlyCandidates, { from, candidate }].slice(-MAX_EARLY_CANDIDATES) }));
  },

  // ── Reject incoming call ──────────────────────────────────────────────────
  rejectCall: () => {
    try {
      const socket = useAuthStore.getState().socket;
      const { remoteUser } = get();
      if (socket && remoteUser) socket.emit("call:reject", { to: remoteUser._id });
    } finally {
      get()._cleanup();
    }
  },

  // ── End active call ───────────────────────────────────────────────────────
  // Whatever happens while telling the other side, the screen MUST go back to normal.
  endCall: () => {
    try {
      const socket = useAuthStore.getState().socket;
      const { remoteUser } = get();
      if (socket && remoteUser) socket.emit("call:end", { to: remoteUser._id });
    } catch (err) {
      console.error("[WebRTC] endCall signalling error:", err);
    } finally {
      get()._cleanup();
    }
  },

  // ── Toggle mute ───────────────────────────────────────────────────────────
  toggleMute: () => {
    const { localStream, isMuted } = get();
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => (t.enabled = isMuted));
    set({ isMuted: !isMuted });
  },

  // ── Toggle camera ─────────────────────────────────────────────────────────
  toggleCamera: () => {
    const { localStream, isCameraOff } = get();
    if (!localStream) return;
    localStream.getVideoTracks().forEach((t) => (t.enabled = isCameraOff));
    set({ isCameraOff: !isCameraOff });
  },

  // ── Set incoming call info ────────────────────────────────────────────────
  setIncomingCall: ({ from, offer, callType, callerInfo }) => {
    set((state) => ({
      callState: "incoming",
      callType,
      remoteUser: { _id: from, ...callerInfo },
      _pendingOffer: offer,
      // candidates from this caller that arrived before the offer are kept; anyone else's are dropped
      _iceCandidateQueue: state._earlyCandidates.filter((e) => e.from === from).map((e) => e.candidate),
      _earlyCandidates: [],
    }));
  },

  getPendingOffer: () => get()._pendingOffer,

  // ── Timer ─────────────────────────────────────────────────────────────────
  _startDurationTimer: () => {
    clearInterval(get().durationInterval);
    const interval = setInterval(() => {
      set((state) => ({ callDuration: state.callDuration + 1 }));
    }, 1000);
    set({ durationInterval: interval, callDuration: 0 });
  },

  // ── Cleanup ───────────────────────────────────────────────────────────────
  // Every step is isolated: one failing step (a stream that is already stopped, say) must not stop the screen from resetting.
  _cleanup: () => {
    clearTimeout(ringTimer);
    clearTimeout(disconnectTimer);
    const { localStream, peerConnection, durationInterval } = get();
    stopStream(localStream);
    try { peerConnection?.close(); } catch { /* already closed */ }
    if (durationInterval) clearInterval(durationInterval);
    set({
      callState: "idle",
      callType: null,
      remoteUser: null,
      localStream: null,
      remoteStream: null,
      peerConnection: null,
      isMuted: false,
      isCameraOff: false,
      callDuration: 0,
      durationInterval: null,
      _pendingOffer: null,
      _iceCandidateQueue: [],
      _earlyCandidates: [],
    });
  },

  // ── Socket subscriptions ──────────────────────────────────────────────────
  subscribeToCallEvents: () => {
    const socket = useAuthStore.getState().socket;
    if (!socket) return;

    socket.on("call:incoming", ({ from, offer, callType, callerInfo }) => {
      if (get().callState !== "idle") {
        socket.emit("call:reject", { to: from });
        return;
      }
      get().setIncomingCall({ from, offer, callType, callerInfo });
    });

    const fromPeer = (from) => !from || from === get().remoteUser?._id;

    socket.on("call:answered", ({ from, answer }) => {
      if (fromPeer(from)) get().handleCallAnswered(answer);
    });

    socket.on("call:rejected", ({ from } = {}) => {
      if (!fromPeer(from)) return;
      toast.error("Call declined");
      get()._cleanup();
    });

    socket.on("call:ended", ({ from } = {}) => {
      if (fromPeer(from) && get().callState !== "idle") {
        toast("Call ended", { icon: "📞" });
        get()._cleanup();
      }
    });

    socket.on("call:unavailable", () => {
      toast.error("User is not available");
      get()._cleanup();
    });

    socket.on("call:ice-candidate", ({ from, candidate }) => {
      if (get().callState === "idle") get()._stashEarlyCandidate(from, candidate); // arrived ahead of its call:incoming
      else if (fromPeer(from)) get().handleIceCandidate(candidate);
    });

    // If the server connection drops while the phone is still ringing, the other side can never answer: stop waiting.
    // (A call that is already connected keeps going; its media doesn't pass through the server, and End still works.)
    if (onSocketDisconnect) socket.off("disconnect", onSocketDisconnect);
    onSocketDisconnect = () => {
      const s = get().callState;
      if (s === "calling" || s === "incoming") {
        toast.error("Lost connection to the server");
        get()._cleanup();
      }
    };
    socket.on("disconnect", onSocketDisconnect);
  },

  unsubscribeFromCallEvents: () => {
    const socket = useAuthStore.getState().socket;
    if (!socket) return;
    socket.off("call:incoming");
    socket.off("call:answered");
    socket.off("call:rejected");
    socket.off("call:ended");
    socket.off("call:unavailable");
    socket.off("call:ice-candidate");
    if (onSocketDisconnect) socket.off("disconnect", onSocketDisconnect);
    onSocketDisconnect = null;
  },
}));
