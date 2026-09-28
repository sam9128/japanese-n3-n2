// Tests for 檢核與模考分析.
//
// The figures decide what the learner goes and revises, so the rules that shape
// them get explicit cases: only the latest attempt, blanks are not wrong answers,
// a section is not called weakest on a handful of questions, and a monthly check is
// not comparable with the one before it.
import assert from "node:assert/strict";
import {
  assessmentStats,
  mockTrend,
  scoreTrend,
  sectionAccuracy,
} from "../src/assessmentStats.js";

const failures = [];
const check = (name, fn) => {
  try {
    fn();
  } catch (error) {
    failures.push({ name, message: error.message });
  }
};

// Six questions per section so a section can clear MIN_ASKED on one paper.
const questions = (prefix) =>
  ["文字・語彙", "文法", "読解", "聴解"].flatMap((section) =>
    Array.from({ length: 6 }, (_, i) => ({
      id: `${prefix}-${section}-${i}`,
      section,
      prompt: `${section}${i}`,
      options: ["a", "b"],
      answer: 0,
      explanationZh: "",
    })),
  );
const paper = (id, kind, period, score) => ({
  id,
  title: id,
  kind,
  level: "N3",
  unlockPeriod: period,
  threshold: 60,
  questions: questions(id),
  score,
});
const exams = [
  paper("monthly-01", "monthly", "115-07"),
  paper("mock-n3-1", "mock", "115-11"),
  paper("mock-n3-2", "mock", "115-11"),
  paper("mock-n3-3", "mock", "115-11"),
  paper("mock-n3-4", "mock", "115-11"),
];
// answers: an object keyed by question index, all correct unless listed in `wrong`
const submit = (assessmentId, score, completedAt, { wrong = [], blank = [] } = {}) => ({
  id: `${assessmentId}-${completedAt}`,
  assessmentId,
  score,
  completedAt,
  answers: Object.fromEntries(
    Array.from({ length: 24 }, (_, i) => i)
      .filter((i) => !blank.includes(i))
      .map((i) => [i, wrong.includes(i) ? 1 : 0]),
  ),
});

check("accuracy is reported per section", () => {
  // indices 0-5 文字・語彙, 6-11 文法, 12-17 読解, 18-23 聴解.
  const rows = sectionAccuracy(exams, [
    submit("monthly-01", 75, "2026-08-01T10:00:00Z", { wrong: [18, 19, 20] }),
  ]);
  const listening = rows.find((row) => row.section === "聴解");
  assert.equal(listening.answered, 6);
  assert.equal(listening.correct, 3);
  assert.equal(listening.percent, 50);
  assert.equal(rows.find((row) => row.section === "文法").percent, 100);
});

check("a blank is not a wrong answer", () => {
  // Blanks land at the end of the paper, so counting them wrong would read as the
  // 聴解 section collapsing whenever a paper is handed in early.
  const rows = sectionAccuracy(exams, [
    submit("monthly-01", 75, "2026-08-01T10:00:00Z", { blank: [18, 19, 20, 21, 22, 23] }),
  ]);
  const listening = rows.find((row) => row.section === "聴解");
  assert.equal(listening.asked, 6);
  assert.equal(listening.answered, 0);
  assert.equal(listening.percent, 0, "no answers means no rate to report");
  assert.equal(assessmentStats(exams, [
    submit("monthly-01", 75, "2026-08-01T10:00:00Z", { blank: [18, 19, 20, 21, 22, 23] }),
  ]).blank, 6);
});

check("only the latest attempt counts", () => {
  const rows = sectionAccuracy(exams, [
    submit("monthly-01", 20, "2026-08-01T10:00:00Z", { wrong: [0, 1, 2, 3, 4, 5] }),
    submit("monthly-01", 100, "2026-08-09T10:00:00Z"),
  ]);
  assert.equal(rows.find((row) => row.section === "文字・語彙").percent, 100);
});

