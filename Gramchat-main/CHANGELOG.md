# Changelog

## Unreleased: Phase 2F, group ticks, voice waveforms and transcripts, Keep (October 2026)

**One optional install step** (only for transcripts, see below); everything else needs only a backend restart. No migration.

### Added
- **Per-member ticks in groups.** Your own group messages now show ✓ Sent, ✓✓ Delivered and ✓✓ Seen like 1:1 chats, with the numbers while it is partial ("Delivered to 2 of 4", "Delivered · seen by 3"). *Delivered* means every other member's device has received it; *Seen* means everyone who shares read receipts has read it. Tap the ticks (or ⋯ → *Message info*) to see who read it and when, who only received it, and who hasn't got it yet; it updates live.
  - Receipts are reciprocal and private, like in 1:1 chats: someone with **read receipts off** never shows as having read anything (they appear under "Delivered to") and doesn't hold up "Seen"; if **you** have them off you see no read information at all (delivery is still shown). Which members have them off is never revealed.
  - How it works: a group message records who received it (`deliveredTo`: members online when it is sent, plus anyone whose device connects later, for the last 30 days) and who read it (`readBy`: when they open the group or it arrives while they're looking at it, via `PUT /api/groups/:groupId/read`). Those lists never leave the server; senders get counts (`ticks`) and `groupReceipt` socket events with absolute numbers.
- **Voice-note waveforms.** The sender's app measures the recording (48 bars) and sends it with the note, so everyone sees the same bars immediately; tap or drag to seek, arrow keys jump 5 s. Notes without one (older ones, or a browser that can't decode the recording) keep the plain slider. A malformed waveform is ignored, never rejected. Forwarded notes keep theirs; view-once notes carry none.
- **Voice-note transcripts, on this device only.** Optional and off by default: each person turns it on in *Settings → Voice-note transcripts*, and a **Transcribe** button then appears on voice notes. A Whisper speech model runs inside the browser (a Web Worker); the audio never leaves the device and **nothing is sent to any server or third party, including this one**. The text is kept on this device only (IndexedDB), is wiped on logout, is **not** kept for messages that are set to disappear, and is dropped when its message is deleted or expires.
  - It needs a one-time setup by the person running the server: `npm run setup:transcripts` (optionally `-- Xenova/whisper-base` for better accuracy, about 80 MB instead of 40), then `npm run build` and restart. That script installs the pinned `@huggingface/transformers@3.8.1` into `frontend/node_modules` **without changing package.json or the lockfile**, copies the runtime and WebAssembly files to `frontend/public/vendor/transcribe/`, downloads the model from huggingface.co into `frontend/public/models/` (the only time anything is fetched), and writes `frontend/public/models/transcribe.json`. All of that is git-ignored and eslint-ignored. At run time everything is loaded from your own server: remote model downloads are switched off in the worker.
  - Until that is done the setting says it isn't available and nothing else changes. The worker is a plain static file (`frontend/public/transcribe-worker.js`), not part of the app bundle, so the app builds and runs the same with or without it. To remove the feature, delete `frontend/public/vendor` and `frontend/public/models`.
- **Keep.** In a chat with disappearing messages, anyone in the chat can *Keep message* on a message that is set to disappear: it then stays (no expiry, a bookmark icon shows on it), and everyone is told (a toast names who kept it, so the sender can see). Un-keep: the person who kept it, or the message's sender. After un-keeping, the message goes back to the chat's *current* rule: a fresh countdown from the chat's timer now, or it simply stays if the timer has been turned off since. View-once messages and deleted messages can't be kept.
- Endpoints: `PUT /api/groups/:groupId/read`, `GET /api/messages/info/:id` (group message, sender only), `PUT /api/messages/keep/:id` `{ kept }`. Socket events: `groupReceipt` (`{ groupId, updates: [{ messageId, ticks }] }`), `messageKept` (`{ messageId, keptBy|null, expiresAt|null, by, groupId? }`).
- `npm run test:api:2f` (new file `tests/phase2f-e2e.mjs`, see `tests/README.md`).

