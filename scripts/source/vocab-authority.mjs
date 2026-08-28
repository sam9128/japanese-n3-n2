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

export const readingReview = JSON.parse(
  fs.readFileSync(path.join(here, "vocab-reading-review.json"), "utf8"),
).reviewed;

export function loadVocabAuthority() {
  const rows = JSON.parse(fs.readFileSync(path.join(here, "vocab-authority.json"), "utf8"));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [id, review] of Object.entries(readingReview)) {
    if (review.decision !== "fix") continue;
    const row = byId.get(id);
    if (!row) throw new Error(`讀音覆寫找不到詞條：${id}`);
    Object.assign(row, review.fix);
  }
  return rows;
}
