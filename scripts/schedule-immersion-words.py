#!/usr/bin/env python3
"""Capacity-preserving immersion word schedule. Build-only Python/NumPy tool.

To integrate explicitly:
  python schedule-immersion-words.py --output REPO/data/immersion-word-schedule.json

All A/B (levels 1/2) are retained. C is selected by original thematic week,
observed usage and focus vocabulary, rather than by global dictionary order.
"""
import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
import numpy as np


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def word_bases(items, valid):
    result = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        for key in ('base', 'lemma'):
            value = item.get(key)
            if isinstance(value, str):
                result.update(p for p in value.split(' · ') if p in valid)
    return result


def collect_presence(repo, words, use_kiwi):
    valid = {x['ko'] for x in words}
    dialogues = read_json(repo / 'data/curriculum/dialogues.json')
    scenes = defaultdict(list)
    observed = defaultdict(set)
    focus = defaultdict(set)
    for d in dialogues:
        scenes[d['id']].extend(d['lines'])
        focus[d['id']].update(d.get('vocabulary', [])[:8])
        for line in d['lines']:
            for w in line.get('words', []):
                token = re.sub(r'[.,!?]', '', w.get('text', ''))
                bases = word_bases([w], valid)
                if len(bases) == 1:
                    observed[token].update(bases)
    for asset_file in sorted((repo / 'data/immersion').glob('*.json')):
        for scene in read_json(asset_file):
            scenes[scene['lessonId']].extend(scene['lines'])
    ann_path = repo / 'data/immersion-annotations.json'
    annotations = read_json(ann_path) if ann_path.exists() else {}
    kiwi = None
    mode = 'full annotations' if annotations else 'original annotations + exact/observed surfaces'
    if use_kiwi and not annotations:
        from kiwipiepy import Kiwi
        kiwi = Kiwi(num_workers=1)
        mode += ' + Kiwi fallback'
    presence = defaultdict(set)
    cache = {}
    for lesson_id, lines in scenes.items():
        for line in lines:
            text = line['ko']
            if text not in cache:
                bases = word_bases(line.get('words', []), valid)
                annotation = annotations.get(text)
                if isinstance(annotation, dict):
                    annotation = annotation.get('words', [])
                if isinstance(annotation, list):
                    bases.update(word_bases(annotation, valid))
                for surface in text.split():
                    token = re.sub(r'[.,!?"“”‘’():;]', '', surface)
                    if token in valid:
                        bases.add(token)
                    elif len(observed[token]) == 1:
                        bases.update(observed[token])
                if kiwi is not None and not line.get('words'):
                    tokens = kiwi.tokenize(text)
                    for i, token in enumerate(tokens):
                        lemma = token.form + ('다' if token.tag.startswith(('VV', 'VA', 'VX')) else '')
                        if lemma in valid:
                            bases.add(lemma)
                        if token.tag.startswith('N'):
                            if i + 1 < len(tokens) and tokens[i + 1].tag.startswith(('XSV', 'XSA')):
                                combined = token.form + tokens[i + 1].form + '다'
                                if combined in valid:
                                    bases.add(combined)
                            for width in (2, 3):
                                group = tokens[i:i + width]
                                if len(group) == width and all(t.tag.startswith('N') for t in group):
                                    combined = ''.join(t.form for t in group)
                                    if combined in valid:
                                        bases.add(combined)
                cache[text] = bases
            presence[lesson_id].update(cache[text])
    return dialogues, scenes, focus, presence, mode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'data/immersion-word-schedule.json')
    parser.add_argument('--stats-output', type=Path)
    parser.add_argument('--seed', type=int, default=20261007)
    parser.add_argument('--swap-rounds', type=int, default=40)
    parser.add_argument('--kiwi-fallback', action='store_true', help='Use Kiwi only when full annotations are missing.')
    args = parser.parse_args()
    words = read_json(args.repo / 'data/vocabulary.json')
    dialogues, scenes, focus, presence, annotation_mode = collect_presence(args.repo, words, args.kiwi_fallback)
    originals = {d['id']: d for d in dialogues}
    lessons = [f'w{week:02d}d{day}' for week in range(1, 27) for day in range(1, 7)]
    weeks = np.array([int(lid[1:3]) for lid in lessons], dtype=np.int16)
    days = np.array([int(lid[-1]) for lid in lessons], dtype=np.int16)
    capacities = np.array([10 if w <= 2 else 25 if w <= 6 else 30 if w <= 12 else 35 if w <= 18 else 40 for w in weeks], dtype=np.int16)
    assert capacities.sum() == 4980
    indices = {w['ko']: i for i, w in enumerate(words)}
    origin_weeks = np.array([int(w['lessonId'][1:3]) for w in words], dtype=np.int16)
    origin_days = np.array([int(w['lessonId'][-1]) for w in words], dtype=np.int16)
    levels = np.array([w['level'] for w in words], dtype=np.int8)
    occurrence = np.zeros((len(words), len(lessons)), dtype=bool)
    focused = np.zeros_like(occurrence)
    for j, lid in enumerate(lessons):
        for ko in presence[lid]:
            if ko in indices:
                occurrence[indices[ko], j] = True
        for ko in focus[lid]:
            if ko in indices:
                focused[indices[ko], j] = True
    same_week = np.zeros_like(occurrence)
    for week in range(1, 27):
        col = np.flatnonzero(weeks == week)
        same_week[:, col] = occurrence[:, col].any(axis=1, keepdims=True)
    # Date distance is a proxy for theme, not a language-level ground truth.
    cost = 2.6 * np.abs(origin_weeks[:, None] - weeks[None, :]).astype(np.float32)
    cost += 0.55 * np.abs(origin_days[:, None] - days[None, :])
    cost -= occurrence * 12.0 + focused * 7.0 + same_week * 2.0
    # Avoid introducing elementary/mid-level words as arbitrary late leftovers.
    cost += ((levels[:, None] == 1) & (weeks[None, :] > 6)) * ((weeks[None, :] - 6).clip(0) * 3.2)
    cost += ((levels[:, None] == 2) & (weeks[None, :] < 5)) * ((5 - weeks[None, :]).clip(0) * 1.0)
    counts = occurrence.sum(axis=1)
    focus_counts = focused.sum(axis=1)
    early_c = np.flatnonzero((levels == 3) & (origin_weeks <= 18))
    # Prefer demonstrated usefulness and true lesson focus. Stable original order breaks ties.
    early_score = counts * 8.0 + focus_counts * 13.0 + (occurrence[:, weeks <= 18].sum(axis=1) > 0) * 12.0
    early_rank = sorted(early_c, key=lambda i: (-float(early_score[i]), int(origin_weeks[i] < 7), i))
    chosen_c_early = early_rank[:228]
    chosen_c_late = []
    late_by_week = {}
    for week in range(19, 27):
        candidates = np.flatnonzero((levels == 3) & (origin_weeks == week))
        cols = np.flatnonzero(weeks == week)
        scores = occurrence[:, cols].sum(axis=1) * 16.0 + focused[:, cols].sum(axis=1) * 25.0 + counts * 2.0
        ranked = sorted(candidates, key=lambda i: (-float(scores[i]), i))
        selected = ranked[:225]
        assert len(selected) == 225, (week, len(selected))
        chosen_c_late.extend(selected)
        late_by_week[week] = selected
    selected_indices = list(np.flatnonzero(levels <= 2)) + chosen_c_early + chosen_c_late
    assert len(selected_indices) == 4980 and len(set(selected_indices)) == 4980
    selected = np.array(selected_indices, dtype=np.int32)
    n = len(selected)
    selected_cost = cost[selected].copy()
    allowed = np.ones((n, len(lessons)), dtype=bool)
    selected_levels = levels[selected]
    selected_origin = origin_weeks[selected]
    allowed[:, weeks <= 2] = False
    allowed[selected_levels == 1] &= weeks[None, :] <= 12
    # Reserve only late-relevant B words for the unavoidable 120 late core slots.
    # Otherwise frequent basics such as 사람/이후 can be postponed just for a late bonus.
    b_rows = np.flatnonzero(selected_levels == 2)
    late_b_candidates = [row for row in b_rows if selected_origin[row] >= 15]
    late_use = occurrence[:, weeks >= 19].sum(axis=1)
    early_use = occurrence[:, weeks <= 18].sum(axis=1)
    late_b_score = late_use * 7.0 - early_use * 4.0 + origin_weeks * 0.35
    late_b_rows = set(sorted(late_b_candidates, key=lambda row: (-float(late_b_score[selected[row]]), int(selected[row])))[:120])
    assert len(late_b_rows) == 120
    for row in b_rows:
        allowed[row] &= (weeks >= 19) if row in late_b_rows else (weeks <= 18)
    early_set, late_set = set(chosen_c_early), set(chosen_c_late)
    for row, source_idx in enumerate(selected):
        if source_idx in early_set:
            allowed[row] &= weeks <= 18
        elif source_idx in late_set:
            allowed[row] &= weeks == origin_weeks[source_idx]
    # Reserve exactly 120 level-1 foundation words for weeks 1-2.
    a_rows = np.flatnonzero(selected_levels == 1)
    foundation_score = cost[selected[a_rows]][:, weeks <= 2].min(axis=1) - np.minimum(counts[selected[a_rows]], 12) * 0.65
    foundation_rows = a_rows[np.argsort(foundation_score, kind='stable')[:120]]
    allowed[foundation_rows] = weeks <= 2
    selected_cost[~allowed] = np.inf
    assignment = np.full(n, -1, dtype=np.int16)
    remaining = capacities.copy()
    source_to_row = {int(source_idx): row for row, source_idx in enumerate(selected)}

    def assign_group(rows):
        rows = np.array(list(rows), dtype=np.int32)
        if not len(rows):
            return
        # Constrained/high-regret words first, preventing generic words stealing rare matches.
        sorted_cost = np.sort(selected_cost[rows], axis=1)
        regret = np.nan_to_num(sorted_cost[:, 1] - sorted_cost[:, 0], nan=0, posinf=10000)
        order = sorted(range(len(rows)), key=lambda k: (-float(regret[k]), float(sorted_cost[k, 0]), int(selected[rows[k]])))
        for k in order:
            row = rows[k]
            available_cost = np.where(remaining > 0, selected_cost[row], np.inf)
            day_idx = int(np.argmin(available_cost))
            if not np.isfinite(available_cost[day_idx]):
                raise RuntimeError(f'No capacity for {words[selected[row]]["ko"]}')
            assignment[row] = day_idx
            remaining[day_idx] -= 1

    assign_group(foundation_rows)
    for week in range(19, 27):
        assign_group(source_to_row[i] for i in late_by_week[week])
    assign_group(source_to_row[i] for i in chosen_c_early)
    assign_group(row for row in a_rows if row not in set(foundation_rows))
    assign_group(row for row in b_rows if row not in late_b_rows)
    assign_group(late_b_rows)
    assert np.all(assignment >= 0) and np.all(remaining == 0)
    initial_cost = float(selected_cost[np.arange(n), assignment].sum())
    # Simultaneous disjoint pair swaps preserve exact daily capacity and hard eligibility.
    rng = np.random.default_rng(args.seed)
    swaps = 0
    for _ in range(args.swap_rounds):
        perm = rng.permutation(n)
        a, b = perm[::2], perm[1::2]
        da, db = assignment[a], assignment[b]
        old = selected_cost[a, da] + selected_cost[b, db]
        new = selected_cost[a, db] + selected_cost[b, da]
        improve = (da != db) & np.isfinite(new) & (new < old - 0.01)
        assignment[a[improve]], assignment[b[improve]] = db[improve], da[improve]
        swaps += int(improve.sum())
    # Targeted best partner searches improve sparse scene matches missed by random pairs.
    for _ in range(3):
        for row in rng.permutation(n):
            old_row = selected_cost[row, assignment[row]]
            candidate = selected_cost[row, assignment] + selected_cost[np.arange(n), assignment[row]]
            delta = candidate - old_row - selected_cost[np.arange(n), assignment]
            partner = int(np.argmin(delta))
            if np.isfinite(delta[partner]) and delta[partner] < -0.01:
                assignment[row], assignment[partner] = assignment[partner], assignment[row]
                swaps += 1
    assert np.array_equal(np.bincount(assignment, minlength=len(lessons)), capacities)
    assert allowed[np.arange(n), assignment].all()
    schedule = {lid: [] for lid in lessons}
    for day_idx, lid in enumerate(lessons):
        rows = np.flatnonzero(assignment == day_idx)
        # Scene/focus first in study order; all words still occur only once in the schedule.
        rows = sorted(rows, key=lambda r: (-int(occurrence[selected[r], day_idx]), -int(focused[selected[r], day_idx]), int(selected[r])))
        schedule[lid] = [words[selected[row]]['ko'] for row in rows]
    for week in range(1, 27):
        schedule[f'w{week:02d}d7'] = []
    schedule = dict(sorted(schedule.items(), key=lambda item: (int(item[0][1:3]), int(item[0][-1]))))
    all_assigned = [ko for row in schedule.values() for ko in row]
    assert len(all_assigned) == len(set(all_assigned)) == 4980
    assert all(words[indices[ko]]['level'] == 1 for lid, row in schedule.items() if int(lid[1:3]) <= 2 for ko in row)
    missing = []
    week_stats = []
    for week in range(1, 27):
        lids = [f'w{week:02d}d{day}' for day in range(1, 7)]
        ks = [ko for lid in lids for ko in schedule[lid]]
        in_scene = sum(ko in presence[lid] for lid in lids for ko in schedule[lid])
        level_count = Counter(words[indices[ko]]['level'] for ko in ks)
        week_stats.append({'week': week, 'newWords': len(ks), 'levels': dict(level_count), 'sameDaySceneWords': in_scene, 'sameDayRate': round(in_scene / len(ks), 3)})
        for lid in lids:
            off = [ko for ko in schedule[lid] if ko not in presence[lid]]
            if week in (1, 7, 13, 19, 21, 26) and lid.endswith('d1'):
                missing.append({'lessonId': lid, 'title': originals[lid]['title'], 'sameDayCount': len(schedule[lid]) - len(off), 'offSceneSample': off[:12], 'lateCoreSample': [ko for ko in schedule[lid] if words[indices[ko]]['level'] < 3][:8]})
    represented = set().union(*presence.values())
    stats = {'mainWords': 4980, 'allLevel1And2Retained': len(np.flatnonzero(levels <= 2)), 'level3Early': len(chosen_c_early), 'level3Late': len(chosen_c_late), 'foundationLevel1Only': True, 'lateLevel2Slots': 120, 'lateLevel2OriginalWeekMin': 15, 'sameDaySceneWords': sum(s['sameDaySceneWords'] for s in week_stats), 'wordsWithAnyScene': len(set(all_assigned) & represented), 'annotationMode': annotation_mode, 'improvingPairSwaps': swaps, 'costBeforeSwaps': round(initial_cost, 2), 'costAfterSwaps': round(float(selected_cost[np.arange(n), assignment].sum()), 2), 'weeks': week_stats, 'mismatchSamples': missing, 'limitations': ['Original lesson dates are a theme proxy; no semantic embedding or human teacher judgment is used.', 'Fixed 4,980-word capacity still requires off-scene words; those need explicitly marked supplemental examples.', 'Full annotations improve occurrence counts. Exact/observed-surface fallback undercounts new inflections.', 'All level-1/2 retention and 120 introductory slots necessarily delay some basic words; no level-1 words are assigned after week 12.']}
    write_json(args.output, schedule)
    stats_path = args.stats_output or args.output.with_suffix('.stats.json')
    write_json(stats_path, stats)
    print(json.dumps({key: value for key, value in stats.items() if key not in ('weeks', 'limitations')}, ensure_ascii=False, indent=2))
    print(f'Schedule: {args.output}\nStats: {stats_path}')


if __name__ == '__main__':
    main()
