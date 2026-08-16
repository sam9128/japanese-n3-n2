// The 文字・語彙 and 文法 item types, built from one word or pattern each.
//
// These live here rather than inside the exam generator because two places need
// them now: the monthly checks and mocks, and the practice section on the
// 閱讀聽力 page. Keeping one copy is the point — an exam item and a practice item
// of the same 大問 should be the same kind of question, and a fix to one should
// not have to be remembered for the other.
//
// Each builder takes the card, a pool to draw distractors from, and a seed, and
// returns the question. What it does *not* do is decide which card to use: the
// exam has to guarantee no source is reused across the whole year, practice does
// not care, and that choice belongs to the caller.

export const SECTION_VOCAB = "文字・語彙";
export const SECTION_GRAMMAR = "文法";

// The real paper underlines the target word. Plain text cannot, so it is
// bracketed instead.
export const mark = (text) => `＿${text}＿`;

// The pattern carries 〜 markers that its example sentence does not.
export const patternCore = (term) => term.replace(/[〜～]/g, "");

// Sentence-context items need the word to actually appear in its own example.
export const hasOwnExample = (item) => item.examples?.[0]?.ja?.includes(item.term);
export const usableForReading = (item) =>
  /[㐀-鿿]/.test(item.term) &&
  item.reading &&
  item.reading !== item.term &&
  item.readingQuizEligible &&
  hasOwnExample(item);
export const usableForGrammarCloze = (item) =>
  item.examples?.[0]?.ja?.includes(patternCore(item.term));

/**
 * Distractors for 文脈規定 must not also fit the blank.
 *
 * Without semantic data the cheapest reliable proxy is the Chinese gloss: two
 * words whose glosses share no characters are very unlikely to be
 * interchangeable in one sentence.
 */
const glossChars = (item) =>
  new Set((item.meaningZh || "").replace(/[；;，,（）()]/g, ""));
export function disjointGloss(a, b) {
  const other = glossChars(b);
  for (const char of glossChars(a)) if (other.has(char)) return false;
  return true;
}

// Rotate rather than shuffle so the answer position is spread deterministically.
function rotateOptions(correct, distractors, seed) {
  const options = [
    ...new Set([correct, ...distractors.filter((item) => item !== correct)]),
  ].slice(0, 4);
  if (options.length !== 4) throw new Error(`選項不足：${correct}`);
  const shift = seed % options.length;
  const rotated = [...options.slice(shift), ...options.slice(0, shift)];
  return { options: rotated, answer: rotated.indexOf(correct) };
}

// Draw four options' worth of candidates starting at a seeded offset, wrapping
// so a small pool still fills the slots.
const ring = (pool, seed) =>
  pool.slice(seed % Math.max(1, pool.length - 3)).concat(pool);

export function kanjiReadingItem(item, pool, seed) {
  const distractors = ring(
    pool.filter((x) => x.id !== item.id && x.reading !== item.reading),
    seed,
  ).map((x) => x.reading);
  return {
    section: SECTION_VOCAB,
    type: "漢字読み",
    instruction: "＿＿＿の言葉の読み方として最もよいものを、一つ選びなさい。",
    passage: item.examples[0].ja.replaceAll(item.term, mark(item.term)),
    prompt: `${mark(item.term)}の読み方はどれですか。`,
    ...rotateOptions(item.reading, distractors, seed),
    explanationZh: `「${item.term}」讀作「${item.reading}」，中文意思是「${item.meaningZh}」。`,
    sourceCardId: item.id,
    logic: "kanji-reading",
  };
}

export function orthographyItem(item, pool, seed) {
  const distractors = ring(
    pool.filter((x) => x.id !== item.id && x.reading !== item.reading),
    seed,
  ).map((x) => x.term);
  return {
    section: SECTION_VOCAB,
    type: "表記",
    instruction: "＿＿＿の言葉を漢字で書くとき、最もよいものを一つ選びなさい。",
    // Every occurrence, or the kanji is still on the page next to the question.
    passage: item.examples[0].ja.replaceAll(item.term, mark(item.reading)),
    prompt: `${mark(item.reading)}を漢字で書くとどれですか。`,
    ...rotateOptions(item.term, distractors, seed),
    explanationZh: `「${item.reading}」的正確表記是「${item.term}」，中文意思是「${item.meaningZh}」。`,
    sourceCardId: item.id,
    logic: "orthography",
  };
}

export function vocabClozeItem(item, pool, seed) {
  const candidates = pool.filter(
    (x) =>
      x.id !== item.id &&
      x.term !== item.term &&
      disjointGloss(item, x) &&
      !item.examples[0].ja.includes(x.term),
  );
  const distractors = ring(candidates, seed).map((x) => x.term);
  const reading =
    item.reading && item.reading !== item.term
      ? `，讀作「${item.reading}」`
      : "";
  return {
    section: SECTION_VOCAB,
    type: "文脈規定",
    instruction: "（　）に入れるのに最もよいものを、一つ選びなさい。",
    passage: item.examples[0].ja.replaceAll(item.term, "（　）"),
    prompt: "（　）に入る言葉はどれですか。",
    ...rotateOptions(item.term, distractors, seed),
    explanationZh: `空格處應填「${item.term}」${reading}，意思是「${item.meaningZh}」。例句：${item.examples[0].ja}`,
    sourceCardId: item.id,
    logic: "vocab-cloze",
  };
}

export function grammarClozeItem(item, pool, seed, functionOf) {
  const correctFunction = functionOf(item.term);
  // A distractor expressing the same function could be defensible in the blank.
  const candidates = pool.filter(
    (x) => x.id !== item.id && functionOf(x.term) !== correctFunction,
  );
  const distractors = ring(candidates, seed).map((x) => x.term);
  return {
    section: SECTION_GRAMMAR,
    type: "文法形式の判断",
    instruction: "（　）に入れるのに最もよいものを、一つ選びなさい。",
    passage: item.examples[0].ja.replaceAll(patternCore(item.term), "（　）"),
    prompt: "（　）に入る文法はどれですか。",
    ...rotateOptions(item.term, distractors, seed),
    explanationZh: `空格處應填「${item.term}」，${item.meaningZh}此處用來「${correctFunction}」。例句：${item.examples[0].ja}`,
    sourceCardId: item.id,
    logic: "grammar-cloze",
  };
}

export const ITEM_BUILDERS = {
  kanji: kanjiReadingItem,
  orthography: orthographyItem,
  "vocab-cloze": vocabClozeItem,
};
