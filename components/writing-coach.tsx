"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  analyzeWriting,
  parseWritingVersions,
  writingCount,
  type WritingFeedback,
  type WritingVersion,
} from "@/lib/writing-feedback";
import { loadStudy, saveStudy } from "@/lib/study-records";

const criteria = [
  "回应了全部要求，例子和数据对应正确",
  "理由、例子与结论之间有清楚联系",
  "助词、词尾、时态和搭配已逐句检查",
  "文体统一，已在修改后独立重写",
];

type Props = {
  id: string;
  label: string;
  min: number;
  max: number;
  formal?: boolean;
  requiredNumbers?: string[];
  rubric?: "53" | "54";
};
export function WritingCoach({
  id,
  label,
  min,
  max,
  formal = false,
  requiredNumbers = [],
  rubric,
}: Props) {
  const key = `korean-writing-${id}`,
    versionsKey = `${key}-versions`,
    reviewKey = `${key}-review`;
  const [draft, setDraft] = useState(""),
    [feedback, setFeedback] = useState<WritingFeedback[] | null>(null),
    [versions, setVersions] = useState<WritingVersion[]>([]),
    [saved, setSaved] = useState(""),
    [checks, setChecks] = useState<string[]>([]),
    [notes, setNotes] = useState("");
  const [review, setReview] = useState({
    content: "",
    structure: "",
    language: "",
    teacher: false,
  });
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      try {
        setDraft(localStorage.getItem(key) || "");
        setVersions(parseWritingVersions(localStorage.getItem(versionsKey)));
        const raw = JSON.parse(localStorage.getItem(reviewKey) || "null");
        if (raw) {
          setNotes(typeof raw.notes === "string" ? raw.notes : "");
          setChecks(
            Array.isArray(raw.checks)
              ? raw.checks.filter((v: string) => criteria.includes(v))
              : [],
          );
          if (raw.review) setReview(raw.review);
        }
      } catch {
        /* Optional local storage. */
      }
    });
    return () => {
      live = false;
    };
  }, [key, versionsKey, reviewKey]);
  function write(value: string) {
    setDraft(value);
    setFeedback(null);
    try {
      localStorage.setItem(key, value);
      setSaved("草稿已保存在此浏览器");
    } catch {
      setSaved("保存失败，请复制保留文字");
    }
  }
  function saveReview(
    at: number,
    nextChecks = checks,
    nextReview = review,
    nextNotes = notes,
  ) {
    try {
      localStorage.setItem(
        reviewKey,
        JSON.stringify({
          checks: nextChecks,
          review: nextReview,
          notes: nextNotes,
          at,
        }),
      );
      setSaved("自查与评语已保存");
    } catch {
      setSaved("评语未能保存，请复制保留");
    }
  }
  function analyze() {
    const findings = analyzeWriting(draft, min, max, formal, requiredNumbers);
    setFeedback(findings);
    const old = versions.at(-1);
    if (old?.text === draft) {
      setSaved("内容未改变；继续修改后再检查");
      return;
    }
    const next = [
      ...versions,
      { text: draft, at: Date.now(), feedback: findings },
    ].slice(-5);
    setVersions(next);
    try {
      localStorage.setItem(versionsKey, JSON.stringify(next));
      setSaved("检查结果与修改版本已保存");
      const study = loadStudy();
      study.writing[id] = {
        at: Date.now(),
        revised: versions.some((v) => v.text !== draft),
        checks,
      };
      saveStudy(study);
    } catch {
      setSaved("修改记录未能保存，请复制保留文字");
    }
  }
  const limits = rubric === "53" ? [7, 7, 16] : [12, 12, 26];
  const scores = [review.content, review.structure, review.language];
  const valid = scores.every(
    (v, i) =>
      v !== "" &&
      Number.isInteger(Number(v)) &&
      Number(v) >= 0 &&
      Number(v) <= limits[i],
  );
  return (
    <section className="writing-coach" aria-label={label}>
      <label className="writing-label">
        {label} · 目标 {min}–{max} 字
        <Textarea
          lang="ko"
          rows={min >= 500 ? 14 : 8}
          maxLength={20000}
          value={draft}
          onChange={(e) => write(e.target.value)}
          placeholder="先独立写韩语，再检查和修改…"
        />
      </label>
      <div className="writing-status">
        <span>{writingCount(draft)} 字 · 含空格，不计换行（参考计数）</span>
        <span role="status">{saved}</span>
      </div>
      <Button disabled={!draft.trim()} onClick={analyze}>
        检查这篇并保留修改版本
      </Button>
      {feedback !== null && (
        <div className="writing-feedback" role="status">
          <h4>具体修改提示</h4>
          {feedback.length ? (
            feedback.map((f) => (
              <article key={f.id}>
                <strong>
                  {f.kind === "fix" ? "写法修正" : "需要你核对"} · {f.excerpt}
                </strong>
                <p>{f.suggestion}</p>
                <p>{f.why}</p>
              </article>
            ))
          ) : (
            <p>
              当前规则没有发现可定位的问题。请继续核对任务、论证和语言；这不表示全文正确。
            </p>
          )}
          <p>
            这里按有限规则检查长度、部分写法、文体线索和数据覆盖，不会自动理解论证、判断所有语法错误或给出
            TOPIK 分数。
          </p>
        </div>
      )}
      <fieldset className="writing-checks">
        <legend>写完后逐项自查</legend>
        {criteria.map((c) => (
          <label key={c}>
            <input
              type="checkbox"
              checked={checks.includes(c)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...checks, c]
                  : checks.filter((x) => x !== c);
                setChecks(next);
                saveReview(Date.now(), next);
                const study = loadStudy();
                study.writing[id] = {
                  at: Date.now(),
                  revised: versions.length > 1,
                  checks: next,
                };
                saveStudy(study);
              }}
            />
            {c}
          </label>
        ))}
      </fieldset>
      <details className="writing-history">
        <summary>对照最近 {versions.length} 个修改版本</summary>
        {versions.map((v, i) => (
          <article key={`${v.at}-${i}`}>
            <strong>
              版本 {i + 1} · {new Date(v.at).toLocaleString("zh-CN")}
            </strong>
            <p lang="ko" className="preserve-lines">
              {v.text}
            </p>
            <p>{v.feedback.length} 项规则提示</p>
            <Button variant="outline" onClick={() => write(v.text)}>
              载入此版本继续修改
            </Button>
          </article>
        ))}
        {versions.length >= 2 && (
          <p>
            对照最后两版：是否补全要求、修正具体错误，并保留原意？版本不同本身不等于质量提高。
          </p>
        )}
      </details>
      <details className="writing-review">
        <summary>记录教师评语{rubric ? `与 ${rubric} 型评分` : ""}</summary>
        <label className="writing-label">
          评语与下一次修改目标
          <Textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              saveReview(Date.now(), checks, review, e.target.value);
            }}
            maxLength={5000}
            rows={4}
          />
        </label>
        {rubric && (
          <>
            <div className="rubric-inputs">
              {["内容与任务", "展开与结构", "语言使用"].map((title, i) => (
                <label key={title}>
                  {title}（0–{limits[i]}）
                  <input
                    type="number"
                    min={0}
                    max={limits[i]}
                    value={scores[i]}
                    onChange={(e) => {
                      const next = {
                        ...review,
                        [(["content", "structure", "language"] as const)[i]]:
                          e.target.value,
                      };
                      setReview(next);
                      saveReview(Date.now(), checks, next);
                    }}
                  />
                </label>
              ))}
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={review.teacher}
                onChange={(e) => {
                  const next = { ...review, teacher: e.target.checked };
                  setReview(next);
                  saveReview(Date.now(), checks, next);
                }}
              />
              这些分数由教师按官方标准给出
            </label>
            <p>
              {valid
                ? `手工记录 ${scores.reduce((n, v) => n + Number(v), 0)} / ${rubric === "53" ? 30 : 50} · ${review.teacher ? "教师评阅记录" : "尚未确认教师评阅，仅供自查"}`
                : "按各项范围填写完整分数"}
              。网站不核验评阅者，也不生成这些分数。
            </p>
          </>
        )}
      </details>
    </section>
  );
}
