"""Optional build-time checks; uses the already configured Kiwi environment.

Run: python scripts/annotation-rules.test.py. The ordinary Node course checks
only read committed annotations and do not require Python or the Kiwi model.
"""
import importlib.util
import copy
import json
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('course_annotation_rules', Path(__file__).with_name('annotate-immersion.py'))
rules = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rules)

# Editorial evidence is independent of the implementation whitelist. Keep the
# expected bounds explicit so that an accidental rule/table shift is visible.
review = json.loads((Path(__file__).resolve().parent.parent / 'data/curriculum/index-link-review.json').read_text())['candidates']
reviewed_bounds = {
    '직행버스': (0, 2, ['직행', '버스']),
    '생활환경': (3, 5, ['생활', '환경']),
    '정보공개': (9, 11, ['정보', '공개']),
    '분배효과': (9, 11, ['분배', '효과']),
    '고령인구': (0, 2, ['고령', '인구']),
    '무급노동': (0, 2, ['무급', '노동']),
    '개인정보보호': (1, 3, ['개인정보', '보호']),
    '행동변화': (9, 11, ['행동', '변화']),
    '칠월': (0, 2, ['칠', '월']),
    '십일월': (0, 2, ['십일', '월']),
}


class ContextRules(unittest.TestCase):
    def token(self, sentence, text):
        return next(word for word in rules.annotate(sentence) if word['text'] == text)

    def test_reviewed_guidance_noun_is_not_negative_pay(self):
        for ko in ['안내는 선택으로 두고 독서 모임은 따로 검토할게요.',
                   '안내는 당사자가 이해하는 언어로 제공할 수 있다.']:
            self.assertEqual(self.token(ko, '안내는')['lemmas'], ['안내'])
        for ko in ['회비를 안내는 사람이 있어요.', '회비를 안 내는 사람이 있어요.']:
            words = rules.annotate(ko)
            self.assertNotIn('안내', [b for w in words for b in w['lemmas']])
            self.assertIn('내다', [b for w in words for b in w['lemmas']])

    def test_unlisted_guide_keeps_its_whole_word_without_false_negative_pay_links(self):
        ko = '팀은 공개 날짜와 마지막 수정 날짜를 나란히 표시하고, 이용자가 변경된 상황을 알려 주면 담당자가 확인한 뒤 수정하는 절차도 안내서 안에 포함했습니다.'
        token = self.token(ko, '안내서')
        self.assertEqual(token['lemmas'], [])
        self.assertEqual(token['annotation']['status'], 'unlinked')
        self.assertIn('指南', token['note'])
        self.assertEqual(' '.join(w['text'] for w in rules.annotate(ko)), ko)
        self.assertIn('내다', self.token('돈을 안내서 문제가 생겼어요.', '안내서')['lemmas'])

    def test_correct_facts_is_not_the_adverb_and_grasp_verbs(self):
        ko = '네. 감정은 존중하면서 확인 가능한 사실은 정확히 바로잡으면 됩니다.'
        self.assertEqual(self.token(ko, '바로잡으면')['lemmas'], ['바로잡다'])
        words = rules.annotate('서류를 바로 잡으면 구겨져요.')
        self.assertNotIn('바로잡다', [b for w in words for b in w['lemmas']])
        self.assertIn('잡다', self.token('서류를 바로 잡으면 구겨져요.', '잡으면')['lemmas'])

    def test_registered_derived_predicates_keep_components_in_reviewed_source_contexts(self):
        for ko, surface, expected in [
            ('보관 장소가 정해지면 연락드리겠습니다.', '정해지면', ['정하다', '지다', '정해지다']),
            ('작은 금액도 여러 번 쓰면 많아지잖아요.', '많아지잖아요.', ['많다', '지다', '많아지다']),
            ('오늘 기분이 좋아져서 괜찮다고 생각했어요.', '좋아져서', ['좋다', '지다', '좋아지다']),
            ('네. 아침보다 지금 통증이 심해졌어요.', '심해졌어요.', ['심하다', '지다', '심해지다']),
            ('자료가 만들어진 조건을 밝혀야 한다.', '만들어진', ['만들다', '지다', '만들어지다']),
            ('그런 사람에게는 설명이 부족하게 느껴질 수 있어요.', '느껴질', ['느끼다', '지다', '느껴지다']),
            ('뒤로 돌아서 초록색 안내를 따라가세요.', '돌아서', ['돌다', '돌아서다'])]:
            self.assertEqual(self.token(ko, surface)['lemmas'], expected)
            self.assertEqual(' '.join(w['text'] for w in rules.annotate(ko)), ko)
        for ko in ['계획을 정해요.', '돈이 많아요.', '기분이 좋아요.', '새 상자를 만들어요.', '몸이 뜨겁다고 느꼈어요.', '집 앞에서 돌아서 다시 걸어요.']:
            self.assertTrue(all(w['annotation'].get('rule') != 'reviewed-exact-form-alias'
                                for w in rules.annotate(ko)))

    def test_all_registered_predicate_links_match_frozen_original_boundaries(self):
        for decision in rules.round5_index['aliases']:
            words = rules.annotate(decision['ko'])
            token = words[decision['wordIndex']]
            self.assertEqual(token['text'], decision['surface'])
            expected = ([decision['headword']] if decision['action'] == 'replace'
                        else decision['originalLemmas'] + [decision['headword']])
            self.assertEqual(token['lemmas'], expected)
            changed = rules.annotate(decision['ko'] + ' 확인해 주세요.')
            self.assertNotEqual(changed[decision['wordIndex']]['annotation'].get('rule'), 'reviewed-exact-form-alias')

    def test_morphology_candidate_is_not_a_license_to_link_unfavourable_as_called(self):
        for ko, surface in [('처리 순서가 달라져 불리해지면 안 되죠.', '불리해지면'),
                            ('몸에 좋은 것을 불려서 먹었어요.', '불려서')]:
            token = self.token(ko, surface)
            self.assertNotEqual(token['annotation'].get('rule'), 'reviewed-exact-form-alias')
        token = self.token('처리 순서가 달라져 불리해지면 안 되죠.', '불리해지면')
        self.assertIn('불리하다', token['lemmas'])
        self.assertNotIn('불리다', token['lemmas'])

    def test_yesterday_evening_spans_keep_both_words_and_time_particle(self):
        for ko in ['어제 저녁부터 목이 아프고 기침이 나요.', '어제 저녁부터 조금 아팠습니다.']:
            words = rules.annotate(ko)
            self.assertEqual([w['text'] for w in words[:2]], ['어제', '저녁부터'])
            self.assertIn('어제저녁', words[0]['lemmas'])
            span = words[0]['annotation']['linkedSpans'][0]
            self.assertEqual((span['wordStart'], span['wordEnd']), (0, 2))
            self.assertEqual(span['surface'], '어제 저녁부터')
            self.assertEqual(span['lexicalComponents'], ['어제', '저녁'])
        words = rules.annotate('어제 왔어요. 저녁부터 일해요.')
        self.assertNotIn('어제저녁', [b for w in words for b in w['lemmas']])

    def test_reviewed_good_interjection_is_not_adjective_good(self):
        for ko in ['좋아. 두 달 뒤에 진도가 너무 밀리면 날짜를 다시 생각하는 걸로?',
                   '좋아. 혹시 같이 준비하는 건 도와줄 수 있어? 음식을 옮길 손이 부족해서.']:
            self.assertEqual(self.token(ko, '좋아.')['lemmas'], ['좋아'])
        for ko, surface in [('날씨가 좋아.', '좋아.'), ('기분이 좋아 보여요.', '좋아')]:
            token = self.token(ko, surface)
            self.assertIn('좋다', token['lemmas'])
            self.assertNotIn('좋아', token['lemmas'])

    def test_exact_contractions_keep_real_morphological_heads(self):
        cases = [('새 동네의 생활 시설은 어때?', '어때?', ['어떻다', '어때']),
                 ('그래야 다음에 바꿀 수 있는 부분을 찾을 수 있어.', '그래야', ['그렇다', '그래야']),
                 ('그래야 좋은 소비를 소득이 높은 사람만 실천할 수 있는 도덕적 기준으로 만들지 않을 수 있죠.', '그래야', ['그렇다', '그래야']),
                 ('그래야 절약을 호소하는 데서 나아가 실제로 선택할 수 있는 조건을 만들 수 있습니다.', '그래야', ['그렇다', '그래야']),
                 ('그렇지는 않아요. 전체 규모를 볼 때 평균도 유용하고, 어느 수치든 분포의 모든 모습을 보여 주지는 못해요.', '그렇지는', ['그렇다', '그렇지'])]
        for ko, surface, expected in cases:
            self.assertEqual(self.token(ko, surface)['lemmas'], expected)
        for ko, surface in [('그렇지! 잘했어.', '그렇지!'), ('다른 동네는 어때?', '어때?')]:
            self.assertNotEqual(self.token(ko, surface)['annotation'].get('rule'), 'reviewed-exact-form-alias')

    def test_next_calendar_day_and_quantity_are_not_forced_into_other_senses(self):
        for ko, head in [('다음 날 다시 만나요.', '다음날'), ('물 한 잔 주세요.', '한잔'), ('이 마을은 조용해요.', '이마')]:
            self.assertNotIn(head, [b for w in rules.annotate(ko) for b in w['lemmas']])

    def test_reviewed_course_attendance_uses_listen_not_enter_or_lift(self):
        ko = '과정을 절반이나 들었는데 그만두기 아까워.'
        token = self.token(ko, '들었는데')
        self.assertEqual(token['lemmas'], ['듣다'])
        self.assertIn('课程', token['meaning'])
        self.assertEqual(' '.join(w['text'] for w in rules.annotate(ko)), ko)

    def test_course_listening_rule_does_not_rewrite_other_deureot_contexts(self):
        for ko in ['가방을 들었는데 무거워요.', '방에 들었는데 아무도 없어요.']:
            with self.subTest(ko=ko):
                token = self.token(ko, '들었는데')
                self.assertNotEqual(token['annotation'].get('rule'), 'reviewed-course-listening-context')
                self.assertNotIn('듣다', token['lemmas'])

    def test_reviewed_unlisted_wiring_and_lighting_are_not_fake_coverage(self):
        ko = '그러나 기존 점검표에는 전구를 교체한 날짜만 적혀 있고 배선이나 등기구를 살펴본 기록은 없었다.'
        for surface in ['배선이나', '등기구를']:
            token = self.token(ko, surface)
            self.assertEqual(token['lemmas'], [])
            self.assertEqual(token['annotation']['status'], 'unlinked')
            self.assertIn('本句', token['note'])
        self.assertEqual(' '.join(w['text'] for w in rules.annotate(ko)), ko)
        self.assertIn('배', self.token('배가 아파요.', '배가')['lemmas'])
        self.assertIn('기구', self.token('기구를 쓰세요.', '기구를')['lemmas'])

    def test_calendar_month_inside_one_eojeol_keeps_its_headword(self):
        token = self.token('사진 날짜를 보니 사월이네요. 다른 여행과 섞인 게 아닐까요?', '사월이네요.')
        self.assertEqual(token['lemmas'], ['사월'])
        self.assertIn('四月', token['meaning'])
        words = rules.annotate('사 원이 있어요. 사 월에 가요.')
        self.assertNotIn('사월', [b for w in words for b in w['lemmas']])

    def test_well_done_is_registered_predicate_not_only_the_adverb(self):
        token = self.token('잘했어요. 이제 다시 들어요.', '잘했어요.')
        self.assertEqual(token['lemmas'], ['잘하다'])
        self.assertNotIn('하다', token['lemmas'])
        self.assertEqual(self.token('잘 들어요.', '잘')['lemmas'], ['잘'])

    def test_contracted_complement_thing_does_not_become_crab(self):
        token = self.token('사진 날짜를 보니 사월이네요. 다른 여행과 섞인 게 아닐까요?', '게')
        self.assertEqual(token['lemmas'], ['것'])
        self.assertIn('补语助词', token['note'])
        self.assertNotIn('螃蟹', token['meaning'])
        self.assertEqual(self.token('게 요리를 먹어요.', '게')['lemmas'], ['게'])
        self.assertEqual(self.token('게가 바다에 있어요.', '게가')['lemmas'], ['게'])

    def test_unseen_ambiguous_reading_is_not_guessed(self):
        token = self.token('함께 사는 사람이 있어요.', '사는')
        self.assertEqual(token['lemmas'], [])
        self.assertEqual(token['base'], '')
        self.assertEqual(token['meaning'], '')
        self.assertEqual(token['annotation']['status'], 'ambiguous')
        self.assertEqual(token['annotation']['candidates'], ['살다', '사다'])

    def test_honorific_is_not_unrelated_noun(self):
        token = self.token('아버지가 집에 계세요.', '계세요.')
        self.assertEqual(token['lemmas'], ['계시다'])
        self.assertNotIn('이다', token['note'])

    def test_reviewed_consumption_deuseyo_is_not_a_strong_adjective(self):
        for sentence, text, meaning in [
            ('오래 기다리지 마세요. 먼저 드세요.', '드세요.', '吃'),
            ('여기서 드세요?', '드세요?', '吃'),
            ('맛있게 드세요.', '드세요.', '吃'),
            ('아직 덜 익었어요. 이틀 뒤에 드세요.', '드세요.', '吃'),
            ('네. 김밥은 여기서 드세요?', '드세요?', '吃'),
            ('여기 나왔어요. 천천히 드세요.', '드세요.', '吃'),
            ('처방전에 적힌 대로 드세요.', '드세요.', '服用'),
        ]:
            with self.subTest(sentence=sentence):
                words = rules.annotate(sentence)
                self.assertEqual(' '.join(word['text'] for word in words), sentence)
                token = next(word for word in words if word['text'] == text)
                self.assertEqual(token['lemmas'], ['드시다'])
                self.assertEqual(token['base'], '드시다')
                self.assertIn(meaning, token['meaning'])
                self.assertIn('尊敬', token['meaning'])
                self.assertNotIn('厉害', token['meaning'])
                self.assertEqual(token['annotation']['rule'], 'honorific-consumption-deuseyo-context')

    def test_true_strong_adjective_and_carrying_are_not_rewritten_as_eating(self):
        for sentence, text in [
            ('바람이 드세요.', '드세요.'),
            ('성격이 드세요.', '드세요.'),
            ('드센 바람이 불어요.', '드센'),
            ('비가 드세게 와요.', '드세게'),
            ('일이 드세서 힘들어요.', '드세서'),
        ]:
            with self.subTest(sentence=sentence):
                token = self.token(sentence, text)
                self.assertEqual(token['lemmas'], ['드세다'])
                self.assertNotIn('honorific-consumption', token['annotation'].get('rule', ''))
        self.assertEqual(self.token('가방을 드세요.', '드세요.')['lemmas'], ['들다'])
        self.assertEqual(self.token('마음에 드세요?', '드세요?')['lemmas'], ['들다'])

    def test_reviewed_liking_context_is_not_consumption(self):
        words = rules.annotate('마음에 드시면 이걸로 드릴게요.')
        token = next(word for word in words if word['text'] == '드시면')
        self.assertEqual(token['lemmas'], ['들다'])
        self.assertEqual(token['base'], '들다')
        self.assertIn('中意', token['meaning'])
        self.assertNotIn('吃', token['meaning'])
        self.assertIn('尊敬成分', token['note'])
        self.assertEqual(token['annotation']['rule'], 'liking-maeume-deulsimyeon-context')
        self.assertEqual(words[-1]['lemmas'], ['드리다'])

    def test_other_correct_consumption_inflections_are_preserved(self):
        for sentence, text in [
            ('좋아요. 못 드시는 음식이 있으면 알려 주세요.', '드시는'),
            ('평소에 드시는 약이 있어요?', '드시는'),
            ('약을 드시고 푹 쉬세요.', '드시고'),
            ('한 분이 드시기에 충분합니다.', '드시기에'),
            ('오늘 드실 과일을 찾으세요?', '드실'),
        ]:
            with self.subTest(sentence=sentence):
                token = self.token(sentence, text)
                self.assertEqual(token['lemmas'], ['드시다'])
                self.assertEqual(token['annotation']['method'], 'morphology')

    def test_reviewed_sorting_failure_uses_not_going_well_andoeda(self):
        sentence = '분리수거가 잘 안돼서 답답해요.'
        words = rules.annotate(sentence)
        self.assertEqual(' '.join(word['text'] for word in words), sentence)
        token = next(word for word in words if word['text'] == '안돼서')
        self.assertEqual(token['lemmas'], ['안되다'])
        self.assertEqual(token['base'], '안되다')
        self.assertIn('不顺', token['meaning'])
        self.assertIn('垃圾分类', token['meaning'])
        self.assertEqual(token['annotation']['rule'], 'sorting-not-going-well-andoeda-context')

    def test_negative_permission_and_unreviewed_context_are_not_combined(self):
        for sentence in [
            '오전은 되고 오후는 안 돼요.',
            '사진을 찍으면 안 돼요.',
            '분리수거가 잘 안돼서 걱정이에요.',
        ]:
            with self.subTest(sentence=sentence):
                words = rules.annotate(sentence)
                self.assertNotIn('안되다', [base for word in words for base in word['lemmas']])
                self.assertIn('되다', [base for word in words for base in word['lemmas']])

    def test_accusative_object_supports_purchase(self):
        token = self.token('책을 사는 사람이 있어요.', '사는')
        self.assertEqual(token['lemmas'], ['사다'])
        self.assertIn('购买', token['meaning'])

    def test_legacy_inflection_is_a_dictionary_root(self):
        tokens = rules.annotate('세 시에 만나요.')
        self.assertEqual([word['lemmas'] for word in tokens], [['세'], ['시'], ['만나다']])

    def test_adjective_derivation_keeps_full_root(self):
        for sentence, text, root in [
            ('따뜻한 차를 주세요.', '따뜻한', '따뜻하다'),
            ('복잡한 설명은 어려워요.', '복잡한', '복잡하다'),
            ('따뜻하게 해 주세요.', '따뜻하게', '따뜻하다'),
            ('복잡해져서 이해하기 어려워요.', '복잡해져서', '복잡하다'),
        ]:
            with self.subTest(sentence=sentence):
                token = self.token(sentence, text)
                self.assertIn(root, token['lemmas'])
                self.assertNotIn('하다', token['lemmas'])

    def test_noun_particle_homograph_does_not_override_context(self):
        token = self.token('소리가 커서 귀가 아파요.', '귀가')
        self.assertEqual(token['lemmas'], ['귀'])
        self.assertIn('耳', token['meaning'])
        self.assertNotIn('回家', token['meaning'])

    def test_returning_home_remains_its_own_headword(self):
        token = self.token('귀가 시간이 늦어요.', '귀가')
        self.assertEqual(token['lemmas'], ['귀가'])
        self.assertIn('回家', token['meaning'])

    def test_prefix_compound_remains_registered_headword(self):
        token = self.token('불확실성 때문에 걱정돼요.', '불확실성')
        self.assertEqual(token['lemmas'], ['불확실성'])

    def test_bound_prefix_does_not_become_unrelated_headword(self):
        for sentence, text, forbidden in [
            ('미완성 과정은 사진으로 설명할 수도 있죠.', '미완성', '미'),
            ('무작정 미루면 안 돼요.', '무작정', '무'),
        ]:
            with self.subTest(sentence=sentence):
                self.assertNotIn(forbidden, self.token(sentence, text)['lemmas'])

    def test_registered_adverb_with_particle_analysis_is_retained(self):
        token = self.token('해마다 사람이 많아져요.', '해마다')
        self.assertEqual(token['lemmas'], ['해마다'])

    def test_bad_morphology_does_not_erase_clear_registered_word(self):
        token = self.token('어제 책상을 옮긴 일이 있었습니다.', '어제')
        self.assertEqual(token['lemmas'], ['어제'])
        self.assertNotIn('어', token['lemmas'])
        token = self.token('내과 오전 아홉 시인데 회사 일정이 생겼어요.', '내과')
        self.assertEqual(token['lemmas'], ['내과'])

    def test_unregistered_adjective_root_never_teaches_do(self):
        token = self.token('일회용을 줄이자는 목표가 정당하더라도 필요합니다.', '정당하더라도')
        self.assertNotIn('정당', token['lemmas'])
        self.assertNotIn('하다', token['lemmas'])

    def test_registered_noun_verb_compound_inside_one_eojeol(self):
        token = self.token('너한테 화난 건 아니야.', '화난')
        self.assertEqual(token['lemmas'], ['화나다'])
        self.assertNotIn('나다', token['lemmas'])

    def test_separate_eojeol_are_not_joined_for_coverage(self):
        words = rules.annotate('화가 났지만 차분히 말했어요.')
        self.assertNotIn('화나다', [base for word in words for base in word['lemmas']])

    def test_reviewed_phrase_spans_preserve_verbatim_words_and_component_roots(self):
        positives = [entry for entry in review if entry['verdict'] == 'valid']
        self.assertEqual({entry['headword'] for entry in positives}, set(reviewed_bounds))
        self.assertEqual(len(positives), 10)
        for entry in positives:
            with self.subTest(headword=entry['headword']):
                words = rules.annotate(entry['ko'])
                start, end, components = reviewed_bounds[entry['headword']]
                self.assertEqual([word['text'] for word in words], entry['ko'].split())
                self.assertEqual(' '.join(word['text'] for word in words), entry['ko'])
                spans = [(index, span) for index, word in enumerate(words)
                         for span in word['annotation'].get('linkedSpans', [])]
                self.assertEqual(len(spans), 1)
                index, span = spans[0]
                self.assertEqual(index, start)
                self.assertEqual(span, {
                    'headword': entry['headword'], 'wordStart': start, 'wordEnd': end,
                    'surfaceTokens': entry['surfaceTokens'],
                    'surface': ' '.join(entry['surfaceTokens']),
                    'lexicalComponents': components,
                    'reviewedLineId': entry['lineId'], 'meaning': entry['vocabulary']['zh'],
                })
                self.assertEqual([word['text'] for word in words[start:end]], span['surfaceTokens'])
                for original in entry['currentTokenAnnotations']:
                    word = words[original['tokenIndex']]
                    expected = original['lemmas'] + ([entry['headword']] if original['tokenIndex'] == start else [])
                    self.assertEqual(word['lemmas'], expected)
                    self.assertEqual(word['base'], ' · '.join(expected))
                    if original['meaning']:
                        self.assertIn(original['meaning'], word['meaning'])
                self.assertEqual(sum(word['lemmas'].count(entry['headword']) for word in words), 1)
                anchor = words[start]
                self.assertEqual(anchor['annotation']['status'], 'linked')
                self.assertEqual(anchor['annotation']['method'], 'machine-rule')
                self.assertEqual(anchor['annotation']['confidence'], 'machine-supported')
                self.assertEqual(anchor['annotation']['rule'], 'reviewed-spaced-phrase')
                self.assertIn(f"词组 {span['surface']} → {entry['headword']}：{span['meaning']}", anchor['meaning'])
                self.assertIn(f"本句词组 {span['surface']} 对应词条 {entry['headword']}；整组释义不表示第一个词形单独有这个意思。", anchor['note'])
                self.assertNotIn('索引锚点', anchor['note'])

    def test_phrase_postprocessing_is_idempotent(self):
        for entry in review:
            if entry['verdict'] == 'valid':
                with self.subTest(headword=entry['headword']):
                    words = rules.annotate(entry['ko'])
                    snapshot = copy.deepcopy(words)
                    self.assertEqual(rules.link_reviewed_spaced_phrases(entry['ko'], words), snapshot)

    def test_reviewed_false_candidates_keep_their_actual_sentence_meaning(self):
        negatives = [entry for entry in review if entry['verdict'] == 'false']
        self.assertEqual({entry['headword'] for entry in negatives}, {'가요', '종', '집안', '숨', '사기'})
        self.assertEqual(len(negatives), 5)
        for entry in negatives:
            with self.subTest(headword=entry['headword']):
                words = rules.annotate(entry['ko'])
                self.assertNotIn(entry['headword'], [base for word in words for base in word['lemmas']])
                self.assertFalse(any(word['annotation'].get('linkedSpans') for word in words))
                for original in entry['currentTokenAnnotations']:
                    word = words[original['tokenIndex']]
                    self.assertEqual(word['text'], original['text'])
                    self.assertEqual(word['lemmas'], original['lemmas'])
                    self.assertEqual(word['meaning'], original['meaning'])

    def test_nearby_nouns_and_dates_do_not_get_unreviewed_phrase_links(self):
        for sentence, forbidden in [
            ('직행 버스가 이미 떠났어요.', '직행버스'),
            ('가정의 생활 환경을 비교해요.', '생활환경'),
            ('개인정보 보호가 필요해요.', '개인정보보호'),
            ('칠 원을 받았어요.', '칠월'),
            ('십일 원을 적었어요.', '십일월'),
            ('칠 월 팔 일부터라고 말했어요.', '칠월'),
        ]:
            with self.subTest(sentence=sentence):
                words = rules.annotate(sentence)
                self.assertNotIn(forbidden, [base for word in words for base in word['lemmas']])
                self.assertFalse(any(word['annotation'].get('linkedSpans') for word in words))

    def test_complete_context_is_required_even_when_surface_tokens_match(self):
        for entry in review:
            if entry['verdict'] == 'valid':
                with self.subTest(headword=entry['headword']):
                    words = rules.annotate('오늘은 ' + entry['ko'])
                    self.assertNotIn(entry['headword'], [base for word in words for base in word['lemmas']])
                    self.assertFalse(any(word['annotation'].get('linkedSpans') for word in words))

    def test_phrase_rule_rejects_changed_boundaries_and_existing_ambiguity(self):
        entry = next(entry for entry in review if entry['headword'] == '직행버스')
        words = rules.annotate(entry['ko'])
        changed = copy.deepcopy(words)
        changed[0]['text'] = '다른'
        with self.assertRaisesRegex(ValueError, 'token boundaries changed'):
            rules.link_reviewed_spaced_phrases(entry['ko'], changed)
        ambiguous = copy.deepcopy(words)
        ambiguous[0]['annotation'] = {'status': 'ambiguous', 'method': 'morphology',
                                      'confidence': 'uncertain', 'candidates': ['직행']}
        with self.assertRaisesRegex(ValueError, 'cannot erase an ambiguous token'):
            rules.link_reviewed_spaced_phrases(entry['ko'], ambiguous)


if __name__ == '__main__':
    unittest.main()
