// Figures for one month's report card.
//
// Two things this has to get right, both of which it got wrong before:
//
// 1. The header and the numbers must describe the same month. They used to be
//    driven by different sources, so the card could say July while quoting
//    today's totals.
// 2. A past month must report what was true *then*. cardProgress only stores each
//    card's latest rating with no history, so reading it directly counted a word
//    learned in August towards July. The study log does carry timestamps, so the
//    state at any cutoff is reconstructed by replaying it.
import { PERIODS } from "./data.js";

const STRONG_RATINGS = new Set(["good", "easy"]);
// Ratings a learner can give a card. Quiz events also land in the study log but
// carry rating: "quiz-correct" / "quiz-wrong", which is not a card rating and
// must not overwrite one during replay.
const CARD_RATINGS = new Set(["again", "hard", "good", "easy"]);
// Vocabulary and grammar only count once they reach 記得; reading and listening
// count as soon as they are answered. Same rule the daily pace uses.
const CATEGORIES = [
  { key: "vocabulary", label: "單字", strongOnly: true },
  { key: "grammar", label: "文法", strongOnly: true },
  { key: "reading", label: "閱讀", strongOnly: false },
  { key: "listening", label: "聽力", strongOnly: false },
];

export function periodToCalendarPrefix(period) {
  const [rocYear, month] = period.split("-");
  return `${Number(rocYear) + 1911}-${month}`;
}

export function periodStartDate(period) {
  const [rocYear, month] = period.split("-").map(Number);
  return new Date(rocYear + 1911, month - 1, 1);
}

export function periodEndDate(period) {
  const [rocYear, month] = period.split("-").map(Number);
  return new Date(rocYear + 1911, month, 0, 23, 59, 59, 999);
}

/**
 * The rating each card held at `cutoff`, rebuilt from the study log.
 *
 * Returns a Map of cardId -> rating. Cards rated after the cutoff are absent,
 * which is the whole point: a July report must not see August's work.
 */
export function ratingsAsOf(events = [], progress = {}, cutoff = new Date()) {
  const limit = cutoff.toISOString();
  const latest = new Map();
  for (const event of events) {
    if (!event?.cardId || !event.occurredAt) continue;
    if (event.type === "quiz" || !CARD_RATINGS.has(event.rating)) continue;
    if (event.occurredAt > limit) continue;
    const previous = latest.get(event.cardId);
    if (!previous || previous.occurredAt <= event.occurredAt) {
      latest.set(event.cardId, event);
    }
  }
  const ratings = new Map();
  for (const [cardId, event] of latest) ratings.set(cardId, event.rating);
  // Progress migrated from the pre-event storage has no study log to replay, so
  // fall back to the record's own timestamp rather than dropping it entirely.
  for (const [cardId, record] of Object.entries(progress)) {
    if (ratings.has(cardId) || !record?.rating) continue;
    if (record.updatedAt && record.updatedAt <= limit) {
      ratings.set(cardId, record.rating);
    }
  }
  return ratings;
}

function countCompleted(items, ratings, strongOnly) {
  return items.filter((item) => {
    const rating = ratings.get(item.id);
    if (!rating) return false;
    return strongOnly ? STRONG_RATINGS.has(rating) : true;
  }).length;
}

/**
 * Summarise one period.
 *
 * `completedTotal` is cumulative to the end of that month; `completedThisMonth`
 * is what was newly finished during it, which is what a monthly report is
 * actually asking about.
 */
export function buildMonthlyReport({
  data,
  progress = {},
  events = [],
  period,
  now = new Date(),
}) {
  const index = PERIODS.indexOf(period);
  const monthEnd = periodEndDate(period);
  const isCurrentMonth = monthEnd >= now;
  // For the month in progress there is no "end of month" yet, so the cutoff is
  // simply now; the report then matches what the learner sees elsewhere.
  const cutoff = isCurrentMonth ? now : monthEnd;
  const previousEnd = index > 0 ? periodEndDate(PERIODS[index - 1]) : periodStartDate(PERIODS[0]);

  const atCutoff = ratingsAsOf(events, progress, cutoff);
  const atPreviousEnd = ratingsAsOf(events, progress, previousEnd);

  const categories = CATEGORIES.map(({ key, label, strongOnly }) => {
    const items = data[key] || [];
    const unlocked = items.filter((item) => {
      const at = PERIODS.indexOf(item.unlockPeriod);
      return at >= 0 && at <= index;
    });
    const completed = countCompleted(unlocked, atCutoff, strongOnly);
    const completedBefore = countCompleted(unlocked, atPreviousEnd, strongOnly);
    return {
      key,
      label,
      unlocked: unlocked.length,
      newThisMonth: items.filter((item) => item.unlockPeriod === period).length,
      completed,
      completedThisMonth: Math.max(0, completed - completedBefore),
    };
  });

  const sum = (field) => categories.reduce((total, item) => total + item[field], 0);
  const unlockedTotal = sum("unlocked");
  const completedTotal = sum("completed");

  const prefix = periodToCalendarPrefix(period);
  const monthEvents = events.filter((event) => event.occurredAt?.startsWith(prefix));
  const planned = (data.index?.unlockSchedule || []).find((x) => x.period === period);

  return {
    period,
    isCurrentMonth,
    cutoff: cutoff.toISOString(),
    planned: {
      vocabulary: planned?.vocabulary ?? 0,
      grammar: planned?.grammar ?? 0,
    },
    categories,
    unlockedTotal,
    completedTotal,
    completedThisMonth: sum("completedThisMonth"),
    newTotal: sum("newThisMonth"),
    rate: unlockedTotal ? Math.round((completedTotal / unlockedTotal) * 100) : 0,
    events: monthEvents.length,
  };
}

// Only months whose material has been released can be reported on.
export function reportablePeriods(unlockedThrough) {
  const limit = PERIODS.indexOf(unlockedThrough);
  return limit < 0 ? [PERIODS[0]] : PERIODS.slice(0, limit + 1);
}
