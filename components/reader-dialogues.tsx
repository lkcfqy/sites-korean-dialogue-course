"use client";

import { useState } from "react";
import { Play, Square, Volume2 } from "lucide-react";
import type { Line } from "@/data/course";
import type { ReaderLesson } from "@/lib/reader-types";
import { useKoreanPlayer } from "@/hooks/use-korean-player";
import { ReaderWords } from "@/components/reader-words";

export function ReaderDialogues({ lesson }: { lesson: ReaderLesson }) {
  const player = useKoreanPlayer();
  const [speed, setSpeed] = useState(1);

  function playLines(lines: ReaderLesson["sections"][number]["lines"]) {
    void player.play(
      lines.map((line) => ({
        id: line.id,
        text: line.ko,
        speaker: line.speaker === "B" ? ("B" as const) : ("A" as const),
      })),
      speed,
      1,
      0,
    );
  }

  function playWord(text: string, lineId: string) {
    const line = lesson.sections
      .flatMap((section) => section.lines)
      .find((candidate) => candidate.id === lineId);
    void player.play(
      [
        {
          id: `word:${lineId}:${text}`,
          text,
          speaker: line?.speaker === "B" ? "B" : "A",
        },
      ],
      speed,
      1,
      0,
    );
  }

  return (
    <>
      <div className="reader-audio-bar" aria-label="对话朗读">
        <button
          type="button"
          onClick={() =>
            playLines(lesson.sections.flatMap((section) => section.lines))
          }
        >
          <Play size={17} aria-hidden="true" />
          朗读本课
        </button>
        <button type="button" disabled={!player.playing} onClick={player.stop}>
          <Square size={16} aria-hidden="true" />
          停止
        </button>
        <label>
          语速
          <select
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            {[0.7, 0.85, 1, 1.15, 1.3].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        <span role="status" aria-live="polite">
          {player.status}
        </span>
      </div>
      <div id="dialogues" tabIndex={-1}>
        {lesson.sections.map((section, sectionIndex) => (
          <section
            className="dialogue-scene"
            key={section.key}
            aria-labelledby={`scene-${sectionIndex}`}
          >
            <header>
              <span className="scene-number" aria-hidden="true">
                {String(sectionIndex + 1).padStart(2, "0")}
              </span>
              <h2 id={`scene-${sectionIndex}`}>{section.label}</h2>
              <button
                className="reader-scene-play"
                type="button"
                onClick={() => playLines(section.lines)}
                aria-label={`朗读这段对话：${section.label}`}
              >
                <Volume2 size={16} aria-hidden="true" />
                朗读这段
              </button>
            </header>
            {section.scene && <p className="scene-context">{section.scene}</p>}
            <ol className="dialogue-lines">
              {section.lines.map((line) => (
                <li
                  className="dialogue-line"
                  data-speaker={line.speaker}
                  data-playing={player.activeId === line.id}
                  key={line.id}
                  id={line.id}
                >
                  <span className="speaker" aria-label={`角色 ${line.speaker}`}>
                    {line.speaker}
                  </span>
                  <div className="utterance">
                    <p className="korean" lang="ko">
                      <ReaderWords line={line as Line} playWord={playWord} />
                    </p>
                    <p className="translation" lang="zh-CN">
                      {line.zh}
                    </p>
                  </div>
                  <button
                    className="reader-play-button"
                    type="button"
                    onClick={() => playLines([line])}
                    aria-label={`朗读这一句：${line.ko}`}
                    aria-pressed={player.activeId === line.id}
                  >
                    <Volume2 size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
}
