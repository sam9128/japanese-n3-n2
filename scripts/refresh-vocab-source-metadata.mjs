// Snapshot POS for every reviewed headword/reading, retaining richer metadata
// for corrected sources. Runtime generation must not need the local dictionary.
import fs from "node:fs";
import { loadVocabAuthority } from "./source/vocab-authority.mjs";

const dictionaryPath = process.argv[2];
if (!dictionaryPath) throw new Error("請提供 JMdict 索引路徑");
const dictionary = JSON.parse(fs.readFileSync(dictionaryPath, "utf8"));
const entries = new Map(dictionary.entries.map((entry) => [entry.seq, entry]));
const source = new URL("./source/vocab-authority.json", import.meta.url);
const original = new Map(JSON.parse(fs.readFileSync(source, "utf8")).map((row) => [row.id, row]));
const metadata = {};
const previous = JSON.parse(fs.readFileSync(new URL("./source/vocab-source-metadata.json", import.meta.url), "utf8"));
let updatedPartsOfSpeech = 0;
let correctedSources = 0;
for (const row of loadVocabAuthority({ applySourceMetadata: false })) {
  const entry = entries.get(row.seq);
  if (!entry) throw new Error(`找不到詞典來源：${row.id} / ${row.seq}`);
  const written = entry.kanji.some((form) => form.t === row.term);
  const validReading = entry.readings.some((form) => form.t === row.reading &&
    (written ? !form.nokanji && (!form.restr.length || form.restr.includes(row.term))
      : row.term === row.reading));
  const senses = validReading ? entry.senses.filter((sense) =>
    (!sense.stagk.length || sense.stagk.includes(row.term) ||
      (!written && sense.misc.includes("uk") && entry.readings.some((form) =>
        form.t === row.reading && !form.nokanji &&
        (!form.restr.length || form.restr.some((spelling) => sense.stagk.includes(spelling)))))) &&
    (!sense.stagr.length || sense.stagr.includes(row.reading))) : [];
  if (!senses.length) throw new Error(`來源不適用於詞形／讀音：${row.id}`);
  const pos = [...new Set(senses.flatMap((sense) => sense.pos))];
  const oldPos = previous[row.id]?.pos ?? row.pos;
  if (JSON.stringify([...oldPos].sort()) !== JSON.stringify([...pos].sort())) updatedPartsOfSpeech++;
  const changedSource = original.get(row.id).seq !== row.seq;
  if (changedSource) correctedSources++;
  metadata[row.id] = {
    seq: row.seq, term: row.term, reading: row.reading,
    pos,
    ...(changedSource ? {
      glossEn: senses.slice(0, 3).map((sense) => sense.gloss.join("; ")).join(" / "),
      senses,
    } : {}),
  };
}
fs.writeFileSync(new URL("./source/vocab-source-metadata.json", import.meta.url),
  JSON.stringify(metadata, null, 2) + "\n");
console.log({ reviewedSources: Object.keys(metadata).length, correctedSources, updatedPartsOfSpeech });