### Changed
- The sweeper now deletes an expired message only if it is *still* expired at that moment, so a message kept during a sweep survives.
- Settings → Read receipts now mentions groups.

### Fixed (found in a read-through of the 2E and 2F code)
- A group message you **forward** now shows its ticks straight away. Before, the forwarder's screen stayed on "✓ Sent" until someone read it, because the answer to a forward is only a summary and the socket copy carried no tick counts.
- A group message sent from another tab or device of yours also gets its ticks straight away (same cause).
- The sender's private idempotency key (`clientId`) was included in the live group broadcast, so every member received it. It now goes only to the sender's own devices, as `forViewer` always intended. (Harmless in practice, since a key only works for its own sender, but it should never have left the sender.)

### Known limits
- **Not run yet.** As before, I could write and read the code but not start your server or browser from here: nothing has been executed, not even a build or lint pass. Do this first: `npm run build --prefix frontend`, `npm run lint --prefix frontend`, restart the backend, `npm run test:api:2f` (both modes for the Keep-survives-expiry check, see `tests/README.md`), and click through a group with three accounts.
- **Transcripts are the least certain part.** The model runtime is loaded in a way I could not test (a static module worker, the runtime's WebAssembly files from `/vendor/transcribe/`, the model from `/models/`). If *Transcribe* shows an error, open the browser console, and check that `frontend/public/vendor/transcribe/` has `transformers.min.js` plus `ort-wasm*` files and `frontend/public/models/<model>/` has `config.json` and an `onnx` folder. Safari and older phones may decode or run slower or not at all. A 5-minute note on the tiny model can take a minute or more on a laptop, longer on a phone. Transcripts can be wrong (names, noise, accents), and the models sometimes invent a word or two for silence.
- Group ticks: messages from before this update show "✓ Sent" until members' devices reconnect (the last 30 days are then marked delivered; reads before this update are unknown). A member who left the group stops counting. Very large first-time catch-ups (a member opening a group with thousands of unread messages) send the senders a burst of tick updates.
- If someone turns read receipts off and later on again, reads recorded in between become visible again.
- Keep has no "keep for me only" and no chat line saying who kept what (a toast, and the bookmark icon).
- Waveforms are drawn from the recording on the sender's device after it is made; they reflect volume, not words.

## Unreleased: Phase 2E, disappearing messages and view-once (October 2026)

**Nothing to install and no migration** (the message, group and contact models already had the fields). Restart the backend: it now starts a background sweeper.

### Added
- **Disappearing messages.** Pick 24 hours, 7 days or 90 days for a chat and every NEW message in it is deleted for everyone, files included, when its time is up. Messages already in the chat keep what they had, and changing the timer later never changes an existing message. 1:1 chats: either person can change it (⋯ → *Disappearing messages*); groups: only the admin (timer button in the group header). The other side gets a toast saying who changed it, the header shows the timer, and each message that will disappear carries a small timer icon (hover for the date). A forwarded copy lives by the timer of the chat it is forwarded INTO.
  - Two layers keep "gone" reliable: every list, search, gallery, pin and star query hides an expired message immediately, and a sweeper (every 30 s) deletes the rows and their files, repairs a group's last-message preview, and sends `messagesExpired` to the open chats.
- **View-once** photos, videos and voice notes. Attach one photo or video, or record a voice note, and switch on **View once** (the dashed "1" button; not available with a caption or a reply). The recipient sees a placeholder, taps it, and the media opens full screen; closing it deletes the file from the server. The sender only ever sees a status: *Not opened yet / Opened / Expired*, and in a group *Opened by N*.
  - The media URL is **never** in a message payload, a notification, search, the gallery or a forwarded copy. The file is stored under a `v…` name that the normal upload route refuses; opening asks `POST /api/messages/view-once/:id/open`, which records the view and returns a link signed for that one person that works for 5 minutes (`Cache-Control: no-store`, Range requests work for video).
  - 1:1: the file is deleted the moment the recipient closes it. Groups: each member can open it once; the file is deleted when everyone else has opened and closed it. Safety nets (sweeper): 6 minutes after the last needed person opened it even if nobody pressed close, and 14 days after sending if it was never opened.
  - A view-once message can't be replied to (a quote would leak it), forwarded, copied, starred, pinned or edited; it can be deleted (for me, or for everyone while within 48 h, which also deletes the file). Reactions are allowed.
  - Re-opening: only while your first link is still valid and you haven't closed it (so a page reload in the middle of watching doesn't burn it).
