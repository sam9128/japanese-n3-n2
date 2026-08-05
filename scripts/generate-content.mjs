import fs from "node:fs";
import path from "node:path";
import { grammarExamples } from "./source/grammar-examples.mjs";
import { assessmentScenarios } from "./source/assessment-scenarios.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const printSamples = process.argv.includes("--print-samples");
const printGrammarMap = process.argv.includes("--print-grammar-map");
const outRoot = path.join(root, "public", "content", "periods");
const periods = ["115-07", "115-08", "115-09", "115-10", "115-11", "115-12", "116-01", "116-02", "116-03", "116-04", "116-05", "116-06"];
// Cumulative unlock caps per period.
//
// 115-11 and 115-12 stay flat on purpose: 115/11 is the five-mock-exam month and
// the N3 sitting is 115/12/06, so both are revision only. That puts all 1600 N3
// words and all 120 N3 grammar patterns before the exam, and spreads the N2 half
// evenly over 116-01..116-06 instead of dumping 800 words into 116-01 and leaving
// 116-06 empty.
const vocabCaps = [400, 800, 1200, 1600, 1600, 1600, 2000, 2400, 2800, 3200, 3600, 4000];
const grammarCaps = [30, 60, 90, 120, 120, 120, 140, 160, 180, 200, 220, 240];
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
const vocabAuthority = readSource("vocab-authority.json");
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

