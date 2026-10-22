import fs from 'node:fs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v)+'\n');
const common=read('data/common-vocabulary-senses.json');
const corrected={...Object.fromEntries(Object.entries(common).map(([ko,s])=>[ko,s.zh])),일:'工作；事情；一天；日；一',걸리다:'花费（时间）；挂着；被卡住；患（病）',가장:'最；最为'};
const words=read('data/vocabulary.json');for(const w of words)if(corrected[w.ko]){w.zh=corrected[w.ko];w.source='edited';}write('data/vocabulary.json',words);
const overrides=read('data/curriculum/lexicon-overrides.json');Object.assign(overrides,corrected);write('data/curriculum/lexicon-overrides.json',overrides);
fs.writeFileSync('data/curriculum/lexicon-overrides.json',JSON.stringify(overrides,null,2)+'\n');
const lessons=read('data/curriculum/dialogues.json');
for(const l of lessons)for(const line of l.lines){
 for(const w of line.words){
  for(const [base,meaning]of Object.entries(corrected)){
   if(!w.base?.split(' · ').includes(base))continue;
   let sense=meaning;
   if(base==='걸리다'&&/时间|分钟|小时|时长|花|耗/.test(line.zh))sense='花费（时间）';
   if(base==='일'&&/工作|事/.test(line.zh)&&!/^일[.,!?]?$/.test(w.text))sense=/工作/.test(line.zh)?'工作；事情':'事情';
   w.meaning=w.meaning.replace(new RegExp(`${base}：[^/]+`),`${base}：${sense} `).trim();
  }
 }
 if(line.id==='w05d2-5')for(const w of line.words)if(w.base==='살다'){w.base='사다';w.meaning='사다：买；购买';}
 if(line.id==='w17d2-5')for(const w of line.words)if(w.base==='사다'){w.base='살다';w.meaning='살다：居住；生活';}
}
write('data/curriculum/dialogues.json',lessons);
const u=read('data/vocabulary-usage.json');
const sense=(meaning,definition,phrases,ko,zh)=>({source:'edited',contextSource:'edited',pos:'',meaning,definition,annotation:'结合搭配判断句中的意思。',phrases,sentences:[ko],sentenceZh:[zh],conversation:[],pronunciation:[],forms:[],entryId:'project-common-senses',senseId:meaning});
for(const [ko,s]of Object.entries(common)){
 u[ko]=[{...sense(s.zh,s.zh,s.phrases,s.ko,s.sentenceZh),annotation:s.annotation}];
}
u['일']=[sense('工作；事情','日常活动、工作任务或发生的事情。',['일을 하다','할 일이 있다','무슨 일'],'오늘은 할 일이 많아요.','今天有很多要做的事。'),sense('一天；日','计数日子的单位；一也用于汉字数词。',['하루에 한 번','삼 일 동안'],'삼 일 동안 서울에 있어요.','在首尔待三天。')];
u['걸리다']=[sense('花费（时间）','完成某事或到达某处需要一定时间。',['시간이 걸리다','십 분이 걸리다'],'학교까지 걸어서 십 분이 걸려요.','步行到学校需要十分钟。'),sense('挂着；患病','根据所接名词区分悬挂、受阻或患病等用法。',['벽에 걸리다','감기에 걸리다'],'벽에 사진이 걸려 있어요.','墙上挂着照片。')];
u['가장']=[sense('最；最为','修饰形容词或程度表达，表示在比较范围内程度最高。',['가장 좋다','가장 중요한 것'],'이 길이 가장 가까워요.','这条路最近。')];
write('data/vocabulary-usage.json',u);
console.log(`Corrected ${Object.keys(corrected).length} common headwords and 2 buying/living annotations.`);
