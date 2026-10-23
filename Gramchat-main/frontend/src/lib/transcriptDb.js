// Phase 2F: transcripts of voice notes are made ON THIS DEVICE (see lib/transcribe.js) and kept ONLY on this device.
// This is the small IndexedDB store for them. Nothing here is ever sent to the server. If IndexedDB is unavailable
// (some private-browsing modes) every call quietly does nothing and transcripts live in memory for the session only.
//
// Transcripts of messages that are set to disappear are NOT stored here (the store keeps them in memory only), so a
// disappearing voice note can't outlive itself as text on a device. Everything here is wiped on logout.
const DB_NAME = "gramchat-transcripts";
const STORE = "items";

let dbPromise = null;
const open = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB not available"));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; }); // allow a later retry
  }
  return dbPromise;
};

const run = async (mode, fn, fallback) => {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    return fallback;
  }
};

export const tGet = (id) => run("readonly", (s) => s.get(id), undefined);
export const tPut = (item) => run("readwrite", (s) => s.put(item), undefined); // { id, text, at }
export const tDelete = (id) => run("readwrite", (s) => s.delete(id), undefined);
export const tClear = () => run("readwrite", (s) => s.clear(), undefined);
