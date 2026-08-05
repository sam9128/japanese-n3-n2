const CACHE = "nihongo-stairs-v33-jmdict-content-weekly-unlock";
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
  const response = await fetch("./");
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

async function handleRequest(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request.url, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request.url, response.clone());
    }
    return response;
  } catch {
    if (request.mode === "navigate") {
      return (
        (await cache.match(new URL("./offline.html", self.location.href).href)) ||
        Response.error()
      );
    }
    return Response.error();
  }
}
