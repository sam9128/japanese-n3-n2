// The 104 listening items, grouped by JLPT 大問.
//
// The shapes differ on purpose: 発話表現 has a `situation` and no dialogue,
// 即時応答 has a single `line`, 統合理解 carries two questions. Forcing them into
// one schema is what left the old generator with 104 items that were all
// five-line 男/女 dialogues asking one of eight questions.
import { kadai } from "./kadai.mjs";
import { point } from "./point.mjs";
import { gaiyou, tougouListening } from "./gaiyou.mjs";
import { hatsuwa, sokuji } from "./short.mjs";

export const listeningGroups = [
  { key: "kadai", items: kadai },
  { key: "point", items: point },
  { key: "gaiyou", items: gaiyou },
  { key: "hatsuwa", items: hatsuwa },
  { key: "sokuji", items: sokuji },
  { key: "tougou", items: tougouListening },
];

/**
 * The spoken lines for an item, whatever shape it came in.
 *
 * 発話表現 reads out the situation; 即時応答 reads out the single line. Both are
 * genuinely one line of audio, which is why their `lines` are derived rather
 * than stored — a stored copy could drift from the text the question quotes.
 */
export function scriptLines(kernel) {
  if (kernel.lines) return kernel.lines;
  if (kernel.situation) return [kernel.situation];
  return [kernel.line];
}

// Questions normalised to one shape, so the generator does not branch per format.
export function kernelQuestions(kernel) {
  if (kernel.questions) return kernel.questions;
  return [
    {
      stemKey: kernel.stemKey,
      prompt: kernel.prompt,
      correct: kernel.correct,
      wrong: kernel.wrong,
      evidence: kernel.evidence ?? scriptLines(kernel)[0],
      zh: kernel.zh,
    },
  ];
}

export const listeningKernels = listeningGroups.flatMap(({ key, items }) =>
  items.map((item) => ({ ...item, format: key })),
);
