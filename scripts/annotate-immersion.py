"""Compile machine annotations for every original course line (Kiwi 0.24.0).

Canonical lemmas contain dictionary headwords only. Legacy display bases are
replaced rather than interpreted as headwords. Context rules are agent-assisted
corrections, not independent native-speaker review. Ambiguous candidates are
kept outside the linking/coverage fields and never receive a guessed gloss.
"""
import json
import re
from pathlib import Path
from kiwipiepy import Kiwi

root = Path(__file__).resolve().parents[1]
read = lambda p: json.loads(p.read_text())
dictionary = {w['ko']: w for w in read(root / 'data/vocabulary.json')}
dialogues = read(root / 'data/curriculum/dialogues.json')
assets = [a for p in sorted((root / 'data/immersion').glob('*.json')) for a in read(p)]
decisions_file = read(root / 'data/curriculum/annotation-context-decisions.json')
decisions = {(d['ko'], d['surface']): d for d in decisions_file['decisions']}
excluded = set('민지 왕리 지수 리밍 수연 장웨이 현우 천위 린 린린 서준 류양 유진 왕신 다은 저우란 도윤 리나 은서 쑨메이 김 수진'.split())
grammar = {'JKS': '主语助词', 'JKO': '宾语助词', 'JKG': '所属助词',
           'JKB': '地点、时间或方式助词', 'JKC': '补语助词', 'JX': '补助词', 'JC': '连接助词',
           'VCP': '이다：是', 'VCN': '아니다：不是', 'EP': '时态或尊敬成分',
           'EF': '句末语尾', 'EC': '连接语尾', 'ETM': '修饰名词的语尾', 'ETN': '名词化语尾'}
kiwi = Kiwi(num_workers=2)
particles = sorted(['은', '는', '이', '가', '을', '를', '의', '에', '에서', '으로', '로',
                    '와', '과', '도', '만', '까지', '부터', '에게', '처럼', '에도', '에는',
                    '에서는', '으로는', '마다', '보다', '조차', '마저', '이나', '이며',
                    '이고', '입니다', '이란', '라는', '이라고', '라고', '께서'], key=len, reverse=True)

# Only these complete contexts were reviewed for a spaced dictionary phrase.
# Do not turn all adjacent nouns, or future editorial candidates, into rules.
# The canonical headword is carried by the first Word; linkedSpans preserves
# which original words its meaning actually covers.
reviewed_spaced_phrases = [
    {'headword': '직행버스', 'reviewedLineId': 'w12d2-5',
     'ko': '직행 버스는 조금 늦게 도착하는 대신 환승이 없어요.',
     'wordStart': 0, 'surfaceTokens': ['직행', '버스는'],
     'lexicalComponents': ['직행', '버스']},
    {'headword': '생활환경', 'reviewedLineId': 'w17d2-8',
     'ko': '네. 비용, 시간, 생활 환경 중 무엇을 우선할지 정하고 비교해 보세요.',
     'wordStart': 3, 'surfaceTokens': ['생활', '환경'],
     'lexicalComponents': ['생활', '환경']},
    {'headword': '정보공개', 'reviewedLineId': 'w21d2-6',
     'ko': '맞아요. 개인의 소비 태도를 탓하는 데 그치지 않고 생산 정보 공개와 공급 구조의 개선도 논의해야 해요.',
     'wordStart': 9, 'surfaceTokens': ['정보', '공개와'],
     'lexicalComponents': ['정보', '공개']},
    {'headword': '분배효과', 'reviewedLineId': 'w22d3-deep-w19-22-42-2',
     'ko': '오늘 사례의 임대료와 인원은 실제 지역을 조사한 결과가 아니라 분배 효과를 설명하기 위한 가정이며, 공원 조성 전후의 변화와 그 원인을 구분하는 데 초점을 맞추겠습니다.',
     'wordStart': 9, 'surfaceTokens': ['분배', '효과를'],
     'lexicalComponents': ['분배', '효과']},
    {'headword': '고령인구', 'reviewedLineId': 'w25d1-1',
     'ko': '고령 인구가 늘어난다는 기사를 보면 늘 부담이 커진다는 표현이 나와요.',
     'wordStart': 0, 'surfaceTokens': ['고령', '인구가'],
     'lexicalComponents': ['고령', '인구']},
    {'headword': '무급노동', 'reviewedLineId': 'w21d5-deep-w19-22-34-5',
     'ko': '무급 노동을 시간당 만오천 원으로 환산하면 두 사람의 가사 기여는 각각 삼십만 원과 칠만오천 원이 되지만, 이 금액은 설명을 위한 가상의 단가를 적용한 결과입니다.',
     'wordStart': 0, 'surfaceTokens': ['무급', '노동을'],
     'lexicalComponents': ['무급', '노동']},
    {'headword': '개인정보보호', 'reviewedLineId': 'w23d3-immersion-162-27',
     'ko': '감시에는 개인정보 보호의 조건도 필요하다.',
     'wordStart': 1, 'surfaceTokens': ['개인정보', '보호의'],
     'lexicalComponents': ['개인정보', '보호']},
    {'headword': '행동변화', 'reviewedLineId': 'w26d3-3',
     'ko': '하나는 시행 직후 만족도를, 다른 하나는 일 년 뒤 행동 변화를 봤네요.',
     'wordStart': 9, 'surfaceTokens': ['행동', '변화를'],
     'lexicalComponents': ['행동', '변화']},
    {'headword': '칠월', 'reviewedLineId': 'w12d1-immersion-59-5',
     'ko': '칠 월 팔 일부터라고 나옵니다.',
     'wordStart': 0, 'surfaceTokens': ['칠', '월'],
     'lexicalComponents': ['칠', '월']},
    {'headword': '십일월', 'reviewedLineId': 'w03d1-5',
     'ko': '십일 월 십이 일로 적었어요.',
     'wordStart': 0, 'surfaceTokens': ['십일', '월'],
     'lexicalComponents': ['십일', '월']},
]
round4_index = read(root / 'data/curriculum/round4-index-decisions.json')
round5_index = read(root / 'data/curriculum/round5-index-decisions.json')
reviewed_spaced_phrases.extend(round4_index['phrases'])
spaced_review = {
    (entry['headword'], entry['lineId']): entry
    for entry in [*read(root / 'data/curriculum/index-link-review.json')['candidates'],
                  *round4_index['phrases']]
}
reviewed_form_aliases = {(entry['ko'], entry['wordIndex'], entry['surface']): entry
                         for entry in [*round4_index['aliases'], *round5_index['aliases']]}
