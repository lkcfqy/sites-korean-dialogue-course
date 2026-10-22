import assert from "node:assert/strict";
import content from "../data/immersion-experience.json";
import { test } from "node:test";
import {
  defaultDialoguePlan,
  mergeDialoguePlan,
  parseDialoguePlan,
  readDialoguePlan,
  saveDialoguePracticeDraft,
  saveImmersionPractice,
} from "../lib/dialogue-plan";
import {
  dailyImmersionMinutes,
  immersionStage,
  scenePracticeKey,
  selectImmersionQueues,
  splitImmersionSpeech,
} from "../lib/immersion-experience";
import type { ImmersionLesson, ImmersionSection } from "../lib/immersion-types";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test("oral attempts need no fabricated written answer and exposure survives later edits", () => {
  const local = storage();
  const key = "immersion:immersion-variation-w01";
  assert.equal(
    saveImmersionPractice(key, { oral: true }, local, 100).saved,
    true,
  );
  assert.equal(
    saveImmersionPractice(key, { reference: true }, local, 200).saved,
    true,
  );
  assert.equal(
    saveDialoguePracticeDraft(key, "", undefined, local, 300).saved,
    true,
  );
  const result = readDialoguePlan(local);
  assert(result.loaded);
  assert.equal(result.plan.drafts[key].text, "");
  assert.equal(result.plan.drafts[key].firstOralAttemptAt, 100);
  assert.equal(result.plan.drafts[key].referenceSeenAt, 200);
  assert.equal(result.plan.drafts[key].firstAttempt, undefined);
  assert.equal(
    saveImmersionPractice(key, { oral: true }, local, 400).saved,
    true,
  );
  const next = readDialoguePlan(local);
  assert(next.loaded);
  assert.equal(next.plan.drafts[key].firstOralAttemptAt, 100);
  assert.equal(next.plan.drafts[key].oralAttemptAt, 400);
});

test("revealing first or having notes prevents recording a new first oral attempt", () => {
  for (const initial of [{ reference: true }, { text: "내일 만나요." }]) {
    const local = storage();
    saveImmersionPractice("immersion:checkpoint", initial, local, 100);
    saveImmersionPractice("immersion:checkpoint", { oral: true }, local, 200);
    const result = readDialoguePlan(local);
    assert(result.loaded);
    assert.equal(
      result.plan.drafts["immersion:checkpoint"].firstOralAttemptAt,
      undefined,
    );
  }
});

test("old plans remain valid and backup merge preserves local notes and honest evidence", () => {
  const current = defaultDialoguePlan();
  assert(parseDialoguePlan(JSON.stringify(current)));
  const key = "immersion:scene:w01d1:original-line";
  current.drafts[key] = {
    text: "本机笔记",
    updatedAt: 400,
    oralAttemptAt: 400,
    firstOralAttemptAt: 200,
    referenceSeenAt: 300,
    immersionFeedback: {
      understanding: "gist",
      expression: "supported",
      at: 400,
    },
  };
  const incoming = defaultDialoguePlan();
  incoming.drafts[key] = {
    text: "导入笔记",
    updatedAt: 600,
    oralAttemptAt: 600,
    firstOralAttemptAt: 100,
    referenceSeenAt: 150,
    listeningSeenAt: 50,
    immersionFeedback: {
      understanding: "clear",
      expression: "complete",
      at: 600,
    },
  };
  const merged = mergeDialoguePlan(current, incoming);
  assert.equal(merged.drafts[key].text, "本机笔记");
  assert.equal(merged.drafts[key].referenceSeenAt, 150);
  assert.equal(merged.drafts[key].firstOralAttemptAt, 100);
  assert.equal(merged.drafts[key].oralAttemptAt, 600);
  assert.equal(merged.drafts[key].immersionFeedback?.expression, "complete");
  assert.equal(merged.drafts[key].listeningSeenAt, 50);
  assert(
    Object.values(merged.drafts).some(
      (draft) => draft.conflictOf === key && draft.text === "导入笔记",
    ),
  );
  assert.deepEqual(parseDialoguePlan(JSON.stringify(merged)), merged);
});

test("corrupt or unavailable storage never becomes an empty overwritten record", () => {
  const broken = {
    getItem: () => "broken-json",
    setItem: () => {
      throw new Error("should not overwrite");
    },
  };
  assert.equal(
    saveImmersionPractice("immersion:test", { oral: true }, broken).saved,
    false,
  );
  const bad = defaultDialoguePlan();
  bad.drafts["immersion:test"] = {
    text: "",
    updatedAt: 100,
    immersionFeedback: {
      understanding: "fake" as "gist",
      expression: "complete",
      at: 100,
    },
  };
  assert.equal(parseDialoguePlan(JSON.stringify(bad)), null);
});

