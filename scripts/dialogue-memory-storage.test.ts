import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  DIALOGUE_MEMORY_KEY,
  dialogueLineKey,
  rateDialogueSentence,
  serializeDialogueMemory,
  parseDialogueMemoryStrict,
  loadDialogueMemory,
  saveDialogueExposure,
  type DialogueMemory,
  type DialogueSource,
} from "../lib/dialogue-memory";
import { createDialogueMemoryRepository } from "../lib/dialogue-memory-storage";
import {
  exportBrowserStudy,
  importBrowserStudy,
  parseBackup,
  MAX_BACKUP_BYTES,
} from "../lib/study-backup";
import { MEMORY_KEY } from "../lib/learning-memory";

const source: DialogueSource = {
  lessonId: "w02d1",
  sectionKey: null,
  lineId: "sentence-1",
};
const key = dialogueLineKey(source),
  at = 1_000_000_000;
const feedback = {
  grade: "produced",
  draft: "저는 학교에 가요.",
  revealed: false,
} as const;
class FakeStorage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
const makeRecord = (ref = source, now = at) =>
  rateDialogueSentence(undefined, ref, feedback, now);

test("legacy migration commits all evidence before deleting the old copy and keeps newer database records", async (t) => {
  const storage = new FakeStorage(),
    repository = createDialogueMemoryRepository({
      indexedDB: new IDBFactory(),
      storage,
    });
  t.after(() => repository.close());
  const old = makeRecord(),
    newer = rateDialogueSentence(
      old,
      source,
      { ...feedback, draft: "本机未提交 글" },
      old.due!,
    );
  await repository.merge({ [key]: newer });
  const other = { ...source, lineId: "legacy-only" };
  storage.setItem(
    DIALOGUE_MEMORY_KEY,
    JSON.stringify({ [key]: old, [dialogueLineKey(other)]: makeRecord(other) }),
  );
  const migrated = await repository.load();
  assert.equal(storage.getItem(DIALOGUE_MEMORY_KEY), null);
  assert.equal(migrated[key].due, newer.due);
  assert.equal(migrated[key].draft, newer.draft);
  assert.deepEqual(migrated[dialogueLineKey(other)], makeRecord(other));
  assert.deepEqual(await repository.loadSentence(source), migrated[key]);
  assert.equal(
    await repository.loadSentence({ ...source, lineId: "missing" }),
    undefined,
  );
});

test("a failed migration transaction leaves every legacy byte intact and rolls back already applied puts", async (t) => {
  const storage = new FakeStorage(),
    repository = createDialogueMemoryRepository({
      indexedDB: new IDBFactory(),
      storage,
    });
  t.after(() => repository.close());
  const other = { ...source, lineId: "second" };
  const original = JSON.stringify({
    [key]: makeRecord(),
    [dialogueLineKey(other)]: makeRecord(other),
  });
  storage.setItem(DIALOGUE_MEMORY_KEY, original);
  const nativePut = IDBObjectStore.prototype.put;
  const mocked = t.mock.method(
    IDBObjectStore.prototype,
    "put",
    function (this: IDBObjectStore, value: unknown, objectKey?: IDBValidKey) {
      const request = nativePut.call(this, value, objectKey);
      if ((value as { key: string }).key === dialogueLineKey(other))
        request.onsuccess = () => this.transaction.abort();
      return request;
    },
  );
  await assert.rejects(repository.load());
  assert.equal(storage.getItem(DIALOGUE_MEMORY_KEY), original);
  mocked.mock.restore();
  storage.removeItem(DIALOGUE_MEMORY_KEY);
  assert.deepEqual(await repository.load(), {});
  storage.setItem(DIALOGUE_MEMORY_KEY, original);
  assert.equal(Object.keys(await repository.load()).length, 2);
  assert.equal(storage.getItem(DIALOGUE_MEMORY_KEY), null);
});

