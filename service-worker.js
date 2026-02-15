const CACHE_NAME = "walkingtours-v14";
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
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
