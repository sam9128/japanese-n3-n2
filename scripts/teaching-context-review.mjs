import { createHash } from "node:crypto";

export function teachingContextFingerprint(row) {
  return createHash("sha256").update(JSON.stringify({
    id: row.id, sourceEntry: row.sourceEntry, term: row.term, reading: row.reading,
    teachingSenses: row.teachingSenses,
  })).digest("hex");
}

export function teachingContextReviewStatus(row, review) {
  if (!row.teachingSenses?.length) return "not-applicable";
  if (!review?.teachingContextReview) return "pending";
  return review.teachingContextReview.fingerprint === teachingContextFingerprint(row)
    ? "reviewed" : "stale";
}
