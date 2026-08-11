// Tests for the service worker's content freshness rules.
//
// Cache staleness has now hidden a shipped fix twice: once when CACHE was not
// bumped and a deploy never arrived at all, and once when the lesson rebuild
// shipped but the learner's first visit still served the previous questions, so
// reading and listening looked unchanged. Both were invisible in the browser
// because the code was correct — only the cache was old. These cases pin the
// routing so neither can come back silently.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const failures = [];
// Awaited, because most of these cases are async — a non-awaiting runner would
// report a green suite while the assertions rejected in the background.
const pending = [];
const check = (name, fn) => {
  pending.push(
    (async () => {
      try {
        await fn();
      } catch (error) {
        failures.push({ name, message: error.message });
      }
    })(),
  );
};

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "public", "sw.js"),
  "utf8",
);

// ------------------------------------------------------------------ harness
// A cache that records what was deleted, so the version-change purge is
// observable rather than inferred.
function makeCache(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    store,
    deleted: [],
    async match(url) {
      const body = store.get(url);
      return body === undefined ? undefined : jsonResponse(body);
    },
    async put(url, response) {
      store.set(url, await response.json().catch(() => "opaque"));
    },
    async keys() {
      return [...store.keys()].map((url) => ({ url }));
    },
    async delete(request) {
      this.deleted.push(request.url);
      store.delete(request.url);
      return true;
    },
  };
}

function jsonResponse(body) {
  return {
    ok: true,
    type: "basic",
    clone() {
      return this;
    },
    async json() {
      return typeof body === "string" ? JSON.parse(body) : body;
    },
  };
}

// Load sw.js with the service worker globals it expects, then reach in for the
// functions under test. Evaluating the real file means these tests cannot drift
// away from what actually ships.
function loadWorker(fetchImpl) {
  const listeners = {};
  const context = {
    self: {
      addEventListener: (type, handler) => {
        listeners[type] = handler;
      },
      location: { origin: "https://example.test", href: "https://example.test/" },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: { open: async () => null, keys: async () => [], delete: async () => true },
    fetch: fetchImpl,
    URL,
    Response: { error: () => ({ ok: false, type: "error" }) },
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${source}\n;globalThis.__api = { handleRequest, handleContentIndex, isContentIndex, isPeriodPack, isImmutableAsset, isAppShell, CACHE };`, context);
  return context.__api;
}

const INDEX = "https://example.test/content/index.json";
const PACK = "https://example.test/content/periods/115-07.json";

// ------------------------------------------------------------------ routing
check("the lesson index is recognised", () => {
  const { isContentIndex } = loadWorker(async () => jsonResponse({}));
  assert.equal(isContentIndex(new URL(INDEX)), true);
  assert.equal(isContentIndex(new URL(PACK)), false);
});

check("lesson packs are recognised", () => {
  const { isPeriodPack } = loadWorker(async () => jsonResponse({}));
  assert.equal(isPeriodPack(new URL(PACK)), true);
  assert.equal(isPeriodPack(new URL(INDEX)), false);
  assert.equal(
    isPeriodPack(new URL("https://example.test/assets/index-abc12345.js")),
    false,
  );
});

// ------------------------------------------------------------------ the bug
check("a new contentHash drops the cached lesson packs", async () => {
  const api = loadWorker(async () => jsonResponse({ contentHash: "cf59c896" }));
  const cache = makeCache({
    [INDEX]: { contentHash: "0123abcd" },
    [PACK]: { reading: [] },
    "https://example.test/content/periods/115-08.json": { reading: [] },
  });
  await api.handleContentIndex(cache, { url: INDEX });
  assert.deepEqual(
    cache.deleted.sort(),
    [
      "https://example.test/content/periods/115-07.json",
      "https://example.test/content/periods/115-08.json",
    ],
    "both packs should be dropped so the next fetch goes to the network",
  );
});

check("an unchanged contentHash keeps the packs", async () => {
  const api = loadWorker(async () => jsonResponse({ contentHash: "cf59c896" }));
  const cache = makeCache({
    [INDEX]: { contentHash: "cf59c896" },
    [PACK]: { reading: [] },
  });
  await api.handleContentIndex(cache, { url: INDEX });
  assert.deepEqual(cache.deleted, [], "packs must survive an unchanged hash");
});

check("the hash decides even when contentVersion has not moved", async () => {
  // The exact case that shipped: a full lesson rebuild under the previous
  // contentVersion string, because that field is a hand-written migration
  // marker rather than a description of the content.
  const api = loadWorker(async () =>
    jsonResponse({ contentVersion: "2026-08-jmdict-rebuild", contentHash: "new" }),
  );
  const cache = makeCache({
    [INDEX]: { contentVersion: "2026-08-jmdict-rebuild", contentHash: "old" },
    [PACK]: { reading: [] },
  });
  await api.handleContentIndex(cache, { url: INDEX });
  assert.deepEqual(
    cache.deleted,
    ["https://example.test/content/periods/115-07.json"],
    "a rebuild must reach the learner even if contentVersion was not bumped",
  );
});

check("an index without contentHash falls back to contentVersion", async () => {
  const api = loadWorker(async () => jsonResponse({ contentVersion: "b" }));
  const cache = makeCache({
    [INDEX]: { contentVersion: "a" },
    [PACK]: { reading: [] },
  });
  await api.handleContentIndex(cache, { url: INDEX });
  assert.deepEqual(cache.deleted, [
    "https://example.test/content/periods/115-07.json",
  ]);
});

check("offline falls back to the cached index", async () => {
  const api = loadWorker(async () => {
    throw new Error("offline");
  });
  const cache = makeCache({ [INDEX]: { contentVersion: "cached" } });
  const response = await api.handleContentIndex(cache, { url: INDEX });
  assert.equal((await response.json()).contentVersion, "cached");
  assert.deepEqual(cache.deleted, [], "an offline start must not purge lessons");
});

check("a first install has nothing to compare and purges nothing", async () => {
  const api = loadWorker(async () => jsonResponse({ contentVersion: "first" }));
  const cache = makeCache({});
  await api.handleContentIndex(cache, { url: INDEX });
  assert.deepEqual(cache.deleted, []);
});

// ------------------------------------------------------------------ caching
check("hashed build assets stay cache-first", () => {
  const { isImmutableAsset } = loadWorker(async () => jsonResponse({}));
  assert.equal(
    isImmutableAsset(new URL("https://example.test/assets/index-CiyQVQyA.js")),
    true,
  );
  assert.equal(isImmutableAsset(new URL(PACK)), false);
});

check("the cache name is bumped when this file's logic changes", () => {
  const { CACHE } = loadWorker(async () => jsonResponse({}));
  assert.match(CACHE, /^nihongo-stairs-v\d+-/);
  assert.notEqual(
    CACHE,
    "nihongo-stairs-v34-self-updating",
    "v34 shipped before the contentVersion purge existed",
  );
});

await Promise.all(pending);

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, cases: 10 }, null, 2));
