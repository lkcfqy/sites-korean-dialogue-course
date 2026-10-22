import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answerMatches,
  emptyStudy,
  parseStudy,
  recordQuiz,
  STUDY_KEY,
  type QuizRecord,
} from "../lib/study-records";
import { analyzeWriting, writingCount } from "../lib/writing-feedback";
import { exportStudy, parseBackup, importStudy } from "../lib/study-backup";
import { MEMORY_KEY } from "../lib/learning-memory";
import { deadlinePassed, scoreQuiz } from "../lib/quiz-scoring";
import {
  DIALOGUE_POSITION_KEY,
  DIALOGUE_SETTINGS_KEY,
} from "../lib/dialogue-study";
import {
  DIALOGUE_MEMORY_KEY,
  dialogueLineKey,
  parseDialogueMemory,
  rateDialogueSentence,
  type DialogueSource,
} from "../lib/dialogue-memory";
import { DIALOGUE_PLAN_KEY, parseDialoguePlan } from "../lib/dialogue-plan";
class FakeStorage {
  data = new Map<string, string>();
  fail: string | null = null;
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail === key) {
      this.fail = null;
      throw new Error("quota");
    }
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
test("answer matching tolerates punctuation and composed Hangul, but preserves word forms and spacing", () => {
  assert.equal(answerMatches("학생이에요!", ["학생이에요."]), true);
  assert.equal(answerMatches("학생", ["학생"]), true);
  assert.equal(answerMatches("학생예요", ["학생이에요"]), false);
  assert.equal(answerMatches("할수 있다", ["할 수 있다"]), false);
  assert.equal(answerMatches("", [""]), false);
});
test("timed submissions close exactly at the deadline and missing answers stay in the score denominator", () => {
  assert.equal(deadlinePassed(1000, 1, 60999), false);
  assert.equal(deadlinePassed(1000, 1, 61000), true);
  const result = scoreQuiz(
    [
      { id: "a", accepted: ["학교"] },
      { id: "b", accepted: ["책"] },
      { id: "c", accepted: ["물"] },
    ],
    { a: "학교.", b: "학생" },
  );
  assert.equal(result.correct, 1);
  assert.equal(result.total, 3);
  assert.equal(result.missing, 1);
  assert.deepEqual(
    result.answers.map((a) => a.correct),
    [true, false, false],
  );
});
test("immediate correction does not clear a mistake; two due-date recalls do", () => {
  const storage = new FakeStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: { dispatchEvent: () => true },
    configurable: true,
  });
  const at = 1000000000;
  const attempt = (time: number, correct: boolean): QuizRecord => ({
    id: "reading-set-w1",
    week: 1,
    skill: "reading",
    correct: correct ? 1 : 0,
    total: 1,
    seconds: 10,
    at: time,
    mistakes: correct ? [] : ["reading-w1-1"],
    completed: true,
    delayed: false,
  });
  recordQuiz(attempt(at, false), [{ id: "reading-w1-1", correct: false }]);
  recordQuiz(attempt(at + 1000, true), [{ id: "reading-w1-1", correct: true }]);
  let study = parseStudy(storage.getItem(STUDY_KEY));
  assert.equal(study.mistakes["reading-w1-1"].corrected, 0);
  recordQuiz(attempt(at + 86400000, true), [
    { id: "reading-w1-1", correct: true },
  ]);
  study = parseStudy(storage.getItem(STUDY_KEY));
  assert.equal(study.mistakes["reading-w1-1"].corrected, 1);
  recordQuiz(attempt(at + 2 * 86400000, true), [
    { id: "reading-w1-1", correct: true },
  ]);
  study = parseStudy(storage.getItem(STUDY_KEY));
  assert.equal(study.mistakes["reading-w1-1"].corrected, 2);
  recordQuiz(attempt(at + 3 * 86400000, false), [
    { id: "reading-w1-1", correct: false },
  ]);
  study = parseStudy(storage.getItem(STUDY_KEY));
  assert.equal(study.mistakes["reading-w1-1"].corrected, 0);
  assert.equal(study.mistakes["reading-w1-1"].failures, 2);
});
test("malformed study attempts and invalid score totals cannot become saved progress", () => {
  assert.deepEqual(parseStudy("bad"), emptyStudy());
  const invalid = {
    attempts: [{ id: "x", week: 27, skill: "reading", correct: 10, total: 2 }],
    mistakes: {
      x: {
        id: "x",
        week: 1,
        skill: "reading",
        failures: -1,
        due: 0,
        corrected: 0,
      },
    },
    writing: {},
  };
  const parsed = parseStudy(JSON.stringify(invalid));
  assert.equal(parsed.attempts.length, 0);
  assert.equal(Object.keys(parsed.mistakes).length, 0);
});
test("writing feedback localises errors without treating cautious or polite prose as automatically wrong", () => {
  const found = analyzeWriting(
    "학생예요. 공부할수 있다. 시간이 절약된다. 모두에게 좋아요.",
    10,
    200,
    true,
  );
  assert.ok(found.some((x) => x.id === "student" && x.excerpt === "학생예요"));
  assert.ok(found.some((x) => x.id.startsWith("halsu")));
  assert.ok(found.some((x) => x.id === "style"));
  assert.ok(
    !analyzeWriting("학교예요. 저는 학생이에요.", 5, 200, false).some(
      (x) => x.id === "style",
    ),
  );
  assert.ok(
    !analyzeWriting("10명에서 100명으로 늘었다.", 5, 200, true, [
      "10",
      "100",
    ]).some((x) => x.id === "numbers"),
  );
  assert.ok(
    analyzeWriting("100명으로 늘었다.", 5, 200, true, ["10"]).some(
      (x) => x.id === "numbers",
    ),
  );
  assert.equal(writingCount("가 나\n다"), 4);
  assert.deepEqual(analyzeWriting("", 10, 200, true), []);
});
test("backups include only course records and merge newer word recall without overwriting existing drafts", () => {
  const source = new FakeStorage(),
    dest = new FakeStorage();
  source.setItem(
    MEMORY_KEY,
    JSON.stringify({
      학생: { streak: 2, due: 300, reviewed: 200, lapses: 0 },
      책: { streak: 1, due: 200, reviewed: 100, lapses: 0 },
    }),
  );
  source.setItem("korean-writing-w1", "새 글");
  source.setItem("unrelated-secret", "hidden");
  dest.setItem(
    MEMORY_KEY,
    JSON.stringify({ 학생: { streak: 3, due: 500, reviewed: 300, lapses: 0 } }),
  );
  dest.setItem("korean-writing-w1", "현재 글");
  const backup = parseBackup(JSON.stringify(exportStudy(source, 100)));
  assert.ok(!("unrelated-secret" in backup.data));
  const result = importStudy(dest, backup);
  assert.equal(result.preserved, 1);
  assert.equal(dest.getItem("korean-writing-w1"), "현재 글");
  const memory = JSON.parse(dest.getItem(MEMORY_KEY)!);
  assert.equal(memory.학생.reviewed, 300);
  assert.ok(memory.책);
});
test("invalid backup keys and corrupt records are rejected before any writes", () => {
  const make = (data: Record<string, string>) =>
    JSON.stringify({
      format: "korean-course-backup",
      version: 1,
      createdAt: 10,
      data,
    });
  assert.throws(() => parseBackup(make({ "session-token": "unsafe" })));
  assert.throws(() =>
    parseBackup(
      make({ [MEMORY_KEY]: JSON.stringify({ 학생: { streak: -1 } }) }),
    ),
  );
  assert.throws(() =>
    parseBackup(
      make({ [STUDY_KEY]: JSON.stringify({ attempts: [{ id: "bad" }] }) }),
    ),
  );
});
test("storage failure during restore rolls back earlier writes", () => {
  const dest = new FakeStorage();
  dest.setItem(MEMORY_KEY, "{}");
  dest.fail = "korean-writing-w1";
  const b = parseBackup(
    JSON.stringify({
      format: "korean-course-backup",
      version: 1,
      createdAt: 10,
      data: {
        [MEMORY_KEY]: JSON.stringify({
          책: { streak: 1, due: 20, reviewed: 10, lapses: 0 },
        }),
        "korean-writing-w1": "draft",
      },
    }),
  );
  assert.throws(() => importStudy(dest, b));
  assert.equal(dest.getItem(MEMORY_KEY), "{}");
  assert.equal(dest.getItem("korean-writing-w1"), null);
});
test("backup merge compares the same mistake's update time rather than another question's recent attempt", () => {
  const dest = new FakeStorage();
  const current = emptyStudy(),
    incoming = emptyStudy();
  current.mistakes.q1 = {
    id: "q1",
    week: 1,
    skill: "reading",
    failures: 1,
    due: 100,
    corrected: 0,
    updatedAt: 10,
  };
  current.attempts = [
    {
      id: "other",
      week: 1,
      skill: "reading",
      correct: 1,
      total: 1,
      seconds: 5,
      at: 1000,
      mistakes: [],
      completed: true,
      delayed: false,
    },
  ];
  incoming.mistakes.q1 = {
    id: "q1",
    week: 1,
    skill: "reading",
    failures: 1,
    due: 200,
    corrected: 1,
    updatedAt: 20,
  };
  dest.setItem(STUDY_KEY, JSON.stringify(current));
  const backup = parseBackup(
    JSON.stringify({
      format: "korean-course-backup",
      version: 1,
      createdAt: 2000,
      data: { [STUDY_KEY]: JSON.stringify(incoming) },
    }),
  );
  importStudy(dest, backup);
  assert.equal(parseStudy(dest.getItem(STUDY_KEY)).mistakes.q1.corrected, 1);
});