test("variation IDs isolate records and do not contaminate original sentence recall", () => {
  const local = storage();
  saveImmersionPractice("immersion:variation-w01", { oral: true }, local, 100);
  saveImmersionPractice(
    "immersion:checkpoint-w04",
    { reference: true },
    local,
    200,
  );
  const result = readDialoguePlan(local);
  assert(result.loaded);
  assert.equal(
    result.plan.drafts["immersion:variation-w01"].referenceSeenAt,
    undefined,
  );
  assert.equal(
    result.plan.drafts["immersion:checkpoint-w04"].oralAttemptAt,
    undefined,
  );
  assert.equal(local.getItem("korean-dialogue-memory-v1"), null);
});

test("all 26 weeks have a progression stage and daily time budgets stay exact", () => {
  for (let week = 1; week <= 26; week++) {
    const stage = immersionStage(week);
    assert(week >= stage.from && week <= stage.to);
  }
  for (const minutes of [15, 30, 60, 180, 240, 360]) {
    const time = dailyImmersionMinutes(minutes);
    assert.equal(
      time.review +
        time.focus +
        time.listening +
        time.speaking +
        time.reflection,
      minutes,
    );
  }
});

test("whole-scene queues deduplicate review identities and distinguish fresh from heard", () => {
  const make = (key: string, review: boolean): ImmersionSection => ({
    key,
    label: key,
    scene: "",
    kind: "dialogue",
    review,
    source: { id: "w01d1", title: "", week: 1, day: 1 },
    lines: [
      { id: "w01d1-1", ko: "안녕하세요.", zh: "你好", speaker: "A", words: [] },
    ],
  });
  const original = make("original", false),
    review = make("review", true),
    copiedReview = make("review-copy", true);
  const lesson = {
    id: "w01d2",
    week: 1,
    day: 2,
    title: "",
    scene: "",
    kind: "new",
    vocabulary: [],
    sceneVocabulary: [],
    reviewVocabulary: [],
    newLines: 1,
    reviewLines: 2,
    sections: [original, review, copiedReview],
  } as ImmersionLesson;
  const plan = defaultDialoguePlan();
  assert.equal(selectImmersionQueues(lesson, plan).familiar.length, 1);
  const firstDay = { ...lesson, sections: [original] };
  assert.equal(selectImmersionQueues(firstDay, plan).hasFamiliar, false);
  plan.drafts[scenePracticeKey(original)] = {
    text: "",
    updatedAt: 100,
    listeningSeenAt: 100,
  };
  assert.equal(selectImmersionQueues(firstDay, plan).hasFamiliar, true);
  plan.minutes = 15;
  plan.drafts[scenePracticeKey(original)].immersionFeedback = {
    understanding: "retry",
    expression: "supported",
    at: 100,
  };
  assert.equal(selectImmersionQueues(firstDay, plan, 40).focus.length, 1);
});

test("new variations and checkpoints preserve complete, distinct publishable content", () => {
  assert.deepEqual(
    content.variations.map((item) => item.week),
    Array.from({ length: 26 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    content.checkpoints.map((item) => item.week),
    [4, 8, 12, 16, 20, 24, 26],
  );
  const ids = [...content.variations, ...content.checkpoints].map(
    (item) => item.id,
  );
  assert.equal(new Set(ids).size, 33);
  const learning = new Set(
    content.variations.flatMap((item) => [
      item.cue,
      item.followup.cue,
      ...item.responses.map((response) => response.ko),
    ]),
  );
  for (const item of content.variations) {
    assert.equal(item.responses.length, 2);
    assert.notEqual(item.responses[0].ko, item.responses[1].ko);
    assert(
      item.goals.length >= 2 && item.followup.task && /[가-힣]/.test(item.cue),
    );
  }
  for (const item of content.checkpoints) {
    assert(item.dialogue.length >= 6 && item.dialogue.length <= 12);
    assert.equal(item.questions.length, 3);
    assert.equal(item.criteria.length, 3);
    assert(
      item.dialogue.every(
        (line) =>
          ["A", "B", "C"].includes(line.speaker) &&
          /[가-힣]/.test(line.ko) &&
          !learning.has(line.ko),
      ),
    );
    assert(
      item.questions.every((question) => question.question && question.answer),
    );
  }
});

test("advanced reference speech stays complete while each request fits the service limit", () => {
  for (const task of content.variations)
    for (const response of task.responses) {
      const chunks = splitImmersionSpeech([
        { id: task.id, text: response.ko, speaker: "A" },
      ]);
      assert(
        chunks.every(
          (chunk) => chunk.text.length <= 240 && /[가-힣]/.test(chunk.text),
        ),
      );
      assert.equal(chunks.map((chunk) => chunk.text).join(" "), response.ko);
    }
});
