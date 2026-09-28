export const SNAPSHOT_STORES = [
  "cardProgress",
  "studyEvents",
  "assessmentResults",
  "drillResults",
  "reports",
  "settings",
];

function timestamp(record) {
  const value =
    record?.updatedAt ||
    record?.occurredAt ||
    record?.completedAt ||
    record?.value?.updatedAt;
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function mergeStore(localRecords = [], cloudRecords = []) {
  const merged = new Map();
  for (const record of cloudRecords)
    if (record?.id) merged.set(record.id, record);
  for (const record of localRecords) {
    if (!record?.id) continue;
    const cloudRecord = merged.get(record.id);
    if (!cloudRecord || timestamp(record) >= timestamp(cloudRecord))
      merged.set(record.id, record);
  }
  return [...merged.values()].sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  );
}

export function normalizeSnapshot(snapshot = {}) {
  return Object.fromEntries(
    SNAPSHOT_STORES.map((store) => [
      store,
      [...(Array.isArray(snapshot[store]) ? snapshot[store] : [])].sort(
        (a, b) => String(a.id).localeCompare(String(b.id)),
      ),
    ]),
  );
}

export function mergeSnapshots(localSnapshot, cloudSnapshot) {
  return Object.fromEntries(
    SNAPSHOT_STORES.map((store) => [
      store,
      mergeStore(localSnapshot?.[store], cloudSnapshot?.[store]),
    ]),
  );
}

export function snapshotsEqual(left, right) {
  return (
    JSON.stringify(normalizeSnapshot(left)) ===
    JSON.stringify(normalizeSnapshot(right))
  );
}
