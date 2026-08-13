const CACHE_NAME = "raithufresh-v2";
const IMMUTABLE_CACHE = "raithufresh-immutable-v1";
const MAX_IMMUTABLE_ENTRIES = 120;

const APP_SHELL = [
  "/",
  "/offline.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== IMMUTABLE_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/** Trim a cache to its most recent maxEntries (FIFO by insertion order). */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (const key of keys.slice(0, keys.length - maxEntries)) {
    await cache.delete(key);
  }
}

/** Content-hashed build assets + images never change for a given URL. */
function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    /\.(png|webp|jpg|jpeg|svg|gif|woff2?)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  if (
    url.pathname.startsWith("/__vite") ||
    url.pathname.startsWith("/@") ||
    url.pathname.includes("hot-update") ||
    url.pathname.startsWith("/node_modules") ||
    url.hostname !== self.location.hostname
  ) {
    return;
  }

  // Cache-first for immutable hashed assets and images: instant repeat visits.
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.open(IMMUTABLE_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response && response.status === 200 && response.type === "basic") {
          cache.put(event.request, response.clone());
          trimCache(IMMUTABLE_CACHE, MAX_IMMUTABLE_ENTRIES);
        }
        return response;
      })
    );
    return;
  }

  // Network-first for navigations and everything else (fresh app shell/API),
  // falling back to cache, then offline.html for navigations.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === "navigate") {
            return caches.match("/offline.html");
          }
        });
      })
  );
});
