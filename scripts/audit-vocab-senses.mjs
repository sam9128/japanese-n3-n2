import { readFileSync } from "node:fs";
import { loadVocabAuthority } from "./source/vocab-authority.mjs";
import { senseTranslationJobs } from "./sense-translation-jobs.mjs";
import { teachingContextReviewStatus } from "./teaching-context-review.mjs";

const readContent = (path) =>
  JSON.parse(readFileSync(new URL(`../public/content/${path}`, import.meta.url), "utf8"));

const index = readContent("index.json");
const cards = index.periods.flatMap((period) => readContent(`periods/${period}.json`).vocabulary);
const authority = loadVocabAuthority();
const reviews = JSON.parse(readFileSync(
  new URL("./source/vocab-sense-review.json", import.meta.url), "utf8",
));
const formReviews = JSON.parse(readFileSync(
  new URL("./source/vocab-sense-source-review.json", import.meta.url), "utf8",
));
const sources = new Map(authority.map((row) => [row.id, row]));
const translationPath = process.argv[4];
const translations = new Map();
if (translationPath) {
  const lines = readFileSync(translationPath, "utf8").split("\n");
  // The translator may be appending the next batch while this audit reads it.
  // Only newline-terminated records are complete.
  for (const line of lines.slice(0, -1).filter(Boolean)) {
    const row = JSON.parse(line);
    translations.set(row.id, row);
  }
}
const indexPath = process.argv[2];
const dictionary = indexPath ? JSON.parse(readFileSync(indexPath, "utf8")) : null;
const entriesBySequence = new Map(dictionary?.entries.map((entry) => [entry.seq, entry]));

function applicableSenses(entry, term, reading) {
  if (!entry) return [];
  const written = entry.kanji.some((form) => form.t === term);
  const validReading = entry.readings.some((form) =>
    form.t === reading && (written
      ? !form.nokanji && (!form.restr.length || form.restr.includes(term))
      : term === reading));
  if (!validReading) return [];
  return entry.senses.filter((sense) =>
    (!sense.stagk.length || sense.stagk.includes(term) ||
      (!written && sense.misc.includes("uk") && entry.readings.some((form) =>
        form.t === reading && !form.nokanji &&
        (!form.restr.length || form.restr.some((spelling) => sense.stagk.includes(spelling)))))) &&
    (!sense.stagr.length || sense.stagr.includes(reading)));
}
if (cards.length !== 4000 || authority.length !== cards.length ||
    sources.size !== authority.length || new Set(cards.map((card) => card.id)).size !== cards.length) {
  throw new Error("單字數量或 ID 唯一性檢查失敗");
}

const range = process.argv[3] ?? "1-4000";
const match = /^(\d+)-(\d+)$/.exec(range);
if (!match || Number(match[1]) < 1 || Number(match[2]) > cards.length ||
    Number(match[1]) > Number(match[2])) {
  throw new Error(`無效的審查範圍：${range}`);
}
const [first, last] = match.slice(1).map(Number);
for (const card of [...cards].sort((a, b) => a.id.localeCompare(b.id)).slice(first - 1, last)) {
  const source = sources.get(card.id);
  const senses = dictionary
    ? applicableSenses(entriesBySequence.get(source?.seq), card.term, card.reading)
    : source?.senses ?? [];
  const alternativeEntries = [];
  if (dictionary && !senses.length) {
    const lookup = card.term === card.reading ? dictionary.byReading : dictionary.byKanji;
    for (const entryIndex of lookup[card.term] ?? []) {
      const entry = dictionary.entries[entryIndex];
      const candidates = applicableSenses(entry, card.term, card.reading);
      if (candidates.length) alternativeEntries.push({ seq: entry.seq, senses: candidates });
    }
  }
  const flags = [];
  const additionalTeachingSources = [];
  const additionalSequences = new Map();
  for (const sense of card.senses ?? []) {
    const sequence = sense.sourceSequence;
    if (sequence !== undefined && (!Number.isSafeInteger(sequence) || sequence <= 0)) {
      flags.push(`invalid-teaching-source:${sense.id}`);
    }
    const effectiveSequence = sequence ?? source?.seq;
    if (dictionary) {
      const candidates = applicableSenses(entriesBySequence.get(effectiveSequence),
        sense.term || card.term, sense.reading || card.reading)
        .filter((candidate) => effectiveSequence !== source?.seq || !senses.includes(candidate));
      if (candidates.length) {
        if (!additionalSequences.has(effectiveSequence)) {
          const extra = { sourceEntry: effectiveSequence, sourceSenses: [] };
          additionalSequences.set(effectiveSequence, extra);
          additionalTeachingSources.push(extra);
        }
        const extra = additionalSequences.get(effectiveSequence);
        for (const candidate of candidates) {
          if (!extra.sourceSenses.includes(candidate)) extra.sourceSenses.push(candidate);
        }
      }
    }
  }
  const expectedTranslationSources = new Map(senseTranslationJobs({
    id: card.id, sourceEntry: source?.seq, examples: card.examples,
    sourceSenses: senses, teachingSenses: card.senses, additionalTeachingSources,
  }).map((job) => [job.id, job]));
  const machineTranslations = [];
  for (const [id, job] of expectedTranslationSources) {
    const translation = translations.get(id);
    if (translation?.sourceText === job.sourceText && translation.sourceEntry === job.sourceEntry) {
      machineTranslations.push(translation);
    }
  }
  if (!senses.length) flags.push("missing-source-senses");
  if (dictionary) {
    const expectedPos = [...new Set(senses.flatMap((sense) => sense.pos))].sort();
    const actualPos = [...new Set(source?.pos ?? [])].sort();
    if (JSON.stringify(actualPos) !== JSON.stringify(expectedPos)) {
      flags.push("source-pos-mismatch");
    }
    for (const sense of card.senses ?? []) {
      if (!applicableSenses(entriesBySequence.get(sense.sourceSequence ?? source?.seq),
        sense.term || card.term, sense.reading || card.reading).length) {
        flags.push(`teaching-source-form-mismatch:${sense.id}`);
      }
    }
  }
  if (!card.meaningZh?.trim()) flags.push("missing-translation");
  if (card.senses?.length && card.senseSourceSequence !== source?.seq) {
    flags.push("teaching-source-mismatch");
  }
  if (source && (source.term !== card.term || source.reading !== card.reading)) {
    flags.push("source-form-mismatch");
  }
  console.log(JSON.stringify({
    id: card.id,
    period: card.unlockPeriod,
    term: card.term,
    reading: card.reading,
    meaningZh: card.meaningZh,
    examples: card.examples ?? card.example ?? null,
    sourceEntry: source?.seq ?? null,
    sourceSenses: senses,
    ...(additionalTeachingSources.length ? { additionalTeachingSources } : {}),
    teachingSenses: card.senses ?? [],
    sourceReview: reviews[card.id] ?? null,
    formReview: formReviews[card.id] ?? null,
    semanticReviewStatus: reviews[card.id] ? "decision-recorded" : "pending",
    teachingContextReviewStatus: teachingContextReviewStatus({
      id: card.id, sourceEntry: source?.seq, term: card.term, reading: card.reading,
      teachingSenses: card.senses,
    }, reviews[card.id]),
    ...(translationPath ? { machineTranslations } : {}),
    ...(alternativeEntries.length ? { alternativeEntries } : {}),
    flags,
  }));
}
