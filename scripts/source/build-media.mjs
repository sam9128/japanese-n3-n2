// Turn the authored reading and listening kernels into study items.
//
// Kept out of generate-content.mjs because the two jobs are different: this
// module knows about JLPT 大問, that one knows about the app's item shape and the
// twelve-month release schedule.
//
// Randomisation is seeded. The learner should not be able to predict that every
// fourth passage is a notice, but CI has to produce byte-identical content on
// every run, so Math.random is never used here.
import {
  READING_FORMATS,
  LISTENING_FORMATS,
  READING_STEMS,
  LISTENING_STEMS,
  readingFormatFor,
  listeningFormatFor,
} from "./jlpt-formats.mjs";
import { readingKernels, passageText } from "./reading/index.mjs";
import {
  listeningKernels,
  scriptLines,
  kernelQuestions,
} from "./listening/index.mjs";

// mulberry32: small, fast, and stable across Node versions — which matters more
// here than statistical quality, because the output is committed content.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, random) {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function placeOptions(correct, wrong, random) {
  const options = shuffle([correct, ...wrong], random);
  return { options, answer: options.indexOf(correct) };
}

// A stem from the bank for this aspect, varied by seed. Authored prompts win:
// 情報検索 and ポイント理解 questions name a specific person or condition that a
// generic stem cannot carry.
function stemFor(bank, key, authored, random) {
  if (authored) return authored;
  const choices = bank[key];
  if (!choices?.length) throw new Error(`no stem bank for aspect: ${key}`);
  return choices[Math.floor(random() * choices.length)];
}

/**
 * Interleave the formats so every 大問 is spread across the whole year.
 *
 * The release schedule slices this order into twelve months, so the order is the
 * distribution. Drawing greedily from whichever group had the most left put all
 * 24 課題理解 and 24 ポイント理解 first, which meant months 1–2 contained only two
 * of the six 大問 — the learner would have met nothing but five-line dialogues
 * for eight weeks, which is the complaint this rebuild exists to fix.
 *
 * Each item instead takes a fractional position within its own group, and the
 * whole set is sorted by that, so a group of 16 and a group of 24 both cover the
 * full range evenly.
 *
 * `lateOnly` formats are the N2-only 大問 (主張理解, 統合理解). They are held to
 * the back half so the N3-first half of the year is not asked to do them.
 */
function interleave(groups, random, lateOnly = new Set()) {
  const placed = groups.flatMap(({ key, items }) => {
    const shuffled = shuffle(items, random);
    const span = lateOnly.has(key) ? [0.5, 1] : [0, 1];
    const width = span[1] - span[0];
    return shuffled.map((item, i) => ({
      item: { ...item, format: key },
      // Tiny seeded jitter breaks ties between groups whose positions coincide,
      // so two formats of equal size do not always land in the same order.
      at: span[0] + (width * (i + 0.5)) / shuffled.length + random() * 1e-6,
    }));
  });
  return placed.sort((a, b) => a.at - b.at).map((entry) => entry.item);
}

// The N3 sitting is 115/12/06 and the five N3 mocks run in 115/11-12, so every
// N3 item must be released within the first six months. The split is set a
// little past halfway because the N3 half has to supply more exam questions:
// five N3 mocks against two N2 ones.
const HALF_YEAR = 6;
const READING_N3_ITEMS = 28;
// 72 of the 124 listening items. The N3 half must supply 70 exam questions
// (six monthly checks at five, five mocks at eight) and every item in it carries
// one question; the N2 half needs 56 and gets 52 items plus the eight
// two-question 統合理解, so both sides keep a little slack.
const LISTENING_N3_ITEMS = 72;

// Release month within the half of the year this item belongs to.
function halfYearPeriod(periods, index, n3Count, total) {
  const isN3 = index < n3Count;
  const offset = isN3 ? 0 : HALF_YEAR;
  const within = isN3 ? index : index - n3Count;
  const size = isN3 ? n3Count : total - n3Count;
  return periods[offset + Math.min(HALF_YEAR - 1, Math.floor((within * HALF_YEAR) / size))];
}

const SIGURE_READING = "https://www.sigure.tw/quiz/reading/medium/";

