// Tests for when the Today view tells a learner to go do 閱讀聽力 instead.
//
// The nudge is advice, not a gate, so the cost of getting it wrong is not a
// broken screen — it is a banner that is either permanently on (and therefore
// ignored) or never on (and therefore pointless). Both failure modes are quiet,
// which is exactly why they are worth a test.
import assert from "node:assert/strict";
import { studyBalance } from "../src/studyBalance.js";

const failures = [];
const check = (name, fn) => {
  try {
    fn();
  } catch (error) {
    failures.push({ name, message: error.message });
  }
};

// A month roughly the shape of a real one: ~12 cards a day, a couple of media
// items a day.
const pace = ({
  vocab = [100, 100],
  grammar = [18, 18],
  reading = [6, 6],
  listening = [8, 8],
  cardTarget = [10, 2],
  ...rest
} = {}) => ({
  beforePlan: false,
  afterPlan: false,
  ...rest,
  categories: [
    { key: "vocabulary", actual: vocab[0], expected: vocab[1], todayTarget: cardTarget[0] },
    { key: "grammar", actual: grammar[0], expected: grammar[1], todayTarget: cardTarget[1] },
    { key: "reading", actual: reading[0], expected: reading[1], todayTarget: 1 },
    { key: "listening", actual: listening[0], expected: listening[1], todayTarget: 1 },
  ],
});

// -------------------------------------------------------------- the threshold
check("being a card or two ahead is not 'ahead'", () => {
  // The daily card target is 12 here, so +3 is well inside one day's noise.
  const balance = studyBalance(pace({ vocab: [103, 100], reading: [0, 6] }));
  assert.equal(balance.cardsDelta, 3);
  assert.equal(balance.ahead, false);
  assert.equal(balance.suggestMedia, false);
});

check("a full day's surplus is", () => {
  const balance = studyBalance(pace({ vocab: [112, 100], reading: [0, 6] }));
  assert.equal(balance.cardsDelta, 12);
  assert.equal(balance.ahead, true);
  assert.equal(balance.suggestMedia, true);
});

check("the threshold scales with the daily target", () => {
  // Late in a month the daily target shrinks, so a smaller surplus counts.
  const small = studyBalance(
    pace({ vocab: [104, 100], cardTarget: [3, 1], reading: [0, 6] }),
  );
  assert.equal(small.dailyCardTarget, 4);
  assert.equal(small.ahead, true);
});

check("a zero daily target cannot make everything 'ahead'", () => {
  // On the last day of a month the target reaches zero, and `delta >= 0` would
  // otherwise be true for a learner who is exactly on pace.
  const balance = studyBalance(pace({ cardTarget: [0, 0] }));
  assert.equal(balance.dailyCardTarget, 1);
  assert.equal(balance.cardsDelta, 0);
  assert.equal(balance.ahead, false);
});

// ------------------------------------------------------------- the two halves
check("a card surplus is not netted against a media shortfall", () => {
  // The pace card's own delta is 0 here — +14 cards, -14 media — and reads
  // "符合進度". Split apart, it is the exact case the nudge exists for.
  const balance = studyBalance(
    pace({ vocab: [114, 100], reading: [0, 6], listening: [0, 8] }),
  );
  assert.equal(balance.cardsDelta, 14);
  assert.equal(balance.mediaOwed, 14);
  assert.equal(balance.suggestMedia, true);
});

check("media owed is counted per section", () => {
  const balance = studyBalance(pace({ reading: [2, 6], listening: [1, 8] }));
  assert.equal(balance.reading, 4);
  assert.equal(balance.listening, 7);
  assert.equal(balance.mediaOwed, 11);
});

check("being ahead on media never reports as negative owed", () => {
  const balance = studyBalance(pace({ reading: [20, 6], listening: [20, 8] }));
  assert.equal(balance.reading, 0);
  assert.equal(balance.listening, 0);
  assert.equal(balance.mediaOwed, 0);
});

// ------------------------------------------------------------- when to shut up
check("no nudge when there is nowhere to send them", () => {
  const balance = studyBalance(
    pace({ vocab: [130, 100], reading: [6, 6], listening: [8, 8] }),
  );
  assert.equal(balance.ahead, true);
  assert.equal(
    balance.suggestMedia,
    false,
    "ahead on cards and caught up on media is not a problem to report",
  );
});

check("no nudge before or after the plan window", () => {
  // Outside the window the expected totals are pinned to 0 or to the whole year,
  // so the delta describes the plan rather than today.
  for (const flag of ["beforePlan", "afterPlan"]) {
    const balance = studyBalance(
      pace({ vocab: [130, 100], reading: [0, 6], [flag]: true }),
    );
    assert.equal(balance.ahead, false, flag);
    assert.equal(balance.suggestMedia, false, flag);
  }
});

check("behind on cards never suggests skipping them", () => {
  const balance = studyBalance(pace({ vocab: [60, 100], reading: [0, 6] }));
  assert.equal(balance.cardsDelta, -40);
  assert.equal(balance.ahead, false);
  assert.equal(balance.suggestMedia, false);
});

// ---------------------------------------------------------------- the wording
check("daysAhead never goes negative", () => {
  // It is interpolated straight into the banner; a "約 -3 天份" would ship.
  const balance = studyBalance(pace({ vocab: [40, 100] }));
  assert.equal(balance.daysAhead, 0);
});

check("a missing or empty pace object does not throw", () => {
  // The Today view renders before the first pace calculation settles.
  for (const input of [undefined, null, {}, { categories: [] }]) {
    const balance = studyBalance(input);
    assert.equal(balance.suggestMedia, false);
    assert.equal(balance.mediaOwed, 0);
  }
});

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, cases: 12 }, null, 2));
