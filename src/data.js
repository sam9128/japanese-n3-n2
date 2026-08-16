export const PERIODS = ["115-07","115-08","115-09","115-10","115-11","115-12","116-01","116-02","116-03","116-04","116-05","116-06"];

export function currentRocPeriod(date = new Date()) {
  const rocYear = date.getFullYear() - 1911;
  return `${rocYear}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export async function loadStudyData() {
  const index = await fetch("./content/index.json").then((response) => {
    if (!response.ok) throw new Error("無法載入教材索引");
    return response.json();
  });
  const packs = await Promise.all(index.periods.map((period) => fetch(`./content/periods/${period}.json`).then((response) => response.json())));
  const merged = { vocabulary:[], grammar:[], reading:[], listening:[], assessments:[], practice:[] };
  // `practice` arrived later than the other keys, so a pack cached before it
  // existed would otherwise spread `undefined` and break the whole load.
  for (const pack of packs) for (const key of Object.keys(merged)) merged[key].push(...(pack[key] || []));
  return { ...merged, index };
}

export function isUnlocked(item, activePeriod) {
  const activeIndex = PERIODS.indexOf(activePeriod);
  const itemIndex = PERIODS.indexOf(item.unlockPeriod);
  return itemIndex >= 0 && activeIndex >= itemIndex;
}

export function formatPeriod(period) {
  const [year, month] = period.split("-");
  return `${year}/${month}`;
}
