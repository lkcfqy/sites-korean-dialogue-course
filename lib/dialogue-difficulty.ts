import type { DialoguePracticeTask } from "../data/dialogue-practice";
import type { ImmersionSection } from "./immersion-types";
import type { PracticeDraft } from "./dialogue-plan";
import { dialoguePracticeKey } from "./dialogue-practice-keys";
import {
  dialogueLineKey,
  isDialogueSentenceMemory,
  type DialogueMemory,
} from "./dialogue-memory";

export const PRACTICE_DIFFICULTIES = [
  "supported",
  "complete",
  "extend",
] as const;
export type PracticeDifficulty = (typeof PRACTICE_DIFFICULTIES)[number];

/** Current-scene evidence only. Exposure and historical successes are not ability. */
export function recommendDialogueDifficulty(
  section: ImmersionSection,
  memory: DialogueMemory,
  now = Date.now(),
  practice?: {
    key: string;
    task: Pick<DialoguePracticeTask, "id" | "source">;
    record?: PracticeDraft;
  },
) {
  const keys = [
    ...new Set(
      section.lines.map((line) =>
        dialogueLineKey({
          lessonId: section.source.id,
          sectionKey: null,
          lineId: line.id,
        }),
      ),
    ),
  ];
  const records = keys.flatMap((key) => {
    const record = memory[key];
    return record &&
      isDialogueSentenceMemory(record) &&
      dialogueLineKey(record) === key
      ? [record]
      : [];
  });
  const evidence = {
    rated: 0,
    again: 0,
    understood: 0,
    assisted: 0,
    independent: 0,
    delayed: 0,
    due: 0,
  };
  for (const record of records) {
    if (record.due !== null && record.due <= now) evidence.due++;
    if (record.grade === null) continue;
    evidence.rated++;
    if (record.grade === "again") evidence.again++;
    if (record.grade === "understood") evidence.understood++;
    const latest = record.attempts.at(-1);
    if (
      !latest ||
      latest.at !== record.feedbackAt ||
      latest.grade !== record.grade
    )
      continue;
    if (latest.revealed) evidence.assisted++;
    if (latest.independent) evidence.independent++;
    if (latest.delayed) evidence.delayed++;
  }
  let mode: PracticeDifficulty = "complete";
  let reason = "本场景证据不足，先试完整回应；遇到困难可手动选择分步。";
  if (
    evidence.again > 0 ||
    (evidence.rated >= 2 && evidence.independent / evidence.rated < 0.5) ||
    (evidence.assisted > 0 && evidence.independent === 0)
  ) {
    mode = "supported";
    reason =
      "本场景最近的反馈还不足以支持完整独立输出，先完成一个交流目的，再补其余信息。";
  } else if (evidence.independent >= 2) {
    if (
      evidence.delayed >= 1 &&
      evidence.due === 0 &&
      evidence.assisted === 0
    ) {
      mode = "extend";
      reason =
        "本场景至少两句最近有独立作答自评，其中包含一次延迟回忆，可试增加理由、条件或另编情境。";
    } else {
      reason =
        evidence.due > 0
          ? "本场景已有独立作答，但仍有到期句子；先做完整回应和复习。"
          : "本场景最近已有独立作答，先完成全部目的；延迟回忆证据仍不足，不据此提高能力评级。";
    }
  }
  const feedback =
    practice && practice.key === dialoguePracticeKey(section, practice.task)
      ? practice.record?.taskFeedback
      : undefined;
  let taskEvidence: {
    status: "supported" | "complete";
    at: number;
    resolvedBy: "none" | "task-self-check" | "later-sentence-feedback";
  } | null = null;
  if (feedback) {
    const laterIndependent =
      practice?.task.source === "current"
        ? records.filter((record) => {
            const latest = record.attempts.at(-1);
            return (
              latest &&
              latest.at === record.feedbackAt &&
              latest.grade === record.grade &&
              latest.at > feedback.at &&
              latest.independent
            );
          }).length
        : 0;
    const laterSentenceEvidence =
      laterIndependent >= 2 &&
      evidence.again === 0 &&
      evidence.understood === 0 &&
      evidence.assisted === 0 &&
      evidence.due === 0;
    taskEvidence = {
      ...feedback,
      resolvedBy:
        feedback.status === "complete"
          ? "task-self-check"
          : laterSentenceEvidence
            ? "later-sentence-feedback"
            : "none",
    };
    if (feedback.status === "supported") {
      mode = laterSentenceEvidence ? "complete" : "supported";
      reason = laterSentenceEvidence
        ? "此任务曾自评需要提示；本场景至少两句在之后有新的独立作答自评且无薄弱或到期项，可重新试完整任务。这没有改写任务自评，也不证明表达正确。"
        : "你在当前任务中保存了「还需提示」的自评，先拆成一个交流目的。它是任务困难反馈，不计入句子准确率、独立句数或延迟回忆。";
    } else if (mode !== "supported") {
      // A complete-task self-check alone can restore complete work, never extension.
      if (!laterSentenceEvidence) mode = "complete";
      reason =
        mode === "extend"
          ? reason
          : "你自评复练后已完成全部交流目的，可重新试完整任务；这是复练记录，不是首次独立完成、延迟回忆或正确性评分。";
    }
  }
  return { mode, reason, evidence, taskEvidence };
}

/** Reduced communicative output, not merely a smaller sentence quota. */
export function dialoguePracticeVariant(
  task: DialoguePracticeTask,
  mode: PracticeDifficulty,
  focusIndex = 0,
) {
  const steps = task.supportedGoals?.length
    ? task.supportedGoals
    : task.kind === "summary"
      ? ["说清主要问题或场景", "补充一条原文依据", "说明结果或结论的边界"]
      : task.kind === "reply"
        ? ["回应对方当前的问题或意图"]
        : task.checklist;
  const focus = Math.min(
    Math.max(0, focusIndex),
    Math.max(0, steps.length - 1),
  );
  if (mode === "supported") {
    return {
      prompt: `这一步只完成：${steps[focus]}。用1–2句韩语表达；${task.kind === "data" ? "数值必须来自下方材料，不猜测原因。" : "信息以当前场景为准，暂不要求完成其他目的。"}完成后再选下一步。`,
      checklist: [steps[focus]],
      steps,
      focus,
      partial: true,
    };
  }
  const extension =
    task.extensionGoal ??
    (task.kind === "data"
      ? "完成全部要求后，再补一句说明这些数据不能证明什么；不添加材料外的数值或原因。"
      : task.kind === "summary"
        ? "完成摘要后，再说明一种原文观点成立需要什么条件；区分原文信息和你提出的条件。"
        : task.kind === "argument"
          ? "完成原任务后，再写一个可能的反对意见，并用条件或证据边界回应。"
          : "完成原回应后，再加入一个你自己的理由或可接受的条件，并向对方提出一个相关追问。");
  return {
    prompt: mode === "extend" ? `${task.prompt} ${extension}` : task.prompt,
    checklist:
      mode === "extend" ? [...task.checklist, extension] : task.checklist,
    steps,
    focus,
    partial: false,
  };
}
