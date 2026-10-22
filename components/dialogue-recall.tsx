"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Line } from "@/data/course";
import type { ImmersionSection } from "@/lib/immersion-types";
import {
  dialogueMemorySummary,
  dialogueReviewHref,
  dueDialogueSentences,
  loadDialogueMemory,
  loadDialogueSentence,
  saveDialogueDraft,
  saveDialogueFeedback,
  type DialogueMemory,
  type DialogueSource,
} from "@/lib/dialogue-memory";

const LEAVE_EVENT = "korean-dialogue-leave";

export function canLeaveDialogue() {
  return window.dispatchEvent(new Event(LEAVE_EVENT, { cancelable: true }));
}

export function sentenceSource(
  section: ImmersionSection,
  line: Line,
): DialogueSource {
  return { lessonId: section.source.id, sectionKey: null, lineId: line.id };
}

export function useDialogueMemory() {
  const [memory, setMemory] = useState<DialogueMemory>({});
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    let debounce: number | undefined;
    let revision = 0;
    const update = async () => {
      const current = ++revision;
      try {
        const saved = await loadDialogueMemory();
        if (!live || current !== revision) return;
        setMemory(saved);
        setNow(Date.now());
        setError("");
      } catch {
        if (live && current === revision)
          setError("句子记录未能读取；请保留备份，检查浏览器存储后重试。");
      }
    };
    const schedule = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void update(), 300);
    };
    queueMicrotask(() => void update());
    window.addEventListener("korean-study-updated", schedule);
    window.addEventListener("storage", schedule);
    const timer = window.setInterval(() => void update(), 60_000);
    return () => {
      live = false;
      window.clearTimeout(debounce);
      window.removeEventListener("korean-study-updated", schedule);
      window.removeEventListener("storage", schedule);
      window.clearInterval(timer);
    };
  }, []);
  return {
    memory,
    error,
    summary: useMemo(() => dialogueMemorySummary(memory, now), [memory, now]),
    queue: useMemo(() => dueDialogueSentences(memory, now, 8), [memory, now]),
  };
}

