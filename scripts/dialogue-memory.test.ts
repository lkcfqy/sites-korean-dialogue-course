import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIALOGUE_MEMORY_KEY,
  dialogueLineKey,
  dialogueMemorySummary,
  dialogueReviewHref,
  dueDialogueSentences,
  loadDialogueMemory,
  mergeDialogueMemory,
  parseDialogueMemory,
  parseDialogueMemoryStrict,
  rateDialogueSentence,
  saveDialogueDraft,
  saveDialogueExposure,
  saveDialogueFeedback,
  serializeDialogueMemory,
  type DialogueSource,
} from "../lib/dialogue-memory";
import { MAX_TIMESTAMP } from "../lib/study-validation";

const source: DialogueSource = {
  lessonId: "w02d1",
  sectionKey: null,
  lineId: "w02d1-3",
};
const key = dialogueLineKey(source);
const start = 1_000_000_000;
const DAY = 86_400_000;
const produced = {
  grade: "produced",
  draft: "저는 학교에 가요.",
  revealed: false,
} as const;
class FakeStorage {
  data = new Map<string, string>();
  readFails = false;
  writeFails = false;
  writes = 0;
  getItem(key: string) {
    if (this.readFails) throw new Error("blocked");
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writes++;
    if (this.writeFails) throw new Error("quota");
    this.data.set(key, value);
  }
}

test("review sections share the original sentence's identity and deep link", () => {
  assert.equal(dialogueLineKey({ ...source, sectionKey: "隔日-w02d1-3" }), key);
  assert.equal(
    dialogueLineKey({ ...source, sectionKey: "新内容-w02d1-0" }),
    key,
  );
  assert.notEqual(dialogueLineKey({ ...source, lessonId: "w03d1" }), key);
  assert.equal(
    dialogueReviewHref(source),
    "/?lesson=w02d1&line=w02d1-3&recall=1",
  );
  assert.throws(() => dialogueLineKey({ ...source, lessonId: "w27d1" }));
});

test("exposure and writing a draft persist without pretending to be recall or assigning reviews", () => {
  const storage = new FakeStorage();
  const exposure = saveDialogueExposure(source, start, storage);
  assert.equal(exposure.saved, true);
  saveDialogueDraft(
    source,
    { draft: "저는 학생이에요.", revealed: false },
    start + 1,
    storage,
  );
  const memory = loadDialogueMemory(storage);
  assert.equal(memory[key].exposures, 1);
  assert.equal(memory[key].draft, "저는 학생이에요.");
  assert.equal(memory[key].due, null);
  assert.equal(memory[key].grade, null);
  assert.equal(memory[key].independentRecalls, 0);
  assert.deepEqual(dialogueMemorySummary(memory, start), {
    exposed: 1,
    rated: 0,
    due: 0,
    independent: 0,
    currentIndependent: 0,
    delayed: 0,
    repeat: 0,
  });
});

test("self-assessed production, revealed answers and independent Korean drafts are distinct evidence", () => {
  for (const feedback of [
    { ...produced, draft: "" },
    { ...produced, draft: "only Chinese translation" },
    { ...produced, revealed: true },
    { ...produced, grade: "understood" as const },
  ]) {
    const next = rateDialogueSentence(undefined, source, feedback, start);
    assert.equal(next.independentRecalls, 0);
    assert.equal(next.delayedRecalls, 0);
    assert.equal(next.streak, 0);
    assert.equal(next.due, start + DAY);
    assert.equal(next.attempts[0].independent, false);
  }
  const independent = rateDialogueSentence(undefined, source, produced, start);
  assert.equal(independent.independentRecalls, 1);
  assert.equal(independent.delayedRecalls, 0);
  assert.equal(independent.attempts[0].delayed, false);
  assert.equal(independent.streak, 1);
});

test("latest feedback independence can decline without erasing historical independent evidence", () => {
  const initial = rateDialogueSentence(undefined, source, produced, start);
  const initialSummary = dialogueMemorySummary({ [key]: initial }, start);
  assert.equal(initialSummary.independent, 1);
  assert.equal(initialSummary.currentIndependent, 1);
  const latest = rateDialogueSentence(
    initial,
    source,
    { ...produced, grade: "understood" },
    start + 1,
  );
  const summary = dialogueMemorySummary({ [key]: latest }, start + 1);
  assert.equal(summary.independent, 1);
  assert.equal(summary.currentIndependent, 0);
  const aided = rateDialogueSentence(
    latest,
    source,
    { ...produced, revealed: true },
    start + 2,
  );
  assert.equal(
    dialogueMemorySummary({ [key]: aided }, start + 2).currentIndependent,
    0,
  );
});

