# Tests

End-to-end checks that run against a **live server** (they create throw-away users).

```bash
# 1. start MongoDB, then the app (restart it between runs: signup/login rate limits are per-process;
#    for the API suite also set SIGNUP_LIMIT_PER_HOUR=500 because it creates ~20 accounts)
npm run start --prefix backend            # or: npm run dev

# 2. API + Socket.io checks (auth, DMs, groups, status, calls signalling, media, security)
npm run test:api                          # BASE=http://localhost:5001 by default

# 3. Real-browser UI checks with two simulated users, incl. a WebRTC call (needs: pip install playwright && playwright install chromium)
npm run build --prefix frontend           # the UI test runs against the built app served by the backend
npm run test:ui
```

One check is **expected to fail**: `sender receives its own group message via socket`
(harmless: the client de-duplicates by message id).

## Phase 2A suite

`npm run test:api:2a` (file `tests/phase2a-e2e.mjs`) covers delivered ticks, edit, delete for me / for everyone,
star, pin, forward and their group variants, including authorisation (outsiders get 404) and that private
arrays (`starredBy`, `deletedFor`) never reach clients. It needs the same live server, and the same
"restart between runs + `SIGNUP_LIMIT_PER_HOUR=500`" rule. It does **not** cover the 15 min / 48 h time limits
(that needs back-dated messages); and there is no browser test for the new UI yet.

## Phase 2B suite

`npm run test:api:2b` (file `tests/phase2b-e2e.mjs`) covers voice notes (type/size/duration rules, forwarding, delete,
groups) and push subscription handling (allow-listed hosts only, SSRF look-alikes rejected, per-account
ownership, 10-device cap). It never sends a real push. The first push check fails with a clear hint if
`web-push` isn't installed. `tests/ui-e2e.py` now also records a voice note with Chromium's fake microphone.

**Not automated, test by hand on a real device over https (`npm run share`):** a notification actually arriving
with the app closed, tapping it opening the right chat, the text-preview toggle, logout stopping notifications,
and voice-note playback across browsers (a note recorded on Chrome played on an iPhone, and the reverse).

## Phase 2D suite

`npm run test:api:2d` (file `tests/phase2d-e2e.mjs`) covers link previews, search across chats, the media gallery and
pin / archive / mute for chats. Same live-server rules as the other suites (restart between runs,
`SIGNUP_LIMIT_PER_HOUR=500`).

Link previews need the server to fetch a little website that the test starts on **your own machine**, which the
SSRF guard normally forbids, so the suite has two modes. Run both:

```bash
# 1. normal server  ->  proves the guard holds (a link to 127.0.0.1 is never fetched, no card appears)
npm run start --prefix backend
npm run test:api:2d

# 2. restart the server with the guard's test switch, and tell the suite  ->  proves cards are built, stored,
#    edited, deleted and forwarded correctly (macOS/Linux: LINK_PREVIEW_ALLOW_PRIVATE=1 npm run start --prefix backend)
#    Windows PowerShell:
$env:LINK_PREVIEW_ALLOW_PRIVATE="1"; npm run start --prefix backend
#    ...in another window:
$env:ALLOW_PRIVATE="1"; npm run test:api:2d
```

**Never run a real server with `LINK_PREVIEW_ALLOW_PRIVATE=1`**; it exists only for this test (the server prints a warning).
The parser and the address guard (IPv4 / IPv6 / mapped / numeric tricks) are also tested directly, without a server.

Not covered: a push notification being skipped for a muted chat (needs a real push subscription; check by hand over
https), and there is no browser test yet for the new screens (Archived row, the ⋯ chat menu, search results, the gallery
and its viewer, the link card). Quick manual pass: send yourself a link from a second account; pin, archive and mute a
chat and reload the page; search a word you know exists in an old chat and tap the result.

## Phase 2E suite

`npm run test:api:2e` (file `tests/phase2e-e2e.mjs`) covers disappearing messages (timer rules and permissions, expiry stamped
on new messages only, forwarding into a chat with a timer) and view-once media (photo, video, voice note; 1:1 and groups;
that no payload, history, gallery or search ever contains the media; open / re-open / close / wipe; signed links bound to
one person; what can't be done to a view-once message). Same live-server rules as the other suites.

**Watching a message actually expire** needs a short timer, which a real server must never allow, so there is a second mode:

```bash
# 1. normal server  ->  everything except real expiry (it also proves a 5-second timer is refused)
npm run start --prefix backend
npm run test:api:2e

# 2. restart with the test switches, and tell the suite  ->  messages vanish after 5 s, files are deleted, chats are told
#    Windows PowerShell:
$env:DISAPPEAR_ALLOW_SHORT_TIMERS="1"; $env:DISAPPEAR_SWEEP_SECONDS="2"; $env:SIGNUP_LIMIT_PER_HOUR="500"; npm run start --prefix backend
#    ...in another window:
$env:SHORT="1"; npm run test:api:2e
```

**Never run a real server with `DISAPPEAR_ALLOW_SHORT_TIMERS=1`** (it prints a warning).

Not covered: the 6-minute "opened but never closed" and 14-day "never opened" wipes (too long to wait; they use the same wipe
code as "close"), and there is no browser test for the new screens. Quick manual pass with two accounts: set 24 hours in a chat
and check the timer icon and the other person's toast; send a view-once photo, open it on the other account, close it, and
check both sides now say *Opened* and the sender can't open it; try Reply / Forward on it (they should be missing); send a
view-once voice note.
