# Gramchat: the goal

> **A messenger that matches what people actually use WhatsApp for, while you (not a corporation) control the server and the data.**
> Free to run. No phone number required. No ads. Private by design, and provably so once end-to-end encryption lands.

This is the document to aim at. Each phase has **acceptance tests**: a phase isn't done until they pass.

---

## 1. Honest positioning (read this before writing marketing)

What Meta says (WhatsApp FAQ and coverage, researched Oct 2026): ordinary WhatsApp chats and calls are end-to-end
encrypted, "not even WhatsApp or Meta" can read them; Meta AI only sees messages addressed to it, and those *may* be used
to improve its models. Metadata (who/when/how often) is not hidden from Meta.

So **"WhatsApp feeds your chats to Meta's AI" is not supported by Meta's own statements, and shouldn't be Gramchat's pitch.**
What Gramchat can truthfully offer:

| Gramchat advantage | True today? |
|---|---|
| You choose who runs the server; your data stays on it | ✅ |
| No ads, no AI features reading your data, no phone-number requirement | ✅ (email today; usernames planned) |
| Metadata never goes to a big platform | ✅ |
| Open source, auditable | ✅ |
| Server operator **cannot** read messages | ❌ **not yet.** Phase 3. Until then, whoever hosts it can read everything. |

Gramchat is currently *less* private than WhatsApp **for message content** and *more* private for **metadata and ownership**.
Closing that first gap is the single most important engineering goal.

---

## 2. Where we are (after the Oct 2026 hardening, see `docs/AUDIT.md`)

Working and tested: username accounts, contacts with requests and blocking, privacy settings (online, read receipts, status audience), realtime 1:1 chat, read receipts, replies, reactions, in-chat search, groups with an admin, status/stories (24 h), voice & video calls (WebRTC, STUN), installable PWA, light/dark + 30 themes, unread badges and previews, local file storage, server-side authentication of sockets and groups.

Known gaps: no E2EE, no push notifications, no TURN by default, single-process server, MongoDB required.

---

## 3. Feature parity map

WhatsApp column reflects Meta's announcements and coverage through mid-2026 (official Meta posts where possible; some items from secondary blogs, marked †).

| Capability | WhatsApp | Gramchat today | Phase |
|---|---|---|---|
| **Identity** | | | |
| Sign up without a phone number (usernames) | Rolling out 2026 | ✅ usernames (phone numbers optional later) | done |
| Contacts / invite-only discovery | Address book | ✅ exact-username search + requests | done |
| Block, report, mute, archive, pin chats | ✅ | block done; mute / archive / pin chats built (2D); report not yet | 1.5–2 |
| Privacy controls (last seen, photo, status, who can add me to groups) | ✅ | online, read receipts, status audience done; photo / last seen / group-add not yet | 1.5 |
| Passkeys / 2-step verification | ✅ | ❌ | 1 |
| **Messaging** | | | |
| Text, emoji, replies, reactions | ✅ | ✅ | done |
| Sent / delivered / read ticks | ✅ | ✅ in 1:1 chats (groups: no per-member ticks yet) | done (2A) |
| Edit message, delete for me / for everyone | ✅ | ✅ edit 15 min, delete-for-everyone 48 h | done (2A) |
| Forward, star, pin messages | ✅ | ✅ forward to ≤5 chats, private stars + list, ≤3 pins per chat | done (2A) |
| Voice notes (+ transcripts) | ✅ | ✅ voice notes built (2B); transcripts not | done (2B) |
| Photos, video, documents | ✅ | ✅ (20 MB cap) | done |
| HD media, captions, image editing | ✅ | ❌ | 2 |
| Link previews | ✅ | ✅ built (2D): server-side, SSRF-guarded | done (2D) |
| Disappearing messages (24 h / 7 d / 90 d), view-once, "Keep" | ✅ | ✅ built (2E): 24 h / 7 d / 90 d and view-once photo / video / voice; no "Keep" yet | done (2E) |
| Polls, @mentions, scheduled events | ✅ | ❌ | 2–5 |
| Search across all chats, media gallery | ✅ | ✅ built (2D): chat-list search + Media / Docs / Links gallery | done (2D) |
| Drafts, offline queue + retry | ✅ | ✅ built (2C): queue survives reloads, no duplicates | done (2C) |
| Locked / hidden chats | ✅ | ❌ | 2 |
| **Encryption & safety** | | | |
| End-to-end encryption by default | ✅ Signal protocol | ❌ | **3** |
| Encrypted backups, safety-number verification | ✅ | ❌ | 3 |
| Anti-spam limits on contacting new people | ✅ | login/signup rate limits only | 1 |
| **Groups** | | | |
| Create, add/remove, admin | ✅ | ✅ (1 admin) | done |
| Multiple admins, roles, invite links, approval | ✅ | ❌ | 5 |
| Member tags, text stickers, event reminders, "online now" | ✅ (2026) | online count only | 5 |
| Communities / Channels | ✅ | ❌ | 5 (optional) |
| **Calls** | | | |
| 1:1 voice / video | ✅ | ✅ (needs TURN for many networks) | 4 |
| Group calls, screen share, call history, call links | ✅ (web calling & screen share 2026) | ❌ | 4 |
| **Status** | | | |
| 24 h text/photo | ✅ | ✅ (scoped to your contacts) | done |
| Video status, replies, per-status audience, link previews | ✅ | ❌ | 5 |
| **Platform** | | | |
| Web, desktop, mobile apps | ✅ | PWA | 4–6 |
| Multi-device (up to 4 linked) | ✅ | multi-tab works | 3 (needs E2EE design) |
| Push notifications | ✅ | ✅ built (2B), needs https | done (2B) |
| Multiple accounts on one device | ✅ (2026) | ❌ | 6 |
| Chat transfer between phones, storage manager | ✅ (2026) | ❌ | 6 |
| **AI** | Meta AI: writing help, photo touch-up, imagine† | none, by design | optional, on-device only |

