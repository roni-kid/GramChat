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

Working and tested: email accounts, realtime 1:1 chat, read receipts, replies, reactions, in-chat search, groups with an admin, status/stories (24 h), voice & video calls (WebRTC, STUN), installable PWA, light/dark + 30 themes, unread badges and previews, local file storage, server-side authentication of sockets and groups.

Known gaps: global user directory (no contacts), no E2EE, no push notifications, no TURN by default, single-process server, MongoDB required.

---

## 3. Feature parity map

WhatsApp column reflects Meta's announcements and coverage through mid-2026 (official Meta posts where possible; some items from secondary blogs, marked †).

| Capability | WhatsApp | Gramchat today | Phase |
|---|---|---|---|
| **Identity** | | | |
| Sign up without a phone number (usernames) | Rolling out 2026 | Email + password | 1 |
| Contacts / invite-only discovery | Address book | ❌ everyone is listed | 1 |
| Block, report, mute, archive, pin chats | ✅ | ❌ | 1–2 |
| Privacy controls (last seen, photo, status, who can add me to groups) | ✅ | ❌ | 1 |
| Passkeys / 2-step verification | ✅ | ❌ | 1 |
| **Messaging** | | | |
| Text, emoji, replies, reactions | ✅ | ✅ | done |
| Sent / delivered / read ticks | ✅ | sent / read | 2 |
| Edit message, delete for me / for everyone | ✅ | ❌ | 2 |
| Forward, star, pin messages | ✅ | ❌ | 2 |
| Voice notes (+ transcripts) | ✅ | ❌ (can attach audio files) | 2 |
| Photos, video, documents | ✅ | ✅ (20 MB cap) | done |
| HD media, captions, image editing | ✅ | ❌ | 2 |
| Link previews | ✅ | ❌ | 2 (client-side or SSRF-safe proxy) |
| Disappearing messages (24 h / 7 d / 90 d), view-once, "Keep" | ✅ | ❌ | 2 |
| Polls, @mentions, scheduled events | ✅ | ❌ | 2–5 |
| Search across all chats, media gallery | ✅ | per-chat only | 2 |
| Drafts, offline queue + retry | ✅ | ❌ | 2 |
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
| Push notifications | ✅ | ❌ (tab title only) | 2 |
| Multiple accounts on one device | ✅ (2026) | ❌ | 6 |
| Chat transfer between phones, storage manager | ✅ (2026) | ❌ | 6 |
| **AI** | Meta AI: writing help, photo touch-up, imagine† | none, by design | optional, on-device only |

Deliberately **not** copied: ads in Status, promoted channels, AI features that send your text to a vendor.

---

## 4. Phases

### Phase 0: Make it safe and honest ✅ done
Authenticated sockets, authorised reactions/groups, scoped statuses, no emails exposed, local media, rate limits, validation, race-condition and presence fixes, working themes, reliable install. See `docs/AUDIT.md`.

### Phase 1: Identity and contacts (next)
- Usernames (unique, case-insensitive) as the public identity; email optional (recovery only) *(depends on decision A below)*.
- Contacts model: you only see people you added or who you accepted; invite by username / link / QR. Remove the global directory.
- Block, report, mute; privacy settings (who sees photo, status, online/last seen); per-account contact-request limits.
- Account recovery; session list + "log out other devices"; optional passkeys.
- **Acceptance:** a new account sees nobody; B can't discover or message A until A accepts; blocked users can't message/call/see status; statuses/online state follow privacy settings; both currently-expected test failures flip to pass.

### Phase 2: Messaging parity
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
- **A. Identity:** usernames only (recommended: free, private) vs phone numbers (SMS costs money and links identity to phone).
- **B. Privacy depth:** go straight to E2EE (Phase 3 first), or finish contacts/messaging parity first? E2EE changes how search, media, groups and multi-device work, so earlier is cheaper than later.
- **C. Compatibility:** may we make breaking changes to the data model, or must it stay mergeable with the original repo?
- **D. First deployment:** who connects remotely, on what device, and is your PC acceptable as the server for now?
- **E. Database:** keep MongoDB (needs install) or move to an embedded database for one-click setup?

## 7. What's verified vs assumed (as of Oct 2026)
**Verified by running it:** everything in Section 2. **Researched, not built:** tunnel behaviour, TURN free tiers (Metered 20 GB/mo; Cloudflare 1,000 GB/mo advertised), E2EE library landscape, WhatsApp's 2026 feature list. **Assumed, check before relying on it:** push on iOS PWAs, current Cloudflare/Metered terms, legal requirements for hosting other people's data.
