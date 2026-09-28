// Tests for 長文速度.
//
// The figure is built from study events, and an event can carry a clock that was
// left running or a tap-through with no reading in it. Both would move an average
// built from a handful of articles, so the filters get explicit cases.
import assert from "node:assert/strict";
import { readingRuns, readingSpeed } from "../src/readingSpeed.js";

const failures = [];
const check = (name, fn) => {
  try {
    fn();
  } catch (error) {
    failures.push({ name, message: error.message });
  }
};

const event = (id, seconds, chars, rating = "good", day = 1) => ({
  id,
  cardId: `reading-${id}`,
  seconds,
  chars,
  rating,
  occurredAt: `2026-08-${String(day).padStart(2, "0")}T10:00:00.000Z`,
});

check("a listening event carries no length, so it is not a speed run", () => {
  assert.equal(readingRuns([{ id: "a", seconds: 90, rating: "good" }]).length, 0);
});

check("a tap-through is not a reading", () => {
  // 400 characters in 3 seconds is the learner pressing through the options.
  assert.equal(readingRuns([event("a", 3, 400)]).length, 0);
});

check("a clock left running is dropped, not averaged in", () => {
  // 30 characters over 10 minutes is 3 字/分 — kept, it is a slow read.
  assert.equal(readingRuns([event("a", 600, 30)]).length, 1);
  // 4000 characters in 60 seconds is 4000 字/分 — impossible, the clock was paused.
  assert.equal(readingRuns([event("b", 60, 4000)]).length, 0);
});

check("cpm is characters per minute", () => {
  const [run] = readingRuns([event("a", 120, 600)]);
  assert.equal(run.cpm, 300);
  assert.equal(run.allCorrect, true);
});

check("runs come back oldest first whatever order they arrive in", () => {
  const runs = readingRuns([event("late", 60, 300, "good", 9), event("early", 60, 300, "good", 2)]);
  assert.deepEqual(runs.map((run) => run.id), ["early", "late"]);
});

check("no runs yet: every figure is zero and no trend is claimed", () => {
  const speed = readingSpeed([]);
  assert.equal(speed.count, 0);
  assert.equal(speed.averageCpm, 0);
  assert.equal(speed.trend, "unknown");
  assert.equal(speed.latest, null);
});

check("three runs are not enough to call a trend", () => {
  const speed = readingSpeed([event("a", 60, 100, "good", 1), event("b", 60, 200, "good", 2), event("c", 60, 300, "good", 3)]);
  assert.equal(speed.count, 3);
  assert.equal(speed.hasTrend, false);
  assert.equal(speed.trend, "unknown");
  assert.equal(speed.averageCpm, 200);
});

check("getting faster is reported as faster", () => {
  // 100, 100 then 200, 200 字/分.
  const speed = readingSpeed([
    event("a", 60, 100, "good", 1),
    event("b", 60, 100, "good", 2),
    event("c", 60, 200, "good", 3),
    event("d", 60, 200, "good", 4),
  ]);
  assert.equal(speed.earlierCpm, 100);
  assert.equal(speed.laterCpm, 200);
  assert.equal(speed.changePercent, 100);
  assert.equal(speed.trend, "faster");
  assert.equal(speed.fastestCpm, 200);
});

check("a few percent either way is steady, not progress", () => {
  const speed = readingSpeed([
    event("a", 60, 100, "good", 1),
    event("b", 60, 100, "good", 2),
    event("c", 60, 102, "good", 3),
    event("d", 60, 102, "good", 4),
  ]);
  assert.equal(speed.trend, "steady");
});

check("slowing down is reported too", () => {
  const speed = readingSpeed([
    event("a", 60, 300, "good", 1),
    event("b", 60, 300, "good", 2),
    event("c", 60, 150, "good", 3),
    event("d", 60, 150, "good", 4),
  ]);
  assert.equal(speed.trend, "slower");
  assert.equal(speed.changePercent, -50);
});

check("accuracy counts the runs where every question was right", () => {
  const speed = readingSpeed([
    event("a", 60, 300, "good", 1),
    event("b", 60, 300, "hard", 2),
    event("c", 60, 300, "hard", 3),
    event("d", 60, 300, "good", 4),
  ]);
  assert.equal(speed.accuracy, 50);
});

check("re-reading the same article is a second run, not a duplicate", () => {
  // The whole point of the figure is that the second read should be faster.
  const first = { ...event("a", 120, 600, "good", 1), cardId: "reading-1" };
  const second = { ...event("b", 60, 600, "good", 8), cardId: "reading-1" };
  const speed = readingSpeed([first, second]);
  assert.equal(speed.count, 2);
  assert.equal(speed.latest.cpm, 600);
});

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: "reading speed" }, null, 2));
