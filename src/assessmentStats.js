/**
 * 檢核與模考分析 — the plan's 115/11 line, 利用數位統計功能分析學習弱點並補強.
 *
 * What existed was a count of cards rated 有點難 and a 只看錯題 filter over cards.
 * Neither says which of the four exam sections is costing marks, and nothing showed
 * whether five mocks in a row were getting better. Both are already in the stored
 * submissions, question by question.
 *
 * Only the latest attempt at a paper counts, the same rule the 專項強化集 uses: a
 * retake is the learner's current standing, not an extra data point.
 */
import { latestAttempts, SECTIONS } from "./weakQuestions.js";

// Below this many questions a percentage is one lucky guess, so no section is
// called the weakest on it.
const MIN_ASKED = 5;
// Fewer papers than this is not a trend.
const TREND_MIN_PAPERS = 3;

const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

/**
 * Right-answer rate per exam section.
 *
 * Unanswered questions are counted as asked-but-not-answered rather than wrong:
 * an early submission would otherwise read as a collapse in whichever sections sit
 * at the end of the paper, which is where the blanks land.
 */
export function sectionAccuracy(assessments = [], results = []) {
  const byId = new Map(assessments.map((item) => [item.id, item]));
  const tally = Object.fromEntries(
    SECTIONS.map((section) => [section, { asked: 0, answered: 0, correct: 0 }]),
  );
  for (const [assessmentId, result] of latestAttempts(results)) {
    const exam = byId.get(assessmentId);
    if (!exam) continue;
    exam.questions.forEach((question, index) => {
      const row = tally[question.section];
      if (!row) return;
      row.asked += 1;
      const picked = result.answers?.[index];
      if (picked === undefined || picked === null) return;
      row.answered += 1;
      if (picked === question.answer) row.correct += 1;
    });
  }
  return SECTIONS.map((section) => ({
    section,
    ...tally[section],
    percent: percent(tally[section].correct, tally[section].answered),
  })).filter((row) => row.asked > 0);
}

/** Each paper's latest score, in the order the learner meets them. */
export function scoreTrend(assessments = [], results = []) {
  const latest = latestAttempts(results);
  return assessments
    .filter((exam) => latest.has(exam.id))
    .map((exam) => {
      const result = latest.get(exam.id);
      return {
        id: exam.id,
        title: exam.title,
        kind: exam.kind,
        level: exam.level,
        period: exam.unlockPeriod,
        threshold: exam.threshold,
        score: Number(result.score) || 0,
        passed: (Number(result.score) || 0) >= exam.threshold,
        completedAt: result.completedAt,
      };
    })
    .sort((a, b) =>
      a.period === b.period ? a.id.localeCompare(b.id) : a.period.localeCompare(b.period),
    );
}

/**
 * Whether the mocks are improving.
 *
 * Mocks only: a monthly check covers one month's material, so its score says
 * nothing about the one before it. The five N3 papers all cover the same syllabus,
 * which is what makes them comparable at all.
 */
export function mockTrend(trend = []) {
  const mocks = trend.filter((row) => row.kind === "mock");
  if (mocks.length < TREND_MIN_PAPERS) {
    return { papers: mocks, hasTrend: false, direction: "unknown", change: 0 };
  }
  const half = Math.floor(mocks.length / 2);
  const mean = (list) =>
    list.length ? Math.round(list.reduce((sum, row) => sum + row.score, 0) / list.length) : 0;
  const earlier = mean(mocks.slice(0, half));
  const later = mean(mocks.slice(mocks.length - half));
  const change = later - earlier;
  return {
    papers: mocks,
    hasTrend: true,
    earlier,
    later,
    change,
    // Three marks either way is which questions came up, not progress.
    direction: change >= 3 ? "up" : change <= -3 ? "down" : "flat",
  };
}

export function assessmentStats(assessments = [], results = []) {
  const sections = sectionAccuracy(assessments, results);
  const trend = scoreTrend(assessments, results);
  const rankable = sections.filter((row) => row.answered >= MIN_ASKED);
  const weakest = rankable.length
    ? rankable.reduce((low, row) => (row.percent < low.percent ? row : low))
    : null;
  const answered = sections.reduce((sum, row) => sum + row.answered, 0);
  const correct = sections.reduce((sum, row) => sum + row.correct, 0);
  return {
    sections,
    trend,
    mocks: mockTrend(trend),
    weakest,
    papers: trend.length,
    answered,
    correct,
    overall: percent(correct, answered),
    blank: sections.reduce((sum, row) => sum + (row.asked - row.answered), 0),
  };
}
