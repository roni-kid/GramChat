// Tiny in-memory rate limiter (no dependency). Fine for a single server process.
export const rateLimit = ({ windowMs, max, key = (req) => req.ip, message = "Too many attempts, try again later" }) => {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let e = hits.get(k);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; hits.set(k, e); }
    e.count++;
    if (e.count > max) {
      res.set("Retry-After", Math.ceil((e.reset - now) / 1000));
      return res.status(429).json({ message });
    }
    next();
  };
};