test("only due-date delayed independent recall grows the interval; early practice retains its anchor", () => {
  const initial = rateDialogueSentence(undefined, source, produced, start);
  const early = rateDialogueSentence(
    initial,
    source,
    produced,
    start + DAY - 1,
  );
  assert.equal(early.due, initial.due);
  assert.equal(early.reviewedAt, initial.reviewedAt);
  assert.equal(early.streak, 1);
  assert.equal(early.delayedRecalls, 0);
  const delayed = rateDialogueSentence(early, source, produced, initial.due!);
  assert.equal(delayed.streak, 2);
  assert.equal(delayed.due, initial.due! + 3 * DAY);
  assert.equal(delayed.delayedRecalls, 1);
  assert.equal(delayed.attempts.at(-1)?.delayed, true);
});

test("hearing or seeing the original just before a due review prevents delayed evidence", () => {
  const storage = new FakeStorage();
  saveDialogueFeedback(source, produced, start, storage);
  saveDialogueExposure(source, start + DAY - 60_000, storage);
  const result = saveDialogueFeedback(source, produced, start + DAY, storage);
  assert.equal(result.saved, true);
  if (!result.saved) return;
  assert.equal(result.next.independentRecalls, 2);
  assert.equal(result.next.delayedRecalls, 0);
  assert.equal(result.next.streak, 1);
  assert.equal(result.next.due, start + 2 * DAY);
});

test("forgetting brings a sentence back promptly; immediate correction is not delayed recall", () => {
  const initial = rateDialogueSentence(undefined, source, produced, start);
  const forgotten = rateDialogueSentence(
    initial,
    source,
    { ...produced, grade: "again" },
    start + 1,
  );
  assert.equal(forgotten.due, start + 1 + 600_000);
  assert.equal(forgotten.streak, 0);
  assert.equal(forgotten.lapses, 1);
  const corrected = rateDialogueSentence(
    forgotten,
    source,
    produced,
    forgotten.due!,
  );
  assert.equal(corrected.delayedRecalls, 0);
  assert.equal(corrected.due, forgotten.due! + DAY);
  assert.equal(corrected.lapses, 1);
});

test("review queues exclude exposures and future reviews, order overdue sentences, and expose backlog", () => {
  const storage = new FakeStorage();
  saveDialogueExposure({ ...source, lineId: "exposed-only" }, start, storage);
  const older = rateDialogueSentence(
    undefined,
    source,
    { ...produced, grade: "again" },
    start,
  );
  const newerSource = { ...source, lineId: "newer" };
  const newer = rateDialogueSentence(undefined, newerSource, produced, start);
  const memory = {
    ...loadDialogueMemory(storage),
    [key]: older,
    [dialogueLineKey(newerSource)]: newer,
  };
  const early = dueDialogueSentences(memory, start + 600_000, 1);
  assert.equal(early.total, 1);
  assert.equal(early.items[0].lineId, source.lineId);
  const queue = dueDialogueSentences(memory, start + DAY, 1);
  assert.equal(queue.total, 2);
  assert.equal(queue.remaining, 1);
  assert.equal(Object.keys(memory).length, 3);
  assert.equal(queue.items[0].key, key);
});

test("read/write failures and corrupt existing records preserve all prior bytes and report failure", () => {
  const storage = new FakeStorage();
  const original = JSON.stringify({
    [key]: rateDialogueSentence(undefined, source, produced, start),
  });
  storage.data.set(DIALOGUE_MEMORY_KEY, original);
  storage.readFails = true;
  assert.deepEqual(saveDialogueFeedback(source, produced, start + 1, storage), {
    saved: false,
  });
  assert.equal(storage.writes, 0);
  storage.readFails = false;
  storage.writeFails = true;
  assert.deepEqual(saveDialogueExposure(source, start + 1, storage), {
    saved: false,
  });
  assert.equal(storage.getItem(DIALOGUE_MEMORY_KEY), original);
  storage.writeFails = false;
  const corrupt = JSON.stringify({
    ...JSON.parse(original),
    invalid: { due: "tomorrow" },
  });
  storage.data.set(DIALOGUE_MEMORY_KEY, corrupt);
  assert.deepEqual(
    saveDialogueDraft(
      source,
      { draft: "글", revealed: false },
      start + 1,
      storage,
    ),
    { saved: false },
  );
  assert.equal(storage.getItem(DIALOGUE_MEMORY_KEY), corrupt);
  assert.deepEqual(parseDialogueMemory(corrupt), JSON.parse(original));
});

test("same-tab updates fire only after successful storage and notification failure does not falsify persistence", (t) => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() =>
    before
      ? Object.defineProperty(globalThis, "window", before)
      : Reflect.deleteProperty(globalThis, "window"),
  );
  const storage = new FakeStorage();
  let events = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent(event: Event) {
        assert.equal(event.type, "korean-study-updated");
        events++;
      },
    },
  });
  storage.writeFails = true;
  assert.equal(saveDialogueExposure(source, start, storage).saved, false);
  assert.equal(events, 0);
  storage.writeFails = false;
  assert.equal(saveDialogueExposure(source, start, storage).saved, true);
  assert.equal(events, 1);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent() {
        throw new Error("notification blocked");
      },
    },
  });
  assert.equal(saveDialogueExposure(source, start + 1, storage).saved, true);
  assert.equal(loadDialogueMemory(storage)[key].exposures, 2);
});

