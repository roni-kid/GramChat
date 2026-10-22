const CACHE_NAME = "gramchat-shell-v1";
const STATIC_ASSETS = ["/", "/manifest.webmanifest", "/gramchat.svg", "/avatar.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// ── Web push ──
// The server sends { kind: "dm" | "group" | "test", chatId, title, body, tag }. The payload is encrypted end to end between
// the server and this browser; the push service (Google / Apple / Mozilla / Microsoft) only relays it.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Gramchat", body: "New message" };
  }

  event.waitUntil(
    (async () => {
      // If the app is open and focused the user is already looking at it: the unread badge is enough.
      // (Test notifications always show, so the Settings button visibly works. iPhone/iPad always show too, because
      // Safari expects every push to produce a notification and can cancel subscriptions that don't.)
      const ios = /iPad|iPhone|iPod/.test(self.navigator.userAgent);
      if (data.kind !== "test" && !ios) {
        const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        if (wins.some((w) => w.visibilityState === "visible" && w.focused)) return;
      }
      await self.registration.showNotification(data.title || "Gramchat", {
        body: data.body || "New message",
        icon: "/avatar.png",
        tag: data.tag || undefined, // one notification per chat; a newer message replaces the older one
        renotify: !!data.tag,
        data: { kind: data.kind, chatId: data.chatId },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { kind, chatId } = event.notification.data || {};
  const open = kind === "dm" || kind === "group";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) {
        await win.focus();
        if (open) win.postMessage({ type: "openChat", kind, chatId });
        return;
      }
      await self.clients.openWindow(open ? `/?open=${kind}:${encodeURIComponent(chatId)}` : "/");
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.pathname.startsWith("/api") || url.pathname.startsWith("/socket.io")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        const shouldCache =
          response.ok &&
          response.type === "basic" &&
          ["/assets/", "/gramchat.svg", "/avatar.png"].some((path) => url.pathname.startsWith(path));

        if (shouldCache) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }

        return response;
      });
    })
  );
});
