// Rebuild the canonical vocabulary spine from JMdict + the JLPT soumatome decks.
//
// Why this exists: the previous generator derived readings by stripping macrons off
// romaji (fūsen -> ふせん) and derived Chinese by pivoting an English gloss through an
// English-Chinese dictionary (volume (of sound) -> volume -> 卷). Both are unfixable at
// the data level, so the spine is rebuilt from JMdict, which carries authoritative kana
// readings and sense-scoped English glosses.
//
// Inputs (regeneration only, kept outside the site bundle):
//   ../tmp/jmdict/jmdict-index.json   built by tmp/jmdict/build-index.mjs from JMdict_e.gz
//   ../tmp/jmdict/apkg-readings.json  expression -> reading, from the N3/N2 soumatome decks
//   ../tmp/language-learning-decks/japanese/{kanji,hiragana,katakana}.json  CEFR + examples
//
// Output: scripts/source/vocab-authority.json
//
// Existing ids keep their word wherever the word is real and unique, so a learner's
// recorded progress keeps pointing at what they actually studied. Only ids holding a
// duplicate or a non-word are re-issued.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outerTmp = path.resolve(root, "..", "tmp");
const periodsRoot = path.join(root, "public", "content", "periods");

const J = JSON.parse(fs.readFileSync(path.join(outerTmp, "jmdict", "jmdict-index.json"), "utf8"));
const APKG = JSON.parse(fs.readFileSync(path.join(outerTmp, "jmdict", "apkg-readings.json"), "utf8"));

const deckRows = [];
for (const f of ["kanji", "hiragana", "katakana"]) {
  deckRows.push(...JSON.parse(fs.readFileSync(path.join(outerTmp, "language-learning-decks", "japanese", `${f}.json`), "utf8")));
}
const deckByWord = new Map();
for (const row of deckRows) if (!deckByWord.has(row.word)) deckByWord.set(row.word, row);

const entryBySeq = new Map(J.entries.map((e) => [e.seq, e]));

const KATAKANA = /^[゠-ヿー]+$/;
const KANA_ONLY = /^[぀-ヿー]+$/;
const BAD_KE_INF = new Set(["oK", "iK", "rK", "sK"]);
const BAD_RE_INF = new Set(["ok", "ik", "sk"]);
// senses we never want to teach from
const BAD_MISC = new Set([
  "arch", "obs", "obsc", "rare", "sl", "vulg", "derog", "X", "chn",
  "surname", "place", "person", "organization", "company", "product", "given",
  "fem", "male", "unclass", "station", "work", "ev", "obj", "doc", "group",
  "char", "creat", "dei", "myth", "leg", "fict", "serv", "oth", "relig", "trad",
]);
const CONTENT_POS = /^(n|n-adv|n-t|adv|adv-to|adj-i|adj-na|adj-no|adj-t|adj-f|v[0-9]|v[15][a-z-]*|vs|vs-s|vs-i|vt|vi|vk|vz|exp)$/;
const PRI_WEIGHT = { ichi1: 6, news1: 5, spec1: 5, gai1: 4, ichi2: 3, news2: 3, spec2: 3, gai2: 2 };
const priScore = (list = []) =>
  list.reduce(
    (sum, p) =>
      sum + (PRI_WEIGHT[p] || (/^nf(\d+)$/.test(p) ? Math.max(0, 5 - Math.floor(Number(p.slice(2)) / 10)) : 0)),
    0,
  );
const entryPri = (e) => priScore(e.kanji[0]?.pri) + priScore(e.readings[0]?.pri);

const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

const tokenize = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 2 && !["the", "and", "for", "with", "that", "one's", "someone", "something"].includes(w));

function scoreEntry(entry, term, meaningEn) {
  let score = 0;
  const kanjiForms = entry.kanji.map((k) => k.t);
  const readingForms = entry.readings.map((r) => r.t);
  if (kanjiForms[0] === term || readingForms[0] === term) score += 8;
  else if (kanjiForms.includes(term) || readingForms.includes(term)) score += 3;
  score += entryPri(entry);
  const want = new Set(tokenize(meaningEn));
  if (want.size) {
    const got = new Set(entry.senses.flatMap((s) => s.gloss.flatMap(tokenize)));
    let hit = 0;
    for (const w of want) if (got.has(w)) hit += 1;
    score += (hit / want.size) * 30;
    const glossSet = new Set(entry.senses.flatMap((s) => s.gloss.map((g) => g.toLowerCase().trim())));
    for (const part of String(meaningEn || "").toLowerCase().split(";")) {
      if (glossSet.has(part.trim())) score += 8;
    }
  }
  return score;
}

