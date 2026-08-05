// Figures for one month's report card.
//
// The report used to reuse the daily-pace numbers, which are always about today,
// while its header followed a browsing selection — so the card could claim to be
// July's report while quoting August's totals. Everything here is scoped to the
// period passed in, so a past month reports what that month actually looked like.
import { PERIODS } from "./data.js";

const STRONG_RATINGS = new Set(["good", "easy"]);
// Vocabulary and grammar only count once they reach 記得; reading and listening
// count as soon as they are answered. Same rule the daily pace uses.
const CATEGORIES = [
  { key: "vocabulary", label: "單字", strongOnly: true },
  { key: "grammar", label: "文法", strongOnly: true },
  { key: "reading", label: "閱讀", strongOnly: false },
  { key: "listening", label: "聽力", strongOnly: false },
];

function isCompleted(item, progress, strongOnly) {
  const record = progress[item.id];
  return strongOnly ? STRONG_RATINGS.has(record?.rating) : Boolean(record);
}

export function periodToCalendarPrefix(period) {
  const [rocYear, month] = period.split("-");
  return `${Number(rocYear) + 1911}-${month}`;
}

export function periodEndDate(period) {
  const [rocYear, month] = period.split("-").map(Number);
  return new Date(rocYear + 1911, month, 0, 23, 59, 59, 999);
}

/**
 * Summarise one period.
 *
 * `unlockedTotal` counts everything available up to and including that month, so
 * a report for July describes July's world even when read in August.
 */
export function buildMonthlyReport({ data, progress = {}, events = [], period }) {
  const index = PERIODS.indexOf(period);
  const categories = CATEGORIES.map(({ key, label, strongOnly }) => {
    const items = data[key] || [];
    const unlocked = items.filter(
      (item) => PERIODS.indexOf(item.unlockPeriod) >= 0 && PERIODS.indexOf(item.unlockPeriod) <= index,
    );
    const newThisMonth = items.filter((item) => item.unlockPeriod === period);
    const completed = unlocked.filter((item) => isCompleted(item, progress, strongOnly));
    return {
      key,
      label,
      unlocked: unlocked.length,
      newThisMonth: newThisMonth.length,
      completed: completed.length,
    };
  });

  const unlockedTotal = categories.reduce((sum, item) => sum + item.unlocked, 0);
  const completedTotal = categories.reduce((sum, item) => sum + item.completed, 0);
  const newTotal = categories.reduce((sum, item) => sum + item.newThisMonth, 0);

  const prefix = periodToCalendarPrefix(period);
  const monthEvents = events.filter((event) => event.occurredAt?.startsWith(prefix));

  const planned = (data.index?.unlockSchedule || []).find((x) => x.period === period);

  return {
    period,
    planned: {
      vocabulary: planned?.vocabulary ?? 0,
      grammar: planned?.grammar ?? 0,
    },
    categories,
    unlockedTotal,
    completedTotal,
    newTotal,
    rate: unlockedTotal ? Math.round((completedTotal / unlockedTotal) * 100) : 0,
    events: monthEvents.length,
    isPast: periodEndDate(period) < new Date(),
  };
}

// Only months whose material has been released can be reported on.
export function reportablePeriods(unlockedThrough) {
  const limit = PERIODS.indexOf(unlockedThrough);
  return limit < 0 ? [PERIODS[0]] : PERIODS.slice(0, limit + 1);
}
