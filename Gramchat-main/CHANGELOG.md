# Changelog

## Unreleased (October 2026 audit & hardening)

### Security (breaking for anyone relying on the old behaviour)
- Sockets now authenticate from the signed login cookie. The client no longer sends or chooses its `userId`; caller name/photo for calls come from the server.
- Group rooms are assigned server-side from membership and revoked on removal; clients can no longer join arbitrary rooms.
- Reactions require being a participant of the DM / a member of the group.
- Removed email addresses from the user list and group payloads; `update-profile`/`check` no longer return the password hash.
- Statuses are visible only to yourself and people you share a chat or group with; the viewer list is owner-only.
- Login is rate-limited (10 per 15 min per IP+email), signup limited; login accepts strings only (blocks operator injection); emails are normalised to lowercase.
- Message/group/status/profile inputs validated (length limits, id validation, hex colours, reply targets must belong to the same conversation).
- Security headers added; JWT secret strength enforced in production; uploads served only to logged-in users with a type allow-list (no SVG/HTML), documents forced to download.

### Changed
- **Cloudinary removed.** Media is stored on local disk (`UPLOAD_DIR`, default `backend/uploads`). Existing messages that point at Cloudinary URLs will still render those URLs.
- Frontend is same-origin everywhere: Vite proxies `/api` and `/socket.io` in dev; `VITE_API_BASE_URL` / `VITE_SOCKET_URL` are now optional overrides.
- Cookie `Secure` flag is `NODE_ENV=production` by default, overridable with `COOKIE_SECURE`.
- Call ICE servers come from `GET /api/calls/ice` (STUN built in; TURN via `TURN_*` env vars).

### Added
- Unread badges, last-message previews and timestamps in the chat list; unread count in the tab title; new users appear live.
- `GET /api/messages/conversations`.
- `npm run share` (free public HTTPS link via Cloudflare quick tunnel), `npm run seed`, `npm run test:api`, `npm run test:ui`.
- `docs/AUDIT.md`, `docs/ROADMAP.md`, `docs/SHARING.md`.
- All 32 themes actually registered (only 2 worked before).

### Fixed
- Presence went offline when one of several tabs closed; live delivery stopped for that user.
- A message arriving while you were sending disappeared until reload.
- Group reactions were not live; group messages for groups you weren't viewing were missed.
- Status viewer progress bars; chat header icon clipping on phones; call "disconnected" ending calls instantly; decorative Speaker button removed.
- Seed users can now log in (hashed passwords, no third-party avatars).
- Lockfiles no longer reference `registry.npmmirror.com`; removed dead config/deps (`tailwind.config.js`, `tsc`, `flowbite`, `@headlessui/react`, `postcss-cli`, `autoprefixer`, `cloudinary`); lint clean; frontend `npm audit` clean.

### Earlier (unreleased, before audit)

- Added a Windows `push-to-github.bat` helper that verifies required clone/setup files, builds the frontend, commits, and pushes the current branch.
- Ignored local Codex attachment folders so screenshots and temporary prompt files are not accidentally committed.
- Added root setup/dev scripts so a fresh clone can install and run backend plus frontend from the project root.
- Added dependency preflight messages for backend and frontend dev scripts when `node_modules` has not been installed.
- Improved auth failure toasts so frontend users see backend connection/setup problems instead of only generic signup/login failures.
- Added a lightweight `/api/health` backend endpoint for local setup checks.
- Added backend environment validation for required auth/database settings.
- Added committed backend and frontend environment examples for ZIP/clone setup.
- Made REST and Socket.io dev endpoints configurable for Android/LAN testing.
- Made backend CORS origins configurable instead of localhost-only.
- Added a dependency-free PWA baseline so Gramchat can be installed from supported Windows and Android browsers.
- Added app manifest metadata, standalone display settings, shortcuts, theme color, and a Gramchat SVG icon.
- Added a frontend service worker that caches shell/static assets while keeping API and Socket.io traffic live.