reviewed_unlisted_forms = {(entry['ko'], entry['wordIndex'], entry['surface']): entry
                          for entry in round5_index['unlisted']}
spaced_rules_by_text = {}
for rule in reviewed_spaced_phrases:
    evidence = spaced_review.get((rule['headword'], rule['reviewedLineId']))
    if (not evidence or evidence['verdict'] != 'valid'
            or evidence['ko'] != rule['ko']
            or evidence['surfaceTokens'] != rule['surfaceTokens']
            or rule['headword'] not in dictionary
            or evidence['vocabulary']['zh'] != dictionary[rule['headword']]['zh']):
        raise ValueError('Reviewed spaced phrase no longer matches its evidence: '
                         + rule['headword'])
    spaced_rules_by_text.setdefault(rule['ko'], []).append(rule)


def link_reviewed_spaced_phrases(ko, words):
    for rule in spaced_rules_by_text.get(ko, []):
        start = rule['wordStart']
        end = start + len(rule['surfaceTokens'])
        if (start < 0 or end > len(words)
                or [word['text'] for word in words[start:end]] != rule['surfaceTokens']):
            raise ValueError('Reviewed phrase token boundaries changed: '
                             + rule['reviewedLineId'])
        anchor = words[start]
        if anchor['annotation']['status'] == 'ambiguous':
            raise ValueError('Reviewed phrase cannot erase an ambiguous token: '
                             + rule['reviewedLineId'])
        previous_spans = anchor['annotation'].get('linkedSpans', [])
        if any(span['headword'] == rule['headword']
               and span['wordStart'] == start and span['wordEnd'] == end
               for span in previous_spans):
            continue
        headword = rule['headword']
        surface = ' '.join(rule['surfaceTokens'])
        span = {
            'headword': headword, 'wordStart': start, 'wordEnd': end,
            'surfaceTokens': list(rule['surfaceTokens']), 'surface': surface,
            'lexicalComponents': list(rule['lexicalComponents']),
            'reviewedLineId': rule['reviewedLineId'],
            'meaning': dictionary[headword]['zh'],
        }
        if headword not in anchor['lemmas']:
            anchor['lemmas'] = [*anchor['lemmas'], headword]
        anchor['base'] = ' · '.join(anchor['lemmas'])
        phrase_meaning = f"词组 {surface} → {headword}：{span['meaning']}"
        anchor['meaning'] = ' / '.join(
            value for value in (anchor['meaning'], phrase_meaning) if value)
        phrase_note = (f"本句词组 {surface} 对应词条 {headword}；"
                       "整组释义不表示第一个词形单独有这个意思。")
        anchor['note'] = '；'.join(
            value for value in (anchor['note'], phrase_note) if value)
        anchor['annotation'] = {
            **anchor['annotation'], 'status': 'linked', 'method': 'machine-rule',
            'confidence': 'machine-supported', 'rule': 'reviewed-spaced-phrase',
            'linkedSpans': [*previous_spans, span],
        }
    return words


