// One-shot surgery on generate-content.mjs: replace the ECDICT pivot chain and
// loadWords() with the JMdict-backed pipeline. Run once, then delete.
import fs from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), "scripts", "generate-content.mjs");
let src = fs.readFileSync(target, "utf8");

const HELPERS = String.raw`// Part-of-speech labels, keyed by the JMdict codes carried in vocab-authority.json.
const POS_LABEL = {
  n: "名詞", "n-suf": "名詞（接尾）", "n-pref": "名詞（接頭）", "n-adv": "名詞兼副詞",
  "n-t": "時間名詞", pn: "代名詞", num: "數詞", ctr: "量詞",
  adv: "副詞", "adv-to": "副詞（可加「と」）",
  "adj-i": "い形容詞", "adj-na": "な形容詞", "adj-no": "の形容詞（後接名詞加「の」）",
  "adj-f": "連體詞", "adj-t": "たる形容詞", "adj-nari": "なり形容詞",
  vs: "サ變動詞（名詞＋する）", "vs-s": "サ變動詞（〜す）", "vs-i": "サ變動詞（〜ずる）",
  vt: "他動詞", vi: "自動詞", v1: "一段動詞", vk: "カ變動詞（来る）", vz: "サ變動詞（〜ずる）",
  v5u: "五段動詞（う）", v5k: "五段動詞（く）", v5g: "五段動詞（ぐ）", v5s: "五段動詞（す）",
  v5t: "五段動詞（つ）", v5n: "五段動詞（ぬ）", v5b: "五段動詞（ぶ）", v5m: "五段動詞（む）",
  v5r: "五段動詞（る）", v5aru: "五段動詞（特殊活用）", "v5k-s": "五段動詞（行く型）",
  "v5u-s": "五段動詞（特殊）", "v5r-i": "五段動詞（特殊）",
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
  if (has("adj-i")) tips.push("い形容詞，修飾名詞直接接，否定為「〜くない」");
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
  const head = labels.length ? `詞性：${labels.join("、")}。` : "";
  const senseCount = (row.senses || []).length;
  const multi =
    senseCount > 1
      ? `JMdict 收錄 ${senseCount} 個義項，本卡取最常用的「${meaningZh.split("；")[0]}」，其餘義項請靠上下文判斷。`
      : "";
  const notes = (row.senses?.[0]?.inf || []).filter(Boolean);
  const note = notes.length ? `用法註記：${notes.join("；")}。` : "";
  return `${head}${posAdvice(row.pos).join("；")}。${multi}${note}`.trim();
}

// Explanation shape varies by word class so the 4000 cards do not all read alike.
function vocabExplanationZh(row, meaningZh) {
  const term = row.term;
  const reading = row.reading;
  const first = meaningZh.split("；")[0];
  const kana = reading && reading !== term ? `（${reading}）` : "";
  const pos = row.pos || [];
  if (pos.includes("vt") || pos.includes("vi") || /^v[0-9]/.test(pos[0] || "") || pos.includes("vs")) {
    const role = pos.includes("vt") ? "承接前面用「を」標示的受詞" : pos.includes("vi") ? "描述主語本身的動作或變化" : "作動詞使用";
    return `例句裡的「${term}」${kana}${role}，在這裡表示「${first}」。留意它前面接的助詞。`;
  }
  if (pos.includes("adj-i") || pos.includes("adj-na") || pos.includes("adj-no")) {
    return `「${term}」${kana}在句中描述狀態或性質，意思是「${first}」。注意它接名詞與放句尾時的形式變化。`;
  }
  if (pos.includes("adv") || pos.includes("adv-to")) {
    return `「${term}」${kana}修飾後面的動作或整句語氣，表示「${first}」。可觀察它擺放的位置。`;
  }
  if (pos.includes("exp")) {
    return `「${term}」${kana}是固定說法，整句意思為「${first}」，不要拆開來逐字理解。`;
  }
  if (pos.includes("ctr") || pos.includes("n-suf") || pos.includes("suf")) {
    return `「${term}」${kana}接在前面的語詞之後，表示「${first}」。記的時候連同前面的搭配一起記。`;
  }
  return `例句中的「${term}」${kana}是名詞，指「${first}」。請一併記住它在句中搭配的助詞。`;
}

function resolveVocabExample(row) {
  const authored = vocabExamples[row.id];
  if (authored?.ja && authored?.zh) return { ja: authored.ja, zh: authored.zh };
  const deck = row.deckExample;
  if (deck?.ja && exampleTranslationsZh[deck.ja]) {
    return { ja: deck.ja, zh: exampleTranslationsZh[deck.ja] };
  }
  throw new Error(`單字缺少可用例句：${row.id} ${row.term}`);
}

`;

const LOAD_WORDS = String.raw`function loadWords() {
  if (vocabAuthority.length !== 4000) {
    throw new Error("單字骨架數量不符：" + vocabAuthority.length);
  }
  return vocabAuthority.map((row, index) => {
    const key = row.id.slice(6);
    const meaningZh = vocabZh[key];
    if (!meaningZh) throw new Error("單字缺少中文釋義：" + row.id + " " + row.term);
    const example = resolveVocabExample(row);
    if (!example.ja.includes(row.term) && !example.ja.includes(row.reading)) {
      throw new Error("例句未包含詞條：" + row.id + " " + row.term + " / " + example.ja);
    }
    const level = index < 1600 ? "N3" : "N2";
    const hasKanji = /[一-龯]/.test(row.term);
    return {
      id: row.id,
      level,
      category: "vocab",
      term: row.term,
      reading: row.reading,
      // Readings come from JMdict now, so reading quizzes no longer have to skip
      // long-vowel words to hide the macron-stripping bug.
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
      audioText: row.term,
      unlockPeriod: periodFor(index, vocabCaps),
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

`;

// --- splice in the helpers, dropping the whole ECDICT chain -----------------
const helperStart = src.indexOf("const toTraditional = Converter(");
const helperEnd = src.indexOf("function periodFor(");
if (helperStart < 0 || helperEnd < 0 || helperEnd <= helperStart) {
  throw new Error("找不到 ECDICT 區塊邊界");
}
src = src.slice(0, helperStart) + HELPERS + src.slice(helperEnd);

// --- replace loadWords ------------------------------------------------------
const loadStart = src.indexOf("function loadWords() {");
const loadEnd = src.indexOf("const grammarPatterns");
if (loadStart < 0 || loadEnd < 0 || loadEnd <= loadStart) {
  throw new Error("找不到 loadWords 邊界");
}
src = src.slice(0, loadStart) + LOAD_WORDS + src.slice(loadEnd);

// --- grammar now reads the authored table ----------------------------------
const grammarStart = src.indexOf("function explainGrammar(term) {");
const grammarEnd = src.indexOf("function grammarAudioText(term) {");
if (grammarStart < 0 || grammarEnd < 0 || grammarEnd <= grammarStart) {
  throw new Error("找不到文法解釋區塊邊界");
}
src =
  src.slice(0, grammarStart) +
  String.raw`function explainGrammar(term) {
  const entry = grammarZh[term];
  if (!entry?.meaning) throw new Error("文法句型缺少語意說明：" + term);
  return entry.meaning;
}

function grammarUsageZh(term) {
  const entry = grammarZh[term];
  if (!entry?.usage) throw new Error("文法句型缺少接續說明：" + term);
  return entry.usage;
}

` +
  src.slice(grammarEnd);

// The Converter import is only needed by the deleted ECDICT cleanup.
src = src.replace('import { Converter } from "opencc-js";\n', "");

fs.writeFileSync(target, src);
console.log("patched generate-content.mjs");
