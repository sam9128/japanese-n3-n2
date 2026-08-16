// The shape of the real exam.
//
// 読解 and 聴解 are not one undifferentiated pile of questions: JLPT splits each
// into 大問 that test different skills and are asked in recognisably different
// ways. The old generator collapsed all of that into "an event was rescheduled"
// plus eight question stems, so 52 reading passages showed the learner four
// distinct question wordings all year.
//
// Counts below are chosen so the totals still come to 52 reading / 104 listening
// items, and so the N3-heavy first half of the year gets the 大問 that actually
// appear on N3 (発話表現 and 即時応答 are N3-only; 統合理解 and 主張理解 are the
// N2 additions).

export const READING_FORMATS = [
  {
    key: "tanbun",
    jlpt: "内容理解（短文）",
    labelZh: "短文理解",
    count: 12,
    questions: 1,
    // Real 短文 run 150–200 characters: a notice, a memo, a short email.
    chars: [140, 260],
    minutes: 5,
    hintZh: "先看標題與最後一句，通常就是這篇要你做的事。",
  },
  {
    key: "chuubun",
    jlpt: "内容理解（中文）",
    labelZh: "中文理解",
    count: 12,
    questions: 2,
    chars: [280, 420],
    minutes: 8,
    hintZh: "中文題常問因果與指示詞，讀到「そのため」「これ」時標記它指什麼。",
  },
  {
    key: "choubun",
    jlpt: "内容理解（長文）",
    labelZh: "長文理解",
    count: 8,
    questions: 3,
    chars: [430, 620],
    minutes: 11,
    hintZh: "長文照段落出題，一段一題，讀完一段先答一題再往下。",
  },
  {
    key: "jouhou",
    jlpt: "情報検索",
    labelZh: "資訊檢索",
    count: 8,
    questions: 2,
    // A leaflet is a table, not prose: the information sits in the columns, so
    // the character count runs well below a 内容理解 passage of equal difficulty.
    chars: [150, 460],
    minutes: 7,
    hintZh: "不要從頭讀。先看題目給的條件，再回表格找符合的那一列。",
  },
  {
    key: "shuchou",
    jlpt: "主張理解（長文）",
    labelZh: "主張理解",
    count: 6,
    questions: 2,
    chars: [420, 600],
    minutes: 10,
    hintZh: "找作者的立場句：「〜べきだ」「〜のではないか」「〜と考える」。",
  },
  {
    key: "tougou",
    jlpt: "統合理解",
    labelZh: "統合理解",
    count: 6,
    questions: 2,
    chars: [360, 560],
    minutes: 9,
    hintZh: "兩篇一組，先各抓一句主張，再比對兩人「哪裡同、哪裡不同」。",
  },
];

export const LISTENING_FORMATS = [
  {
    key: "kadai",
    defaultStem: "next",
    jlpt: "課題理解",
    labelZh: "課題理解",
    count: 28,
    questions: 1,
    lines: [5, 7],
    minutes: 5,
    // The trap in 課題理解 is that several tasks get mentioned; only one is what
    // this person does next.
    revealQuestionFirst: true,
    hintZh: "題目問「このあと何をしますか」，對話裡會提到好幾件事，只有一件是「接下來馬上做」。",
  },
  {
    key: "point",
    defaultStem: "what",
    jlpt: "ポイント理解",
    labelZh: "重點理解",
    count: 28,
    questions: 1,
    lines: [5, 7],
    minutes: 5,
    revealQuestionFirst: true,
    hintZh: "先看題目再聽，只抓那一個資訊，其他都可以放掉。",
  },
  {
    key: "gaiyou",
    defaultStem: "gist",
    jlpt: "概要理解",
    labelZh: "概要理解",
    count: 18,
    questions: 1,
    lines: [4, 5],
    minutes: 5,
    // 概要理解 prints no question in advance — you listen first, then find out
    // what was being asked. Showing the stem up front would remove the skill.
    revealQuestionFirst: false,
    hintZh: "這題型不先給題目。聽完先問自己「他到底想說什麼」，再看選項。",
  },
  {
    key: "hatsuwa",
    defaultStem: "utterance",
    jlpt: "発話表現",
    labelZh: "情境應答",
    count: 18,
    questions: 1,
    lines: [1, 1],
    minutes: 3,
    revealQuestionFirst: true,
    hintZh: "看情境選「這時候該說什麼」，注意敬語與授受動詞的方向。",
  },
  {
    key: "sokuji",
    defaultStem: "reply",
    jlpt: "即時応答",
    labelZh: "即時應答",
    count: 24,
    questions: 1,
    lines: [1, 1],
    minutes: 2,
    revealQuestionFirst: true,
    hintZh: "一句問話配一句回答，長度都很短，聽句尾的語氣。",
  },
  {
    key: "tougou",
    defaultStem: "each",
    jlpt: "統合理解",
    labelZh: "統合理解",
    count: 8,
    questions: 2,
    lines: [8, 10],
    minutes: 7,
    revealQuestionFirst: false,
    hintZh: "長對話出兩題，邊聽邊記誰主張什麼，最後才問各自的結論。",
  },
];

