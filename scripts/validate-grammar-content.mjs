import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const periodsRoot = path.join(root, "public", "content", "periods");
const grammar = [];

for (const file of fs.readdirSync(periodsRoot)) {
  if (!file.endsWith(".json")) continue;
  const payload = JSON.parse(fs.readFileSync(path.join(periodsRoot, file), "utf8"));
  grammar.push(...(payload.grammar || []));
}

const failures = [];
const examples = new Map();
const meanings = new Map();
const usages = new Map();
const forbidden = /[A-Za-z]{2,}|DOS|Internet|undefined|null|句型功能：連接前後內容|補充語氣：/;

for (const item of grammar) {
  meanings.set(item.meaningZh, (meanings.get(item.meaningZh) || 0) + 1);
  usages.set(item.usageZh, (usages.get(item.usageZh) || 0) + 1);

  if (!item.term || !item.meaningZh || !item.usageZh) {
    failures.push({ id: item.id, term: item.term, reason: "missing core grammar fields" });
  }
  if (forbidden.test(`${item.meaningZh} ${item.usageZh}`)) {
    failures.push({ id: item.id, term: item.term, reason: "generic or foreign residue", meaningZh: item.meaningZh, usageZh: item.usageZh });
  }
  if (!item.usageZh.includes("主要接續：")) {
    failures.push({ id: item.id, term: item.term, reason: "missing connection note" });
  }
  const example = item.examples?.[0];
  if (!example?.ja || !example?.zh || !example?.explanationZh) {
    failures.push({ id: item.id, term: item.term, reason: "missing example or Chinese translation" });
  } else {
    if (!/[\u3040-\u30ff\u4e00-\u9faf]/.test(example.ja)) {
      failures.push({ id: item.id, term: item.term, reason: "example is not Japanese", example });
    }
    if (!/[\u3400-\u9fff]/.test(example.zh) || !/[\u3400-\u9fff]/.test(example.explanationZh)) {
      failures.push({ id: item.id, term: item.term, reason: "example lacks Chinese explanation", example });
    }
    if (examples.has(example.ja)) {
      failures.push({ id: item.id, term: item.term, reason: `duplicate example with ${examples.get(example.ja)}`, exampleJa: example.ja });
    }
    examples.set(example.ja, item.id);
  }
}

if (grammar.length !== 240) failures.push({ reason: `grammar count ${grammar.length}, expected 240` });
// These thresholds used to be 40 and 20, which happily passed data where one
// blurb covered 16 patterns and 〜うちに and 〜間に read identically. Each pattern
// is written individually now, so near-total uniqueness is the real bar.
if (meanings.size < 230) {
  failures.push({ reason: `grammar meanings too repetitive: ${meanings.size} unique explanations, expected >= 230` });
}
if (usages.size < 230) {
  failures.push({ reason: `grammar usage notes too repetitive: ${usages.size} unique notes, expected >= 230` });
}
// The old connection note listed every possible part of speech for every
// pattern, which told the learner nothing.
const sharedUsage = [...usages.entries()].filter(([, count]) => count > 3);
if (sharedUsage.length) {
  failures.push({
    reason: "connection note shared by more than three patterns",
    samples: sharedUsage.slice(0, 3).map(([note, count]) => ({ count, note: note.slice(0, 60) })),
  });
}

if (failures.length) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        grammar: grammar.length,
        uniqueMeanings: meanings.size,
        uniqueUsages: usages.size,
        failures: failures.slice(0, 80),
        failureCount: failures.length,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, grammar: grammar.length, uniqueMeanings: meanings.size, uniqueUsages: usages.size }, null, 2));
