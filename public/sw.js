// Offline cache for the study PWA.
//
// The previous version answered every request from the cache and never went back
// to the network, so a deploy only reached a device if someone remembered to edit
// CACHE by hand. Forgetting that shipped a fix that silently never arrived.
//
// Requests now fall into three groups:
//   - the app shell (navigations, index.html): network first, cache as fallback,
//     so a new deploy is picked up on the next load and still works offline;
//   - hashed build assets: cache first, because the filename changes when the
//     content does, so a cached copy can never be stale;
//   - study content: served from cache immediately and refreshed in the
//     background, so lessons stay available offline but do update.
//
// Bump CACHE only when this file's own logic changes; content and code updates no
// longer need it.
const CACHE = "nihongo-stairs-v34-self-updating";
const PERIODS = [
  "115-07",
  "115-08",
  "115-09",
  "115-10",
  "115-11",
  "115-12",
  "116-01",
  "116-02",
  "116-03",
  "116-04",
  "116-05",
  "116-06",
];
const PRELOAD = [
  "./",
  "./offline.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./日語階梯_完整教材.txt",
  "./content/index.json",
  ...PERIODS.map((period) => `./content/periods/${period}.json`),
];

async function installApp() {
  const cache = await caches.open(CACHE);
  await cache.addAll(PRELOAD);
  const response = await fetch("./", { cache: "no-cache" });
  const html = await response.text();
  const assetUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((url) => url.startsWith("./assets/") || url.startsWith("assets/"));
  await cache.addAll(assetUrls);
  await self.skipWaiting();
}

self.addEventListener("install", (event) => event.waitUntil(installApp()));
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // Authentication and account data must never enter the shared PWA cache.
  if (url.origin !== self.location.origin) return;
  event.respondWith(handleRequest(event.request));
});

// Vite fingerprints these, so a given URL always holds the same bytes.
function isImmutableAsset(url) {
  return /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|svg|jpg)$/.test(
    url.pathname,
  );
}

function isAppShell(request, url) {
  return (
    request.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html")
  );
}

async function cacheFirst(cache, request) {
  const cached = await cache.match(request.url, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request.url, response.clone());
  }
  return response;
}

// Serve the cached copy at once, then quietly replace it for next time.
async function staleWhileRevalidate(cache, request) {
  const cached = await cache.match(request.url, { ignoreSearch: true });
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === "basic") {
        await cache.put(request.url, response.clone());
      }
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const response = await network;
  return response || Response.error();
}

async function networkFirst(cache, request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request.url, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request.url, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === "navigate") {
      return (
        (await cache.match(new URL("./offline.html", self.location.href).href)) ||
        Response.error()
      );
    }
    return Response.error();
  }
}

async function handleRequest(request) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  if (isImmutableAsset(url)) return cacheFirst(cache, request);
  if (isAppShell(request, url)) return networkFirst(cache, request);
  return staleWhileRevalidate(cache, request);
}
