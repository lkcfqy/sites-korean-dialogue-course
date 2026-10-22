import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ImmersionLesson } from "../lib/immersion-types";
import { dialoguePracticeTasks } from "../data/dialogue-practice";
import {
  dialoguePracticeVariant,
  recommendDialogueDifficulty,
} from "../lib/dialogue-difficulty";
import {
  dialogueLineKey,
  rateDialogueSentence,
  type DialogueMemory,
} from "../lib/dialogue-memory";
import {
  defaultDialoguePlan,
  mergeDialoguePlan,
  parseDialoguePlan,
  revealDialoguePracticeReference,
  saveDialoguePracticeDraft,
  DIALOGUE_PLAN_KEY,
  saveDialoguePracticeCompletion,
  loadDialoguePlan,
} from "../lib/dialogue-plan";
import { dialoguePracticeKey } from "../lib/dialogue-practice-keys";
import { exportStudy, importStudy } from "../lib/study-backup";

const lesson = (
  JSON.parse(
    readFileSync(
      new URL("../public/immersion/week-08.json", import.meta.url),
      "utf8",
    ),
  ) as ImmersionLesson[]
)[0];
const section = lesson.sections[0];
const start = 1_000_000_000;
const day = 86_400_000;
const produced = {
  grade: "produced",
  draft: "일요일에 만나요.",
  revealed: false,
} as const;
const source = (i: number) => ({
  lessonId: section.source.id,
  sectionKey: null,
  lineId: section.lines[i].id,
});
const record = (i: number, feedback = produced) =>
  rateDialogueSentence(undefined, source(i), feedback, start);

