import { isCount, isRecord, isTimestamp } from "./study-validation";
import {
  loadPersistentDialogueMemory,
  updatePersistentDialogueSentence,
} from "./dialogue-memory-storage";
export { loadDialogueSentence } from "./dialogue-memory-storage";

export const DIALOGUE_MEMORY_KEY = "korean-dialogue-memory-v1";
export const DIALOGUE_MEMORY_EVENT = "korean-study-updated";
export const DIALOGUE_REVIEW_LIMIT = 40;
const DAY = 86_400_000;
const intervals = [1, 3, 7, 14, 30, 60, 90];
const grades = ["again", "understood", "produced"] as const;
import { isPublishedDialogueLesson } from "./dialogue-catalog";
const HISTORY_LIMIT = 20;

export type DialogueGrade = (typeof grades)[number];
export type DialogueSource = {
  /** The original lesson, including when the sentence appears in a review. */
  lessonId: string;
  sectionKey: string | null;
  lineId: string;
};
export type DialogueRecallEvidence = {
  at: number;
  grade: DialogueGrade;
  draft: string;
  revealed: boolean;
  independent: boolean;
  delayed: boolean;
  dueBefore: number | null;
  reviewedBefore: number | null;
  exposedBefore: number | null;
};
export type DialogueSentenceMemory = DialogueSource & {
  exposures: number;
  lastExposedAt: number | null;
  grade: DialogueGrade | null;
  feedbackAt: number | null;
  feedback: Record<DialogueGrade, number>;
  draft: string;
  revealed: boolean;
  draftAt: number | null;
  due: number | null;
  streak: number;
  lapses: number;
  /** The last feedback that changed the schedule, not an early practice. */
  reviewedAt: number | null;
  independentRecalls: number;
  delayedRecalls: number;
  attempts: DialogueRecallEvidence[];
  updatedAt: number;
};
export type DialogueMemory = Record<string, DialogueSentenceMemory>;
export type DialogueMemoryStorage = Pick<Storage, "getItem" | "setItem">;
export type DialogueFeedback = {
  grade: DialogueGrade;
  draft: string;
  /** True if the answer was revealed at any point during this attempt. */
  revealed: boolean;
};
export type DialogueSaveResult =
  { saved: true; next: DialogueSentenceMemory } | { saved: false };

const validIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 160 &&
  !/[\u0000-\u001f]/.test(value);
const nullableTime = (value: unknown): value is number | null =>
  value === null || isTimestamp(value);
const validDraft = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 5000;
const validGrade = (value: unknown): value is DialogueGrade =>
  grades.includes(value as DialogueGrade);
const independentDraft = (draft: string, revealed: boolean) =>
  !revealed && /[\u1100-\u11ff\u3130-\u318f가-힣]/.test(draft.trim());
const increment = (count: number) =>
  Math.min(Number.MAX_SAFE_INTEGER, count + 1);

export function isDialogueSource(
  value: unknown,
): value is DialogueSource & Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.lessonId === "string" &&
    isPublishedDialogueLesson(value.lessonId) &&
    (value.sectionKey === null || validIdentifier(value.sectionKey)) &&
    validIdentifier(value.lineId)
  );
}

/** Section keys change in review lessons; the original sentence identity does not. */
export function dialogueLineKey(source: DialogueSource): string {
  if (!isDialogueSource(source)) throw new TypeError("原句位置无效。");
  return `${source.lessonId}:${encodeURIComponent(source.lineId)}`;
}

export function dialogueReviewHref(source: DialogueSource): string {
  dialogueLineKey(source);
  const params = new URLSearchParams({
    lesson: source.lessonId,
    line: source.lineId,
    recall: "1",
  });
  if (source.sectionKey) params.set("section", source.sectionKey);
  return `/?${params}`;
}

