"""Import NIKL text examples for this course's headwords only; no dictionary media.
Usage: python3 scripts/import-vocabulary-usage.py --archive /tmp/krdict-2026-09.zip
The public dictionary's text is CC BY-SA 2.0 KR. Keep entry and sense IDs.
"""
import argparse, collections, hashlib, html, json, re, zipfile
from pathlib import Path
root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(); parser.add_argument('--archive', required=True); args = parser.parse_args()
words = json.loads((root/'data/vocabulary.json').read_text())
index = {w['ko']: w for w in words}
usage = collections.defaultdict(list)
def seq(value): return value if isinstance(value, list) else [value] if value else []
def feats(value): return {f['att']: f.get('val', '') for f in seq(value.get('feat'))}
def clean(text): return re.sub(r'<[^>]+>', '', html.unescape(text)).strip()
def clean_list(values, limit): return list(dict.fromkeys(clean(v) for v in values if re.search('[가-힣]', clean(v))))[:limit]
z = zipfile.ZipFile(args.archive)
for name in z.namelist():
    data = json.loads(z.read(name))
    for entry in data['LexicalResource']['Lexicon']['LexicalEntry']:
        ko = feats(seq(entry['Lemma'])[0]).get('writtenForm', '')
        if ko not in index: continue
        word = index[ko]; eid = str(entry['val']); meta = feats(entry)
        if word['sourceIds'] and eid not in [str(i) for i in word['sourceIds']]: continue
        if meta.get('partOfSpeech') == '조사': continue
        pronunciation = [feats(f).get('pronunciation', '') for f in seq(entry.get('WordForm'))]
        forms = [feats(f).get('writtenForm', '') for f in seq(entry.get('WordForm')) if feats(f).get('type') == '활용']
        for sense in seq(entry.get('Sense')):
            equivalent = next((feats(q) for q in seq(sense.get('Equivalent')) if feats(q).get('language') == '중국어'), None)
            if not equivalent: continue
            phrases, sentences, dialogues = [], [], []
            for example in seq(sense.get('SenseExample')):
                kind = feats(example).get('type')
                texts = [x.get('val', '') for x in seq(example.get('feat')) if x['att'] == 'example']
                if kind == '구': phrases.extend(texts)
                elif kind == '문장': sentences.extend(texts)
                elif kind == '대화': dialogues.append(' / '.join(texts))
            sensezh = clean(equivalent.get('lemma', '')); definition = clean(equivalent.get('definition', ''))
            if not sensezh or '无对应' in sensezh: sensezh = definition
            if not phrases and not sentences and not dialogues: continue
            # Favour the senses represented by the course's edited everyday gloss.
            zhchars = set(re.findall('[\u4e00-\u9fff]', word['zh']))
            score = len(zhchars & set(re.findall('[\u4e00-\u9fff]', sensezh))) * 10 - int(sense.get('val', '1'))
            usage[ko].append({'pos': meta.get('partOfSpeech',''), 'meaning': sensezh, 'definition': definition, 'annotation': clean(feats(sense).get('annotation', '')), 'phrases': clean_list(phrases, 4), 'sentences': clean_list(sentences, 2), 'conversation': clean_list(dialogues, 1), 'pronunciation': clean_list(pronunciation, 2), 'forms': clean_list(forms, 5), 'entryId': eid, 'senseId': str(sense.get('val','')), 'source': 'krdict', '_score': score})
    print(name, 'processed', flush=True)
    del data
result = {}
for ko, senses in usage.items():
    senses.sort(key=lambda s: s['_score'], reverse=True)
    selected = senses[:2]
    for sense in selected: sense.pop('_score')
    result[ko] = selected
missing = [w['ko'] for w in words if w['ko'] not in result]
(root/'data/vocabulary-usage.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
(root/'data/curriculum/usage-provenance.json').write_text(json.dumps({'dictionaryRelease':'2026-09-19','archiveSha256':hashlib.sha256(Path(args.archive).read_bytes()).hexdigest(),'license':'CC BY-SA 2.0 KR','headwords':len(result),'missing':missing},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'headwords':len(result),'missing':missing},ensure_ascii=False),flush=True)
