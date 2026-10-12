import { create } from "zustand";
import { useAuthStore } from "./useAuthStore";
import { axiosInstance } from "../lib/axios";
import toast from "react-hot-toast";

// Fallback if the server can't be asked (STUN only; calls across strict NATs need the TURN relay below)
const FALLBACK_ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

// The server decides the ICE/TURN servers, so TURN credentials never ship inside the frontend bundle.
const loadIceConfig = async () => {
  try {
    const { data } = await axiosInstance.get("/calls/ice");
    return { iceServers: data.iceServers };
  } catch {
    return FALLBACK_ICE;
  }
};

const RING_TIMEOUT_MS = 45_000;
const DISCONNECT_GRACE_MS = 8_000;
let ringTimer = null;
let disconnectTimer = null;

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

    // Log connection state changes for debugging
    pc.onconnectionstatechange = () => {
      clearTimeout(disconnectTimer);
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
  _drainIceCandidateQueue: async (pc) => {
    const queue = get()._iceCandidateQueue;
    if (queue.length === 0) return;
    console.log(`[WebRTC] draining ${queue.length} queued ICE candidates`);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("[WebRTC] queued ICE candidate error:", err);
      }
    }
    set({ _iceCandidateQueue: [] });
  },

  // ── Start a call (we are the caller) ─────────────────────────────────────
  startCall: async (remoteUser, callType) => {
    const socket = useAuthStore.getState().socket;
    if (!socket) return;

    let localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === "video",
      });
    } catch {
      toast.error("Could not access camera/microphone. Check browser permissions (and that the page is HTTPS).");
      return;
    }

    const { pc, remoteStream } = get()._createPeerConnection(remoteUser._id, await loadIceConfig());
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    set({
      callState: "calling",
      callType,
      remoteUser,
      localStream,
      remoteStream,
      peerConnection: pc,
      isMuted: false,
      isCameraOff: false,
      _iceCandidateQueue: [],
    });

    socket.emit("call:offer", { to: remoteUser._id, offer, callType }); // server adds our name/photo

    clearTimeout(ringTimer);
    ringTimer = setTimeout(() => {
      if (get().callState === "calling") {
        toast("No answer", { icon: "📞" });
        get().endCall();
      }
    }, RING_TIMEOUT_MS);
  },

  // ── Accept incoming call (we are the callee) ──────────────────────────────
  acceptCall: async (incomingOffer, callType) => {
    const socket = useAuthStore.getState().socket;
    const { remoteUser } = get();
    if (!socket || !remoteUser) return;

    let localStream;
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

    const { pc, remoteStream } = get()._createPeerConnection(remoteUser._id, await loadIceConfig());
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    // Set remote description FIRST, then drain any queued ICE candidates
    await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer));
    await get()._drainIceCandidateQueue(pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    set({
      callState: "active",
      callType,
      localStream,
      remoteStream,
      peerConnection: pc,
      isMuted: false,
      isCameraOff: false,
    });

    get()._startDurationTimer();

    socket.emit("call:answer", {
      to: remoteUser._id,
      answer,
    });
  },

  // ── Caller receives answer ────────────────────────────────────────────────
  handleCallAnswered: async (answer) => {
    const { peerConnection } = get();
    if (!peerConnection) return;
    clearTimeout(ringTimer);
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      // Drain any ICE candidates that came in before the answer
      await get()._drainIceCandidateQueue(peerConnection);
      set({ callState: "active" });
      get()._startDurationTimer();
    } catch (err) {
      console.error("[WebRTC] handleCallAnswered error:", err);
      toast.error("Call setup failed");
      get()._cleanup();
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

  // ── Reject incoming call ──────────────────────────────────────────────────
  rejectCall: () => {
    const socket = useAuthStore.getState().socket;
    const { remoteUser } = get();
    if (socket && remoteUser) socket.emit("call:reject", { to: remoteUser._id });
    get()._cleanup();
  },

  // ── End active call ───────────────────────────────────────────────────────
  endCall: () => {
    const socket = useAuthStore.getState().socket;
    const { remoteUser } = get();
    if (socket && remoteUser) socket.emit("call:end", { to: remoteUser._id });
    get()._cleanup();
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
    set({
      callState: "incoming",
      callType,
      remoteUser: { _id: from, ...callerInfo },
      _pendingOffer: offer,
      _iceCandidateQueue: [],
    });
  },

  getPendingOffer: () => get()._pendingOffer,

  // ── Timer ─────────────────────────────────────────────────────────────────
  _startDurationTimer: () => {
    const interval = setInterval(() => {
      set((state) => ({ callDuration: state.callDuration + 1 }));
    }, 1000);
    set({ durationInterval: interval, callDuration: 0 });
  },

  // ── Cleanup ───────────────────────────────────────────────────────────────
  _cleanup: () => {
    clearTimeout(ringTimer);
    clearTimeout(disconnectTimer);
    const { localStream, peerConnection, durationInterval } = get();
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (peerConnection) peerConnection.close();
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
      if (fromPeer(from)) get().handleIceCandidate(candidate);
    });
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
  },
}));
