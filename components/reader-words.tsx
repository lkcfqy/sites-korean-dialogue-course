"use client";

import { useState } from "react";
import { Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DialoguePronunciation } from "@/components/dialogue-pronunciation";
import { VocabularyUsage } from "@/components/vocabulary-usage";
import type { Line } from "@/data/course";

type ReaderWordsProps = {
  line: Line;
  playWord: (text: string, id: string) => void;
};

function InlineUsage({
  word,
  lineId,
  playWord,
}: {
  word: string;
  lineId: string;
  playWord: ReaderWordsProps["playWord"];
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

export function ReaderWords({ line, playWord }: ReaderWordsProps) {
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