Deliberately **not** copied: ads in Status, promoted channels, AI features that send your text to a vendor.

---

## 4. Phases

### Phase 0: Make it safe and honest ✅ done
Authenticated sockets, authorised reactions/groups, scoped statuses, no emails exposed, local media, rate limits, validation, race-condition and presence fixes, working themes, reliable install. See `docs/AUDIT.md`.

### Phase 1: Identity and contacts ✅ core done (Oct 2026)
**Shipped:** usernames, exact-username search, contact requests (accept / decline / cancel / remove), blocking (invisible to the blocked person), contacts-only messaging, calls, typing, groups and status, presence limited to contacts, privacy settings (show online, read receipts, status audience), automatic migration of existing accounts and conversations. Tests: 156 API checks + 27 browser checks.
**Still open (Phase 1.5):** account recovery, session list / log out other devices, passkeys, report user, mute / archive / pin, profile-photo and last-seen privacy, retiring the legacy email login.

Original plan, for reference:
- Usernames (unique, case-insensitive) as the public identity; email optional (recovery only) *(depends on decision A below)*.
- Contacts model: you only see people you added or who you accepted; invite by username / link / QR. Remove the global directory.
- Block, report, mute; privacy settings (who sees photo, status, online/last seen); per-account contact-request limits.
- Account recovery; session list + "log out other devices"; optional passkeys.
- **Acceptance:** a new account sees nobody; B can't discover or message A until A accepts; blocked users can't message/call/see status; statuses/online state follow privacy settings; both currently-expected test failures flip to pass.

### Phase 2: Messaging parity
**2A ✅ built (Oct 2026), awaiting your test run:** delivered ticks, edit, delete for me / for everyone, forward, star (+ Starred list), pin (≤3 per chat). API checks: `npm run test:api:2a`. Not yet browser-tested.
**2B ✅ built (Oct 2026), awaiting your test run:** voice notes and push notifications. API checks: `npm run test:api:2b`. Needs `npm run setup` once (new `web-push` package) and the https link (`npm run share`) to try on a phone.
**2E ✅ built (Oct 2026), awaiting your test run:** disappearing messages (24 h / 7 d / 90 d per chat; admin-only in groups) and view-once photos, videos and voice notes. API checks: `npm run test:api:2e` (two modes, see `tests/README.md`). Not yet run or browser-tested; a screenshot can't be prevented (see the changelog).
**2F ✅ built (Oct 2026), awaiting your test run:** group per-member ticks with a "Message info" panel, voice-note waveforms, on-device voice-note transcripts (optional: `npm run setup:transcripts`), and "Keep" for disappearing messages. API checks: `npm run test:api:2f`. Not yet run or browser-tested; the transcript engine is the least certain part (see the changelog).
**Still open in Phase 2:** HD media / captions / image editing, locked chats.
**2D ✅ built (Oct 2026), awaiting your test run:** link previews (server-side, SSRF-guarded), cross-chat search, media / docs / links gallery, pin (≤3) / archive / mute for chats. API checks: `npm run test:api:2d` (two modes, see `tests/README.md`). Not yet browser-tested.
**2C ✅ built (Oct 2026), awaiting your test run:** drafts, offline send queue with retry (no duplicates: idempotent `clientId`), infinite scroll (also jumps to old pins). API checks: `npm run test:api:2c`. Not yet browser-tested.

