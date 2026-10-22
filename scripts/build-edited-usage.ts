import { readFileSync, writeFileSync } from 'node:fs';
import { editedUsage } from '../data/edited-vocabulary-usage';
import words from '../data/vocabulary.json';
const path = new URL('../data/vocabulary-usage.json', import.meta.url);
const usage = JSON.parse(readFileSync(path,'utf8'));
for (const word of words) {
  const dictionary = usage[word.ko]?.some((s: {source:string}) => s.source === 'krdict');
  if (dictionary && usage[word.ko].some((s:{phrases:string[];sentences:string[];conversation:string[];contextSource?:string})=>!s.contextSource && (s.phrases.length||s.sentences.length||s.conversation.length))) continue;
  const example = editedUsage[word.ko];
  if (!example) throw new Error(`No usage example for ${word.ko}`);
  if(dictionary) usage[word.ko][0] = {...usage[word.ko][0],contextSource:'edited',phrases:example.phrases,sentences:[example.ko],sentenceZh:[example.zh]};
  else usage[word.ko] = [{source:'edited',meaning:word.zh,definition:word.zh,annotation:'本项目编写的教学示例；词组按句中常用空格书写。',pos:'',phrases:example.phrases,sentences:[example.ko],sentenceZh:[example.zh],conversation:[],pronunciation:[],forms:[],entryId:'',senseId:''}];
}
writeFileSync(path,JSON.stringify(usage)+'\n');
const provenancePath = new URL('../data/curriculum/usage-provenance.json',import.meta.url);
const provenance = JSON.parse(readFileSync(provenancePath,'utf8'));
provenance.headwords = Object.keys(usage).length;
provenance.edited = Object.values(usage).filter((s) => (s as {source:string}[])[0].source==='edited').length;
provenance.editedContexts = Object.values(usage).filter((s) => (s as {contextSource?:string}[]).some(x=>x.contextSource==='edited')).length;
provenance.missing = words.filter((w)=>!usage[w.ko]).map((w)=>w.ko);
writeFileSync(provenancePath,JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({headwords:provenance.headwords,edited:provenance.edited,missing:provenance.missing}));