function isEvidence(value: unknown): value is DialogueRecallEvidence {
  if (
    !isRecord(value) ||
    !isTimestamp(value.at) ||
    !validGrade(value.grade) ||
    !validDraft(value.draft) ||
    typeof value.revealed !== "boolean" ||
    typeof value.independent !== "boolean" ||
    typeof value.delayed !== "boolean" ||
    !nullableTime(value.dueBefore) ||
    !nullableTime(value.reviewedBefore) ||
    !nullableTime(value.exposedBefore)
  )
    return false;
  const independent =
    value.grade === "produced" && independentDraft(value.draft, value.revealed);
  const anchor = Math.max(value.reviewedBefore ?? 0, value.exposedBefore ?? 0);
  const delayed =
    independent &&
    value.dueBefore !== null &&
    value.reviewedBefore !== null &&
    value.at >= value.dueBefore &&
    value.at - anchor >= DAY;
  const at = value.at;
  return (
    value.independent === independent &&
    value.delayed === delayed &&
    (value.dueBefore === null ||
      value.reviewedBefore === null ||
      value.dueBefore >= value.reviewedBefore) &&
    [value.reviewedBefore, value.exposedBefore].every(
      (previousAt) => previousAt === null || previousAt <= at,
    )
  );
}

export function isDialogueSentenceMemory(
  value: unknown,
): value is DialogueSentenceMemory {
  if (
    !isDialogueSource(value) ||
    !isRecord(value) ||
    !isCount(value.exposures) ||
    !nullableTime(value.lastExposedAt) ||
    !(value.grade === null || validGrade(value.grade)) ||
    !nullableTime(value.feedbackAt) ||
    !isRecord(value.feedback) ||
    !grades.every((grade) =>
      isCount((value.feedback as Record<string, unknown>)[grade]),
    ) ||
    !validDraft(value.draft) ||
    typeof value.revealed !== "boolean" ||
    !nullableTime(value.draftAt) ||
    !nullableTime(value.due) ||
    !isCount(value.streak) ||
    value.streak > intervals.length ||
    !isCount(value.lapses) ||
    !nullableTime(value.reviewedAt) ||
    !isCount(value.independentRecalls) ||
    !isCount(value.delayedRecalls) ||
    !Array.isArray(value.attempts) ||
    value.attempts.length > HISTORY_LIMIT ||
    !value.attempts.every(isEvidence) ||
    !isTimestamp(value.updatedAt)
  )
    return false;
  const feedback = value.feedback as Record<DialogueGrade, number>;
  const attempts = value.attempts as DialogueRecallEvidence[];
  const updatedAt = value.updatedAt;
  const feedbackAt = value.feedbackAt;
  return (
    (value.exposures === 0) === (value.lastExposedAt === null) &&
    (value.grade === null) === (value.feedbackAt === null) &&
    (value.due === null) === (value.reviewedAt === null) &&
    (value.feedbackAt === null) === (value.due === null) &&
    (value.reviewedAt === null ||
      value.feedbackAt === null ||
      value.reviewedAt <= value.feedbackAt) &&
    (value.due === null ||
      value.reviewedAt === null ||
      value.due >= value.reviewedAt) &&
    [
      value.lastExposedAt,
      value.feedbackAt,
      value.reviewedAt,
      value.draftAt,
    ].every((at) => at === null || at <= updatedAt) &&
    (value.grade === null || feedback[value.grade] > 0) &&
    value.lapses === feedback.again &&
    value.independentRecalls <= feedback.produced &&
    value.delayedRecalls <= value.independentRecalls &&
    value.streak <= value.delayedRecalls + 1 &&
    grades.every(
      (grade) =>
        feedback[grade] >=
        attempts.filter((attempt) => attempt.grade === grade).length,
    ) &&
    value.independentRecalls >=
      attempts.filter((attempt) => attempt.independent).length &&
    value.delayedRecalls >=
      attempts.filter((attempt) => attempt.delayed).length &&
    attempts.every(
      (attempt, index) =>
        feedbackAt !== null &&
        attempt.at <= feedbackAt &&
        (index === 0 || attempts[index - 1].at <= attempt.at),
    )
  );
}

function cleanRecord(value: DialogueSentenceMemory): DialogueSentenceMemory {
  return {
    lessonId: value.lessonId,
    sectionKey: value.sectionKey,
    lineId: value.lineId,
    exposures: value.exposures,
    lastExposedAt: value.lastExposedAt,
    grade: value.grade,
    feedbackAt: value.feedbackAt,
    feedback: {
      again: value.feedback.again,
      understood: value.feedback.understood,
      produced: value.feedback.produced,
    },
    draft: value.draft,
    revealed: value.revealed,
    draftAt: value.draftAt,
    due: value.due,
    streak: value.streak,
    lapses: value.lapses,
    reviewedAt: value.reviewedAt,
    independentRecalls: value.independentRecalls,
    delayedRecalls: value.delayedRecalls,
    attempts: value.attempts.map(
      ({
        at,
        grade,
        draft,
        revealed,
        independent,
        delayed,
        dueBefore,
        reviewedBefore,
        exposedBefore,
      }) => ({
        at,
        grade,
        draft,
        revealed,
        independent,
        delayed,
        dueBefore,
        reviewedBefore,
        exposedBefore,
      }),
    ),
    updatedAt: value.updatedAt,
  };
}

