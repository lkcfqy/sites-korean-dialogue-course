import type { Line } from "@/data/course";
export type ImmersionSection = {
  key: string;
  label: string;
  scene: string;
  contextNote?: string;
  kind?: "dialogue" | "passage" | "sentence" | "pronunciation";
  review: boolean;
  source: {
    id: string;
    title: string;
    week: number;
    day: number;
  };
  lines: Line[];
};
export type ImmersionLesson = {
  id: string;
  week: number;
  day: number;
  title: string;
  scene: string;
  kind: "new" | "review";
  vocabulary: string[];
  sceneVocabulary: string[];
  reviewVocabulary: string[];
  newLines: number;
  reviewLines: number;
  sections: ImmersionSection[];
};
export type ImmersionLessonMetadata = Omit<ImmersionLesson, "sections">;
export type ImmersionClientMetadata = Omit<
  ImmersionLessonMetadata,
  "reviewVocabulary"
> & {
  reviewVocabularyCount: number;
};
