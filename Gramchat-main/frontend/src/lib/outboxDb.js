// Phase 2C: a tiny IndexedDB wrapper that keeps unsent messages across reloads and browser restarts.
// (Attachments are data URLs of up to ~27 MB, far beyond what localStorage can hold.)
// If IndexedDB is unavailable (some private-browsing modes) every call quietly does nothing and the queue lives in memory only.
const DB_NAME = "gramchat-outbox";
const STORE = "items";

let dbPromise = null;
const open = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB not available"));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientId" });
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

export const dbAll = () => run("readonly", (s) => s.getAll(), []);
export const dbPut = (item) => run("readwrite", (s) => s.put(item), undefined);
export const dbDelete = (clientId) => run("readwrite", (s) => s.delete(clientId), undefined);
export const dbClear = () => run("readwrite", (s) => s.clear(), undefined);
