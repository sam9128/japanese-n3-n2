// What an answer does to a card's record.
//
// The study flow used to be flip-the-card then rate yourself, so `rating` came
// straight from the learner. It now comes from answering a question, which
// creates a problem the self-rating did not have: a four-option question is
// right one time in four by chance, and `rating` is what unlocks the next batch
// of new material. Marking a card learned on one correct answer would let a
// guess open new lessons.
//
// So a card needs two correct answers in a row, and — enforced by the caller —
// at most one of them per round, meaning they cannot both come from the same
// pass through the batch.

export const MASTERY_STREAK = 2;

/**
 * The next `streak` and `rating` for a card, given how it was just answered.
 *
 * Ratings keep their existing meanings because everything downstream reads
 * them: `unlockSchedule` opens the next batch when every card is good/easy,
 * and the monthly report and daily pace both count good/easy as complete.
 * Nothing there had to change — only where the rating comes from.
 *
 * "hard" carries the in-between state of answered-right-once. It is not a
 * perfect fit for the label 有點難, but it is the only non-mastered rating that
 * is not 再一次, and it behaves correctly: the card still shows as outstanding
 * and still blocks the batch.
 */
export function nextProgressFromAnswer(previous = {}, correct) {
  if (!correct) return { streak: 0, rating: "again" };
  const streak = (Number(previous.streak) || 0) + 1;
  return { streak, rating: streak >= MASTERY_STREAK ? "good" : "hard" };
}

// The escape hatch for a word the learner already knows cold. Sets the streak to
// the mastery threshold as well, so a later wrong answer drops it to a genuine
// zero rather than to a value that would re-master it on the next correct one.
export function markAlreadyKnown() {
  return { streak: MASTERY_STREAK, rating: "easy" };
}

export const isMasteredRating = (rating) => rating === "good" || rating === "easy";

/**
 * The cards a round should ask about: everything in the batch not yet mastered.
 *
 * A round asks each outstanding card exactly once, which is what keeps a streak
 * from being filled twice in the same pass. Cards answered wrong simply come
 * back in the next round, so there is no separate re-queue to keep in sync.
 */
export function roundCards(batch = [], progress = {}) {
  return batch.filter((item) => !isMasteredRating(progress[item.id]?.rating));
}
