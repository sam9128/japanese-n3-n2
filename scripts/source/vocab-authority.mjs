// The vocabulary spine, with the hand-decided reading fixes already applied.
//
// vocab-authority.json is written by rebuild-vocab-authority.mjs, which ranks JMdict
// entries on their English gloss alone. A word written the same way under two readings
// can therefore land on the wrong entry — 大家 resolved to たいか (a master) instead of
// おおや (a landlord), while its example sentence was about a landlord. Those calls are
// recorded in vocab-reading-review.json.
//
// Everything that reads the spine goes through here. Three separate readers of the raw
// file is exactly how the fix and the check ended up disagreeing the first time.
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const vocabularySenseReview = JSON.parse(
  fs.readFileSync(path.join(here, "vocab-sense-review.json"), "utf8"),
);
const senseSourceReview = JSON.parse(
  fs.readFileSync(path.join(here, "vocab-sense-source-review.json"), "utf8"),
);

export const readingReview = JSON.parse(
  fs.readFileSync(path.join(here, "vocab-reading-review.json"), "utf8"),
).reviewed;

export function loadVocabAuthority({ applySourceMetadata = true } = {}) {
  const rows = JSON.parse(fs.readFileSync(path.join(here, "vocab-authority.json"), "utf8"));
  const originalSequences = new Map(rows.map((row) => [row.id, row.seq]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [id, review] of Object.entries(readingReview)) {
    if (review.decision !== "fix") continue;
    const row = byId.get(id);
    if (!row) throw new Error(`讀音覆寫找不到詞條：${id}`);
    Object.assign(row, review.fix);
  }
  for (const [id, review] of Object.entries(senseSourceReview)) {
    const row = byId.get(id);
    if (row?.term !== review.currentTerm || row?.reading !== review.currentReading) {
      throw new Error(`義項來源修訂與單字骨架不符：${id}`);
    }
    Object.assign(row, {
      term: review.proposedTerm,
      reading: review.proposedReading,
      seq: review.proposedSequence,
      glossEn: review.glossEn,
      senses: [],
      reviewedExample: { ja: review.proposedExampleJa, zh: review.exampleZh },
    });
  }
  for (const [id, review] of Object.entries(vocabularySenseReview)) {
    if (!["match", "split"].includes(review.decision) && !review.fix) continue;
    const row = byId.get(id);
    const sequence = review.fix?.seq ?? review.seq;
    if (!row || !Number.isInteger(sequence)) {
      throw new Error(`無效的單字來源審查結果：${id}`);
    }
    if (row.seq !== sequence) {
      row.seq = sequence;
      row.senses = [];
      row.glossEn = "";
    }
    if (review.fix?.reading) row.reading = review.fix.reading;
    if (review.fix?.term) row.term = review.fix.term;
    if (review.fix?.meaningZh) row.reviewedMeaningZh = review.fix.meaningZh;
    if (review.fix?.example) {
      const [ja, zh] = review.fix.example;
      row.reviewedExample = { ja, zh };
    }
  }
  if (applySourceMetadata) {
    const metadata = JSON.parse(fs.readFileSync(path.join(here, "vocab-source-metadata.json"), "utf8"));
    for (const row of rows) {
      const entry = metadata[row.id];
      if (!entry || entry.seq !== row.seq || entry.term !== row.term || entry.reading !== row.reading) {
        throw new Error(`詞典來源異動後須更新詞性與義項資料：${row.id}`);
      }
      row.pos = entry.pos;
      if (originalSequences.get(row.id) !== row.seq && (!entry.senses?.length || !entry.glossEn)) {
        throw new Error(`更換詞典來源後缺少義項資料：${row.id}`);
      }
      if (entry.glossEn !== undefined) row.glossEn = entry.glossEn;
      if (entry.senses !== undefined) row.senses = entry.senses;
    }
  }
  return rows;
}