test("damaged legacy progress blocks migration and cannot be mistaken for an empty record", async (t) => {
  const storage = new FakeStorage(),
    repository = createDialogueMemoryRepository({
      indexedDB: new IDBFactory(),
      storage,
    });
  t.after(() => repository.close());
  const corrupt = JSON.stringify({ [key]: { due: "tomorrow" } });
  storage.setItem(DIALOGUE_MEMORY_KEY, corrupt);
  await assert.rejects(repository.load(), /无法安全覆盖/);
  await assert.rejects(repository.update(source, at, () => makeRecord()));
  assert.equal(storage.getItem(DIALOGUE_MEMORY_KEY), corrupt);
  storage.removeItem(DIALOGUE_MEMORY_KEY);
  assert.deepEqual(await repository.load(), {});
});

test("migration never deletes a legacy write made by another tab after the snapshot", async (t) => {
  const storage = new FakeStorage();
  const first = JSON.stringify({ [key]: makeRecord() });
  const next = serializeDialogueMemory({
    [key]: rateDialogueSentence(
      makeRecord(),
      source,
      feedback,
      makeRecord().due!,
    ),
  });
  storage.setItem(DIALOGUE_MEMORY_KEY, first);
  let reads = 0;
  const actualGet = storage.getItem.bind(storage);
  storage.getItem = (item) => {
    if (item === DIALOGUE_MEMORY_KEY && ++reads === 2)
      storage.setItem(item, next);
    return actualGet(item);
  };
  const repository = createDialogueMemoryRepository({
    indexedDB: new IDBFactory(),
    storage,
  });
  t.after(() => repository.close());
  await repository.load();
  assert.equal(storage.getItem(DIALOGUE_MEMORY_KEY), next);
  const migratedAgain = await repository.load();
  assert.equal(migratedAgain[key].delayedRecalls, 1);
  assert.equal(storage.getItem(DIALOGUE_MEMORY_KEY), null);
});

test("rapid autosaves and separate connections serialize by sentence and preserve unrelated keys", async (t) => {
  const factory = new IDBFactory(),
    storage = new FakeStorage();
  const first = createDialogueMemoryRepository({ indexedDB: factory, storage });
  const second = createDialogueMemoryRepository({
    indexedDB: factory,
    storage,
  });
  t.after(async () => {
    await first.close();
    await second.close();
  });
  await Promise.all([first.load(), second.load()]);
  const initial = makeRecord();
  await first.merge({ [key]: initial });
  await Promise.all([
    first.update(source, at + 1, (previous) => ({
      ...previous!,
      draft: "첫 글",
      draftAt: at + 1,
      updatedAt: at + 1,
    })),
    second.update(source, at + 2, (previous) => ({
      ...previous!,
      draft: "두 번째 글",
      draftAt: at + 2,
      updatedAt: at + 2,
    })),
    first.update(source, at + 3, (previous) => ({
      ...previous!,
      draft: "최신 글",
      draftAt: at + 3,
      updatedAt: at + 3,
    })),
  ]);
  assert.equal((await second.loadSentence(source))!.draft, "최신 글");
  await assert.rejects(
    second.update(source, at + 2, (previous) => ({
      ...previous!,
      draft: "older",
      updatedAt: at + 2,
    })),
  );
  const other = { ...source, lineId: "other" };
  await first.update(other, at, () => makeRecord(other));
  assert.equal(Object.keys(await first.load()).length, 2);
});