- Endpoints: `GET /api/chats/timers`, `PUT /api/chats/timer/user/:id` `{ seconds }`, `PUT /api/groups/:groupId/disappearing` `{ seconds }`, `POST /api/messages/view-once/:id/open`, `POST /api/messages/view-once/:id/close`, `GET /api/uploads/view-once/:token`.
- Socket events: `chatTimer` (`{ kind, id, seconds, by }`), `messagesExpired` (`{ messageIds, groupId? }`), `messageViewed` (`{ messageId, viewCount? | viewedByMe?, groupId? }`), `messageViewWiped` (`{ messageId, groupId? }`).
- `npm run test:api:2e` (new file `tests/phase2e-e2e.mjs`, see `tests/README.md`).
- Optional `.env` test switches `DISAPPEAR_ALLOW_SHORT_TIMERS=1` and `DISAPPEAR_SWEEP_SECONDS=2` (test suite only, see `tests/README.md`).

### Changed
- Message payloads for view-once messages carry `viewOnce`, `viewOnceKind`, `viewOnceState` (`unopened | opened | expired`), `viewedByMe` and (sender only) `viewCount`, and never `image`, `fileUrl`, `fileName` or `text`.
- Push notifications for view-once messages say "View-once photo / video / voice message".
- Chat-list previews show "👁 View-once photo" etc.

### Security notes
- Link tokens are HMAC-signed (key derived from `JWT_SECRET`, separate from the login key), bound to one user and one file, and expire after 5 minutes. A token is useless to anyone else even if it leaks, and the by-name upload route refuses view-once files.
- `DISAPPEAR_ALLOW_SHORT_TIMERS=1` allows a 5-second timer **for the test suite only**. Never set it on a real server (it logs a warning when used).

### Known limits
- **Not run yet.** As with 2D, I could write and read the code but not start your server or browser from here: nothing has been executed, not even a build or lint pass. Do this first: `npm run build --prefix frontend`, `npm run lint --prefix frontend`, then `npm run test:api:2e` (both modes, see `tests/README.md`) and a click-through with two accounts. There is no browser test for the new screens.
- **View-once can't stop a screenshot, a screen recording, a photo of the screen, or a modified client that saves the file while its link is valid.** The viewer only removes the easy ways (no download button, no right-click menu, no drag, no re-open, no forward). The same is true of disappearing messages: they are deleted from your server, but anyone in the chat could have copied them first. Backups of your database or uploads folder made before a message expired still contain it.
- Disappearing messages are not retroactive, there is no "keep this message" option, and starred or pinned messages disappear like any other.
- Turning the timer on or off doesn't add a line to the chat (the other person gets a toast, and the header shows it), so someone who was offline sees only the header indicator.
- An unopened view-once message that expires after 14 days shows as "Expired" to the recipient.
- The viewer for a view-once video uses the browser's player; Safari/iOS may show its own controls.
- Messages that disappear while a message that quotes them is still on screen keep the quote until the chat is reloaded.

## Unreleased: Phase 2D, link previews, search, media gallery, pin / archive / mute (October 2026)

**Nothing to install. Restart the backend once so MongoDB builds the index for the new chat-settings collection.**

