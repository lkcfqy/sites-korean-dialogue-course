import type { Lesson, Dialogue, Section } from './course';

/** Reuse is confined to labelled review sections; new dialogues are literal text. */
export function buildCourse(dialogues: Dialogue[]): Lesson[] {
  const index = new Map(dialogues.map((d) => [d.id, d]));
  const result: Lesson[] = [];
  const id = (week: number, day: number) => `w${String(week).padStart(2, '0')}d${day}`;
  const lookup = (week: number, day: number) => index.get(id(week, day));
  const section = (label: string, sources: Dialogue[], review: boolean): Section => ({
    label, review, sources: sources.map((d) => ({ id: d.id, title: d.title, week: d.week, day: d.day })),
    lines: sources.flatMap((d) => d.lines),
  });
  for (let week = 1; week <= 26; week++) {
    for (let day = 1; day <= 7; day++) {
      const current = lookup(week, day);
      const sections: Section[] = [];
      const reviewSources: Dialogue[] = [];
      const addReview = (label: string, sources: (Dialogue | undefined)[]) => {
        const valid = sources.filter((x): x is Dialogue => !!x);
        if (valid.length) { sections.push(section(label, valid, true)); reviewSources.push(...valid); }
      };
      if (current) {
        sections.push(section(day === 6 ? '综合对话' : '今天的对话', [current], false));
        addReview('最近复习', [day > 1 ? lookup(week, day - 1) : lookup(week - 1, 6)]);
        addReview('上周复习', [lookup(week - 1, day)]);
        addReview('四周前复习', [lookup(week - 4, day)]);
      } else {
        addReview('本周对话', [1, 2, 3, 4, 5, 6].map((d) => lookup(week, d)));
        addReview('上周回看', [lookup(week - 1, 2), lookup(week - 1, 4)]);
        addReview('四周前回看', [lookup(week - 4, 1), lookup(week - 4, 5)]);
      }
      const vocabulary = current?.vocabulary ?? [];
      const reviewVocabulary = [...new Set(reviewSources.flatMap((d) => d.vocabulary))].filter((w) => !vocabulary.includes(w));
      const lesson: Lesson = {
        id: id(week, day), week, day,
        title: current?.title ?? '本周复习 · 从理解到说出来',
        scene: current?.scene ?? '先遮住中文听一遍，再交换角色复述完整对话；卡住时回看对应句子。今天不增加新词。',
        focus: current?.focus ?? '回顾本周与间隔一周、四周的内容。这里的重复是复习，不计入新内容数量。',
        kind: current ? 'new' : 'review',
        sections, lines: sections.flatMap((s) => s.lines), vocabulary, reviewVocabulary,
      };
      result.push(lesson);
    }
  }
  return result;
}