function unpackSentence(
  key: string,
  value: unknown,
): DialogueSentenceMemory | null {
  try {
    if (
      !Array.isArray(value) ||
      value.length !== 18 ||
      !isTimestamp(value[1]) ||
      !Array.isArray(value[2]) ||
      value[2].length > 85 ||
      !Array.isArray(value[3]) ||
      value[3].length < 1 ||
      value[3].length > HISTORY_LIMIT + 1 ||
      !Array.isArray(value[8]) ||
      value[8].length !== 3 ||
      !Array.isArray(value[17]) ||
      value[17].length > HISTORY_LIMIT
    )
      return null;
    const [lessonId, ...lineParts] = key.split(":");
    const lineId = decodeURIComponent(lineParts.join(":"));
    const times = value[2].map((offset: unknown) => {
      if (
        typeof offset !== "number" ||
        !Number.isSafeInteger(offset) ||
        !isTimestamp(value[1] + offset)
      )
        throw new TypeError("时间索引无效。");
      return value[1] + offset;
    }) as number[];
    const drafts: string[] = value[3].map((draft: unknown, index: number) => {
      if (validDraft(draft)) return draft;
      if (
        !index ||
        !Array.isArray(draft) ||
        draft.length !== 3 ||
        !isCount(draft[0]) ||
        !isCount(draft[1]) ||
        !validDraft(draft[2])
      )
        throw new TypeError("草稿索引无效。");
      const base = value[3][0];
      if (!validDraft(base) || draft[0] + draft[1] > base.length)
        throw new TypeError("草稿差分无效。");
      const text =
        base.slice(0, draft[0]) + draft[2] + base.slice(base.length - draft[1]);
      if (!validDraft(text)) throw new TypeError("草稿过长。");
      return text;
    });
    const time = (index: unknown): number | null => {
      if (index === -1) return null;
      if (!isCount(index) || index >= times.length)
        throw new TypeError("时间引用无效。");
      return times[index];
    };
    const draft = (index: unknown): string => {
      if (!isCount(index) || index >= drafts.length)
        throw new TypeError("草稿引用无效。");
      return drafts[index];
    };
    const grade = (index: unknown): DialogueGrade | null => {
      if (index === -1) return null;
      if (!isCount(index) || index >= grades.length)
        throw new TypeError("反馈引用无效。");
      return grades[index];
    };
    const revealed = (flag: unknown): boolean => {
      if (flag !== 0 && flag !== 1) throw new TypeError("揭晓记录无效。");
      return flag === 1;
    };
    const attempts = value[17].map(
      (attempt: unknown): DialogueRecallEvidence => {
        if (!Array.isArray(attempt) || attempt.length !== 7)
          throw new TypeError("回忆证据无效。");
        const at = time(attempt[0]),
          feedback = grade(attempt[1]);
        if (at === null || feedback === null)
          throw new TypeError("回忆证据缺少时间或反馈。");
        const text = draft(attempt[2]),
          answerSeen = revealed(attempt[3]);
        const dueBefore = time(attempt[4]),
          reviewedBefore = time(attempt[5]),
          exposedBefore = time(attempt[6]);
        const independent =
          feedback === "produced" && independentDraft(text, answerSeen);
        const delayed =
          independent &&
          dueBefore !== null &&
          reviewedBefore !== null &&
          at >= dueBefore &&
          at - Math.max(reviewedBefore, exposedBefore ?? 0) >= DAY;
        return {
          at,
          grade: feedback,
          draft: text,
          revealed: answerSeen,
          independent,
          delayed,
          dueBefore,
          reviewedBefore,
          exposedBefore,
        };
      },
    );
    const record: DialogueSentenceMemory = {
      lessonId,
      lineId,
      sectionKey: value[0],
      updatedAt: value[1],
      exposures: value[4],
      lastExposedAt: time(value[5]),
      grade: grade(value[6]),
      feedbackAt: time(value[7]),
      feedback: {
        again: value[8][0],
        understood: value[8][1],
        produced: value[8][2],
      },
      draft: draft(value[9]),
      revealed: revealed(value[10]),
      draftAt: time(value[11]),
      due: time(value[12]),
      streak: value[13],
      reviewedAt: time(value[14]),
      independentRecalls: value[15],
      delayedRecalls: value[16],
      lapses: value[8][0],
      attempts,
    };
    return isDialogueSentenceMemory(record) && dialogueLineKey(record) === key
      ? record
      : null;
  } catch {
    return null;
  }
}

