"use client";

import {
  dialogueSoundNote,
  hangulSyllables,
} from "@/lib/dialogue-pronunciation";

export function DialoguePronunciation({ text }: { text: string }) {
  const syllables = hangulSyllables(text);
  if (!syllables.length) return null;
  const note = dialogueSoundNote(text);
  return (
    <details className="dialogue-pronunciation">
      <summary>拼读当前词形</summary>
      <p>
        每个字块是一个音节，按首辅音、元音和收音拼合。以下拆的是拼写；实际音变要回到音频核对。
      </p>
      <div className="dialogue-syllables" aria-label="当前词形的音节与字母">
        {syllables.map((syllable, index) => (
          <div key={index}>
            <strong lang="ko">{syllable.text}</strong>
            <span lang="ko">
              {[syllable.initial, syllable.vowel, syllable.final]
                .filter(Boolean)
                .join(" + ")}
            </span>
            <small>
              {syllable.final ? `收音 ${syllable.final}` : "无收音"}
            </small>
          </div>
        ))}
      </div>
      {syllables.some((syllable) => syllable.initial === "ㅇ") && (
        <p>字块开头的 ㅇ 只占位置，不发音；在收音位置则发鼻音。</p>
      )}
      {syllables.some((syllable) => syllable.final) && (
        <p>
          收音后不要另加元音。先听这个词形，再关掉弹窗听整句；句中连音与独立读词可能不同。
        </p>
      )}
      {note && <p className="dialogue-sound-note">{note}</p>}
      <p>
        模仿当前音频中的词组与句末语调，不借中文谐音。拼读帮助不表示发音已经达标。
      </p>
    </details>
  );
}
