import assert from "node:assert/strict";
import {
  buildQuizQuestion,
  buildStudyQuiz,
  categoryDistractors,
  pickQuizItems,
  quizWeight,
  rememberQuizRound,
  STUDY_QUIZ_MIN_WEIGHT,
} from "../src/studyQuiz.js";

const cards = Array.from({ length: 8 }, (_, index) => ({
  id: `card-${index + 1}`,
  category: index % 2 ? "grammar" : "vocab",
  term: `語-${index + 1}`,
  reading: `ご-${index + 1}`,
  meaningZh: `中文意思 ${index + 1}`,
  audioText: `語-${index + 1}`,
}));

const weak = {
  quizAttempts: 5,
  quizCorrect: 1,
  quizWrong: 4,
  lastQuizCorrect: false,
};
const strong = {
  quizAttempts: 12,
  quizCorrect: 11,
  quizWrong: 1,
  lastQuizCorrect: true,
};

assert.ok(
  quizWeight(cards[0], weak) > quizWeight(cards[1], strong),
  "錯題權重應高於熟題",
);
assert.ok(
  quizWeight(cards[1], { quizAttempts: 100, quizCorrect: 100, quizWrong: 0 }) >=
    STUDY_QUIZ_MIN_WEIGHT,
  "正確率提升後權重仍不可降為 0",
);

const smallQuiz = buildStudyQuiz({
  pool: cards.slice(0, 2),
  allCandidates: cards,
  progress: {},
  random: () => 0.1,
});
assert.equal(smallQuiz.length, 2, "題庫不足 3 題時應使用可用題數");
assert.ok(
  smallQuiz.every((question) =>
    question.options.includes(question.correctMeaning),
  ),
  "每題選項必須包含正確中文意思",
);

const recentQuizRounds = [
  ["card-1"],
  ["card-2"],
  ["card-3"],
  ["card-8"],
];
const picked = pickQuizItems({
  pool: cards,
  progress: {},
  recentQuizRounds,
  random: () => 0.01,
});
assert.deepEqual(
  picked.map((item) => item.id),
  ["card-4", "card-5", "card-6"],
  "最近 3 輪內出現過的題目應優先排除",
);

// --------------------------------------------------- distractors stay in-category
// A 文法 question offering 單字 meanings can be answered on shape alone, so every
// wrong answer must come from the same category as the item being tested.
const grammarCard = cards.find((card) => card.category === "grammar");
const vocabCard = cards.find((card) => card.category === "vocab");

assert.ok(
  categoryDistractors(grammarCard, cards).every(
    (card) => card.category === "grammar",
  ),
  "文法題的干擾選項只能取自文法",
);
assert.ok(
  categoryDistractors(vocabCard, cards).every(
    (card) => card.category === "vocab",
  ),
  "單字題的干擾選項只能取自單字",
);
assert.ok(
  categoryDistractors(grammarCard, cards).every(
    (card) => card.id !== grammarCard.id,
  ),
  "干擾選項不可包含題目本身",
);

const grammarMeanings = new Set(
  cards.filter((card) => card.category === "grammar").map((card) => card.meaningZh),
);
const grammarQuestion = buildQuizQuestion(grammarCard, cards, () => 0.4);
assert.ok(
  grammarQuestion.options.every((option) => grammarMeanings.has(option)),
  "文法題的所有選項都必須是文法解釋",
);
assert.ok(
  grammarQuestion.options.includes(grammarQuestion.correctMeaning),
  "文法題仍必須包含正解",
);

// With only one grammar card there is no wrong answer to offer, and a
// single-option question is not a question — it must be dropped, not padded
// with 單字 meanings.
const lonely = [grammarCard, ...cards.filter((card) => card.category === "vocab")];
assert.equal(
  buildStudyQuiz({
    pool: [grammarCard],
    allCandidates: lonely,
    progress: {},
    random: () => 0.1,
  }).length,
  0,
  "同類干擾選項不足時應略過該題，而非混入單字",
);

const remembered = rememberQuizRound(recentQuizRounds, ["card-7"]);
assert.equal(remembered.length, 3, "最近題目紀錄只保留 3 輪");
assert.deepEqual(remembered[0], ["card-7"], "最新 quiz 輪次應放在最前面");

console.log("Study quiz validation passed.");