test("malformed identities, timestamps and fabricated recall evidence cannot enter memory", () => {
  const valid = rateDialogueSentence(undefined, source, produced, start);
  for (const patch of [
    { due: 1e99 },
    { due: -1 },
    { exposures: 0.5 },
    { streak: 8 },
    { streak: 7 },
    { lessonId: "w27d1" },
    { revealed: "no" },
    { attempts: [{ ...valid.attempts[0], delayed: true }] },
    { attempts: [{ ...valid.attempts[0], independent: false }] },
    { feedback: { again: 0, understood: 1, produced: 0 } },
    { reviewedAt: valid.feedbackAt! + 1 },
  ])
    assert.throws(() =>
      parseDialogueMemoryStrict(
        JSON.stringify({ [key]: { ...valid, ...patch } }),
      ),
    );
  assert.throws(() =>
    rateDialogueSentence(undefined, source, produced, MAX_TIMESTAMP),
  );
  assert.throws(() => rateDialogueSentence(valid, source, produced, start - 1));
  assert.throws(() => parseDialogueMemoryStrict("[]"));
  assert.throws(() =>
    parseDialogueMemoryStrict(JSON.stringify({ "wrong-key": valid })),
  );
});

test("backup merging keeps local drafts, exposures and other sentences while selecting the latest actual schedule", () => {
  const first = rateDialogueSentence(undefined, source, produced, start);
  const current = {
    ...first,
    draft: "未提交的韩语草稿 글",
    draftAt: start + 2 * DAY,
    updatedAt: start + 2 * DAY,
    exposures: 2,
    lastExposedAt: start + 2 * DAY,
  };
  const delayed = rateDialogueSentence(first, source, produced, start + DAY);
  const otherSource = { ...source, lineId: "local-only" };
  const other = rateDialogueSentence(undefined, otherSource, produced, start);
  const merged = mergeDialogueMemory(
    { [key]: current, [dialogueLineKey(otherSource)]: other },
    { [key]: delayed },
  );
  assert.equal(merged[key].draft, current.draft);
  assert.equal(merged[key].due, delayed.due);
  assert.equal(merged[key].delayedRecalls, 1);
  assert.equal(merged[key].exposures, 2);
  assert.equal(merged[key].attempts.length, 2);
  assert.deepEqual(merged[dialogueLineKey(otherSource)], other);
  assert.deepEqual(parseDialogueMemoryStrict(JSON.stringify(merged)), merged);
  assert.deepEqual(mergeDialogueMemory(merged, { [key]: delayed }), merged);
});

test("long-running recall keeps a bounded evidence window and preserves lifetime counters", () => {
  let record = rateDialogueSentence(undefined, source, produced, start);
  for (let count = 0; count < 24; count++)
    record = rateDialogueSentence(record, source, produced, record.due!);
  assert.equal(record.independentRecalls, 25);
  assert.equal(record.delayedRecalls, 24);
  assert.equal(record.attempts.length, 20);
  assert.equal(record.streak, 7);
  assert.deepEqual(
    parseDialogueMemoryStrict(JSON.stringify({ [key]: record })),
    { [key]: record },
  );
});

test("compact serialization preserves differing drafts, revelation flags and all exact recall evidence", () => {
  const first = rateDialogueSentence(undefined, source, produced, start);
  const again = rateDialogueSentence(
    first,
    source,
    { grade: "again", draft: "저는 학교에 갔어요.", revealed: true },
    start + 137,
  );
  const second = rateDialogueSentence(
    again,
    source,
    { ...produced, draft: "저는 회사에 가요." },
    again.due! + 113,
  );
  const memory = {
    [key]: {
      ...second,
      draft: "아직 완성 안 한 새 답안",
      draftAt: second.updatedAt + 1,
      updatedAt: second.updatedAt + 1,
    },
  };
  const encoded = serializeDialogueMemory(memory);
  assert.deepEqual(parseDialogueMemoryStrict(encoded), memory);
  assert.deepEqual(parseDialogueMemory(encoded), memory);
  assert.deepEqual(parseDialogueMemoryStrict(JSON.stringify(memory)), memory);
  assert(encoded.length < JSON.stringify(memory).length);
  const corrupted = JSON.parse(encoded);
  corrupted.records[key][17][0][0] = 1000;
  assert.throws(() => parseDialogueMemoryStrict(JSON.stringify(corrupted)));
  assert.deepEqual(parseDialogueMemory(JSON.stringify(corrupted)), {});
  const dangerousDifference = JSON.parse(encoded);
  dangerousDifference.records[key][3].push([5000, 5000, "글"]);
  assert.throws(() =>
    parseDialogueMemoryStrict(JSON.stringify(dangerousDifference)),
  );
});
