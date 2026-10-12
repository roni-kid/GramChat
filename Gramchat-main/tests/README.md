# Tests

End-to-end checks that run against a **live server** (they create throw-away users).

```bash
# 1. start MongoDB, then the app (restart it between runs: signup/login rate limits are per-process)
npm run start --prefix backend            # or: npm run dev

# 2. API + Socket.io checks (auth, DMs, groups, status, calls signalling, media, security)
npm run test:api                          # BASE=http://localhost:5001 by default

# 3. Real-browser UI checks with two simulated users, incl. a WebRTC call (needs: pip install playwright && playwright install chromium)
npm run build --prefix frontend           # the UI test runs against the built app served by the backend
npm run test:ui
```

Two checks are **expected to fail** until the "contacts" model lands (see docs/ROADMAP.md, Phase 1):
`sidebar lists ALL users on the server` and `sender receives its own group message via socket`
(the latter is harmless, the client de-duplicates by message id).