/**
 * Question stems, grouped by what the question is actually testing.
 *
 * A stem bank rather than one stem per aspect: with 52 passages drawing on six
 * aspects, a single wording each would still leave the learner reading the same
 * six sentences over and over. Each aspect resolves its answer from the passage's
 * own data, so the stems are interchangeable within an aspect.
 */
export const READING_STEMS = {
  purpose: [
    "この文章で最も伝えたいことは何か。",
    "この文章を書いた目的は何か。",
    "筆者がこの文章で述べているのはどれか。",
  ],
  audience: [
    "この文書は、主に誰に向けて書かれたものか。",
    "この知らせを読む必要があるのは誰か。",
  ],
  action: [
    "この文書を読んだ人は、まず何をしなければならないか。",
    "対象になる人が最初にすることはどれか。",
    "読んだ人がしなければならないことは何か。",
  ],
  when: [
    "変更が行われるのはいつか。",
    "この予定はいつからか。",
    "いつまでに手続きをする必要があるか。",
  ],
  where: ["どこで行われるか。", "手続きはどこですればよいか。"],
  reason: [
    "その理由として、文章中に挙げられているのはどれか。",
    "なぜそうなったと述べられているか。",
    "筆者はその原因をどう説明しているか。",
  ],
  reference: [
    "「それ」とあるが、何を指しているか。",
    "下線部が指している内容はどれか。",
  ],
  detail: [
    "文章の内容と合っているものはどれか。",
    "本文の内容として正しいものはどれか。",
  ],
  claim: [
    "筆者の考えに最も近いものはどれか。",
    "筆者が最も主張したいことは何か。",
    "この文章で筆者が述べたいことはどれか。",
  ],
  contrast: [
    "AとBに共通している考えはどれか。",
    "AとBで意見が分かれているのはどの点か。",
    "Bの筆者は、Aの意見についてどう述べているか。",
  ],
  condition: [
    "条件に合うものはどれか。",
    "この人が申し込めるのはどれか。",
    "この場合、いくら払うことになるか。",
  ],
};

export const LISTENING_STEMS = {
  next: [
    "このあと、何をしますか。",
    "この人は、まず何をしなければなりませんか。",
    "この人が次にすることはどれですか。",
  ],
  what: ["何を持っていきますか。", "何が必要だと言っていますか。"],
  when: ["いつ行いますか。", "締め切りはいつですか。"],
  where: ["どこで行うことにしましたか。", "どこへ行けばいいですか。"],
  why: ["どうしてですか。", "その理由は何ですか。"],
  howmuch: ["いくらになりますか。", "何人になりますか。"],
  who: ["だれがしますか。", "この仕事は、だれが担当しますか。"],
  gist: [
    "話の内容と合っているのはどれですか。",
    "この人が最も言いたいことは何ですか。",
    "この話のテーマは何ですか。",
  ],
  utterance: ["こんなとき、何と言いますか。"],
  reply: ["これに対する返事として、最もよいものはどれですか。"],
  each: [
    "男の人は、このあとどうしますか。",
    "女の人は、このあとどうしますか。",
    "二人は何に決めましたか。",
  ],
};

export const readingFormatFor = (key) =>
  READING_FORMATS.find((format) => format.key === key);
export const listeningFormatFor = (key) =>
  LISTENING_FORMATS.find((format) => format.key === key);

export const READING_TOTAL = READING_FORMATS.reduce((n, f) => n + f.count, 0);
export const LISTENING_TOTAL = LISTENING_FORMATS.reduce((n, f) => n + f.count, 0);