/** Lossless v2: dictionary-indexed times/drafts and repeated-draft text differences. */
export function serializeDialogueMemory(memory: DialogueMemory): string {
  if (Object.keys(memory).length > 30000) throw new TypeError("句子记录过多。");
  const records = Object.fromEntries(
    Object.entries(memory).map(([key, record]) => {
      if (!isDialogueSentenceMemory(record) || dialogueLineKey(record) !== key)
        throw new TypeError("对话句子记录格式不正确。");
      const times: number[] = [],
        drafts: string[] = [];
      const time = (at: number | null) => {
        if (at === null) return -1;
        const offset = at - record.updatedAt;
        let index = times.indexOf(offset);
        if (index < 0) index = times.push(offset) - 1;
        return index;
      };
      const draft = (text: string) => {
        let index = drafts.indexOf(text);
        if (index < 0) index = drafts.push(text) - 1;
        return index;
      };
      const value: unknown[] = [
        record.sectionKey,
        record.updatedAt,
        times,
        drafts,
        record.exposures,
        time(record.lastExposedAt),
        record.grade === null ? -1 : grades.indexOf(record.grade),
        time(record.feedbackAt),
        [
          record.feedback.again,
          record.feedback.understood,
          record.feedback.produced,
        ],
        draft(record.draft),
        Number(record.revealed),
        time(record.draftAt),
        time(record.due),
        record.streak,
        time(record.reviewedAt),
        record.independentRecalls,
        record.delayedRecalls,
        record.attempts.map((attempt) => [
          time(attempt.at),
          grades.indexOf(attempt.grade),
          draft(attempt.draft),
          Number(attempt.revealed),
          time(attempt.dueBefore),
          time(attempt.reviewedBefore),
          time(attempt.exposedBefore),
        ]),
      ];
      const base = drafts[0];
      const packedDrafts = drafts.map((text, index) => {
        if (index === 0) return text;
        let prefix = 0,
          suffix = 0;
        while (
          prefix < base.length &&
          prefix < text.length &&
          base[prefix] === text[prefix]
        )
          prefix++;
        while (
          suffix < base.length - prefix &&
          suffix < text.length - prefix &&
          base[base.length - suffix - 1] === text[text.length - suffix - 1]
        )
          suffix++;
        const difference = [
          prefix,
          suffix,
          text.slice(prefix, text.length - suffix),
        ];
        return JSON.stringify(difference).length < JSON.stringify(text).length
          ? difference
          : text;
      });
      value[3] = packedDrafts;
      return [key, value];
    }),
  );
  return JSON.stringify({ version: 2, records });
}

function persistedEntries(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return value.version === 2 && isRecord(value.records) ? value.records : value;
}

export function parseDialogueMemory(raw: string | null): DialogueMemory {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    const entries = persistedEntries(value);
    if (!entries) return {};
    const compact = isRecord(value) && value.version === 2;
    return Object.fromEntries(
      Object.entries(entries)
        .map(
          ([key, record]) =>
            [key, compact ? unpackSentence(key, record) : record] as const,
        )
        .filter(
          ([key, record]) =>
            isDialogueSentenceMemory(record) && key === dialogueLineKey(record),
        )
        .map(([key, record]) => [
          key,
          cleanRecord(record as DialogueSentenceMemory),
        ]),
    );
  } catch {
    return {};
  }
}

