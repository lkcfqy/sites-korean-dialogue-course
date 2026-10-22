import type { ImmersionLesson, ImmersionSection } from "./immersion-types";
import type { DialoguePlan } from "./dialogue-plan";
import type { PlaybackItem } from "./dialogue-player";

/** Keep long natural responses within the speech endpoint's per-request limit. */
export function splitImmersionSpeech(
  items: readonly PlaybackItem[],
): PlaybackItem[] {
  return items.flatMap((item) => {
    if (item.text.length <= 240) return [item];
    const parts: string[] = [];
    let remaining = item.text.trim();
    while (remaining.length > 240) {
      const boundary = remaining.lastIndexOf(" ", 240);
      const end = boundary > 0 ? boundary : 240;
      parts.push(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trimStart();
    }
    if (remaining) parts.push(remaining);
    return parts.map((text, index) => ({
      ...item,
      id: `${item.id}:part-${index + 1}`,
      text,
    }));
  });
}

export const IMMERSION_STAGES = [
  {
    from: 1,
    to: 2,
    title: "声音与第一句话",
    goal: "听懂问候和简单确认，随对话熟悉字母、收音与音变。",
    support: "先知道情境；字幕按需打开。",
  },
  {
    from: 3,
    to: 6,
    title: "参与日常生活",
    goal: "点餐、问路、预约、说明需求；没听懂时会请求重复和确认。",
    support: "短对话反复听，逐渐只看韩语。",
  },
  {
    from: 7,
    to: 12,
    title: "讲清经历与理由",
    goal: "讲经历、解释安排、比较选择，并回答对方的追问。",
    support: "从逐句提示转向关键词，用自己的话复述。",
  },
  {
    from: 13,
    to: 18,
    title: "协商与澄清误会",
    goal: "表达拒绝与让步、澄清误会，根据关系调整说法。",
    support: "加入新条件与不同意见，练习临场调整。",
  },
  {
    from: 19,
    to: 22,
    title: "听懂观点与隐含意思",
    goal: "理解访谈和社会讨论，分辨立场、理由和保留意见。",
    support: "自然语速、不同声音；先抓完整意思，再核细节。",
  },
  {
    from: 23,
    to: 26,
    title: "复杂交流与正式表达",
    goal: "概括多方观点、回应反驳，完成清楚的口头说明与书面回复。",
    support: "逐渐撤除字幕，接触较长的陌生材料。",
  },
] as const;

export function immersionStage(week: number) {
  return (
    IMMERSION_STAGES.find((stage) => week >= stage.from && week <= stage.to) ??
    IMMERSION_STAGES.at(-1)!
  );
}

export function scenePracticeKey(section: ImmersionSection) {
  return `immersion:scene:${section.source.id}:${section.lines[0]?.id ?? section.key}`;
}

export function selectImmersionQueues(
  lesson: ImmersionLesson,
  plan: DialoguePlan,
  due = 0,
) {
  const original = lesson.sections.filter((section) => !section.review);
  const dialogues = original.filter(
    (section) =>
      section.kind === "dialogue" || section.kind === "pronunciation",
  );
  const candidates = dialogues.length ? dialogues : original;
  const needsSupport = candidates.some((section) => {
    const feedback = plan.drafts[scenePracticeKey(section)]?.immersionFeedback;
    return (
      feedback?.understanding === "retry" ||
      feedback?.expression === "supported"
    );
  });
  const capacity =
    plan.minutes < 60 ? 1 : plan.minutes < 150 ? 2 : plan.minutes < 240 ? 3 : 4;
  const count = due > 20 || needsSupport ? Math.min(capacity, 2) : capacity;
  const prioritized = [...candidates].sort((a, b) => {
    const needs = (section: ImmersionSection) => {
      const feedback =
        plan.drafts[scenePracticeKey(section)]?.immersionFeedback;
      return Number(
        feedback?.understanding === "retry" ||
          feedback?.expression === "supported",
      );
    };
    return needs(b) - needs(a);
  });
  const focus = prioritized.slice(0, count);
  const known = lesson.sections.filter(
    (section) =>
      section.review ||
      plan.drafts[scenePracticeKey(section)]?.listeningSeenAt !== undefined ||
      plan.drafts[scenePracticeKey(section)]?.oralAttemptAt !== undefined ||
      plan.drafts[scenePracticeKey(section)]?.immersionFeedback !== undefined,
  );
  const seen = new Set<string>();
  const familiar = known.filter((section) => {
    const key = scenePracticeKey(section);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const reading = original.filter((section) => section.kind === "passage");
  return {
    focus,
    familiar,
    reading,
    needsSupport,
    reviewDay: lesson.kind === "review",
    hasFamiliar: familiar.length > 0,
  };
}

export function dailyImmersionMinutes(minutes: number) {
  const total = Math.min(360, Math.max(15, Math.round(minutes)));
  const review = Math.round(total * 0.15);
  const focus = Math.round(total * 0.35);
  const listening = Math.round(total * 0.25);
  const speaking = Math.round(total * 0.2);
  return {
    total,
    review,
    focus,
    listening,
    speaking,
    reflection: total - review - focus - listening - speaking,
  };
}
