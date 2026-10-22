"use client";
import { useEffect, useState } from "react";
import { stages, stageExercises } from "@/data/stage-assessments";
import { ExerciseRunner } from "@/components/exercise-runner";
import { Button } from "@/components/ui/button";
import { loadStudy, STUDY_EVENT } from "@/lib/study-records";
import type { PlaybackItem } from "@/hooks/use-korean-player";
export function StageTests({
  week,
  playItems,
  stopAudio,
}: {
  week: number;
  playItems: (items: PlaybackItem[]) => void;
  stopAudio: () => void;
}) {
  const [stageIndex, setStageIndex] = useState(
    Math.max(
      0,
      stages.findLastIndex((s) => s.week <= week),
    ),
  );
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    const update = () => {
      const result: Record<string, number> = {};
      for (const a of loadStudy().attempts)
        if (a.id.startsWith("stage-")) result[a.id] = (result[a.id] || 0) + 1;
      setCounts(result);
    };
    update();
    window.addEventListener(STUDY_EVENT, update);
    return () => window.removeEventListener(STUDY_EVENT, update);
  }, []);
  const stage = stages[stageIndex];
  return (
    <section className="stage-tests">
      <h3>阶段测验 · 独立材料</h3>
      <p>
        第 4、8、12、16、20、24、26
        周各有一组独立听读材料。首次作答用于检查迁移；重测会注明已练过。每项至少
        80%，再回补错题。每组 4 题，结果波动较大，不能推算考试等级。
      </p>
      <label className="foundation-select">
        选择阶段
        <select
          value={stageIndex}
          onChange={(e) => setStageIndex(Number(e.target.value))}
        >
          {stages.map((s, i) => (
            <option key={s.week} value={i}>
              第 {s.week} 周 · {s.title}
            </option>
          ))}
        </select>
      </label>
      {(["listening", "reading"] as const).map((skill) => (
        <div key={`${stage.week}-${skill}`}>
          <p className="stage-repeat-note">
            {counts[`stage-${stage.week}-${skill}`]
              ? `已完成 ${counts[`stage-${stage.week}-${skill}`]} 轮；此后属于重测。`
              : "尚无交卷记录；若你已经看过此材料，请按重测理解结果。"}
          </p>
          <ExerciseRunner
            key={`${stage.week}-${skill}`}
            id={`stage-${stage.week}-${skill}`}
            week={stage.week}
            skill={skill}
            title={`${skill === "listening" ? "听力" : "阅读"}阶段 ${stage.week}`}
            questions={stageExercises(stage, skill)}
            minutes={skill === "listening" ? 8 : 6}
            playItems={playItems}
            stopAudio={stopAudio}
          />
        </div>
      ))}
      <MockRecords />
    </section>
  );
}
type MockRecord = {
  id: string;
  title: string;
  listening: number;
  reading: number;
  writing: number;
  teacher: boolean;
  at: number;
};
export function parseMocks(raw: string | null): MockRecord[] {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (x) =>
              x &&
              typeof x.id === "string" &&
              typeof x.title === "string" &&
              x.title.length <= 100 &&
              [x.listening, x.reading, x.writing].every(
                (n) => Number.isInteger(n) && n >= 0 && n <= 100,
              ) &&
              typeof x.teacher === "boolean" &&
              Number.isFinite(x.at),
          )
          .slice(-20)
      : [];
  } catch {
    return [];
  }
}
function MockRecords() {
  const [records, setRecords] = useState<MockRecord[]>([]),
    [title, setTitle] = useState(""),
    [scores, setScores] = useState(["", "", ""]),
    [teacher, setTeacher] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      try {
        setRecords(parseMocks(localStorage.getItem("korean-mock-record-v1")));
      } catch {
        /* Continue. */
      }
    });
    return () => {
      live = false;
    };
  }, []);
  function save() {
    if (
      !title.trim() ||
      scores.some(
        (v) =>
          v === "" ||
          !Number.isInteger(Number(v)) ||
          Number(v) < 0 ||
          Number(v) > 100,
      )
    ) {
      setMessage("请写明套题名称，并按 0–100 分填写每项真实结果。");
      return;
    }
    const record = {
      id: crypto.randomUUID(),
      title: title.trim(),
      listening: Number(scores[0]),
      reading: Number(scores[1]),
      writing: Number(scores[2]),
      teacher,
      at: Date.now(),
    };
    const next = [...records, record].slice(-20);
    try {
      localStorage.setItem("korean-mock-record-v1", JSON.stringify(next));
      setRecords(next);
      setTitle("");
      setScores(["", "", ""]);
      setMessage("整卷记录已保存，网站不核验套题和手工分数。");
      window.dispatchEvent(new Event(STUDY_EVENT));
    } catch {
      setMessage("保存失败，请保留分数。");
    }
  }
  const lastThree = records.slice(-3),
    verified =
      lastThree.length === 3 &&
      new Set(lastThree.map((x) => x.title)).size === 3 &&
      lastThree.every(
        (x) => x.teacher && x.listening + x.reading + x.writing >= 230,
      );
  return (
    <details className="mock-records">
      <summary>官方整卷验收记录 · 纸笔 TOPIK II</summary>
      <p>
        后期使用 3 套未做过的官方材料，按听力 60 分钟、写作 50 分钟、阅读 70
        分钟完整模拟；听读核对官方答案，写作请教师按标准评阅。三项各 100 分，6
        级分数线为总分 230。这里保存你输入的结果。
      </p>
      <p>
        <a href="https://www.topik.go.kr/" target="_blank" rel="noreferrer">
          到 TOPIK 官方网站获取公开学习资料
        </a>{" "}
        ·{" "}
        <a
          href="https://www.niied.go.kr/web/niied/contents/niied_topik"
          target="_blank"
          rel="noreferrer"
        >
          官方考试结构与等级
        </a>
      </p>
      <label className="writing-label">
        套题名称／来源
        <input
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <div className="rubric-inputs">
        {["听力", "阅读", "写作"].map((name, i) => (
          <label key={name}>
            {name}（0–100）
            <input
              type="number"
              min={0}
              max={100}
              value={scores[i]}
              onChange={(e) =>
                setScores(scores.map((v, n) => (n === i ? e.target.value : v)))
              }
            />
          </label>
        ))}
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={teacher}
          onChange={(e) => setTeacher(e.target.checked)}
        />
        写作分数由教师评阅，材料首次整卷限时完成
      </label>
      <Button onClick={save}>记录这套结果</Button>
      <p role="status">{message}</p>
      {records.map((r) => (
        <article key={r.id}>
          <strong>
            {r.title} · {r.listening + r.reading + r.writing}/300
          </strong>
          <p>
            听力 {r.listening} · 阅读 {r.reading} · 写作 {r.writing} ·{" "}
            {r.teacher ? "已标记教师评阅与首次限时" : "尚未确认评阅与首次限时"}
          </p>
        </article>
      ))}
      <p>
        {verified
          ? "最近 3 套不同名称的手工记录达到目标线；用于备考判断，正式等级仍以考试成绩为准。"
          : "建议连续 3 套不同的未练整卷达到目标线，再判断备考状态。"}
        网站不根据课内测验生成 230 分或官方等级。
      </p>
    </details>
  );
}
