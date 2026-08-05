// Tests for the archived monthly report.
//
// The report is easy to get subtly wrong, and has been twice: once by mixing the
// selected month's header with today's numbers, and once by counting work done
// in August towards July because cardProgress only keeps the latest rating. Both
// failures look plausible on screen, so they get explicit cases here.
import assert from "node:assert/strict";
import {
  buildMonthlyReport,
  periodEndDate,
  ratingsAsOf,
  reportablePeriods,
} from "../src/monthlyReport.js";

const failures = [];
const check = (name, fn) => {
  try {
    fn();
  } catch (error) {
    failures.push({ name, message: error.message });
  }
};

// Two words unlocked in July, two more in August.
const data = {
  vocabulary: [
    { id: "v-jul-1", unlockPeriod: "115-07" },
    { id: "v-jul-2", unlockPeriod: "115-07" },
    { id: "v-aug-1", unlockPeriod: "115-08" },
    { id: "v-aug-2", unlockPeriod: "115-08" },
  ],
  grammar: [{ id: "g-jul-1", unlockPeriod: "115-07" }],
  reading: [{ id: "r-jul-1", unlockPeriod: "115-07" }],
  listening: [],
  index: {
    unlockSchedule: [
      { period: "115-07", vocabulary: 400, grammar: 30 },
      { period: "115-08", vocabulary: 800, grammar: 60 },
    ],
  },
};

const ev = (cardId, rating, occurredAt, extra = {}) => ({
  id: `${cardId}-${occurredAt}`,
  cardId,
  rating,
  occurredAt,
  ...extra,
});

const JULY = "2026-07-15T10:00:00.000Z";
const AUGUST = "2026-08-03T10:00:00.000Z";
const NOW = new Date("2026-08-05T12:00:00.000Z");

// v-jul-1 learned in July; v-jul-2 not until August.
const events = [
  ev("v-jul-1", "good", JULY),
  ev("g-jul-1", "easy", JULY),
  ev("r-jul-1", "hard", JULY),
  ev("v-jul-2", "good", AUGUST),
  ev("v-aug-1", "good", AUGUST),
];
const progress = {
  "v-jul-1": { rating: "good", updatedAt: JULY },
  "g-jul-1": { rating: "easy", updatedAt: JULY },
  "r-jul-1": { rating: "hard", updatedAt: JULY },
  "v-jul-2": { rating: "good", updatedAt: AUGUST },
  "v-aug-1": { rating: "good", updatedAt: AUGUST },
};

const july = () => buildMonthlyReport({ data, progress, events, period: "115-07", now: NOW });
const august = () => buildMonthlyReport({ data, progress, events, period: "115-08", now: NOW });

// ------------------------------------------------------------------ the bug
check("a past month does not count work done after it", () => {
  // v-jul-2 is July material but was not learned until August, so July must not
  // count it. This is the regression the learner reported.
  assert.equal(july().completedTotal, 3, "July: v-jul-1 + g-jul-1 + r-jul-1");
});

check("that work does show up in the month it happened", () => {
  assert.equal(august().completedThisMonth, 2, "v-jul-2 and v-aug-1 finished in August");
});

check("cumulative totals still accumulate", () => {
  assert.equal(august().completedTotal, 5, "3 carried in plus 2 new");
});

// ------------------------------------------------------------------ scoping
check("unlocked totals are scoped to the month, not to today", () => {
  assert.equal(july().unlockedTotal, 4, "2 vocab + 1 grammar + 1 reading");
  assert.equal(august().unlockedTotal, 6, "plus the two August words");
});

check("newly released material is counted per month", () => {
  assert.equal(july().newTotal, 4);
  assert.equal(august().newTotal, 2);
});

check("planned figures come from that month's row", () => {
  assert.equal(july().planned.vocabulary, 400);
  assert.equal(august().planned.vocabulary, 800);
});

check("study events are counted in the calendar month they happened", () => {
  assert.equal(july().events, 3);
  assert.equal(august().events, 2);
});

check("completion rate uses that month's own numerator and denominator", () => {
  assert.equal(july().rate, Math.round((3 / 4) * 100));
  assert.equal(august().rate, Math.round((5 / 6) * 100));
});

// ------------------------------------------------------------------ rules
check("only 記得 and above count for vocabulary and grammar", () => {
  const weak = buildMonthlyReport({
    data,
    progress: { "v-jul-1": { rating: "hard", updatedAt: JULY } },
    events: [ev("v-jul-1", "hard", JULY)],
    period: "115-07",
    now: NOW,
  });
  assert.equal(weak.completedTotal, 0, "hard does not count for a word");
});

check("reading and listening count as soon as they are answered", () => {
  const answered = buildMonthlyReport({
    data,
    progress: { "r-jul-1": { rating: "hard", updatedAt: JULY } },
    events: [ev("r-jul-1", "hard", JULY)],
    period: "115-07",
    now: NOW,
  });
  assert.equal(answered.completedTotal, 1, "hard still counts for a reading");
});

check("quiz events never overwrite a card rating", () => {
  // A quiz answer logs rating: "quiz-correct", which is not a card rating.
  const withQuiz = buildMonthlyReport({
    data,
    progress,
    events: [...events, ev("v-jul-1", "quiz-correct", JULY, { type: "quiz" })],
    period: "115-07",
    now: NOW,
  });
  assert.equal(withQuiz.completedTotal, 3, "still counted as 記得");
});

check("the latest rating before the cutoff wins", () => {
  const downgraded = ratingsAsOf(
    [ev("v-jul-1", "good", "2026-07-01T00:00:00.000Z"), ev("v-jul-1", "hard", JULY)],
    {},
    periodEndDate("115-07"),
  );
  assert.equal(downgraded.get("v-jul-1"), "hard");
});

check("progress with no study log falls back to its own timestamp", () => {
  const migrated = ratingsAsOf([], { "v-jul-1": { rating: "good", updatedAt: JULY } }, periodEndDate("115-07"));
  assert.equal(migrated.get("v-jul-1"), "good");
  const tooLate = ratingsAsOf([], { "v-jul-2": { rating: "good", updatedAt: AUGUST } }, periodEndDate("115-07"));
  assert.equal(tooLate.has("v-jul-2"), false);
});

// ------------------------------------------------------------------ current
check("the month in progress reports up to now, not to month end", () => {
  const current = august();
  assert.equal(current.isCurrentMonth, true);
  assert.equal(current.cutoff, NOW.toISOString());
});

check("a finished month is not treated as current", () => {
  assert.equal(july().isCurrentMonth, false);
  assert.equal(july().cutoff, periodEndDate("115-07").toISOString());
});

check("only released months can be reported on", () => {
  assert.deepEqual(reportablePeriods("115-08"), ["115-07", "115-08"]);
  assert.equal(reportablePeriods("116-06").length, 12);
});

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, cases: 15 }, null, 2));
