# Gramchat audit (October 2026)

Method: read every source file, ran the backend against a MongoDB-compatible database, drove the REST API and
Socket.io with simulated users (`tests/api-e2e.mjs`, 156 checks), and drove the real UI in Chromium with two users,
including a WebRTC call (`tests/ui-e2e.py`, 27 checks). Results before → after:

| Suite | Before | After |
|---|---|---|
| API / Socket.io | 38 / 61 passed (23 real failures) | **155 / 156** (1 expected, see below; includes the Phase 1 tests) |
| Browser UI | 12 / 17 | **27 / 27** |
| Frontend lint | 6 errors, 4 warnings | clean |
| `npm audit` frontend | multiple high | **0** |
| `npm audit` backend | high (brace-expansion, body-parser, …) | 3 high, all in dev-only `nodemon` (npm's suggested fix is a 2017 downgrade) |

## Findings

Severity: **C**ritical (breaks the privacy promise), **H**igh, **M**edium, **L**ow.

| # | Sev | Finding | How it was shown | Status |
|---|---|---|---|---|
| 1 | C | Sockets trusted a client-supplied `userId`. An unauthenticated socket received another user's private DMs and could ring anyone as a forged caller ("Your Bank"). It also stole the victim's socket slot, so the real user stopped receiving messages. | Spy socket with no login, `userId=<victim>` | **Fixed**: sockets authenticate from the signed login cookie; caller name/photo come from the server. |
| 2 | C | Any socket could join any group's room and read its messages. | Non-member emitted `joinGroup`, received group traffic | **Fixed**: server decides rooms from membership; revoked on removal. |
| 3 | C | Any logged-in user could react to any message (DM or group) by id. | Third party got HTTP 200 | **Fixed**: participant / member check. |
| 4 | C | Every account listed for every user, **with email addresses**; statuses (and who viewed them) visible to all users. | Sidebar payload; stranger fetched `/api/status` | **Fixed** (Phase 1): emails removed everywhere; no global directory (people are found only by exact username and must be accepted as contacts); statuses go only to contacts who allow it; viewer list owner-only. |
| 5 | C | Media was uploaded to Cloudinary (third party, needs an account; uploads returned HTTP 500 without keys). | `POST` image → 500 | **Fixed**: local disk storage, login-gated, allow-listed types (no SVG/HTML), server-derived file type, size caps. |
| 6 | H | Messages are stored as plaintext in the database. | Schema | **Open**: end-to-end encryption, ROADMAP Phase 3. Anyone who runs the server can read all messages. |
| 7 | H | `update-profile` returned the bcrypt password hash to the client. | Response body | **Fixed** |
| 8 | H | No login rate limit (25 wrong guesses all accepted). | Scripted guesses | **Fixed** (10 / 15 min per IP+email; signup limited too) |
| 9 | H | Login accepted MongoDB operator objects as `email` (`{"$ne":null}` logged in as the first matching user). | Scripted | **Fixed** (strings only) |
| 10 | M | Emails were case-sensitive (`A@x.com` and `a@x.com` = two accounts). | Scripted | **Fixed** (normalised) |
| 11 | M | Empty messages, 200 KB messages, messages to non-existent users, malformed ids (500) accepted. | Scripted | **Fixed** |
| 12 | M | Closing one of two tabs showed you offline and stopped live delivery. | Scripted two sockets | **Fixed** (per-user rooms) |
| 13 | M | A message arriving while you send one disappeared from the screen until reload (stale state overwrite). | Browser, request delayed in-page | **Fixed** (functional updates, de-dup by id) |
| 14 | M | Group reactions weren't live for other members. | Scripted | **Fixed** |
| 15 | M | Chats you didn't have open produced no unread badge/preview; new users didn't appear until reload. | Browser | **Fixed** |
| 16 | M | 30 of 32 themes did nothing (only light/dark registered with DaisyUI v5); default "coffee" silently fell back to light. | Built CSS inspected; computed colours | **Fixed** (all 32 registered) |
| 17 | M | Both lockfiles pinned ~half the packages to `registry.npmmirror.com`; `npm run setup` fails where that host is unreachable. | `npm install` failed | **Fixed** (official registry URLs) |
| 18 | M | Seeded demo users could never log in (plaintext passwords); seed avatars loaded from a third-party site. | Login attempt | **Fixed** |
| 19 | M | Calls: STUN only, no TURN; a 1-second network blip ended the call; decorative "Speaker" button; no ring timeout. | Code reading (**not** tested across real networks) | **Fixed in code**: server-provided ICE/TURN config, 8 s grace, 45 s ring timeout. Real-world success across networks still needs a TURN relay (docs/SHARING.md). |
| 20 | L | Status viewer progress bars never animated; side-effect inside a state updater. | Code reading | **Fixed** |
| 21 | L | Chat header search icon clipped on narrow phones. | Screenshot | **Fixed** |
| 22 | L | Dead config/deps (`tailwind.config.js` ignored by Tailwind v4, stub `tsc` package, unused flowbite/headlessui). | Code reading | **Removed** |

## Retracted during testing (so you know what *isn't* a bug)

- "Group messages show twice for the sender": the server does echo to the sender, but the UI de-duplicated by accident, so users never saw it. Now de-duplicated on purpose.
- "Chats tab doesn't switch while a group is open": my test script's locator was wrong; the app was fine.
- Several early failures were caused by my test ordering, not by the app; the harness was rewritten so each check stands alone.

## Expected failures in the test suite

1. `sender receives own group message via socket`: harmless, handled client-side (the client de-duplicates by message id).

## Not tested

- Real Cloudflare tunnel (the download host is blocked in my sandbox; script logic tested against a stand-in).
- Calls between two different networks / behind carrier NAT; TURN relay; group calls.
- Real MongoDB (tests ran on FerretDB, a MongoDB-compatible server). Queries used are standard, but run the suite once on your MongoDB.
- iOS Safari, Firefox, installed-PWA behaviour, push notifications (not implemented).
- Load / many concurrent users. The in-memory rate limiter and socket rooms assume a single server process.
