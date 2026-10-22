"use client";
import { useEffect, useState } from "react";
import {
  DIALOGUE_PLAN_EVENT,
  defaultDialoguePlan,
  readDialoguePlan,
  saveDialoguePlanPreferences,
  type DialoguePlan,
} from "@/lib/dialogue-plan";
import {
  dailyImmersionMinutes,
  immersionStage,
  selectImmersionQueues,
} from "@/lib/immersion-experience";
import type { ImmersionLesson, ImmersionSection } from "@/lib/immersion-types";

export function useImmersionPlan() {
  const [plan, setPlan] = useState<DialoguePlan>(defaultDialoguePlan);
  const [error, setError] = useState("");
  useEffect(() => {
    const update = () => {
      const result = readDialoguePlan();
      if (result.loaded) {
        setPlan(result.plan);
        setError("");
      } else setError("学习记录未能读取；请先保留备份再检查浏览器存储。");
    };
    queueMicrotask(update);
    window.addEventListener(DIALOGUE_PLAN_EVENT, update);
    window.addEventListener("storage", update);
    window.addEventListener("korean-study-updated", update);
    return () => {
      window.removeEventListener(DIALOGUE_PLAN_EVENT, update);
      window.removeEventListener("storage", update);
      window.removeEventListener("korean-study-updated", update);
    };
  }, []);
  return { plan, error };
}

export function ImmersionDaily({
  lesson,
  plan,
  due,
  choose,
  listen,
}: {
  lesson: ImmersionLesson;
  plan: DialoguePlan;
  due: number;
  choose: (section: ImmersionSection) => void;
  listen: () => void;
}) {
  const [message, setMessage] = useState("");
  const [minutes, setMinutes] = useState(String(plan.minutes));
  useEffect(() => {
    queueMicrotask(() => setMinutes(String(plan.minutes)));
  }, [plan.minutes]);
  const queues = selectImmersionQueues(lesson, plan, due);
  const time = dailyImmersionMinutes(plan.minutes);
  const stage = immersionStage(lesson.week);
  return (
    <details className="immersion-daily-plan">
      <summary>
        今日安排 · {plan.minutes} 分钟 ·{" "}
        {queues.reviewDay
          ? "熟悉场景与换情境"
          : `${queues.focus.length} 段重点对话`}
      </summary>
      <p>{stage.goal}</p>
      <div className="daily-time-grid">
        {[
          ["重听复习", time.review],
          ["重点理解", time.focus],
          ["连续泛听", time.listening],
          ["参与回应", time.speaking],
          ["简短回顾", time.reflection],
        ].map(([label, value]) => (
          <span key={label}>
            <strong>{value} 分</strong>
            {label}
          </span>
        ))}
      </div>
      {due > 20 && (
        <p>需要复习的句子较多，今天减少新场景；先挑最影响理解的部分。</p>
      )}
      {queues.needsSupport && (
        <p>有场景反馈需要帮助，今天先少练几段，把时间留给重听和回应。</p>
      )}
      <div className="daily-scene-picks">
        {(queues.reviewDay ? queues.familiar : queues.focus).map((section) => (
          <button key={section.key} onClick={() => choose(section)}>
            {section.label}
            <small>{section.lines.length} 条台词</small>
          </button>
        ))}
      </div>
      {queues.reading.length > 0 && (
        <div className="daily-scene-picks">
          {queues.reading.slice(0, 1).map((section) => (
            <button key={section.key} onClick={() => choose(section)}>
              延伸听读与讲述 · {section.label}
            </button>
          ))}
        </div>
      )}
      <button className="text-button" onClick={listen}>
        进入连续泛听
      </button>
      <div className="daily-time-edit">
        <label>
          每天可用分钟
          <input
            type="number"
            min={15}
            max={360}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
        <button
          onClick={() => {
            const value = Number(minutes);
            if (!Number.isInteger(value) || value < 15 || value > 360) {
              setMessage("请填写 15–360 分钟的整数。");
              return;
            }
            const result = saveDialoguePlanPreferences({
              minutes: value,
              startingPoint: plan.startingPoint,
            });
            setMessage(
              result.saved
                ? "今日安排已调整。"
                : "安排未能保存，请检查浏览器存储。",
            );
          }}
        >
          调整安排
        </button>
      </div>
      <p>
        这是一份时间分配建议。按实际理解与表达推进，今天未练的场景仍可自由选择。
      </p>
      <p role="status">{message}</p>
    </details>
  );
}
