import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const output = process.argv[2];
const mode = process.argv[3] ?? "examples";
if (!["examples", "senses"].includes(mode)) throw new Error("翻譯模式必須為 examples 或 senses");
if (!output) throw new Error("請指定翻譯批次輸出資料夾");
const rows = [];
for await (const line of createInterface({ input: process.stdin })) {
  const row = JSON.parse(line);
  if (mode === "senses") {
    row.sourceSenses.forEach((sense, index) => {
      rows.push(`[${row.id}/${index + 1}] ${sense.gloss.join("; ")}\n`);
    });
  } else {
    const example = row.examples[0]?.ja;
    if (example) rows.push(`[${row.id}] ${example.replace(/\s+/g, " ")}\n`);
  }
}
if (!rows.length) throw new Error("沒有收到詞條例句");
mkdirSync(output, { recursive: true });
let batch = "";
let count = 0;
function flush() {
  if (!batch) return;
  writeFileSync(join(output, `${mode === "senses" ? "en" : "ja"}-${String(++count).padStart(3, "0")}.txt`), batch);
  batch = "";
}
for (const row of rows) {
  if (row.length > 4500) throw new Error("單筆例句超過批次上限");
  if (batch.length + row.length > 4500) flush();
  batch += row;
}
flush();
console.log({ mode, rows: rows.length, batches: count });