/** Strict at write/import boundaries, so damaged data is never silently replaced. */
export function parseDialogueMemoryStrict(raw: string | null): DialogueMemory {
  const value: unknown = JSON.parse(raw ?? "{}");
  const parsed = parseDialogueMemory(raw);
  const entries = persistedEntries(value);
  if (
    !entries ||
    Object.keys(entries).length > 30000 ||
    Object.keys(entries).length !== Object.keys(parsed).length
  )
    throw new TypeError("对话句子记录格式不正确，无法安全覆盖原数据。");
  return parsed;
}

export function loadDialogueMemory(
  storage: DialogueMemoryStorage,
): DialogueMemory;
export function loadDialogueMemory(): Promise<DialogueMemory>;
export function loadDialogueMemory(
  storage?: DialogueMemoryStorage,
): DialogueMemory | Promise<DialogueMemory> {
  if (!storage) return loadPersistentDialogueMemory();
  try {
    return parseDialogueMemory(storage.getItem(DIALOGUE_MEMORY_KEY));
  } catch {
    return {};
  }
}

function emptySentence(
  source: DialogueSource,
  now: number,
): DialogueSentenceMemory {
  return {
    ...source,
    exposures: 0,
    lastExposedAt: null,
    grade: null,
    feedbackAt: null,
    feedback: { again: 0, understood: 0, produced: 0 },
    draft: "",
    revealed: false,
    draftAt: null,
    due: null,
    streak: 0,
    lapses: 0,
    reviewedAt: null,
    independentRecalls: 0,
    delayedRecalls: 0,
    attempts: [],
    updatedAt: now,
  };
}

function scheduledAt(now: number, delay: number): number {
  const due = now + delay;
  if (!isTimestamp(due)) throw new RangeError("下次复习时间无效。");
  return due;
}

export function rateDialogueSentence(
  previous: DialogueSentenceMemory | undefined,
  source: DialogueSource,
  feedback: DialogueFeedback,
  now = Date.now(),
): DialogueSentenceMemory {
  const key = dialogueLineKey(source);
  if (
    !isTimestamp(now) ||
    !validGrade(feedback.grade) ||
    !validDraft(feedback.draft) ||
    typeof feedback.revealed !== "boolean"
  )
    throw new TypeError("句子反馈无效。");
  if (
    previous &&
    (!isDialogueSentenceMemory(previous) || dialogueLineKey(previous) !== key)
  )
    throw new TypeError("已有句子记录无效。");
  const prior = previous ?? emptySentence(source, now);
  if (now < prior.updatedAt) throw new RangeError("反馈时间早于已有记录。");
  const independent =
    feedback.grade === "produced" &&
    independentDraft(feedback.draft, feedback.revealed);
  const anchor = Math.max(prior.reviewedAt ?? 0, prior.lastExposedAt ?? 0);
  const delayed =
    independent &&
    prior.due !== null &&
    prior.reviewedAt !== null &&
    now >= prior.due &&
    now - anchor >= DAY;
  let due = prior.due;
  let streak = prior.streak;
  let reviewedAt = prior.reviewedAt;
  // Repeated early successes record practice, but retain the original interval and anchor.
  if (feedback.grade === "again") {
    due = scheduledAt(now, 10 * 60_000);
    streak = 0;
    reviewedAt = now;
  } else if (due === null || now >= due) {
    streak = independent
      ? Math.min(delayed ? prior.streak + 1 : 1, intervals.length)
      : 0;
    due = scheduledAt(
      now,
      independent ? intervals[Math.max(0, streak - 1)] * DAY : DAY,
    );
    reviewedAt = now;
  }
  const evidence: DialogueRecallEvidence = {
    at: now,
    ...feedback,
    independent,
    delayed,
    dueBefore: prior.due,
    reviewedBefore: prior.reviewedAt,
    exposedBefore: prior.lastExposedAt,
  };
  return {
    ...prior,
    ...source,
    grade: feedback.grade,
    feedbackAt: now,
    feedback: {
      ...prior.feedback,
      [feedback.grade]: increment(prior.feedback[feedback.grade]),
    },
    draft: feedback.draft,
    revealed: feedback.revealed,
    draftAt: now,
    due,
    streak,
    reviewedAt,
    lapses: feedback.grade === "again" ? increment(prior.lapses) : prior.lapses,
    independentRecalls: independent
      ? increment(prior.independentRecalls)
      : prior.independentRecalls,
    delayedRecalls: delayed
      ? increment(prior.delayedRecalls)
      : prior.delayedRecalls,
    attempts: [...prior.attempts, evidence].slice(-HISTORY_LIMIT),
    updatedAt: now,
  };
}

