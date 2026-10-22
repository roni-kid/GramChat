// 32 random hex characters. crypto.randomUUID() only exists on https/localhost, but getRandomValues also works on a plain-http LAN address.
export const newClientId = () => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};
