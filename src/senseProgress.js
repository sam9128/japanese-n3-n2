// Store the exact assessed content with the event: editing a meaning, source or
// either context must not silently carry mastery to a different question.
export function senseRevision(card, sense) {
  return JSON.stringify([
    sense.sourceSequence ?? card.senseSourceSequence ?? null,
    sense.meaningZh,
    sense.quizSentence,
    sense.quizTranslationZh,
    sense.alternateQuiz?.ja,
    sense.alternateQuiz?.zh,
    // Keep existing revisions stable unless this sense introduces an explicit
    // pronunciation. Changing that pronunciation must invalidate old answers.
    ...(sense.reading ? [sense.reading] : []),
    ...(sense.term ? [sense.term] : []),
  ]);
}

export function senseProgress(cards, events = []) {
  const byCard = new Map();
  for (const card of cards) {
    const bySense = new Map();
    for (const sense of card.senses ?? []) {
      if (sense.alternateQuiz) {
        bySense.set(sense.id, {
          revision: senseRevision(card, sense),
          correctContexts: new Set(),
          lastWrongContext: null,
        });
      }
    }
    byCard.set(card.id, bySense);
  }
  const attempts = events
    .filter((event) => event.senseId && typeof event.quizCorrect === "boolean"
      && Number.isFinite(Date.parse(event.occurredAt)))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
      || String(a.id).localeCompare(String(b.id)));
  for (const event of attempts) {
    if (event.contextId !== "primary" && event.contextId !== "alternate") continue;
    const state = byCard.get(event.cardId)?.get(event.senseId);
    if (!state || event.senseRevision !== state.revision) continue;
    if (event.quizCorrect) {
      state.correctContexts.add(event.contextId);
      state.lastWrongContext = null;
    } else {
      state.correctContexts.clear();
      state.lastWrongContext = event.contextId;
    }
  }
  return byCard;
}

export function masteredSenseCount(cards, events) {
  return [...senseProgress(cards, events).values()]
    .flatMap((bySense) => [...bySense.values()])
    .filter((state) => state.correctContexts.size >= 2).length;
}
