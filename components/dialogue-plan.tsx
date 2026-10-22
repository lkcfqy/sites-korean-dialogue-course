"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ImmersionLesson } from "@/lib/immersion-types";
import {
  DIALOGUE_PLAN_EVENT,
  DIALOGUE_PLAN_KEY,
  defaultDialoguePlan,
  loadDialoguePlan,
  recommendDialogueWork,
  saveDialoguePlanPreferences,
  type DialogueFeedbackSummary,
  type StartingPoint,
} from "@/lib/dialogue-plan";

const startingOptions: {
  value: StartingPoint;
  label: string;
  task: string;
  cue: string;
  reference: string;
}[] = [
  {
    value: "alphabet",
    label: "字母和收音还需要帮助",
    task: "读出这个词，能把每个音节拼出来吗？",
    cue: "학교",
    reference: "학 + 교；先核对字母拼合和收音，能认字不等于能听懂整句。",
  },
  {
    value: "phrases",
    label: "能独立接日常短句",
    task: "你明天没时间、后天有时间，用韩语回答并另约一天。",
    cue: "내일 시간이 있어요?",
    reference: "내일은 시간이 없어요. 모레 만날까요?",
  },
  {
    value: "paragraphs",
    label: "能连贯解释经历和理由",
    task: "解释一次改约的原因和结果，连续说 3–5 句。",
    cue: "약속을 왜 바꿨어요? 결국 언제 만났어요?",
    reference: "检查是否有原约定 → 原因 → 新安排，不靠逐句中文提示。",
  },
  {
    value: "argument",
    label: "能读长文并回应反方",
    task: "用 4–6 句回答：人数增加是否等于课程有效？给出理由和还需补充的证据。",
    cue: "참가자가 늘었다는 사실만으로 수업의 효과를 판단할 수 있을까요?",
    reference: "区分人数与学习效果，说明样本与评价指标的限制，并提出怎样核实。",
  },
];

export function DialoguePlan({
  lesson,
  feedbackSummary,
}: {
  lesson: ImmersionLesson;
  feedbackSummary?: DialogueFeedbackSummary;
}) {
  const [preferences, setPreferences] = useState(defaultDialoguePlan);
  const [minutesInput, setMinutesInput] = useState("240");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const restore = () => {
      const next = loadDialoguePlan();
      setPreferences(next);
      setMinutesInput(String(next.minutes));
    };
    let live = true;
    queueMicrotask(() => {
      if (live) restore();
    });
    const preferencesChanged = (event: Event) => {
      if ((event as CustomEvent).detail?.kind === "preferences") restore();
    };
    const imported = (event: Event) => {
      if ((event as CustomEvent).detail?.source === "import") restore();
    };
    const sync = (event: StorageEvent) => {
      if (event.key === DIALOGUE_PLAN_KEY || event.key === null) restore();
    };
    window.addEventListener(DIALOGUE_PLAN_EVENT, preferencesChanged);
    window.addEventListener("korean-study-updated", imported);
    window.addEventListener("storage", sync);
    return () => {
      live = false;
      window.removeEventListener(DIALOGUE_PLAN_EVENT, preferencesChanged);
      window.removeEventListener("korean-study-updated", imported);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const suggestion = recommendDialogueWork(
    lesson,
    preferences,
    feedbackSummary,
  );
  const selected = startingOptions.find(
    (option) => option.value === preferences.startingPoint,
  )!;
  function save() {
    const minutes = Number(minutesInput);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 360) {
      setMessage("每天时间请填写 15–360 分钟的整数。");
      return;
    }
    const next = { minutes, startingPoint: preferences.startingPoint };
    const result = saveDialoguePlanPreferences(next);
    if (result.saved) {
      setPreferences(result.plan);
      setMessage("时间和起点已保存在此浏览器，建议已更新。");
    } else {
      setPreferences((current) => ({ ...current, ...next }));
      setMessage(
        "本次建议已调整，但未能保存。请检查浏览器存储并导出已有备份。",
      );
    }
  }
  return (
    <details className="dialogue-plan">
      <summary>按我的时间调整今天 · {suggestion.minutes} 分钟</summary>
      <p>
        先做一次简短自检，再选最接近的起点。这里给出练习量建议；自评和完成课数不产生
        TOPIK 等级。
      </p>
      <div className="dialogue-plan-controls">
        <label>
          我的当前起点
          <select
            value={preferences.startingPoint}
            onChange={(event) =>
              setPreferences((current) => ({
                ...current,
                startingPoint: event.target.value as StartingPoint,
              }))
            }
          >
            {startingOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          每天可用分钟
          <input
            type="number"
            min={15}
            max={360}
            step={15}
            value={minutesInput}
            onChange={(event) => setMinutesInput(event.target.value)}
          />
        </label>
        <Button variant="outline" onClick={save}>
          保存并调整
        </Button>
      </div>
      <div className="dialogue-plan-diagnostic">
        <strong>起点自检 · {selected.label}</strong>
        <p>{selected.task}</p>
        <p lang="ko">{selected.cue}</p>
        <details>
          <summary>做完再核对</summary>
          <p>{selected.reference}</p>
        </details>
        <p>
          如果必须看参考才能完成，请选较早的起点。即使通过也只是自检；听力、未见阅读和书面作文仍需分别核实。
        </p>
      </div>
      <div className="dialogue-plan-budget" aria-label="今日时间与句量建议">
        <p>
          <strong>{suggestion.newMinutes} 分钟 · 新场景</strong>
          <span>约 {suggestion.newLines} 条新句，按场景完整意思选择</span>
        </p>
        <p>
          <strong>
            {suggestion.reviewMinutes} 分钟 ·{" "}
            {suggestion.repeatCurrent ? "复听本课" : "回忆旧句"}
          </strong>
          <span>
            {suggestion.repeatCurrent
              ? "当前无到期旧句，复听本课或练音节；不计为间隔复习"
              : `约 ${suggestion.reviewLines} 条；先复习到期 ${suggestion.due} 条`}
          </span>
        </p>
        <p>
          <strong>{suggestion.outputMinutes} 分钟 · 独立表达</strong>
          <span>接话、复述，再做下方换情境任务</span>
        </p>
      </div>
      <p>{suggestion.reason}</p>
      {suggestion.needsFoundation && (
        <p>
          新场景时间内先练音节拼合和听音；点当前句中的韩语词，再展开“拼读当前词形”，可以核对字母与收音后回到整句。
        </p>
      )}
      <p>
        数量是按句长估算的上限，能听懂并脱离字幕表达才继续。
        {!suggestion.fullSchedule &&
          "你选择的时间少于原 4 小时日程，26 周内容可能需延长或缩减，不把日期当达标证据。"}
      </p>
      {message && (
        <p className="dialogue-practice-status" role="status">
          {message}
        </p>
      )}
    </details>
  );
}
