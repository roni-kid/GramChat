// Browser side of web push: permission, subscription, and telling the server about it.
// (Kept free of store imports so the auth store can use it on logout without a circular import.)
import { axiosInstance } from "./axios";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

const keyToBytes = (b64url) => {
  const b64 = (b64url + "=".repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const bytesToKey = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// The service worker is only registered in the built app (npm run share / production), not in `npm run dev`.
const getRegistration = async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error("Notifications work in the built app (npm run share), not in dev mode.");
  await navigator.serviceWorker.ready;
  return reg;
};

/** Everything the Settings page needs to explain the current situation. */
export async function getPushStatus() {
  const status = {
    supported: pushSupported(),
    secure: window.isSecureContext,
    needsInstall: isIOS() && !isStandalone(), // iPhone/iPad only allow web push for apps added to the Home Screen
    permission: "Notification" in window ? Notification.permission : "denied",
    subscribed: false,
    preview: false,
  };
  if (!status.supported) return status;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      const { data } = await axiosInstance.get("/push/status", { params: { endpoint: sub.endpoint } });
      status.subscribed = !!data.subscribed;
      status.preview = !!data.preview;
    }
  } catch { /* leave as not subscribed */ }
  return status;
}

/** Asks permission (must be called from a click) and registers this device. Throws an Error with a readable message. */
export async function enablePush(preview = false) {
  if (!pushSupported()) throw new Error("This browser doesn't support push notifications.");
  const { data: server } = await axiosInstance.get("/push/key");
  if (!server.enabled) throw new Error("Push notifications aren't enabled on this server.");

  if (Notification.permission === "denied") throw new Error("Notifications are blocked for this site. Allow them in your browser's site settings.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications weren't allowed.");

  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made for a different server key (e.g. the server's keys were regenerated) can't be reused
  if (sub && sub.options?.applicationServerKey && bytesToKey(sub.options.applicationServerKey) !== server.publicKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub = sub || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(server.publicKey) }));

  try {
    await axiosInstance.post("/push/subscribe", { subscription: sub.toJSON(), preview });
  } catch (e) {
    throw new Error(e.response?.data?.message || "Couldn't register this device with the server.");
  }
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await axiosInstance.post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export async function setPushPreview(preview) {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) throw new Error("This device isn't subscribed.");
  await axiosInstance.put("/push/prefs", { endpoint: sub.endpoint, preview });
}

export const sendTestPush = () => axiosInstance.post("/push/test");

/** Called while the login cookie is still valid, so the next person to use this device doesn't get this account's notifications. */
export async function removePushOnLogout() {
  try {
    if (pushSupported()) await disablePush();
  } catch { /* never block logging out */ }
}