test("a large exported Korean draft backup can be imported without the old byte/character mismatch", () => {
  const source = new FakeStorage();
  for (let week = 1; week <= 26; week++)
    source.setItem(
      `korean-writing-w${week}-versions`,
      JSON.stringify(
        Array.from({ length: 5 }, () => ({
          text: "한".repeat(20000),
          at: week,
        })),
      ),
    );
  const raw = JSON.stringify(exportStudy(source, 100));
  assert(new TextEncoder().encode(raw).byteLength > 5_000_000);
  const dest = new FakeStorage();
  importStudy(dest, parseBackup(raw));
  assert.equal(
    dest.getItem("korean-writing-w26-versions"),
    source.getItem("korean-writing-w26-versions"),
  );
});

test("backups reject primitive records, invalid timestamps, and malformed persisted preferences", () => {
  const make = (data: Record<string, string>, createdAt = 10) =>
    JSON.stringify({
      format: "korean-course-backup",
      version: 1,
      createdAt,
      data,
    });
  const valid = { streak: 1, due: 200, reviewed: 100, lapses: 0 };
  for (const value of [
    "17",
    "true",
    "[]",
    JSON.stringify({ 학생: { ...valid, due: 1e99 } }),
    JSON.stringify({ 학생: { ...valid, streak: 8 } }),
  ]) {
    assert.throws(() => parseBackup(make({ [MEMORY_KEY]: value })));
  }
  assert.throws(() => parseBackup(make({}, 1e99)));
  for (const [key, value] of [
    ["korean-vocabulary-settings-v2", "[]"],
    ["korean-vocabulary-settings-v2", JSON.stringify({ speed: "1" })],
    ["korean-vocabulary-settings-v2", JSON.stringify({ direction: "invalid" })],
    ["korean-dialogue-speed", "NaN"],
    ["korean-dialogue-lesson-v2", "w27d1"],
    ["korean-vocabulary-cursor-v2-w01d1-daily", "not-a-word"],
    ["korean-writing-w1-versions", JSON.stringify([{ text: "글", at: 1e99 }])],
    [
      "korean-writing-w1-review",
      JSON.stringify({ review: { teacher: "yes" } }),
    ],
    [
      "korean-mock-record-v1",
      JSON.stringify([
        {
          id: "x",
          title: "套题",
          listening: 101,
          reading: 80,
          writing: 80,
          teacher: true,
          at: 10,
        },
      ]),
    ],
  ])
    assert.throws(() => parseBackup(make({ [key]: value })), key);
});