Full Phase 2 scope:
Delivered ticks, edit, delete (me/everyone), forward, star, pin, voice notes, link previews, disappearing + view-once, drafts, offline queue, cross-chat search, media gallery, archive/pin chats, infinite scroll (API already paginates), **web push** (needs a VAPID key pair and a service-worker push handler; iOS requires the app installed to the home screen: verify against current Apple docs before promising it).
- **Acceptance:** every item has an API test and a browser test; killing the network mid-send queues and retries without duplicates; push arrives with the tab closed on Android Chrome.

### Phase 3: End-to-end encryption (the headline goal)
Approach (research, Oct 2026): WhatsApp uses the **Signal protocol**; groups at scale are moving to **MLS (RFC 9420)**, with open JS/WASM/Rust libraries (e.g. `libsignal`, `ts-mls`, `openmls`; Signal's team helped design MLS). **Do not write our own cryptography**: pick an audited library.
- Per-device identity keys; server stores only public prekeys and ciphertext.
- 1:1 via Signal-style double ratchet; groups via MLS (or sender keys as an interim); media encrypted client-side (random key travels inside the encrypted message); encrypted search index stays on-device.
- Safety-number / QR verification; encrypted backups with a user-held key; multi-device via per-device keys.
- Known limit of *web* E2EE: the server delivers the JavaScript, so a malicious operator could ship altered code. Mitigations: installable/signed app shells (Phase 6), subresource integrity, reproducible builds, being upfront in the UI. State this plainly to users.
- **Acceptance:** a test dumps the whole database + uploads folder and greps for plaintext of sent messages and finds none; a server-side tamper test (swap ciphertexts) is detected; verification screen matches on both devices.

### Phase 4: Calls
- TURN: mint short-lived credentials (Cloudflare Realtime TURN or coturn) instead of static ones; relay is already supported through env vars.
- Group calls: small mesh (≤4) first, then a self-hosted SFU when needed. Screen share, call history/missed calls, call links, in-call reactions.
- Calls stay encrypted (WebRTC uses DTLS-SRTP; TURN only relays encrypted packets); show the verification code in-call.
- **Acceptance:** a call connects between two real devices on different networks (one on mobile data); automated test with relay-only ICE policy.

### Phase 5: Groups and Status depth
Multiple admins/roles, invite links, join approval, member tags, event reminders, mentions, polls; status audience lists, video status, replies. Channels/Communities only if there's demand.

### Phase 6: Going global
- **Packaging:** `docker compose up` (app + database + optional coturn); SQLite/embedded option so non-developers don't need MongoDB (FerretDB-on-SQLite already worked in testing).
- **Hosting free→cheap:** home PC + Cloudflare tunnel (today) → named tunnel with a domain → small VPS. Object storage (MinIO/S3-compatible) for media; Socket.io Redis adapter + sticky sessions once more than one process.
- **Operations:** automated backups, health checks, structured logs, abuse reporting/moderation tools, rate limits, CSP header, dependency scanning in CI, terms/privacy policy appropriate to the countries you serve (get legal advice).
- **Apps:** Capacitor (Android/iOS) / Tauri (desktop) shells for reliable push and background delivery.
- **Beyond WhatsApp (ideas, not promises):** multi-server federation, export-all-my-data, on-device translation/transcription, scheduled messages, per-chat custom retention, multiple accounts, open protocol docs.

---

## 5. Quality gates (every phase)
1. `npm run test:api` and `npm run test:ui` green (new features add tests *before* merge).
2. Frontend lint clean; `npm audit` has no high issues in production dependencies.
3. Authorisation rule: **every** endpoint and socket event checks the caller is a participant. Add a test per new endpoint.
4. No third-party network calls from the client at runtime (fonts, avatars, analytics, CDNs) unless the user opts in.
5. Update `docs/AUDIT.md` with anything found.

## 6. Open decisions (need the owner's answer)
- **A. Identity: decided.** Usernames first; phone numbers later as an optional extra.
- **B. Order: decided.** Core functionality first, encryption after (owner's words: "do all functionalities before features"). Keep the message format ready for ciphertext so it isn't a rewrite.
- **C. Compatibility:** assumed free to change (the project is the owner's). Confirm if it must stay mergeable with the original repo.
- **D. First deployment:** laptop as the server, phone on the same router (`npm run share -- --lan`).
- **E. Database:** keep MongoDB (needs install) or move to an embedded database for one-click setup?

## 7. What's verified vs assumed (as of Oct 2026)
**Verified by running it:** everything in Section 2. **Researched, not built:** tunnel behaviour, TURN free tiers (Metered 20 GB/mo; Cloudflare 1,000 GB/mo advertised), E2EE library landscape, WhatsApp's 2026 feature list. **Assumed, check before relying on it:** push on iOS PWAs, current Cloudflare/Metered terms, legal requirements for hosting other people's data.
