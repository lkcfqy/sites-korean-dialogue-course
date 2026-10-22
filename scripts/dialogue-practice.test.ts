import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DIALOGUE_DATA_SCENARIOS,
  DIALOGUE_TRANSFER_SCENARIOS,
  dialoguePracticeTasks,
  originalDialoguePracticeLines,
} from "../data/dialogue-practice";
import type { ImmersionLesson, ImmersionSection } from "../lib/immersion-types";

const section: ImmersionSection = {
  key: "current",
  label: "问路",
  scene: "街上问路",
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
    {
      id: "two",
      speaker: "B",
      ko: "역 옆에 있어요.",
      zh: "在车站旁边。",
      words: [],
    },
  ],
};
const lesson: ImmersionLesson = {
  id: "w01d1",
  week: 1,
  day: 1,
  title: "问路",
  scene: "街上问路",
  kind: "new",
  vocabulary: [],
  sceneVocabulary: [],
  reviewVocabulary: [],
  newLines: 2,
  reviewLines: 0,
  sections: [section],
};

test("current scene response keeps the real cue and source answer and labels it familiar recall", () => {
  const tasks = dialoguePracticeTasks(lesson, section);
  assert.equal(tasks[0].source, "current");
  assert.deepEqual(tasks[0].stimulus, [section.lines[0].ko]);
  assert.deepEqual(tasks[0].referenceKo, [section.lines[1].ko]);
  assert.match(tasks[0].referenceZh, /不是未见/);
  assert.equal(tasks[1].source, "new-scenario");
  assert.deepEqual(originalDialoguePracticeLines(tasks[0], "stimulus"), [
    "one",
  ]);
  assert.deepEqual(originalDialoguePracticeLines(tasks[0], "reference"), [
    "two",
  ]);
  assert.deepEqual(originalDialoguePracticeLines(tasks[1], "reference"), []);
});

test("summary references report only the original excerpts actually revealed, not the full scene", () => {
  const passage = {
    ...section,
    kind: "passage" as const,
    lines: Array.from({ length: 6 }, (_, index) => ({
      ...section.lines[0],
      id: `passage-${index}`,
      ko: `자료의 ${index + 1}번째 내용을 확인해야 한다.`,
    })),
  };
  const task = dialoguePracticeTasks({ ...lesson, week: 19 }, passage)[0];
  assert.deepEqual(originalDialoguePracticeLines(task, "reference"), [
    "passage-0",
    "passage-3",
    "passage-5",
  ]);
  assert.deepEqual(originalDialoguePracticeLines(task, "stimulus"), []);
  assert.ok(
    originalDialoguePracticeLines(task, "reference").every((id) => {
      const line = passage.lines.find((item) => item.id === id)!;
      return task.referenceKo.includes(line.ko);
    }),
  );
});

test("single pronunciation/sentence lines and a final unanswered question fall back without invented answers", () => {
  for (const kind of ["pronunciation", "sentence", "dialogue"] as const) {
    const single = { ...section, kind, lines: [section.lines[0]] };
    const task = dialoguePracticeTasks(lesson, single)[0];
    assert.equal(task.kind, "summary");
    assert.equal(task.referenceKo[0], section.lines[0].ko);
  }
  const finalQuestion = {
    ...section,
    lines: [
      { ...section.lines[0], ko: "여기는 학교예요.", speaker: "A" as const },
      { ...section.lines[1], ko: "도서관도 있어요?", speaker: "A" as const },
    ],
  };
  assert.equal(dialoguePracticeTasks(lesson, finalQuestion)[0].kind, "summary");
});

