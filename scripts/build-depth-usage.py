"""Import full useful word contexts from the attributed NIKL JSON archive.

Build-time only; preserves human-written common senses and project examples.
Never labels a sense gloss as a Chinese translation of a Korean sentence.
"""
import argparse, collections, hashlib, html, json, re, zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(); p.add_argument('--archive', required=True); args = p.parse_args()
read = lambda path: json.loads(path.read_text())
words = read(root / 'data/vocabulary.json'); index = {w['ko']: w for w in words}
old = read(root / 'data/vocabulary-usage.json')
manual = set(read(root / 'data/common-vocabulary-senses.json')) | {'일', '걸리다', '가장'}
usage = collections.defaultdict(list)
def seq(x): return x if isinstance(x, list) else [x] if x else []
def feats(x): return {f['att']: f.get('val', '') for f in seq(x.get('feat'))}
def clean(s): return re.sub(r'<[^>]+>', '', html.unescape(s)).strip()
def unique(xs, limit): return list(dict.fromkeys(clean(x) for x in xs if re.search('[가-힣]', clean(x))))[:limit]

z = zipfile.ZipFile(args.archive)
for name in z.namelist():
    data = json.loads(z.read(name))
    for entry in data['LexicalResource']['Lexicon']['LexicalEntry']:
        ko = feats(seq(entry['Lemma'])[0]).get('writtenForm', '')
        if ko not in index: continue
        word = index[ko]; eid = str(entry['val']); meta = feats(entry)
        # Source IDs identify the selected headword, not homographs with an
        # unrelated meaning. Preserve this provenance boundary.
        if word['sourceIds'] and eid not in [str(x) for x in word['sourceIds']]: continue
        if meta.get('partOfSpeech') == '조사': continue
        for sense in seq(entry.get('Sense')):
            eq = next((feats(q) for q in seq(sense.get('Equivalent')) if feats(q).get('language') == '중국어'), None)
            if not eq: continue
            phrases, sentences, dialogues = [], [], []
            for example in seq(sense.get('SenseExample')):
                kind = feats(example).get('type')
                texts = [clean(x.get('val', '')) for x in seq(example.get('feat')) if x['att'] == 'example']
                if kind == '구': phrases.extend(texts)
                elif kind == '문장': sentences.extend(texts)
                elif kind == '대화': dialogues.append(' / '.join(texts))
            meaning = clean(eq.get('lemma', '')); definition = clean(eq.get('definition', ''))
            if not meaning or '无对应' in meaning: meaning = definition
            if not sentences and not dialogues and not phrases: continue
            if re.search('粗俗|古语|古文|方言', definition): continue
            primary = re.split('[；;。]', word['zh'])[0]
            # Prefer the first learner meaning and first/common dictionary
            # senses. Long grammar definitions cannot win by character count.
            overlap = len(set(re.findall('[\u4e00-\u9fff]', primary)) & set(re.findall('[\u4e00-\u9fff]', meaning)))
            level = {'초급': 3, '중급': 2, '고급': 1}.get(meta.get('vocabularyLevel'), 0)
            score = overlap * 12 + level * 8 - int(sense.get('val', '1')) * .8
            if meta.get('partOfSpeech') == '보조 동사': score -= 25
            usage[ko].append({'source': 'krdict', 'pos': meta.get('partOfSpeech', ''), 'meaning': meaning,
                'definition': definition, 'annotation': clean(feats(sense).get('annotation', '')),
                'phrases': unique(phrases, 8), 'sentences': unique(sentences, 6),
                'conversation': unique(dialogues, 3),
                'pronunciation': unique([feats(f).get('pronunciation', '') for f in seq(entry.get('WordForm'))], 3),
                'forms': unique([feats(f).get('writtenForm', '') for f in seq(entry.get('WordForm')) if feats(f).get('type') == '활용'], 6),
                'entryId': eid, 'senseId': str(sense.get('val', '')), '_score': score})
    print(name, 'read', flush=True)

result = {}
for w in words:
    ko = w['ko']; ranked = sorted(usage[ko], key=lambda s: -s['_score'])
    # A merged headword can have different source entries (e.g. 차다 = full,
    # cold, kick). Repeating six senses of the first meaning loses that depth.
    groups = collections.defaultdict(list)
    for s in ranked: groups[s['entryId']].append(s)
    senses = []
    while groups and len(senses) < 6:
        for eid in list(groups):
            senses.append(groups[eid].pop(0))
            if not groups[eid]: del groups[eid]
            if len(senses) == 6: break
    for s in senses: s.pop('_score')
    edited = [s for s in old.get(ko, []) if s['source'] == 'edited' or s.get('contextSource') == 'edited']
    # Manually corrected frequent homographs remain authoritative. The old
    # unrelated senses must not be reintroduced behind an expand button.
    result[ko] = edited if ko in manual else (edited + senses if edited else senses)
    if not result[ko]: result[ko] = old[ko]

(root / 'data/vocabulary-usage.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
main = set(x for d in read(root / 'data/immersion-index.json') for x in d['vocabulary'])
def contexts(ko):
    return set(text for s in result[ko] for text in s['sentences'] + s['conversation'])
stats = {'dictionaryRelease': '2026-09-19', 'archiveSha256': hashlib.sha256(Path(args.archive).read_bytes()).hexdigest(),
    'license': 'CC BY-SA 2.0 KR', 'headwords': len(result), 'mainWords': len(main),
    'sentenceAndDialogueContexts': sum(len(contexts(k)) for k in result),
    'mainWithAtLeastOne': sum(len(contexts(k)) >= 1 for k in main),
    'mainWithAtLeastThree': sum(len(contexts(k)) >= 3 for k in main),
    'mainWithAtLeastFive': sum(len(contexts(k)) >= 5 for k in main)}
(root / 'data/depth-usage-statistics.json').write_text(json.dumps(stats, ensure_ascii=False, indent=2) + '\n')
(Path('/tmp') / 'korean-depth-word-gaps.json').write_text(json.dumps([{'ko': k, 'zh': index[k]['zh'], 'level': index[k]['level'], 'existingContexts': len(contexts(k))} for k in sorted(main) if len(contexts(k)) < 3], ensure_ascii=False, indent=2))
print(json.dumps(stats, ensure_ascii=False, indent=2))
