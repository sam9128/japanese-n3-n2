// The 52 reading passages, grouped by JLPT 大問.
//
// Each group keeps its own file because the shapes genuinely differ: 情報検索
// carries `rows` instead of prose, 統合理解 carries `textA`/`textB` instead of a
// single `content`. Flattening them into one schema is what produced the previous
// generator's problem, where every passage had to be the same kind of text.
import { tanbun } from "./tanbun.mjs";
import { chuubun } from "./chuubun.mjs";
import { choubun } from "./choubun.mjs";
import { jouhou } from "./jouhou.mjs";
import { shuchou } from "./shuchou.mjs";
import { tougou } from "./tougou.mjs";

export const readingGroups = [
  { key: "tanbun", items: tanbun },
  { key: "chuubun", items: chuubun },
  { key: "choubun", items: choubun },
  { key: "jouhou", items: jouhou },
  { key: "shuchou", items: shuchou },
  { key: "tougou", items: tougou },
];

// Rendered passage text for a kernel, whatever shape it came in.
// The generator, the exam and the validator all read the passage through this,
// so a table row can never drift away from the answer that quotes it.
export function passageText(kernel) {
  if (kernel.textA && kernel.textB) {
    return `【A】\n${kernel.textA}\n【B】\n${kernel.textB}`;
  }
  if (kernel.rows) {
    return `${kernel.intro}\n${kernel.rows.join("\n")}\n${kernel.note}`;
  }
  return kernel.content;
}

export const readingKernels = readingGroups.flatMap(({ key, items }) =>
  items.map((item) => ({ ...item, format: key })),
);