test("an aborted save preserves the previous draft and sends no successful update notification", async (t) => {
  const storage = new FakeStorage();
  let notifications = 0;
  const repository = createDialogueMemoryRepository({
    indexedDB: new IDBFactory(),
    storage,
    onUpdated: () => {
      notifications++;
    },
  });
  t.after(() => repository.close());
  const initial = makeRecord();
  await repository.merge({ [key]: initial });
  const nativePut = IDBObjectStore.prototype.put;
  const mocked = t.mock.method(
    IDBObjectStore.prototype,
    "put",
    function (this: IDBObjectStore, value: unknown, objectKey?: IDBValidKey) {
      const request = nativePut.call(this, value, objectKey);
      request.onsuccess = () => this.transaction.abort();
      return request;
    },
  );
  await assert.rejects(
    repository.update(source, at + 1, (previous) => ({
      ...previous!,
      draft: "new 글",
      draftAt: at + 1,
      updatedAt: at + 1,
    })),
  );
  mocked.mock.restore();
  assert.deepEqual(await repository.loadSentence(source), initial);
  assert.equal(notifications, 1);
});

test("browser backups include database records after migration and restore old or compact files without localStorage growth", async (t) => {
  const storage = new FakeStorage(),
    destStorage = new FakeStorage();
  const sourceRepository = createDialogueMemoryRepository({
    indexedDB: new IDBFactory(),
    storage,
  });
  const destRepository = createDialogueMemoryRepository({
    indexedDB: new IDBFactory(),
    storage: destStorage,
  });
  t.after(async () => {
    await sourceRepository.close();
    await destRepository.close();
  });
  const record = makeRecord();
  storage.setItem(DIALOGUE_MEMORY_KEY, JSON.stringify({ [key]: record }));
  storage.setItem("korean-dialogue-speed", "0.85");
  const backup = parseBackup(
    JSON.stringify(await exportBrowserStudy(storage, at, sourceRepository)),
  );
  assert.equal(storage.getItem(DIALOGUE_MEMORY_KEY), null);
  assert.deepEqual(
    parseDialogueMemoryStrict(backup.data[DIALOGUE_MEMORY_KEY]),
    { [key]: record },
  );
  destStorage.setItem("korean-dialogue-speed", "1");
  await importBrowserStudy(destStorage, backup, destRepository);
  assert.deepEqual(await destRepository.load(), { [key]: record });
  assert.equal(destStorage.getItem(DIALOGUE_MEMORY_KEY), null);
  assert.equal(destStorage.getItem("korean-dialogue-speed"), "1");
  const legacyBackup = {
    ...backup,
    data: { [DIALOGUE_MEMORY_KEY]: JSON.stringify({ [key]: record }) },
  };
  await importBrowserStudy(destStorage, legacyBackup, destRepository);
  assert.deepEqual(await destRepository.load(), { [key]: record });
});

test("a database import abort restores both applied database rows and previous local course records", async (t) => {
  const storage = new FakeStorage(),
    repository = createDialogueMemoryRepository({
      indexedDB: new IDBFactory(),
      storage,
    });
  t.after(() => repository.close());
  const original: DialogueMemory = { [key]: makeRecord() };
  await repository.merge(original);
  storage.setItem(MEMORY_KEY, "{}");
  const other = { ...source, lineId: "imported" };
  const backup = parseBackup(
    JSON.stringify({
      format: "korean-course-backup",
      version: 1,
      createdAt: at,
      data: {
        [DIALOGUE_MEMORY_KEY]: serializeDialogueMemory({
          [key]: rateDialogueSentence(
            original[key],
            source,
            feedback,
            original[key].due!,
          ),
          [dialogueLineKey(other)]: makeRecord(other),
        }),
        [MEMORY_KEY]: JSON.stringify({
          학교: { streak: 1, due: at + 86400000, reviewed: at, lapses: 0 },
        }),
        "korean-writing-w1": "새 글",
      },
    }),
  );
  const nativePut = IDBObjectStore.prototype.put;
  const mocked = t.mock.method(
    IDBObjectStore.prototype,
    "put",
    function (this: IDBObjectStore, value: unknown, objectKey?: IDBValidKey) {
      const request = nativePut.call(this, value, objectKey);
      if ((value as { key: string }).key === dialogueLineKey(other))
        request.onsuccess = () => this.transaction.abort();
      return request;
    },
  );
  await assert.rejects(importBrowserStudy(storage, backup, repository));
  mocked.mock.restore();
  assert.deepEqual(await repository.load(), original);
  assert.equal(storage.getItem(MEMORY_KEY), "{}");
  assert.equal(storage.getItem("korean-writing-w1"), null);
});

