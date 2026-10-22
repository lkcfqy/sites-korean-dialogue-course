import type { Line, Word } from "@/data/course";

export type ReaderWord = Word;

export type ReaderLine = {
  id: string;
  speaker: Line["speaker"];
  ko: string;
  zh: string;
  words: ReaderWord[];
  chunks?: string[];
};

export type ReaderLessonSummary = {
  id: string;
  week: number;
  day: number;
  title: string;
  scene: string;
  sectionCount: number;
};

export type ReaderLesson = {
  id: string;
  week: number;
  day: number;
  title: string;
  scene: string;
  sections: {
    key: string;
    label: string;
    scene: string;
    lines: ReaderLine[];
  }[];
};