# 드세요 is also the contracted polite form of the adjective 드세다.
# Only these reviewed complete food/medicine contexts authorize the honorific
# consumption reading; do not guess from the ending or a nearby adverb alone.
reviewed_consumption_deuseyo = {
    '오래 기다리지 마세요. 먼저 드세요.': '吃',
    '여기서 드세요?': '吃',
    '맛있게 드세요.': '吃',
    '아직 덜 익었어요. 이틀 뒤에 드세요.': '吃',
    '네. 김밥은 여기서 드세요?': '吃',
    '여기 나왔어요. 천천히 드세요.': '吃',
    '처방전에 적힌 대로 드세요.': '服用',
}


def dictionary_surface(surface):
    if surface in dictionary and surface not in excluded:
        return surface
    for particle in particles:
        if surface.endswith(particle):
            base = surface[:-len(particle)]
            if base in dictionary and base not in excluded and not base.endswith('다'):
                return base
    return None


def lexical(tokens):
    out, skipped = [], set()
    for i, t in enumerate(tokens):
        if i in skipped:
            continue
        tag, base = t.tag.split('-')[0], t.form
        # Calendar months and 잘하다 can be split inside one eojeol. Never
        # combine these across spaces: lexical() receives one original word.
        if i + 1 < len(tokens):
            following = tokens[i + 1]
            if (tag == 'NR' and following.form == '월'
                    and following.tag.split('-')[0] == 'NNB'
                    and base + '월' in {'일월', '이월', '삼월', '사월', '오월', '유월',
                                       '칠월', '팔월', '구월', '시월', '십일월', '십이월'}):
                base += '월'
                skipped.add(i + 1)
            elif (tag == 'MAG' and base == '잘' and following.form == '하'
                  and following.tag.split('-')[0] in ('XSV', 'VV')):
                base = '잘하다'
                skipped.add(i + 1)
        if tag in ('NNG', 'NNP', 'NNB', 'NP', 'NR', 'MM', 'MAG', 'MAJ', 'IC', 'XR', 'XPN'):
            # Kiwi separates adjective roots such as 따뜻/XR + 하/XSA.
            # Preserve the lexical root rather than teaching 하다 for 따뜻한.
            # Prefix + root + nominal suffix also forms registered compounds
            # such as 불/XPN + 확실/XR + 성/XSN -> 불확실성.
            combined = False
            for j in range(min(len(tokens), i + 4), i, -1):
                span = tokens[i:j]
                components = ('NNG', 'NNP', 'NNB', 'XR', 'XPN', 'XSN', 'XSV', 'XSA')
                if (not all(x.tag.split('-')[0] in components for x in span[:-1])
                        or span[-1].tag.split('-')[0] not in (*components, 'VV', 'VA')):
                    continue
                compound = ''.join(x.form for x in span)
                if span[-1].tag.split('-')[0] in ('XSV', 'XSA', 'VV', 'VA'):
                    compound += '다'
                if compound in dictionary and (tag not in ('XR', 'XPN') or len(span) > 1):
                    base = compound
                    skipped.update(range(i + 1, j))
                    combined = True
                    break
            # A bound prefix/root is not an independent dictionary usage.
            # 미/XPN in 미완성 must never count as 미 "beauty", for example.
            if tag in ('XR', 'XPN') and not combined:
                continue
        elif tag in ('VV', 'VA', 'VX'):
            base += '다'
        else:
            continue
        if base in dictionary and base not in excluded and base not in out:
            out.append(base)
    return out


