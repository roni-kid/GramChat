# Letting someone else use your Gramchat (free)

Your PC is the server. A free tunnel gives it a public HTTPS address so a friend on another network
(or phone) can open it. Nothing is paid and no account is needed.

## 1. One-time setup
1. Install Node 20.19+ (or 22.12+) and MongoDB Community (running locally).
2. `npm run setup`
3. Install the tunnel tool once:
   - Windows: `winget install --id Cloudflare.cloudflared`
   - macOS: `brew install cloudflared`
   - Linux: see Cloudflare's download page.

## 2. Every time
```bash
npm run share
```
It builds the app if needed, creates `backend/.env` with a random secret if you don't have one, starts the server in
production mode and prints a link like `https://random-words.trycloudflare.com`. Send that link to your friend.
They sign up (their account lives in **your** database) and you can message each other.

Keep the window open. Stop with Ctrl+C. The link changes each run.

## What to expect (from Cloudflare's docs and community write-ups; verify current terms)
- Quick tunnels are free, need no account, and carry WebSockets (needed for realtime chat).
- They have **no uptime guarantee** and are meant for testing; roughly 200 concurrent requests per tunnel.
- The URL is random each time. A stable URL needs a (free) Cloudflare account and a domain you control.
- HTTPS matters: browsers only allow camera/microphone and installing the PWA on a secure address.
- **Anyone with the link can register on your server.** Only share it with people you trust, and stop the tunnel when done.

## Calls across different networks
The tunnel only carries web traffic; call audio/video flows directly between the two devices (WebRTC).
That works for many networks using the built-in free STUN servers, but **not all** (strict firewalls, many mobile
carriers). For those you need a TURN relay. Free options exist; paste credentials into `backend/.env`:

```
TURN_URLS=turn:standard.relay.metered.ca:80,turns:standard.relay.metered.ca:443?transport=tcp
TURN_USERNAME=...
TURN_CREDENTIAL=...
```
- Metered "Open Relay": free account, advertised 20 GB/month of relay traffic.
- Cloudflare Realtime TURN: advertised 1,000 GB/month free egress (account needed; credentials are minted through their API,
  not yet wired into Gramchat; see ROADMAP).
- Self-hosting coturn needs a public IP and open UDP ports, which a home PC behind a tunnel does not provide.

Check it is active: log in and open `/api/calls/ice`; you should see a second entry with `turn:` URLs.

## Same Wi-Fi only (no tunnel)
`npm run share -- --lan` prints the address (e.g. `http://192.168.1.20:5001`) to open on your phone; it relaxes the cookie
flag for you. Because it is plain http, browsers block calls (camera/mic) and app-install there; use the tunnel for call tests.
If the phone cannot connect, allow Node.js through Windows Firewall on Private networks and turn off "AP/client isolation" on the router.

## Honest limits
- Your PC must be on and online. Messages sent while the other person is offline are stored and shown when they next open the app (no push notifications yet).
- Uploaded files live in `backend/uploads/` on your disk. Back up that folder and the database if the data matters.
- Until end-to-end encryption exists (ROADMAP Phase 3), **you, as server owner, can read every message.** Tell your friends that.