function loadWords() {
  if (vocabAuthority.length !== 4000) {
    throw new Error("單字骨架數量不符：" + vocabAuthority.length);
  }
  return vocabAuthority.map((row, index) => {
    const key = row.id.slice(6);
    const meaningZh = vocabZh[key];
    if (!meaningZh) throw new Error("單字缺少中文釋義：" + row.id + " " + row.term);
    const example = resolveVocabExample(row);
    if (!exampleDemonstrates(row, example.ja)) {
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
function makeGrammar() {
  const unique = [...new Set(grammarPatterns)].slice(0, 240);
  if (unique.length < 240) throw new Error(`文法句型不足：${unique.length}`);
  const missingExamples = unique.filter((term) => !grammarExamples.has(term));
  if (missingExamples.length) throw new Error(`文法例句不足：${missingExamples.join("、")}`);
  return unique.map((term, index) => {
    const exampleJa = grammarExamples.get(term);
    const exampleZh = exampleTranslationsZh[exampleJa];
    if (!exampleZh) throw new Error(`例句缺少中文翻譯：${exampleJa}`);
    const level = index < 180 ? "N3" : "N2";
    return {
      id: `grammar-${String(index + 1).padStart(3, "0")}`, level, category: "grammar", term,
      reading: "文法句型", meaningZh: explainGrammar(term), usageZh: grammarUsageZh(term),
      examples: [{ ja: exampleJa, zh: exampleZh, explanationZh: `這句使用「${term}」。${explainGrammar(term)}` }],
      audioText: grammarAudioText(term), unlockPeriod: periodFor(index, grammarCaps),
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

function scenarioValues(index, key) {
  const correct=assessmentScenarios[index][key];
  const values=[...new Set(assessmentScenarios.map((scenario)=>scenario[key]))].filter((value)=>value!==correct);
  const shift=index%values.length;
  return [...values.slice(shift),...values.slice(0,shift)];
}

function makeQuestion(prompt, correct, distractors, seed, explanation, evidence = correct) {
  return { prompt, ...rotateOptions(correct, distractors, seed), explanation, evidence };
}

function makeReading(index) {
  const scenarioIndex = index % assessmentScenarios.length;
  const variant = Math.floor(index / assessmentScenarios.length);
  const s = assessmentScenarios[scenarioIndex];
  const categories = [
    ["交通", "交通"], ["生活", "生活"], ["教育", "教育"], ["工作", "仕事"],
    ["氣象", "気象"], ["健康", "健康"], ["旅遊", "観光"], ["居住", "住宅"],
    ["消費", "消費"], ["文化", "文化"], ["圖書", "図書"], ["經濟", "経済"], ["環境", "環境"],
  ];
  const [newsCategory, newsCategoryJa] = categories[scenarioIndex];
  const dateline = `學習新聞・第 ${String(index + 1).padStart(2, "0")} 號`;
  let headline;
  let content;
  let questions;
  if (variant === 0) {
    headline = `${s.event}、時間と場所を変更`;
    content = `【${newsCategoryJa}ニュース】\n${s.event}は、${s.reason}ため、予定していた${s.oldTime}の${s.oldPlace}から、${s.newTime}の${s.newPlace}へ変更されることになりました。主催者は、参加者に${s.item}を持参し、開始の十分前までに集まるよう呼びかけています。詳しい情報については、${s.contact}に確認してください。`;
    questions = [
      makeQuestion("参加する人は、いつ、どこへ行きますか。", `${s.newTime}に${s.newPlace}へ行く。`, [`${s.oldTime}に${s.oldPlace}へ行く。`,`${s.newTime}に${s.oldPlace}へ行く。`,`${s.oldTime}に${s.newPlace}へ行く。`], index, `文章指出變更後應在「${s.newTime}」前往「${s.newPlace}」。`, s.newTime),
      makeQuestion("主催者は、参加者に何を持ってくるよう呼びかけていますか。", s.item, scenarioValues(scenarioIndex,"item"), index+1, `新聞導語指出主辦方要求參加者攜帶「${s.item}」。`)
    ];
  } else if (variant === 1) {
    headline = `${s.event}、事前の準備を呼びかけ`;
    content = `【${newsCategoryJa}ニュース】\n${s.event}を予定どおり進めるため、担当の${s.actor}は参加者に「${s.action}」という準備を${s.deadline}までに終えるよう求めました。準備が終わった人は${s.contact}へ連絡し、当日は${s.item}を持参します。${s.reason}ため、担当者は直前にも最新の予定を確認してほしいと話しています。`;
    questions = [
      makeQuestion("参加する人が最初にしなければならないことは何ですか。", `${s.action}。`, scenarioValues(scenarioIndex,"action").map(value=>`${value}。`), index, `郵件要求先「${s.action}」。`, s.action),
      makeQuestion("準備が終わった後、どうしますか。", `${s.contact}へ連絡する。`, scenarioValues(scenarioIndex,"contact").map(value=>`${value}へ連絡する。`), index+1, `準備完成後要聯絡「${s.contact}」。`, s.contact)
    ];
  } else if (variant === 2) {
    headline = `早めの準備で「${s.result}」`;
    content = `【${newsCategoryJa}レポート】\n${s.event}の担当者は、今回は「${s.action}」という準備を早い段階から始めました。以前は準備を当日まで延ばし、必要な情報を十分に確認できなかったということです。事前の確認を増やした結果、${s.result}。担当者は、${s.reason}場合でも、前もって確認すれば落ち着いて対応できると説明しています。`;
    questions = [
      makeQuestion("早めに準備した結果、どうなりましたか。", `${s.result}。`, scenarioValues(scenarioIndex,"result").map(value=>`${value}。`), index, `作者提到提早準備後「${s.result}」。`),
      makeQuestion("筆者が最も伝えたいことは何ですか。", `「${s.action}」という準備を事前に行うことが大切だ。`, [`準備は当日になってから始めればよい。`,`予定が変わったときは何もしないほうがよい。`,`必要な情報はほかの人だけに確認してもらえばよい。`], index+1, `作者的主張是事前「${s.action}」很重要。`, s.action)
    ];
  } else {
    headline = `${s.event}、参加方法を発表`;
    content = `【${newsCategoryJa}案内】\n${s.event}の参加方法が発表されました。申し込みは${s.deadline}までに${s.contact}へ連絡します。集合は${s.newTime}に${s.newPlace}です。参加者は${s.item}を持参し、事前に「${s.action}」という準備を済ませる必要があります。${s.reason}場合は時刻や場所が変わる可能性があり、変更は申込者へメールで通知されます。`;
    questions = [
      makeQuestion("参加を申し込むには、どうすればいいですか。", `${s.deadline}までに${s.contact}へ連絡する。`, [`${s.newTime}に${s.contact}へ行く。`,`${s.deadline}までに${s.newPlace}へ行く。`,`${s.oldTime}にメールを待つ。`], index, `報名方式是在「${s.deadline}」前聯絡「${s.contact}」。`, s.deadline),
      makeQuestion("記事の内容と合っているものはどれですか。", `参加する前に「${s.action}」という準備を済ませる必要がある。`, [`持ち物は何も必要ない。`,`変更があっても連絡は来ない。`,`集合場所は必ず${s.oldPlace}である。`], index+1, `新聞模組明確指出參加前須先「${s.action}」。`, s.action)
    ];
  }
  const id=`reading-${String(index+1).padStart(2,"0")}`;
  questions=questions.map((question,questionIndex)=>({...question,id:`${id}-q${questionIndex+1}`}));
  return {
    id,
    level:index < 32 ? "N3":"N2",
    category:"reading",
    term:`${newsCategory}新聞｜${headline}`,
    reading:"新聞精讀與摘要",
    meaningZh:"先讀標題與導語掌握人物、事件、時間與變化，再完成摘要與理解題。",
    audioText:"",
    unlockPeriod:periods[spreadPeriod(index, 52)],
    tags:[s.theme, newsCategory, "新聞讀解"],
    sourceRefs:["self-authored", sigureRefs.reading],
    sourceNoteZh:"參考時雨之町閱讀測驗的分級概念設計呈現方式；本文、標題、選項與解析均為本計畫自編，並非新聞或網站文章轉載。",
    license:"CC BY 4.0 — 本計畫自編",
    estimatedMinutes:8+(index%5),
    difficulty:1+(index%5),
    newsStyle:true,
    newsCategory,
    newsCategoryJa,
    headline,
    dateline,
    summaryPromptZh:"請用 2–3 句寫出：發生什麼事、原因或變化、讀者需要採取的行動。",
    content,
    questions
  };
}

function makeListening(index) {
  const scenarioIndex = index % assessmentScenarios.length;
  const variant = Math.floor(index / assessmentScenarios.length);
  const s = assessmentScenarios[scenarioIndex];
  let lines;
  let question;
  if (variant === 0) {
    lines = [`女：${s.event}は${s.oldTime}に${s.oldPlace}で行う予定でしたね。`,`男：はい。でも、${s.reason}ため、予定が変わりました。`,`女：新しい予定を教えてください。`,`男：${s.newTime}に${s.newPlace}へ来てください。`,`女：分かりました。間違えないようにします。`];
    question = makeQuestion("新しい時間と場所はどれですか。", `${s.newTime}・${s.newPlace}`, [`${s.oldTime}・${s.oldPlace}`,`${s.newTime}・${s.oldPlace}`,`${s.oldTime}・${s.newPlace}`], index, `對話確認新的時間與地點是「${s.newTime}・${s.newPlace}」。`, s.newTime);
  } else if (variant === 1) {
    lines = [`女：${s.event}の準備は、何から始めればいいですか。`,`男：まず、「${s.action}」という準備をしてください。`,`女：終わったら、どうしますか。`,`男：${s.contact}へ連絡してください。そのあと、${s.item}を用意しましょう。`,`女：はい、順番に進めます。`];
    question = makeQuestion("女の人は、まず何をしますか。", `${s.action}。`, scenarioValues(scenarioIndex,"action").map(value=>`${value}。`), index, `男子首先要求「${s.action}」。`, s.action);
  } else if (variant === 2) {
    lines = [`男：どうして${s.event}の予定が変わったんですか。`,`女：${s.reason}からです。`,`男：中止ではないんですね。`,`女：はい。新しい予定はメールで知らせます。`,`男：分かりました。メールを確認します。`];
    question = makeQuestion("予定が変わった理由は何ですか。", `${s.reason}から。`, scenarioValues(scenarioIndex,"reason").map(value=>`${value}から。`), index, `女子說明變更原因是「${s.reason}」。`, s.reason);
  } else if (variant === 3) {
    lines = [`女：${s.event}には何を持っていけばいいですか。`,`男：${s.item}を持ってきてください。`,`女：ほかにも必要ですか。`,`男：いいえ、それだけで大丈夫です。`,`女：では、忘れないように準備します。`];
    question = makeQuestion("女の人は何を持っていきますか。", s.item, scenarioValues(scenarioIndex,"item"), index, `女子需要攜帶「${s.item}」。`);
  } else if (variant === 4) {
    lines = [`男：${s.event}の場所ですが、${s.oldPlace}は使えないそうです。`,`女：では、${s.newPlace}はどうですか。`,`男：そこなら全員が集まりやすいですね。`,`女：では、その場所に決めて、みんなに知らせます。`,`男：お願いします。`];
    question = makeQuestion("二人は、どこで行うことにしましたか。", s.newPlace, [s.oldPlace,...scenarioValues(scenarioIndex,"newPlace").slice(0,2)], index, `兩人最後決定在「${s.newPlace}」進行。`);
  } else if (variant === 5) {
    lines = [`女：${s.action}のは、いつまでですか。`,`男：${s.deadline}までです。`,`女：明日でも間に合いますか。`,`男：はい。ただし、終わったらすぐ${s.contact}へ知らせてください。`,`女：分かりました。`];
    question = makeQuestion("女の人は、いつまでに準備しますか。", s.deadline, scenarioValues(scenarioIndex,"deadline"), index, `期限是「${s.deadline}」。`);
  } else if (variant === 6) {
    lines = [`男：すみません、${s.event}の前に、「${s.action}」という準備をお願いできますか。`,`女：はい。${s.deadline}まででいいですか。`,`男：お願いします。終わったら私にメールしてください。`,`女：分かりました。今日から始めます。`,`男：よろしくお願いします。`];
    question = makeQuestion("女の人は、このあと何をしますか。", `${s.action}。`, scenarioValues(scenarioIndex,"action").map(value=>`${value}。`), index, `男子請女子接著「${s.action}」。`, s.action);
  } else {
    lines = [`女：今回の${s.event}は、前より順調でしたね。`,`男：早い段階で「${s.action}」という準備をしたからだと思います。`,`女：その結果、どうなりましたか。`,`男：${s.result}。`,`女：次回も同じ方法で準備しましょう。`];
    question = makeQuestion("早めに準備した結果、どうなりましたか。", `${s.result}。`, scenarioValues(scenarioIndex,"result").map(value=>`${value}。`), index, `對話指出結果是「${s.result}」。`);
  }
  const id=`listening-${String(index+1).padStart(3,"0")}`;
  return { id, level:index < 64 ? "N3":"N2", category:"listening", term:`聽力 ${index+1}｜${s.theme}`, reading:"逐句聽解", meaningZh:"先盲聽，再逐句確認聽力稿。", audioText:lines.join(" "), unlockPeriod:periods[spreadPeriod(index, 104)], tags:[s.theme], sourceRefs:["self-authored"], license:"CC BY 4.0 — 本計畫自編", estimatedMinutes:6, difficulty:1+(index%5), lines, questions:[{...question,id:`${id}-q1`}] };
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

function makeExamQuestions(id, level, period, questionCount, catalog) {
  const maxPeriod = periods.indexOf(period);
  const kanjiPool = orderedLevelPool(catalog.vocabulary,level,maxPeriod).filter((item) => /[\u3400-\u9fff]/.test(item.term)&&item.reading&&item.reading!==item.term&&item.readingQuizEligible);
  const grammarPool = orderedLevelPool(catalog.grammar,level,maxPeriod);
  const readingPool = orderedLevelPool(catalog.reading,level,maxPeriod).flatMap((item)=>item.questions.map((question,questionIndex)=>({item,question,questionIndex,id:`${item.id}-q${questionIndex+1}`})));
  const listeningPool = orderedLevelPool(catalog.listening,level,maxPeriod).map((item)=>({item,question:item.questions[0],id:`${item.id}-q1`}));
  const used=assessmentUsage;
  const seedBase = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Array.from({length:questionCount}, (_, index) => {
    const seed = seedBase * 17 + index * 13;
    const type = index % 6;
    if (type === 0) {
      const item=takeUnused(kanjiPool,used.vocabulary,seed,undefined,`${id} 漢字読み`);
      const distractors=kanjiPool.filter((candidate)=>candidate.id!==item.id&&candidate.reading!==item.reading).slice(seed%Math.max(1,kanjiPool.length-3)).concat(kanjiPool).map((candidate)=>candidate.reading);
      return { id:`${id}-q${index+1}`, section:"言語知識", type:"漢字読み", instruction:"「　」の言葉の読み方として最もよいものを一つ選びなさい。", prompt:`「${item.term}」の読み方はどれですか。`, ...rotateOptions(item.reading,distractors,seed), explanationZh:`「${item.term}」讀作「${item.reading}」，中文意思是「${item.meaningZh}」。`, sourceCardId:item.id, logic:"kanji-reading" };
    }
    if (type === 1) {
      const item=takeUnused(kanjiPool,used.vocabulary,seed,undefined,`${id} 表記`);
      const distractors=kanjiPool.filter((candidate)=>candidate.id!==item.id&&candidate.reading!==item.reading).slice(seed%Math.max(1,kanjiPool.length-3)).concat(kanjiPool).map((candidate)=>candidate.term);
      return { id:`${id}-q${index+1}`, section:"言語知識", type:"表記", instruction:"ひらがなで示した言葉の表記として最もよいものを一つ選びなさい。", prompt:`「${item.reading}」と読む言葉はどれですか。`, ...rotateOptions(item.term,distractors,seed), explanationZh:`「${item.reading}」的正確表記是「${item.term}」，中文意思是「${item.meaningZh}」。`, sourceCardId:item.id, logic:"orthography" };
    }
    if (type === 2) {
      const item=takeUnused(grammarPool,used.grammar,seed,undefined,`${id} 文法`);
      const correct=grammarFunctionJa(item.term);
      return { id:`${id}-q${index+1}`, section:"文法", type:"文法形式", instruction:"次の文で使われている文法の働きとして最もよいものを一つ選びなさい。", passage:item.examples[0].ja, prompt:`「${item.term}」は、この文でどのような意味を表していますか。`, ...rotateOptions(correct,grammarFunctions.filter((value)=>value!==correct).slice(seed%10).concat(grammarFunctions),seed), explanationZh:`本題句型是「${item.term}」，在例句中用來表示「${correct}」。${item.meaningZh} 例句：${item.examples[0].ja}`, sourceCardId:item.id, logic:"grammar-function" };
    }
    if (type === 3) {
      const entry=takeUnused(readingPool,used.reading,seed,undefined,`${id} 読解`);
      return { id:`${id}-q${index+1}`, section:"読解", type:"内容理解", instruction:"次の文章を読んで、質問に答えなさい。", passage:entry.item.content, prompt:entry.question.prompt, options:entry.question.options, answer:entry.question.answer, explanationZh:entry.question.explanation, sourceQuestionId:entry.question.id, logic:"reading-source" };
    }
    if (type === 4) {
      const entry=takeUnused(listeningPool,used.listening,seed,undefined,`${id} 聴解`);
      return { id:`${id}-q${index+1}`, section:"聴解", type:"ポイント理解", instruction:"音声を聞いて、質問に答えなさい。", prompt:entry.question.prompt, audioText:entry.item.audioText, options:entry.question.options, answer:entry.question.answer, explanationZh:entry.question.explanation, sourceQuestionId:entry.question.id, logic:"listening-source" };
    }
    const item=takeUnused(grammarPool,used.grammar,seed,undefined,`${id} 文法`);
    const correct=grammarFunctionJa(item.term);
    return { id:`${id}-q${index+1}`, section:"文法", type:"文法形式", instruction:"次の文で使われている文法の働きとして最もよいものを一つ選びなさい。", passage:item.examples[0].ja, prompt:`「${item.term}」は、この文でどのような意味を表していますか。`, ...rotateOptions(correct,grammarFunctions.filter((value)=>value!==correct).slice((seed+3)%10).concat(grammarFunctions),seed), explanationZh:`本題句型是「${item.term}」，在例句中用來表示「${correct}」。${item.meaningZh} 例句：${item.examples[0].ja}`, sourceCardId:item.id, logic:"grammar-function" };
  });
}

function makeAssessment(id, title, level, period, minutes, questionCount, kind, catalog) {
  return { id, title, level, category:"assessment", kind, unlockPeriod:period, durationMinutes:minutes, threshold:60, scoreTotal:100, sourceRefs:["self-authored", "https://www.jlpt.jp/e/samples/sampleindex.html"], license:"CC BY 4.0 — 自編題目；官方連結僅供題型參考", questionCount, questions:makeExamQuestions(id,level,period,questionCount,catalog) };
}

const vocabulary = loadWords();
const grammar = makeGrammar();
const reading = Array.from({length:52},(_,i)=>makeReading(i));
const listening = Array.from({length:104},(_,i)=>makeListening(i));
const catalog = { vocabulary, grammar, reading, listening };
const assessments = [
  ...periods.map((p,i)=>makeAssessment(`monthly-${String(i+1).padStart(2,"0")}`,`${p.replace("-","/")} 月檢核`, i<6?"N3":"N2",p,35,20,"monthly",catalog)),
  ...Array.from({length:5},(_,i)=>makeAssessment(`mock-n3-${i+1}`,`N3 自編模考 ${i+1}`,"N3",i<3?"115-11":"115-12",95,30,"mock",catalog)),
  ...Array.from({length:2},(_,i)=>makeAssessment(`mock-n2-${i+1}`,`N2 自編模考 ${i+1}`,"N2","116-06",105,35,"mock",catalog))
];

function auditGeneratedQuestions() {
  const hasJapanese=(value)=>/[\u3040-\u30ff\u3400-\u9fff]/.test(value||"");
  // Catches Chinese prose leaking into a Japanese option. 個 and 該 were in this
  // set but are ordinary Japanese kanji (数個, 該当), so they rejected real
  // vocabulary once the word list was rebuilt from JMdict.
  const hasChineseMarker=(value)=>/[這裡還讓應嗎們]|下午|上午|二樓|選項|答案|中文|直接放棄|身邊的人/.test(value||"");
  const hasChineseExplanation=(value)=>/指出|要求|需要|首先|變更|聯絡|作者|期限|報名|指南|正確|讀作|中文|用來|對話|郵件|準備|男子|女子|通知|攜帶|兩人|女子/.test(value||"");
  const assert=(condition,message)=>{if(!condition)throw new Error(`題庫稽核失敗：${message}`)};
  const readingContents=new Set(reading.map((item)=>item.content));
  const listeningScripts=new Set(listening.map((item)=>item.audioText));
  const awkwardPatterns=[/するください/,/するもらえ/,/事前に前日まで/,/までに前日まで/,/早めに前日まで/];
  assert(readingContents.size===52,`閱讀內容僅 ${readingContents.size}/52 篇不重複`);
  assert(listeningScripts.size===104,`聽力稿僅 ${listeningScripts.size}/104 組不重複`);

  const sourceQuestions=new Map();
  for(const item of [...reading,...listening]){
    const sourceText=item.category==="reading"?item.content:item.audioText;
    assert(!awkwardPatterns.some((pattern)=>pattern.test(sourceText)),`${item.id} 含不自然的日文接續`);
    assert(item.questions.length===(item.category==="reading"?2:1),`${item.id} 題數不正確`);
    if(item.category==="listening")assert(item.lines.length===5&&item.audioText===item.lines.join(" "),`${item.id} 聽力稿與逐句內容不一致`);
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
  const requiredTypes=["漢字読み","表記","文法形式","内容理解","ポイント理解"];
  let examQuestionCount=0;
  for(const assessment of assessments){
    assert(assessment.questions.length===assessment.questionCount,`${assessment.id} 題數不符`);
    assert(requiredTypes.every((type)=>assessment.questions.some((question)=>question.type===type)),`${assessment.id} 題型有缺漏`);
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

const index = { generatedAt:new Date().toISOString(), periods, counts:{vocabulary:vocabulary.length,grammar:grammar.length,reading:reading.length,listening:listening.length,monthlyChecks:12,n3Mocks:5,n2Mocks:2}, unlockSchedule:periods.map((period,i)=>({period,vocabulary:vocabCaps[i],grammar:grammarCaps[i]})), sources:[{name:"Language-Learning-decks",url:"https://github.com/vbvss199/Language-Learning-decks",license:"MIT / CC BY-SA 4.0 frequency data"},{name:"EDRDG/JMdict",url:"https://www.edrdg.org/",license:"EDRDG licence"},{name:"時雨之町",url:"https://www.sigure.tw/",use:"classification and grammar cross-check only; no copied explanations, examples, articles, or quizzes"},{name:"JLPT sample questions",url:"https://www.jlpt.jp/e/samples/sampleindex.html",use:"link only"}] };
if (!dryRun) {
  fs.mkdirSync(outRoot,{recursive:true});
  for (const period of periods) {
    const payload = { period, vocabulary:vocabulary.filter(x=>x.unlockPeriod===period), grammar:grammar.filter(x=>x.unlockPeriod===period), reading:reading.filter(x=>x.unlockPeriod===period), listening:listening.filter(x=>x.unlockPeriod===period), assessments:assessments.filter(x=>x.unlockPeriod===period) };
    fs.writeFileSync(path.join(outRoot,`${period}.json`),JSON.stringify(payload));
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
