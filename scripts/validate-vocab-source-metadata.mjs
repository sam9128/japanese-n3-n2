import assert from "node:assert/strict";
import fs from "node:fs";
import { loadVocabAuthority } from "./source/vocab-authority.mjs";

const rows = new Map(loadVocabAuthority().map((row) => [row.id, row]));
assert.equal(rows.size, 4000, "metadata must cover the entire vocabulary corpus");
// These source corrections change conjugation or grammatical category, so stale
// metadata would produce incorrect usage instructions even with the right gloss.
for (const [id, sequence, pos] of [
  ["vocab-2008", 1263120, ["v5r", "vi"]],
  ["vocab-0347", 1340450, ["v1", "vi"]],
  ["vocab-0228", 2137720, ["adv", "int"]],
  ["vocab-1722", 1632200, ["adv", "vs"]],
  ["vocab-3524", 1983690, ["adv"]],
  ["vocab-3794", 1155110, ["n", "adv"]],
]) {
  const row = rows.get(id);
  assert.equal(row.seq, sequence, `${id}: incorrect dictionary source`);
  assert.deepEqual(row.pos, pos, `${id}: stale part of speech`);
  if (!["vocab-3524", "vocab-3794"].includes(id)) {
    assert.ok(row.glossEn.length && row.senses.length, `${id}: missing corrected source metadata`);
  }
}
const index = JSON.parse(fs.readFileSync(new URL("../public/content/index.json", import.meta.url), "utf8"));
const cards = index.periods.flatMap((period) => JSON.parse(fs.readFileSync(
  new URL(`../public/content/periods/${period}.json`, import.meta.url), "utf8")).vocabulary);
const reduced = cards.find((card) => card.id === "vocab-2008");
assert.ok(reduced.tags.includes("v5r") && !reduced.tags.includes("v1"),
  "減る must use godan metadata in generated learning content");
for (const id of ["vocab-3944", "vocab-3869"]) {
  const example = cards.find((card) => card.id === id)?.examples?.[0];
  assert.ok(example?.explanationZh.includes("是名詞") &&
    !example.explanationZh.includes("在句中描述狀態"),
  `${id}: nominal adj-no use must not be explained as an adjective`);
}
for (const [id, role] of [
  ["vocab-0158", "助詞"],
  ["vocab-0207", "連體詞"],
  ["vocab-0351", "助詞"],
  ["vocab-0360", "連接詞"],
  ["vocab-0421", "連接詞"],
]) {
  const explanation = cards.find((card) => card.id === id)?.examples?.[0]?.explanationZh;
  assert.ok(explanation?.includes(role) && !explanation.includes("是名詞"),
    `${id}: grammatical function must not fall through to a noun explanation`);
  if (id === "vocab-0158") assert.ok(!explanation.includes("單獨使用"),
    "sentence-final ね must not be described as an isolated interjection");
}
console.log(JSON.stringify({ ok: true, checkedSourceCorrections: 6, checkedGrammarExamples: 7 }));
