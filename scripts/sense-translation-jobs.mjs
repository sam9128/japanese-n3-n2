// Share the exact public-text inventory between the translation writer and audit
// reader, including newly authored teaching and assessment contexts.
export function senseTranslationJobs(row) {
  const jobs = [];
  const add = (suffix, sourceLanguage, sourceText, sourceEntry = row.sourceEntry) => {
    if (!sourceText?.trim()) return;
    jobs.push({ id: `${row.id}/${suffix}`, sourceLanguage, sourceText,
      sourceEntry });
  };
  add("example", "ja", row.examples?.[0]?.ja);
  (row.sourceSenses ?? []).forEach((sense, index) =>
    add(`sense-${index + 1}`, "en", sense.gloss.join("; ").trim()));
  for (const source of row.additionalTeachingSources ?? []) {
    source.sourceSenses.forEach((sense, index) =>
      add(`source-${source.sourceEntry}/sense-${index + 1}`, "en",
        sense.gloss.join("; ").trim(), source.sourceEntry));
  }
  for (const sense of row.teachingSenses ?? []) {
    const sourceEntry = sense.sourceSequence ?? row.sourceEntry;
    add(`teaching/${sense.id}/example`, "ja", sense.example?.ja, sourceEntry);
    add(`teaching/${sense.id}/primary`, "ja", sense.quizSentence, sourceEntry);
    add(`teaching/${sense.id}/alternate`, "ja", sense.alternateQuiz?.ja, sourceEntry);
  }
  return jobs;
}
