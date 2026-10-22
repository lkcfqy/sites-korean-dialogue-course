"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import content from "@/data/immersion-experience.json";
import { PronunciationRecorder } from "@/components/pronunciation-recorder";
import {
  readDialoguePlan,
  saveImmersionPractice,
  type PracticeDraft,
} from "@/lib/dialogue-plan";
import { createPracticeDraftGuard } from "@/lib/dialogue-practice-guard";
import { scenePracticeKey } from "@/lib/immersion-experience";
import type { ImmersionSection } from "@/lib/immersion-types";
import type { PlaybackItem } from "@/lib/dialogue-player";

type Speak = (items: PlaybackItem[]) => void;

function useOralDraft(key: string) {
  const [record, setRecord] = useState<PracticeDraft>();
  const [notes, setNotes] = useState("");
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const guard = useRef(createPracticeDraftGuard());
  const load = useCallback(() => {
    if (!guard.current.canLeave()) {
      setMessage("当前笔记尚未保存，已保留在页面。请重试保存后再载入记录。");
      return;
    }
    const result = readDialoguePlan();
    if (!result.loaded) {
      setMessage("练习记录未能读取；暂不能覆盖，请检查存储后重试。");
      setReady(false);
      return;
    }
    setRecord(result.plan.drafts[key]);
    setNotes(result.plan.drafts[key]?.text ?? "");
    setReady(true);
  }, [key]);
  useEffect(() => {
    queueMicrotask(load);
    const leave = (event: Event) => {
      if (!guard.current.canLeave()) {
        event.preventDefault();
        setMessage("笔记未能保存，已暂停切换；请重试保存或复制文字。");
      }
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!guard.current.canLeave()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("korean-dialogue-leave", leave);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("storage", load);
    window.addEventListener("korean-study-updated", load);
    return () => {
      window.removeEventListener("korean-dialogue-leave", leave);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("storage", load);
      window.removeEventListener("korean-study-updated", load);
    };
  }, [load]);
  function write(patch: Parameters<typeof saveImmersionPractice>[1]) {
    if (!ready) return false;
    const result = guard.current.track(
      saveImmersionPractice(key, { text: notes, ...patch }),
    );
    if (result.saved) {
      setRecord(result.plan.drafts[key]);
      setMessage("已保存到此浏览器。");
      return true;
    }
    setMessage("未能保存，请保留当前笔记并重试；这次没有更新练习记录。");
    return false;
  }
  return {
    record,
    notes,
    ready,
    message,
    load,
    write,
    edit: (text: string) => {
      setNotes(text);
      write({ text });
    },
  };
}

function OralResponse({
  taskKey,
  goals,
  stop,
  children,
}: {
  taskKey: string;
  goals: string[];
  stop: () => void;
  children?: (controls: {
    reveal: () => boolean;
    followup: () => boolean;
    record?: PracticeDraft;
  }) => React.ReactNode;
}) {
  const saved = useOralDraft(taskKey);
  const [understanding, setUnderstanding] = useState<
    "retry" | "gist" | "clear"
  >("gist");
  const [expression, setExpression] = useState<
    "supported" | "complete" | "flexible"
  >("supported");
  useEffect(() => {
    if (saved.record?.immersionFeedback) {
      const feedback = saved.record.immersionFeedback;
      queueMicrotask(() => {
        setUnderstanding(feedback.understanding);
        setExpression(feedback.expression);
      });
    }
  }, [saved.record?.immersionFeedback]);
  return (
    <div className="oral-response">
      <ul className="communication-goals">
        {goals.map((goal) => (
          <li key={goal}>{goal}</li>
        ))}
      </ul>
      <PronunciationRecorder
        focus="先按上面的交流目的说一遍，再回听是否说清。笔记和录音都可选。"
        maxSeconds={300}
        onBeforeStart={stop}
      />
      <div className="oral-actions">
        <button
          disabled={!saved.ready}
          onClick={() => saved.write({ oral: true })}
        >
          我已口头尝试
        </button>
        <span>
          {saved.record?.referenceSeenAt !== undefined
            ? "已看过提示，继续复练"
            : saved.record?.practiceStartedAt !== undefined
              ? "已练过，继续尝试不同说法"
              : "可以先不看提示试一次"}
        </span>
      </div>
      {saved.record?.oralAttemptAt && (
        <p className="secondary-note">
          口述尝试已记录 ·{" "}
          {new Date(saved.record.oralAttemptAt).toLocaleString("zh-CN")}
        </p>
      )}
      {children?.({
        reveal: () => saved.write({ reference: true }),
        followup: () => saved.write({ followup: true }),
        record: saved.record,
      })}
      <details className="optional-notes">
        <summary>记一点笔记或整理成文字（可选）</summary>
        <textarea
          aria-label="可选的韩语表达笔记"
          value={saved.notes}
          disabled={!saved.ready}
          onChange={(event) => saved.edit(event.target.value)}
          placeholder="可以写关键词、自己的说法，或需要下次重练的地方。"
        />
        <button
          disabled={!saved.ready}
          onClick={() => saved.write({ text: saved.notes })}
        >
          保存笔记
        </button>
      </details>
      <div className="scene-feedback">
        <label>
          这段听懂了吗
          <select
            value={understanding}
            onChange={(event) =>
              setUnderstanding(event.target.value as typeof understanding)
            }
          >
            <option value="retry">还需要重听</option>
            <option value="gist">听懂主要意思</option>
            <option value="clear">意思和关键细节都清楚</option>
          </select>
        </label>
        <label>
          回应的感觉
          <select
            value={expression}
            onChange={(event) =>
              setExpression(event.target.value as typeof expression)
            }
          >
            <option value="supported">还需要提示</option>
            <option value="complete">能说清交流目的</option>
            <option value="flexible">能换说法、回应变化</option>
          </select>
        </label>
        <button
          disabled={!saved.ready || !saved.record?.oralAttemptAt}
          onClick={() =>
            saved.write({
              feedback: { understanding, expression, at: Date.now() },
            })
          }
        >
          保存本次自评
        </button>
      </div>
      <p className="secondary-note">
        自评帮助安排下一次练习，不自动评分或换算等级。
      </p>
      <p role="status">{saved.message}</p>
      {!saved.ready && <button onClick={saved.load}>重试读取记录</button>}
    </div>
  );
}

export function SceneSpeaking({
  section,
  stop,
  speak,
  onReference,
}: {
  section: ImmersionSection;
  stop: () => void;
  speak: Speak;
  onReference: (ids: string[]) => void;
}) {
  const [reference, setReference] = useState(false);
  const reading = section.kind === "passage";
  const pronunciation = section.kind === "pronunciation";
  const sentence = section.kind === "sentence";
  const goals = pronunciation
    ? [
        "听辨当前音节或词形，按声音跟读",
        "核对字母拼合、收音或本句音变",
        "回到短表达里再说一遍，比较声音与节奏",
      ]
    : sentence
      ? [
          "理解这句表达在当前情境里的意思",
          "先模仿一句，再替换成自己的信息",
          "用这句表达完成一个合适的回应",
        ]
      : reading
        ? [
            "用自己的话说明主要观点",
            "说清一个理由或关键细节",
            "补充自己的回应，或写一段真实用途的说明",
          ]
        : [
            "说明双方想完成什么、遇到了什么问题",
            "选择一个角色，用自己的话回应",
            "回应后再补一个理由、条件或追问",
          ];
  return (
    <section className="immersion-practice">
      <h2>
        {pronunciation
          ? "跟着台词听辨与拼读"
          : sentence
            ? "把这句表达用起来"
            : reading
              ? "讲清这段材料的意思"
              : "轮到你参与这段交流"}
      </h2>
      <p>{section.contextNote ?? section.scene}</p>
      <OralResponse
        taskKey={scenePracticeKey(section)}
        goals={goals}
        stop={stop}
      >
        {({ reveal }) => (
          <>
            <button
              onClick={() => {
                if (reference || reveal()) {
                  if (!reference)
                    onReference(
                      section.lines.slice(0, 4).map((line) => line.id),
                    );
                  setReference(!reference);
                }
              }}
            >
              {reference ? "收起原句提示" : "需要帮助，核对原句"}
            </button>
            {reference && (
              <div className="response-models">
                {section.lines.slice(0, 4).map((line) => (
                  <div key={line.id}>
                    <p lang="ko">{line.ko}</p>
                    <p>{line.zh}</p>
                  </div>
                ))}
                <button
                  onClick={() =>
                    speak(
                      section.lines.slice(0, 4).map((line) => ({
                        id: `reference:${line.id}`,
                        text: line.ko,
                        speaker: line.speaker,
                      })),
                    )
                  }
                >
                  听这几句
                </button>
              </div>
            )}
          </>
        )}
      </OralResponse>
    </section>
  );
}

export function WeeklyVariation({
  week,
  stop,
  speak,
}: {
  week: number;
  stop: () => void;
  speak: Speak;
}) {
  const variation = content.variations.find(
    (item) => item.week === Math.min(26, week),
  )!;
  const [models, setModels] = useState(false);
  const [followup, setFollowup] = useState(false);
  return (
    <section className="immersion-practice">
      <span className="eyebrow">第 {variation.week} 周 · 换一个情境</span>
      <h2>{variation.title}</h2>
      <p>{variation.context}</p>
      <p className="oral-task-prompt">{variation.task}</p>
      <button
        onClick={() =>
          speak([
            { id: variation.id + ":cue", text: variation.cue, speaker: "B" },
          ])
        }
      >
        听对方怎么说
      </button>
      <OralResponse
        taskKey={`immersion:${variation.id}`}
        goals={variation.goals}
        stop={stop}
      >
        {({ reveal, followup: exposeFollowup }) => (
          <>
            <div className="oral-actions">
              <button
                onClick={() => {
                  if (models || reveal()) setModels(!models);
                }}
              >
                {models ? "收起参考说法" : "核对两种参考说法"}
              </button>
              <button
                onClick={() => {
                  if (followup || exposeFollowup()) setFollowup(!followup);
                }}
              >
                {followup ? "收起新条件" : "对方又提出一个条件"}
              </button>
            </div>
            {models && (
              <div className="response-models">
                <p lang="ko">对方：{variation.cue}</p>
                {variation.responses.map((response, index) => (
                  <div key={response.ko}>
                    <p lang="ko">{response.ko}</p>
                    <p>{response.zh}</p>
                    <button
                      onClick={() =>
                        speak([
                          {
                            id: `${variation.id}:response:${index}`,
                            text: response.ko,
                            speaker: "A",
                          },
                        ])
                      }
                    >
                      听参考说法 {index + 1}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {followup && (
              <div className="followup-condition">
                <h3>现在怎样回应？</h3>
                <p>{variation.followup.task}</p>
                <button
                  onClick={() =>
                    speak([
                      {
                        id: variation.id + ":followup",
                        text: variation.followup.cue,
                        speaker: "B",
                      },
                    ])
                  }
                >
                  听这个新条件
                </button>
                <details>
                  <summary>需要时查看对方原话</summary>
                  <p lang="ko">{variation.followup.cue}</p>
                </details>
              </div>
            )}
          </>
        )}
      </OralResponse>
    </section>
  );
}

export function ImmersionCheckpoint({
  week,
  stop,
  speak,
}: {
  week: number;
  stop: () => void;
  speak: Speak;
}) {
  const next =
    content.checkpoints.find((item) => item.week >= week) ??
    content.checkpoints.at(-1)!;
  const [selected, setSelected] = useState(next.id);
  const task = content.checkpoints.find((item) => item.id === selected)!;
  const [transcript, setTranscript] = useState(false);
  const [answers, setAnswers] = useState(false);
  return (
    <section className="immersion-practice checkpoint">
      <h2>用新情境看看进步</h2>
      <p>
        先整段听，再说出理解并完成回应。练过的材料继续用于复练；周数代表课程位置。
      </p>
      <label className="checkpoint-selector">
        选择阶段回顾
        <select
          value={selected}
          onChange={(event) => {
            if (
              !window.dispatchEvent(
                new Event("korean-dialogue-leave", { cancelable: true }),
              )
            )
              return;
            stop();
            setSelected(event.target.value);
            setTranscript(false);
            setAnswers(false);
          }}
        >
          {content.checkpoints.map((item) => (
            <option key={item.id} value={item.id}>
              第 {item.week} 周 · {item.title}
            </option>
          ))}
        </select>
      </label>
      <h3>{task.title}</h3>
      <p>{task.context}</p>
      <button
        onClick={() =>
          speak(
            task.dialogue.map((line, index) => ({
              id: `${task.id}:${index}`,
              text: line.ko,
              speaker: line.speaker === "B" ? "B" : "A",
            })),
          )
        }
      >
        听完整情境
      </button>
      <ol className="checkpoint-questions">
        {task.questions.map((item) => (
          <li key={item.question}>{item.question}</li>
        ))}
      </ol>
      <p className="oral-task-prompt">{task.oralTask}</p>
      <OralResponse
        key={task.id}
        taskKey={`immersion:${task.id}`}
        goals={task.criteria}
        stop={stop}
      >
        {({ reveal, record }) => (
          <>
            <p>
              {record?.practiceStartedAt !== undefined ||
              record?.referenceSeenAt !== undefined ||
              record?.text.trim()
                ? "这份材料已有练习或提示记录，现在作为复练。"
                : "这份材料在当前浏览器尚无练习或提示记录。"}
            </p>
            <div className="oral-actions">
              <button
                onClick={() => {
                  if (transcript || reveal()) setTranscript(!transcript);
                }}
              >
                {transcript ? "收起字幕" : "核对情境字幕"}
              </button>
              <button
                onClick={() => {
                  if (answers || reveal()) setAnswers(!answers);
                }}
              >
                {answers ? "收起理解要点" : "核对理解要点"}
              </button>
            </div>
            {transcript && (
              <div className="checkpoint-transcript">
                {task.dialogue.map((line, index) => (
                  <p lang="ko" key={index}>
                    <strong>{line.speaker}</strong> {line.ko}
                  </p>
                ))}
              </div>
            )}
            {answers && (
              <ol className="checkpoint-answer-key">
                {task.questions.map((item) => (
                  <li key={item.question}>{item.answer}</li>
                ))}
              </ol>
            )}
          </>
        )}
      </OralResponse>
    </section>
  );
}