### Added
- **Link previews.** Send a message with a link and, a moment later, a card appears under it with the page's title, description and picture. The **server** fetches the page (never anyone's phone), so the linked site only ever sees your server's address, the sender can't forge a card, and the picture is stored on your own disk and served like any other upload. The message is delivered immediately; the card follows as a `messagePreview` socket event. Editing the link replaces the card (editing it away removes it), deleting for everyone removes it and its picture, forwarding copies it. Settings → Privacy → **Link previews** turns it off for the links you send.
- **Search across all chats.** The chat-list search box now also searches message text and file names in every 1:1 chat with a current contact and every group you are in, newest first, with the match highlighted. Tap a result: the chat opens and scrolls to that message (loading older messages if needed) and flashes it. Chats and groups can still be found by name; archived ones are included while searching.
- **Media, links and docs gallery** for every chat: ⋯ → *Media, links and docs* in a 1:1 chat, the gallery button in a group's header. Three tabs (photos and videos, documents and audio files, links), a full-screen viewer, "Show in chat" on every item, and "Load more" paging.
- **Pin, archive and mute chats** (private to you; nobody learns you muted or archived them). Each chat row has a ⋯ menu:
  - *Pin*: up to 3 chats stay at the top of the list.
  - *Archive*: moves the chat into an **Archived** row at the top of the list (separately for Chats and Groups). Archived chats stay archived when new messages arrive; the Archived row shows an unread count. A chat can't be pinned and archived at once (archiving unpins, pinning un-archives).
  - *Mute* for 8 hours, 1 week or always: no push notifications, a grey unread badge, and the chat doesn't count towards the unread number in the browser tab title.
  - Settings sync across your devices and tabs live (`chatPref` socket event).
- Endpoints: `GET /api/messages/search?q=&limit=&before=`, `GET /api/messages/media/user/:id?type=media|docs|links&limit=&before=`, `GET /api/messages/media/group/:groupId?type=...`, `GET /api/chats/prefs`, `PUT /api/chats/prefs/:kind/:id` (`kind` = `user` or `group`; body `{ pinned?, archived?, mute?: "off"|"8h"|"1w"|"always" }`).
- Socket events: `messagePreview` (`{ messageId, linkPreview | null, groupId? }`), `chatPref`.
- `npm run test:api:2d` (new file `tests/phase2d-e2e.mjs`, see `tests/README.md`).

### Changed
- New collection `chatprefs` (one row per chat that has something set; deleted again when everything is back to normal; removed when you leave a group).
- Web push skips people who muted the chat.
- Search and gallery never include messages deleted for everyone, messages you deleted for yourself, or (for later) view-once media.
- The chat-list search box says "Search chats and messages...".
- Opening a chat from a notification no longer resets it if it is already open.

### Fixed
- Clicking the group that is already open in the chat list emptied its messages until you switched away and back.

### Security notes
- The server fetches whatever link a user types, so `backend/src/lib/linkPreview.js` is the SSRF boundary: http/https only, standard ports only, no credentials in the URL, every resolved address is checked and the connection is made through that same checked lookup (no DNS rebinding), private / loopback / link-local / CGNAT / reserved IPv4 and IPv6 ranges (including IPv4-mapped) are refused, at most 3 redirects (each re-checked), 8 s, 512 KB of HTML, 1 MB images that must really be PNG / JPEG / GIF / WebP (SVG refused), compressed responses refused. On top of that: a person can trigger at most 20 fetches a minute and the server runs at most 8 at once. Page text is shown as plain text and links are only opened when tapped, always with `noopener noreferrer`.
- `LINK_PREVIEW_ALLOW_PRIVATE=1` switches the address guard off **for the test suite only**. Never set it on a real server (it logs a warning when used).
- Search runs a text scan limited to chats you belong to, is limited to 60 requests a minute per person, and caps the query at 100 characters; special characters are matched literally.