test("a failed database import never rolls back a newer local write made during its transaction", async (t) => {
  const storage = new FakeStorage(),
    repository = createDialogueMemoryRepository({
      indexedDB: new IDBFactory(),
      storage,
    });
  t.after(() => repository.close());
  storage.setItem("korean-writing-w1", "");
  const backup = parseBackup(
    JSON.stringify({
      format: "korean-course-backup",
      version: 1,
      createdAt: at,
      data: {
        [DIALOGUE_MEMORY_KEY]: serializeDialogueMemory({ [key]: makeRecord() }),
        "korean-writing-w1": "imported 글",
        "korean-writing-w2": "temporary 글",
      },
    }),
  );
  const nativePut = IDBObjectStore.prototype.put;
  const mocked = t.mock.method(
    IDBObjectStore.prototype,
    "put",
    function (this: IDBObjectStore, value: unknown, objectKey?: IDBValidKey) {
      const request = nativePut.call(this, value, objectKey);
      request.onsuccess = () => {
        storage.setItem("korean-writing-w1", "other tab 최신 글");
        this.transaction.abort();
      };
      return request;
    },
  );
  await assert.rejects(importBrowserStudy(storage, backup, repository));
  mocked.mock.restore();
  assert.equal(storage.getItem("korean-writing-w1"), "other tab 최신 글");
  assert.equal(storage.getItem("korean-writing-w2"), null);
  assert.deepEqual(await repository.load(), {});
});

test("browser import enforces the total file size at the write boundary even without parseBackup", async (t) => {
  const storage = new FakeStorage(),
    repository = createDialogueMemoryRepository({
      indexedDB: new IDBFactory(),
      storage,
    });
  t.after(() => repository.close());
  const text = "x".repeat(1_300_000);
  const data = Object.fromEntries(
    Array.from({ length: 26 }, (_, index) => [
      `korean-writing-w${index + 1}`,
      text,
    ]),
  );
  await assert.rejects(
    importBrowserStudy(
      storage,
      { format: "korean-course-backup", version: 1, createdAt: at, data },
      repository,
    ),
    /32 MB/,
  );
  assert.equal(storage.length, 0);
});

type PublishedScene = {
  review: boolean;
  source: { id: string };
  lines: { id: string; ko: string }[];
};
function courseSentences() {
  const sentences = new Map<string, { source: DialogueSource; ko: string }>();
  for (let week = 1; week <= 26; week++) {
    const path = new URL(
      `../public/immersion/week-${String(week).padStart(2, "0")}.json`,
      import.meta.url,
    );
    const lessons = JSON.parse(readFileSync(path, "utf8")) as {
      sections: PublishedScene[];
    }[];
    for (const lesson of lessons)
      for (const scene of lesson.sections)
        if (!scene.review)
          for (const line of scene.lines) {
            const source: DialogueSource = {
              lessonId: scene.source.id,
              sectionKey: null,
              lineId: line.id,
            };
            sentences.set(dialogueLineKey(source), { source, ko: line.ko });
          }
  }
  // Include source additions even while the compiler agent is rebuilding published files.
  const expansion = JSON.parse(
    readFileSync(
      new URL("../data/immersion/coverage-expansion.json", import.meta.url),
      "utf8",
    ),
  ) as { lessonId: string; lines: { ko: string }[] }[];
  expansion.forEach((scene, index) =>
    scene.lines.forEach((line, lineIndex) => {
      const source: DialogueSource = {
        lessonId: scene.lessonId,
        sectionKey: null,
        lineId: `${scene.lessonId}-coverage-expansion-${index + 1}-${lineIndex + 1}`,
      };
      sentences.set(dialogueLineKey(source), { source, ko: line.ko });
    }),
  );
  return sentences;
}

