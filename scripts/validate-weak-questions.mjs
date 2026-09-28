// Tests for 專項強化集.
//
// The set is derived from stored submissions, so the rules that decide what counts
// as a miss are the whole feature: only the latest attempt, an unanswered question
// is not a wrong answer, and a question clears once it is answered right.
import assert from "node:assert/strict";
import { latestAttempts, weakQuestions } from "../src/weakQuestions.js";

const failures = [];
const check = (name, fn) => {
  try {
    fn();
  } catch (error) {
    failures.push({ name, message: error.message });
  }
};

const exam = {
  id: "monthly-01",
  title: "115/07 月檢核",
  kind: "monthly",
  questions: [
    { id: "q1", section: "文字・語彙", prompt: "一", options: ["a", "b"], answer: 0, explanationZh: "" },
    { id: "q2", section: "文法", prompt: "二", options: ["a", "b"], answer: 1, explanationZh: "" },
    { id: "q3", section: "読解", prompt: "三", options: ["a", "b"], answer: 0, explanationZh: "" },
    { id: "q4", section: "聴解", prompt: "四", options: ["a", "b"], answer: 1, explanationZh: "" },
  ],
};
const attempt = (id, answers, completedAt) => ({
  id,
  assessmentId: "monthly-01",
  answers,
  completedAt,
});

check("a wrong answer lands in the set, a right one does not", () => {
  const set = weakQuestions([exam], [attempt("a", { 0: 1, 1: 1 }, "2026-08-01T10:00:00Z")]);
  assert.equal(set.total, 1);
  assert.equal(set.wrong[0].question.id, "q1");
  assert.equal(set.wrong[0].picked, 1, "records what the learner actually chose");
});

check("an unanswered question is not a wrong answer", () => {
  // Submitting early leaves blanks; drilling questions never seen is not 錯題.
  const set = weakQuestions([exam], [attempt("a", { 0: 1 }, "2026-08-01T10:00:00Z")]);
  assert.equal(set.total, 1);
  assert.equal(set.unanswered, 3);
});

check("only the latest attempt counts", () => {
  const set = weakQuestions([exam], [
    attempt("first", { 0: 1, 1: 0, 2: 1, 3: 0 }, "2026-08-01T10:00:00Z"),
    attempt("second", { 0: 0, 1: 1, 2: 1, 3: 1 }, "2026-08-09T10:00:00Z"),
  ]);
  assert.equal(set.total, 1, "the retake fixed three of the four");
  assert.equal(set.wrong[0].question.id, "q3");
});

check("latestAttempts picks by timestamp, not by arrival order", () => {
  const latest = latestAttempts([
    attempt("new", {}, "2026-08-09T10:00:00Z"),
    attempt("old", {}, "2026-08-01T10:00:00Z"),
  ]);
  assert.equal(latest.get("monthly-01").id, "new");
});

check("a cleared question leaves the set", () => {
  const results = [attempt("a", { 0: 1, 1: 0 }, "2026-08-01T10:00:00Z")];
  assert.equal(weakQuestions([exam], results).total, 2);
  assert.equal(weakQuestions([exam], results, new Set(["q1"])).total, 1);
  assert.equal(weakQuestions([exam], results, new Set(["q1", "q2"])).total, 0);
});

check("a result for an assessment that no longer exists is ignored", () => {
  const orphan = { id: "x", assessmentId: "monthly-99", answers: { 0: 1 }, completedAt: "2026-08-01T10:00:00Z" };
  assert.equal(weakQuestions([exam], [orphan]).total, 0);
});

check("the set is grouped by section in paper order", () => {
  const set = weakQuestions([exam], [attempt("a", { 0: 1, 1: 0, 2: 1, 3: 0 }, "2026-08-01T10:00:00Z")]);
  assert.deepEqual(
    set.wrong.map((row) => row.section),
    ["文字・語彙", "文法", "読解", "聴解"],
  );
  assert.deepEqual(set.bySection, { "文字・語彙": 1, 文法: 1, 読解: 1, 聴解: 1 });
});

check("misses from several papers are gathered together", () => {
  const other = { ...exam, id: "mock-n3-1", title: "N3 自編模考 1", kind: "mock" };
  const set = weakQuestions(
    [exam, other],
    [
      attempt("a", { 0: 1 }, "2026-08-01T10:00:00Z"),
      { id: "b", assessmentId: "mock-n3-1", answers: { 1: 0 }, completedAt: "2026-08-02T10:00:00Z" },
    ],
  );
  assert.equal(set.total, 2);
  assert.deepEqual(set.wrong.map((row) => row.examId), ["monthly-01", "mock-n3-1"]);
});

check("no submissions means an empty set, not a crash", () => {
  const set = weakQuestions([exam], []);
  assert.equal(set.total, 0);
  assert.equal(set.unanswered, 0);
  assert.deepEqual(weakQuestions().wrong, []);
});

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: "weak questions" }, null, 2));
