import type { ImmersionLesson } from "./immersion-types";
import { isTimestamp } from "./study-validation";
import {
  canonicalizePracticeDrafts,
  retainPracticeConflict,
  latestPracticeTaskFeedback,
} from "./dialogue-practice-keys";

export const DIALOGUE_PLAN_KEY = "korean-dialogue-plan-v1";
export const DIALOGUE_PLAN_EVENT = "korean-dialogue-plan-updated";
// 4,354 historical display keys + 852 canonical tasks + backup conflict copies.
export const MAX_PRACTICE_DRAFTS = 12_000;
export const STARTING_POINTS = [
  "alphabet",
  "phrases",
  "paragraphs",
  "argument",
] as const;
export type StartingPoint = (typeof STARTING_POINTS)[number];
export type PracticeAssessment = "revisit" | "independent";
export type PracticeDraft = {
  text: string;
  updatedAt: number;
  selfAssessment?: PracticeAssessment;
  referenceSeenAt?: number;
  /** A declared practice attempt survives clearing the editable draft. */
  practiceStartedAt?: number;
  /** Explicit task self-report, separate from editing time and sentence memory. */
  taskFeedback?: { status: "supported" | "complete"; at: number };
  /** A preserved backup conflict remains recoverable under its original task. */
  conflictOf?: string;
  firstAttempt?: { text: string; submittedAt: number };
  /** Whole-scene self-reports, separate from sentence recall or objective scores. */
  immersionFeedback?: {
    understanding: "retry" | "gist" | "clear";
    expression: "supported" | "complete" | "flexible";
    at: number;
  };
  oralAttemptAt?: number;
  firstOralAttemptAt?: number;
  followupSeenAt?: number;
  listeningSeenAt?: number;
};
export type DialoguePlan = {
  version: 1;
  minutes: number;
  startingPoint: StartingPoint;
  updatedAt: number;
  drafts: Record<string, PracticeDraft>;
};
export type DialogueFeedbackSummary = {
  due: number;
  rated: number;
  independent: number;
  /** Latest feedback evidence; historical independence remains a separate metric. */
  currentIndependent?: number;
  repeat: number;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const validKey = (key: string) =>
  key.length > 0 &&
  key.length <= 240 &&
  !["__proto__", "prototype", "constructor"].includes(key);

export function defaultDialoguePlan(): DialoguePlan {
  return {
    version: 1,
    minutes: 240,
    startingPoint: "alphabet",
    updatedAt: 0,
    drafts: {},
  };
}

/** Reject malformed preferences and drafts before they can enter backups. */
export function parseDialoguePlan(raw: string | null): DialoguePlan | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isObject(value) ||
      value.version !== 1 ||
      !Number.isInteger(value.minutes) ||
      (value.minutes as number) < 15 ||
      (value.minutes as number) > 360 ||
      !STARTING_POINTS.includes(value.startingPoint as StartingPoint) ||
      !isTimestamp(value.updatedAt) ||
      !isObject(value.drafts) ||
      Object.keys(value.drafts).length > MAX_PRACTICE_DRAFTS
    )
      return null;
    const drafts: Record<string, PracticeDraft> = {};
    for (const [key, entry] of Object.entries(value.drafts)) {
      if (
        !validKey(key) ||
        !isObject(entry) ||
        typeof entry.text !== "string" ||
        entry.text.length > 5000 ||
        !isTimestamp(entry.updatedAt) ||
        (entry.selfAssessment !== undefined &&
          entry.selfAssessment !== "revisit" &&
          entry.selfAssessment !== "independent") ||
        (entry.referenceSeenAt !== undefined &&
          !isTimestamp(entry.referenceSeenAt)) ||
        (entry.practiceStartedAt !== undefined &&
          !isTimestamp(entry.practiceStartedAt)) ||
        [
          entry.oralAttemptAt,
          entry.firstOralAttemptAt,
          entry.followupSeenAt,
          entry.listeningSeenAt,
        ].some((stamp) => stamp !== undefined && !isTimestamp(stamp)) ||
        (entry.immersionFeedback !== undefined &&
          (!isObject(entry.immersionFeedback) ||
            !["retry", "gist", "clear"].includes(
              entry.immersionFeedback.understanding as string,
            ) ||
            !["supported", "complete", "flexible"].includes(
              entry.immersionFeedback.expression as string,
            ) ||
            !isTimestamp(entry.immersionFeedback.at))) ||
        (entry.taskFeedback !== undefined &&
          (!isObject(entry.taskFeedback) ||
            !["supported", "complete"].includes(
              entry.taskFeedback.status as string,
            ) ||
            !isTimestamp(entry.taskFeedback.at))) ||
        (entry.conflictOf !== undefined &&
          (typeof entry.conflictOf !== "string" ||
            !validKey(entry.conflictOf))) ||
        (entry.firstAttempt !== undefined &&
          (!isObject(entry.firstAttempt) ||
            typeof entry.firstAttempt.text !== "string" ||
            entry.firstAttempt.text.length > 5000 ||
            !isTimestamp(entry.firstAttempt.submittedAt)))
      )
        return null;
      drafts[key] = {
        text: entry.text,
        updatedAt: entry.updatedAt,
        ...(entry.selfAssessment
          ? { selfAssessment: entry.selfAssessment }
          : {}),
        ...(entry.referenceSeenAt !== undefined
          ? { referenceSeenAt: entry.referenceSeenAt as number }
          : {}),
        ...(entry.practiceStartedAt !== undefined ||
        entry.selfAssessment === "revisit" ||
        entry.taskFeedback !== undefined
          ? {
              practiceStartedAt: (entry.practiceStartedAt ??
                (entry.taskFeedback as PracticeDraft["taskFeedback"])?.at ??
                entry.updatedAt) as number,
            }
          : {}),
        ...(entry.taskFeedback
          ? {
              taskFeedback: entry.taskFeedback as NonNullable<
                PracticeDraft["taskFeedback"]
              >,
            }
          : entry.selfAssessment === "revisit"
            ? {
                taskFeedback: {
                  status: "supported" as const,
                  at: entry.updatedAt,
                },
              }
            : {}),
        ...(entry.firstAttempt
          ? {
              firstAttempt: entry.firstAttempt as PracticeDraft["firstAttempt"],
            }
          : {}),
        ...(entry.conflictOf ? { conflictOf: entry.conflictOf as string } : {}),
        ...(entry.immersionFeedback
          ? {
              immersionFeedback:
                entry.immersionFeedback as PracticeDraft["immersionFeedback"],
            }
          : {}),
        ...(entry.oralAttemptAt !== undefined
          ? { oralAttemptAt: entry.oralAttemptAt as number }
          : {}),
        ...(entry.firstOralAttemptAt !== undefined
          ? { firstOralAttemptAt: entry.firstOralAttemptAt as number }
          : {}),
        ...(entry.followupSeenAt !== undefined
          ? { followupSeenAt: entry.followupSeenAt as number }
          : {}),
        ...(entry.listeningSeenAt !== undefined
          ? { listeningSeenAt: entry.listeningSeenAt as number }
          : {}),
      };
    }
    const normalized = canonicalizePracticeDrafts(drafts);
    if (Object.keys(normalized).length > MAX_PRACTICE_DRAFTS) return null;
    return {
      version: 1,
      minutes: value.minutes as number,
      startingPoint: value.startingPoint as StartingPoint,
      updatedAt: value.updatedAt,
      drafts: normalized,
    };
  } catch {
    return null;
  }
}