check("the weakest section needs enough questions to be called weakest", () => {
  const thin = {
    ...paper("monthly-02", "monthly", "115-08"),
    questions: [
      { id: "t1", section: "聴解", prompt: "x", options: ["a", "b"], answer: 0, explanationZh: "" },
    ],
  };
  const stats = assessmentStats([thin], [
    { id: "r", assessmentId: "monthly-02", score: 0, completedAt: "2026-08-01T10:00:00Z", answers: { 0: 1 } },
  ]);
  assert.equal(stats.sections.find((row) => row.section === "聴解").percent, 0);
  assert.equal(stats.weakest, null, "one question is not a weakness");
});

check("papers come back in the order the learner meets them", () => {
  const trend = scoreTrend(exams, [
    submit("mock-n3-2", 70, "2026-11-20T10:00:00Z"),
    submit("monthly-01", 60, "2026-07-30T10:00:00Z"),
    submit("mock-n3-1", 55, "2026-11-10T10:00:00Z"),
  ]);
  assert.deepEqual(trend.map((row) => row.id), ["monthly-01", "mock-n3-1", "mock-n3-2"]);
  assert.equal(trend[1].passed, false, "55 is under the 60 threshold");
  assert.equal(trend[2].passed, true);
});

check("a paper with no submission is left out of the trend", () => {
  assert.equal(scoreTrend(exams, [submit("monthly-01", 60, "2026-07-30T10:00:00Z")]).length, 1);
});

check("two mocks are not a trend", () => {
  const trend = scoreTrend(exams, [
    submit("mock-n3-1", 50, "2026-11-10T10:00:00Z"),
    submit("mock-n3-2", 90, "2026-11-20T10:00:00Z"),
  ]);
  const mocks = mockTrend(trend);
  assert.equal(mocks.hasTrend, false);
  assert.equal(mocks.direction, "unknown");
});

check("rising mock scores read as rising", () => {
  const trend = scoreTrend(exams, [
    submit("mock-n3-1", 50, "2026-11-10T10:00:00Z"),
    submit("mock-n3-2", 54, "2026-11-14T10:00:00Z"),
    submit("mock-n3-3", 70, "2026-11-18T10:00:00Z"),
    submit("mock-n3-4", 74, "2026-11-22T10:00:00Z"),
  ]);
  const mocks = mockTrend(trend);
  assert.equal(mocks.earlier, 52);
  assert.equal(mocks.later, 72);
  assert.equal(mocks.direction, "up");
});

check("a couple of marks either way is flat, not progress", () => {
  const trend = scoreTrend(exams, [
    submit("mock-n3-1", 70, "2026-11-10T10:00:00Z"),
    submit("mock-n3-2", 70, "2026-11-14T10:00:00Z"),
    submit("mock-n3-3", 71, "2026-11-18T10:00:00Z"),
    submit("mock-n3-4", 71, "2026-11-22T10:00:00Z"),
  ]);
  assert.equal(mockTrend(trend).direction, "flat");
});

check("monthly checks are not mixed into the mock trend", () => {
  // Each check covers its own month, so its score says nothing about the one before.
  const trend = scoreTrend(exams, [
    submit("monthly-01", 100, "2026-07-30T10:00:00Z"),
    submit("mock-n3-1", 50, "2026-11-10T10:00:00Z"),
    submit("mock-n3-2", 50, "2026-11-14T10:00:00Z"),
  ]);
  const mocks = mockTrend(trend);
  assert.equal(mocks.papers.length, 2);
  assert.ok(mocks.papers.every((row) => row.kind === "mock"));
});

check("nothing submitted yet is an empty report, not a crash", () => {
  const stats = assessmentStats(exams, []);
  assert.equal(stats.papers, 0);
  assert.equal(stats.overall, 0);
  assert.equal(stats.weakest, null);
  assert.deepEqual(assessmentStats().sections, []);
});

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: "assessment stats" }, null, 2));
