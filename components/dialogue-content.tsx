"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Line } from "@/data/course";
import type { ImmersionSection } from "@/lib/immersion-types";
import { DialogueRecall, sentenceSource } from "@/components/dialogue-recall";
import { dialogueLineKey } from "@/lib/dialogue-memory";
import { DialoguePronunciation } from "@/components/dialogue-pronunciation";
import { needsDialogueResponse } from "@/lib/dialogue-study";
import { VocabularyUsage } from "@/components/vocabulary-usage";

type Props = {
  section: ImmersionSection;
  continuous: boolean;
  display: string;
  revealed: Set<string>;
  masked: Set<string>;
  assisted: Set<string>;
  practiceRole: "both" | "A" | "B";
  activeId: string | null;
  foundLine: string | null;
  resumeLine?: string | null;
  ref?: Ref<HTMLElement>;
  reveal: (ids: string[]) => void;
  hide: (id: string) => void;
  expose: (line: Line) => void;
  pause: () => void;
  play: (line: Line) => void;
  playWord: (text: string, id: string) => void;
};

function InlineUsage({
  word,
  lineId,
  playWord,
}: {
  word: string;
  lineId: string;
  playWord: Props["playWord"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="inline-word-usage">
      <button
        className="word-lookup-link"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span lang="ko">{word}</span> · {open ? "收起搭配" : "查看词义与搭配"}
      </button>
      {open && (
        <VocabularyUsage
          word={word}
          onSpeak={(text) => playWord(text, lineId)}
        />
      )}
    </div>
  );
}

function Words({
  line,
  playWord,
}: {
  line: Line;
  playWord: Props["playWord"];
}) {
  const phrases = line.words.flatMap(
    (word) => word.annotation?.linkedSpans ?? [],
  );
  return (
    <>
      {line.words.map((word, index) => {
        const lemmas =
          word.lemmas ?? word.base?.split(" · ").filter(Boolean) ?? [];
        const uncertain = word.annotation?.status === "ambiguous";
        const wordPhrases = phrases.filter(
          (phrase) => phrase.wordStart <= index && index < phrase.wordEnd,
        );
        const candidates = uncertain
          ? (word.annotation?.candidates ?? [])
          : [...new Set([...lemmas, ...wordPhrases.map((p) => p.headword)])];
        return (
          <span className="eojeol" key={index}>
            {lemmas.length || uncertain || /[가-힣]/.test(word.text) ? (
              <Popover>
                <PopoverTrigger
                  className="word-button"
                  aria-label={`${word.text}，${uncertain ? "词义待核对" : lemmas.length ? "查看词条" : "查看拼读"}`}
                >
                  {word.text}
                </PopoverTrigger>
                <PopoverContent className="word-popover" collisionPadding={16}>
                  {word.contextSense && (
                    <div className="word-context-sense">
                      <strong>本句中的意思</strong>
                      <p className="popover-meaning">
                        {word.contextSense.headword}：
                        {word.contextSense.meaning}
                      </p>
                      <p className="word-form-note">
                        当前词形：{word.contextSense.morphologyNote}
                      </p>
                      {word.contextSense.otherSenses.length > 0 && (
                        <p className="word-sense-note">
                          其他常见意思：
                          {word.contextSense.otherSenses.join("；")}
                        </p>
                      )}
                    </div>
                  )}
                  {uncertain ? (
                    <>
                      <strong>本处词义需结合整句判断</strong>
                      <p className="popover-meaning">
                        这个词形可能对应不同词条，暂不指定本句用义。请对照整句译文和词典例句。
                      </p>
                    </>
                  ) : lemmas.length ? (
                    <>
                      <strong className="popover-korean" lang="ko">
                        {lemmas.join(" · ")}
                      </strong>
                      <p className="popover-meaning">{word.meaning}</p>
                      <p className="word-sense-note">
                        {word.contextSense
                          ? "词条的一般释义；本句用义见上方。"
                          : word.annotation?.linkedSpans?.length
                            ? "词条的一般释义；本句完整词组的用义与组成范围见下方。"
                            : word.annotation?.rule ===
                                  "reviewed-exact-form-alias" ||
                                word.annotation?.rule ===
                                  "reviewed-course-listening-context"
                              ? "已核对本句词形与词条的关系，说明见下方；其他用义仍需分别判断。"
                              : "本处尚未单独核定语境义；请结合整句译文判断，以上为一般词典释义。"}
                      </p>
                    </>
                  ) : (
                    <>
                      <strong className="popover-korean" lang="ko">
                        {word.text}
                      </strong>
                      <p className="word-sense-note">
                        本词形暂未可靠链接词条，请结合整句译文理解。
                      </p>
                    </>
                  )}
                  {word.note && (
                    <p className="word-form-note">本词形提示：{word.note}</p>
                  )}
                  <DialoguePronunciation text={word.text} />
                  {wordPhrases.map((phrase) => (
                    <div className="word-phrase" key={phrase.headword}>
                      <strong>本句词组</strong>
                      <p lang="ko">{phrase.surface}</p>
                      <p>
                        {phrase.headword}：{phrase.meaning}
                      </p>
                      <Button
                        className="word-audio"
                        onClick={() => playWord(phrase.surface, line.id)}
                      >
                        <Volume2 size={16} />
                        听这个词组
                      </Button>
                    </div>
                  ))}
                  {candidates.map((lemma) => (
                    <InlineUsage
                      key={lemma}
                      word={lemma}
                      lineId={line.id}
                      playWord={playWord}
                    />
                  ))}
                  <Button
                    className="word-audio"
                    onClick={() => playWord(word.text, line.id)}
                  >
                    <Volume2 size={16} />
                    听这个词形
                  </Button>
                </PopoverContent>
              </Popover>
            ) : (
              <span>{word.text}</span>
            )}
            {index < line.words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </>
  );
}

function Pattern({ line }: { line: Line }) {
  return line.pattern ? (
    <details className="sentence-pattern">
      <summary>本句表达 · {line.pattern.form}</summary>
      <p>{line.pattern.explanation}</p>
      <p>{line.pattern.caution}</p>
    </details>
  ) : null;
}

export function DialogueContent({
  section,
  continuous,
  display,
  revealed,
  masked,
  assisted,
  practiceRole,
  activeId,
  foundLine,
  resumeLine,
  ref,
  reveal,
  hide,
  expose,
  pause,
  play,
  playWord,
}: Props) {
  const visibleKo = (line: Line) =>
    !masked.has(line.id) &&
    (!needsDialogueResponse(section, line, practiceRole) ||
      revealed.has(line.id)) &&
    (display === "both" || display === "ko" || revealed.has(line.id));
  const visibleZh = (line: Line) =>
    display === "both" || display === "zh" || revealed.has(line.id);
  const observed = useRef(new Set<string>());
  const exposureCallback = useRef(expose);
  const container = useRef<HTMLElement | null>(null);
  useEffect(() => {
    observed.current.clear();
  }, [section, display, practiceRole]);
  useEffect(() => {
    exposureCallback.current = expose;
  }, [expose]);
  useEffect(() => {
    const element = container.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const lines = new Map(section.lines.map((line) => [line.id, line]));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.sentenceId;
          if (!id || observed.current.has(`${section.key}:${id}`)) continue;
          const line = lines.get(id);
          if (!line) continue;
          observed.current.add(`${section.key}:${id}`);
          exposureCallback.current(line);
        }
      },
      { threshold: 0.5 },
    );
    element
      .querySelectorAll("[data-sentence-id]")
      .forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [section, display, masked, revealed, practiceRole, continuous]);
  const groups: Line[][] = [];
  for (const line of section.lines) {
    const previous = groups.at(-1);
    if (
      previous &&
      previous[0].paragraph === line.paragraph &&
      previous[0].register === line.register &&
      previous[0].speaker === line.speaker
    )
      previous.push(line);
    else groups.push([line]);
  }
  const lineNumbers = new Map(
    section.lines.map((line, index) => [line.id, index + 1]),
  );
  return (
    <section
      className={
        continuous ? "dialogue-list continuous-passage" : "dialogue-list"
      }
      aria-label="本课对话"
      ref={(node) => {
        container.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
    >
      {continuous
        ? groups.map((group, index) => (
            <article className="passage-paragraph" key={group[0].id}>
              <div className="passage-paragraph-heading">
                <span>
                  第 {index + 1} 段 · {group[0].speaker}
                  {group[0].register === "written" && " · 书面说明朗读"}
                </span>
                <button onClick={() => reveal(group.map((line) => line.id))}>
                  {group.some((line) => !visibleKo(line))
                    ? "显示本段韩语"
                    : "显示本段双语"}
                </button>
              </div>
              <p className="korean-line passage-korean" lang="ko">
                {group.map((line, index) => (
                  <span
                    key={line.id}
                    className="passage-sentence"
                    data-playing={activeId === line.id}
                    data-search-match={foundLine === line.id}
                    data-resume={resumeLine === line.id}
                    data-sentence-id={visibleKo(line) ? line.id : undefined}
                  >
                    {visibleKo(line) ? (
                      <Words line={line} playWord={playWord} />
                    ) : (
                      <button
                        className="reveal-line"
                        onClick={() => reveal([line.id])}
                      >
                        显示第 {lineNumbers.get(line.id)} 句
                      </button>
                    )}
                    <button
                      className="passage-line-play"
                      aria-label={`播放第 ${lineNumbers.get(line.id)} 句`}
                      onClick={() => play(line)}
                    >
                      <Volume2 size={15} />
                    </button>
                    {index < group.length - 1 ? " " : ""}
                  </span>
                ))}
              </p>
              {group.some(visibleZh) && (
                <p className="chinese-line passage-chinese">
                  {group
                    .filter(visibleZh)
                    .map((line) => line.zh)
                    .join(" ")}
                </p>
              )}
              <div className="passage-recall-list">
                {group.map((line) => (
                  <DialogueRecall
                    key={dialogueLineKey(sentenceSource(section, line))}
                    section={section}
                    line={line}
                    masked={masked.has(line.id)}
                    assisted={assisted.has(line.id)}
                    hide={() => hide(line.id)}
                    reveal={() => reveal([line.id])}
                    pause={pause}
                  />
                ))}
              </div>
            </article>
          ))
        : section.lines.map((line, index) => (
            <article
              key={line.id}
              className="dialogue-line"
              data-playing={activeId === line.id}
              data-search-match={foundLine === line.id}
              data-resume={resumeLine === line.id}
            >
              <div
                className={`speaker speaker-${line.speaker.toLowerCase()}`}
                aria-label={`角色 ${line.speaker}`}
              >
                {line.speaker}
              </div>
              <div className="line-body">
                {line.register === "written" && (
                  <small className="written-register">书面说明朗读</small>
                )}
                {visibleKo(line) && (
                  <div
                    className="korean-line"
                    lang="ko"
                    data-sentence-id={line.id}
                  >
                    <Words line={line} playWord={playWord} />
                  </div>
                )}
                {visibleZh(line) && <p className="chinese-line">{line.zh}</p>}
                {!visibleKo(line) && (
                  <button
                    className="reveal-line"
                    onClick={() => reveal([line.id])}
                  >
                    {display === "audio"
                      ? `第 ${index + 1} 句 · 显示句子`
                      : "显示韩语"}
                  </button>
                )}
                {visibleKo(line) && <Pattern line={line} />}
                <DialogueRecall
                  key={dialogueLineKey(sentenceSource(section, line))}
                  section={section}
                  line={line}
                  masked={masked.has(line.id)}
                  assisted={assisted.has(line.id)}
                  hide={() => hide(line.id)}
                  reveal={() => reveal([line.id])}
                  pause={pause}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className={`line-play ${activeId === line.id ? "is-playing" : ""}`}
                aria-label={`播放第 ${index + 1} 句`}
                onClick={() => play(line)}
              >
                <Volume2 size={20} />
              </Button>
            </article>
          ))}
    </section>
  );
}