export function DialogueRecall({
  section,
  line,
  masked,
  assisted,
  hide,
  reveal,
  pause,
}: {
  section: ImmersionSection;
  line: Line;
  masked: boolean;
  assisted: boolean;
  hide: () => void;
  reveal: () => void;
  pause: () => void;
}) {
  const source = sentenceSource(section, line);
  const [draft, setDraft] = useState("");
  const [attempting, setAttempting] = useState(false);
  const [message, setMessage] = useState("");
  const [savedDue, setSavedDue] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const unsaved = useRef(false);
  const retrySave = useRef<() => Promise<boolean>>(async () => true);
  const lastSave = useRef<Promise<boolean>>(Promise.resolve(true));
  const saveRevision = useRef(0);
  const context = useRef({ attempting, masked, assisted });
  useEffect(() => {
    context.current = { attempting, masked, assisted };
  }, [attempting, masked, assisted]);
  useEffect(() => {
    let live = true;
    queueMicrotask(async () => {
      if (!live) return;
      try {
        const record = await loadDialogueSentence(source);
        if (!live) return;
        setDraft(record?.draft ?? "");
        setSavedDue(record?.due ?? null);
        setReady(true);
      } catch {
        if (live)
          setMessage("本句记录未能读取，暂不能覆盖；请检查存储后刷新重试。");
      }
    });
    return () => {
      live = false;
    };
    // The component is keyed by the canonical source sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.lessonId, source.lineId]);

  useEffect(() => {
    const leave = (event: Event) => {
      if (!unsaved.current) return;
      event.preventDefault();
      setMessage("草稿尚未保存，已暂停切换；请稍后重试或复制当前文字。");
      void lastSave.current.then((saved) => {
        if (!saved) void retrySave.current();
      });
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!unsaved.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener(LEAVE_EVENT, leave);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener(LEAVE_EVENT, leave);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);

  function saveDraft(value = draft, automatic = false): Promise<boolean> {
    const current = ++saveRevision.current;
    unsaved.current = true;
    setSaving(true);
    const job = (async () => {
      const { attempting, masked, assisted } = context.current;
      const result = await saveDialogueDraft(source, {
        draft: value,
        revealed: !attempting || !masked || assisted,
      });
      if (current === saveRevision.current) {
        unsaved.current = !result.saved;
        setSaving(false);
        setMessage(
          result.saved
            ? automatic
              ? "草稿已自动保存；尚未提交反馈。"
              : "本句作答已保存。"
            : "作答未能保存；请复制当前文字后重试。已暂停切换，以保护草稿。",
        );
      }
      return result.saved;
    })();
    lastSave.current = job;
    return job;
  }
  useEffect(() => {
    retrySave.current = () => saveDraft();
  });
  async function rate(grade: "again" | "understood" | "produced") {
    pause();
    setSubmitting(true);
    if (!(await lastSave.current)) {
      setSubmitting(false);
      setMessage("草稿尚未保存，请先重试保存作答，再提交反馈。");
      return;
    }
    setSaving(true);
    unsaved.current = true;
    const { attempting, masked, assisted } = context.current;
    const result = await saveDialogueFeedback(source, {
      grade,
      draft,
      revealed: !attempting || !masked || assisted,
    });
    setSaving(false);
    setSubmitting(false);
    if (!result.saved) {
      unsaved.current = false;
      setMessage("反馈未能保存，复习安排未更新。请重试。");
      return;
    }
    setSavedDue(result.next.due);
    unsaved.current = false;
    setMessage(
      grade === "again"
        ? "已安排较早重听这句。"
        : grade === "understood"
          ? "已记录理解自评，并安排复习。"
          : "已记录表达自评；作答是否正确仍需对照语境核查。",
    );
    setAttempting(false);
    reveal();
  }
  return (
    <details className="dialogue-recall">
      <summary>回忆与反馈{savedDue ? " · 已安排复习" : ""}</summary>
      <p>
        先听或理解，再遮住韩文复述。口头表达可自评；本次不看原句、不重听原音并保存韩语作答时，才记录独立作答证据。
      </p>
      <div className="recall-actions">
        <button
          type="button"
          disabled={!ready || saving}
          onClick={async () => {
            pause();
            if (unsaved.current && !(await saveDraft())) return;
            setDraft("");
            setAttempting(true);
            setMessage("");
            hide();
          }}
        >
          遮住韩文，重新回忆
        </button>
        {attempting && (
          <button type="button" onClick={reveal}>
            揭晓原句，对照表达
          </button>
        )}
      </div>
      <label>
        本句韩语作答
        <textarea
          lang="ko"
          disabled={!ready || submitting}
          value={draft}
          maxLength={4000}
          onChange={(event) => {
            pause();
            setDraft(event.target.value);
            void saveDraft(event.target.value, true);
          }}
          placeholder="可先口头复述，再写出自己的韩语。"
        />
      </label>
      <div className="recall-actions">
        <button
          type="button"
          disabled={!ready || saving}
          onClick={() => void saveDraft()}
        >
          保存本句作答
        </button>
        <button
          type="button"
          disabled={!ready || saving}
          onClick={() => void rate("again")}
        >
          没听懂／需重练
        </button>
        <button
          type="button"
          disabled={!ready || saving}
          onClick={() => void rate("understood")}
        >
          能理解
        </button>
        <button
          type="button"
          disabled={!ready || saving}
          onClick={() => void rate("produced")}
        >
          能独立表达
        </button>
      </div>
      <p className="recall-status" role="status">
        {saving
          ? "正在保存本句作答…"
          : !ready && !message
            ? "正在读取本句记录…"
            : message}
      </p>
      {savedDue && (
        <small>
          下次复习：{new Date(savedDue).toLocaleString("zh-CN")} ·
          播放和揭晓不会计为掌握
        </small>
      )}
    </details>
  );
}

export function DialogueDueReview({
  queue,
}: {
  queue: ReturnType<typeof dueDialogueSentences>;
}) {
  return (
    <details className="dialogue-due-review" open={queue.total > 0}>
      <summary>薄弱句与到期复习 · {queue.total} 句</summary>
      {queue.total === 0 ? (
        <p>
          对句子提交反馈后，会按记忆表现安排复习。今天仍可学习课程中的复习场景。
        </p>
      ) : (
        <>
          <p>先回到原句遮住韩文回忆，再记录反馈。未完成的到期句会保留。</p>
          <div className="due-sentence-list">
            {queue.items.map((item) => (
              <a key={item.key} href={dialogueReviewHref(item)}>
                <span>
                  第 {Number(item.lessonId.slice(1, 3))} 周 · 第{" "}
                  {item.lessonId.at(-1)} 天
                </span>
                <span>
                  {item.grade === "again" ? "需重练" : "到期回忆"} · 回到原句
                </span>
              </a>
            ))}
          </div>
          {queue.remaining > 0 && (
            <small>
              另外 {queue.remaining} 句仍在到期队列；完成前面的句子后继续。
            </small>
          )}
        </>
      )}
    </details>
  );
}
