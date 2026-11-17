import assert from "node:assert/strict";
import { senseTranslationJobs } from "./sense-translation-jobs.mjs";
import { teachingContextFingerprint, teachingContextReviewStatus } from "./teaching-context-review.mjs";

const row = {
  id: "vocab-test", sourceEntry: 123,
  examples: [{ ja: "本の例。" }],
  sourceSenses: [{ gloss: [] }, { gloss: ["meaning", "another gloss"] }],
  teachingSenses: [{ id: "one", example: { ja: "教える例。" },
    quizSentence: "本題の例。", alternateQuiz: { ja: "別の例。" } }],
};
const jobs = senseTranslationJobs(row);
assert.deepEqual(jobs.map((job) => job.id), [
  "vocab-test/example", "vocab-test/sense-2", "vocab-test/teaching/one/example",
  "vocab-test/teaching/one/primary", "vocab-test/teaching/one/alternate",
]);
assert.ok(jobs.every((job) => job.sourceEntry === 123));
assert.equal(jobs[1].sourceLanguage, "en");
assert.equal(jobs[1].sourceText, "meaning; another gloss");
assert.ok(jobs.filter((job) => job !== jobs[1]).every((job) => job.sourceLanguage === "ja"));
assert.deepEqual(senseTranslationJobs({ id: "empty", sourceEntry: 1 }), []);
const mixedSource = {
  ...row,
  additionalTeachingSources: [{ sourceEntry: 456, sourceSenses: [{ gloss: ["suffix tendency"] }] }],
  teachingSenses: [{ ...row.teachingSenses[0], sourceSequence: 456 }],
};
const mixedJobs = senseTranslationJobs(mixedSource);
assert.ok(mixedJobs.filter((job) => job.id.includes("/teaching/") ||
  job.id.includes("/source-456/")).every((job) => job.sourceEntry === 456),
"接尾詞例句及英語義項使用自身來源，不混入主詞條來源的翻譯快取");
assert.equal(mixedJobs.find((job) => job.id.endsWith("/example")).sourceEntry, 123);
// Editing a context must update the text sent for the same stable cache ID.
row.teachingSenses[0].quizSentence = "修正した文。";
assert.equal(senseTranslationJobs(row).find((job) => job.id.endsWith("/primary")).sourceText,
  "修正した文。");
const review = { teachingContextReview: { fingerprint: teachingContextFingerprint(row) } };
assert.equal(teachingContextReviewStatus(row, review), "reviewed");
assert.equal(teachingContextReviewStatus(row, {}), "pending");
assert.equal(teachingContextReviewStatus({ ...row, teachingSenses: [] }, review), "not-applicable");
for (const change of [
  { sourceEntry: 456 }, { term: "別の字" }, { reading: "べつ" },
  { teachingSenses: [{ ...row.teachingSenses[0], quizSentence: "さらに修正。" }] },
  { teachingSenses: [{ ...row.teachingSenses[0], quizTranslationZh: "修正後的中文。" }] },
]) {
  assert.equal(teachingContextReviewStatus({ ...row, ...change }, review), "stale");
}
console.log(JSON.stringify({ ok: true }));
