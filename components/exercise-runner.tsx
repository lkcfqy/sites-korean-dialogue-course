"use client";

import { useEffect, useRef, useState } from "react";
import { Ear, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Exercise } from "@/data/exercise-types";
import type { PlaybackItem } from "@/hooks/use-korean-player";
import {
  answerMatches,
  loadStudy,
  recordQuiz,
  type Skill,
} from "@/lib/study-records";
import { deadlinePassed, scoreQuiz } from "@/lib/quiz-scoring";

type Props = {
  id: string;
  week: number;
  skill: Skill;
  title: string;
  questions: Exercise[];
  playItems: (items: PlaybackItem[]) => void;
  stopAudio?: () => void;
  minutes?: number;
};
export function ExerciseRunner({
  id,
  week,
  skill,
  title,
  questions,
  playItems,
  stopAudio,
  minutes = 10,
}: Props) {
  const [bank, setBank] = useState<Exercise[]>([]);
  const [index, setIndex] = useState(0);
  const [response, setResponse] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answersRef = useRef<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [timed, setTimed] = useState(false);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [started, setStarted] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [message, setMessage] = useState("");
  const finishing = useRef(false);
  const startDates = useRef<Record<string, number>>({});
  const question = bank[index];
  useEffect(() => () => stopAudio?.(), [stopAudio]);
  const correct = bank.filter((q) =>
    answerMatches(answers[q.id] || "", q.accepted),
  ).length;
  function start(reviewOnly = false) {
    const now = Date.now();
    const study = loadStudy();
    const chosen = reviewOnly
      ? questions.filter(
          (q) => study.mistakes[q.id] && study.mistakes[q.id].corrected < 2,
        )
      : questions;
    if (!chosen.length) {
      setMessage("这组暂时没有错题；可以开始完整练习。");
      return;
    }
    // Rotate independent questions between attempts without altering their options or answer keys.
    const offset = timed ? Math.floor(now / 1000) % chosen.length : 0;
    setBank([...chosen.slice(offset), ...chosen.slice(0, offset)]);
    startDates.current = Object.fromEntries(
      chosen.map((q) => [q.id, study.mistakes[q.id]?.due || 0]),
    );
    setIndex(0);
    setResponse("");
    setAnswers({});
    answersRef.current = {};
    setChecked(false);
    setFinished(false);
    setRunning(true);
    setStarted(now);
    setRemaining(minutes * 60);
    setMessage("");
    finishing.current = false;
  }
  function finish(values: Record<string, string> = answersRef.current) {
    if (finishing.current) return;
    finishing.current = true;
    stopAudio?.();
    const now = Date.now();
    const checkedAnswers = scoreQuiz(bank, values).answers;
    setAnswers(values);
    setRunning(false);
    setFinished(true);
    const saved = recordQuiz(
      {
        id,
        week,
        skill,
        correct: checkedAnswers.filter((a) => a.correct).length,
        total: bank.length,
        seconds: Math.round((now - started) / 1000),
        at: now,
        mistakes: checkedAnswers.filter((a) => !a.correct).map((a) => a.id),
        completed: true,
        delayed: checkedAnswers.some(
          (a) =>
            startDates.current[a.id] > 0 && now >= startDates.current[a.id],
        ),
      },
      checkedAnswers,
    );
    setMessage(
      saved
        ? "结果已保存；错题次日回忆，间隔两次答对后解除回补提醒。"
        : "结果未能保存，请检查浏览器存储并保留本次结果。",
    );
  }
  useEffect(() => {
    if (!running || !timed) return;
    const timer = setInterval(() => {
      const left = Math.max(
        0,
        minutes * 60 - Math.floor((Date.now() - started) / 1000),
      );
      setRemaining(left);
      if (!left) finish();
    }, 500);
    return () => clearInterval(timer);
    // Each run owns its frozen question bank and start time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, timed, started, minutes]);
  function submit() {
    if (!question) return;
    if (timed && deadlinePassed(started, minutes, Date.now())) {
      finish();
      return;
    }
    stopAudio?.();
    const next = { ...answersRef.current, [question.id]: response };
    answersRef.current = next;
    setAnswers(next);
    setChecked(true);
    if (timed) advance(next);
  }
  function advance(values = answersRef.current) {
    stopAudio?.();
    if (index === bank.length - 1) {
      finish(values);
      return;
    }
    setIndex((old) => old + 1);
    setResponse("");
    setChecked(false);
  }
  function playAudio(text: string) {
    const chunks = text
      .split(/(?<=[.!?])\s+/)
      .flatMap(
        (sentence) => sentence.match(/.{1,200}(?:\s|$)|.{1,200}/g) || [],
      );
    playItems(
      chunks.map((text, i) => ({
        id: `${id}-q${index}-a${i}`,
        text: text.trim(),
        speaker: "A",
      })),
    );
  }
  if (!questions.length && !bank.length) return <p>本组没有可用题目。</p>;
  return (
    <section className="exercise-runner" aria-label={title}>
      <div className="exercise-heading">
        <h3>{title}</h3>
        <span>{questions.length} 题 · 课程过关线 80%</span>
      </div>
      {!running && !finished && (
        <>
          <p>
            先独立作答。练习模式逐题解析；限时模式交卷后统一核对。交卷后保存结果，离开未交卷组会重新开始。课程分数用于找薄弱项。
          </p>
          <div className="exercise-actions">
            <label className="check-label">
              <input
                type="checkbox"
                checked={timed}
                onChange={(e) => setTimed(e.target.checked)}
              />
              限时 {minutes} 分钟
            </label>
            <Button onClick={() => start()}>开始练习</Button>
            <Button variant="outline" onClick={() => start(true)}>
              回补本组错题
            </Button>
          </div>
        </>
      )}
      {running && question && (
        <>
          <div className="exercise-progress">
            <span>
              第 {index + 1} / {bank.length} 题 · {question.sourceTitle}
            </span>
            {timed && (
              <strong role="timer">
                剩余 {Math.floor(remaining / 60)}:
                {String(remaining % 60).padStart(2, "0")}
              </strong>
            )}
          </div>
          <p className="exercise-prompt">{question.prompt}</p>
          {question.audio && (
            <Button
              variant="outline"
              onClick={() => playAudio(question.audio!)}
            >
              <Ear size={18} />
              播放题目音频
            </Button>
          )}
          {question.passage && (
            <p className="exercise-passage" lang="ko">
              {question.passage}
            </p>
          )}
          {question.options ? (
            <fieldset className="exercise-options">
              <legend className="sr-only">选择答案</legend>
              {question.options.map((option) => (
                <label
                  key={option}
                  className={response === option ? "selected" : ""}
                >
                  <input
                    type="radio"
                    name={`${id}-answer`}
                    value={option}
                    checked={response === option}
                    disabled={checked}
                    onChange={() => setResponse(option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <label className="exercise-input">
              你的韩语答案
              <input
                lang="ko"
                value={response}
                disabled={checked}
                onChange={(e) => setResponse(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && response.trim()) submit();
                }}
                autoComplete="off"
                placeholder="输入听到的词或补全句子"
              />
            </label>
          )}
          {!checked && (
            <div className="exercise-actions">
              <Button disabled={!response.trim()} onClick={submit}>
                {timed
                  ? index === bank.length - 1
                    ? "提交并交卷"
                    : "提交，下一题"
                  : "核对答案"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (timed && deadlinePassed(started, minutes, Date.now())) {
                    finish();
                    return;
                  }
                  stopAudio?.();
                  const next = { ...answersRef.current, [question.id]: "" };
                  answersRef.current = next;
                  setAnswers(next);
                  setResponse("");
                  if (timed) advance(next);
                  else setChecked(true);
                }}
              >
                暂时不会
              </Button>
            </div>
          )}
          {checked && !timed && (
            <div
              className={
                answerMatches(response, question.accepted)
                  ? "answer-feedback correct"
                  : "answer-feedback incorrect"
              }
              role="status"
            >
              <strong>
                {answerMatches(response, question.accepted)
                  ? question.skill === "writing"
                    ? "匹配参考表达"
                    : "答对了"
                  : question.skill === "writing"
                    ? "未匹配，请人工核对"
                    : "需要回补"}
              </strong>
              <p>参考答案：{question.accepted.join(" / ")}</p>
              <p>{question.explanation}</p>
              {question.audio && (
                <details>
                  <summary>核对听力原文</summary>
                  <p lang="ko">{question.audio}</p>
                </details>
              )}
              {question.lessonId && (
                <a href={`/?lesson=${question.lessonId}`}>回到对应课程</a>
              )}
              <Button onClick={() => advance()}>
                {index === bank.length - 1 ? "查看本轮结果" : "下一题"}
              </Button>
            </div>
          )}
        </>
      )}
      {finished && (
        <div className="exercise-results">
          <strong>
            {skill === "writing" ? "参考表达匹配 " : ""}
            {correct} / {bank.length} ·{" "}
            {Math.round((correct / bank.length) * 100)}% ·{" "}
            {skill === "writing"
              ? "其他表达需人工判断"
              : correct / bank.length >= 0.8
                ? "本组达到课程过关线"
                : "先回补，再复测"}
          </strong>
          <p>
            {skill === "writing"
              ? "未匹配的表达进入核对提醒，不表示它一定错误。请依据语境和文体由教师确认。"
              : "未作答按未掌握记录。仅靠已练题的高分不能判断考试等级。"}
          </p>
          <details>
            <summary>查看逐题答案与解释</summary>
            {bank.map((q, i) => (
              <article key={q.id}>
                <h4>
                  {i + 1}. {q.prompt}
                </h4>
                {q.audio && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => playAudio(q.audio!)}
                    >
                      <Ear size={16} />
                      重听
                    </Button>
                    <p lang="ko">{q.audio}</p>
                  </>
                )}
                <p>你的答案：{answers[q.id] || "未作答"}</p>
                <p>参考答案：{q.accepted.join(" / ")}</p>
                <p>{q.explanation}</p>
              </article>
            ))}
          </details>
          <Button variant="outline" onClick={() => start()}>
            <RotateCcw size={16} />
            重新练习
          </Button>
        </div>
      )}
      <p className="exercise-save-message" role="status">
        {message}
      </p>
    </section>
  );
}
