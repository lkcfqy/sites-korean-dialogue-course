import fs from 'node:fs';
import { grammarWeeks } from '../data/grammar-course';
import { intensiveWeeks } from '../data/intensive-course';
const assets=grammarWeeks.flatMap((week,i)=>[...intensiveWeeks[i].grammar,...week].map((g,n)=>({
 lessonId:`w${String(i+1).padStart(2,'0')}d${n+1}`,
 title:`句子里的表达 · ${g.form}`,scene:'先听懂整句，再打开表达提示，最后看中文说出韩语。',kind:'sentence',
 lines:[{speaker:'A',ko:g.ko,zh:g.zh,pattern:{form:g.form,explanation:g.explanation,caution:g.caution}}]
})));
if(assets.length!==130)throw new Error('Expression coverage is incomplete');
fs.writeFileSync('data/immersion/expression-scenes.json',JSON.stringify(assets)+'\n');
console.log({expressionPoints:assets.length});
