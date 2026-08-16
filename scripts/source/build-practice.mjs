// The 文字・語彙 and 文法 practice sets on the 閱讀聽力 page.
//
// That page only ever covered two of the exam's four sections. These fill in the
// other two, using the same builders the exam uses, so practising and sitting a
// paper ask the same kind of question.
//
// Two things separate practice from an exam item. It is not required to be
// globally unique — the point is repetition, and the same word may legitimately
// come up again in a later month. And answering it does not grade the card:
// practice must not be a second route to unlocking new material, which is why
// nothing here carries a rating.
import {
  ITEM_BUILDERS,
  grammarClozeItem,
  hasOwnExample,
  usableForGrammarCloze,
  usableForReading,
} from "./build-items.mjs";

// Per month. Weighted like the paper's own 文字・語彙 mix (漢字読み and 表記 lighter,
// 文脈規定 heaviest) and enough of each to be worth opening.
const PER_MONTH = { kanji: 8, orthography: 8, "vocab-cloze": 8, grammar: 12 };

// mulberry32, as elsewhere: the practice sets are committed content, so they
// have to come out identical on every run.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Spread the picks across the whole pool rather than taking the first N, so a
// month's practice is not all drawn from the words that happen to sort first.
function spread(pool, count, random) {
  if (pool.length <= count) return [...pool];
  const step = pool.length / count;
  const offset = random() * step;
  return Array.from(
    { length: count },
    (_, i) => pool[Math.min(pool.length - 1, Math.floor(offset + i * step))],
  );
}

/**
 * Practice items for every period.
 *
 * Each month draws from everything unlocked up to and including it, so later
 * months practise over a wider range — which is what revision months are for.
 */
export function buildPractice(periods, vocabulary, grammar, functionOf) {
  const random = seeded(20260807);
  const items = [];
  periods.forEach((period, periodIndex) => {
    const upto = (list) =>
      list.filter((x) => periods.indexOf(x.unlockPeriod) <= periodIndex);
    const vocab = upto(vocabulary);
    const readingPool = vocab.filter(usableForReading);
    const clozePool = vocab.filter(hasOwnExample);
    const grammarPool = upto(grammar).filter(usableForGrammarCloze);
    let n = 0;
    const add = (question, level) => {
      n += 1;
      items.push({
        ...question,
        id: `practice-${period}-${String(n).padStart(2, "0")}`,
        category: "practice",
        level,
        unlockPeriod: period,
        sourceRefs: ["self-authored", "https://www.jlpt.jp/e/samples/sampleindex.html"],
        license: "CC BY 4.0 — 自編題目；官方連結僅供題型參考",
      });
    };
    for (const [key, count] of Object.entries(PER_MONTH)) {
      if (key === "grammar") {
        for (const card of spread(grammarPool, count, random)) {
          add(grammarClozeItem(card, grammarPool, items.length + n, functionOf), card.level);
        }
      } else {
        const pool = key === "vocab-cloze" ? clozePool : readingPool;
        for (const card of spread(pool, count, random)) {
          add(ITEM_BUILDERS[key](card, pool, items.length + n), card.level);
        }
      }
    }
  });
  return items;
}

export const PRACTICE_PER_MONTH = Object.values(PER_MONTH).reduce(
  (n, x) => n + x,
  0,
);
