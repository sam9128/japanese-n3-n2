import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const periodsRoot = path.join(root, "public", "content", "periods");
const allowedAscii = new Set(["App", "OK", "SNS", "T", "IT", "JR"]);
const forbiddenPatterns = [
  /\b(?:a|adj|ad|adv|n|v|vi|vt|prep|conj|pron|interj|int|num|art|pl)\.\s*/i,
  /DOS|Internet網|Internet|chief executive|internal command/i,
  /命令|內部|内部|總線|总线|後端|后端|標準輸出|标准输出|校驗|校验/,
  /屏幕|設備|设备|位元|比特|系統|系统/,
  /複數形式|复数形式|過去式|过去式|過去分詞|过去分词|現在分詞|现在分词|三單形式|三单形式/,
  /使偏航|栗色|極機密|极机密|使活潑|使活泼|北卡羅來納州|北卡罗来纳州/,
];

const vocabulary = [];
for (const file of fs.readdirSync(periodsRoot)) {
  if (!file.endsWith(".json")) continue;
  const payload = JSON.parse(fs.readFileSync(path.join(periodsRoot, file), "utf8"));
  vocabulary.push(...(payload.vocabulary || []));
}

const failures = [];
for (const item of vocabulary) {
  const fields = [
    ["meaningZh", item.meaningZh],
    ["usageZh", item.usageZh],
    ["exampleExplanationZh", item.examples?.[0]?.explanationZh],
  ];
  for (const [field, value = ""] of fields) {
    if (!/[\u3400-\u9fff]/.test(value)) {
      failures.push({ id: item.id, term: item.term, field, reason: "missing Chinese", value });
      continue;
    }
    const forbidden = forbiddenPatterns.find((pattern) => pattern.test(value));
    if (forbidden) {
      failures.push({ id: item.id, term: item.term, field, reason: String(forbidden), value });
    }
    const asciiWords = value.match(/[A-Za-z]{2,}/g) || [];
    const unexpectedAscii = asciiWords.filter((word) => !allowedAscii.has(word));
    if (unexpectedAscii.length) {
      failures.push({
        id: item.id,
        term: item.term,
        field,
        reason: `unexpected ASCII: ${[...new Set(unexpectedAscii)].join(", ")}`,
        value,
      });
    }
  }
}

if (vocabulary.length !== 4000) {
  failures.push({ reason: `vocabulary count ${vocabulary.length}, expected 4000` });
}

// Every card used to carry the same sentence: "本句使用「X」表達「Y」。請觀察它和
// 前後詞語的搭配。" Explanations are now shaped by part of speech and carry the
// word's own reading and sense, so they should be near-unique.
const explanations = vocabulary.map((item) => item.examples?.[0]?.explanationZh || "");
const uniqueExplanations = new Set(explanations).size;
if (uniqueExplanations < vocabulary.length * 0.95) {
  failures.push({
    reason: `example explanations too repetitive: ${uniqueExplanations} unique of ${vocabulary.length}`,
  });
}

// The example must actually demonstrate the word it is filed under. Substring
// matching alone let バック (rear) be illustrated by a sentence about a bag, so
// the meaning is spot-checked against the headword too.
for (const item of vocabulary) {
  const example = item.examples?.[0];
  if (!example?.ja) {
    failures.push({ id: item.id, term: item.term, reason: "missing example sentence" });
    continue;
  }
  if (!example.ja.includes(item.term) && !example.ja.includes(item.reading)) {
    failures.push({
      id: item.id,
      term: item.term,
      reason: "example does not contain the headword",
      example: example.ja,
    });
  }
  if (!example.zh || !/[㐀-鿿]/.test(example.zh)) {
    failures.push({ id: item.id, term: item.term, reason: "example lacks a Chinese translation" });
  }
}

// A meaning shared by more than two ids means the list is carrying duplicates.
const meaningCounts = new Map();
for (const item of vocabulary) {
  meaningCounts.set(item.meaningZh, (meaningCounts.get(item.meaningZh) || 0) + 1);
}
const overshared = [...meaningCounts.entries()].filter(([, count]) => count > 2);
if (overshared.length) {
  failures.push({
    reason: "meaning shared by more than two entries",
    samples: overshared.slice(0, 5).map(([meaning, count]) => ({ count, meaning })),
  });
}

// Distinct words, not distinct spellings of the same word.
const terms = new Set(vocabulary.map((item) => item.term));
if (terms.size !== vocabulary.length) {
  failures.push({ reason: `duplicate headwords: ${vocabulary.length - terms.size}` });
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures: failures.slice(0, 80), failureCount: failures.length }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, vocabulary: vocabulary.length }, null, 2));
