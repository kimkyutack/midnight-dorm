const CACHE = "midnight-dorm-shell-v8";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/favicon.png",
  "/icons/favicon.ico",
  "/icons/android-icon-192x192.png",
  "/icons/android-icon-512x512.png",
  "/icons/icon-maskable-512.png",
  "/assets/cinematic/opening-chase.webp",
  "/assets/cinematic/dorm-home.webp",
  "/assets/cinematic/ghost-roster.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (
    request.method !== "GET" ||
    new URL(request.url).pathname.startsWith("/api/")
  )
    return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("/")),
      ),
  );
});
