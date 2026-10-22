import legacy from "./dialogue-practice-legacy.data.json";
import type { DialoguePracticeTask } from "../data/dialogue-practice";
import type { ImmersionSection } from "./immersion-types";
import type { DialoguePlan, PracticeDraft } from "./dialogue-plan";

// Frozen v12 display aliases. Future material uses sentence identities directly;
// changing curriculum order must never reinterpret these historical keys.
const oldScenes = new Map<string, string>();
for (const [identity, aliases] of legacy.scenes as [string, string[]][])
  for (const alias of aliases) oldScenes.set(alias, identity);

/** Recover frozen display keys when appended assets shift section positions. */
export function legacyDialogueSectionKey(
  lessonId: string,
  sourceId: string,
  firstLineId: string,
  tag: string,
) {
  const identity = `${sourceId}:${firstLineId}`;
  const prefix = `${lessonId}:${tag}-${sourceId}-`;
  for (const [oldIdentity, aliases] of legacy.scenes as [string, string[]][])
    if (oldIdentity === identity) {
      const alias = aliases.find((key) => key.startsWith(prefix));
      return alias?.slice(lessonId.length + 1);
    }
}

export function dialoguePracticeKey(
  section: ImmersionSection,
  task: Pick<DialoguePracticeTask, "id" | "source">,
) {
  return task.source === "new-scenario"
    ? `weekly:${task.id}`
    : `current:${section.source.id}:${section.lines[0]?.id ?? section.key}:${task.id}`;
}

function canonicalKey(key: string): string | undefined {
  if (key.startsWith("current:")) return key;
  const split = key.lastIndexOf(":");
  const task = key.slice(split + 1);
  if (task !== "current-reply" && task !== "current-summary") return;
  const scene = oldScenes.get(key.slice(0, split));
  return scene ? `current:${scene}:${task}` : undefined;
}

export function hasPracticeHistory(draft?: PracticeDraft) {
  return (
    !!draft?.text.trim() ||
    draft?.referenceSeenAt !== undefined ||
    draft?.practiceStartedAt !== undefined ||
    draft?.taskFeedback !== undefined ||
    draft?.firstAttempt !== undefined
  );
}

function mergedEvidence(chosen: PracticeDraft, records: PracticeDraft[]) {
  const seen = records.flatMap((d) =>
    d.referenceSeenAt === undefined ? [] : [d.referenceSeenAt],
  );
  const practiced = records.flatMap((d) =>
    d.practiceStartedAt === undefined ? [] : [d.practiceStartedAt],
  );
  const first =
    chosen.firstAttempt ??
    records
      .flatMap((d) => (d.firstAttempt ? [d.firstAttempt] : []))
      .sort((a, b) => a.submittedAt - b.submittedAt)[0];
  const taskFeedback = latestPracticeTaskFeedback(records);
  return {
    ...chosen,
    ...(seen.length ? { referenceSeenAt: Math.min(...seen) } : {}),
    ...(practiced.length ? { practiceStartedAt: Math.min(...practiced) } : {}),
    ...(first ? { firstAttempt: first } : {}),
    ...(taskFeedback ? { taskFeedback } : {}),
  };
}

export function latestPracticeTaskFeedback(records: readonly PracticeDraft[]) {
  return records
    .flatMap((record) => (record.taskFeedback ? [record.taskFeedback] : []))
    .sort(
      (a, b) =>
        b.at - a.at ||
        Number(b.status === "supported") - Number(a.status === "supported"),
    )[0];
}

/** Preserve every legacy answer; only add canonical records and shared evidence. */
export function canonicalizePracticeDrafts(
  drafts: DialoguePlan["drafts"],
): DialoguePlan["drafts"] {
  const result = { ...drafts };
  const grouped = new Map<string, PracticeDraft[]>();
  for (const [key, draft] of Object.entries(drafts)) {
    const canonical = canonicalKey(draft.conflictOf ?? key);
    if (!canonical) continue;
    const historical = key !== canonical && hasPracticeHistory(draft);
    const migrated = historical
      ? {
          ...draft,
          practiceStartedAt:
            draft.practiceStartedAt ??
            draft.firstAttempt?.submittedAt ??
            draft.updatedAt,
        }
      : draft;
    grouped.set(canonical, [...(grouped.get(canonical) ?? []), migrated]);
  }
  for (const [key, records] of grouped) {
    const current = drafts[key];
    const chosen =
      current ??
      records
        .filter((d) => d.text.trim())
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
      records[0];
    result[key] = mergedEvidence(chosen, records);
  }
  return result;
}

export function legacyPracticeDrafts(plan: DialoguePlan, currentKey: string) {
  return Object.entries(plan.drafts)
    .filter(
      ([key, draft]) =>
        key !== currentKey &&
        canonicalKey(draft.conflictOf ?? key) === currentKey &&
        (draft.text.trim() || draft.firstAttempt),
    )
    .map(([key, draft]) => ({ key, draft }));
}

/** Same-key backup conflicts also keep a recoverable copy, without changing IDs. */
export function retainPracticeConflict(
  drafts: DialoguePlan["drafts"],
  key: string,
  draft: PracticeDraft,
) {
  const originalKey = draft.conflictOf ?? key;
  const archived = { ...draft, conflictOf: originalKey };
  const serialized = JSON.stringify(archived);
  let hash = 2166136261;
  for (let i = 0; i < serialized.length; i++)
    hash = Math.imul(hash ^ serialized.charCodeAt(i), 16777619) >>> 0;
  const stem = `conflict:${hash.toString(16)}`;
  let target = stem;
  let suffix = 0;
  while (drafts[target]) {
    if (JSON.stringify(drafts[target]) === serialized) return;
    target = `${stem}:${++suffix}`;
  }
  drafts[target] = archived;
}
