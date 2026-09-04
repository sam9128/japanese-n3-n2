// How much new material is allowed to open, and when.
//
// Three gates stack:
//   1. Month gate  - which period's material exists at all (see unlockedThrough).
//   2. Weekly cap  - how much of it may be opened this week.
//   3. Batch gate  - a batch opens only once the previous one is fully "記得".
//
// The weekly cap is cumulative rather than per-week. A strict per-week reset
// would mean a week spent behind is lost for good; cumulative lets a slow week
// be made up later while still stopping a whole month being cleared in one day,
// because batches themselves only advance on mastery.
import { PERIODS, currentRocPeriod } from "./data.js";

export const PLAN_START = "2026-07-01";
export const WEEKLY_QUOTA = { vocabulary: 100, grammar: 15 };
export const BATCH_SIZE = { vocabulary: 5, grammar: 1 };

const DAY_MS = 86400000;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Monday of the week containing `date`. Sunday counts as the end of the week.
export function mondayOf(date) {
  const day = startOfDay(date);
  const weekday = (day.getDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - weekday);
}

// The plan opens on 2026-07-01 (a Wednesday); week 1 is the Monday-anchored week
// that contains it, so the very first week is a short one.
export function planWeekAnchor() {
  return mondayOf(new Date(`${PLAN_START}T00:00:00`));
}

export function weekIndex(date = new Date()) {
  const anchor = planWeekAnchor();
  const thisMonday = mondayOf(date);
  return Math.max(0, Math.round((thisMonday - anchor) / (7 * DAY_MS)));
}

export function nextWeekStart(date = new Date()) {
  const monday = mondayOf(date);
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
}

// Cumulative allowance: by week N (0-based) the learner may have opened
// (N+1) x quota of each category.
export function weeklyAllowance(date = new Date()) {
  const weeks = weekIndex(date) + 1;
  return {
    vocabulary: weeks * WEEKLY_QUOTA.vocabulary,
    grammar: weeks * WEEKLY_QUOTA.grammar,
    week: weeks,
  };
}

// The furthest period whose material is available, derived from today's date and
// never persisted. Persisting this was the bug that pinned learners to whichever
// month they first opened the app.
export function unlockedThrough(date = new Date()) {
  const period = currentRocPeriod(date);
  const index = PERIODS.indexOf(period);
  if (index >= 0) return period;
  // Before the plan starts, only the first period; after it ends, everything.
  return date < new Date(`${PLAN_START}T00:00:00`) ? PERIODS[0] : PERIODS.at(-1);
}

/**
 * Which round each grammar pattern belongs to.
 *
 * Slicing patterns off the front the way words are sliced put every pattern a
 * month had into its first rounds: 440 words against 38 patterns meant rounds 1
 * to 13 carried all the grammar and rounds 14 to 74 carried none. Spacing them
 * evenly instead — first pattern in the first round, last in the last — keeps a
 * round to at most one pattern and spreads them over the whole month.
 *
 * The batch count is never smaller than the pattern count, so the step is never
 * below 1 and two patterns can never land in the same round.
 */
function grammarRounds(grammarCount, rounds) {
  const slots = Array.from({ length: rounds }, () => []);
  if (!grammarCount || !rounds) return slots;
  const step = grammarCount > 1 ? (rounds - 1) / (grammarCount - 1) : 0;
  for (let index = 0; index < grammarCount; index += 1) {
    const round = grammarCount > 1 ? Math.round(index * step) : 0;
    slots[Math.min(rounds - 1, round)].push(index);
  }
  return slots;
}

// A round is 5 words and 1 grammar pattern. A month holds far more words than
// patterns, so the rounds between two patterns are words only.
export function buildDailyBatches(vocabulary, grammar) {
  const count = Math.max(
    Math.ceil(vocabulary.length / BATCH_SIZE.vocabulary),
    Math.ceil(grammar.length / BATCH_SIZE.grammar),
  );
  const slots = grammarRounds(grammar.length, count);
  return Array.from({ length: count }, (_, index) => [
    ...vocabulary.slice(index * BATCH_SIZE.vocabulary, (index + 1) * BATCH_SIZE.vocabulary),
    ...slots[index].map((position) => grammar[position]),
  ]).filter((batch) => batch.length);
}

// How many batches this week's allowance covers, given what the month has unlocked.
export function allowedBatchCount(unlockedVocabCount, unlockedGrammarCount, date = new Date()) {
  const allowance = weeklyAllowance(date);
  const vocabulary = Math.min(allowance.vocabulary, unlockedVocabCount);
  const grammar = Math.min(allowance.grammar, unlockedGrammarCount);
  return Math.max(
    Math.ceil(vocabulary / BATCH_SIZE.vocabulary),
    Math.ceil(grammar / BATCH_SIZE.grammar),
  );
}

export function completedBatchCount(batches, isMastered) {
  let completed = 0;
  for (const batch of batches) {
    if (!batch.every(isMastered)) break;
    completed += 1;
  }
  return completed;
}

/**
 * Decide what the Today view should show.
 *
 * Returns the batch to study, or review mode when this week's allowance is spent:
 * finishing a batch still opens the next one immediately, but only up to the
 * weekly cap, after which the learner drills what they have already opened until
 * the next Monday lifts the cap.
 */
export function planToday({ vocabulary, grammar, isMastered, date = new Date() }) {
  const batches = buildDailyBatches(vocabulary, grammar);
  const allowed = allowedBatchCount(vocabulary.length, grammar.length, date);
  const completed = completedBatchCount(batches, isMastered);
  const exhaustedMonth = completed >= batches.length;
  const cappedByWeek = !exhaustedMonth && completed >= allowed;
  return {
    batches,
    allowedBatches: allowed,
    completedBatches: completed,
    batchIndex: Math.min(completed, Math.max(0, allowed - 1)),
    cards: cappedByWeek || exhaustedMonth ? [] : batches[completed] || [],
    reviewMode: cappedByWeek || exhaustedMonth,
    reviewReason: exhaustedMonth ? "month" : cappedByWeek ? "week" : null,
    nextUnlockAt: nextWeekStart(date),
    allowance: weeklyAllowance(date),
  };
}
