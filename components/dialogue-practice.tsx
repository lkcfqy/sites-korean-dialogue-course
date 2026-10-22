"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  dialoguePracticeTasks,
  originalDialoguePracticeLines,
} from "@/data/dialogue-practice";
import type { ImmersionLesson, ImmersionSection } from "@/lib/immersion-types";
import type { DialogueMemory } from "@/lib/dialogue-memory";
import { createPracticeDraftGuard } from "@/lib/dialogue-practice-guard";
import {
  dialoguePracticeKey,
  hasPracticeHistory,
  legacyPracticeDrafts,
} from "@/lib/dialogue-practice-keys";
import {
  dialoguePracticeVariant,
  recommendDialogueDifficulty,
  type PracticeDifficulty,
} from "@/lib/dialogue-difficulty";
import {
  DIALOGUE_PLAN_KEY,
  readDialoguePlan,
  revealDialoguePracticeReference,
  saveDialoguePracticeDraft,
  saveDialoguePracticeCompletion,
  type PracticeDraft,
  type PracticeAssessment,
  type DialoguePlan,
} from "@/lib/dialogue-plan";

export function DialoguePractice({
  lesson,
  section,
  memory,
  onRevealOriginal,
}: {
  lesson: ImmersionLesson;
  section: ImmersionSection;
  memory?: DialogueMemory;
  onRevealOriginal?: (lineIds: string[]) => void;
}) {
  const tasks = useMemo(
    () => dialoguePracticeTasks(lesson, section),
    [lesson, section],
  );
  const [taskId, setTaskId] = useState(tasks[0].id);
  const task = tasks.find((item) => item.id === taskId) ?? tasks[0];
  const draftKey = dialoguePracticeKey(section, task);
  const [draft, setDraft] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [assessment, setAssessment] = useState<
    PracticeAssessment | undefined
  >();
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState(false);
  const [record, setRecord] = useState<PracticeDraft | undefined>();
  const [recordKey, setRecordKey] = useState(draftKey);
  const [previouslyPracticed, setPreviouslyPracticed] = useState(false);
  const [importAvailable, setImportAvailable] = useState(false);
  const [lengthMode, setLengthMode] = useState<"short" | "pbt">("short");
  const [checked, setChecked] = useState<string[]>([]);
  const [reviewChecked, setReviewChecked] = useState(false);
  const [difficulty, setDifficulty] = useState<"auto" | PracticeDifficulty>(
    "auto",
  );
  const [focusIndex, setFocusIndex] = useState(0);
  const [feedbackNow, setFeedbackNow] = useState(0);
  useEffect(() => {
    let live = true;
    const update = () => {
      if (live) setFeedbackNow(Date.now());
    };
    queueMicrotask(update);
    const timer = window.setInterval(update, 60_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [memory]);
  const [oldDrafts, setOldDrafts] = useState<
    ReturnType<typeof legacyPracticeDrafts>
  >([]);
  const saveGuard = useRef(createPracticeDraftGuard());
  const detailsOpen = useRef(false);
  const practiceDetails = useRef<HTMLDetailsElement | null>(null);
  const revealOriginal = useRef(onRevealOriginal);
  useEffect(() => {
    revealOriginal.current = onRevealOriginal;
  }, [onRevealOriginal]);
  useEffect(() => {
    if (!detailsOpen.current) return;
    const ids = originalDialoguePracticeLines(task, "stimulus");
    if (ids.length) revealOriginal.current?.(ids);
  }, [task]);
  useEffect(() => {
    const recallStarted = () => {
      if (task.source !== "current") return;
      // The source answer must disappear before root clears this attempt's aid flag.
      if (practiceDetails.current) practiceDetails.current.open = false;
      detailsOpen.current = false;
      setRevealed(false);
      // Preserve written drafts and the persisted record of seeing a reference.
    };
    window.addEventListener("korean-dialogue-recall-start", recallStarted);
    return () =>
      window.removeEventListener("korean-dialogue-recall-start", recallStarted);
  }, [task.source]);
  function applyStored(plan: DialoguePlan) {
    const saved = plan.drafts[draftKey];
    setDraft(saved?.text ?? "");
    setAssessment(saved?.selfAssessment);
    setRecord(saved);
    setRecordKey(draftKey);
    setPreviouslyPracticed(hasPracticeHistory(saved));
    setOldDrafts(legacyPracticeDrafts(plan, draftKey));
    setRevealed(false);
    setChecked([]);
    setReviewChecked(false);
    setStatus(
      saved
        ? "已恢复此任务的草稿；再做时应当作复习。"
        : "先独立写韩语，再揭晓参考。",
    );
    setImportAvailable(false);
    setReady(true);
  }
  function protectChange() {
    if (saveGuard.current.canLeave()) return true;
    setStatus(
      "草稿尚未保存，已暂停切换或载入记录；请重试保存，或先复制当前文字。",
    );
    return false;
  }
  function chooseTask(id: string) {
    if (id === task.id || !protectChange()) return;
    if (!readDialoguePlan().loaded) {
      setImportAvailable(true);
      setStatus(
        "练习记录未能读取，已保留当前草稿和参考记录；请检查存储后重试。",
      );
      return;
    }
    setReady(false);
    setTaskId(id);
    setFocusIndex(0);
  }
  function restore() {
    if (!protectChange()) return;
    const result = readDialoguePlan();
    if (result.loaded) applyStored(result.plan);
    else {
      setImportAvailable(true);
      setStatus(
        "练习记录未能读取，已保留当前草稿和参考记录；请检查存储后重试。",
      );
    }
  }
  useEffect(() => {
    const leave = (event: Event) => {
      if (saveGuard.current.canLeave()) return;
      event.preventDefault();
      setStatus("草稿尚未保存，已暂停换场；请重试保存或复制当前文字。");
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (saveGuard.current.canLeave()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("korean-dialogue-leave", leave);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("korean-dialogue-leave", leave);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      const result = readDialoguePlan();
      if (!result.loaded) {
        setImportAvailable(true);
        setStatus(
          "练习记录未能读取；请检查浏览器存储后点击载入记录重试。当前文字和参考记录不会被清空。",
        );
        setReady(false);
        return;
      }
      const plan = result.plan;
      const saved = plan.drafts[draftKey];
      setDraft(saved?.text ?? "");
      setAssessment(saved?.selfAssessment);
      setRecord(saved);
      setRecordKey(draftKey);
      setPreviouslyPracticed(hasPracticeHistory(saved));
      setOldDrafts(legacyPracticeDrafts(plan, draftKey));
      setRevealed(false);
      setChecked([]);
      setReviewChecked(false);
      setStatus(
        saved
          ? "已恢复此任务的草稿；再做时应当作复习。"
          : "先独立写韩语，再揭晓参考。",
      );
      setImportAvailable(false);
      setReady(true);
    });
    const notifyUpdate = () => {
      setImportAvailable(true);
      setStatus(
        "练习记录已更新，当前正在编辑的草稿保留。可点击载入备份中的记录后继续。",
      );
    };
    const sync = (event: StorageEvent) => {
      if (event.key === DIALOGUE_PLAN_KEY || event.key === null) notifyUpdate();
    };
    const imported = (event: Event) => {
      if ((event as CustomEvent).detail?.source === "import") notifyUpdate();
    };
    window.addEventListener("storage", sync);
    window.addEventListener("korean-study-updated", imported);
    return () => {
      live = false;
      window.removeEventListener("storage", sync);
      window.removeEventListener("korean-study-updated", imported);
    };
  }, [draftKey]);
  function save(text: string, grade?: PracticeAssessment) {
    const savedGrade = variant.partial && text.trim() ? "revisit" : grade;
    const result = saveGuard.current.track(
      saveDialoguePracticeDraft(
        draftKey,
        text,
        savedGrade,
        undefined,
        Date.now(),
        grade === "revisit",
      ),
    );
    setStatus(
      result.saved
        ? variant.partial
          ? "分步草稿已保存；这次不记为完整任务独立完成。"
          : savedGrade === "independent"
            ? "已保存独立完成的自评；这不是 TOPIK 分数。"
            : savedGrade === "revisit"
              ? "已保存需再练的自评，下次先脱离参考重做。"
              : "草稿已保存在此浏览器。"
        : "草稿未能保存，请先复制到安全位置，再检查浏览器存储。",
    );
    if (result.saved) {
      setAssessment(result.plan.drafts[draftKey]?.selfAssessment);
      setRecord(result.plan.drafts[draftKey]);
      setRecordKey(draftKey);
      setOldDrafts(legacyPracticeDrafts(result.plan, draftKey));
      if (
        result.plan.drafts[draftKey]?.practiceStartedAt !== undefined ||
        result.plan.drafts[draftKey]?.firstAttempt !== undefined
      )
        setPreviouslyPracticed(true);
    }
  }
  function completeReview() {
    const result = saveGuard.current.track(
      saveDialoguePracticeCompletion(
        draftKey,
        draft,
        !variant.partial && completeCheck && reviewChecked,
      ),
    );
    if (!result.saved) {
      setStatus(
        "复练完成自评未能保存；请保留草稿并重试。这次不会解除分步建议。",
      );
      return;
    }
    setRecord(result.plan.drafts[draftKey]);
    setRecordKey(draftKey);
    setOldDrafts(legacyPracticeDrafts(result.plan, draftKey));
    setPreviouslyPracticed(true);
    setStatus(
      "已保存复练后完成全部目的的自评；任务的需提示状态已解除，句子反馈仍会影响自动建议。首次资格和句子回忆证据保持原状。",
    );
  }
  function reveal() {
    if (revealed) {
      setRevealed(false);
      return;
    }
    const result = saveGuard.current.track(
      revealDialoguePracticeReference(draftKey, draft),
    );
    if (!result.saved) {
      setStatus(
        "未能保存初稿与参考曝光记录。请先复制草稿并检查存储，再揭晓参考。",
      );
      return;
    }
    setRecord(result.plan.drafts[draftKey]);
    setRecordKey(draftKey);
    const originalIds = originalDialoguePracticeLines(task, "reference");
    if (originalIds.length) revealOriginal.current?.(originalIds);
    setRevealed(true);
    setStatus("揭晓前的草稿已保留，参考已揭晓；以后重做这道题属于复习。");
  }
  const hasAnswer = /[가-힣]/.test(draft);
  const koreanCount = (draft.match(/[가-힣]/g) ?? []).length;
  const fullWriting =
    lengthMode === "pbt" && (task.kind === "argument" || task.kind === "data");
  const recommendation = recommendDialogueDifficulty(
    section,
    memory ?? {},
    feedbackNow,
    recordKey === draftKey ? { key: draftKey, task, record } : undefined,
  );
  const chosenMode = difficulty === "auto" ? recommendation.mode : difficulty;
  const variant = dialoguePracticeVariant(
    task,
    fullWriting ? "complete" : chosenMode,
    focusIndex,
  );
  const targetLength = task.kind === "data" ? [200, 300] : [600, 700];
  const writingCount = Array.from(draft.replace(/\r?\n/g, "")).length;
  const meetsLength =
    !fullWriting ||
    (writingCount >= targetLength[0] && writingCount <= targetLength[1]);
  const completeCheck =
    !fullWriting || (meetsLength && checked.length === task.checklist.length);
  const referenceSeen = record?.referenceSeenAt !== undefined;
  return (
    <details
      className="dialogue-practice"
      ref={practiceDetails}
      onToggle={(event) => {
        detailsOpen.current = event.currentTarget.open;
        if (!detailsOpen.current) return;
        const ids = originalDialoguePracticeLines(task, "stimulus");
        if (ids.length) revealOriginal.current?.(ids);
      }}
    >
      <summary>离开字幕自己说 · 换情境练习</summary>
      <p>
        课程内回应练熟悉信息，换情境练迁移。下面的新编任务不是官方真题；首次未看参考才可自评独立完成，看过后再做属于复习。
      </p>
      {lesson.kind === "review" && (
        <p>
          周末自检：先独立做本周的另编情境，再核对三项任务。若此题已有草稿或已看参考，只作为复习；本周没有新题时不增加未见任务通过记录。
        </p>
      )}
      <div className="dialogue-practice-tabs" aria-label="表达任务">
        {tasks.map((item) => (
          <Button
            key={item.id}
            variant={item.id === task.id ? "default" : "outline"}
            aria-pressed={item.id === task.id}
            onClick={() => chooseTask(item.id)}
          >
            {item.title}
          </Button>
        ))}
      </div>
      <p>
        <strong>{task.title}</strong> ·{" "}
        {task.source === "current"
          ? "熟悉场景回忆"
          : previouslyPracticed || referenceSeen
            ? "已练过的另编情境 · 复习"
            : "首次另编情境 · 可检验迁移"}
      </p>
      <div className="dialogue-practice-difficulty">
        <label>
          本次表达难度{" "}
          <select
            aria-label="本次表达难度"
            value={difficulty}
            onChange={(event) => {
              setDifficulty(event.target.value as "auto" | PracticeDifficulty);
              setFocusIndex(0);
              setReviewChecked(false);
            }}
          >
            <option value="auto">按本场景反馈建议</option>
            <option value="supported">分步 · 先完成一个目的</option>
            <option value="complete">完整 · 回应全部目的</option>
            <option value="extend">扩展 · 加理由、条件或追问</option>
          </select>
        </label>
        <p className="dialogue-difficulty-reason">
          建议：
          {recommendation.mode === "supported"
            ? "分步"
            : recommendation.mode === "extend"
              ? "扩展"
              : "完整"}
          。{recommendation.reason}
        </p>
        <p className="word-sense-note">
          本场景最新反馈：需重练 {recommendation.evidence.again} 句、能理解自评{" "}
          {recommendation.evidence.understood} 句、独立作答自评{" "}
          {recommendation.evidence.independent} 句（其中延迟{" "}
          {recommendation.evidence.delayed} 句）、借助参考{" "}
          {recommendation.evidence.assisted} 句；到期{" "}
          {recommendation.evidence.due} 句。这些记录不验证韩语是否正确。
        </p>
        {recommendation.taskEvidence && (
          <p className="word-sense-note">
            当前任务自评：
            {recommendation.taskEvidence.status === "supported"
              ? "还需提示"
              : "复练后已完成全部目的"}
            。
            {recommendation.taskEvidence.resolvedBy ===
            "later-sentence-feedback"
              ? "之后的本场景句子反馈已支持重新试完整任务；原任务困难记录仍保留。"
              : "此任务记录单独保存，不计为句子独立或延迟回忆，也不判断韩语是否正确。"}
          </p>
        )}
        {variant.partial && (
          <>
            <div
              className="dialogue-practice-tabs dialogue-practice-steps"
              aria-label="分步交流目的"
            >
              {variant.steps.map((step, index) => (
                <Button
                  key={step}
                  variant={variant.focus === index ? "default" : "outline"}
                  aria-pressed={variant.focus === index}
                  onClick={() => setFocusIndex(index)}
                >
                  第 {index + 1} 步 · {step}
                </Button>
              ))}
            </div>
            <p>
              分步作答记录为练习；完成所有目的后切到完整练习。切换难度会保留同一草稿与参考曝光记录。
            </p>
          </>
        )}
        {chosenMode === "extend" &&
          task.source === "current" &&
          !fullWriting && (
            <Button
              variant="outline"
              onClick={() => {
                const transfer = tasks.find(
                  (item) => item.source === "new-scenario",
                );
                if (transfer) chooseTask(transfer.id);
              }}
            >
              试本周另编情境
            </Button>
          )}
        {fullWriting && (
          <p>完整PBT练习保留全部任务与篇幅要求；分步和扩展选择只作用于短练。</p>
        )}
      </div>
      <p>
        {fullWriting
          ? task.kind === "data"
            ? "根据以下教学假设，按下面三项任务完成一篇 200–300 字的数据说明。准确描述数值和比较，说明结论边界，不添加原因或真实研究出处，统一书面语体。"
            : `${task.prompt.replace(/写\s*\d+[–-]\d+\s*句的书面意见。/g, "")}按下面三项任务完成一篇 600–700 字的连贯论证文章，统一书面语体。`
          : variant.prompt}
      </p>
      {task.stimulus.length > 0 && (
        <div className="dialogue-practice-cue" lang="ko">
          {task.stimulus.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      )}
      {(task.kind === "argument" || task.kind === "data") && (
        <div className="dialogue-practice-cue">
          <label>
            写作方式{" "}
            <select
              value={lengthMode}
              onChange={(event) =>
                setLengthMode(event.target.value as "short" | "pbt")
              }
            >
              <option value="short">先做短练</option>
              <option value="pbt">TOPIK II PBT 完整字数练习</option>
            </select>
          </label>
          {fullWriting ? (
            <>
              <p>
                写 {targetLength[0]}–{targetLength[1]} 字。练习限时建议{" "}
                {task.kind === "data" ? 15 : 30}{" "}
                分钟（练习分配，不是官方单题时限）。
                {task.kind === "argument"
                  ? "扩写成问题与立场、理由与例子、反方回应、条件与建议的连贯文章。"
                  : "将数值、比较与结论边界组织成连贯书面段落。"}
              </p>
              <ol>
                {task.checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </>
          ) : (
            <p>
              当前为短练，可切换完整 PBT 数据描述 200–300 字或论证 600–700
              字。参考是较短的表达结构示例，完整作文仍需教师批改。
            </p>
          )}
          <p>
            按 PBT 方向训练。本任务为另编情境，不是官方真题，也不提供 IBT
            题型或自动考试评分。
          </p>
        </div>
      )}
      <label>
        我的韩语回应
        <textarea
          className="dialogue-practice-answer"
          lang="ko"
          rows={
            fullWriting
              ? 14
              : variant.partial
                ? 3
                : task.kind === "argument" || task.kind === "summary"
                  ? 7
                  : 5
          }
          maxLength={5000}
          value={draft}
          disabled={!ready}
          placeholder="先尝试自己的表达。不确定的地方先写下来，写完再核对。"
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            setAssessment(undefined);
            setReviewChecked(false);
            save(next);
          }}
        />
      </label>
      <p>
        {fullWriting
          ? `参考字数 ${writingCount} / ${targetLength[0]}–${targetLength[1]}（含空格和标点，不计换行；不等同正式答题纸判定）`
          : `已写 ${koreanCount} 个韩文音节（不含空格和标点）`}
        。这是编辑提示，不按此自动评分。
      </p>
      <div className="dialogue-practice-actions">
        <Button
          variant="outline"
          disabled={!ready}
          onClick={() =>
            save(
              draft,
              previouslyPracticed || referenceSeen ? undefined : assessment,
            )
          }
        >
          保存草稿
        </Button>
        <Button disabled={!hasAnswer || !ready} onClick={reveal}>
          {revealed ? "收起参考" : "保存初稿，揭晓参考"}
        </Button>
      </div>
      {!hasAnswer && <p>先写至少一句韩语，再揭晓参考。</p>}
      {revealed && (
        <div className="dialogue-practice-reference">
          <strong>
            {task.kind === "summary" ? "核对原文信息" : "一种参考表达"}
          </strong>
          {task.referenceKo.map((line, index) => (
            <p key={index} lang="ko">
              {line}
            </p>
          ))}
          <p>{task.referenceZh}</p>
          <p>
            答案可以不同。逐项核对意思和表达，不能凭与范文相似或字数达标推算考试等级。
          </p>
        </div>
      )}
      <ul className="dialogue-practice-checklist">
        {variant.checklist.map((item) => (
          <li key={item}>
            {fullWriting ? (
              <label>
                <input
                  type="checkbox"
                  checked={checked.includes(item)}
                  onChange={(event) =>
                    setChecked((current) =>
                      event.target.checked
                        ? [...current, item]
                        : current.filter((value) => value !== item),
                    )
                  }
                />{" "}
                已自行核对：{item}
              </label>
            ) : (
              item
            )}
          </li>
        ))}
      </ul>
      {fullWriting && (
        <p>
          完成检查：字数{meetsLength ? "在范围内" : "待调整"}，任务自检{" "}
          {checked.length}/{task.checklist.length}
          。这只记录自报检查，不判断韩语或论证是否正确。
        </p>
      )}
      {(previouslyPracticed || referenceSeen) && (
        <label>
          <input
            type="checkbox"
            checked={reviewChecked}
            disabled={variant.partial}
            onChange={(event) => setReviewChecked(event.target.checked)}
          />{" "}
          我已复练，并逐项核对本次完整任务的所有交流目的。这是自己的完成检查，不是正确性评分。
        </label>
      )}
      <div className="dialogue-practice-actions">
        <Button
          variant="outline"
          disabled={!hasAnswer || !ready}
          onClick={() => save(draft, "revisit")}
        >
          还需提示，再练
        </Button>
        <Button
          variant="outline"
          disabled={
            !hasAnswer ||
            !ready ||
            referenceSeen ||
            previouslyPracticed ||
            variant.partial ||
            !completeCheck
          }
          onClick={() => save(draft, "independent")}
        >
          首次独立完成，保存初稿
        </Button>
        {(previouslyPracticed || referenceSeen) && (
          <Button
            variant="outline"
            disabled={
              !hasAnswer ||
              !ready ||
              variant.partial ||
              !completeCheck ||
              !reviewChecked
            }
            onClick={completeReview}
          >
            复练后完成全部目的（自评）
          </Button>
        )}
      </div>
      {variant.partial && (
        <p>
          当前只练一个目的，不记为整道任务首次独立完成。草稿保存后，重做仍按练习处理。
        </p>
      )}
      {referenceSeen && (
        <p>参考已看过，此题以后按复习处理，收起参考或刷新不会恢复首次状态。</p>
      )}
      {record?.firstAttempt && (
        <details>
          <summary>查看保留的首次初稿</summary>
          <p lang="ko">{record.firstAttempt.text}</p>
        </details>
      )}
      {oldDrafts.length > 0 && (
        <details>
          <summary>查看保留的旧练习记录 · {oldDrafts.length} 份</summary>
          <p>
            同一原场景的记录已合并参考与已练证据。不同文字仍分别保留；恢复一份不会重新获得首次独立资格。
          </p>
          {oldDrafts.map(({ key, draft: old }, index) => (
            <div key={key}>
              <p>
                旧记录 {index + 1} ·{" "}
                {new Date(old.updatedAt).toLocaleString("zh-CN")}
              </p>
              <p lang="ko">{old.text || "（可编辑草稿为空）"}</p>
              {old.firstAttempt && (
                <details>
                  <summary>这份记录的首次初稿</summary>
                  <p lang="ko">{old.firstAttempt.text}</p>
                </details>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  if (!protectChange()) return;
                  setDraft(old.text);
                  save(old.text);
                }}
              >
                恢复这份草稿
              </Button>
            </div>
          ))}
        </details>
      )}
      {assessment && !record?.taskFeedback && (
        <p>
          保存的自评：
          {assessment === "independent" ? "初稿独立完成" : "还需提示"}
          。自评不验证语法或自然度。
        </p>
      )}
      {importAvailable && (
        <Button variant="outline" onClick={restore}>
          重新载入已保存记录
        </Button>
      )}
      <p className="dialogue-practice-status" role="status">
        {status}
      </p>
    </details>
  );
}