function mergeImmersionEvidence(
  records: PracticeDraft[],
): Partial<PracticeDraft> {
  const feedback = records
    .flatMap((record) =>
      record.immersionFeedback ? [record.immersionFeedback] : [],
    )
    .sort((a, b) => b.at - a.at)[0];
  const result: Partial<PracticeDraft> = feedback
    ? { immersionFeedback: feedback }
    : {};
  for (const key of [
    "oralAttemptAt",
    "firstOralAttemptAt",
    "followupSeenAt",
    "listeningSeenAt",
  ] as const) {
    const times = records.flatMap((record) =>
      record[key] === undefined ? [] : [record[key]!],
    );
    if (times.length)
      result[key] =
        key === "oralAttemptAt" ? Math.max(...times) : Math.min(...times);
  }
  return result;
}

/** Keep a local written answer; imported answers only fill missing/empty drafts. */
export function mergeDialoguePlan(
  current: DialoguePlan,
  incoming: DialoguePlan,
): DialoguePlan {
  const drafts = { ...incoming.drafts };
  for (const [key, draft] of Object.entries(current.drafts)) {
    const imported = drafts[key];
    if (
      imported &&
      ((draft.text.trim() &&
        imported.text.trim() &&
        draft.text !== imported.text) ||
        (draft.firstAttempt &&
          imported.firstAttempt &&
          draft.firstAttempt.text !== imported.firstAttempt.text))
    )
      retainPracticeConflict(drafts, key, imported);
    const chosen = draft.text.trim() || !imported ? draft : imported;
    const seen = [draft.referenceSeenAt, imported?.referenceSeenAt].filter(
      (value): value is number => value !== undefined,
    );
    const practiced = [
      draft.practiceStartedAt,
      imported?.practiceStartedAt,
    ].filter((value): value is number => value !== undefined);
    const taskFeedback = latestPracticeTaskFeedback([
      draft,
      ...(imported ? [imported] : []),
    ]);
    drafts[key] = {
      ...chosen,
      ...mergeImmersionEvidence([draft, ...(imported ? [imported] : [])]),
      ...(seen.length ? { referenceSeenAt: Math.min(...seen) } : {}),
      ...(practiced.length
        ? { practiceStartedAt: Math.min(...practiced) }
        : {}),
      ...(draft.firstAttempt || imported?.firstAttempt
        ? { firstAttempt: draft.firstAttempt ?? imported.firstAttempt }
        : {}),
      ...(taskFeedback ? { taskFeedback } : {}),
    };
  }
  const normalized = canonicalizePracticeDrafts(drafts);
  if (Object.keys(normalized).length > MAX_PRACTICE_DRAFTS)
    throw new RangeError("练习记录过多，未合并或覆盖已有记录。");
  return { ...current, drafts: normalized };
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export function readDialoguePlan(
  storage?: Pick<Storage, "getItem">,
): { loaded: true; plan: DialoguePlan } | { loaded: false } {
  try {
    const raw = (storage ?? localStorage).getItem(DIALOGUE_PLAN_KEY);
    const plan = raw === null ? defaultDialoguePlan() : parseDialoguePlan(raw);
    return plan ? { loaded: true, plan } : { loaded: false };
  } catch {
    return { loaded: false };
  }
}
export function loadDialoguePlan(storage?: Pick<Storage, "getItem">) {
  const result = readDialoguePlan(storage);
  return result.loaded ? result.plan : defaultDialoguePlan();
}

function updateStoredPlan(
  change: (current: DialoguePlan) => DialoguePlan,
  storage?: Storage,
  kind: "preferences" | "draft" = "draft",
): { saved: true; plan: DialoguePlan } | { saved: false } {
  try {
    const target = storage ?? localStorage;
    const raw = target.getItem(DIALOGUE_PLAN_KEY);
    const current =
      raw === null ? defaultDialoguePlan() : parseDialoguePlan(raw);
    // A failed/corrupt read must not be converted into an empty overwritten record.
    if (!current) return { saved: false };
    const plan = change(current);
    if (!parseDialoguePlan(JSON.stringify(plan))) return { saved: false };
    target.setItem(DIALOGUE_PLAN_KEY, JSON.stringify(plan));
    if (typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent(DIALOGUE_PLAN_EVENT, { detail: { kind } }),
      );
    return { saved: true, plan };
  } catch {
    return { saved: false };
  }
}

export function saveDialoguePlanPreferences(
  preferences: Pick<DialoguePlan, "minutes" | "startingPoint">,
  storage?: Storage,
  now = Date.now(),
) {
  return updateStoredPlan(
    (current) => ({ ...current, ...preferences, updatedAt: now }),
    storage,
    "preferences",
  );
}

export function saveDialoguePracticeDraft(
  key: string,
  text: string,
  selfAssessment?: PracticeAssessment,
  storage?: Storage,
  now = Date.now(),
  recordTaskFeedback = true,
) {
  if (!validKey(key)) return { saved: false } as const;
  return updateStoredPlan((current) => {
    const previous = current.drafts[key];
    if (
      selfAssessment === "independent" &&
      (previous?.referenceSeenAt !== undefined ||
        previous?.practiceStartedAt !== undefined)
    )
      throw new Error("已练过或看过参考，后续只能记录复习。");
    const reported =
      selfAssessment === "revisit" && !recordTaskFeedback
        ? previous?.selfAssessment
        : (selfAssessment ?? previous?.selfAssessment);
    return {
      ...current,
      drafts: {
        ...current.drafts,
        [key]: {
          ...previous,
          text,
          updatedAt: now,
          ...(previous?.referenceSeenAt !== undefined
            ? { referenceSeenAt: previous.referenceSeenAt }
            : {}),
          ...(previous?.firstAttempt
            ? { firstAttempt: previous.firstAttempt }
            : {}),
          ...(previous?.practiceStartedAt !== undefined ||
          selfAssessment === "revisit"
            ? { practiceStartedAt: previous?.practiceStartedAt ?? now }
            : {}),
          ...(reported ? { selfAssessment: reported } : {}),
          ...(selfAssessment === "revisit" && recordTaskFeedback
            ? { taskFeedback: { status: "supported" as const, at: now } }
            : previous?.taskFeedback
              ? { taskFeedback: previous.taskFeedback }
              : {}),
          ...(selfAssessment === "independent" && !previous?.firstAttempt
            ? { firstAttempt: { text, submittedAt: now } }
            : {}),
        },
      },
    };
  }, storage);
}

/** A later complete-task self-check is review; it cannot restore first eligibility. */
export function saveDialoguePracticeCompletion(
  key: string,
  text: string,
  completeTaskChecked: boolean,
  storage?: Storage,
  now = Date.now(),
) {
  if (!validKey(key) || !/[가-힣]/.test(text) || completeTaskChecked !== true)
    return { saved: false } as const;
  return updateStoredPlan((current) => {
    const previous = current.drafts[key];
    return {
      ...current,
      drafts: {
        ...current.drafts,
        [key]: {
          ...previous,
          text,
          updatedAt: now,
          practiceStartedAt: previous?.practiceStartedAt ?? now,
          taskFeedback: { status: "complete" as const, at: now },
        },
      },
    };
  }, storage);
}

export function revealDialoguePracticeReference(
  key: string,
  text: string,
  storage?: Storage,
  now = Date.now(),
) {
  if (!validKey(key) || !/[가-힣]/.test(text)) return { saved: false } as const;
  return updateStoredPlan((current) => {
    const previous = current.drafts[key];
    return {
      ...current,
      drafts: {
        ...current.drafts,
        [key]: {
          ...previous,
          text,
          updatedAt: now,
          referenceSeenAt: previous?.referenceSeenAt ?? now,
          firstAttempt: previous?.firstAttempt ?? { text, submittedAt: now },
        },
      },
    };
  }, storage);
}

/** Oral-first tasks keep honest, explicit self-reports without invented Korean text. */
export function saveImmersionPractice(
  key: string,
  patch: {
    text?: string;
    oral?: boolean;
    reference?: boolean;
    followup?: boolean;
    listening?: boolean;
    feedback?: NonNullable<PracticeDraft["immersionFeedback"]>;
  },
  storage?: Storage,
  now = Date.now(),
) {
  if (!validKey(key)) return { saved: false } as const;
  return updateStoredPlan((current) => {
    const previous = current.drafts[key];
    const first =
      patch.oral &&
      !previous?.text.trim() &&
      previous?.practiceStartedAt === undefined &&
      previous?.referenceSeenAt === undefined;
    return {
      ...current,
      drafts: {
        ...current.drafts,
        [key]: {
          ...previous,
          text: patch.text ?? previous?.text ?? "",
          updatedAt: now,
          ...(patch.oral
            ? {
                oralAttemptAt: now,
                practiceStartedAt: previous?.practiceStartedAt ?? now,
                ...(first
                  ? { firstOralAttemptAt: previous?.firstOralAttemptAt ?? now }
                  : {}),
              }
            : {}),
          ...(patch.reference
            ? { referenceSeenAt: previous?.referenceSeenAt ?? now }
            : {}),
          ...(patch.followup
            ? { followupSeenAt: previous?.followupSeenAt ?? now }
            : {}),
          ...(patch.listening
            ? { listeningSeenAt: previous?.listeningSeenAt ?? now }
            : {}),
          ...(patch.feedback ? { immersionFeedback: patch.feedback } : {}),
        },
      },
    };
  }, storage);
}

export function recommendDialogueWork(
  lesson: ImmersionLesson,
  preferences: Pick<DialoguePlan, "minutes" | "startingPoint">,
  summary?: DialogueFeedbackSummary,
) {
  const minutes = Math.min(360, Math.max(15, Math.round(preferences.minutes)));
  const needsFoundation = preferences.startingPoint === "alphabet";
  const struggling =
    !!summary &&
    summary.rated > 0 &&
    ((summary.currentIndependent ?? summary.independent) / summary.rated <
      0.6 ||
      summary.repeat / summary.rated > 0.3);
  const due = Math.max(0, summary?.due ?? 0);
  const reviewOnly = lesson.kind === "review" || lesson.newLines === 0;
  const reviewShare = reviewOnly ? 0.65 : struggling || due > 20 ? 0.5 : 0.35;
  const outputMinutes = Math.max(4, Math.round(minutes * 0.25));
  const reviewMinutes = reviewOnly
    ? minutes - outputMinutes
    : Math.round(minutes * reviewShare);
  const newMinutes = Math.max(0, minutes - reviewMinutes - outputMinutes);
  const available = lesson.sections
    .filter((section) => !section.review)
    .flatMap((section) => section.lines);
  const averageWords = available.length
    ? available.reduce(
        (sum, line) => sum + line.ko.trim().split(/\s+/).length,
        0,
      ) / available.length
    : 8;
  // Long argument sentences need more independent recall time than short greetings.
  const minutesPerNewLine =
    Math.max(1.5, averageWords / 3) *
    (needsFoundation ? 1.5 : 1) *
    (struggling ? 1.4 : 1);
  const newLines = reviewOnly
    ? 0
    : Math.min(
        lesson.newLines,
        Math.max(
          newMinutes > 0 ? 1 : 0,
          Math.floor(newMinutes / minutesPerNewLine),
        ),
      );
  const courseReviewLines = new Set(
    lesson.sections
      .filter((section) => section.review)
      .flatMap((section) => section.lines.map((line) => line.id)),
  ).size;
  // The summary exposes a distinct due count, not IDs. Taking max avoids promising
  // an additive count when these same sentences also occur in today's course review.
  const availableReviewLines = Math.max(courseReviewLines, due);
  const reviewLines = Math.min(
    availableReviewLines,
    Math.floor(reviewMinutes / Math.max(0.75, averageWords / 6)),
  );
  const repeatCurrent = availableReviewLines === 0;
  return {
    minutes,
    newMinutes,
    reviewMinutes,
    outputMinutes,
    newLines,
    reviewLines,
    due,
    needsFoundation,
    struggling,
    reviewOnly,
    repeatCurrent,
    fullSchedule: minutes >= 240,
    reason: reviewOnly
      ? "今天是复习日，先处理到期句子，再做换情境表达。"
      : struggling
        ? "最近独立表达还不稳，先减少新句，把时间留给回忆和复述。"
        : due > 20
          ? "到期句子较多，今天先清理复习；新句只选能在时间内说清的部分。"
          : "先听懂新场景，再脱离字幕复述；不会的句子留到下一次回忆。",
  };
}