test("26 weekly transfer tasks and advanced data tasks have independent, noncopied course material", () => {
  assert.equal(DIALOGUE_TRANSFER_SCENARIOS.length, 26);
  assert.deepEqual(
    DIALOGUE_TRANSFER_SCENARIOS.map((item) => item.week),
    Array.from({ length: 26 }, (_, i) => i + 1),
  );
  const corpus = new Set<string>();
  for (let week = 1; week <= 26; week++) {
    const content = JSON.parse(
      readFileSync(
        new URL(
          `../public/immersion/week-${String(week).padStart(2, "0")}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    ) as ImmersionLesson[];
    for (const day of content)
      for (const item of day.sections)
        for (const line of item.lines) corpus.add(line.ko.trim());
  }
  for (const task of DIALOGUE_TRANSFER_SCENARIOS) {
    assert.ok(!corpus.has(task.stimulus));
    assert.ok(!corpus.has(task.reference));
    assert.equal(task.goals.length, 3);
    assert.match(task.reference, /[가-힣]/);
  }
  assert.deepEqual(
    DIALOGUE_DATA_SCENARIOS.map((item) => item.week),
    [19, 20, 21, 22, 23, 24, 25, 26],
  );
  for (const task of DIALOGUE_DATA_SCENARIOS) {
    assert.ok(task.facts.every((fact) => /[가-힣]/.test(fact)));
    assert.ok(!corpus.has(task.reference));
  }
});

test("advanced lessons include written summary, stance argument and data interpretation with evidence limits", () => {
  const advanced = { ...lesson, id: "w23d1", week: 23 };
  const tasks = dialoguePracticeTasks(advanced, {
    ...section,
    source: { ...section.source, week: 23 },
  });
  for (const kind of ["summary", "argument", "data"])
    assert.ok(tasks.some((task) => task.kind === kind));
  assert.equal(
    tasks.find((task) => task.kind === "argument")!.id,
    "transfer-w23",
  );
  assert.match(tasks.find((task) => task.kind === "data")!.prompt, /不能说明/);
  const reviewTasks = dialoguePracticeTasks(advanced, {
    ...section,
    review: true,
  });
  assert.equal(
    reviewTasks.find((task) => task.source === "new-scenario")!.id,
    "transfer-w01",
  );
});

test("advanced single sentences retain the summary task ID but ask only for the available meaning", () => {
  const single = {
    ...section,
    kind: "sentence" as const,
    lines: [
      {
        ...section.lines[0],
        ko: "진로를 바꾸기에 앞서 필요한 비용과 실제 업무를 확인해야 한다.",
      },
    ],
  };
  const task = dialoguePracticeTasks({ ...lesson, week: 19 }, single)[0];
  assert.equal(task.id, "current-summary");
  assert.match(task.title, /复述或改写/);
  assert.match(task.prompt, /1–2/);
  assert.equal(task.supportedGoals?.length, 1);
  assert.ok(!task.checklist.some((goal) => /不同意见|双方|协商/.test(goal)));
  assert.deepEqual(task.referenceKo, [single.lines[0].ko]);
  const short = dialoguePracticeTasks(
    { ...lesson, week: 19 },
    {
      ...single,
      kind: "passage",
      lines: [...single.lines, { ...single.lines[0], id: "extra" }],
    },
  )[0];
  assert.match(short.prompt, /1–3/);
  assert.match(short.prompt, /不补写材料没有的理由/);
  assert.ok(!short.checklist.some((goal) => /不同意见|双方|协商/.test(goal)));
});

test("supported transfer goals are authored content actions, not grammar and accuracy checks", () => {
  for (const seed of DIALOGUE_TRANSFER_SCENARIOS) {
    assert.ok(
      seed.supportedGoals.length >= 2 && seed.supportedGoals.length <= 3,
    );
    assert.ok(
      seed.supportedGoals.every(
        (goal) => !/主语一致|语体一致|礼貌语尾|避免只说含糊/.test(goal),
      ),
    );
  }
  assert.deepEqual(DIALOGUE_TRANSFER_SCENARIOS[5].supportedGoals, [
    "询问应该走哪个出口",
    "询问从出口步行到书店需要多久",
  ]);
  assert.equal(DIALOGUE_TRANSFER_SCENARIOS[1].supportedGoals.length, 2);
  assert.equal(DIALOGUE_TRANSFER_SCENARIOS[18].supportedGoals.length, 3);
});
