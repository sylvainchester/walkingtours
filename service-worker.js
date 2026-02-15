const CACHE_NAME = "walkingtours-v15";
const ASSETS = [
  "./",
  "./index.html",
  "./sign-in.html",
  "./sign-up.html",
  "./recover.html",
  "./share.html",
  "./availability.html",
  "./profile.html",
  "./tour-config.html",
  "./styles.css",
  "./app.js",
  "./auth.js",
  "./share.js",
  "./availability.js",
  "./profile.js",
  "./tour-config.js",
  "./sw-register.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key)))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Network-first for navigations and core assets to avoid stale updates
  const isHtml = req.mode === "navigate" || url.pathname.endsWith(".html");
  const isCore =
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".webmanifest");

  if (isHtml || isCore) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
