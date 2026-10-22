"use client";
import { useEffect, useMemo, useState } from "react";
import { dialogues } from "@/data/course";
import { foundationUnits } from "@/data/foundation";
import { grammarExercises } from "@/data/grammar-course";
import { baseGrammarExercises } from "@/data/base-grammar-exercises";
import { comprehensionExercises } from "@/data/comprehension-course";
import { completionExercises } from "@/data/writing-course";
import { stages, stageExercises } from "@/data/stage-assessments";
import type { Exercise } from "@/data/exercise-types";
import { ExerciseRunner } from "@/components/exercise-runner";
import {
  loadStudy,
  STUDY_EVENT,
  type Skill,
  type MistakeRecord,
} from "@/lib/study-records";
import type { PlaybackItem } from "@/hooks/use-korean-player";
export function ReviewQueue({
  week,
  playItems,
  stopAudio,
}: {
  week: number;
  playItems: (items: PlaybackItem[]) => void;
  stopAudio: () => void;
}) {
  const [selectedWeek, setSelectedWeek] = useState(week),
    [skill, setSkill] = useState<Skill>("listening"),
    [mistakes, setMistakes] = useState<MistakeRecord[]>([]),
    [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      const params = new URLSearchParams(window.location.search);
      const w = Number(params.get("reviewWeek"));
      const s = params.get("reviewSkill");
      if (w >= 1 && w <= 26) setSelectedWeek(w);
      if (
        s &&
        ["foundation", "grammar", "listening", "reading", "writing"].includes(s)
      )
        setSkill(s as Skill);
    });
    return () => {
      live = false;
    };
  }, []);
  const index = useMemo(() => {
    const bank: Exercise[] = [];
    for (let w = 1; w <= 26; w++)
      bank.push(
        ...grammarExercises(w),
        ...baseGrammarExercises(w),
        ...comprehensionExercises(w, "listening"),
        ...comprehensionExercises(w, "reading"),
        ...completionExercises(w),
      );
    for (const u of foundationUnits)
      bank.push(
        ...u.drills.map((d) => ({
          id: d.id,
          week: 1,
          skill: "foundation" as const,
          prompt: d.prompt,
          audio: d.audio,
          accepted: d.answer,
          explanation: d.reason,
          sourceTitle: u.title,
        })),
      );
    for (const s of stages)
      bank.push(
        ...stageExercises(s, "listening"),
        ...stageExercises(s, "reading"),
      );
    for (const d of dialogues)
      for (const line of d.lines)
        bank.push({
          id: `dictation-${line.id}`,
          week: d.week,
          skill: "listening",
          prompt: "听音频，写出完整韩语句子。",
          audio: line.ko,
          accepted: [line.ko],
          explanation: `${line.ko} · ${line.zh}。核对漏词、助词与词尾。`,
          sourceTitle: d.title,
          lessonId: d.id,
        });
    return new Map(bank.map((q) => [q.id, q]));
  }, []);
  useEffect(() => {
    const update = () => {
      setMistakes(
        Object.values(loadStudy().mistakes).filter(
          (m) => m.corrected < 2 && (all || m.due <= Date.now()),
        ),
      );
    };
    update();
    window.addEventListener(STUDY_EVENT, update);
    return () => window.removeEventListener(STUDY_EVENT, update);
  }, [all]);
  const questions = mistakes
    .filter((m) => m.week === selectedWeek && m.skill === skill)
    .map((m) => {
      const q = index.get(m.id);
      return q ? { ...q, week: m.week } : undefined;
    })
    .filter((q): q is Exercise => !!q);
  return (
    <section className="review-queue">
      <h3>错题回补</h3>
      <p>
        到期题优先；包括每日听写、周练和阶段题。选择原来的周与练习类型，先回忆再核对。
      </p>
      <div className="review-filters">
        <label>
          周
          <select
            value={selectedWeek}
            onChange={(e) => setSelectedWeek(Number(e.target.value))}
          >
            {Array.from({ length: 26 }, (_, i) => (
              <option key={i} value={i + 1}>
                第 {i + 1} 周
              </option>
            ))}
          </select>
        </label>
        <label>
          练习
          <select
            value={skill}
            onChange={(e) => setSkill(e.target.value as Skill)}
          >
            {[
              ["foundation", "拼读"],
              ["grammar", "句型"],
              ["listening", "听力与听写"],
              ["reading", "阅读"],
              ["writing", "句子补全"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          也查看未到期题
        </label>
      </div>
      {
        <ExerciseRunner
          key={`${selectedWeek}-${skill}-${all}`}
          id={`review-w${selectedWeek}-${skill}`}
          week={selectedWeek}
          skill={skill}
          title="本组错题回补"
          questions={questions}
          minutes={Math.max(5, questions.length * 2)}
          playItems={playItems}
          stopAudio={stopAudio}
        />
      }
    </section>
  );
}
