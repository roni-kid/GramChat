# Gramchat 💬

A private, self-hostable WhatsApp-style messenger: React + Node + MongoDB + Socket.io. You run the server, you own the data.
No Cloudinary, no third-party services, no ads.

> Built by **RoniKid** & **Modestus**. Audit & hardening Oct 2026 (see `docs/AUDIT.md`).
> **Where it's going:** `docs/ROADMAP.md`. **Let a friend on another network use it, free:** `docs/SHARING.md`.

> ⚠️ **Privacy status, honestly:** messages are *not yet end-to-end encrypted*. Whoever runs the server can read them.
> Everything stays on that server (no third parties), but tell your friends. E2EE is Phase 3 of the roadmap.

## Features
- **Messaging:** realtime 1-on-1 chat, typing indicators, read receipts, replies, emoji reactions, in-chat search, unread badges, last-message previews
- **Media:** photos, video, audio and documents stored on *your* disk (login-required to view, type allow-list, size caps)
- **Groups:** admin-managed groups, live member changes, typing, reactions, replies
- **Status:** 24-hour text/photo statuses, visible only to people you share a chat/group with; only you see who viewed
- **Calls:** voice & video (WebRTC), mute/camera, duration, ring timeout; TURN-ready for strict networks
- **App:** installable PWA (Windows / Android), 32 themes, responsive, multi-tab/multi-device presence
- **Security:** cookie-authenticated sockets, per-endpoint authorisation, rate-limited login, validated inputs

## Quick start
Prerequisites: **Node 18+** and **MongoDB** running locally (`mongodb://127.0.0.1:27017`).

```bash
npm run setup          # installs backend + frontend
npm run dev            # backend :5001, frontend :5173  → open http://localhost:5173
```
`backend/.env` is needed (copy `backend/.env.example`, set `JWT_SECRET`). `npm run share` creates one for you.

Optional demo users: `npm run seed` (password for all: `123456`).

### Share it with someone else (free)
```bash
npm run share          # builds, starts in production mode, opens a free public HTTPS link (needs `cloudflared`)
```
Details, limits and calls across networks: **docs/SHARING.md**.

## Project structure
```
backend/src/  controllers · models · routes · middleware (auth, rate limit, validation) · lib (socket, storage, contacts) · seeds
frontend/src/ components · pages · store (zustand: auth, chat, group, status, call) · lib · constants
scripts/      dev.cjs · share.cjs
tests/        api-e2e.mjs (84 checks) · ui-e2e.py (17 checks, real browser)
docs/         AUDIT.md · ROADMAP.md · SHARING.md
```

## Tech stack
| | |
|---|---|
| Frontend | React 19, Vite (rolldown), Zustand, Tailwind CSS 4, DaisyUI 5 |
| Backend | Node.js, Express, Socket.io |
| Database | MongoDB (Mongoose) |
| Media | Local disk (`backend/uploads/`) |
| Calls | WebRTC, STUN built in, optional TURN |
| Auth | bcrypt + JWT in an HttpOnly, SameSite=Strict cookie |

## Troubleshooting
- `'vite' is not recognized` → run `npm run setup`.
- "Cannot reach the server" → is the backend running? Check `http://localhost:5001/api/health`.
- Signup/login 500 → MongoDB not running, or `JWT_SECRET` missing in `backend/.env`.
- "JWT_SECRET is too weak" in production → generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- Camera/mic blocked → browsers need HTTPS (or localhost). Use `npm run share`.
- Logged out immediately over plain http on your LAN → set `COOKIE_SECURE=false` in `backend/.env`.

## Pushing updates (Windows)
`push-to-github.bat "Describe the update"` builds the frontend, commits and pushes. `.gitignore` keeps `.env`, `node_modules`, `dist` and `uploads/` out of Git.

## License
MIT
