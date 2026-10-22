"use client";
import { useState } from "react";
import sources from "@/data/natural-listening.json";

export function NaturalListening({
  week,
  stop,
}: {
  week: number;
  stop: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <section className="natural-listening">
      <h2>听不同的人说韩语</h2>
      <p>
        课程音频适合反复练习；这里接触真人示范、街头采访和自然讨论。先听短片段，抓住意思后再核对字幕。
      </p>
      <div className="natural-source-grid">
        {sources.resources.map((source) => (
          <article
            key={source.id}
            className={
              week >= source.suggestedWeeks[0] &&
              week <= source.suggestedWeeks[1]
                ? "recommended-source"
                : ""
            }
          >
            <span className="source-publisher">
              {source.publisher} · 建议第 {source.suggestedWeeks[0]}–
              {source.suggestedWeeks[1]} 周
            </span>
            <h3>{source.labelZh}</h3>
            <p>{source.practiceZh}</p>
            {source.embedUrl && (
              <button
                aria-expanded={selected === source.id}
                onClick={() => {
                  stop();
                  setSelected(selected === source.id ? null : source.id);
                }}
              >
                {selected === source.id ? "收起视频" : "打开真人视频"}
              </button>
            )}
            <a href={source.sourceUrl} target="_blank" rel="noreferrer">
              在官方频道观看
            </a>
            {selected === source.id && source.embedUrl && (
              <iframe
                title={source.labelZh}
                src={source.embedUrl + "?rel=0"}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            )}
          </article>
        ))}
      </div>
      <p className="secondary-note">
        视频来自官方频道，能否播放取决于所在网络和发布方设置；无法播放时可使用官方链接。建议周数仅用于选材。
      </p>
    </section>
  );
}