def annotate(ko):
    tokens = kiwi.tokenize(ko)
    matches = list(re.finditer(r'\S+', ko))
    words = []
    for n, match in enumerate(matches):
        surface = re.sub(r'^[^가-힣]+|[^가-힣]+$', '', match.group())
        local_tokens = [t for t in tokens if match.start() <= t.start < match.end()]
        bases = lexical(local_tokens)
        exact = dictionary_surface(surface)
        # Compound lookup can repair morphology splits. It must not erase
        # contextual noun+particle analysis when the entire inflected surface
        # also happens to be an unrelated dictionary headword:
        # 귀/NNG + 가/JKS means "the ear", not 귀가/NNG "returning home".
        morphs = [t for t in local_tokens if t.tag.split('-')[0] not in ('SF', 'SP', 'SSO', 'SSC', 'SE', 'SO', 'SW')]
        inflected_homograph = (
            exact == surface and bases and len(morphs) == 2
            and morphs[0].tag.split('-')[0] in ('NNG', 'NNP', 'NNB', 'NP')
            and morphs[1].tag.split('-')[0] in ('JKS', 'JKO', 'JKC')
            and exact not in bases
        )
        if (exact and not inflected_homograph
                and not any(t.tag.split('-')[0] in ('VV', 'VA', 'VX') for t in local_tokens)):
            bases = [exact]
        note = '；'.join(dict.fromkeys(grammar[t.tag.split('-')[0]] for t in local_tokens
                                     if t.tag.split('-')[0] in grammar))
        annotation = {'status': 'linked' if bases else 'unlinked', 'method': 'morphology',
                      'confidence': 'machine-supported' if bases else 'uncertain'}
        meaning = ' / '.join(f"{b}：{dictionary[b]['zh']}" for b in bases)
        # These honorific inflections cannot be the unrelated noun 계.
        if re.match(r'^계(?:세요|셔|셨|신|시고|시지|시는|십)', surface):
            bases = ['계시다']
            meaning = '계시다：在、存在（있다 的尊敬表达）'
            note = '在或存在的尊敬表达；本句不是“계（计、互助会）”。'
            annotation = {'status': 'linked', 'method': 'machine-rule',
                          'confidence': 'machine-supported', 'rule': 'honorific-gye-si-da'}
        elif surface == '드세요' and ko in reviewed_consumption_deuseyo:
            bases = ['드시다']
            meaning = f"드시다：{reviewed_consumption_deuseyo[ko]}（먹다 的尊敬表达；本句）"
            note = '本句是吃或服用的尊敬表达；不是“드세다（厉害、繁重）”。'
            annotation = {'status': 'linked', 'method': 'machine-rule',
                          'confidence': 'machine-supported',
                          'rule': 'honorific-consumption-deuseyo-context'}
        elif (ko == '마음에 드시면 이걸로 드릴게요.' and surface == '드시면'):
            bases = ['들다']
            meaning = '들다：中意、满意（本句为 마음에 들다）'
            note = '마음에 들다：喜欢、中意；시 是尊敬成分。'
            annotation = {'status': 'linked', 'method': 'machine-rule',
                          'confidence': 'machine-supported',
                          'rule': 'liking-maeume-deulsimyeon-context'}
        elif (ko == '분리수거가 잘 안돼서 답답해요.' and surface == '안돼서'):
            bases = ['안되다']
            meaning = '안되다：不顺、未顺利进行（本句指垃圾分类做得不好）'
            note = '안되다 的动词义：事情未顺利进行；-어서 表示原因。'
            annotation = {'status': 'linked', 'method': 'machine-rule',
                          'confidence': 'machine-supported',
                          'rule': 'sorting-not-going-well-andoeda-context'}
        elif (ko == '과정을 절반이나 들었는데 그만두기 아까워.' and surface == '들었는데'):
            bases = ['듣다']
            meaning = '듣다：听课、修习课程（本句）'
            note = '듣다 的 ㄷ 不规则活用：들- + -었- + -는데；本句说课程已学过一半。'
            annotation = {'status': 'linked', 'method': 'machine-rule',
                          'confidence': 'machine-supported', 'rule': 'reviewed-course-listening-context'}
        elif (ko == '그러나 기존 점검표에는 전구를 교체한 날짜만 적혀 있고 배선이나 등기구를 살펴본 기록은 없었다.'
              and surface in ('배선이나', '등기구를')):
            bases = []
            meaning = ''
            note = ('本句 배선 指电线布设或线路，-이나 是列举助词；完整复合词未收入本词表。'
                    if surface == '배선이나' else
                    '本句 등기구 指照明器具，-를 是宾语助词；完整复合词未收入本词表。')
            annotation = {'status': 'unlinked', 'method': 'machine-rule',
                          'confidence': 'uncertain', 'rule': 'reviewed-unlisted-electrical-compound',
                          'reason': '完整词形未收录，保留语境提示，不将未经确认的拆词计作词头覆盖。'}
        elif surface == '사는':
            decision = decisions.get((ko, surface))
            previous = matches[n - 1].group() if n else ''
            if decision:
                bases = decision['lemmas']
                meaning = decision['meaning']
                annotation = {'status': 'linked', 'method': 'machine-rule',
                              'confidence': 'machine-supported', 'rule': decision['rule']}
            elif (re.search(r'[을를]$', previous) or '현금으로 사는' in ko or '사는 물건' in ko
                  or (previous in ('자주', '가끔') and n >= 2
                      and re.search(r'[을를]$', matches[n - 2].group()))):
                bases = ['사다']
                meaning = '사다：购买（本句）'
                annotation = {'status': 'linked', 'method': 'machine-rule',
                              'confidence': 'machine-supported', 'rule': 'buying-sa-neun-object'}
            else:
                bases, meaning, note = [], '', ''
                annotation = {'status': 'ambiguous', 'method': 'machine-rule',
                              'confidence': 'uncertain', 'rule': 'sa-neun-unresolved',
                              'candidates': ['살다', '사다'],
                              'reason': '本处词义需结合整句判断。'}
        alias = reviewed_form_aliases.get((ko, n, match.group()))
        if alias:
            if bases != alias['originalLemmas']:
                raise ValueError('Reviewed form alias lost its original morphology: ' + alias['lineId'])
            bases = ([alias['headword']] if alias['action'] == 'replace'
                     else [*bases, alias['headword']])
            meaning = (alias['meaning'] if alias['action'] == 'replace'
                       else meaning + ' / ' + alias['meaning'])
            note = alias['note']
            annotation = {'status': 'linked', 'method': 'machine-rule',
                          'confidence': 'machine-supported', 'rule': 'reviewed-exact-form-alias',
                          'reason': '精确原句词形核定；未泛化到其他同形用法。'}
        unlisted = reviewed_unlisted_forms.get((ko, n, match.group()))
        if unlisted:
            if bases != unlisted['originalLemmas']:
                raise ValueError('Reviewed unlisted form lost its original morphology: ' + unlisted['lineId'])
            bases, meaning, note = [], '', unlisted['note']
            annotation = {'status': 'unlinked', 'method': 'machine-rule',
                          'confidence': 'uncertain', 'rule': 'reviewed-exact-unlisted-form',
                          'reason': unlisted['reason']}
        words.append({'text': match.group(), 'base': ' · '.join(bases), 'lemmas': bases,
                      'meaning': meaning, 'note': note, 'annotation': annotation})
    return link_reviewed_spaced_phrases(ko, words)



