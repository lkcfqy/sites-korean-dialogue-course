import { isCount, isRecord, isTimestamp } from "./study-validation";

export type Skill =
  "foundation" | "grammar" | "listening" | "reading" | "writing";
export type QuizRecord = {
  id: string;
  week: number;
  skill: Skill;
  correct: number;
  total: number;
  seconds: number;
  at: number;
  mistakes: string[];
  completed: boolean;
  delayed: boolean;
};
export type MistakeRecord = {
  id: string;
  week: number;
  skill: Skill;
  failures: number;
  due: number;
  corrected: number;
  updatedAt?: number;
};
export type StudyRecord = {
  attempts: QuizRecord[];
  mistakes: Record<string, MistakeRecord>;
  writing: Record<string, { at: number; revised: boolean; checks: string[] }>;
};
export const STUDY_KEY = "korean-study-record-v1";
export const STUDY_EVENT = "korean-study-updated";
export const emptyStudy = (): StudyRecord => ({
  attempts: [],
  mistakes: {},
  writing: {},
});
const skills = new Set([
  "foundation",
  "grammar",
  "listening",
  "reading",
  "writing",
]);
const safeId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[\w:.-]{1,120}$/.test(id) &&
  !["__proto__", "constructor", "prototype"].includes(id);
const validWeek = (week: unknown): week is number =>
  isCount(week) && week >= 1 && week <= 26;

export function parseStudy(raw: string | null): StudyRecord {
  try {
    const value: unknown = JSON.parse(raw || "null");
    if (!isRecord(value) || !Array.isArray(value.attempts)) return emptyStudy();
    const attempts = value.attempts
      .filter(
        (x): x is QuizRecord =>
          isRecord(x) &&
          safeId(x.id) &&
          skills.has(x.skill as Skill) &&
          validWeek(x.week) &&
          isCount(x.correct) &&
          isCount(x.total) &&
          x.total > 0 &&
          x.correct <= x.total &&
          typeof x.seconds === "number" &&
          Number.isFinite(x.seconds) &&
          x.seconds >= 0 &&
          isTimestamp(x.at) &&
          Array.isArray(x.mistakes) &&
          x.mistakes.every(safeId) &&
          typeof x.completed === "boolean" &&
          typeof x.delayed === "boolean",
      )
      .slice(-400)
      .map(
        ({
          id,
          week,
          skill,
          correct,
          total,
          seconds,
          at,
          mistakes,
          completed,
          delayed,
        }) => ({
          id,
          week,
          skill,
          correct,
          total,
          seconds,
          at,
          mistakes,
          completed,
          delayed,
        }),
      );
    const mistakes = Object.fromEntries(
      Object.entries(isRecord(value.mistakes) ? value.mistakes : {})
        .filter(
          ([id, x]) =>
            isRecord(x) &&
            safeId(id) &&
            x.id === id &&
            skills.has(x.skill as Skill) &&
            validWeek(x.week) &&
            isCount(x.failures) &&
            isTimestamp(x.due) &&
            isCount(x.corrected) &&
            (x.updatedAt === undefined || isTimestamp(x.updatedAt)),
        )
        .map(([id, x]) => {
          const { week, skill, failures, due, corrected, updatedAt } =
            x as MistakeRecord;
          return [
            id,
            {
              id,
              week,
              skill,
              failures,
              due,
              corrected,
              ...(updatedAt === undefined ? {} : { updatedAt }),
            },
          ];
        }),
    );
    const writing = Object.fromEntries(
      Object.entries(isRecord(value.writing) ? value.writing : {})
        .filter(
          ([id, x]) =>
            safeId(id) &&
            isRecord(x) &&
            isTimestamp(x.at) &&
            typeof x.revised === "boolean" &&
            Array.isArray(x.checks) &&
            x.checks.every((s) => typeof s === "string"),
        )
        .map(([id, x]) => {
          const { at, revised, checks } = x as StudyRecord["writing"][string];
          return [id, { at, revised, checks }];
        }),
    );
    return { attempts, mistakes, writing };
  } catch {
    return emptyStudy();
  }
}

export function loadStudy(): StudyRecord {
  try {
    return parseStudy(localStorage.getItem(STUDY_KEY));
  } catch {
    return emptyStudy();
  }
}

export function saveStudy(record: StudyRecord) {
  try {
    localStorage.setItem(STUDY_KEY, JSON.stringify(record));
    window.dispatchEvent(new Event(STUDY_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function recordQuiz(
  attempt: QuizRecord,
  answered: { id: string; correct: boolean }[],
): boolean {
  let study: StudyRecord;
  try {
    study = parseStudy(localStorage.getItem(STUDY_KEY));
  } catch {
    return false;
  }
  study.attempts = [...study.attempts, attempt].slice(-400);
  for (const answer of answered) {
    const prior = Object.hasOwn(study.mistakes, answer.id)
      ? study.mistakes[answer.id]
      : undefined;
    if (!answer.correct) {
      study.mistakes[answer.id] = {
        id: answer.id,
        week: attempt.week,
        skill: attempt.skill,
        failures: (prior?.failures || 0) + 1,
        corrected: 0,
        due: attempt.at + 86400000,
        updatedAt: attempt.at,
      };
    } else if (prior) {
      // Immediate checking helps practice; delayed recall is needed to clear a mistake.
      const delayed = attempt.at >= prior.due;
      study.mistakes[answer.id] = {
        ...prior,
        corrected: prior.corrected + (delayed ? 1 : 0),
        due: delayed
          ? attempt.at + (prior.corrected > 0 ? 7 : 1) * 86400000
          : prior.due,
        updatedAt: attempt.at,
      };
    }
  }
  return saveStudy(study);
}

export function weekStatus(study: StudyRecord, week: number, skill: Skill) {
  const attempts = study.attempts.filter(
    (a) => a.week === week && a.skill === skill && a.completed,
  );
  const latest = attempts.at(-1);
  const due = Object.values(study.mistakes).filter(
    (m) => m.week === week && m.skill === skill && m.corrected < 2,
  );
  return {
    latest,
    passed: !!latest && latest.correct / latest.total >= 0.8,
    mistakes: due.length,
  };
}

export function normalizeAnswer(text: string) {
  return text
    .normalize("NFC")
    .trim()
    .replace(/[.,!?。，！？]/g, "")
    .replace(/\s+/g, " ");
}

export function answerMatches(input: string, accepted: string[]) {
  const value = normalizeAnswer(input);
  return !!value && accepted.some((s) => normalizeAnswer(s) === value);
}
