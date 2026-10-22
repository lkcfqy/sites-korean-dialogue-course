import { isCount, isRecord, isTimestamp } from "./study-validation";

export type RecallGrade = "again" | "hard" | "good";
export type WordMemory = {
  streak: number;
  due: number;
  reviewed: number;
  lapses: number;
};
export type Memory = Record<string, WordMemory>;
export const MEMORY_KEY = "korean-word-memory-v1";
export const REVIEW_LIMIT = 80;
const intervals = [1, 3, 7, 14, 30, 60, 90];

function isWordMemory(value: unknown): value is WordMemory {
  return (
    isRecord(value) &&
    isCount(value.streak) &&
    value.streak <= intervals.length &&
    isTimestamp(value.due) &&
    isTimestamp(value.reviewed) &&
    value.due >= value.reviewed &&
    isCount(value.lapses)
  );
}

export function parseMemory(raw: string | null): Memory {
  try {
    const data: unknown = JSON.parse(raw || "{}");
    if (!isRecord(data)) return {};
    return Object.fromEntries(
      Object.entries(data)
        .filter(
          ([ko, value]) => /^[가-힣 ]{1,50}$/.test(ko) && isWordMemory(value),
        )
        .map(([ko, value]) => {
          const { streak, due, reviewed, lapses } = value as WordMemory;
          return [ko, { streak, due, reviewed, lapses }];
        }),
    );
  } catch {
    return {};
  }
}

export function rateWord(
  previous: WordMemory | undefined,
  grade: RecallGrade,
  now = Date.now(),
): WordMemory {
  if (!isTimestamp(now)) throw new RangeError("复习时间无效。");
  if (!isWordMemory(previous)) previous = undefined;
  // Looking at a card before it is due must not inflate its retention interval.
  if (grade === "good" && previous && previous.streak > 0 && previous.due > now)
    return previous;
  const alreadyReviewedToday =
    previous &&
    new Date(previous.reviewed).toDateString() === new Date(now).toDateString();
  const streak =
    grade === "good"
      ? Math.min(
          Math.max(1, (previous?.streak ?? 0) + (alreadyReviewedToday ? 0 : 1)),
          intervals.length,
        )
      : grade === "hard"
        ? Math.max(0, (previous?.streak ?? 0) - 1)
        : 0;
  const next = new Date(now);
  if (grade === "again") next.setMinutes(next.getMinutes() + 10);
  else
    next.setDate(
      next.getDate() + (grade === "hard" ? 1 : intervals[streak - 1]),
    );
  if (!isTimestamp(next.getTime())) throw new RangeError("下次复习时间无效。");
  return {
    streak,
    due: next.getTime(),
    reviewed: now,
    lapses: Math.min(
      Number.MAX_SAFE_INTEGER,
      (previous?.lapses ?? 0) + (grade === "again" ? 1 : 0),
    ),
  };
}

/** Review overdue words first; new words stay in their lesson's teaching order. */
export function dailyQueue(
  newWords: string[],
  memory: Memory,
  validWords: Set<string>,
  now = Date.now(),
) {
  const due = Object.entries(memory)
    .filter(([ko, item]) => validWords.has(ko) && item.due <= now)
    .sort((a, b) => a[1].due - b[1].due || b[1].lapses - a[1].lapses)
    .map(([ko]) => ko);
  const fresh = [
    ...new Set(newWords.filter((ko) => validWords.has(ko) && !memory[ko])),
  ];
  return {
    words: [...new Set([...due.slice(0, REVIEW_LIMIT), ...fresh])],
    due: due.length,
    fresh: fresh.length,
    remaining: Math.max(0, due.length - REVIEW_LIMIT),
  };
}

export function loadMemory(): Memory {
  try {
    return parseMemory(localStorage.getItem(MEMORY_KEY));
  } catch {
    return {};
  }
}

export function saveRecall(
  ko: string,
  grade: RecallGrade,
  now = Date.now(),
): { saved: true; next: WordMemory } | { saved: false } {
  try {
    if (!/^[가-힣 ]{1,50}$/.test(ko)) return { saved: false };
    // A failed read must never be treated as an empty record and overwrite prior progress.
    const memory = parseMemory(localStorage.getItem(MEMORY_KEY));
    const next = rateWord(memory[ko], grade, now);
    memory[ko] = next;
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("korean-study-updated"));
    return { next, saved: true };
  } catch {
    return { saved: false };
  }
}