def main():
    annotations = {}
    for source in [*dialogues, *assets]:
        for line in source['lines']:
            ko = line['ko']
            if ko not in annotations:
                annotations[ko] = annotate(ko)

    # Persist canonical annotations in original scenes too, preserving text, IDs,
    # translations and audio chunks. No old display base can become a headword.
    for dialogue in dialogues:
        for line in dialogue['lines']:
            old_words = {w['text']: w for w in line.get('words', [])}
            words = [dict(w) for w in annotations[line['ko']]]
            for word in words:
                old = old_words.get(word['text'], {})
                if dialogue['week'] == 1 and word['text'] in ('새', '씨'):
                    word['meaning'] = old.get('meaning', word['meaning'])
                    word['note'] = old.get('note', word['note'])
            line['words'] = words
            annotations[line['ko']] = words

    (root / 'data/curriculum/dialogues.json').write_text(json.dumps(dialogues, ensure_ascii=False, separators=(',', ':')) + '\n')
    (root / 'data/immersion-annotations.json').write_text(json.dumps(annotations, ensure_ascii=False, separators=(',', ':')) + '\n')
    linked = {b for ws in annotations.values() for w in ws for b in w['lemmas']}
    ambiguous = sum(w['annotation']['status'] == 'ambiguous' for ws in annotations.values() for w in ws)
    unlinked = sum(w['annotation']['status'] == 'unlinked' for ws in annotations.values() for w in ws)
    print(f'Annotated {len(annotations)} distinct course texts; {len(linked)} linked headwords; {ambiguous} ambiguous and {unlinked} unlinked tokens. No independent human review claimed.')


if __name__ == "__main__":
    main()