function planStorage() {
  const values = new Map<string, string>();
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test("actual advanced single-expression task difficulty responds to its saved need-for-support without inventing sentence evidence", () => {
  const advanced = (
    JSON.parse(
      readFileSync(
        new URL("../public/immersion/week-19.json", import.meta.url),
        "utf8",
      ),
    ) as ImmersionLesson[]
  )[0];
  const expression = advanced.sections.find(
    (item) => !item.review && item.kind === "sentence",
  )!;
  const task = dialoguePracticeTasks(advanced, expression)[0];
  assert.equal(task.id, "current-summary");
  const key = dialoguePracticeKey(expression, task);
  const storage = planStorage();
  assert.equal(
    saveDialoguePracticeDraft(
      key,
      "제 표현을 다시 써요.",
      undefined,
      storage,
      start,
    ).saved,
    true,
  );
  assert.equal(
    saveDialoguePracticeDraft(
      key,
      "제 표현을 다시 써요.",
      "revisit",
      storage,
      start + 1,
    ).saved,
    true,
  );
  let draft = loadDialoguePlan(storage).drafts[key];
  let recommendation = recommendDialogueDifficulty(expression, {}, start + 1, {
    key,
    task,
    record: draft,
  });
  assert.equal(recommendation.mode, "supported");
  assert.equal(recommendation.taskEvidence?.status, "supported");
  assert.deepEqual(
    Object.values(recommendation.evidence),
    [0, 0, 0, 0, 0, 0, 0],
  );
  assert.equal(
    dialoguePracticeVariant(task, "complete").partial,
    false,
    "Manual complete mode remains available",
  );
  const before = storage.getItem(DIALOGUE_PLAN_KEY);
  assert.equal(
    saveDialoguePracticeCompletion(
      key,
      "제 표현을 다시 써요.",
      false,
      storage,
      start + 2,
    ).saved,
    false,
  );
  assert.equal(storage.getItem(DIALOGUE_PLAN_KEY), before);
  assert.equal(
    saveDialoguePracticeCompletion(
      key,
      "전체 목적을 다시 표현했어요.",
      true,
      storage,
      start + 3,
    ).saved,
    true,
  );
  draft = parseDialoguePlan(storage.getItem(DIALOGUE_PLAN_KEY))!.drafts[key];
  recommendation = recommendDialogueDifficulty(expression, {}, start + 3, {
    key,
    task,
    record: draft,
  });
  assert.equal(recommendation.mode, "complete");
  assert.equal(recommendation.evidence.independent, 0);
  assert.equal(recommendation.evidence.delayed, 0);
  assert.equal(draft.practiceStartedAt, start + 1);
  assert.equal(draft.firstAttempt, undefined);
  assert.equal(
    saveDialoguePracticeDraft(
      key,
      "첫 답으로 바꿔요.",
      "independent",
      storage,
      start + 4,
    ).saved,
    false,
  );
  saveDialoguePracticeDraft(key, "", undefined, storage, start + 5);
  draft = loadDialoguePlan(storage).drafts[key];
  assert.deepEqual(draft.taskFeedback, { status: "complete", at: start + 3 });
  assert.equal(draft.practiceStartedAt, start + 1);
  const restored = planStorage();
  importStudy(restored, exportStudy(storage, start + 6));
  const recovered = loadDialoguePlan(restored).drafts[key];
  assert.deepEqual(recovered.taskFeedback, draft.taskFeedback);
  assert.equal(recovered.practiceStartedAt, start + 1);
  assert.equal(
    saveDialoguePracticeDraft(
      key,
      "첫 답이 아니에요.",
      "independent",
      restored,
      start + 7,
    ).saved,
    false,
  );
});

test("only later independent feedback from the same current scene can resolve a task support report; editing and transfer feedback do not manufacture it", () => {
  const task = dialoguePracticeTasks(lesson, section)[0];
  const key = dialoguePracticeKey(section, task);
  const storage = planStorage();
  saveDialoguePracticeDraft(key, "어려워요.", "revisit", storage, start + 5);
  saveDialoguePracticeDraft(
    key,
    "초안을 수정했어요.",
    undefined,
    storage,
    start + 30,
  );
  const draft = loadDialoguePlan(storage).drafts[key];
  assert.deepEqual(draft.taskFeedback, { status: "supported", at: start + 5 });
  const earlier = {
    [dialogueLineKey(source(0))]: record(0),
    [dialogueLineKey(source(1))]: record(1),
  };
  assert.equal(
    recommendDialogueDifficulty(section, earlier, start + 31, {
      key,
      task,
      record: draft,
    }).mode,
    "supported",
  );
  const a = rateDialogueSentence(undefined, source(0), produced, start + 10);
  const b = rateDialogueSentence(undefined, source(1), produced, start + 11);
  const later = { [dialogueLineKey(a)]: a, [dialogueLineKey(b)]: b };
  const lifted = recommendDialogueDifficulty(section, later, start + 31, {
    key,
    task,
    record: draft,
  });
  assert.equal(lifted.mode, "complete");
  assert.equal(lifted.taskEvidence?.resolvedBy, "later-sentence-feedback");
  assert.equal(lifted.evidence.delayed, 0);
  assert.equal(
    recommendDialogueDifficulty(section, later, start + 31, {
      key: `wrong:${key}`,
      task,
      record: draft,
    }).taskEvidence,
    null,
  );
  const transfer = dialoguePracticeTasks(lesson, section).find(
    (item) => item.source === "new-scenario",
  )!;
  assert.equal(
    recommendDialogueDifficulty(section, later, start + 31, {
      key: dialoguePracticeKey(section, transfer),
      task: transfer,
      record: draft,
    }).mode,
    "supported",
  );
  const aided = rateDialogueSentence(
    undefined,
    source(1),
    { ...produced, revealed: true },
    start + 12,
  );
  assert.equal(
    recommendDialogueDifficulty(
      section,
      { [dialogueLineKey(a)]: a, [dialogueLineKey(aided)]: aided },
      start + 31,
      { key, task, record: draft },
    ).mode,
    "supported",
  );
  assert.equal(
    recommendDialogueDifficulty(section, later, start + 2 * day, {
      key,
      task,
      record: draft,
    }).mode,
    "supported",
  );
});

test("complete task self-check never creates extension or overrides weak sentence feedback; failed saves preserve supported evidence", () => {
  const task = dialoguePracticeTasks(lesson, section)[0];
  const key = dialoguePracticeKey(section, task);
  const storage = planStorage();
  saveDialoguePracticeDraft(
    key,
    "다시 연습해요.",
    "revisit",
    storage,
    start + 5,
  );
  const before = storage.getItem(DIALOGUE_PLAN_KEY);
  const failed = {
    ...storage,
    setItem() {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(
    saveDialoguePracticeCompletion(
      key,
      "전체 답을 썼어요.",
      true,
      failed,
      start + 6,
    ).saved,
    false,
  );
  assert.equal(storage.getItem(DIALOGUE_PLAN_KEY), before);
  saveDialoguePracticeCompletion(
    key,
    "전체 답을 썼어요.",
    true,
    storage,
    start + 7,
  );
  const draft = loadDialoguePlan(storage).drafts[key];
  assert.equal(
    recommendDialogueDifficulty(section, {}, start + 8, {
      key,
      task,
      record: draft,
    }).mode,
    "complete",
  );
  const weak = rateDialogueSentence(
    undefined,
    source(0),
    { ...produced, grade: "again" },
    start + 8,
  );
  const recommendation = recommendDialogueDifficulty(
    section,
    { [dialogueLineKey(weak)]: weak },
    start + 9,
    { key, task, record: draft },
  );
  assert.equal(recommendation.mode, "supported");
  assert.equal(recommendation.taskEvidence?.status, "complete");
  assert.equal(recommendation.evidence.independent, 0);
});

test("legacy revisit timing and newer task feedback survive strict parsing, conflict migration and backup merging", () => {
  const oldKey = "w01d1:新内容-w01d1-0:current-reply";
  const canonical = "current:w01d1:w01d1-1:current-reply";
  const legacy = parseDialoguePlan(
    JSON.stringify({
      ...defaultDialoguePlan(),
      drafts: {
        [oldKey]: {
          text: "다시 해요.",
          selfAssessment: "revisit",
          updatedAt: start,
        },
      },
    }),
  )!;
  assert.deepEqual(legacy.drafts[canonical].taskFeedback, {
    status: "supported",
    at: start,
  });
  const storage = planStorage();
  storage.setItem(DIALOGUE_PLAN_KEY, JSON.stringify(legacy));
  saveDialoguePracticeCompletion(
    canonical,
    "전체를 다시 했어요.",
    true,
    storage,
    start + 10,
  );
  saveDialoguePracticeDraft(canonical, "", undefined, storage, start + 20);
  const merged = mergeDialoguePlan(loadDialoguePlan(storage), legacy);
  assert.deepEqual(merged.drafts[canonical].taskFeedback, {
    status: "complete",
    at: start + 10,
  });
  assert.equal(merged.drafts[canonical].practiceStartedAt, start);
  assert.equal(merged.drafts[oldKey].text, "다시 해요.");
  const imported = {
    ...defaultDialoguePlan(),
    drafts: {
      [canonical]: {
        text: "별도 초안이에요.",
        updatedAt: start + 40,
        taskFeedback: { status: "supported" as const, at: start + 5 },
      },
    },
  };
  const conflict = mergeDialoguePlan(merged, imported);
  assert.deepEqual(conflict.drafts[canonical].taskFeedback, {
    status: "complete",
    at: start + 10,
  });
  assert(
    Object.values(conflict.drafts).some(
      (record) =>
        record.conflictOf === canonical &&
        record.taskFeedback?.at === start + 5,
    ),
  );
  for (const taskFeedback of [
    { status: "independent", at: start },
    { status: "supported", at: -1 },
    null,
  ])
    assert.equal(
      parseDialoguePlan(
        JSON.stringify({
          ...defaultDialoguePlan(),
          drafts: {
            [canonical]: { text: "답", updatedAt: start, taskFeedback },
          },
        }),
      ),
      null,
    );
});

test("automatic partial-draft persistence marks practice without pretending the learner explicitly reported needing help", () => {
  const task = dialoguePracticeTasks(lesson, section)[0];
  const key = dialoguePracticeKey(section, task);
  const storage = planStorage();
  saveDialoguePracticeDraft(
    key,
    "한 단계만 썼어요.",
    "revisit",
    storage,
    start,
    false,
  );
  const draft = loadDialoguePlan(storage).drafts[key];
  assert.equal(draft.practiceStartedAt, start);
  assert.equal(draft.taskFeedback, undefined);
  assert.equal(draft.selfAssessment, undefined);
  assert.equal(
    saveDialoguePracticeDraft(
      key,
      "다 썼어요.",
      "independent",
      storage,
      start + 1,
    ).saved,
    false,
  );
});

test("scene recommendations use current evidence, not playback, other scenes, or duplicate copies", () => {
  const exposure = {
    ...record(0),
    grade: null,
    feedbackAt: null,
    feedback: { again: 0, understood: 0, produced: 0 },
    due: null,
    reviewedAt: null,
    streak: 0,
    independentRecalls: 0,
    delayedRecalls: 0,
    attempts: [],
    exposures: 10,
    lastExposedAt: start,
  };
  const unrelated = rateDialogueSentence(
    undefined,
    { ...source(1), lineId: "another-scene" },
    produced,
    start,
  );
  const memory: DialogueMemory = {
    [dialogueLineKey(source(0))]: exposure,
    [dialogueLineKey(unrelated)]: unrelated,
  };
  assert.equal(
    recommendDialogueDifficulty(section, memory, start).evidence.rated,
    0,
  );
  assert.match(
    recommendDialogueDifficulty(section, memory, start).reason,
    /证据不足/,
  );
  const one = record(0);
  const duplicate = { ...section, lines: [section.lines[0], section.lines[0]] };
  assert.equal(
    recommendDialogueDifficulty(
      duplicate,
      { [dialogueLineKey(one)]: one },
      start,
    ).evidence.independent,
    1,
  );
  assert.equal(
    recommendDialogueDifficulty(
      section,
      { [dialogueLineKey(source(0))]: unrelated },
      start,
    ).evidence.rated,
    0,
  );
});

test("latest difficulty can decline without historical independent self-reports overriding it", () => {
  const first = record(0);
  const again = rateDialogueSentence(
    first,
    source(0),
    { ...produced, grade: "again" },
    start + 1,
  );
  assert.ok(again.independentRecalls > 0);
  const recommendation = recommendDialogueDifficulty(
    section,
    { [dialogueLineKey(again)]: again },
    start + 1,
  );
  assert.equal(recommendation.mode, "supported");
  assert.equal(recommendation.evidence.independent, 0);
  assert.equal(recommendation.evidence.again, 1);
});

test("understanding and aided answers remain distinct from independent and delayed evidence", () => {
  const understood = rateDialogueSentence(
    undefined,
    source(0),
    { ...produced, grade: "understood" },
    start,
  );
  const assisted = rateDialogueSentence(
    undefined,
    source(1),
    { ...produced, revealed: true },
    start,
  );
  const recommendation = recommendDialogueDifficulty(
    section,
    {
      [dialogueLineKey(understood)]: understood,
      [dialogueLineKey(assisted)]: assisted,
    },
    start,
  );
  assert.equal(recommendation.mode, "supported");
  assert.deepEqual(
    [
      recommendation.evidence.understood,
      recommendation.evidence.assisted,
      recommendation.evidence.independent,
      recommendation.evidence.delayed,
    ],
    [1, 1, 0, 0],
  );
});

test("extension needs current delayed evidence and returns to complete work when reviews become due", () => {
  const a = record(0),
    b = record(1);
  const memory = { [dialogueLineKey(a)]: a, [dialogueLineKey(b)]: b };
  assert.equal(
    recommendDialogueDifficulty(section, memory, start).mode,
    "complete",
  );
  const delayed = rateDialogueSentence(a, source(0), produced, start + day);
  const freshB = rateDialogueSentence(b, source(1), produced, start + day);
  const current = {
    [dialogueLineKey(delayed)]: delayed,
    [dialogueLineKey(freshB)]: freshB,
  };
  assert.equal(
    recommendDialogueDifficulty(section, current, start + day).mode,
    "extend",
  );
  assert.equal(
    recommendDialogueDifficulty(section, current, start + 5 * day).mode,
    "complete",
  );
});

test("supported weekly output has one communicative goal; complete and extended tasks preserve all goals", () => {
  const task = dialoguePracticeTasks(lesson, section).find(
    (task) => task.source === "new-scenario",
  )!;
  const split = dialoguePracticeVariant(task, "supported", 1);
  assert.equal(split.checklist.length, 1);
  assert.equal(split.checklist[0], task.supportedGoals![1]);
  assert.equal(split.partial, true);
  assert.match(split.prompt, /1–2句/);
  assert.deepEqual(
    dialoguePracticeVariant(task, "complete").checklist,
    task.checklist,
  );
  const extended = dialoguePracticeVariant(task, "extend");
  assert.equal(extended.partial, false);
  assert.ok(extended.checklist.length > task.checklist.length);
  assert.match(extended.prompt, /追问/);
});

test("single and short materials expand their actual meaning without requiring invented opinions", () => {
  const single = {
    ...section,
    kind: "sentence" as const,
    lines: [section.lines[0]],
  };
  const task = dialoguePracticeTasks({ ...lesson, week: 19 }, single)[0];
  assert.equal(dialoguePracticeVariant(task, "supported").steps.length, 1);
  assert.match(
    dialoguePracticeVariant(task, "extend").prompt,
    /没有条件时只改写已有意思/,
  );
  assert.doesNotMatch(
    dialoguePracticeVariant(task, "extend").prompt,
    /原文观点成立|写一个可能的反对意见/,
  );
  const phonetic = dialoguePracticeTasks(lesson, {
    ...single,
    kind: "pronunciation",
  })[0];
  assert.match(dialoguePracticeVariant(phonetic, "extend").prompt, /重复拼合/);
  assert.doesNotMatch(
    dialoguePracticeVariant(phonetic, "extend").prompt,
    /原文观点成立/,
  );
});

test("changing practice difficulty cannot make a saved draft or seen reference an unseen task again", () => {
  const key = "weekly:transfer-w08";
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  };
  saveDialoguePracticeDraft(key, "좋아요.", "revisit", storage, start);
  revealDialoguePracticeReference(key, "좋아요.", storage, start + 1);
  const partial = parseDialoguePlan(data.get(DIALOGUE_PLAN_KEY)!)!;
  saveDialoguePracticeDraft(
    key,
    "비가 오면 실내에서 만나요.",
    undefined,
    storage,
    start + 2,
  );
  assert.equal(
    saveDialoguePracticeDraft(
      key,
      "일요일에 만나요.",
      "independent",
      storage,
      start + 3,
    ).saved,
    false,
  );
  const restored = parseDialoguePlan(
    JSON.stringify(mergeDialoguePlan(defaultDialoguePlan(), partial)),
  )!;
  assert.equal(restored.drafts[key].referenceSeenAt, start + 1);
  assert.equal(restored.drafts[key].firstAttempt?.text, "좋아요.");
});

test("a partial attempt remains practice after clearing, reload and backup merge", () => {
  const key = "weekly:transfer-w09";
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  };
  saveDialoguePracticeDraft(key, "좋아요.", "revisit", storage, start);
  saveDialoguePracticeDraft(key, "", undefined, storage, start + 1);
  const reloaded = parseDialoguePlan(data.get(DIALOGUE_PLAN_KEY)!)!;
  assert.equal(reloaded.drafts[key].text, "");
  assert.equal(reloaded.drafts[key].practiceStartedAt, start);
  assert.equal(reloaded.drafts[key].firstAttempt, undefined);
  assert.equal(
    saveDialoguePracticeDraft(
      key,
      "완성한 답이에요.",
      "independent",
      storage,
      start + 2,
    ).saved,
    false,
  );
  const merged = mergeDialoguePlan(defaultDialoguePlan(), reloaded);
  assert.equal(
    parseDialoguePlan(JSON.stringify(merged))!.drafts[key].practiceStartedAt,
    start,
  );
  const oldBackup = {
    ...defaultDialoguePlan(),
    drafts: {
      [key]: { text: "", updatedAt: start, selfAssessment: "revisit" },
    },
  };
  assert.equal(
    parseDialoguePlan(JSON.stringify(oldBackup))!.drafts[key].practiceStartedAt,
    start,
  );
  assert.equal(
    parseDialoguePlan(
      JSON.stringify({
        ...reloaded,
        drafts: { [key]: { ...reloaded.drafts[key], practiceStartedAt: -1 } },
      }),
    ),
    null,
  );
});
