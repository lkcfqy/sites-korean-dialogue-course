"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Volume2 } from "lucide-react";
import type { UsageSense } from "@/lib/vocabulary-usage-types";

type SpeakLine={text:string;speaker:"A"|"B"};
type Props={word:string;onSpeak:(text:string)=>void;onSpeakDialogue?:(lines:SpeakLine[])=>void};
const cache=new Map<string,UsageSense[]>();
const partsOfSpeech:Record<string,string>={명사:"名词",동사:"动词",형용사:"形容词",부사:"副词",관형사:"冠形词",감탄사:"感叹词",수사:"数词",대명사:"代词","의존 명사":"依存名词","보조 동사":"辅助动词","보조 형용사":"辅助形容词"};
const dialogueLines=(text:string):SpeakLine[]=>text.split(/\s+\/\s+/).map((text,i)=>({text,speaker:i%2?"B":"A"}));

export function VocabularyUsage({word,onSpeak,onSpeakDialogue}:Props){
 const [senses,setSenses]=useState<UsageSense[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const c=new AbortController();queueMicrotask(()=>{if(!c.signal.aborted){setSenses(cache.get(word)??null);setError('');}});
  if(!cache.has(word))fetch(`/api/vocabulary-usage?word=${encodeURIComponent(word)}`,{signal:c.signal}).then(async r=>{if(!r.ok)throw new Error('用法暂时无法载入。');return r.json();}).then(raw=>{
   if(!raw||typeof raw!=='object'||!('senses'in raw)||!Array.isArray(raw.senses))throw new Error('用法数据不完整。');
   if(!c.signal.aborted){cache.set(word,raw.senses);if(cache.size>100)cache.delete(cache.keys().next().value!);setSenses(raw.senses);}
  }).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();
 },[word,retry]);
 return <section className="vocabulary-usage" aria-label="词义搭配与用法"><h3>词义、搭配与情境</h3>{error?<p role="status">{error}<Button variant="outline" onClick={()=>setRetry(n=>n+1)}>重试</Button></p>:!senses?<p role="status">正在载入用法…</p>:<>
  <p className="usage-overview">{senses.length} 组用法 · {new Set(senses.flatMap(s=>s.sentences)).size} 条例句 · {new Set(senses.flatMap(s=>s.conversation)).size} 组对话</p>
  {senses.map((s,i)=><details className="usage-sense" key={`${s.entryId}-${s.senseId}-${i}`} open={i===0}><summary>{s.meaning}{s.pos&&<small>{partsOfSpeech[s.pos]??s.pos}</small>}</summary>
   <p>{s.definition}</p>{s.annotation&&<p className="usage-note">{s.annotation}</p>}
   {s.pronunciation.length>0&&<p className="usage-forms">读音提示：<span lang="ko">[{s.pronunciation.join(' / ')}]</span></p>}
   {s.forms.length>0&&<p className="usage-forms">常见词形：<span lang="ko">{s.forms.join(' · ')}</span></p>}
   <div className="usage-phrases">{s.phrases.map(p=><button key={p} onClick={()=>onSpeak(p)} lang="ko"><Volume2 size={15}/>{p}</button>)}</div>
   {s.sentences.map((ko,n)=><div className="usage-example" key={ko}><p lang="ko">{ko}</p>{s.sentenceZh?.[n]&&<p>{s.sentenceZh[n]}</p>}<Button size="sm" variant="outline" onClick={()=>onSpeak(ko)}><Volume2 size={15}/>听例句</Button></div>)}
   {s.conversation.map((text,n)=><div className="usage-conversation" key={text}>{dialogueLines(text).map((l,j)=><p key={j} lang="ko"><strong>{l.speaker}</strong>{l.text}</p>)}<Button size="sm" variant="outline" onClick={()=>onSpeakDialogue?onSpeakDialogue(dialogueLines(text)):onSpeak(text)}><Volume2 size={15}/>听对话 {n+1}</Button></div>)}
   {s.source==='krdict'&&(!s.sentenceZh?.length||s.conversation.length>0)&&<p className="usage-translation-note">此处中文说明对应词义；词典未提供的逐句中文译文不作补写。</p>}
   <p className="usage-attribution">{s.source==='krdict'?<>国立国语院韩国语基础词典 · <a href={`https://krdict.korean.go.kr/chn/dicSearch/SearchView?ParaWordNo=${encodeURIComponent(s.entryId)}`} target="_blank" rel="noreferrer">词目 {s.entryId}</a> · 义项 {s.senseId}</>:'本项目双语教学用例'}</p>
  </details>)}
 </>}</section>;
}
