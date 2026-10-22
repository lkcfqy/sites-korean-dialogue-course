import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dailyQueue,
  parseMemory,
  rateWord,
  REVIEW_LIMIT,
  MEMORY_KEY,
  saveRecall,
  type Memory,
} from "../lib/learning-memory";
import { MAX_TIMESTAMP } from "../lib/study-validation";
import { parseReviewWeek } from "../lib/vocabulary-review";
import weekOne from "../public/immersion/week-01.json";
import words from "../data/vocabulary-client.json";

const start = new Date(2026, 9, 3, 10).getTime();
const daysAfter = (time: number, days: number) => {
  const date = new Date(time);
  date.setDate(date.getDate() + days);
  return date.getTime();
};

test("forgotten and difficult words return promptly, with failure history retained", () => {
  const forgotten = rateWord(
    { streak: 5, due: daysAfter(start, 30), reviewed: start - 1, lapses: 2 },
    "again",
    start,
  );
  assert.equal(forgotten.streak, 0);
  assert.equal(forgotten.due, start + 10 * 60_000);
  assert.equal(forgotten.lapses, 3);
  const difficult = rateWord(forgotten, "hard", start);
  assert.equal(difficult.due, daysAfter(start, 1));
  assert.equal(difficult.lapses, 3);
});

test("successful recalls spaced at the due date increase the interval", () => {
  let time = start;
  let memory;
  for (const interval of [1, 3, 7, 14, 30, 60, 90, 90]) {
    memory = rateWord(memory, "good", time);
    assert.equal(memory.due, daysAfter(time, interval));
    time = memory.due;
  }
  assert.equal(memory?.streak, 7);
});

test("reopening cards on the same day or before they are due cannot inflate mastery", () => {
  const initial = rateWord(undefined, "good", start);
  const repeated = rateWord(initial, "good", start + 60_000);
  assert.equal(repeated.streak, 1);
  assert.equal(repeated.due, initial.due);
  const retained = {
    streak: 5,
    due: daysAfter(start, 30),
    reviewed: start,
    lapses: 0,
  };
  assert.equal(
    rateWord(retained, "good", daysAfter(start, 2)).due,
    retained.due,
  );
  const forgotten = rateWord(retained, "again", start);
  const corrected = rateWord(forgotten, "good", start + 60_000);
  assert.equal(corrected.streak, 1);
  assert.equal(corrected.due, daysAfter(start + 60_000, 1));
});

test("due words precede new words, exclude future reviews, and deduplicate headwords", () => {
  const memory: Memory = {
    오늘: { streak: 1, due: start - 1, reviewed: start - 2, lapses: 0 },
    한국어: { streak: 0, due: start - 10, reviewed: start - 20, lapses: 2 },
    학교: { streak: 2, due: start + 1, reviewed: start - 20, lapses: 0 },
    삭제: { streak: 0, due: 0, reviewed: 0, lapses: 0 },
  };
  const queue = dailyQueue(
    ["학교", "새롭다", "새롭다", "missing"],
    memory,
    new Set(["오늘", "한국어", "학교", "새롭다"]),
    start,
  );
  assert.deepEqual(queue.words, ["한국어", "오늘", "새롭다"]);
  assert.equal(queue.due, 2);
  assert.equal(queue.fresh, 1);
});

test("an early recall on the due-date morning does not block a later spaced recall", () => {
  const yesterday = new Date(2026, 9, 2, 12).getTime();
  const prior = rateWord(undefined, "good", yesterday);
  const morning = new Date(2026, 9, 3, 9).getTime();
  const early = rateWord(prior, "good", morning);
  assert.equal(early.reviewed, prior.reviewed);
  const due = rateWord(early, "good", prior.due);
  assert.equal(due.streak, 2);
  assert.equal(due.due, daysAfter(prior.due, 3));
});

test("review backlog is retained and exposed instead of making an unbounded session", () => {
  const memory: Memory = Object.fromEntries(
    Array.from({ length: REVIEW_LIMIT + 7 }, (_, index) => [
      String.fromCharCode(0xac00 + index),
      { streak: 1, due: start - 1000 + index, reviewed: 0, lapses: 0 },
    ]),
  );
  const queue = dailyQueue([], memory, new Set(Object.keys(memory)), start);
  assert.equal(queue.words.length, REVIEW_LIMIT);
  assert.equal(queue.remaining, 7);
  assert.equal(queue.due, REVIEW_LIMIT + 7);
  assert.equal(Object.keys(memory).length, REVIEW_LIMIT + 7);
});

