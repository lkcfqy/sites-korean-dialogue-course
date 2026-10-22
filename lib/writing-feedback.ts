export type WritingFeedback = { id:string; kind:"fix"|"review"; excerpt:string; suggestion:string; why:string };
export function writingCount(text:string) { return Array.from(text.replace(/\r?\n/g,"" )).length; }
export function analyzeWriting(text:string, min:number, max:number, formal:boolean, requiredNumbers:string[]=[]):WritingFeedback[] {
  if(!text.trim()) return [];
  const result:WritingFeedback[]=[];
  const count=writingCount(text);
  if(count<min || count>max) result.push({id:"length",kind:"review",excerpt:`${count} 字`,suggestion:count<min?`补足任务要求，目标 ${min}–${max} 字。`:`删去重复内容，目标 ${min}–${max} 字。`,why:"含空格、不计换行的参考计数，不等同于正式答题纸判定。"});
  const rules:[string,RegExp,string,string][]=[
    ["doeyo",/되요/g,"돼요","되어요 缩为 돼요，되요 不是规范写法。"],
    ["dwaet",/됬/g,"됐","되었다 缩为 됐다。"],
    ["halsu",/할수(?=\s*(?:있|없)|[^가-힣]|$)/g,"할 수","수 是依存名词；할 수 있다/없다 中，수 和前后词分写。"],
    ["because",/때문애/g,"때문에","固定结构 때문에。"],
    ["student",/학생예요/g,"학생이에요","학생 有收音，接 이에요。"],
    ["school",/학교에요(?=[.!?\s]|$)/g,"학교예요","身份说明用 학교예요；位置学校+에 后接另一个谓语时不是同一结构。"],
    ["percent",/(\d+(?:\.\d+)?)\s*프로센트/g,"퍼센트","规范韩语写法为 퍼센트；数字也可使用 %。"],
  ];
  for(const [id,pattern,suggestion,why] of rules) { const match=pattern.exec(text); if(match) result.push({id,kind:"fix",excerpt:match[0],suggestion,why}); }
  if(formal) {
    const polite=text.match(/[가-힣]+(?:습니다|습니까|세요|어요|아요|예요|이에요|해요)[.!?]?(?=\s|$)/);
    if(polite) result.push({id:"style",kind:"review",excerpt:polite[0],suggestion:"数据说明和论述训练统一书面 다 体；按原意改写，如 증가했습니다→증가했다。",why:"逐句判断词尾与时态，系统不会把所有 요 字串机械替换。"});
  }
  const paragraphs=text.trim().split(/\n\s*\n|\n/).filter(x=>x.trim());
  if(min>=500 && paragraphs.length<3) result.push({id:"paragraph",kind:"review",excerpt:"目前少于 3 个可辨认段落",suggestion:"尝试把问题与立场、理由和例子、条件与建议分段。",why:"段落数量只是结构提示，不能判断论证好坏。"});
  const universal=text.match(/모든 사람|누구나|항상|무조건/);
  if(universal) result.push({id:"scope",kind:"review",excerpt:universal[0],suggestion:"检查是否有足够依据支持全称结论；必要时写出适用对象和条件。",why:"这类词并非必然错误，提示你核对证据范围。"});
  const repeated=paragraphs.filter((p,i)=>paragraphs.indexOf(p)<i);
  if(repeated.length) result.push({id:"repeat",kind:"review",excerpt:repeated[0].slice(0,80),suggestion:"这一段重复出现。删去或改为新的理由、例子。",why:"发现完全重复，不据此评定内容分。"});
  const missing=[...new Set(requiredNumbers)].filter(n=>!new RegExp(`(?<![0-9.])${n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?![0-9.])`).test(text.replace(/(?<=\d),(?=\d{3})/g,"")));
  if(missing.length) result.push({id:"numbers",kind:"review",excerpt:`尚未发现数字：${missing.join("、")}`,suggestion:"核对是否覆盖主要数值；韩文数字和其他正确写法需自行确认。",why:"只查数字出现，不判断数值归属、比较关系或全文准确性。"});
  const hangul=(text.match(/[가-힣]/g)||[]).length;
  if(hangul<text.replace(/\s/g,"").length*.35) result.push({id:"language",kind:"review",excerpt:"韩文内容偏少",suggestion:"把提纲逐步写成完整韩语句子。",why:"中文可作起草辅助；这里只提示文本组成，不判等级。"});
  return result;
}
export type WritingVersion = { text:string; at:number; feedback:WritingFeedback[] };
export function parseWritingVersions(raw:string|null):WritingVersion[] {
  try { const value=JSON.parse(raw||"[]"); return Array.isArray(value)?value.filter(x=>x && typeof x.text==="string" && x.text.length<=20000 && Number.isFinite(x.at) && Array.isArray(x.feedback)).slice(-5):[]; } catch {return [];}
}
