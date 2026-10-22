"use client";
import { foundationUnits } from '@/data/foundation';
import { Volume2 } from 'lucide-react';
export function WordPronunciationNote({lessonId,onSpeak}:{lessonId:string;onSpeak:(text:string)=>void}){
 const match=/^w0([12])d([1-6])$/.exec(lessonId);
 if(!match)return null;
 const note=foundationUnits[(Number(match[1])-1)*6+Number(match[2])-1];
 return <details className="word-pronunciation-note"><summary>听词时注意 · {note.title}</summary>{note.explanation.map(p=><p key={p}>{p}</p>)}{note.sounds.map(s=><div key={s.ko}><button onClick={()=>onSpeak(s.ko)} lang="ko"><Volume2 size={15}/>{s.ko}</button><small>{s.note}</small></div>)}</details>;
}
