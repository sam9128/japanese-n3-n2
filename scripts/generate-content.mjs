import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { grammarExamples } from "./source/grammar-examples.mjs";
import { buildReading, buildListening } from "./source/build-media.mjs";
import { readingFormatFor, listeningFormatFor, READING_TOTAL, LISTENING_TOTAL } from "./source/jlpt-formats.mjs";
import { ITEM_BUILDERS, grammarClozeItem, hasOwnExample, patternCore, usableForGrammarCloze, usableForReading } from "./source/build-items.mjs";
import { buildPractice, PRACTICE_PER_MONTH } from "./source/build-practice.mjs";
import { hasChineseMarker } from "./source/chinese-marker.mjs";
import { loadVocabAuthority } from "./source/vocab-authority.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const printSamples = process.argv.includes("--print-samples");
const printGrammarMap = process.argv.includes("--print-grammar-map");
const outRoot = path.join(root, "public", "content", "periods");
const periods = ["115-07", "115-08", "115-09", "115-10", "115-11", "115-12", "116-01", "116-02", "116-03", "116-04", "116-05", "116-06"];
// Cumulative unlock caps per period.
//
// Neither vocabulary nor grammar has hand-written caps any more. Both used to,
// and in both the cap disagreed with the line that assigned the level, because
// the level was a slice index over a list that was not sorted by difficulty:
//   grammar   `index < 180`  — released sixty N3 patterns in 116-01..116-03,
//                              one to three months after the 115/12/06 sitting.
//   vocabulary `index < 1600` — its underlying level came from a CEFR proxy, and
//                              657 words at N3 or below landed after the exam.
// Two constants that must agree are one constant too many, so the schedule is
// derived from the levels themselves; see halfYearPeriod.
//
// 115-11 and 115-12 hold no new material on purpose: 115/11 is the five-mock
// month and the sitting is 115/12/06, so both are revision only.
const N3_MONTHS = 4; // 115-07..115-10.
const N2_MONTHS = 6; // 116-01..116-06.
const sigureRefs = {
  vocabulary: {
    N3: "https://www.sigure.tw/learn-japanese/vocabulary/n3/",
    N2: "https://www.sigure.tw/learn-japanese/vocabulary/n2/",
  },
  grammar: {
    N3: "https://www.sigure.tw/learn-japanese/grammar/n3/",
    N2: "https://www.sigure.tw/learn-japanese/grammar/n2/",
  },
  reading: "https://www.sigure.tw/quiz/reading/medium/",
};
const readSource = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, "scripts", "source", name), "utf8"));
// Word forms, kana readings, part of speech and English senses, resolved against
// JMdict by scripts/rebuild-vocab-authority.mjs.
// Carries the hand-decided reading fixes; see scripts/source/vocab-authority.mjs.
const vocabAuthority = loadVocabAuthority();
// Hand-written Traditional Chinese, keyed by the numeric part of the vocab id.
const vocabZh = readSource("vocab-zh.json");
// Hand-written example sentences for entries the source deck cannot supply.
const vocabExamples = readSource("vocab-examples.json");
// Hand-written Chinese for deck sentences that had no translation yet, keyed by
// vocab id so the same Japanese sentence can be glossed per entry.
const vocabExampleZh = readSource("vocab-example-zh.json");
// Hand-written per-pattern grammar meaning and connection notes.
const grammarZh = readSource("grammar-zh.json");
const exampleTranslationsZh = readSource("example-translations-zh.json");
// Part-of-speech labels, keyed by the JMdict codes carried in vocab-authority.json.
const POS_LABEL = {
  n: "名詞", "n-suf": "名詞（接尾）", "n-pref": "名詞（接頭）", "n-adv": "名詞兼副詞",
  "n-t": "時間名詞", pn: "代名詞", num: "數詞", ctr: "量詞",
  adv: "副詞", "adv-to": "副詞（可加「と」）",
  "adj-i": "い形容詞", "adj-na": "な形容詞", "adj-no": "の形容詞（後接名詞加「の」）",
  "adj-f": "連體詞", "adj-t": "たる形容詞", "adj-nari": "なり形容詞",
  vs: "サ變動詞（名詞＋する）", "vs-s": "サ變動詞（〜す）", "vs-i": "サ變動詞（〜ずる）",
  vt: "他動詞", vi: "自動詞", v1: "一段動詞", vk: "カ變動詞（来る）", vz: "サ變動詞（〜ずる）",
  v5u: "五段動詞（う結尾）", v5k: "五段動詞（く結尾）", v5g: "五段動詞（ぐ結尾）",
  v5s: "五段動詞（す結尾）", v5t: "五段動詞（つ結尾）", v5n: "五段動詞（ぬ結尾）",
  v5b: "五段動詞（ぶ結尾）", v5m: "五段動詞（む結尾）", v5r: "五段動詞（る結尾）",
  v5aru: "五段動詞（特殊活用）", "v5k-s": "五段動詞（行く型）",
  "v5u-s": "五段動詞（特殊活用）", "v5r-i": "五段動詞（特殊活用）",
  exp: "慣用表現", int: "感嘆詞", conj: "接續詞", prt: "助詞", suf: "接尾語", pref: "接頭語",
  "aux-adj": "助動詞（形容詞型）", "aux-v": "助動詞", aux: "助動詞", cop: "斷定助動詞",
};

