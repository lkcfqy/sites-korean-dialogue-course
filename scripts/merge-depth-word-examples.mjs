import fs from 'node:fs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const words=new Map(read('data/vocabulary.json').map(w=>[w.ko,w]));
const usage=read('data/vocabulary-usage.json');
const examples=read('data/depth-vocabulary-examples.json');
for(const [ko,pairs]of Object.entries(examples)){
 const word=words.get(ko);if(!word)throw new Error(`Unknown word ${ko}`);
 let sense=usage[ko].find(s=>s.source==='edited');
 if(!sense){sense={source:'edited',contextSource:'edited',pos:word.pos??'',meaning:word.zh,definition:'在不同情境中理解词义，注意搭配与句子中的用法。',annotation:'本项目编写的双语情境例句。',phrases:[],sentences:[],sentenceZh:[],conversation:[],pronunciation:usage[ko][0]?.pronunciation??[],forms:usage[ko][0]?.forms??[],entryId:'project-depth-examples',senseId:'contexts'};usage[ko].unshift(sense);}
 for(const p of pairs){if(!/[가-힣]/.test(p.ko)||!/[\u4e00-\u9fff]/.test(p.zh))throw new Error(`Invalid example ${ko}`);if(sense.sentences.includes(p.ko))continue;
  if(!sense.sentenceZh)sense.sentenceZh=sense.sentences.map(()=> '');
  sense.sentences.push(p.ko);sense.sentenceZh.push(p.zh);
 }
}
fs.writeFileSync('data/vocabulary-usage.json',JSON.stringify(usage)+'\n');
console.log({enrichedWords:Object.keys(examples).length,authoredExamples:Object.values(examples).reduce((n,v)=>n+v.length,0)});