test("study records accept only integral scores and valid dates and strip unrelated payloads", () => {
  const attempt = {
    id: "reading-w1",
    week: 1,
    skill: "reading",
    correct: 1,
    total: 1,
    seconds: 10,
    at: 100,
    mistakes: [],
    completed: true,
    delayed: false,
  };
  const raw = JSON.stringify({
    attempts: [attempt, { ...attempt, at: 1e99 }, { ...attempt, correct: 0.5 }],
    mistakes: {
      q1: {
        id: "q1",
        week: 1,
        skill: "reading",
        failures: 1,
        due: 1e99,
        corrected: 0,
      },
    },
    writing: { w1: { at: 1e99, revised: false, checks: [] } },
  });
  const parsed = parseStudy(raw);
  assert.deepEqual(parsed, { attempts: [attempt], mistakes: {}, writing: {} });
  const extra = parseStudy(
    JSON.stringify({
      attempts: [{ ...attempt, untrusted: { large: "payload" } }],
      mistakes: {},
      writing: {},
    }),
  );
  assert.deepEqual(extra.attempts, [attempt]);
});

test("dialogue positions and settings survive backup without replacing existing local choices", () => {
  const source = new FakeStorage(),
    dest = new FakeStorage();
  const position = JSON.stringify({
    version: 1,
    lessonId: "w19d1",
    sectionKey: "passage",
    lineId: "line-3",
  });
  const settings = JSON.stringify({
    version: 1,
    gap: 4,
    reading: "paragraph",
    range: "week",
  });
  source.setItem(DIALOGUE_POSITION_KEY, position);
  source.setItem(DIALOGUE_SETTINGS_KEY, settings);
  const backup = parseBackup(JSON.stringify(exportStudy(source, 100)));
  importStudy(dest, backup);
  assert.equal(dest.getItem(DIALOGUE_POSITION_KEY), position);
  assert.equal(dest.getItem(DIALOGUE_SETTINGS_KEY), settings);
  const local = JSON.stringify({
    version: 1,
    gap: 0,
    reading: "auto",
    range: "section",
  });
  dest.setItem(DIALOGUE_SETTINGS_KEY, local);
  importStudy(dest, backup);
  assert.equal(dest.getItem(DIALOGUE_SETTINGS_KEY), local);
  for (const value of [
    JSON.stringify({
      version: 1,
      lessonId: "w27d1",
      sectionKey: null,
      lineId: null,
    }),
    JSON.stringify({
      version: 1,
      lessonId: "w01d1",
      sectionKey: "\u0000",
      lineId: null,
    }),
  ]) {
    assert.throws(() =>
      parseBackup(
        JSON.stringify({ ...backup, data: { [DIALOGUE_POSITION_KEY]: value } }),
      ),
    );
  }
});

