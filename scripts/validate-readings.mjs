// Guards the reading field, which the old generator corrupted wholesale.
//
// Readings were produced by stripping macrons off romaji (fūsen -> fusen -> ふせん),
// so every long vowel in the deck came out short. The generator no longer does
// that, but these checks keep the corruption from creeping back in.
import fs from "node:fs";
import path from "node:path";
import { loadVocabAuthority } from "./source/vocab-authority.mjs";

const root = path.resolve(import.meta.dirname, "..");
const periodsRoot = path.join(root, "public", "content", "periods");

const vocabulary = [];
for (const file of fs.readdirSync(periodsRoot).sort()) {
  if (!file.endsWith(".json")) continue;
  const payload = JSON.parse(fs.readFileSync(path.join(periodsRoot, file), "utf8"));
  vocabulary.push(...(payload.vocabulary || []));
}
const authority = new Map(loadVocabAuthority().map((row) => [row.id, row]));

const KANA_ONLY = /^[ぁ-ゟァ-ヿー]+$/;
const HAS_KANJI = /[一-龯]/;
// Sino-Japanese readings that end in these are where the macron bug bit hardest.
const LONG_VOWEL_TAIL = /(?:こう| こう|そう|とう|のう|ほう|もう|ろう|ぎょう|しょう|ちょう|りょう|きょう|ひょう|びょう|みょう|じょう|にょう|ゆう|きゅう|しゅう|ちゅう|りゅう|じゅう|ひゅう|びゅう|みゅう|ぐう|くう|すう|つう|ふう|ぬう|むう|るう)$/;

const failures = [];
const kimi = vocabulary.find((item) => item.id === "vocab-0087");
const gimi = kimi?.senses?.find((sense) => sense.id === "tendency");
if (kimi?.reading !== "きみ" || gimi?.reading !== "ぎみ" ||
    gimi?.sourceSequence !== 1790980 || kimi.readingQuizEligible ||
    !kimi.examples?.[0]?.ja.includes("気味が悪")) {
  failures.push({ id: "vocab-0087", reason: "standalone kimi and suffix gimi must keep separate sources, readings and base examples" });
}
const eru = vocabulary.find((item) => item.id === "vocab-3861");
const uru = eru?.senses?.find((sense) => sense.id === "possible");
if (eru?.reading !== "える" || uru?.reading !== "うる" ||
    uru?.sourceSequence !== 1454500 || eru.readingQuizEligible) {
  failures.push({ id: "vocab-3861", reason: "independent eru and auxiliary uru require separate reading/source metadata and contextual quizzes" });
}
for (const item of vocabulary) {
  const source = authority.get(item.id);
  if (!source) {
    failures.push({ id: item.id, reason: "no authority row" });
    continue;
  }
  if (!item.reading || !KANA_ONLY.test(item.reading)) {
    failures.push({ id: item.id, term: item.term, reading: item.reading, reason: "reading is not kana-only" });
  }
  if (item.reading !== source.reading) {
    failures.push({
      id: item.id,
      term: item.term,
      reason: "reading drifted from the JMdict-backed value",
      got: item.reading,
      expected: source.reading,
    });
  }
  // A kana headword must read as itself; anything else means the two fields
  // were derived independently and disagree.
  if (!HAS_KANJI.test(item.term) && item.reading !== item.term) {
    failures.push({
      id: item.id,
      term: item.term,
      reading: item.reading,
      reason: "kana headword does not read as itself",
    });
  }
  if (item.readingQuizEligible && !HAS_KANJI.test(item.term)) {
    failures.push({
      id: item.id,
      term: item.term,
      reason: "reading quiz enabled for a word with no kanji to read",
    });
  }
  const senseReadings = new Set([item.reading,
    ...(item.senses ?? []).map((sense) => sense.reading || item.reading)]);
  if (item.readingQuizEligible && senseReadings.size > 1) {
    failures.push({ id: item.id, reason: "multiple sense readings in a context-free reading quiz" });
  }
}

// The bug's signature: a word whose reading is one mora shorter than the kanji
// count would allow. Rather than guess, assert the population statistic that the
// broken data could not have produced — long-vowel endings should be common.
const kanjiWords = vocabulary.filter((item) => HAS_KANJI.test(item.term));
const longVowelEndings = kanjiWords.filter((item) => LONG_VOWEL_TAIL.test(item.reading)).length;
const longVowelRatio = kanjiWords.length ? longVowelEndings / kanjiWords.length : 0;
if (longVowelRatio < 0.1) {
  failures.push({
    reason: "suspiciously few long-vowel readings; macron stripping may be back",
    longVowelEndings,
    kanjiWords: kanjiWords.length,
    ratio: Number(longVowelRatio.toFixed(4)),
  });
}

if (failures.length) {
  console.error(
    JSON.stringify({ ok: false, failureCount: failures.length, failures: failures.slice(0, 40) }, null, 2),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      vocabulary: vocabulary.length,
      kanjiWords: kanjiWords.length,
      longVowelEndings,
      longVowelRatio: Number(longVowelRatio.toFixed(4)),
    },
    null,
    2,
  ),
);