function resolve(term, meaningEn) {
  const ids = new Set([...(J.byKanji[term] || []), ...(J.byReading[term] || [])]);
  if (KATAKANA.test(term)) for (const id of J.byReading[toHira(term)] || []) ids.add(id);
  if (!ids.size) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const id of ids) {
    const s = scoreEntry(J.entries[id], term, meaningEn);
    if (s > bestScore) {
      bestScore = s;
      best = J.entries[id];
    }
  }
  return { entry: best, score: bestScore };
}

// Which written form the learner should see on the card.
function canonicalForm(entry, originalTerm = "") {
  const firstSenseIsKana = entry.senses[0]?.misc.includes("uk");
  const goodKanji = entry.kanji.filter((k) => !k.inf.some((i) => BAD_KE_INF.has(i)));
  if (goodKanji.length && !firstSenseIsKana) return goodKanji[0].t;
  const goodReadings = entry.readings.filter((r) => !r.inf?.some?.((i) => BAD_RE_INF.has(i)));
  const pool = goodReadings.length ? goodReadings : entry.readings;
  // a kana headword that was already correct stays as written
  if (KANA_ONLY.test(originalTerm) && pool.some((r) => r.t === originalTerm)) return originalTerm;
  if (KANA_ONLY.test(originalTerm) && pool.some((r) => r.t === toHira(originalTerm))) return toHira(originalTerm);
  if (goodKanji.length && firstSenseIsKana) return pool[0].t;
  return pool[0].t;
}

function canonicalReading(entry, form) {
  if (KANA_ONLY.test(form)) return form;
  const pool = entry.readings.filter((r) => !r.inf?.some?.((i) => BAD_RE_INF.has(i)));
  const list = pool.length ? pool : entry.readings;
  const allowed = list.filter((r) => !r.restr.length || r.restr.includes(form));
  const use = allowed.length ? allowed : list;
  // The JLPT decks are curated for exactly this syllabus, so they break ties between
  // several valid JMdict readings (床 -> ゆか not とこ). They do NOT get to invent a
  // reading JMdict does not list: one deck row abbreviates 当たり前 to あたり.
  const jmdictReadings = new Set(use.map((r) => r.t));
  const fromDeck = (APKG[form] || []).find((r) => jmdictReadings.has(r));
  if (fromDeck) return fromDeck;
  return (use.find((r) => !KATAKANA.test(r.t)) || use[0]).t;
}

function usableSenses(entry) {
  return entry.senses
    .filter((s) => !s.misc.some((m) => BAD_MISC.has(m)))
    .map((s) => ({ pos: s.pos, misc: s.misc, inf: s.inf, gloss: s.gloss }));
}

function isTeachable(entry, originalTerm = "") {
  const senses = usableSenses(entry);
  if (!senses.length) return false;
  if (!senses[0].pos.some((p) => CONTENT_POS.test(p))) return false;
  const form = canonicalForm(entry, originalTerm);
  if (!form || form.length < 2) return false;
  if (/^[ぁ-んァ-ン]$/.test(form)) return false;
  // Quality gate: a word earns a slot only if JMdict marks it common or the JLPT
  // decks teach it. Without this, throwaway loanwords survive (オータム for 秋,
  // and similar katakana synonyms of words already on the list).
  if (entryPri(entry) < 4 && !APKG[form]) return false;
  return true;
}

// ---------------------------------------------------------------- existing rows
const existing = [];
const periodOf = new Map();
for (const file of fs.readdirSync(periodsRoot).sort()) {
  if (!file.endsWith(".json")) continue;
  const pack = JSON.parse(fs.readFileSync(path.join(periodsRoot, file), "utf8"));
  for (const v of pack.vocabulary || []) {
    existing.push(v);
    periodOf.set(v.id, v.unlockPeriod);
  }
}
existing.sort((a, b) => a.id.localeCompare(b.id));

const kept = [];
const freedIds = [];
const usedSeq = new Set();

