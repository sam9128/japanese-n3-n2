// Guards the reading field, which the old generator corrupted wholesale.
//
// Readings were produced by stripping macrons off romaji (fūsen -> fusen -> ふせん),
// so every long vowel in the deck came out short. The generator no longer does
// that, but these checks keep the corruption from creeping back in.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const periodsRoot = path.join(root, "public", "content", "periods");
const authorityPath = path.join(root, "scripts", "source", "vocab-authority.json");

const vocabulary = [];
for (const file of fs.readdirSync(periodsRoot).sort()) {
  if (!file.endsWith(".json")) continue;
  const payload = JSON.parse(fs.readFileSync(path.join(periodsRoot, file), "utf8"));
  vocabulary.push(...(payload.vocabulary || []));
}
const authority = new Map(
  JSON.parse(fs.readFileSync(authorityPath, "utf8")).map((row) => [row.id, row]),
);

const KANA_ONLY = /^[ぁ-ゟァ-ヿー]+$/;
const HAS_KANJI = /[一-龯]/;
// Sino-Japanese readings that end in these are where the macron bug bit hardest.
const LONG_VOWEL_TAIL = /(?:こう| こう|そう|とう|のう|ほう|もう|ろう|ぎょう|しょう|ちょう|りょう|きょう|ひょう|びょう|みょう|じょう|にょう|ゆう|きゅう|しゅう|ちゅう|りゅう|じゅう|ひゅう|びゅう|みゅう|ぐう|くう|すう|つう|ふう|ぬう|むう|るう)$/;

const failures = [];
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