function updateSentence(
  source: DialogueSource,
  now: number,
  storage: DialogueMemoryStorage | undefined,
  update: (previous: DialogueSentenceMemory) => DialogueSentenceMemory,
): DialogueSaveResult | Promise<DialogueSaveResult> {
  if (!storage)
    return updatePersistentDialogueSentence(source, now, (previous) =>
      update(previous ?? emptySentence(source, now)),
    )
      .then((next): DialogueSaveResult => ({ saved: true, next }))
      .catch((): DialogueSaveResult => ({ saved: false }));
  let next: DialogueSentenceMemory;
  try {
    const key = dialogueLineKey(source);
    if (!isTimestamp(now)) return { saved: false };
    const target = storage;
    const memory = parseDialogueMemoryStrict(
      target.getItem(DIALOGUE_MEMORY_KEY),
    );
    const previous = memory[key] ?? emptySentence(source, now);
    if (now < previous.updatedAt) return { saved: false };
    next = update(previous);
    if (!isDialogueSentenceMemory(next)) return { saved: false };
    memory[key] = next;
    target.setItem(DIALOGUE_MEMORY_KEY, serializeDialogueMemory(memory));
  } catch {
    return { saved: false };
  }
  // Notification failure cannot turn an already persisted record into a false save failure.
  try {
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(DIALOGUE_MEMORY_EVENT));
  } catch {
    /* Native storage events still notify other tabs. */
  }
  return { saved: true, next };
}

export function saveDialogueExposure(
  source: DialogueSource,
  now: number,
  storage: DialogueMemoryStorage,
): DialogueSaveResult;
export function saveDialogueExposure(
  source: DialogueSource,
  now?: number,
): Promise<DialogueSaveResult>;
export function saveDialogueExposure(
  source: DialogueSource,
  now = Date.now(),
  storage?: DialogueMemoryStorage,
): DialogueSaveResult | Promise<DialogueSaveResult> {
  return updateSentence(source, now, storage, (previous) => ({
    ...previous,
    ...source,
    exposures: increment(previous.exposures),
    lastExposedAt: now,
    updatedAt: now,
  }));
}

export function saveDialogueDraft(
  source: DialogueSource,
  draft: Pick<DialogueFeedback, "draft" | "revealed">,
  now: number,
  storage: DialogueMemoryStorage,
): DialogueSaveResult;
export function saveDialogueDraft(
  source: DialogueSource,
  draft: Pick<DialogueFeedback, "draft" | "revealed">,
  now?: number,
): Promise<DialogueSaveResult>;
export function saveDialogueDraft(
  source: DialogueSource,
  draft: Pick<DialogueFeedback, "draft" | "revealed">,
  now = Date.now(),
  storage?: DialogueMemoryStorage,
): DialogueSaveResult | Promise<DialogueSaveResult> {
  if (!validDraft(draft.draft) || typeof draft.revealed !== "boolean")
    return storage ? { saved: false } : Promise.resolve({ saved: false });
  return updateSentence(source, now, storage, (previous) => ({
    ...previous,
    ...source,
    ...draft,
    draftAt: now,
    updatedAt: now,
  }));
}

export function saveDialogueFeedback(
  source: DialogueSource,
  feedback: DialogueFeedback,
  now: number,
  storage: DialogueMemoryStorage,
): DialogueSaveResult;
export function saveDialogueFeedback(
  source: DialogueSource,
  feedback: DialogueFeedback,
  now?: number,
): Promise<DialogueSaveResult>;
export function saveDialogueFeedback(
  source: DialogueSource,
  feedback: DialogueFeedback,
  now = Date.now(),
  storage?: DialogueMemoryStorage,
): DialogueSaveResult | Promise<DialogueSaveResult> {
  return updateSentence(source, now, storage, (previous) =>
    rateDialogueSentence(previous, source, feedback, now),
  );
}