function posLabels(pos = []) {
  const seen = new Set();
  const labels = [];
  for (const code of pos) {
    const label = POS_LABEL[code];
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

// Advice that actually differs by word class, instead of one sentence for all 4000.
function posAdvice(pos = []) {
  const has = (code) => pos.includes(code);
  const tips = [];
  if (has("vt") && has("vi")) tips.push("他動詞與自動詞同形，靠助詞「を／が」判斷是誰做、誰變化");
  else if (has("vt")) tips.push("他動詞，受詞用「を」標示");
  else if (has("vi")) tips.push("自動詞，不接受詞「を」");
  if (has("vs") || has("vs-s") || has("vs-i")) tips.push("加「する」即可當動詞使用");
  if (has("adj-i")) tips.push("い形容詞，修飾名詞時直接接，否定為「〜くない」");
  if (has("adj-na")) tips.push("な形容詞，修飾名詞時要加「な」");
  if (has("adj-no")) tips.push("修飾名詞時要加「の」");
  if (has("adv") || has("adv-to")) tips.push("副詞，用來修飾動作或整句語氣");
  if (has("n-suf") || has("suf")) tips.push("接在其他語詞後面構成新詞");
  if (has("n-pref") || has("pref")) tips.push("接在其他語詞前面構成新詞");
  if (has("ctr")) tips.push("量詞，接在數字後面計數");
  if (has("exp")) tips.push("固定說法，整句一起記");
  if (has("int")) tips.push("感嘆詞，單獨使用表達語氣");
  if (has("prt")) tips.push("助詞，注意它標示的是主語、受詞還是範圍");
  if (!tips.length) tips.push("請連同例句中的搭配一起記憶");
  return tips;
}

function vocabUsageZh(row, meaningZh) {
  const labels = posLabels(row.pos);
  const head = labels.length ? "詞性：" + labels.join("、") + "。" : "";
  const senseCount = (row.senses || []).length;
  const primary = meaningZh.split("；")[0];
  const multi =
    senseCount > 1
      ? "本詞另有 " + (senseCount - 1) + " 個義項，本卡以最常用的「" + primary + "」為主，其餘請依上下文判斷。"
      : "";
  // JMdict's s_inf notes are English and would be the only non-Chinese text on
  // the card, so they are deliberately not surfaced here.
  return (head + posAdvice(row.pos).join("；") + "。" + multi).trim();
}

// Explanation shape varies by word class so the 4000 cards do not all read alike.
function vocabExplanationZh(row, meaningZh) {
  const term = row.term;
  const first = meaningZh.split("；")[0];
  const kana = row.reading && row.reading !== term ? "（" + row.reading + "）" : "";
  const pos = row.pos || [];
  const isVerb =
    pos.includes("vt") || pos.includes("vi") || pos.includes("vs") || /^v[0-9k-z]/.test(pos[0] || "");
  if (isVerb) {
    const role = pos.includes("vt")
      ? "承接前面用「を」標示的受詞"
      : pos.includes("vi")
        ? "描述主語本身的動作或變化"
        : "在句中作動詞使用";
    return "例句裡的「" + term + "」" + kana + role + "，這裡表示「" + first + "」。請留意它前面搭配的助詞。";
  }
  if (pos.includes("adj-i") || pos.includes("adj-na") || pos.includes("adj-no")) {
    return "「" + term + "」" + kana + "在句中描述狀態或性質，意思是「" + first + "」。注意它接名詞與放句尾時的形式差異。";
  }
  if (pos.includes("adv") || pos.includes("adv-to")) {
    return "「" + term + "」" + kana + "修飾後面的動作或整句語氣，表示「" + first + "」。可觀察它擺放的位置。";
  }
  if (pos.includes("exp")) {
    return "「" + term + "」" + kana + "是固定說法，整句表示「" + first + "」，不要拆開逐字理解。";
  }
  if (pos.includes("ctr") || pos.includes("n-suf") || pos.includes("suf")) {
    return "「" + term + "」" + kana + "接在前面的語詞之後，表示「" + first + "」。記憶時連同前面的搭配一起記。";
  }
  if (pos.includes("int")) {
    return "「" + term + "」" + kana + "是感嘆詞，單獨使用即可表達「" + first + "」的語氣。";
  }
  return "例句中的「" + term + "」" + kana + "是名詞，指「" + first + "」。請一併記住它在句中搭配的助詞。";
}

// A natural sentence conjugates: 集める appears as 集めている. Verbs and i-adjectives
// are therefore matched on their stem, while nouns keep the strict check, because
// loose matching on short kana nouns is exactly what filed a sentence about a bag
// under バック (rear).
function exampleDemonstrates(row, sentence) {
  const forms = [row.term, row.reading];
  const inflects =
    (row.pos || []).some((p) => /^v/.test(p)) || (row.pos || []).includes("adj-i");
  if (inflects) {
    for (const form of [row.term, row.reading]) {
      if (form && form.length > 1) forms.push(form.slice(0, -1));
    }
  }
  return forms.some((form) => form && sentence.includes(form));
}

function resolveVocabExample(row) {
  // 1. A fully hand-written example, for entries the source deck cannot supply.
  const authored = vocabExamples[row.id];
  if (authored?.ja && authored?.zh) return { ja: authored.ja, zh: authored.zh };
  const deck = row.deckExample;
  if (!deck?.ja) throw new Error("單字缺少可用例句：" + row.id + " " + row.term);
  // 2. The deck sentence with a translation written for this entry.
  if (vocabExampleZh[row.id]) return { ja: deck.ja, zh: vocabExampleZh[row.id] };
  // 3. The deck sentence with a translation already in the shared pool.
  if (exampleTranslationsZh[deck.ja]) return { ja: deck.ja, zh: exampleTranslationsZh[deck.ja] };
  throw new Error("單字缺少例句中文翻譯：" + row.id + " " + deck.ja);
}

// Spread N items across the 12 periods as evenly as possible. Flooring index/5
// left 116-05 with two reading articles and 116-06 with none, because 52 does
// not divide by 5 into 12 buckets.
function spreadPeriod(index, total) {
  return Math.min(periods.length - 1, Math.floor((index * periods.length) / total));
}

function periodFor(index, caps) {
  return periods[caps.findIndex((cap) => index + 1 <= cap)];
}

// Which half-year each word belongs to, from the JLPT levels in its own source
// file rather than from its position in the spine. See that file's _note.
const vocabHalf = readSource("vocab-levels.json").half;
const vocabOrder = { N3: [], N2: [] };

function loadWords() {
  if (vocabAuthority.length !== 4000) {
    throw new Error("單字骨架數量不符：" + vocabAuthority.length);
  }
  const missingLevels = vocabAuthority.filter((row) => !vocabHalf[row.id]);
  if (missingLevels.length) {
    throw new Error("單字缺少分級：" + missingLevels.slice(0, 5).map((r) => r.id).join("、"));
  }
  vocabOrder.N3 = vocabAuthority.filter((row) => vocabHalf[row.id] === "N3").map((r) => r.id);
  vocabOrder.N2 = vocabAuthority.filter((row) => vocabHalf[row.id] === "N2").map((r) => r.id);
  return vocabAuthority.map((row, index) => {
    const key = row.id.slice(6);
    const meaningZh = vocabZh[key];
    if (!meaningZh) throw new Error("單字缺少中文釋義：" + row.id + " " + row.term);
    const example = resolveVocabExample(row);
    if (!exampleDemonstrates(row, example.ja)) {
      throw new Error("例句未包含詞條：" + row.id + " " + row.term + " / " + example.ja);
    }
    const level = vocabHalf[row.id];
    if (!level) throw new Error("單字缺少分級：" + row.id + " " + row.term);
    const hasKanji = /[一-龯]/.test(row.term);
    return {
      id: row.id,
      level,
      category: "vocab",
      term: row.term,
      reading: row.reading,
      // Readings come from JMdict now, so reading quizzes no longer have to skip
      // long-vowel words in order to hide the macron-stripping bug.
      readingQuizEligible: hasKanji && row.reading !== row.term,
      meaningZh,
      meaningEn: row.glossEn,
      usageZh: vocabUsageZh(row, meaningZh),
      examples: [
        {
          ja: example.ja,
          zh: example.zh,
          explanationZh: vocabExplanationZh(row, meaningZh),
        },
      ],
      // Speak the kana, not the word form. A speech engine reading 最中 off the kanji
      // says もなか (the sweet), 空く says あく, 仏 says ぶつ — the card then teaches one
      // reading and plays another. The kana is unambiguous, and nothing is given away
      // by it: the study quiz asks for the meaning, and the 漢字読み practice questions
      // carry no audio at all.
      audioText: row.reading || row.term,
      unlockPeriod: halfYearPeriod(vocabOrder, row.id, level),
      tags: [...new Set([...(row.pos || []).slice(0, 2), level])],
      sourceRefs: [
        "https://www.edrdg.org/jmdict/j_jmdict.html",
        "https://github.com/vbvss199/Language-Learning-decks",
        sigureRefs.vocabulary[level],
      ],
      referenceNoteZh:
        "詞形、假名讀音與詞性取自 JMdict；繁體中文釋義、用法說明與例句解析為本計畫自行撰寫，未轉載他站內容。",
      license:
        "JMdict/EDRDG licence (CC BY-SA 4.0); Language-Learning-decks MIT; Chinese glosses CC BY 4.0 — 本計畫自編",
    };
  });
}

const grammarPatterns = `〜うちに|〜間に|〜間|〜てからでないと|〜ところだ|〜たところだ|〜ているところだ|〜ばかりだ|〜たばかり|〜ようとする|〜つつある|〜つつ|〜一方だ|〜ことになっている|〜ことにしている|〜ことになる|〜ことにする|〜ようになる|〜ようにする|〜ようにしている|〜ことがある|〜ことはない|〜わけだ|〜わけではない|〜わけがない|〜わけにはいかない|〜はずだ|〜はずがない|〜べきだ|〜べきではない|〜ものだ|〜ものではない|〜ということだ|〜とのことだ|〜と言われている|〜とみえる|〜ようだ|〜みたいだ|〜らしい|〜そうだ（樣態）|〜そうだ（傳聞）|〜っぽい|〜がちだ|〜気味だ|〜げ|〜かもしれない|〜に違いない|〜に決まっている|〜おそれがある|〜可能性がある|〜ために（目的）|〜ために（原因）|〜ように（目的）|〜ように（祈願）|〜によって|〜によると|〜によれば|〜を通じて|〜を通して|〜に対して|〜について|〜に関して|〜をめぐって|〜にとって|〜として|〜において|〜に基づいて|〜に応じて|〜に比べて|〜に加えて|〜に反して|〜にかわって|〜に代わり|〜にこたえて|〜に沿って|〜につれて|〜にしたがって|〜にともなって|〜とともに|〜に限って|〜に限らず|〜だけでなく|〜ばかりでなく|〜はもちろん|〜のみならず|〜さえ|〜こそ|〜なんか|〜など|〜にしては|〜わりに|〜くせに|〜にもかかわらず|〜ながらも|〜ものの|〜とはいえ|〜といっても|〜からといって|〜ても|〜たとえ〜ても|〜としても|〜にしても|〜にしろ|〜にせよ|〜なら|〜としたら|〜とすれば|〜ば|〜たら|〜と|〜ないことには|〜限り|〜限りでは|〜ない限り|〜さえ〜ば|〜てこそ|〜からこそ|〜ば〜ほど|〜なら〜ほど|〜ほど|〜くらい|〜だけ|〜だけあって|〜だけに|〜だけのことはある|〜につき|〜ごとに|〜おきに|〜たびに|〜たび|〜にあたって|〜際に|〜に先立って|〜て以来|〜てからというもの|〜をきっかけに|〜を契機に|〜次第|〜次第で|〜次第だ|〜次第では|〜上で|〜上に|〜上は|〜以上|〜からには|〜からして|〜からすると|〜から見ると|〜から言うと|〜にしても|〜にしたって|〜というより|〜どころか|〜どころではない|〜どころではなく|〜反面|〜一方で|〜かわりに|〜にかわって|〜た末に|〜あげく|〜結果|〜ところを|〜ところに|〜ところへ|〜最中に|〜最中だ|〜途中で|〜かけ|〜きる|〜きれない|〜ぬく|〜通す|〜込む|〜出す|〜始める|〜終わる|〜続ける|〜ていく|〜てくる|〜ておく|〜てある|〜てしまう|〜てみる|〜てもらう|〜てくれる|〜ていただく|〜てくださる|〜させてもらう|〜させていただく|〜てもかまわない|〜てはいけない|〜ないで済む|〜ずに済む|〜ずにはいられない|〜ないではいられない|〜てたまらない|〜てならない|〜てしょうがない|〜て仕方がない|〜ないことはない|〜ないわけではない|〜というものではない|〜ものか|〜ことか|〜ことだ|〜ことだから|〜ことなく|〜ことに|〜ことから|〜ことには|〜ものなら|〜ものだから|〜ものの|〜ものを|〜わけにはいかない|〜どんなに〜ことか|〜なんて|〜とは|〜という|〜といった|〜といえば|〜というと|〜といったら|〜にほかならない|〜にすぎない|〜に相違ない|〜に違いない|〜に決まっている|〜に越したことはない|〜ざるを得ない|〜ないわけにはいかない|〜かねない|〜かねる|〜かのようだ|〜かと思うと|〜かと思ったら|〜や否や|〜なり|〜そばから|〜ては|〜てばかりいる|〜ないうちに|〜か〜ないかのうちに|〜を問わず|〜にかかわらず|〜にもかかわらず|〜をものともせず|〜をよそに|〜に先駆けて|〜に至るまで|〜に至って|〜に至る|〜に至っては`.split("|");

function explainGrammar(term) {
  const entry = grammarZh[term];
  if (!entry?.meaning) throw new Error("文法句型缺少語意說明：" + term);
  return entry.meaning;
}

function grammarUsageZh(term) {
  const entry = grammarZh[term];
  if (!entry?.usage) throw new Error("文法句型缺少接續說明：" + term);
  return entry.usage;
}

function grammarAudioText(term) {
  return term.replace(/[〜～]/g, "").replace(/[（(][^）)]*[）)]/g, "").trim();
}
// Which level each pattern belongs to. A source file rather than a slice index:
// the old `index < 180` cut a thematically ordered list, so it labelled 〜てみる
// and 〜てもらう N2 while calling 〜だけあって and 〜次第で N3. See its _note.
const grammarLevels = readSource("grammar-levels.json").levels;

/**
 * Which month an item opens in, derived from its level.
 *
 * Each half-year holds its own level and spreads its own items evenly, so the N3
 * set is complete before the mocks in 115/11 and the sitting on 115/12/06 —
 * whatever the counts turn out to be after a re-classification. Shared by
 * vocabulary and grammar because both had the same fault: a level from a slice
 * index, and a schedule from a separate hand-written cap that disagreed with it.
 *
 * `order` maps a level to its items in teaching order; `key` is the term (for
 * grammar) or the card id (for vocabulary).
 */
function halfYearPeriod(order, key, level) {
  const list = order[level];
  const at = list.indexOf(key);
  const offset = level === "N3" ? 0 : N3_MONTHS + 2; // skip the two revision months
  const months = level === "N3" ? N3_MONTHS : N2_MONTHS;
  return periods[offset + Math.min(months - 1, Math.floor((at * months) / list.length))];
}

const grammarOrder = { N3: [], N2: [] };

function makeGrammar() {
  const unique = [...new Set(grammarPatterns)].slice(0, 240);
  if (unique.length < 240) throw new Error(`文法句型不足：${unique.length}`);
  const missingExamples = unique.filter((term) => !grammarExamples.has(term));
  if (missingExamples.length) throw new Error(`文法例句不足：${missingExamples.join("、")}`);
  const missingLevels = unique.filter((term) => !grammarLevels[term]);
  if (missingLevels.length) throw new Error(`文法句型缺少分級：${missingLevels.join("、")}`);
  grammarOrder.N3 = unique.filter((term) => grammarLevels[term] === "N3");
  grammarOrder.N2 = unique.filter((term) => grammarLevels[term] === "N2");
  return unique.map((term, index) => {
    const exampleJa = grammarExamples.get(term);
    const exampleZh = exampleTranslationsZh[exampleJa];
    if (!exampleZh) throw new Error(`例句缺少中文翻譯：${exampleJa}`);
    const level = grammarLevels[term];
    return {
      id: `grammar-${String(index + 1).padStart(3, "0")}`, level, category: "grammar", term,
      reading: "文法句型", meaningZh: explainGrammar(term), usageZh: grammarUsageZh(term),
      examples: [{ ja: exampleJa, zh: exampleZh, explanationZh: `這句使用「${term}」。${explainGrammar(term)}` }],
      audioText: grammarAudioText(term), unlockPeriod: halfYearPeriod(grammarOrder, term, level),
      tags: [`${level}文法`], sourceRefs: ["self-authored", sigureRefs.grammar[level]],
      referenceNoteZh: `句型分級與接續觀念交叉參考時雨之町 ${level} 文法索引；解釋、例句與題目均為本計畫自編。`,
      license: "CC BY 4.0 — 本計畫自編"
    };
  });
}

function rotateOptions(correct, distractors, seed) {
  const options = [...new Set([correct, ...distractors.filter((item) => item !== correct)])].slice(0, 4);
  if (options.length !== 4) throw new Error(`選項不足：${correct}`);
  const shift = seed % options.length;
  const rotated = [...options.slice(shift), ...options.slice(0, shift)];
  return { options:rotated, answer:rotated.indexOf(correct) };
}

const grammarFunctions = [
  "条件や仮定を表している", "目的を表している", "原因や理由を表している", "願望や祈りを表している",
  "予想と異なる結果や対比を表している", "推量や伝聞を表している", "時間や動作の前後関係を表している",
  "範囲の限定や強調を表している", "決定・義務・許可を表している", "状態の変化や動作の進行を表している",
  "話題・立場・対象との関係を表している", "程度や比較を表している", "気持ちや評価を強く表している", "説明・引用・言い換えを表している",
  "経験・習慣・一般的な傾向を表している", "否定・不可能・部分否定を表している", "情報の根拠や引用を表している",
  "試み・授受・依頼を表している", "結果・きっかけ・判断の根拠を表している", "例示や話題の提示を表している",
  "追加・並行・変化の連動を表している", "自然に起こる強い感情や衝動を表している"
];

function grammarFunctionJa(term) {
  if (/(といっても|にしては|といったら)/.test(term)) return "予想と異なる結果や対比を表している";
  if (/(というものではない)/.test(term)) return "否定・不可能・部分否定を表している";
  if (/(に越したことはない)/.test(term)) return "程度や比較を表している";
  if (/(ことには|〜限り$|〜ては$)/.test(term)) return "条件や仮定を表している";
  if (/(〜つつ$)/.test(term)) return "追加・並行・変化の連動を表している";
  if (/(〜上で$)/.test(term)) return "時間や動作の前後関係を表している";
  if (/(〜ことなく$)/.test(term)) return "否定・不可能・部分否定を表している";
  if (/(〜ものだから$)/.test(term)) return "原因や理由を表している";
  if (/(〜次第だ$|にほかならない)/.test(term)) return "結果・きっかけ・判断の根拠を表している";
  if (/(ということだ|とのことだ|と言われている|によると|によれば)/.test(term)) return "情報の根拠や引用を表している";
  if (/(ずにはいられない|ないではいられない)/.test(term)) return "自然に起こる強い感情や衝動を表している";
  if (/(かと思ったら|かと思うと|や否や|なり$|そばから|か.*ないかのうちに)/.test(term)) return "時間や動作の前後関係を表している";
  if (/(ことになっている|ことにしている|ようにしている|ものではない|ことだ$)/.test(term)) return "決定・義務・許可を表している";
  if (/(わけではない|わけがない|はずがない|ことはない|ないことはない|ないわけではない|というものではない|ものか|どころではない|どころではなく|ないで済む|ずに済む)/.test(term)) return "否定・不可能・部分否定を表している";
  if (/(ことがある|ものだ$|てばかりいる)/.test(term)) return "経験・習慣・一般的な傾向を表している";
  if (/(てもらう|てくれる|ていただく|てくださる|させてもらう|させていただく|てみる|ようとする)/.test(term)) return "試み・授受・依頼を表している";
  if (/(に加えて|に沿って|につれて|にしたがって|にともなって|とともに|上に)/.test(term)) return "追加・並行・変化の連動を表している";
  if (/(をきっかけに|を契機に|た末に|あげく|結果|からして|からすると|から見ると|から言うと)/.test(term)) return "結果・きっかけ・判断の根拠を表している";
  if (/(なんか|など|なんて|とは$|という$|といった$|というと|といえば|というより)/.test(term)) return "例示や話題の提示を表している";
  if (/(ために（原因）|につき|ことだから|ことから)/.test(term)) return "原因や理由を表している";
  if (/(ために（目的）|ように（目的）)/.test(term)) return "目的を表している";
  if (/(ように（祈願）|どんなに.*ことか|ことか)/.test(term)) return "願望や祈りを表している";
  if (/(てからでないと|ば$|たら$|なら$|としたら|とすれば|としても|にしても|にしろ|にせよ|ないことには|ない限り|さえ.*ば|ものなら|たとえ|次第で|次第では|上は|以上|からには|ても$|〜と$|にしたって)/.test(term)) return "条件や仮定を表している";
  if (/(ものの|にもかかわらず|ながらも|くせに|わりに|に反して|とはいえ|からといって|どころか|反面|一方で|にしては|といっても|ものを)/.test(term)) return "予想と異なる結果や対比を表している";
  if (/(ようだ|みたいだ|らしい|そうだ|かもしれない|に違いない|に決まっている|おそれがある|可能性|とみえる|かのようだ|はずだ|に相違ない|かねない)/.test(term)) return "推量や伝聞を表している";
  if (/(うちに|間に|間$|ところ|最中|途中|際に|にあたって|に先立って|て以来|てからというもの|たび|次第$|ごとに|おきに|たばかり)/.test(term)) return "時間や動作の前後関係を表している";
  if (/(だけ|しか|に限|のみならず|ばかりでなく|はもちろん|さえ|こそ|を問わず|にかかわらず|にすぎない|限りでは)/.test(term)) return "範囲の限定や強調を表している";
  if (/(ことにする|ことになる|ようにする|べき|わけにはいかない|ざるを得ない|てはいけない|てもかまわない|かねる)/.test(term)) return "決定・義務・許可を表している";
  if (/(ていく|てくる|つつある|一方だ|始める|続ける|終わる|きる|きれない|ぬく|通す|込む|出す|ておく|てある|てしまう|ようになる|ばかりだ|かけ)/.test(term)) return "状態の変化や動作の進行を表している";
  if (/(について|に関して|に対して|にとって|として|において|をめぐって|に基づいて|に応じて|によって|を通じて|を通して|にかわって|に代わり|にこたえて)/.test(term)) return "話題・立場・対象との関係を表している";
  if (/(ほど|くらい|に比べて|ば.*ほど|なら.*ほど|だけあって|だけに|に越したことはない)/.test(term)) return "程度や比較を表している";
  if (/(てたまらない|てならない|てしょうがない|て仕方がない|ことに|げ|気味|がち|っぽい|といったら)/.test(term)) return "気持ちや評価を強く表している";
  return "説明・引用・言い換えを表している";
}

const assessmentUsage = {vocabulary:new Set(),grammar:new Set(),reading:new Set(),listening:new Set()};

function orderedLevelPool(items, level, maxPeriod) {
  const unlocked = items.filter((item) => periods.indexOf(item.unlockPeriod) <= maxPeriod);
  const exact=unlocked.filter((item)=>item.level===level);
  return exact.length ? exact : unlocked.filter((item)=>item.level!==level);
}

function takeUnused(items, used, seed, key = (item)=>item.id, label = "題庫") {
  for (let offset=0; offset<items.length; offset+=1) {
    const item=items[(seed+offset)%items.length];
    const itemKey=key(item);
    if (!used.has(itemKey)) { used.add(itemKey); return item; }
  }
  throw new Error(`${label}不足，無法產生不重複題目（可用 ${items.length}，已使用 ${used.size}）`);
}

// Exam items, shaped like the 大問 of the real paper.
//
// 読解 and 聴解 already came from JLPT-shaped source material. 文字・語彙 and 文法
// did not: 漢字読み asked "「違う」の読み方はどれですか" with no sentence, which the
// real exam never does, and the 文法 item asked what a pattern "means" and offered
// abstract function labels — a question about grammar rather than a use of it.
//
// The four types below are the ones this content can support honestly. Three
// more real 大問 are deliberately absent because building them from what we have
// would mean inventing data: 言い換え類義 needs vetted synonyms, 用法 needs
// sentences that use a word *incorrectly*, and 文の組み立て needs sentences split
// into chunks that are valid to reorder. Guessing at any of those produces items
// with more than one defensible answer, which is worse than not having them.


// How a paper is made up.
//
// The item types were already JLPT-shaped, but the paper was not: questions
// cycled 文字・語彙 → 文法 → 読解 → 聴解 one at a time, which left every mock with
// 13% listening against the real exam's 27–29%, and interleaved the sections
// rather than grouping them the way a real paper does.
//
// The mocks now follow the real proportions. The monthly checks deliberately do
// not: the listening bank holds 112 questions and no exam question may reuse a
// source, so faithful listening everywhere would need 121+. The mocks are what
// simulate the real sitting, so they get the full share and the monthly checks —
// progress checks, not rehearsals — run lighter at 20%.
// Every paper now uses the real exam's own question counts as weights, so the
// proportions come out right at any length. The monthly checks used to run at
// 15% listening because the bank could not supply more; twenty extra scripts
// took it from 112 questions to 132, which covers the 126 a full-proportion year
// needs.
const EXAM_BLUEPRINTS = {
  // N3 paper: 文字・語彙 35, 文法 23, 読解 16, 聴解 28
  N3: { vocab: 35, grammar: 23, reading: 16, listening: 28 },
  // N2 paper: 文字・語彙 32, 文法 22, 読解 21, 聴解 31
  N2: { vocab: 32, grammar: 22, reading: 21, listening: 31 },
};

// Within 文字・語彙, the real paper's own weighting between the three 大問 we build.
const VOCAB_MIX = {
  N3: { kanji: 8, orthography: 6, cloze: 11 },
  N2: { kanji: 5, orthography: 5, cloze: 7 },
};

// Largest remainder, so the parts always add back up to the whole.
function allocate(total, weights) {
  const sum = Object.values(weights).reduce((n, w) => n + w, 0);
  const exact = Object.entries(weights).map(([key, weight]) => ({
    key,
    value: (total * weight) / sum,
  }));
  const counts = Object.fromEntries(exact.map(({ key, value }) => [key, Math.floor(value)]));
  let left = total - Object.values(counts).reduce((n, v) => n + v, 0);
  for (const { key } of [...exact].sort((a, b) => (b.value % 1) - (a.value % 1))) {
    if (left <= 0) break;
    counts[key] += 1;
    left -= 1;
  }
  return counts;
}

/**
 * The question types of one paper, in the order a real paper asks them.
 *
 * Grouped by section — all 文字・語彙 first, then 文法, 読解, 聴解 — and inside
 * 文字・語彙 in the paper's own order of 漢字読み, 表記, 文脈規定.
 */
function examPlan(kind, level, questionCount) {
  const blueprint = EXAM_BLUEPRINTS[level] || EXAM_BLUEPRINTS.N3;
  const sections = allocate(questionCount, blueprint);
  const vocab = allocate(sections.vocab, VOCAB_MIX[level] || VOCAB_MIX.N3);
  return [
    ...Array(vocab.kanji).fill("kanji"),
    ...Array(vocab.orthography).fill("orthography"),
    ...Array(vocab.cloze).fill("vocab-cloze"),
    ...Array(sections.grammar).fill("grammar-cloze"),
    ...Array(sections.reading).fill("reading"),
    ...Array(sections.listening).fill("listening"),
  ];
}

function makeExamQuestions(id, level, period, questionCount, catalog, kind) {
  const maxPeriod = periods.indexOf(period);
  const vocabPool = orderedLevelPool(catalog.vocabulary,level,maxPeriod);
  const kanjiPool = vocabPool.filter(usableForReading);
  const clozePool = vocabPool.filter(hasOwnExample);
  const grammarClozePool = orderedLevelPool(catalog.grammar,level,maxPeriod).filter(usableForGrammarCloze);
  const readingPool = orderedLevelPool(catalog.reading,level,maxPeriod).flatMap((item)=>item.questions.map((question,questionIndex)=>({item,question,questionIndex,id:`${item.id}-q${questionIndex+1}`})));
  // 統合理解 carries two questions; taking only the first threw half the pool away.
  const listeningPool = orderedLevelPool(catalog.listening,level,maxPeriod).flatMap((item)=>item.questions.map((question,questionIndex)=>({item,question,questionIndex,id:`${item.id}-q${questionIndex+1}`})));
  const used=assessmentUsage;
  const seedBase = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const plan = examPlan(kind, level, questionCount);

  return Array.from({length:questionCount}, (_, index) => {
    const seed = seedBase * 17 + index * 13;
    const qid = `${id}-q${index+1}`;
    const type = plan[index];

    // ---------------------------------------------------------- 文字・語彙
    if (type === "kanji" || type === "orthography") {
      const item=takeUnused(kanjiPool,used.vocabulary,seed,undefined,`${id} ${type==="kanji"?"漢字読み":"表記"}`);
      return { id:qid, ...ITEM_BUILDERS[type](item,kanjiPool,seed) };
    }
    if (type === "vocab-cloze") {
      const item=takeUnused(clozePool,used.vocabulary,seed,undefined,`${id} 文脈規定`);
      return { id:qid, ...ITEM_BUILDERS[type](item,clozePool,seed) };
    }

    // -------------------------------------------------------------- 文法
    if (type === "grammar-cloze") {
      const item=takeUnused(grammarClozePool,used.grammar,seed,undefined,`${id} 文法形式`);
      return { id:qid, ...grammarClozeItem(item,grammarClozePool,seed,grammarFunctionJa) };
    }

    // ------------------------------------------------------- 読解・聴解
    if (type === "reading") {
      const entry=takeUnused(readingPool,used.reading,seed,undefined,`${id} 読解`);
      return { id:qid, section:"読解", type:entry.question.jlptType, instruction:"次の文章を読んで、質問に答えなさい。", passage:entry.item.content, prompt:entry.question.prompt, options:entry.question.options, answer:entry.question.answer, explanationZh:entry.question.explanation, sourceQuestionId:entry.question.id, logic:"reading-source" };
    }
    const entry=takeUnused(listeningPool,used.listening,seed,undefined,`${id} 聴解`);
    return { id:qid, section:"聴解", type:entry.question.jlptType, instruction:"音声を聞いて、質問に答えなさい。", prompt:entry.question.prompt, audioText:entry.item.audioText, options:entry.question.options, answer:entry.question.answer, explanationZh:entry.question.explanation, sourceQuestionId:entry.question.id, logic:"listening-source" };
  });
}

function makeAssessment(id, title, level, period, minutes, questionCount, kind, catalog) {
  return { id, title, level, category:"assessment", kind, unlockPeriod:period, durationMinutes:minutes, threshold:60, scoreTotal:100, sourceRefs:["self-authored", "https://www.jlpt.jp/e/samples/sampleindex.html"], license:"CC BY 4.0 — 自編題目；官方連結僅供題型參考", questionCount, questions:makeExamQuestions(id,level,period,questionCount,catalog,kind) };
}

const vocabulary = loadWords();
const grammar = makeGrammar();
const reading = buildReading(periods, spreadPeriod);
const listening = buildListening(periods, spreadPeriod);
const catalog = { vocabulary, grammar, reading, listening };
// 116/04 is the plan's N2 實戰期, so the first N2 mock sits there rather than both
// landing in the final month; the second stays in 116/06 as the closing rehearsal.
const assessmentPlan = [
  ...periods.map((p,i)=>({id:`monthly-${String(i+1).padStart(2,"0")}`,title:`${p.replace("-","/")} 月檢核`,level:i<6?"N3":"N2",period:p,minutes:35,questionCount:20,kind:"monthly"})),
  ...Array.from({length:5},(_,i)=>({id:`mock-n3-${i+1}`,title:`N3 自編模考 ${i+1}`,level:"N3",period:i<3?"115-11":"115-12",minutes:95,questionCount:30,kind:"mock"})),
  ...Array.from({length:2},(_,i)=>({id:`mock-n2-${i+1}`,title:`N2 自編模考 ${i+1}`,level:"N2",period:i<1?"116-04":"116-06",minutes:105,questionCount:35,kind:"mock"}))
];
/*
 * Build them in the order the learner meets them, not in the order they are
 * listed. No exam question may reuse a source, and a paper may only draw on
 * material unlocked by its own month, so whoever is built first gets first pick
 * of a shared bank. Listing every monthly check before the mocks meant the checks
 * for 116/05 and 116/06 took N2 listening before the mock in 116/04 — a paper the
 * learner sits two months earlier — and the earlier paper was left short. Sorting
 * by period makes the draw order match the calendar. The sort is stable, so
 * papers inside one month keep their listed order.
 */
const assessments = assessmentPlan
  .slice()
  .sort((a,b)=>periods.indexOf(a.period)-periods.indexOf(b.period))
  .map((row)=>makeAssessment(row.id,row.title,row.level,row.period,row.minutes,row.questionCount,row.kind,catalog));

function auditGeneratedQuestions() {
  const hasJapanese=(value)=>/[\u3040-\u30ff\u3400-\u9fff]/.test(value||"");
  // Was a whitelist of Chinese words the old templates happened to use, which
  // rejected perfectly good Chinese written any other way. An explanation is
  // Chinese if, once the Japanese it quotes in 「」 is removed, what is left has
  // Han characters and no kana.
  // The point of this check is to catch an explanation that is accidentally in
  // Japanese, not to ban quoting Japanese — explanations legitimately cite the
  // word, the pattern and an example sentence. A Chinese explanation therefore
  // has Han characters and only a minority of kana; a Japanese one is mostly kana.
  const hasChineseExplanation=(value)=>{
    // Explanations legitimately cite Japanese — in 「」 and after 例句： — and a
    // 発話表現 note may compare four expressions at once, so citations are removed
    // before judging. What remains is the author's own prose: it must be Chinese,
    // which means Han characters and only incidental kana.
    const prose=(value||"")
      .replace(/「[^」]*」/g,"")
      .split("例句：")[0]
      .replace(/\s/g,"");
    if(!/[㐀-鿿]/.test(prose))return false;
    const kana=(prose.match(/[぀-ヿ]/g)||[]).length;
    return kana/Math.max(1,prose.length)<0.15;
  };
  const assert=(condition,message)=>{if(!condition)throw new Error(`題庫稽核失敗：${message}`)};
  const readingContents=new Set(reading.map((item)=>item.content));
  const listeningScripts=new Set(listening.map((item)=>item.audioText));
  const awkwardPatterns=[/するください/,/するもらえ/,/事前に前日まで/,/までに前日まで/,/早めに前日まで/];
  assert(readingContents.size===52,`閱讀內容僅 ${readingContents.size}/52 篇不重複`);
  assert(listeningScripts.size===LISTENING_TOTAL,`聽力稿僅 ${listeningScripts.size}/${LISTENING_TOTAL} 組不重複`);

  const sourceQuestions=new Map();
  for(const item of [...reading,...listening]){
    const sourceText=item.category==="reading"?item.content:item.audioText;
    assert(!awkwardPatterns.some((pattern)=>pattern.test(sourceText)),`${item.id} 含不自然的日文接續`);
    // Question count and line count now follow the item's JLPT 大問 rather than a
    // single number: 長文 carries three questions, 即時応答 one line, 統合理解 nine.
    const format=item.category==="reading"?readingFormatFor(item.jlptFormat):listeningFormatFor(item.jlptFormat);
    assert(format,`${item.id} 沒有對應的 JLPT 題型`);
    assert(item.questions.length===format.questions,`${item.id} 題數不正確（${item.questions.length}，${format.jlpt} 應為 ${format.questions}）`);
    if(item.category==="listening"){
      assert(item.lines.length>=format.lines[0]&&item.lines.length<=format.lines[1],`${item.id} 語音行數 ${item.lines.length} 不在 ${format.jlpt} 的 ${format.lines} 範圍`);
      assert(item.audioText===item.lines.join(" "),`${item.id} 聽力稿與逐句內容不一致`);
    }
    for(const question of item.questions){
      assert(!sourceQuestions.has(question.id),`來源題 ID 重複：${question.id}`);
      assert(hasJapanese(question.prompt),`${question.id} 題幹不是日文`);
      assert(question.options.length===4&&new Set(question.options).size===4,`${question.id} 選項不是四個唯一值`);
      assert(question.options.every((option)=>hasJapanese(option)&&!hasChineseMarker(option)),`${question.id} 含非日文選項`);
      assert(Number.isInteger(question.answer)&&question.answer>=0&&question.answer<4,`${question.id} 答案索引錯誤`);
      assert(sourceText.includes(question.evidence),`${question.id} 的答案證據「${question.evidence}」不在素材中`);
      assert(hasChineseExplanation(question.explanation),`${question.id} 缺少中文解析`);
      sourceQuestions.set(question.id,{item,question});
    }
  }

  const cards=new Map([...vocabulary,...grammar].map((item)=>[item.id,item]));
  const examQuestionIds=new Set();
  const examSignatures=new Set();
  const usedSources=new Set();
  // 読解 and 聴解 questions now carry the source item's real 大問 name, so the
  // check is that every section is represented rather than one fixed label.
  const requiredSections=["文字・語彙","文法","読解","聴解"];
  let examQuestionCount=0;
  for(const assessment of assessments){
    assert(assessment.questions.length===assessment.questionCount,`${assessment.id} 題數不符`);
    assert(requiredSections.every((section)=>assessment.questions.some((question)=>question.section===section)),`${assessment.id} 題型有缺漏`);
    for(const question of assessment.questions){
      examQuestionCount+=1;
      assert(!examQuestionIds.has(question.id),`考題 ID 重複：${question.id}`); examQuestionIds.add(question.id);
      // Options are part of the signature because homophones legitimately share a
      // prompt: 地震 and 自信 both read じしん, and each makes a valid, distinct
      // orthography question once its own option set is taken into account.
      const signature=`${question.passage||""}|${question.audioText||""}|${question.prompt}|${[...question.options].sort().join("/")}`;
      assert(!examSignatures.has(signature),`考題內容重複：${question.id}`); examSignatures.add(signature);
      assert(hasJapanese(question.instruction)&&hasJapanese(question.prompt),`${question.id} 題目說明或題幹不是日文`);
      assert(question.options.length===4&&new Set(question.options).size===4,`${question.id} 選項重複或缺漏`);
      assert(question.options.every((option)=>hasJapanese(option)&&!hasChineseMarker(option)),`${question.id} 含非日文選項`);
      assert(Number.isInteger(question.answer)&&question.answer>=0&&question.answer<4,`${question.id} 答案索引錯誤`);
      assert(hasChineseExplanation(question.explanationZh),`${question.id} 缺少作答後中文解析`);
      const sourceId=question.sourceQuestionId||question.sourceCardId;
      assert(sourceId&&!usedSources.has(sourceId),`${question.id} 重複使用來源 ${sourceId}`); usedSources.add(sourceId);
      if(question.sourceQuestionId){
        const source=sourceQuestions.get(question.sourceQuestionId);
        assert(source,`${question.id} 找不到來源題 ${question.sourceQuestionId}`);
        assert(question.prompt===source.question.prompt&&JSON.stringify(question.options)===JSON.stringify(source.question.options)&&question.answer===source.question.answer,`${question.id} 與來源題答案不一致`);
        const expectedText=source.item.category==="reading"?source.item.content:source.item.audioText;
        assert((question.passage||question.audioText)===expectedText,`${question.id} 與來源素材不一致`);
        assert(periods.indexOf(source.item.unlockPeriod)<=periods.indexOf(assessment.unlockPeriod),`${question.id} 使用尚未解鎖的素材`);
      }else{
        const card=cards.get(question.sourceCardId);
        assert(card,`${question.id} 找不到來源卡片 ${question.sourceCardId}`);
        const correct=question.options[question.answer];
        if(question.logic==="kanji-reading")assert(correct===card.reading,`${question.id} 漢字讀音答案錯誤`);
        if(question.logic==="orthography")assert(correct===card.term,`${question.id} 表記答案錯誤`);
        if(question.logic==="grammar-function")assert(correct===grammarFunctionJa(card.term)&&question.passage===card.examples[0].ja,`${question.id} 文法功能或例句錯誤`);
        assert(periods.indexOf(card.unlockPeriod)<=periods.indexOf(assessment.unlockPeriod),`${question.id} 使用尚未解鎖的卡片`);
      }
    }
  }
  assert(examQuestionCount===460,`考試總題數 ${examQuestionCount}，應為 460`);
  return {readingUnique:readingContents.size,listeningUnique:listeningScripts.size,sourceQuestions:sourceQuestions.size,examQuestions:examQuestionCount,uniqueExamSources:usedSources.size};
}

const questionAudit=auditGeneratedQuestions();

// Ids whose word changed when the list was rebuilt from JMdict. A rating recorded
// against the old word says nothing about the new one, so the app drops them once,
// keyed on contentVersion.
const reissuedIds = readSource("vocab-reissued-ids.json").ids;
// Counted from what was actually assigned rather than declared alongside it —
// a second hand-written copy of this schedule is exactly what went wrong before.
const cumulativeBy = (cards) =>
  periods.reduce((running, period) => {
    const upto = running.at(-1) || 0;
    return [...running, upto + cards.filter((card) => card.unlockPeriod === period).length];
  }, []);
const grammarCumulative = cumulativeBy(grammar);
const vocabCumulative = cumulativeBy(vocabulary);
// Lesson packs, hashed. The service worker drops its cached packs when this
// changes, so a rebuild reaches the learner on their first visit rather than
// their second.
//
// Kept separate from contentVersion, which is a hand-written marker for the
// one-off progress migration above: tying that to the content would re-clear the
// learner's ratings on every future rebuild. This one has to change whenever the
// lessons do, and nothing else — which a hand-edited string does not, as the
// JLPT rebuild proved by shipping under the previous version's name.
// The 文字・語彙 and 文法 practice sets for the 閱讀聽力 page, built from the same
// item builders the exam uses.
const practice = buildPractice(periods, vocabulary, grammar, grammarFunctionJa);

const packPayloads = periods.map((period) => ({
  period,
  vocabulary: vocabulary.filter((x) => x.unlockPeriod === period),
  grammar: grammar.filter((x) => x.unlockPeriod === period),
  reading: reading.filter((x) => x.unlockPeriod === period),
  listening: listening.filter((x) => x.unlockPeriod === period),
  assessments: assessments.filter((x) => x.unlockPeriod === period),
  practice: practice.filter((x) => x.unlockPeriod === period),
}));
const contentHash = createHash("sha256")
  .update(packPayloads.map((payload) => JSON.stringify(payload)).join("\n"))
  .digest("hex")
  .slice(0, 16);
const index = { generatedAt:new Date().toISOString(), contentVersion:"2026-08-jmdict-rebuild", contentHash, reissuedIds, periods, counts:{vocabulary:vocabulary.length,grammar:grammar.length,reading:reading.length,listening:listening.length,practice:practice.length,monthlyChecks:12,n3Mocks:5,n2Mocks:2}, unlockSchedule:periods.map((period,i)=>({period,vocabulary:vocabCumulative[i],grammar:grammarCumulative[i]})), sources:[{name:"Language-Learning-decks",url:"https://github.com/vbvss199/Language-Learning-decks",license:"MIT / CC BY-SA 4.0 frequency data"},{name:"EDRDG/JMdict",url:"https://www.edrdg.org/",license:"EDRDG licence"},{name:"時雨之町",url:"https://www.sigure.tw/",use:"classification and grammar cross-check only; no copied explanations, examples, articles, or quizzes"},{name:"JLPT sample questions",url:"https://www.jlpt.jp/e/samples/sampleindex.html",use:"link only"}] };
if (!dryRun) {
  fs.mkdirSync(outRoot,{recursive:true});
  // Written from the same payloads the hash was taken over, so the two can never
  // describe different content.
  for (const payload of packPayloads) {
    fs.writeFileSync(path.join(outRoot,`${payload.period}.json`),JSON.stringify(payload));
  }
  fs.writeFileSync(path.join(root,"public","content","index.json"),JSON.stringify(index,null,2));
}
console.log({...index.counts,assessments:assessments.length,questionAudit,dryRun});
if(printSamples)console.log(JSON.stringify({
  readingVariants:[0,13,26,39].map((position)=>reading[position]),
  listeningVariants:[0,13,26,39,52,65,78,91].map((position)=>listening[position]),
  monthlySample:assessments[0].questions.slice(0,6),
  n2MockSample:assessments.at(-1).questions.slice(-6)
},null,2));
if(printGrammarMap)console.log(JSON.stringify(Object.fromEntries(Object.entries(Object.groupBy(grammar,(item)=>grammarFunctionJa(item.term))).map(([key,items])=>[key,items.map((item)=>item.term)])),null,2));
