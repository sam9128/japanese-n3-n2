import assert from "node:assert/strict";
import { masteredSenseCount, senseRevision } from "../src/senseProgress.js";
import { buildQuizQuestion, buildStudyQuiz } from "../src/studyQuiz.js";

const card = {
  id: "word", term: "ボタン", category: "vocab", senseSourceSequence: 1,
  senses: [
    { id: "clothing", meaningZh: "鈕扣", quizSentence: "ボタンを縫う。",
      quizTranslationZh: "縫鈕扣。", alternateQuiz: { ja: "ボタンを留める。", zh: "扣鈕扣。" } },
    { id: "switch", meaningZh: "按鈕", quizSentence: "ボタンを押す。",
      quizTranslationZh: "按按鈕。", alternateQuiz: { ja: "ボタンをクリックする。", zh: "點擊按鈕。" } },
  ],
};
const attempt = (id, senseIndex, contextId, quizCorrect) => ({
  id: String(id), cardId: card.id, senseId: card.senses[senseIndex].id,
  senseRevision: senseRevision(card, card.senses[senseIndex]), contextId, quizCorrect,
  occurredAt: new Date(Date.UTC(2026, 6, id)).toISOString(),
});
const primary = attempt(1, 0, "primary", true);
const repeat = attempt(2, 0, "primary", true);
const alternate = attempt(3, 0, "alternate", true);
assert.equal(masteredSenseCount([card], [primary, repeat]), 0, "重複同語境不可掌握");
assert.equal(masteredSenseCount([card], [alternate, primary]), 1, "重播須依事件時間排序");
const wrong = attempt(4, 0, "alternate", false);
assert.equal(masteredSenseCount([card], [primary, alternate, wrong]), 0, "答錯清除兩語境累積");
assert.equal(masteredSenseCount([card], [primary, alternate, wrong, attempt(5, 0, "alternate", true)]), 0);
assert.equal(masteredSenseCount([card], [primary, alternate, wrong,
  attempt(5, 0, "alternate", true), attempt(6, 0, "primary", true)]), 1);
assert.equal(masteredSenseCount([card], [{ ...primary, senseRevision: undefined }, alternate]), 0,
  "無法證明題目版本的舊事件不計入掌握");
const revised = structuredClone(card);
revised.senses[0].quizSentence += "新版";
assert.equal(masteredSenseCount([revised], [primary, alternate]), 0, "改題後舊答案失效");
assert.equal(masteredSenseCount([{ ...card, senseSourceSequence: 2 }], [primary, alternate]), 0,
  "更換字典來源後舊答案失效");
const sourceOverride = structuredClone(card);
sourceOverride.senses[0].sourceSequence = 2;
assert.equal(masteredSenseCount([sourceOverride], [primary, alternate]), 0,
  "只更換義項來源也須使該義項舊答案失效");
assert.equal(senseRevision(sourceOverride, sourceOverride.senses[1]),
  senseRevision(card, card.senses[1]), "其他義項的來源及掌握版本保持不變");
const pronunciation = structuredClone(card);
pronunciation.reading = "ぼたん";
pronunciation.senses[0].reading = "べつよみ";
const pronunciationQuestion = buildQuizQuestion(pronunciation, [], () => 0);
assert.equal(pronunciationQuestion.reading, "べつよみ", "題目應顯示本義項讀音");
assert.equal(pronunciationQuestion.audioText, "べつよみ", "播放應使用本義項讀音");
const spelling = structuredClone(card);
spelling.senses[0].term = "別字形";
assert.equal(buildQuizQuestion(spelling, [], () => 0).term, "別字形",
  "題目應顯示本義項適用字形");
assert.equal(masteredSenseCount([spelling], [primary, alternate]), 0,
  "義項字形變更後不沿用舊版掌握紀錄");
assert.equal(masteredSenseCount([pronunciation], [primary, alternate]), 0,
  "新增義項讀音後，不沿用沒有該讀音的掌握紀錄");
assert.equal(senseRevision(card, card.senses[0]), JSON.stringify([
  1, "鈕扣", "ボタンを縫う。", "縫鈕扣。", "ボタンを留める。", "扣鈕扣。",
]), "未設定義項讀音的舊教材版本應保持相容");
assert.equal(masteredSenseCount([card], [primary, alternate,
  { ...wrong, senseRevision: "stale" }]), 1, "過期答錯也不能清除新版掌握");
assert.equal(masteredSenseCount([card], [primary, { ...alternate, contextId: "unknown" }]), 0);
assert.equal(masteredSenseCount([card], [primary, { ...alternate, occurredAt: "invalid" }]), 0);

const question = (events, random = () => 0) => buildQuizQuestion(card, [], random, events);
assert.equal(question([primary]).contextId, "alternate", "優先尚未答對的語境");
assert.equal(question([alternate], () => 0.1).contextId, "primary");
assert.equal(question([wrong]).contextId, "alternate", "先重試最近答錯的語境");
assert.equal(question([primary, alternate]).senseId, "switch", "先練尚未掌握的義項");
assert.equal(question([primary, alternate], () => 0.99).senseId, "switch");
assert.equal(question([primary, alternate]).senseRevision, senseRevision(card, card.senses[1]));
const quiz = buildStudyQuiz({ pool: [card], allCandidates: [card],
  events: [primary], random: () => 0 });
assert.equal(quiz[0].contextId, "alternate", "複習入口須傳遞義項歷史");
assert.equal(question([primary, alternate, attempt(5, 1, "primary", true),
  attempt(6, 1, "alternate", true)]).senseId, "clothing", "全部掌握後仍可複習");
const manySenses = { ...card, senses: Array.from({ length: 7 }, (_, i) => ({
  ...card.senses[0], id: `sense-${i}`, meaningZh: `意思-${i}`,
})) };
for (let i = 0; i < manySenses.senses.length; i++) {
  const q = buildQuizQuestion(manySenses, [], () => (i + 0.5) / manySenses.senses.length);
  assert.equal(q.options.length, 4, "多於四義時仍需符合四鍵作答介面");
  assert.equal(q.options[q.correctIndex], manySenses.senses[i].meaningZh);
}
console.log("Sense progress and scheduling validation passed.");
