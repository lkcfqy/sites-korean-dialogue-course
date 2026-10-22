"""Compile literal dialogues + attributed NIKL headwords; no dialogue slot expansion.
Build-time only: Python 3, kiwipiepy==0.24.0. No model runs in the browser/Worker.
Usage: python scripts/build-curriculum.py --dictionary /tmp/korean-dictionary-extracted.json --core /tmp/korean-learning-vocabulary-utf8.txt
Re-import the dictionary with scripts/import-krdict.py when upstream data changes.
"""
import argparse,collections,hashlib,json,math,re
from pathlib import Path
from kiwipiepy import Kiwi
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--dictionary',required=True);p.add_argument('--core',required=True);a=p.parse_args()
read=lambda p:json.loads(Path(p).read_text())
write=lambda p,x:Path(p).write_text(json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n')
entries=read(a.dictionary); overrides=read(root/'data/curriculum/lexicon-overrides.json')
byword=collections.defaultdict(list)
for e in entries:
 if e['pos'] != '조사':byword[e['ko']].append(e)
levels={'초급':1,'중급':2,'고급':3,'없음':4,'':4}
for es in byword.values():es.sort(key=lambda e:(levels[e['level']],int(e['id'])))
core={}
for row in Path(a.core).read_text().splitlines():
 f=row.split('\t')
 if len(f)!=5 or f[4] not in ('A','B','C'):continue
 ko=re.sub(r'\d+$','',f[1]); ko=re.sub(r'\(.*\)','',ko)
 if not re.fullmatch('[가-힣 ]+',ko):continue
 rank=int(f[0]) if f[0].isdigit() else 30000
 level={'A':1,'B':2,'C':3}[f[4]]
 if ko not in core or level<core[ko][0]:core[ko]=(level,rank)
exclude=set('민지 왕리 지수 리밍 수연 장웨이 현우 천위 린 린린 서준 류양 유진 왕신 다은 저우란 도윤 리나 은서 쑨메이 김 수진 제가 것이 새로운 같은 다른 배우고'.split())
def definition(ko,pos=None):
 if ko in overrides:return overrides[ko]
 es=byword.get(ko,[])
 if pos:
  filtered=[e for e in es if pos in e['pos']]
  if filtered:es=filtered
 meanings=[]
 for e in es[:3]:
  for s in e['senses'][:2]:
   zh=s['zh'].strip()
   if not zh or '无对应' in zh:zh=s['definition'].strip()
   if zh and zh not in meanings and re.search('[\u4e00-\u9fff]',zh):
    register=next((r for r in ('卑称','粗俗','贬义','谦称','尊称','敬称') if r in s['definition'][:24]),None)
    label=(f'（{register}）' if register and register not in zh else '')+zh
    if label not in meanings:meanings.append(label)
 flat=[]
 for meaning in meanings:
  pieces=re.split('[,，;；]',meaning) if len(meaning)<48 and '。' not in meaning else [meaning]
  for piece in pieces:
   if piece.strip() and piece.strip() not in flat:flat.append(piece.strip())
 return '；'.join(flat[:6])
kiwi=Kiwi(num_workers=2)
lessons=[]
for file in sorted((root/'data/curriculum').glob('*.txt')):
 for raw in file.read_text().splitlines():
  if not raw.strip():continue
  if raw.startswith('@'):
   wd,title,scene,focus,seeds=raw[1:].split('|');w,d=map(int,wd.split('.'))
   lesson={'id':f'w{w:02}d{d}','week':w,'day':d,'title':title,'scene':scene,'focus':focus,'seeds':seeds.split(),'lines':[]};lessons.append(lesson)
  else:
   ko,zh=raw.split('|'); i=len(lesson['lines'])
   lesson['lines'].append({'id':f"{lesson['id']}-{i+1}",'speaker':'A' if i%2==0 else 'B','ko':ko,'zh':zh})
for old in read(root/'data/curriculum/weekly-dialogues.json'):
 old['focus']='把本周表达连成完整对话，注意问答之间的承接。'
 old['seeds']=[]
 for i,line in enumerate(old['lines']):line['id']=f"{old['id']}-{i+1}";line.pop('section',None)
 lessons.append(old)
lessons.sort(key=lambda l:(l['week'],l['day']))
# A modest set of grammar notes explains forms without inventing lexical meanings.
grammar={'JKS':'主语助词','JKO':'宾语助词','JKG':'所属助词','JKB':'地点、时间或方式助词','JX':'补助词','JC':'连接助词','VCP':'이다：是','VCN':'아니다：不是','EP':'时态或尊敬成分','EF':'句末语尾','EC':'连接语尾','ETM':'修饰名词的语尾','ETN':'名词化语尾'}
firstuse={};linelemmas={};unknown=collections.Counter()
def lexical(tokens):
 out=[]; skip=set()
 for i,t in enumerate(tokens):
  if i in skip:continue
  tag=t.tag.split('-')[0];base=t.form
  if tag in ('NNG','NNP','NNB','NP','NR','MM','MAG','MAJ','IC'):
   for j in range(min(len(tokens),i+3),i,-1):
    span=tokens[i:j]
    if not all(x.tag.split('-')[0] in ('NNG','NNP','NNB','XSN','XSV','XSA') for x in span):continue
    compound=''.join(x.form for x in span)
    if span[-1].tag in ('XSV','XSA'):compound+='다'
    if definition(compound):base=compound;skip.update(range(i+1,j));break
  elif tag in ('VV','VA','VX','XSV','XSA'):base+='다'
  else:continue
  if base in exclude:continue
  if definition(base):out.append(base)
  elif tag not in ('NNP','MM'):unknown[base]+=1
 return list(dict.fromkeys(out))
for lesson in lessons:
 for line in lesson['lines']:
  toks=kiwi.tokenize(line['ko']);lemmas=lexical(toks);linelemmas[line['id']]=lemmas
  for ko in lemmas:firstuse.setdefault(ko,lesson['id'])
  if 'words' in line:continue
  words=[]
  for m in re.finditer(r'\S+',line['ko']):
   tokens=[t for t in toks if m.start()<=t.start<m.end()];bases=lexical(tokens)
   glosses=[f'{b}：{definition(b)}' for b in bases]
   notes=list(dict.fromkeys(grammar[t.tag.split('-')[0]] for t in tokens if t.tag.split('-')[0] in grammar))
   # Never synthesize a sentence translation from a dictionary lookup.
   words.append({'text':m.group(),'meaning':' / '.join(glosses),'base':' · '.join(bases),'note':'；'.join(notes)})
  line['words']=words
  # Split on a clause/sentence boundary only; never cut a Korean eojeol in half.
  parts=re.split(r'(?<=[.!?])\s+|(?<=,)\s+',line['ko'])
  if len(parts)>1:line['chunks']=parts
candidates=(set(core)|set(firstuse)|set(overrides)|{w for l in lessons for w in l['seeds']})-exclude
valid={w for w in candidates if re.fullmatch('[가-힣 ]+',w) and definition(w)}
# Keep the official learning list as a core; additional words come from the actual
# dialogues and explicit domain headwords, not generated inflections or names.
vocabulary={}
for ko in sorted(valid):
 es=byword.get(ko,[]);f=core.get(ko)
 lesson_id=firstuse.get(ko);week=int(lesson_id[1:3]) if lesson_id else 26
 level=f[0] if f else (1 if week<=6 else 2 if week<=12 else 3)
 vocabulary[ko]={'ko':ko,'zh':definition(ko),'level':level,'rank':f[1] if f else 40000,'category':es[0]['category'] if es else '', 'sourceIds':[e['id'] for e in es[:3]],'source':'edited' if ko in overrides else 'krdict'}
# Allocate by phase, with the dialogue's own vocabulary prioritized over topic
# companions, then fill with a topical, frequency-ordered share of the core.
weeksTopics={1:'언어 사람',2:'사람 직장 친족',3:'시간',4:'식생활 음식 맛 조리',5:'의생활 구매 경제',6:'교통 위치 방향',7:'교육 언어',8:'사회 활동 인간관계',9:'신체 행위 시간',10:'삶 병 증상 신체',11:'주생활',12:'여가 여행 교통',13:'감정 인지',14:'언어 인지 성질',15:'직장 사회 활동',16:'사회 생활 상태 언어',17:'정도 성질 경제',18:'공공 사회',19:'삶 직장 능력',20:'문화 예술 전통',21:'경제',22:'자연 환경 지형',23:'정보 통신 과학 기술',24:'교육',25:'정치 사회 삶',26:'개념 언어 인지'}
remaining=set(vocabulary);ordered=[];counts=[]
quotas=[25 if l['week']==1 else 35 if l['week']<=6 else 40 if l['week']<=12 else 42 if l['week']<=18 else 41 for l in lessons]
delta=len(vocabulary)-sum(quotas)
for n in range(abs(delta)):quotas[len(lessons)-1-n%len(lessons)] += 1 if delta>0 else -1
slots=[[] for _ in lessons];lessonIndex={l['id']:i for i,l in enumerate(lessons)}
seedDate={}
for i,l in enumerate(lessons):
 for w in l['seeds']:
  if w in vocabulary:seedDate.setdefault(w,i)
domains=[
 ('식생활',[4,9,12]),('의생활',[5,12,9]),('주생활',[11,5,2]),
 ('교통',[6,12,22]),('여가',[8,12,20]),('문화',[20,13,8]),('예술',[20,13,8]),
 ('교육',[7,24,14]),('경제',[21,17,5]),('정치',[25,18,26]),('행정',[18,25,16]),
 ('소통 수단',[23,15,7]),('통신',[23,15,7]),('직장',[15,19,2]),('사회 활동',[18,15,25]),('사회 생활 상태',[25,18,16]),
 ('언어',[14,7,26]),('가족 행사',[20,8]),('친족',[2,8,25]),('병과',[10,9]),('치료',[10,9]),('건강',[10,9]),('신체 부위',[10,9,2]),
 ('동물',[22,12,4]),('식물',[22,4,12]),('자연',[22,12,6]),('감정',[13,9,20]),
 ('용모',[5,13]),('태도',[14,15,20]),('인지',[14,23,26]),('신체 행위',[9,6,13]),('사람의 종류',[2,15,25]),
 ('위치',[6,11,12]),('방향',[6,12,22]),('시간',[3,9,19]),('정도',[17,14,26]),('성질',[17,14,26]),
 ('삶',[19,25,13]),('능력',[19,24,15]),('모양',[5,11,20]),('지역',[6,12,25]),('수',[3,21,26]),
]
def preferred(w):
 v=vocabulary[w];category=v['category']
 if w in seedDate:return [lessons[seedDate[w]]['week']]
 matched=next((weeks for token,weeks in domains if token in category),None)
 if v['level']==1:return [week for week in (matched or [1,2,3,4,5,6]) if week<=6] or [2,3,5,6]
 if matched:return matched
 return list(range(7,15)) if v['level']==2 else list(range(19,27))
def cost(w,i,due=None):
 v=vocabulary[w];week=lessons[i]['week'];pref=preferred(w)
 distance=min(abs(week-p)+(n*.7) for n,p in enumerate(pref))
 if v['level']==1 and week>6:distance+=50+(week-6)*3
 if v['level']==2 and week>18:distance+=30
 # Reserved words may precede the normal phase if their dialogue needs them.
 if due is None:
  if v['level']==2 and week<4:distance+=80
  if v['level']==3 and week<7:distance+=150
  if v['level']==3 and not any(t in v['category'] for t in ('식생활','의생활','주생활','친족','신체','병과','치료','건강')) and week<13:distance+=30
 if w in seedDate:distance+=abs(i-seedDate[w])*.07
 elif due is not None and week==lessons[min(due,len(lessons)-1)]['week']:distance+=abs(i-due)*.01
 return (distance,len(slots[i])/quotas[i],i)
# Prerequisite deadlines: each dialogue's content words are introduced by that
# date. Very common words get an earlier foundation date even if first used late.
deadline={w:lessonIndex[lesson] for w,lesson in firstuse.items() if w in remaining}
for w,i in seedDate.items():deadline[w]=min(deadline.get(w,i),i)
for w in sorted(deadline,key=lambda w:(deadline[w],vocabulary[w]['level'],vocabulary[w]['rank'],w)):
 due=deadline[w];available=[i for i in range(due+1) if len(slots[i])<quotas[i]]
 assert available,f'Not enough prerequisite capacity for {w} before {lessons[due]["id"]}'
 i=min(available,key=lambda i:cost(w,i,due));slots[i].append(w);remaining.remove(w)
# All remaining A words precede B words; concrete C themes precede flexible
# abstract companions. This prevents leftover rare nouns displacing day-one words.
extras=sorted(remaining,key=lambda w:(vocabulary[w]['level'],len(preferred(w)),vocabulary[w]['rank'],w))
for w in extras:
 available=[i for i in range(len(lessons)) if len(slots[i])<quotas[i]]
 i=min(available,key=lambda i:cost(w,i));slots[i].append(w);remaining.remove(w)
# Improve the global placement by exchanging words between equally sized days.
# Prerequisite deadlines remain hard constraints; this removes greedy leftovers
# such as food words in the final argumentation week or A words introduced late.
import numpy as np
headwords=list(vocabulary);wordIndex={w:i for i,w in enumerate(headwords)}
placement=np.empty(len(headwords),dtype=np.int32)
for day,ws in enumerate(slots):
 for w in ws:placement[wordIndex[w]]=day
matrix=np.empty((len(headwords),len(lessons)),dtype=np.float32)
for n,w in enumerate(headwords):
 due=deadline.get(w)
 for day in range(len(lessons)):
  matrix[n,day]=1e6 if due is not None and day>due else cost(w,day,due)[0]
current=matrix[np.arange(len(headwords)),placement].copy()
rng=np.random.default_rng(20261001)
for epoch in range(12):
 changes=0
 for n in rng.permutation(len(headwords)):
  deltas=matrix[n,placement]+matrix[:,placement[n]]-current[n]-current
  partner=int(np.argmin(deltas))
  if deltas[partner] < -0.001:
   placement[n],placement[partner]=placement[partner],placement[n]
   current[n]=matrix[n,placement[n]];current[partner]=matrix[partner,placement[partner]]
   changes+=1
 if not changes:break
slots=[[] for _ in lessons]
for n,w in enumerate(headwords):slots[int(placement[n])].append(w)
for i,lesson in enumerate(lessons):
 seeds=lesson['seeds'];chosen=sorted(slots[i],key=lambda w:(0 if w in seeds else 1,seeds.index(w) if w in seeds else 0,vocabulary[w]['level'],vocabulary[w]['rank'],w))
 for w in chosen:vocabulary[w]['lessonId']=lesson['id'];ordered.append(vocabulary[w])
 lesson['vocabulary']=chosen;lesson.pop('seeds');counts.append(len(chosen))
assert not remaining, f'Unallocated vocabulary: {len(remaining)}'
# Runtime does not need the rank/category import metadata.
for v in ordered:v.pop('rank');v.pop('category')
write(root/'data/vocabulary.json',ordered)
write(root/'data/curriculum/dialogues.json',lessons)
write(root/'data/curriculum/outline.json',[{k:l[k] for k in ('id','week','day','title','scene','focus','vocabulary')} for l in lessons])
write(root/'data/curriculum/lexical-coverage.json',{'firstUse':firstuse,'lemmas':linelemmas})
summary={'weeks':26,'newLessons':len(lessons),'authoredScenarios':130,'vocabulary':len(ordered),'dialogueTurns':sum(len(l['lines']) for l in lessons),'distinctTurns':len(set(ln['ko'] for l in lessons for ln in l['lines'])),'coreHeadwords':len(core),'coreMatched':len(set(core)&valid),'dailyNewWords':{'min':min(counts),'max':max(counts)},'levels':dict(collections.Counter(v['level'] for v in ordered)),'dictionaryRelease':'2026-09-19','inputSha256':hashlib.sha256(Path(a.dictionary).read_bytes()).hexdigest()}
write(root/'data/curriculum/statistics.json',summary)
print(json.dumps(summary,ensure_ascii=False,indent=2))
print('Missing lexical items (not silently translated):',unknown.most_common(35))
