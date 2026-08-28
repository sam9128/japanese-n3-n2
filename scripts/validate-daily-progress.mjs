import fs from "node:fs";
import path from "node:path";
import { calculateDailyProgress } from "../src/dailyProgress.js";

const root = path.resolve(import.meta.dirname, "..");
const index = JSON.parse(
  fs.readFileSync(path.join(root, "public", "content", "index.json"), "utf8"),
);
const data = {
  vocabulary: [],
  grammar: [],
  reading: [],
  listening: [],
};
for (const period of index.periods) {
  const pack = JSON.parse(
    fs.readFileSync(
      path.join(root, "public", "content", "periods", `${period}.json`),
      "utf8",
    ),
  );
  for (const key of Object.keys(data)) data[key].push(...pack[key]);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const julyFirst = calculateDailyProgress(data, {}, new Date(2026, 6, 1, 12));
assert(
  JSON.stringify(julyFirst.categories.map((item) => item.expected)) ===
    JSON.stringify([15, 2, 1, 1]),
  `unexpected July 1 targets: ${julyFirst.categories
    .map((item) => item.expected)
    .join(",")}`,
);
assert(julyFirst.expectedTotal === 19, "July 1 total should be 19");

const julyLast = calculateDailyProgress(data, {}, new Date(2026, 6, 31, 12));
assert(
  JSON.stringify(julyLast.categories.map((item) => item.expected)) ===
    JSON.stringify([441, 38, 5, 12]),
  "July month-end targets do not match the unlock schedule",
);

const augustFirst = calculateDailyProgress(data, {}, new Date(2026, 7, 1, 12));
assert(
  JSON.stringify(augustFirst.categories.map((item) => item.expected)) ===
    JSON.stringify([456, 40, 6, 13]),
  "August 1 cumulative targets are incorrect",
);

const beforePlan = calculateDailyProgress(data, {}, new Date(2026, 5, 30, 12));
assert(
  beforePlan.beforePlan && beforePlan.expectedTotal === 0,
  "before-plan state is incorrect",
);

const afterPlan = calculateDailyProgress(data, {}, new Date(2027, 6, 1, 12));
assert(
  afterPlan.afterPlan && afterPlan.expectedTotal === 4000 + 240 + 52 + 124,
  "after-plan total is incorrect",
);

const progress = {};
for (const item of data.vocabulary.slice(0, 20))
  progress[item.id] = { rating: "good" };
for (const item of data.grammar.slice(0, 5))
  progress[item.id] = { rating: "easy" };
for (const item of data.reading.slice(0, 3))
  progress[item.id] = { rating: "hard" };
for (const item of data.listening.slice(0, 2))
  progress[item.id] = { rating: "hard" };
const behind = calculateDailyProgress(data, progress, new Date(2026, 6, 5, 12));
assert(behind.actualTotal === 30, "completed item rules are incorrect");
assert(behind.expectedTotal === 82 && behind.delta === -52, "behind indicator is incorrect");

const aheadProgress = {};
for (const key of Object.keys(data)) {
  for (const item of data[key].filter((item) => item.unlockPeriod === "115-07")) {
    aheadProgress[item.id] = {
      rating: key === "vocabulary" || key === "grammar" ? "good" : "hard",
    };
  }
}
const ahead = calculateDailyProgress(data, aheadProgress, new Date(2026, 6, 5, 12));
assert(ahead.status === "ahead" && ahead.delta > 0, "ahead indicator is incorrect");

console.log(
  JSON.stringify(
    {
      ok: true,
      julyFirst: julyFirst.categories,
      julyLast: julyLast.categories,
      augustFirst: augustFirst.categories,
      behind: {
        actual: behind.actualTotal,
        expected: behind.expectedTotal,
        delta: behind.delta,
      },
      ahead: {
        actual: ahead.actualTotal,
        expected: ahead.expectedTotal,
        delta: ahead.delta,
      },
    },
    null,
    2,
  ),
);