test("the import write boundary validates all values before touching storage", () => {
  const dest = new FakeStorage();
  const backup = exportStudy(dest, 10);
  backup.data[MEMORY_KEY] = "{}";
  backup.data["korean-dialogue-speed"] = "broken";
  assert.throws(() => importStudy(dest, backup));
  assert.equal(dest.length, 0);
});

test("dialogue memory backup retains local sentences, drafts and exposures while merging newer recall evidence", () => {
  const source = new FakeStorage(),
    dest = new FakeStorage();
  const ref: DialogueSource = {
    lessonId: "w02d1",
    sectionKey: null,
    lineId: "line-1",
  };
  const key = dialogueLineKey(ref);
  const feedback = {
    grade: "produced",
    draft: "학교에 가요.",
    revealed: false,
  } as const;
  const first = rateDialogueSentence(undefined, ref, feedback, 1000);
  const recalled = rateDialogueSentence(first, ref, feedback, first.due!);
  const local = {
    ...first,
    draft: "본기에서 쓴 답",
    draftAt: 2000,
    updatedAt: 2000,
  };
  const another = { ...ref, lineId: "local-only" };
  dest.setItem(
    DIALOGUE_MEMORY_KEY,
    JSON.stringify({
      [key]: local,
      [dialogueLineKey(another)]: rateDialogueSentence(
        undefined,
        another,
        feedback,
        1000,
      ),
    }),
  );
  source.setItem(DIALOGUE_MEMORY_KEY, JSON.stringify({ [key]: recalled }));
  const backup = parseBackup(JSON.stringify(exportStudy(source, 100)));
  importStudy(dest, backup);
  const merged = parseDialogueMemory(dest.getItem(DIALOGUE_MEMORY_KEY));
  assert.equal(merged[key].draft, local.draft);
  assert.equal(merged[key].due, recalled.due);
  assert.equal(merged[key].delayedRecalls, 1);
  assert.equal(merged[key].attempts.length, 2);
  assert.equal(Object.keys(merged).length, 2);
  const saved = dest.getItem(DIALOGUE_MEMORY_KEY);
  importStudy(dest, backup);
  assert.equal(dest.getItem(DIALOGUE_MEMORY_KEY), saved);
});

