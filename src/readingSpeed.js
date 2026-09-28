/**
 * Reading and listening speed, from the study events that recorded a clock.
 *
 * The 閱讀聽力 page always had a stopwatch, but the number only ever lived on
 * screen: moving to the next article reset it and nothing was written down. So
 * the plan's 116/05 line — 強化長文解析速度與正確率 — had accuracy and no speed.
 * The event now carries `seconds`, and for a 読解 item the character count of the
 * passage, which is what makes 字/分 comparable between a short notice and a long
 * article.
 */

// A tap-through is not a reading, and a run left on the clock over lunch is not
// one either. Both would swamp an average built from a handful of articles.
const MIN_SECONDS = 5;
const MAX_CPM = 2000;
// Below this many runs a "trend" is one good day, so we report the average only.
const TREND_MIN_RUNS = 4;

const mean = (list) =>
  list.length ? Math.round(list.reduce((sum, n) => sum + n, 0) / list.length) : 0;

/** Every usable timed run, oldest first. */
export function readingRuns(events = []) {
  return events
    .filter((event) => {
      const seconds = Number(event?.seconds) || 0;
      const chars = Number(event?.chars) || 0;
      if (chars <= 0 || seconds < MIN_SECONDS) return false;
      return (chars / seconds) * 60 <= MAX_CPM;
    })
    .map((event) => ({
      id: event.id,
      cardId: event.cardId,
      at: event.occurredAt,
      seconds: Number(event.seconds),
      chars: Number(event.chars),
      cpm: Math.round((Number(event.chars) / Number(event.seconds)) * 60),
      // rate() records "good" only when every question on the item was right.
      allCorrect: event.rating === "good",
    }))
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

/**
 * One reading of the learner's speed: the latest run, the average, and whether
 * the later half of their runs is faster than the earlier half.
 *
 * A card can be re-read, so runs are not deduplicated — re-reading the same
 * article faster is exactly the progress this is meant to show.
 */
export function readingSpeed(events = []) {
  const runs = readingRuns(events);
  const cpms = runs.map((run) => run.cpm);
  const half = Math.floor(runs.length / 2);
  const earlier = mean(cpms.slice(0, half));
  const later = mean(cpms.slice(runs.length - half));
  const hasTrend = runs.length >= TREND_MIN_RUNS && earlier > 0;
  const changePercent = hasTrend
    ? Math.round(((later - earlier) / earlier) * 100)
    : 0;
  return {
    runs,
    count: runs.length,
    latest: runs.at(-1) || null,
    averageCpm: mean(cpms),
    fastestCpm: cpms.length ? Math.max(...cpms) : 0,
    earlierCpm: earlier,
    laterCpm: later,
    hasTrend,
    changePercent,
    // A few percent either way is noise, not progress.
    trend: !hasTrend
      ? "unknown"
      : changePercent >= 5
        ? "faster"
        : changePercent <= -5
          ? "slower"
          : "steady",
    accuracy: runs.length
      ? Math.round((runs.filter((run) => run.allCorrect).length / runs.length) * 100)
      : 0,
  };
}