for (const item of existing) {
  const hit = resolve(item.term, item.meaningEn);
  if (!hit || hit.score < 4 || !isTeachable(hit.entry, item.term)) {
    freedIds.push(item.id);
    continue;
  }
  if (usedSeq.has(hit.entry.seq)) {
    freedIds.push(item.id); // same word already taught under an earlier id
    continue;
  }
  usedSeq.add(hit.entry.seq);
  const form = canonicalForm(hit.entry, item.term);
  kept.push({
    id: item.id,
    seq: hit.entry.seq,
    level: item.level,
    term: form,
    reading: canonicalReading(hit.entry, form),
    senses: usableSenses(hit.entry),
    legacy: { term: item.term, reading: item.reading, meaningZh: item.meaningZh, meaningEn: item.meaningEn, example: item.examples?.[0] || null },
  });
}

// ---------------------------------------------------------------- refill pool
const candidates = [];
for (const entry of J.entries) {
  if (usedSeq.has(entry.seq)) continue;
  if (entryPri(entry) < 4) continue;
  if (!isTeachable(entry)) continue;
  const form = canonicalForm(entry);
  const deck = deckByWord.get(form) || deckByWord.get(entry.readings[0]?.t);
  const cefr = deck?.cefr_level || null;
  if (cefr && !["A2", "B1", "B2"].includes(cefr)) continue;
  const inApkg = Boolean(APKG[form]);
  if (!cefr && !inApkg) continue;
  candidates.push({
    seq: entry.seq,
    entry,
    form,
    cefr,
    inApkg,
    score: entryPri(entry) + (inApkg ? 12 : 0) + (cefr === "B1" ? 4 : cefr === "A2" ? 3 : 2),
  });
}
candidates.sort((a, b) => b.score - a.score);

const n3Pool = candidates.filter((c) => c.cefr === "A2" || c.cefr === "B1" || c.inApkg);
const n2Pool = candidates.filter((c) => c.cefr === "B2" && !n3Pool.includes(c));
console.log(`refill pools  N3:${n3Pool.length}  N2:${n2Pool.length}  freed ids:${freedIds.length}`);

const levelOfFreed = new Map(existing.map((v) => [v.id, v.level]));
let n3i = 0;
let n2i = 0;
const filled = [];
for (const id of freedIds) {
  const level = levelOfFreed.get(id) || "N3";
  const pool = level === "N2" ? n2Pool : n3Pool;
  let pick = null;
  while (!pick) {
    const cursor = level === "N2" ? n2i++ : n3i++;
    const c = pool[cursor];
    if (!c) break;
    if (usedSeq.has(c.seq)) continue;
    pick = c;
  }
  if (!pick) {
    console.warn("exhausted pool for", id, level);
    continue;
  }
  usedSeq.add(pick.seq);
  filled.push({
    id,
    seq: pick.seq,
    level,
    term: pick.form,
    reading: canonicalReading(pick.entry, pick.form),
    senses: usableSenses(pick.entry),
    legacy: null,
  });
}

const all = [...kept, ...filled].sort((a, b) => a.id.localeCompare(b.id));
for (const row of all) {
  row.unlockPeriod = periodOf.get(row.id);
  const deck = deckByWord.get(row.term);
  row.deckExample = deck?.example_sentence_native && deck.example_sentence_native.includes(row.term)
    ? { ja: deck.example_sentence_native, en: deck.example_sentence_english }
    : null;
  row.pos = row.senses[0].pos;
  row.glossEn = row.senses.slice(0, 3).map((s) => s.gloss.join("; ")).join(" / ");
}

// Ids whose word changed. The app clears recorded progress for these, because a
// rating recorded against the old word says nothing about the new one.
const reissuedIds = filled.map((r) => r.id).sort();
fs.writeFileSync(path.join(root, "scripts", "source", "vocab-authority.json"), JSON.stringify(all, null, 1));
fs.writeFileSync(
  path.join(root, "scripts", "source", "vocab-reissued-ids.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), ids: reissuedIds }, null, 1),
);

const withExample = all.filter((r) => r.deckExample).length;
const legacyExampleOk = all.filter((r) => !r.deckExample && r.legacy?.example?.ja?.includes(r.term)).length;
console.log(JSON.stringify({
  total: all.length,
  keptExistingWord: kept.length,
  reissuedIds: filled.length,
  distinctWords: usedSeq.size,
  deckExampleUsable: withExample,
  legacyExampleUsable: legacyExampleOk,
  needAuthoredExample: all.length - withExample - legacyExampleOk,
  n3: all.filter((r) => r.level === "N3").length,
  n2: all.filter((r) => r.level === "N2").length,
}, null, 2));