export function dueDialogueSentences(
  memory: DialogueMemory,
  now = Date.now(),
  limit = DIALOGUE_REVIEW_LIMIT,
): {
  items: (DialogueSentenceMemory & { key: string })[];
  total: number;
  remaining: number;
} {
  const due = Object.entries(memory)
    .filter(
      ([key, record]) =>
        isDialogueSentenceMemory(record) &&
        key === dialogueLineKey(record) &&
        record.due !== null &&
        record.due <= now,
    )
    .sort(
      ([a, x], [b, y]) =>
        (x.due ?? 0) - (y.due ?? 0) ||
        y.lapses - x.lapses ||
        a.localeCompare(b),
    );
  const count =
    Number.isSafeInteger(limit) && limit > 0
      ? Math.min(limit, 100)
      : DIALOGUE_REVIEW_LIMIT;
  return {
    items: due.slice(0, count).map(([key, record]) => ({ key, ...record })),
    total: due.length,
    remaining: Math.max(0, due.length - count),
  };
}

export function dialogueMemorySummary(
  memory: DialogueMemory,
  now = Date.now(),
) {
  const records = Object.entries(memory)
    .filter(
      ([key, record]) =>
        isDialogueSentenceMemory(record) && key === dialogueLineKey(record),
    )
    .map(([, record]) => record);
  return {
    exposed: records.filter((record) => record.exposures > 0).length,
    rated: records.filter((record) => record.grade !== null).length,
    due: records.filter((record) => record.due !== null && record.due <= now)
      .length,
    independent: records.filter((record) => record.independentRecalls > 0)
      .length,
    currentIndependent: records.filter((record) => {
      const latest = record.attempts.at(-1);
      return (
        record.grade === "produced" &&
        latest?.grade === "produced" &&
        latest.at === record.feedbackAt &&
        latest.independent
      );
    }).length,
    delayed: records.filter((record) => record.delayedRecalls > 0).length,
    repeat: records.filter((record) => record.grade === "again").length,
  };
}

/** Keep local-only sentences, newer schedules/drafts, and evidence from both backups. */
export function mergeDialogueMemory(
  current: DialogueMemory,
  incoming: DialogueMemory,
): DialogueMemory {
  const merged = { ...current };
  for (const [key, entry] of Object.entries(incoming)) {
    const old = merged[key];
    if (!old) {
      merged[key] = cleanRecord(entry);
      continue;
    }
    const latest = entry.updatedAt > old.updatedAt ? entry : old;
    const rated =
      (entry.feedbackAt ?? -1) > (old.feedbackAt ?? -1) ? entry : old;
    const scheduled =
      (entry.reviewedAt ?? -1) > (old.reviewedAt ?? -1) ? entry : old;
    // A backup must not discard a locally written, possibly unsubmitted answer.
    const draft = old.draft.trim()
      ? old
      : (entry.draftAt ?? -1) > (old.draftAt ?? -1)
        ? entry
        : old;
    const attempts = [
      ...new Map(
        [...old.attempts, ...entry.attempts].map((attempt) => [
          JSON.stringify(attempt),
          attempt,
        ]),
      ).values(),
    ]
      .sort((a, b) => a.at - b.at)
      .slice(-HISTORY_LIMIT);
    const feedback = Object.fromEntries(
      grades.map((grade) => [
        grade,
        Math.max(
          old.feedback[grade],
          entry.feedback[grade],
          attempts.filter((attempt) => attempt.grade === grade).length,
        ),
      ]),
    ) as Record<DialogueGrade, number>;
    merged[key] = {
      ...cleanRecord(latest),
      exposures: Math.max(old.exposures, entry.exposures),
      lastExposedAt:
        old.lastExposedAt === null && entry.lastExposedAt === null
          ? null
          : Math.max(old.lastExposedAt ?? 0, entry.lastExposedAt ?? 0),
      grade: rated.grade,
      feedbackAt: rated.feedbackAt,
      feedback,
      draft: draft.draft,
      revealed: draft.revealed,
      draftAt: draft.draftAt,
      due: scheduled.due,
      streak: scheduled.streak,
      reviewedAt: scheduled.reviewedAt,
      lapses: feedback.again,
      independentRecalls: Math.max(
        old.independentRecalls,
        entry.independentRecalls,
        attempts.filter((attempt) => attempt.independent).length,
      ),
      delayedRecalls: Math.max(
        old.delayedRecalls,
        entry.delayedRecalls,
        attempts.filter((attempt) => attempt.delayed).length,
      ),
      attempts,
    };
  }
  return merged;
}
