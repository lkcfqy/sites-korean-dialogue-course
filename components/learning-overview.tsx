"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { foundationUnits } from "@/data/foundation";
import { loadMemory } from "@/lib/learning-memory";
import {
  emptyStudy,
  loadStudy,
  STUDY_EVENT,
  weekStatus,
  type StudyRecord,
} from "@/lib/study-records";
import { exportStudy, importStudy, parseBackup } from "@/lib/study-backup";
export function LearningOverview({ week = 1 }: { week?: number }) {
  const [study, setStudy] = useState<StudyRecord>(emptyStudy),
    [words, setWords] = useState({ studied: 0, due: 0 }),
    [message, setMessage] = useState("");
  const [now, setNow] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const update = () => {
      setNow(Date.now());
      setStudy(loadStudy());
      const memory = Object.values(loadMemory());
      setWords({
        studied: memory.length,
        due: memory.filter((m) => m.due <= Date.now()).length,
      });
    };
    update();
    window.addEventListener(STUDY_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(STUDY_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  const foundation = foundationUnits.filter((u) => {
    const last = study.attempts.filter((a) => a.id === u.id).at(-1);
    return !!last && last.correct / last.total >= 0.8;
  }).length;
  const open = Object.values(study.mistakes).filter((m) => m.corrected < 2),
    due = open.filter((m) => m.due <= now);
  const skillNames = {
    grammar: "句型",
    listening: "听力",
    reading: "阅读",
    writing: "句子补全",
  };
  function download() {
    try {
      const blob = new Blob(
        [JSON.stringify(exportStudy(localStorage), null, 2)],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `korean-study-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("备份已生成：包含词汇、答题、草稿与修改记录。");
    } catch {
      setMessage("无法读取存储，请复制保留草稿。");
    }
  }
  async function restore(chosen: File) {
    try {
      if (chosen.size > 5_000_000) throw new Error("文件超过 5 MB。");
      const parsed = parseBackup(await chosen.text());
      const result = importStudy(localStorage, parsed);
      setMessage(
        `已合并 ${result.restored} 项，保留此设备已有的 ${result.preserved} 项草稿或设置。刷新页面后继续。`,
      );
      window.dispatchEvent(new Event(STUDY_EVENT));
    } catch (error) {
      setMessage(
        `未能导入：${error instanceof Error ? error.message : "请检查备份文件"}`,
      );
    } finally {
      if (file.current) file.current.value = "";
    }
  }
  return (
    <details className="learning-overview">
      <summary>
        学习记录与回补 · {due.length} 道到期错题 · {words.due} 个到期词
      </summary>
      <div className="learning-overview-body">
        <p>
          词汇已评定 {words.studied} 个；拼读最近练习过关 {foundation}/12
          步。课内过关不等于掌握全部内容或达到考试等级。
        </p>
        <div className="skill-progress">
          {(["grammar", "listening", "reading", "writing"] as const).map(
            (skill) => {
              const status = weekStatus(study, week, skill);
              return (
                <a
                  key={skill}
                  href={`/?lesson=w${String(week).padStart(2, "0")}d1&practice=${skill === "listening" || skill === "reading" ? "reading" : skill}#weekly-practice`}
                >
                  <strong>{skillNames[skill]}</strong>
                  <span>
                    {status.latest
                      ? `最近 ${status.latest.correct}/${status.latest.total} · ${status.passed ? "过关" : "需回补"}`
                      : "本周未交卷"}
                  </span>
                  <small>{status.mistakes} 道待回补</small>
                </a>
              );
            },
          )}
        </div>
        {open.length > 0 && (
          <div className="review-links">
            <h4>需要回到哪一周</h4>
            {Array.from(new Set(open.map((m) => m.week)))
              .sort((a, b) => a - b)
              .map((w) => (
                <a
                  key={w}
                  href={`/?lesson=w${String(w).padStart(2, "0")}d1&practice=tests&reviewWeek=${w}&reviewSkill=${open.find((m) => m.week === w)?.skill}#weekly-practice`}
                >
                  第 {w} 周 · {open.filter((m) => m.week === w).length} 道
                </a>
              ))}
          </div>
        )}
        <p>
          {open.length} 道尚待隔时验证的错题，{due.length}{" "}
          道已到期。使用对应练习的“回补本组错题”；看过答案后马上答对不会清除提醒，需要间隔两次正确回忆。
        </p>
        <p>
          已保留 {study.attempts.length} 次答题记录、
          {Object.keys(study.writing).length}{" "}
          项写作检查记录。写作改稿请在本周写作区对照版本。
        </p>
        <div className="exercise-actions">
          <Button variant="outline" onClick={download}>
            导出学习备份
          </Button>
          <Button variant="outline" onClick={() => file.current?.click()}>
            导入学习备份
          </Button>
          <input
            ref={file}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            aria-label="选择学习备份"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) void restore(chosen);
            }}
          />
        </div>
        <p>
          记录保存在此浏览器。换设备前请导出；导入合并较新的词汇和答题记录，并保留本机已有草稿与设置。
        </p>
        <p role="status">{message}</p>
      </div>
    </details>
  );
}
