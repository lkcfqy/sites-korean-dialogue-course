import test from "node:test";
import assert from "node:assert/strict";
import type { ImmersionLesson } from "../lib/immersion-types";
import {
  DIALOGUE_PLAN_KEY,
  defaultDialoguePlan,
  mergeDialoguePlan,
  parseDialoguePlan,
  recommendDialogueWork,
  revealDialoguePracticeReference,
  saveDialoguePlanPreferences,
  saveDialoguePracticeDraft,
} from "../lib/dialogue-plan";

function storage(initial: string | null = null) {
  const data = new Map<string, string>();
  if (initial !== null) data.set(DIALOGUE_PLAN_KEY, initial);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
const lesson: ImmersionLesson = {
  id: "w01d1",
  week: 1,
  day: 1,
  title: "问路",
  scene: "在街上问路",
  kind: "new",
  vocabulary: [],
  sceneVocabulary: [],
  reviewVocabulary: [],
  newLines: 20,
  reviewLines: 10,
  sections: [
    {
      key: "scene-a",
      label: "问路",
      scene: "在街上问路",
      review: false,
      source: { id: "w01d1", title: "问路", week: 1, day: 1 },
      lines: [
        {
          id: "one",
          speaker: "A",
          ko: "서점은 어디에 있어요?",
          zh: "书店在哪里？",
          words: [],
        },
      ],
    },
  ],
};

test("short daily budgets stay within available minutes and never promise the full schedule", () => {
  for (const minutes of [15, 30, 60, 240, 360]) {
    const result = recommendDialogueWork(lesson, {
      minutes,
      startingPoint: "phrases",
    });
    assert.equal(
      result.newMinutes + result.reviewMinutes + result.outputMinutes,
      minutes,
    );
    assert.ok(result.newLines <= lesson.newLines);
    assert.equal(result.fullSchedule, minutes >= 240);
  }
});

test("first day without old or due lines recommends current listening rather than inventing reviews", () => {
  const firstDay = recommendDialogueWork(
    lesson,
    { minutes: 90, startingPoint: "phrases" },
    { due: 0, rated: 0, independent: 0, repeat: 0 },
  );
  assert.equal(firstDay.reviewLines, 0);
  assert.equal(firstDay.repeatCurrent, true);
  const actualReview = {
    ...lesson,
    sections: [
      ...lesson.sections,
      { ...lesson.sections[0], key: "review", review: true },
    ],
  };
  assert.equal(
    recommendDialogueWork(actualReview, {
      minutes: 90,
      startingPoint: "phrases",
    }).reviewLines,
    1,
  );
  assert.equal(
    recommendDialogueWork(
      actualReview,
      { minutes: 90, startingPoint: "phrases" },
      { due: 1, rated: 1, independent: 1, repeat: 0 },
    ).reviewLines,
    1,
  );
});

test("weak independent recall and large due queues reduce new material in favor of review", () => {
  const preferences = { minutes: 60, startingPoint: "phrases" as const };
  const normal = recommendDialogueWork(lesson, preferences, {
    due: 2,
    rated: 10,
    independent: 9,
    repeat: 0,
  });
  const weak = recommendDialogueWork(lesson, preferences, {
    due: 2,
    rated: 10,
    independent: 3,
    repeat: 4,
  });
  const backlog = recommendDialogueWork(lesson, preferences, {
    due: 31,
    rated: 10,
    independent: 9,
    repeat: 0,
  });
  assert.ok(weak.newLines < normal.newLines);
  assert.ok(weak.reviewMinutes > normal.reviewMinutes);
  assert.ok(backlog.reviewMinutes > normal.reviewMinutes);
  assert.ok(backlog.newLines < normal.newLines);
  assert.equal(backlog.due, 31);
});

test("planning uses latest feedback instead of treating historical independence as present ability", () => {
  const preferences = { minutes: 60, startingPoint: "phrases" as const };
  const current = recommendDialogueWork(lesson, preferences, {
    due: 0,
    rated: 100,
    independent: 100,
    currentIndependent: 90,
    repeat: 0,
  });
  const declined = recommendDialogueWork(lesson, preferences, {
    due: 0,
    rated: 100,
    independent: 100,
    currentIndependent: 0,
    repeat: 0,
  });
  assert.equal(current.struggling, false);
  assert.equal(declined.struggling, true);
  assert.ok(declined.newLines < current.newLines);
  assert.ok(declined.reviewMinutes > current.reviewMinutes);
});

test("review days allocate no new content and longer sentences get a smaller recall batch", () => {
  const review = recommendDialogueWork(
    { ...lesson, kind: "review", newLines: 0 },
    { minutes: 60, startingPoint: "phrases" },
  );
  assert.equal(review.newMinutes, 0);
  assert.equal(review.newLines, 0);
  assert.equal(review.reviewMinutes + review.outputMinutes, 60);
  const longLesson = {
    ...lesson,
    sections: [
      {
        ...lesson.sections[0],
        lines: [
          {
            ...lesson.sections[0].lines[0],
            ko: "결론을 내리기 전에 조사 대상과 기간을 확인하고 서로 다른 조건에서 나타난 결과를 구분하여 판단해야 한다.",
          },
        ],
      },
    ],
  };
  assert.ok(
    recommendDialogueWork(longLesson, {
      minutes: 60,
      startingPoint: "argument",
    }).newLines <
      recommendDialogueWork(lesson, { minutes: 60, startingPoint: "argument" })
        .newLines,
  );
});

test("preferences and practice drafts survive strict serialization while invalid backups are rejected", () => {
  const target = storage();
  assert.equal(
    saveDialoguePlanPreferences(
      { minutes: 90, startingPoint: "paragraphs" },
      target,
      100,
    ).saved,
    true,
  );
  assert.equal(
    saveDialoguePracticeDraft(
      "weekly:transfer-w03",
      "네 시에 만날까요?",
      undefined,
      target,
      101,
    ).saved,
    true,
  );
  const parsed = parseDialoguePlan(target.getItem(DIALOGUE_PLAN_KEY))!;
  assert.equal(parsed.minutes, 90);
  assert.equal(parsed.drafts["weekly:transfer-w03"].text, "네 시에 만날까요?");
  for (const patch of [
    { minutes: 0 },
    { minutes: 15.5 },
    { startingPoint: "topik6" },
    { updatedAt: -1 },
    { drafts: { a: { text: "x", updatedAt: 1, referenceSeenAt: -1 } } },
    {
      drafts: {
        a: {
          text: "x",
          updatedAt: 1,
          firstAttempt: { text: 3, submittedAt: 1 },
        },
      },
    },
  ])
    assert.equal(
      parseDialoguePlan(JSON.stringify({ ...parsed, ...patch })),
      null,
    );
});

test("revealing stores the independent initial draft and exposure cannot be undone by later edits", () => {
  const target = storage();
  const key = "weekly:transfer-w04";
  assert.equal(
    saveDialoguePracticeDraft(
      key,
      "따뜻한 차 주세요.",
      "independent",
      target,
      100,
    ).saved,
    true,
  );
  assert.equal(
    revealDialoguePracticeReference(key, "따뜻한 차 주세요.", target, 101)
      .saved,
    true,
  );
  assert.equal(
    saveDialoguePracticeDraft(
      key,
      "따뜻한 차 한 잔 주세요.",
      undefined,
      target,
      102,
    ).saved,
    true,
  );
  const parsed = parseDialoguePlan(target.getItem(DIALOGUE_PLAN_KEY))!;
  assert.equal(parsed.drafts[key].referenceSeenAt, 101);
  assert.equal(parsed.drafts[key].firstAttempt?.text, "따뜻한 차 주세요.");
  assert.equal(parsed.drafts[key].text, "따뜻한 차 한 잔 주세요.");
  assert.equal(
    saveDialoguePracticeDraft(
      key,
      "따뜻한 차 한 잔 주세요.",
      "independent",
      target,
      103,
    ).saved,
    false,
  );
  assert.equal(
    revealDialoguePracticeReference(key, "따뜻한 차 한 잔 주세요.", target, 104)
      .saved,
    true,
  );
  assert.equal(
    parseDialoguePlan(target.getItem(DIALOGUE_PLAN_KEY))!.drafts[key]
      .referenceSeenAt,
    101,
  );
});

test("backup merge keeps local preferences and drafts while retaining earlier reference exposure", () => {
  const current = {
    ...defaultDialoguePlan(),
    minutes: 60,
    updatedAt: 100,
    drafts: { task: { text: "내 문장", updatedAt: 100 } },
  };
  const incoming = {
    ...defaultDialoguePlan(),
    minutes: 360,
    startingPoint: "argument" as const,
    updatedAt: 200,
    drafts: {
      task: { text: "가져온 문장", updatedAt: 200, referenceSeenAt: 150 },
      another: { text: "새 문장", updatedAt: 200 },
    },
  };
  const result = mergeDialoguePlan(current, incoming);
  assert.equal(result.minutes, 60);
  assert.equal(result.startingPoint, "alphabet");
  assert.equal(result.drafts.task.text, "내 문장");
  assert.equal(result.drafts.task.referenceSeenAt, 150);
  assert.equal(result.drafts.another.text, "새 문장");
});

test("failed storage reads/writes and corrupt existing records never report a saved initial attempt", () => {
  const readFailure = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("must not write");
    },
  };
  assert.equal(
    revealDialoguePracticeReference(
      "weekly:task",
      "한국어 문장",
      readFailure,
      100,
    ).saved,
    false,
  );
  const broken = storage("broken");
  assert.equal(
    saveDialoguePracticeDraft(
      "weekly:task",
      "한국어 문장",
      undefined,
      broken,
      100,
    ).saved,
    false,
  );
  assert.equal(broken.getItem(DIALOGUE_PLAN_KEY), "broken");
  const writeFailure = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.equal(
    saveDialoguePlanPreferences(
      { minutes: 120, startingPoint: "phrases" },
      writeFailure,
      100,
    ).saved,
    false,
  );
});
