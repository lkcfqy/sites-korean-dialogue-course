import source from "./curriculum/dialogues.json";
import { buildCourse } from "./course-builder";
export type LinkedPhrase = {
  headword: string;
  /** Half-open indices into the original, unchanged Word[] array. */
  wordStart: number;
  wordEnd: number;
  surfaceTokens: string[];
  surface: string;
  lexicalComponents: string[];
  reviewedLineId: string;
  meaning?: string;
};
export type WordAnnotation = {
  status: "linked" | "ambiguous" | "unlinked";
  method: "morphology" | "machine-rule" | "legacy-normalization";
  confidence: "machine-supported" | "uncertain";
  rule?: string;
  candidates?: string[];
  reason?: string;
  linkedSpans?: LinkedPhrase[];
};
export type Word = {
  text: string;
  meaning: string;
  base?: string;
  note?: string;
  lemmas?: string[];
  annotation?: WordAnnotation;
  contextSense?: {
    reviewedLineId: string;
    headword: string;
    meaning: string;
    morphologyNote: string;
    otherSenses: string[];
    confidence: "reviewed-project-inference";
  };
};
export type Line = {
  id: string;
  speaker: "A" | "B";
  ko: string;
  zh: string;
  words: Word[];
  chunks?: string[];
  section?: string;
  paragraph?: number;
  register?: "written";
  pattern?: {
    form: string;
    explanation: string;
    caution: string;
  };
};
export type Dialogue = {
  id: string;
  week: number;
  day: number;
  title: string;
  scene: string;
  focus: string;
  lines: Line[];
  vocabulary: string[];
};
export type Section = {
  label: string;
  review: boolean;
  lines: Line[];
  sources: Pick<Dialogue, "id" | "title" | "week" | "day">[];
};
export type Lesson = Omit<Dialogue, "lines"> & {
  kind: "new" | "review";
  sections: Section[];
  lines: Line[];
  reviewVocabulary: string[];
};
export const dialogues = source as Dialogue[];
export const lessons = buildCourse(dialogues);
export const phaseForWeek = (week: number) =>
  week <= 6
    ? "入门 · 生活短句"
    : week <= 12
      ? "基础 · 完整交流"
      : week <= 18
        ? "中级 · 叙述与协商"
        : "进阶 · 社会议题与论证";
