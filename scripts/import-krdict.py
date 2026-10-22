import zipfile,json,collections,html,re
import argparse
p=argparse.ArgumentParser(description='Extract Chinese senses from NIKL KRDICT JSON bulk download; media is excluded.')
p.add_argument('--archive',required=True);p.add_argument('--output',required=True);args=p.parse_args()
z=zipfile.ZipFile(args.archive)
def seq(x): return x if isinstance(x,list) else [x] if x else []
def feats(x): return {f['att']:f.get('val','') for f in seq(x.get('feat'))}
entries=[]
for n in z.namelist():
 data=json.loads(z.read(n))
 for e in data['LexicalResource']['Lexicon']['LexicalEntry']:
  f=feats(e);ko=feats(seq(e['Lemma'])[0]).get('writtenForm','')
  if f.get('lexicalUnit')!='단어' or not re.fullmatch('[가-힣 ]+',ko):continue
  senses=[]
  for s in seq(e.get('Sense')):
   eq=next((feats(q) for q in seq(s.get('Equivalent')) if feats(q).get('language')=='중국어'),None)
   if not eq:continue
   examples=[]
   for x in seq(s.get('SenseExample')):
    if feats(x).get('type')=='대화':examples.append([html.unescape(v.get('val','')) for v in seq(x['feat']) if v['att']=='example'])
   senses.append({'zh':html.unescape(eq.get('lemma','')),'definition':html.unescape(eq.get('definition','')),'koDefinition':feats(s).get('definition',''),'dialogues':examples})
  if senses:entries.append({'id':e['val'],'ko':ko,'level':f.get('vocabularyLevel',''),'pos':f.get('partOfSpeech',''),'category':f.get('semanticCategory',''),'topic':f.get('subjectCategory',''),'senses':senses})
 print(n,'parsed',flush=True)
json.dump(entries,open(args.output,'w'),ensure_ascii=False)
print(f'Extracted {len(entries)} entries; no media included.')
