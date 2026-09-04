// Tests for the three unlock gates: month, weekly cap, and per-batch mastery.
//
// These are the rules a learner actually feels, and two of them were previously
// wrong (the month never advanced, and there was no weekly cap at all), so they
// get explicit cases rather than being left to manual clicking.
import assert from "node:assert/strict";
import {
  allowedBatchCount,
  buildDailyBatches,
  BATCH_SIZE,
  mondayOf,
  nextWeekStart,
  planToday,
  unlockedThrough,
  weekIndex,
  weeklyAllowance,
  WEEKLY_QUOTA,
} from "../src/unlockSchedule.js";

const failures = [];
const check = (name, fn) => {
  try {
    fn();
  } catch (error) {
    failures.push({ name, message: error.message });
  }
};

const d = (iso) => new Date(`${iso}T09:00:00`);
const makeItems = (prefix, count) =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i + 1}` }));
const masterAll = () => true;
const masterNone = () => false;
const masterFirst = (n) => (item) => {
  const index = Number(item.id.split("-").pop());
  return item.id.startsWith("v") ? index <= n.v : index <= n.g;
};
// Grammar is spread across the month rather than sliced off the front, so "the
// first N batches are done" is no longer a count of words and a count of
// patterns. Ask the batches themselves which cards that is.
const masterFirstBatches = (vocabulary, grammar, batchCount) => {
  const done = new Set(
    buildDailyBatches(vocabulary, grammar)
      .slice(0, batchCount)
      .flat()
      .map((card) => card.id),
  );
  return (item) => done.has(item.id);
};

// ---------------------------------------------------------------- week anchor
check("plan starts in week 0 and Sunday still counts as that week", () => {
  assert.equal(weekIndex(d("2026-07-01")), 0, "Wednesday the plan opens");
  assert.equal(weekIndex(d("2026-07-05")), 0, "the Sunday that closes week 1");
});

check("Monday starts the next week", () => {
  assert.equal(weekIndex(d("2026-07-06")), 1);
  assert.equal(weekIndex(d("2026-07-13")), 2);
});

check("mondayOf snaps to the Monday of that week", () => {
  assert.equal(mondayOf(d("2026-07-05")).getDate(), 29, "Sun 5 Jul -> Mon 29 Jun");
  assert.equal(mondayOf(d("2026-07-06")).getDate(), 6);
});

check("nextWeekStart is the coming Monday at midnight", () => {
  const next = nextWeekStart(d("2026-07-02"));
  assert.equal(next.getDay(), 1);
  assert.equal(next.getDate(), 6);
  assert.equal(next.getHours(), 0);
});

// ---------------------------------------------------------------- allowance
check("allowance is cumulative, so a slow week can still be made up", () => {
  assert.deepEqual(weeklyAllowance(d("2026-07-01")), {
    vocabulary: 100,
    grammar: 15,
    week: 1,
  });
  assert.deepEqual(weeklyAllowance(d("2026-07-27")), {
    vocabulary: 500,
    grammar: 75,
    week: 5,
  });
});

check("allowance never opens more than the month has unlocked", () => {
  // Week 5 would allow 500 words, but only 400 exist in the first period.
  assert.equal(allowedBatchCount(400, 30, d("2026-07-27")), Math.ceil(400 / BATCH_SIZE.vocabulary));
});

check("week 1 caps the first month at one week of material", () => {
  const batches = allowedBatchCount(400, 60, d("2026-07-01"));
  assert.equal(
    batches,
    Math.max(
      Math.ceil(100 / BATCH_SIZE.vocabulary),
      Math.ceil(15 / BATCH_SIZE.grammar),
    ),
  );
});

// ---------------------------------------------------------------- batching
check("a round is 5 words and 1 grammar pattern", () => {
  const batches = buildDailyBatches(makeItems("v", 440), makeItems("g", 38));
  assert.equal(batches.length, 88, "88 rounds of 5 words covers 440 words");
  assert.equal(batches[0].length, 6);
  assert.equal(batches[0].filter((x) => x.id.startsWith("v")).length, 5);
  assert.equal(batches[0].filter((x) => x.id.startsWith("g")).length, 1);
  const perRound = batches.map(
    (batch) => batch.filter((x) => x.id.startsWith("g")).length,
  );
  assert.equal(Math.max(...perRound), 1, "never two patterns in one round");
  assert.equal(
    perRound.reduce((sum, n) => sum + n, 0),
    38,
    "every pattern the month unlocked is still dealt out",
  );
});

// The fault this replaced: slicing patterns off the front like words gave rounds
// 1-13 all 38 patterns and rounds 14-74 none.
check("grammar reaches the end of the month, not just the start", () => {
  const batches = buildDailyBatches(makeItems("v", 440), makeItems("g", 38));
  const rounds = batches
    .map((batch, index) => (batch.some((x) => x.id.startsWith("g")) ? index : -1))
    .filter((index) => index >= 0);
  assert.equal(rounds[0], 0, "first pattern in the first round");
  assert.equal(rounds.at(-1), batches.length - 1, "last pattern in the last round");
  const gaps = rounds.slice(1).map((round, i) => round - rounds[i]);
  assert.ok(
    Math.max(...gaps) - Math.min(...gaps) <= 1,
    `patterns should be evenly spaced, gaps were ${[...new Set(gaps)].join()}`,
  );
});

// ---------------------------------------------------------------- planToday
check("nothing mastered yet: study the first batch", () => {
  const plan = planToday({
    vocabulary: makeItems("v", 400),
    grammar: makeItems("g", 30),
    isMastered: masterNone,
    date: d("2026-07-01"),
  });
  assert.equal(plan.batchIndex, 0);
  assert.equal(plan.reviewMode, false);
  assert.equal(plan.cards.length, 6);
});

check("finishing a batch opens the next one immediately", () => {
  const plan = planToday({
    vocabulary: makeItems("v", 400),
    grammar: makeItems("g", 30),
    isMastered: masterFirstBatches(makeItems("v", 400), makeItems("g", 30), 1),
    date: d("2026-07-01"),
  });
  assert.equal(plan.completedBatches, 1);
  assert.equal(plan.reviewMode, false, "still under the weekly cap");
  assert.equal(plan.cards[0].id, "v-6", "second round starts at the 6th word");
});

check("hitting the weekly cap switches to review mode, not more material", () => {
  // Week 1 allows 100 words = 20 rounds of 5. Master exactly that much.
  const plan = planToday({
    vocabulary: makeItems("v", 400),
    grammar: makeItems("g", 60),
    isMastered: masterFirstBatches(makeItems("v", 400), makeItems("g", 60), 20),
    date: d("2026-07-01"),
  });
  assert.equal(plan.allowedBatches, 20);
  assert.equal(plan.completedBatches, 20);
  assert.equal(plan.reviewMode, true);
  assert.equal(plan.reviewReason, "week");
  assert.equal(plan.cards.length, 0, "no new cards past the cap");
});

check("the same progress is no longer capped once Monday arrives", () => {
  const args = {
    vocabulary: makeItems("v", 400),
    grammar: makeItems("g", 60),
    isMastered: masterFirstBatches(makeItems("v", 400), makeItems("g", 60), 20),
  };
  const sunday = planToday({ ...args, date: d("2026-07-05") });
  const monday = planToday({ ...args, date: d("2026-07-06") });
  assert.equal(sunday.reviewMode, true);
  assert.equal(monday.reviewMode, false, "week 2 allowance lifts the cap");
  assert.equal(monday.cards.length, 6, "new material without any user action");
});

check("clearing the whole month reports the month reason, not the week", () => {
  const plan = planToday({
    vocabulary: makeItems("v", 12),
    grammar: makeItems("g", 6),
    isMastered: masterAll,
    date: d("2026-11-10"),
  });
  assert.equal(plan.reviewMode, true);
  assert.equal(plan.reviewReason, "month");
});

check("falling behind does not forfeit the missed weeks", () => {
  // Four weeks in, having mastered only one batch: the cap is 400 words, so all
  // the skipped material is still open rather than lost.
  const plan = planToday({
    vocabulary: makeItems("v", 400),
    grammar: makeItems("g", 60),
    isMastered: masterFirstBatches(makeItems("v", 400), makeItems("g", 60), 1),
    date: d("2026-07-27"),
  });
  assert.equal(plan.reviewMode, false);
  assert.equal(plan.allowedBatches, Math.ceil(400 / BATCH_SIZE.vocabulary));
});

// ---------------------------------------------------------------- month gate
check("the unlocked period follows the calendar", () => {
  assert.equal(unlockedThrough(d("2026-07-15")), "115-07");
  assert.equal(unlockedThrough(d("2026-08-04")), "115-08");
  assert.equal(unlockedThrough(d("2026-12-06")), "115-12");
  assert.equal(unlockedThrough(d("2027-06-30")), "116-06");
});

check("dates outside the plan clamp to its ends", () => {
  assert.equal(unlockedThrough(d("2026-05-01")), "115-07");
  assert.equal(unlockedThrough(d("2027-09-01")), "116-06");
});

check("crossing a month boundary opens the next period", () => {
  assert.notEqual(unlockedThrough(d("2026-07-31")), unlockedThrough(d("2026-08-01")));
});

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify(
    { ok: true, weeklyQuota: WEEKLY_QUOTA, batchSize: BATCH_SIZE },
    null,
    2,
  ),
);
