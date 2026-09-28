/**
 * 專項強化集 — the questions the learner got wrong on a monthly check or a mock.
 *
 * Every submission already stored the option picked for each question, so the wrong
 * ones were derivable all along; nothing read them back. Reviewing a paper showed
 * one paper, and there was no way to gather the misses across papers, which is what
 * the plan's 116/04 line asks for.
 *
 * Only the latest attempt at a paper counts. Retaking it and getting a question
 * right is the learner clearing it, and a set that still held their first-attempt
 * mistakes could never be emptied.
 */

export const SECTIONS = ["文字・語彙", "文法", "読解", "聴解"];

/** The most recent submission per assessment. */
export function latestAttempts(results = []) {
  const latest = new Map();
  for (const result of results) {
    if (!result?.assessmentId) continue;
    const seen = latest.get(result.assessmentId);
    const at = String(result.completedAt || "");
    if (!seen || at > String(seen.completedAt || "")) latest.set(result.assessmentId, result);
  }
  return latest;
}

/**
 * Wrong questions, with the option the learner picked.
 *
 * `cleared` holds the ids answered correctly in the drill itself, which is how a
 * question leaves the set without having to re-sit the whole paper.
 *
 * Unanswered questions are deliberately not wrong answers — an early submission
 * would otherwise flood the set with questions the learner never saw. They are
 * counted separately so the summary can say so.
 */
export function weakQuestions(assessments = [], results = [], cleared = new Set()) {
  const byId = new Map(assessments.map((item) => [item.id, item]));
  const wrong = [];
  let unanswered = 0;
  for (const [assessmentId, result] of latestAttempts(results)) {
    const exam = byId.get(assessmentId);
    if (!exam) continue; // a result left over from material that no longer exists
    exam.questions.forEach((question, index) => {
      const picked = result.answers?.[index];
      if (picked === undefined || picked === null) {
        unanswered += 1;
        return;
      }
      if (picked === question.answer) return;
      if (cleared.has(question.id)) return;
      wrong.push({
        question,
        picked,
        index,
        examId: exam.id,
        examTitle: exam.title,
        kind: exam.kind,
        section: question.section,
      });
    });
  }
  // Group the drill by section so it reads like the paper, and keep papers in order
  // inside each section.
  wrong.sort((a, b) => {
    const bySection = SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section);
    if (bySection !== 0) return bySection;
    if (a.examId !== b.examId) return a.examId.localeCompare(b.examId);
    return a.index - b.index;
  });
  const bySection = Object.fromEntries(
    SECTIONS.map((section) => [section, wrong.filter((row) => row.section === section).length]),
  );
  return { wrong, total: wrong.length, unanswered, bySection };
}
