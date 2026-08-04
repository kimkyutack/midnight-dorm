const CACHE = "midnight-dorm-shell-v19";
const ASSET_CACHE = "midnight-dorm-assets-v19";
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
  "/assets/cinematic/arcade-stage-loading-v1.webp",
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
          keys
            .filter((key) => key !== CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "PURGE_APP_CACHES") return;
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.skipWaiting())
      .then(() => {
        event.ports[0]?.postMessage({ type: "APP_CACHES_PURGED" });
      }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (
    request.method !== "GET" ||
    new URL(request.url).pathname.startsWith("/api/")
  )
    return;
  const url = new URL(request.url);
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname === "/manifest.webmanifest");
  if (isStaticAsset) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }
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