export function buildReading(periods, spreadPeriod) {
  const random = seeded(20260805);
  const ordered = interleave(
    READING_FORMATS.map((f) => ({
      key: f.key,
      items: readingKernels.filter((k) => k.format === f.key),
    })),
    random,
    new Set(["shuchou", "tougou"]),
  );

  return ordered.map((kernel, index) => {
    const format = readingFormatFor(kernel.format);
    const id = `reading-${String(index + 1).padStart(2, "0")}`;
    const content = passageText(kernel);
    // Level and release month are decided together. Spreading evenly across all
    // twelve months while calling the first half N3 meant N3 passages were still
    // being released in 116-02 — months after the N3 sitting in 115/12 and after
    // the five N3 mocks, which then had too little N3 material to draw on.
    const level = index < READING_N3_ITEMS ? "N3" : "N2";

    const questions = kernel.questions.map((q, qi) => ({
      id: `${id}-q${qi + 1}`,
      jlptType: format.jlpt,
      aspect: q.aspect,
      prompt: stemFor(READING_STEMS, q.aspect, q.prompt, random),
      ...placeOptions(q.correct, q.wrong, random),
      explanation: q.zh,
      evidence: q.evidence,
    }));

    return {
      id,
      level,
      category: "reading",
      jlptFormat: kernel.format,
      jlptType: format.jlpt,
      formatLabelZh: format.labelZh,
      term: `${format.labelZh}｜${kernel.title}`,
      reading: kernel.genre,
      meaningZh: format.hintZh,
      audioText: "",
      unlockPeriod: halfYearPeriod(periods, index, READING_N3_ITEMS, ordered.length),
      tags: [kernel.theme, kernel.themeZh, kernel.genre, format.jlpt],
      sourceRefs: ["self-authored", SIGURE_READING],
      sourceNoteZh:
        "題型與大問結構參考日本語能力試驗公開題型說明；本文、標題、選項與解析均為本計畫自編，並非考古題或任何網站文章轉載。",
      license: "CC BY 4.0 — 本計畫自編",
      estimatedMinutes: format.minutes,
      difficulty: 1 + (index % 5),
      headline: kernel.title,
      dateline: `${format.jlpt}・第 ${String(index + 1).padStart(2, "0")} 題`,
      summaryPromptZh: format.hintZh,
      // 統合理解 keeps its two texts separate so the UI can label them A and B.
      pairedTexts: kernel.textA ? { a: kernel.textA, b: kernel.textB } : null,
      infoRows: kernel.rows || null,
      content,
      questions,
    };
  });
}

export function buildListening(periods, spreadPeriod) {
  const random = seeded(20260806);
  const ordered = interleave(
    LISTENING_FORMATS.map((f) => ({
      key: f.key,
      items: listeningKernels.filter((k) => k.format === f.key),
    })),
    random,
    new Set(["tougou"]),
  );

  return ordered.map((kernel, index) => {
    const format = listeningFormatFor(kernel.format);
    const id = `listening-${String(index + 1).padStart(3, "0")}`;
    const lines = scriptLines(kernel);
    const audioText = lines.join(" ");
    const level = index < LISTENING_N3_ITEMS ? "N3" : "N2";

    const questions = kernelQuestions(kernel).map((q, qi) => ({
      id: `${id}-q${qi + 1}`,
      jlptType: format.jlpt,
      aspect: q.stemKey || format.defaultStem,
      prompt: stemFor(
        LISTENING_STEMS,
        q.stemKey || format.defaultStem,
        q.prompt,
        random,
      ),
      ...placeOptions(q.correct, q.wrong, random),
      explanation: q.zh,
      evidence: q.evidence,
    }));

    return {
      id,
      level,
      category: "listening",
      jlptFormat: kernel.format,
      jlptType: format.jlpt,
      formatLabelZh: format.labelZh,
      term: `${format.labelZh}｜${kernel.theme}`,
      reading: format.jlpt,
      meaningZh: format.hintZh,
      audioText,
      unlockPeriod: halfYearPeriod(periods, index, LISTENING_N3_ITEMS, ordered.length),
      tags: [kernel.theme, format.jlpt],
      sourceRefs: ["self-authored", "https://www.jlpt.jp/e/samples/sampleindex.html"],
      license: "CC BY 4.0 — 本計畫自編",
      estimatedMinutes: format.minutes,
      difficulty: 1 + (index % 5),
      // 概要理解 and 統合理解 print no question in advance in the real exam, so the
      // UI holds it back until the learner says they have listened.
      revealQuestionFirst: format.revealQuestionFirst,
      situation: kernel.situation || null,
      lines,
      questions,
    };
  });
}
