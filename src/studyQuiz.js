import { senseProgress, senseRevision } from "./senseProgress.js";

export const STUDY_QUIZ_SIZE = 3;
export const STUDY_QUIZ_OPTION_COUNT = 4;
export const STUDY_QUIZ_RECENT_ROUNDS = 3;
export const STUDY_QUIZ_MIN_WEIGHT = 0.2;

export function shuffleItems(items, random = Math.random) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function quizWeight(item, progressRecord = {}) {
  const attempts = Number(progressRecord.quizAttempts) || 0;
  const correct = Number(progressRecord.quizCorrect) || 0;
  const wrong = Number(progressRecord.quizWrong) || 0;
  const wrongRate = attempts ? wrong / attempts : 0.35;
  const lastWrongBoost = progressRecord.lastQuizCorrect === false ? 1.35 : 0;
  const weight =
    1 + wrongRate * 4 + wrong * 0.45 - correct * 0.18 + lastWrongBoost;
  return Math.max(STUDY_QUIZ_MIN_WEIGHT, Number(weight.toFixed(4)));
}

export function getRecentQuizIds(recentQuizRounds = []) {
  return new Set(
    recentQuizRounds
      .slice(0, STUDY_QUIZ_RECENT_ROUNDS)
      .flatMap((round) => (Array.isArray(round) ? round : [])),
  );
}

function pickWeighted(candidates, progress, random) {
  const weighted = candidates.map((item) => ({
    item,
    weight: quizWeight(item, progress[item.id]),
  }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = random() * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.item;
  }
  return weighted.at(-1)?.item;
}

export function pickQuizItems({
  pool,
  progress = {},
  recentQuizRounds = [],
  size = STUDY_QUIZ_SIZE,
  random = Math.random,
}) {
  const available = Array.from(
    new Map(pool.filter(Boolean).map((item) => [item.id, item])).values(),
  );
  const targetSize = Math.min(size, available.length);
  const picked = [];
  const pickedIds = new Set();
  const recentIds = getRecentQuizIds(recentQuizRounds);

  while (picked.length < targetSize) {
    const strictCandidates = available.filter(
      (item) => !pickedIds.has(item.id) && !recentIds.has(item.id),
    );
    const fallbackCandidates = available.filter(
      (item) => !pickedIds.has(item.id),
    );
    const candidates = strictCandidates.length
      ? strictCandidates
      : fallbackCandidates;
    if (!candidates.length) break;
    const next = pickWeighted(candidates, progress, random);
    if (!next) break;
    picked.push(next);
    pickedIds.add(next.id);
  }

  return picked;
}

// A question's wrong answers must come from its own category. Mixing 單字 meanings
// into a 文法 question makes it answerable on shape alone — the learner spots the
// one option phrased like a grammar note and never reads the others.
export function categoryDistractors(item, allCandidates = []) {
  return allCandidates.filter(
    (candidate) =>
      candidate?.id !== item.id && candidate?.category === item.category,
  );
}

export function buildQuizQuestion(item, allCandidates, random = Math.random, events = []) {
  const senses = item.senses?.filter((sense) => sense.quizSentence && sense.meaningZh) ?? [];
  if (new Set(senses.map((sense) => sense.meaningZh)).size >= 2) {
    const states = senseProgress([item], events).get(item.id);
    const unresolved = senses.filter((sense) =>
      (states.get(sense.id)?.correctContexts.size ?? 0) < 2);
    const candidates = unresolved.length ? unresolved : senses;
    const sense = candidates[Math.floor(random() * candidates.length)];
    const state = states.get(sense.id);
    const contextRandom = random();
    const contextId = state?.lastWrongContext
      ?? (state?.correctContexts.size === 1
        ? (state.correctContexts.has("primary") ? "alternate" : "primary")
        : (contextRandom >= 0.5 ? "alternate" : "primary"));
    const alternate = sense.alternateQuiz && contextId === "alternate"
      ? sense.alternateQuiz
      : null;
    const otherMeanings = [...new Set(senses.map((entry) => entry.meaningZh))]
      .filter((meaning) => meaning !== sense.meaningZh);
    const options = shuffleItems([
      sense.meaningZh,
      ...shuffleItems(otherMeanings, random).slice(0, STUDY_QUIZ_OPTION_COUNT - 1),
    ], random);
    return {
      itemId: item.id,
      senseId: sense.id,
      senseRevision: senseRevision(item, sense),
      term: sense.term || item.term,
      reading: sense.reading || item.reading,
      category: item.category,
      audioText: sense.reading || item.audioText || item.term,
      contextId: alternate ? "alternate" : "primary",
      context: alternate?.ja ?? sense.quizSentence,
      contextTranslationZh: alternate?.zh ?? sense.quizTranslationZh,
      correctMeaning: sense.meaningZh,
      correctIndex: options.indexOf(sense.meaningZh),
      options,
    };
  }
  const correctMeaning = item.meaningZh || item.usageZh || "";
  const distractors = Array.from(
    new Map(
      categoryDistractors(item, allCandidates)
        .map((candidate) => [candidate.meaningZh || candidate.usageZh, candidate])
        .filter(([meaning]) => meaning && meaning !== correctMeaning),
    ).keys(),
  );
  const options = shuffleItems(
    [correctMeaning, ...shuffleItems(distractors, random).slice(0, 3)].filter(
      Boolean,
    ),
    random,
  );
  return {
    itemId: item.id,
    term: item.term,
    reading: item.reading,
    category: item.category,
    audioText: item.audioText || item.term,
    correctMeaning,
    correctIndex: options.indexOf(correctMeaning),
    options,
  };
}

export function buildStudyQuiz({
  pool,
  allCandidates,
  progress = {},
  recentQuizRounds = [],
  random = Math.random,
  events = [],
}) {
  const quizItems = pickQuizItems({
    pool,
    progress,
    recentQuizRounds,
    random,
  });
  return (
    quizItems
      .map((item) =>
        buildQuizQuestion(
          item,
          allCandidates?.length ? allCandidates : pool,
          random,
          events,
        ),
      )
      // Staying inside one category can leave a question with no wrong answer to
      // offer — early in a month there may be only a handful of 文法 cards. A
      // single-option question is not a question, so drop it rather than pad it
      // with 單字 meanings.
      .filter((question) => question.options.length >= 2)
  );
}

export function rememberQuizRound(recentQuizRounds = [], itemIds = []) {
  return [itemIds, ...recentQuizRounds].slice(0, STUDY_QUIZ_RECENT_ROUNDS);
}