### Known limits
- **Not run yet.** I could write and read the code but not start your server or browser from here, so nothing has been executed, not even a build or lint pass. First things to do: `npm run build --prefix frontend`, `npm run lint --prefix frontend`, then `npm run test:api:2d` (both modes, see `tests/README.md`) and a click-through. There are no browser tests for the new screens yet.
- Search is a case-insensitive substring match over message text and file names (no stemming, no ranking). Fine for a private server; it scans the caller's chats, so it will slow down on a very large history.
- Previews are built for the first link in a message only, and only from the sender's server fetch: pages that need JavaScript to show a title (many single-page apps) or that block server requests get no card.
- Links in the message text are not clickable yet (the card is).
- A search result older than about 1,000 messages in a chat (20 pages) can't be scrolled to; you get a "couldn't find that message" note.
- Muting only affects push, the badge and the tab title. There is no per-chat sound or banner setting, and muting a chat doesn't mute its calls.
- Archived chats stay archived when new messages arrive (like WhatsApp's default). There is no setting to change that yet.
- The disappearing-message and view-once fields already in the message model are not wired up yet.

## Unreleased: Phase 2C, reliable sending (October 2026)

**Nothing to install. Restart the backend once so MongoDB builds the new index (see Changed).**

### Added
- **Messages send instantly and survive a bad connection.** Every message you send shows in the chat at once as "Sending…". If the network is down it says "Waiting for connection…" and is retried automatically: when the connection or socket comes back, when you return to the tab, and on a growing delay (1 s, 3 s, 8 s, 20 s, then every 45 s). Messages to the same chat always go out in the order you wrote them.
- **No duplicates, ever.** Each message carries a random `clientId` that the server remembers. If the first attempt got through and only the answer was lost, the retry gets the original message back: no second copy, no second notification, no second uploaded file.
- **"Not sent" with Retry / Discard** for messages the server refuses for good (for example you were removed from the group, or the file is too big). Temporary trouble (offline, server hiccup, throttling, expired login) is always retried instead.
- **The queue survives closing the tab or restarting the browser** (IndexedDB, so photos, files and voice notes are kept too). It is per account. Up to 50 unsent messages.
- **Drafts:** text you typed but didn't send is kept per chat (also across reloads) and shows as a red "Draft: …" in the chat list. Attachments and replies are not kept.
- **Infinite scroll** in 1:1 chats and groups: scroll up and older messages load 50 at a time, without the view jumping. Jumping to an old pinned message now loads older messages until it is found (the Phase 2A known limit is gone).
- Voice notes no longer need the "keep the recording as an attachment" fallback: the queue holds the recording until it is delivered.
- `npm run test:api:2c` (new file `tests/phase2c-e2e.mjs`).

### Changed
- `POST /api/messages/send/:id` and `POST /api/groups/:id/messages` accept an optional `clientId` (8-64 letters, digits, `_` or `-`). Same sender + same clientId → `200` with the original message; the same clientId for a different chat → `409`; a malformed one → `400`. Without a clientId nothing changes.
- The check runs before the contacts rule and before any file is stored, so a retry of an already-delivered message still answers `200` even if you have since removed that contact. A new message to a removed contact is still refused.
- Only the sender ever sees `clientId` in message payloads; recipients' copies don't carry it.
- Message documents gained `clientId`, with a unique partial index on `(senderId, clientId)`. Old messages need no migration.
- Opening a chat now requests an explicit page size of 50 and the chat only scrolls to the bottom when a *new* message arrives (it used to scroll on any change, such as someone reacting to an old message).
- The chat input is remounted per chat, so text typed in one chat no longer follows you into another.
- `sendMessage` / `sendGroupMessage` were removed from the chat stores; everything goes through the queue (`frontend/src/store/useOutboxStore.js`).

### Known limits
- **Logging out deletes unsent messages and drafts from that device** (so the next person on a shared computer can't see or send them). A login that merely expires keeps them for the same account.
- Failed or queued messages can't be replied to, forwarded, starred or reacted to until they are delivered.
- A queued message keeps the time you wrote it only on your screen; the server time is used once it is delivered, so after a long outage it lands at the end of the chat.
- Scrolling to a *search* match that is older than the loaded messages still isn't possible (search is per loaded messages; cross-chat search is a later item).
- Not browser-tested yet. Quickest check: send a message, switch your Wi-Fi off, send another, switch it back on.

## Unreleased: Phase 2B, voice notes + push notifications (October 2026)

**After pulling this: run `npm run setup` (or `npm install --prefix backend`) once. It adds the `web-push` package. Without it everything still works, push is just off and the server says so at startup.**

### Added
- **Voice notes** in 1:1 chats and groups. The mic button replaces send when the box is empty: tap to record (timer, trash to discard, send), up to 5 minutes. Playback has play/pause, seek and 1x / 1.5x / 2x, and only one note plays at a time. Voice notes can be replied to, forwarded (as voice notes, with their own file copy), starred, pinned and deleted like any message; they can't be edited. If a send fails the recording is kept as an attachment so you can retry.
- Server checks for voice notes: the file must really be audio (declared type), max 10 MB, duration capped at 15 min, any text sent with one is dropped, and the file name is set by the server.
- **Push notifications** (Settings → Notifications): per device on/off, "show message text" (off by default: you see who wrote, not what), and a Send test button. Tapping a notification opens that chat. Messages in the app while it's open and focused don't notify (on iPhone/iPad they always do, see below). Logging out turns notifications off for that device, so the next person on it doesn't get your alerts.
- Push uses standard Web Push with VAPID. Keys are created on first start and saved in `backend/vapid.json` (git-ignored; keep it, or every device has to re-enable). The message is encrypted between your server and the browser; Google/Apple/Mozilla/Microsoft only relay it.
- Endpoints: `GET /api/push/key`, `GET /api/push/status`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `PUT /api/push/prefs`, `POST /api/push/test`.
- `.env` options: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (use a real email), `PUSH_EXTRA_HOSTS`.
- Tests: `npm run test:api:2b` (voice rules, push subscription validation) and a voice-note step in `tests/ui-e2e.py`.

### Security notes
- The server only accepts push subscriptions whose address is a Google (FCM), Mozilla, Apple or Microsoft push service, over https on the standard port. Otherwise a user could point the server at internal addresses (SSRF). The host list is from my knowledge of those services: if a browser's subscription is refused, check `PUSH_EXTRA_HOSTS`.
- Max 10 devices per account; a device that another account signs in on is moved to that account.

### Changed
- Message documents gained `voice`, `voiceDuration`. No migration needed.
- Each message's ⋯ button is now titled "Message options" (it was "More", which clashed with the chat header's More menu in the UI test).
- `npm run share -- --lan` now says that voice notes and push also need the https link.

### Known limits
- **Plain `http://` (laptop IP on your Wi-Fi) can't use the microphone or push**: browsers only allow both on https or localhost. Test those with `npm run share` (https link) or on the laptop itself via `http://localhost:5001`.
- Push works only in the built app (`npm run share` / production); the service worker isn't registered by `npm run dev`.
- iPhone/iPad: web push needs the app added to the Home Screen first (iOS 16.4+). Not tested.
- Notifications don't carry the sender's picture, there is no per-chat mute yet, and incoming calls don't push.
- No "listened" indicator on voice notes and no waveform yet.

## Unreleased: Phase 2A, message actions (October 2026)

### Added
- **Delivered ticks** in 1:1 chats: ✓ sent, ✓✓ delivered (recipient's device received it, including after they come back online), ✓✓ in the accent colour when seen. Group chats don't have per-member ticks yet.
- **Edit** your own messages for 15 minutes (text or caption). Shows "edited"; everyone in the chat sees the change live.
- **Delete for me** (hides it from you only, on all your devices) and **Delete for everyone** (sender only, within 48 hours). Delete-for-everyone wipes the text, reactions and the uploaded file from the server and leaves a "This message was deleted" placeholder; quoted replies to it show the same placeholder.
- **Forward** to up to 5 contacts/groups at once. Each copy gets its own file, so deleting the original never breaks a forwarded copy. Forwarded messages are labelled.
- **Star** messages (private: nobody else can tell) and a **Starred messages** list (☆ button next to the chat search) that jumps to the chat.
- **Pin** messages (visible to both people / the whole group, up to 3 per chat; pinning a 4th replaces the oldest). A bar under the chat header shows them.
- A ⋯ menu on every message: reply, copy, forward, star, pin, edit, delete (copy also works over plain `http://` on your LAN).
- Endpoints: `PUT /api/messages/edit/:id`, `DELETE /api/messages/:id?scope=me|everyone`, `PUT /api/messages/star/:id`, `PUT /api/messages/pin/:id`, `POST /api/messages/forward`, `GET /api/messages/starred`, `GET /api/messages/pinned/user/:id`, `GET /api/messages/pinned/group/:groupId`.
- Socket events: `messageEdited`, `messageDeleted`, `messageDeletedForMe`, `messageStarred` (only to the person who starred), `messagePinned`, `messagesDelivered`.
- `npm run test:api:2a` (new file `tests/phase2a-e2e.mjs`).

### Changed
- Message documents gained `deliveredAt`, `editedAt`, `forwarded`, `deletedForEveryone`, `deletedAt`, `deletedFor`, `starredBy`, `pinnedAt`, `pinnedBy`. Old messages keep working with no migration (queries treat missing fields as "not set").
- Clients never receive `starredBy` / `deletedFor`; they get `starred: true|false` for themselves only. The same filtering is applied to a group's `lastMessage`.
- Reactions are refused on deleted messages.

### Known limits
- Starred/pinned/edited state isn't shown in the chat-list preview beyond the text itself.
- "Delete for me" on a group's latest message: the group list preview still shows that message to you (the group stores one shared last-message pointer).
- Jumping to a pinned message older than the loaded page isn't possible yet (needs infinite scroll, Phase 2B).
- The 15 min / 48 h windows are constants in `backend/src/lib/messageOps.js` (mirrored in `frontend/src/lib/messageRules.js`).
- Delivered ticks reveal to a contact that your device connected, even if you hid "show when I'm online".


## Unreleased: Phase 1, usernames and contacts (October 2026)

### Added
- **Usernames** are the identity: sign up with a username (3-20 letters, numbers or `_`), optional display name, no email. Live "is it free?" check, change it any time from Profile.
- **Contacts:** find people by their *exact* username only (no browsing), send / accept / decline / cancel requests, remove contacts, block and unblock. Blocking is invisible to the blocked person.
- **Contacts-only rules** now apply to messages, calls, typing indicators, adding people to groups, status and online presence.
- **Privacy settings** (Settings page): show when I'm online, read receipts (reciprocal), who can see my status (contacts / nobody).
- `GET/POST/DELETE /api/contacts/...`, `PUT /api/auth/username`, `PUT /api/auth/privacy`, `GET /api/auth/username-available`.
- `npm run share` now rebuilds the frontend automatically when its source is newer than the last build.

### Changed
- The chat list shows only your accepted contacts (it used to list every account on the server).
- Online status is only shared between contacts (it used to be broadcast to everyone).
- Login takes a username; accounts created before this update can still log in with their old email.
- The old unique index on `email` is dropped; email is now optional.

### Migration (automatic at startup, safe to re-run)
- Every existing account gets a username derived from its email/name (see Profile to change it).
- People who already exchanged direct messages become contacts, so existing conversations keep working.

### Fixed
- Refreshing an empty contact list no longer flashes a loading skeleton that closed the "Add contact" window.
- Logging out clears all in-memory chats/contacts, so the next login in the same tab never shows the previous account's data.
- `@username` (with the @) is accepted at login.

## October 2026 audit & hardening

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