test("the complete 26-week course with eight real-sized recall drafts fits a compact backup and round-trips through IndexedDB", async (t) => {
  const sentences = courseSentences(),
    DAY = 86400000;
  assert(sentences.size >= 7286);
  const measurements: {
    feedback: number;
    legacyCharacters: number;
    compactCharacters: number;
    compactBytes: number;
  }[] = [];
  let complete: DialogueMemory = {};
  for (const count of [1, 4, 8]) {
    const memory: DialogueMemory = {};
    let index = 0;
    for (const [key, { source, ko }] of sentences) {
      const storage = new FakeStorage(),
        now = Date.UTC(2026, 9, 8) + index++ * 1000;
      saveDialogueExposure(source, now - DAY, storage);
      let record = rateDialogueSentence(
        loadDialogueMemory(storage)[key],
        source,
        { grade: "produced", draft: ko, revealed: false },
        now,
      );
      record = {
        ...record,
        exposures: record.exposures + 1,
        lastExposedAt: now + 1,
        updatedAt: now + 1,
      };
      for (let attempt = 1; attempt < count; attempt++) {
        // Due reviews happen 37 minutes later with different milliseconds; the eighth is early practice.
        const time =
          count === 8 && attempt === 7
            ? now + 160 * DAY
            : record.due! + 2220000 + attempt * 137;
        const draft = attempt % 3 === 1 ? ko.slice(0, -1) + "요?" : ko;
        record = rateDialogueSentence(
          record,
          source,
          { grade: "produced", draft, revealed: false },
          time,
        );
        record = {
          ...record,
          exposures: record.exposures + 1,
          lastExposedAt: time + 1,
          updatedAt: time + 1,
        };
      }
      memory[key] = record;
    }
    const legacy = JSON.stringify(memory),
      compact = serializeDialogueMemory(memory);
    assert.deepEqual(parseDialogueMemoryStrict(compact), memory);
    assert.deepEqual(parseDialogueMemoryStrict(legacy), memory);
    if (count === 1) assert(Buffer.byteLength(legacy) > 5 * 1024 * 1024);
    measurements.push({
      feedback: count,
      legacyCharacters: legacy.length,
      compactCharacters: compact.length,
      compactBytes: Buffer.byteLength(compact),
    });
    complete = memory;
  }
  const storage = new FakeStorage(),
    destStorage = new FakeStorage();
  const sourceRepository = createDialogueMemoryRepository({
    indexedDB: new IDBFactory(),
    storage,
  });
  const destination = createDialogueMemoryRepository({
    indexedDB: new IDBFactory(),
    storage: destStorage,
  });
  t.after(async () => {
    await sourceRepository.close();
    await destination.close();
  });
  await sourceRepository.merge(complete);
  const backup = await exportBrowserStudy(storage, at, sourceRepository);
  const raw = JSON.stringify(backup);
  assert(Buffer.byteLength(raw) < MAX_BACKUP_BYTES);
  await importBrowserStudy(destStorage, parseBackup(raw), destination);
  assert.deepEqual(await destination.load(), complete);
  assert.equal(destStorage.getItem(DIALOGUE_MEMORY_KEY), null);
  // Old object-format backups above the former 8 M character limit remain importable.
  const legacyBackup = parseBackup(
    JSON.stringify({
      ...backup,
      data: { [DIALOGUE_MEMORY_KEY]: JSON.stringify(complete) },
    }),
  );
  await importBrowserStudy(destStorage, legacyBackup, destination);
  assert.deepEqual(await destination.load(), complete);
  t.diagnostic(
    JSON.stringify({
      sentences: sentences.size,
      measurements,
      backupBytes: Buffer.byteLength(raw),
    }),
  );
});
