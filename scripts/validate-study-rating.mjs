// Tests for how an answer grades a card.
//
// This rule replaced the learner's own 記得/很熟 judgement, and it feeds straight
// into unlocking: `unlockSchedule` opens the next batch of new material once
// every card in the current one is good/easy. A four-option question is right
// one time in four by chance, so the case that matters most here is that a
// single lucky answer cannot open new lessons.
import assert from "node:assert/strict";
import {
  MASTERY_STREAK,
  isMasteredRating,
  markAlreadyKnown,
  nextProgressFromAnswer,
  roundCards,
} from "../src/studyRating.js";

const failures = [];
const check = (name, fn) => {
  try {
    fn();
  } catch (error) {
    failures.push({ name, message: error.message });
  }
};

// ------------------------------------------------------------------ the point
check("one correct answer does not master a card", () => {
  const after = nextProgressFromAnswer({}, true);
  assert.equal(after.streak, 1);
  assert.equal(
    isMasteredRating(after.rating),
    false,
    "a single correct answer is a 1-in-4 guess; it must not unlock new material",
  );
});

check("two correct answers in a row do", () => {
  const first = nextProgressFromAnswer({}, true);
  const second = nextProgressFromAnswer(first, true);
  assert.equal(second.streak, MASTERY_STREAK);
  assert.equal(second.rating, "good");
  assert.equal(isMasteredRating(second.rating), true);
});

check("a wrong answer resets the streak", () => {
  const first = nextProgressFromAnswer({}, true);
  const wrong = nextProgressFromAnswer(first, false);
  assert.equal(wrong.streak, 0);
  assert.equal(wrong.rating, "again");
  // ...and the next correct answer starts from one again, not from two.
  const recovered = nextProgressFromAnswer(wrong, true);
  assert.equal(recovered.streak, 1);
  assert.equal(isMasteredRating(recovered.rating), false);
});

check("a wrong answer un-masters a card that had been mastered", () => {
  const mastered = { streak: 2, rating: "good" };
  const after = nextProgressFromAnswer(mastered, false);
  assert.equal(after.rating, "again");
  assert.equal(after.streak, 0);
});

// ------------------------------------------------------------------ the skip
check("marking a card known masters it immediately", () => {
  const known = markAlreadyKnown();
  assert.equal(known.rating, "easy");
  assert.equal(isMasteredRating(known.rating), true);
});

check("a card marked known does not re-master on one correct answer", () => {
  // Its streak is set to the threshold, so a later wrong answer drops it to a
  // genuine zero rather than to a value one correct answer would restore.
  const known = markAlreadyKnown();
  const wrong = nextProgressFromAnswer(known, false);
  assert.equal(wrong.streak, 0);
  const recovered = nextProgressFromAnswer(wrong, true);
  assert.equal(isMasteredRating(recovered.rating), false);
});

// ------------------------------------------------------------------ the round
check("a round asks only the cards that are not yet mastered", () => {
  const batch = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const progress = {
    a: { rating: "good" },
    b: { rating: "hard" },
    c: { rating: "again" },
    d: { rating: "easy" },
  };
  assert.deepEqual(
    roundCards(batch, progress).map((item) => item.id),
    ["b", "c"],
  );
});

check("an untouched card is outstanding", () => {
  assert.deepEqual(
    roundCards([{ id: "a" }], {}).map((item) => item.id),
    ["a"],
  );
});

check("a round asks each outstanding card once", () => {
  // This is what keeps a streak from being filled twice in one pass: a card
  // appears at most once per round, so its two correct answers cannot both come
  // from the same trip through the batch.
  const batch = [{ id: "a" }, { id: "b" }];
  const asked = roundCards(batch, {}).map((item) => item.id);
  assert.equal(new Set(asked).size, asked.length);
});

check("a fully mastered batch produces an empty round", () => {
  const batch = [{ id: "a" }, { id: "b" }];
  const progress = { a: { rating: "good" }, b: { rating: "easy" } };
  assert.deepEqual(roundCards(batch, progress), []);
});

// ------------------------------------------------- ratings the rest relies on
check("the ratings produced are ones the rest of the app understands", () => {
  // unlockSchedule, monthlyReport and dailyProgress all read these four.
  const known = new Set(["again", "hard", "good", "easy"]);
  const produced = [
    nextProgressFromAnswer({}, false).rating,
    nextProgressFromAnswer({}, true).rating,
    nextProgressFromAnswer({ streak: 1 }, true).rating,
    markAlreadyKnown().rating,
  ];
  for (const rating of produced) {
    assert.ok(known.has(rating), `unknown rating produced: ${rating}`);
  }
});

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, cases: 10 }, null, 2));
