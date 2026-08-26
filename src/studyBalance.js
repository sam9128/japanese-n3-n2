// Whether the learner is far enough ahead on cards that their time is better
// spent on 閱讀 and 聽力 — and how much those two still owe this month.
//
// The Today view only ever teaches 單字 and 文法. Running ahead there is not the
// same as being ahead overall, and the pace card's own `delta` cannot tell the
// difference: it sums all four categories, so a big card surplus quietly cancels
// an equally big media shortfall and the total reads "on track" while half the
// exam goes untouched. Measuring the two halves separately is the whole point of
// this file.
//
// Nothing here decides what is *allowed* to open — that stays in
// `unlockSchedule`. This only decides what to recommend.

const CARD_KEYS = new Set(["vocabulary", "grammar"]);

function sumOf(categories, keys, field) {
  return categories.reduce(
    (total, item) => (keys.has(item.key) ? total + (Number(item[field]) || 0) : total),
    0,
  );
}

/**
 * Read a pace object (from `calculateDailyProgress`) as a study recommendation.
 *
 * `ahead` deliberately requires a whole day's worth of surplus rather than a
 * single card. The daily card target is around a dozen, so a delta of +1 is
 * noise — nudging on it would put the banner on screen almost permanently,
 * which is the fastest way to make a learner stop reading it.
 */
export function studyBalance(pace) {
  const categories = pace?.categories || [];
  const byKey = new Map(categories.map((item) => [item.key, item]));
  const owed = (key) => {
    const item = byKey.get(key);
    return Math.max(0, (Number(item?.expected) || 0) - (Number(item?.actual) || 0));
  };
  const cardsDelta =
    sumOf(categories, CARD_KEYS, "actual") - sumOf(categories, CARD_KEYS, "expected");
  // Self-scaling: the daily target shrinks as a month runs out, and so does the
  // surplus needed to count as ahead. The floor of 1 covers the last day, when
  // the target can reach zero and every comparison would otherwise be true.
  const dailyCardTarget = Math.max(1, sumOf(categories, CARD_KEYS, "todayTarget"));
  const reading = owed("reading");
  const listening = owed("listening");
  const mediaOwed = reading + listening;
  // Outside the plan window the expected totals are pinned to 0 or to the full
  // year, so neither figure describes today and no nudge should be drawn from it.
  const withinPlan = Boolean(pace) && !pace.beforePlan && !pace.afterPlan;
  const ahead = withinPlan && cardsDelta >= dailyCardTarget;
  return {
    cardsDelta,
    dailyCardTarget,
    daysAhead: Math.floor(Math.max(0, cardsDelta) / dailyCardTarget),
    reading,
    listening,
    mediaOwed,
    ahead,
    // Only worth saying when there is somewhere to send them.
    suggestMedia: ahead && mediaOwed > 0,
  };
}
