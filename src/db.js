const DB_NAME = "nihongo-stairs";
// 3 adds drillResults, which records the 專項強化集 questions the learner has
// cleared. openDatabase creates any store missing from STORES, but only inside
// onupgradeneeded, so a new store needs the version to move.
const DB_VERSION = 3;
export const STORES = [
  "cardProgress",
  "studyEvents",
  "assessmentResults",
  "drillResults",
  "reports",
  "settings",
];
export const DATA_CHANGED_EVENT = "nihongo:data-changed";
export const REMOTE_APPLIED_EVENT = "nihongo:remote-applied";

function notifyDataChanged(detail = {}) {
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail }));
}

export function notifyRemoteApplied() {
  window.dispatchEvent(new CustomEvent(REMOTE_APPLIED_EVENT));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES)
        if (!db.objectStoreNames.contains(name))
          db.createObjectStore(name, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(storeName) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function put(storeName, value, { notify = true } = {}) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(storeName, "readwrite")
      .objectStore(storeName)
      .put(value);
    request.onsuccess = () => {
      if (notify) notifyDataChanged({ storeName, recordId: value.id });
      resolve(value);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function replaceAll(storeName, values, { notify = true } = {}) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.clear();
    values.forEach((value) => store.put(value));
    tx.oncomplete = () => {
      if (notify) notifyDataChanged({ storeName, replaced: true });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadSnapshot() {
  const entries = await Promise.all(
    STORES.map(async (name) => [name, await getAll(name)]),
  );
  return Object.fromEntries(entries);
}

export async function restoreSnapshot(
  snapshot,
  { notify = true, forceDrive = false } = {},
) {
  for (const name of STORES)
    await replaceAll(
      name,
      Array.isArray(snapshot[name]) ? snapshot[name] : [],
      { notify: false },
    );
  if (forceDrive) localStorage.setItem("nihongo-stairs-force-drive-sync", "1");
  if (notify) notifyDataChanged({ restored: true, forceDrive });
}

export async function migrateLegacyProgress() {
  const migration = await getAll("settings");
  if (migration.some((item) => item.id === "legacy-migrated")) return;
  try {
    const legacy = JSON.parse(
      localStorage.getItem("nihongo-stairs-progress-v1"),
    );
    if (legacy?.ratings) {
      for (const [id, rating] of Object.entries(legacy.ratings))
        await put("cardProgress", {
          id,
          rating,
          updatedAt: new Date().toISOString(),
        });
    }
  } catch {
    /* malformed legacy data is ignored */
  }
  await put("settings", { id: "legacy-migrated", value: true });
}

/**
 * Drop recorded progress for cards whose word changed when the list was rebuilt.
 *
 * The rebuild kept a word on its original id wherever the word was real and
 * unique, so a learner's history keeps pointing at what they actually studied.
 * The ids that had to be re-issued held a duplicate (おすすめ was on the list
 * three times) or a fragment that was never a word (アプ, cut out of アプリ), and
 * a "記得" recorded against those says nothing about the word now in that slot.
 *
 * Runs once per contentVersion, so a later rebuild can repeat it.
 */
export async function resetReissuedProgress(contentVersion, reissuedIds = []) {
  if (!contentVersion || !reissuedIds.length) return { cleared: 0, skipped: true };
  const settings = await getAll("settings");
  const marker = settings.find((item) => item.id === "content-version");
  if (marker?.value === contentVersion) return { cleared: 0, skipped: true };

  const progress = await getAll("cardProgress");
  const stale = new Set(reissuedIds);
  const kept = progress.filter((item) => !stale.has(item.id));
  const cleared = progress.length - kept.length;
  if (cleared) await replaceAll("cardProgress", kept, { notify: false });
  await put("settings", { id: "content-version", value: contentVersion });
  return { cleared, skipped: false };
}
