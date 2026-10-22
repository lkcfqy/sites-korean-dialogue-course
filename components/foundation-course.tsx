"use client";
import { useState } from "react";
import { foundationUnits } from "@/data/foundation";
import { ExerciseRunner } from "@/components/exercise-runner";
import { Button } from "@/components/ui/button";
import { PronunciationRecorder } from "@/components/pronunciation-recorder";
import type { PlaybackItem } from "@/hooks/use-korean-player";
export function FoundationCourse({ playItems,stopAudio }: { playItems: (items: PlaybackItem[]) => void;stopAudio:()=>void }) {
  const [index, setIndex] = useState(0);
  const unit = foundationUnits[index];
  return <section className="foundation-course" aria-label="零基础拼读课程"><h3>先打好拼读基础</h3><p>12 步：音节、元音、辅音、收音、常见音变，再进入完整短句。听辨达到 80% 后进入下一步；发音另需通过录音对照或教师反馈检查。</p><label className="foundation-select">当前步骤<select value={index} onChange={(e) => setIndex(Number(e.target.value))}>{foundationUnits.map((u, i) => <option value={i} key={u.id}>{i + 1}. {u.title}</option>)}</select></label><h4>{unit.title}</h4><p>{unit.goal}</p>{unit.explanation.map((p) => <p key={p}>{p}</p>)}<div className="foundation-sounds">{unit.sounds.map((sound, i) => <div key={sound.ko}><Button variant="outline" onClick={() => playItems([{ id: `${unit.id}-sound-${i}`, text: sound.ko, speaker: "A" }])}>{sound.ko}</Button><p>{sound.note}</p></div>)}</div><ExerciseRunner key={unit.id} id={unit.id} week={1} skill="foundation" title={`${unit.title} · 听写过关`} minutes={5} playItems={playItems} stopAudio={stopAudio} questions={unit.drills.map((d) => ({ id: d.id, week: 1, skill: "foundation", prompt: d.prompt, audio: d.audio, accepted: d.answer, explanation: d.reason, sourceTitle: unit.title, lessonId: "w01d1" }))} /><PronunciationRecorder key={`record-${unit.id}`} focus={unit.goal}/></section>;
}
