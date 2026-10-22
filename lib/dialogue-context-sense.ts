import type { Line, Word } from "../data/course";

export type ContextSenseDecision = {
  lineId: string;
  lessonId: string;
  ko: string;
  wordIndex: number;
  surface: string;
  headword: string;
  contextMeaning: string;
  morphologyNote: string;
  dictionaryMeaning: string;
  otherSenses: string[];
  reason: string;
  confidence: "reviewed-project-inference";
};

/** Exact reviewed context only; never transfer an interpretation to homographs. */
export function applyReviewedContextSense(
  line: Line,
  decision: ContextSenseDecision,
): Line {
  const word = line.words[decision.wordIndex];
  if (
    line.id !== decision.lineId ||
    line.ko !== decision.ko ||
    !line.id.startsWith(`${decision.lessonId}-`) ||
    !Number.isInteger(decision.wordIndex) ||
    decision.wordIndex < 0 ||
    word?.text !== decision.surface ||
    word.annotation?.status !== "linked" ||
    !word.lemmas?.includes(decision.headword)
  )
    return line;
  const contextSense: NonNullable<Word["contextSense"]> = {
    reviewedLineId: decision.lineId,
    headword: decision.headword,
    meaning: decision.contextMeaning,
    morphologyNote: decision.morphologyNote,
    otherSenses: decision.otherSenses,
    confidence: decision.confidence,
  };
  return {
    ...line,
    words: line.words.map((item, index) =>
      index === decision.wordIndex ? { ...item, contextSense } : item,
    ),
  };
}
