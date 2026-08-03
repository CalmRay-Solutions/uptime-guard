// Uptime Guard service worker — installable PWA shell + status notifications.
// Bump CACHE on each release so returning clients pick up new assets automatically.
const CACHE = "ug-shell-v2";

self.addEventListener("install", () => {
  // Activate this version immediately instead of waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

// Runtime caching. Hashed assets are immutable -> cache-first. Navigations are
// network-first with an offline fallback to the cached app shell. API and
// heartbeat traffic is never cached.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/ping")) return;

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(req));
  } else if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // no-store bypasses the HTTP disk cache so a fresh index.html (and its new
    // asset hashes) is fetched on every navigation — no stale UI after a deploy.
    const res = await fetch(req, { cache: "no-store" });
    if (res.ok) cache.put("/", res.clone()); // keep the latest app shell for offline
    return res;
  } catch (err) {
    const cached = (await cache.match("/")) || (await cache.match(req));
    if (cached) return cached;
    throw err;
  }
}

// Server-pushed status alert — fires even when the app is closed.
self.addEventListener("push", (event) => {
  let data = { title: "Uptime Guard", body: "", url: "/" };
  try { data = { ...data, ...event.data.json() }; } catch { /* keep defaults */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: "uptime-guard",
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: data.url },
    })
  );
});

// Clicking a status notification focuses an existing tab (routing it to the
// relevant service) or opens a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) {
            try { await client.navigate(target); } catch { /* cross-origin/limits */ }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })()
  );
});