test("corrupt local data cannot silently poison the review queue", () => {
  for (const raw of ["bad json", "null", "[]", "17"])
    assert.deepEqual(parseMemory(raw), {});
  const safe = rateWord(undefined, "good", start);
  const parsed = parseMemory(
    JSON.stringify({
      한국어: safe,
      오늘: { ...safe, due: "tomorrow" },
      학교: { ...safe, streak: -1 },
      invalid: safe,
    }),
  );
  assert.deepEqual(parsed, { 한국어: safe });
});

test("memory rejects invalid dates, unsupported streaks, and fractional counters", () => {
  const safe = rateWord(undefined, "good", start);
  for (const patch of [
    { due: 1e99 },
    { reviewed: 1e99 },
    { due: -1 },
    { due: start - 1 },
    { streak: 8 },
    { streak: 1.5 },
    { lapses: 0.5 },
    { lapses: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.deepEqual(
      parseMemory(JSON.stringify({ 학생: { ...safe, ...patch } })),
      {},
    );
  }
  assert.deepEqual(
    parseMemory(
      JSON.stringify({ 학생: { ...safe, extra: { untrusted: true } } }),
    ),
    { 학생: safe },
  );
});

test("direct recalls recover invalid prior records and reject unschedulable timestamps", () => {
  const invalid = { streak: 99, due: 1e99, reviewed: 1e99, lapses: 0 };
  assert.deepEqual(
    rateWord(invalid, "good", start),
    rateWord(undefined, "good", start),
  );
  assert.throws(() => rateWord(undefined, "good", 1e99));
  assert.throws(() => rateWord(undefined, "good", MAX_TIMESTAMP));
});

test("failed storage reads or writes never report a saved recall or overwrite previous progress", (t) => {
  const beforeStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const beforeWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => {
    if (beforeStorage)
      Object.defineProperty(globalThis, "localStorage", beforeStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (beforeWindow) Object.defineProperty(globalThis, "window", beforeWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const original = JSON.stringify({ 학교: rateWord(undefined, "good", start) });
  let stored = original;
  let readable = false;
  let writable = false;
  let writes = 0;
  let events = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => {
        if (!readable) throw new Error("blocked");
        return stored;
      },
      setItem: (key: string, value: string) => {
        writes += 1;
        assert.equal(key, MEMORY_KEY);
        if (!writable) throw new Error("quota");
        stored = value;
      },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent: () => {
        events += 1;
      },
    },
  });
  assert.deepEqual(saveRecall("학생", "good", start), { saved: false });
  assert.equal(writes, 0);
  readable = true;
  assert.deepEqual(saveRecall("학생", "good", start), { saved: false });
  assert.equal(stored, original);
  assert.equal(events, 0);
  writable = true;
  const result = saveRecall("학생", "good", start);
  assert.equal(result.saved, true);
  assert.equal(events, 1);
  assert.deepEqual(Object.keys(parseMemory(stored)).sort(), ["학교", "학생"]);
});

test("lazy review lists retain the entire review day and validate the requested week's lessons", () => {
  const ids = weekOne.map((lesson) => lesson.id);
  const valid = new Set(words.map((word) => word.ko));
  const parsed = parseReviewWeek(weekOne, ids, valid);
  assert.deepEqual(parsed.w01d7, weekOne[6].reviewVocabulary);
  assert(parsed.w01d7.length > 0);
  assert.deepEqual(parsed.w01d1, []);
  assert.throws(() =>
    parseReviewWeek(
      weekOne,
      ids.map((id) => id.replace("01", "02")),
      valid,
    ),
  );
  assert.throws(() => parseReviewWeek(weekOne.slice(0, 6), ids, valid));
  const damaged = weekOne.map((lesson, index) =>
    index === 6
      ? { ...lesson, reviewVocabulary: ["unrecognized-word"] }
      : lesson,
  );
  assert.throws(() => parseReviewWeek(damaged, ids, valid));
});