test("dialogue plans preserve local written answers and preferences while importing missing tasks", () => {
  const source = new FakeStorage(),
    dest = new FakeStorage();
  const local = {
    version: 1,
    minutes: 60,
    startingPoint: "phrases",
    updatedAt: 100,
    drafts: { "w01d1:daily:task": { text: "제 답", updatedAt: 100 } },
  };
  const incoming = {
    version: 1,
    minutes: 120,
    startingPoint: "paragraphs",
    updatedAt: 200,
    drafts: {
      "w01d1:daily:task": { text: "다른 답", updatedAt: 200 },
      "w01d2:daily:task": { text: "새 답", updatedAt: 200 },
    },
  };
  dest.setItem(DIALOGUE_PLAN_KEY, JSON.stringify(local));
  source.setItem(DIALOGUE_PLAN_KEY, JSON.stringify(incoming));
  importStudy(dest, parseBackup(JSON.stringify(exportStudy(source, 200))));
  const merged = parseDialoguePlan(dest.getItem(DIALOGUE_PLAN_KEY))!;
  assert.equal(merged.minutes, 60);
  assert.equal(merged.startingPoint, "phrases");
  assert.equal(merged.drafts["w01d1:daily:task"].text, "제 답");
  assert.equal(merged.drafts["w01d2:daily:task"].text, "새 답");
});

test("dialogue exports/imports reject corrupt evidence, malformed plans and damaged destination data before writing", () => {
  const ref: DialogueSource = {
    lessonId: "w02d1",
    sectionKey: null,
    lineId: "line-1",
  };
  const valid = rateDialogueSentence(
    undefined,
    ref,
    { grade: "produced", draft: "학교", revealed: false },
    1000,
  );
  const make = (key: string, value: string) => ({
    format: "korean-course-backup" as const,
    version: 1 as const,
    createdAt: 100,
    data: { [key]: value },
  });
  const invalidMemory = JSON.stringify({
    [dialogueLineKey(ref)]: {
      ...valid,
      attempts: [{ ...valid.attempts[0], delayed: true }],
    },
  });
  assert.throws(() =>
    parseBackup(JSON.stringify(make(DIALOGUE_MEMORY_KEY, invalidMemory))),
  );
  const corruptSource = new FakeStorage();
  corruptSource.setItem(DIALOGUE_MEMORY_KEY, invalidMemory);
  assert.throws(() => exportStudy(corruptSource));
  assert.throws(() =>
    parseBackup(
      JSON.stringify(
        make(
          DIALOGUE_PLAN_KEY,
          JSON.stringify({
            version: 1,
            minutes: 0,
            startingPoint: "alphabet",
            updatedAt: 100,
            drafts: {},
          }),
        ),
      ),
    ),
  );
  for (const [key, value] of [
    [DIALOGUE_MEMORY_KEY, JSON.stringify({ [dialogueLineKey(ref)]: valid })],
    [
      DIALOGUE_PLAN_KEY,
      JSON.stringify({
        version: 1,
        minutes: 60,
        startingPoint: "alphabet",
        updatedAt: 100,
        drafts: {},
      }),
    ],
  ]) {
    const dest = new FakeStorage();
    dest.setItem(key, "corrupt existing data");
    const before = dest.getItem(key);
    assert.throws(() => importStudy(dest, make(key, value)));
    assert.equal(dest.getItem(key), before);
  }
});

test("a failed dialogue backup import restores every previously written key", () => {
  const ref: DialogueSource = {
    lessonId: "w01d1",
    sectionKey: null,
    lineId: "line-1",
  };
  const source = new FakeStorage(),
    dest = new FakeStorage();
  source.setItem(
    DIALOGUE_MEMORY_KEY,
    JSON.stringify({
      [dialogueLineKey(ref)]: rateDialogueSentence(
        undefined,
        ref,
        { grade: "understood", draft: "", revealed: true },
        1000,
      ),
    }),
  );
  source.setItem(
    DIALOGUE_PLAN_KEY,
    JSON.stringify({
      version: 1,
      minutes: 60,
      startingPoint: "alphabet",
      updatedAt: 1000,
      drafts: {},
    }),
  );
  dest.setItem(DIALOGUE_MEMORY_KEY, "{}");
  dest.fail = DIALOGUE_PLAN_KEY;
  assert.throws(() => importStudy(dest, exportStudy(source, 1000)));
  assert.equal(dest.getItem(DIALOGUE_MEMORY_KEY), "{}");
  assert.equal(dest.getItem(DIALOGUE_PLAN_KEY), null);
});
