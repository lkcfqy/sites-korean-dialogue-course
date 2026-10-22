import { MEMORY_KEY, parseMemory } from "./learning-memory";
import { STUDY_KEY, parseStudy, type StudyRecord } from "./study-records";
import { isCount, isRecord, isTimestamp } from "./study-validation";
import {
  DIALOGUE_POSITION_KEY,
  DIALOGUE_SETTINGS_KEY,
  parseDialoguePosition,
  parseDialogueSettings,
} from "./dialogue-study";
import {
  DIALOGUE_MEMORY_KEY,
  mergeDialogueMemory,
  parseDialogueMemoryStrict,
  serializeDialogueMemory,
} from "./dialogue-memory";
import {
  getDialogueMemoryRepository,
  type DialogueMemoryRepository,
} from "./dialogue-memory-storage";
import {
  DIALOGUE_PLAN_KEY,
  mergeDialoguePlan,
  parseDialoguePlan,
} from "./dialogue-plan";

type StorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
export type Backup = {
  format: "korean-course-backup";
  version: 1;
  createdAt: number;
  data: Record<string, string>;
};
export const MAX_BACKUP_BYTES = 32_000_000;
// Structured progress may exceed the former 2 MB value limit before one course ends.
// The full UTF-8 backup remains strictly capped at MAX_BACKUP_BYTES.
export const MAX_STRUCTURED_STUDY_CHARACTERS = MAX_BACKUP_BYTES;
const speeds = [0.7, 0.85, 1, 1.15, 1.3];
const repetitions = [1, 2, 3, 5, 10];
const newLimits = [10, 20, 25, 30, 35, 40, 60];
import { isPublishedDialogueLesson } from "./dialogue-catalog";
const fixed = new Set([
  MEMORY_KEY,
  STUDY_KEY,
  "korean-dialogue-lesson-v2",
  "korean-dialogue-speed",
  "korean-dialogue-repeat",
  "korean-dialogue-display-v1",
  DIALOGUE_POSITION_KEY,
  DIALOGUE_SETTINGS_KEY,
  DIALOGUE_MEMORY_KEY,
  DIALOGUE_PLAN_KEY,
  "korean-vocabulary-settings-v2",
  "korean-vocabulary-settings",
  "korean-vocabulary-new-limit",
  "korean-mock-record-v1",
]);

export function backupKey(key: string) {
  return (
    fixed.has(key) ||
    /^korean-writing-w(?:[1-9]|1\d|2[0-6])(?:-data)?(?:-versions|-review)?$/.test(
      key,
    ) ||
    /^korean-word-sentence-[가-힣 ]{1,50}$/.test(key) ||
    /^korean-vocabulary-cursor-[\w-]{1,80}$/.test(key)
  );
}

export function exportStudy(storage: StorageLike, now = Date.now()): Backup {
  const data: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && backupKey(key)) {
      const value = storage.getItem(key);
      if (value !== null)
        data[key] =
          key === DIALOGUE_MEMORY_KEY
            ? serializeDialogueMemory(parseDialogueMemoryStrict(value))
            : value;
    }
  }
  const backup: Backup = {
    format: "korean-course-backup",
    version: 1,
    createdAt: now,
    data,
  };
  validateBackup(backup);
  if (
    new TextEncoder().encode(JSON.stringify(backup)).byteLength >
    MAX_BACKUP_BYTES
  )
    throw new Error("备份超过 32 MB，请先减少历史版本。");
  return backup;
}

function assertValid(
  valid: boolean,
  message = "备份包含格式不正确的数据。",
): asserts valid {
  if (!valid) throw new Error(message);
}

function optional(
  value: Record<string, unknown>,
  key: string,
  validate: (x: unknown) => boolean,
) {
  return value[key] === undefined || validate(value[key]);
}

function shortText(value: unknown, max = 20000): value is string {
  return typeof value === "string" && value.length <= max;
}

function stringList(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((x) => shortText(x, 20000))
  );
}

function validateValue(key: string, value: string) {
  if (key === MEMORY_KEY) {
    const original: unknown = JSON.parse(value);
    assertValid(
      isRecord(original) &&
        Object.keys(parseMemory(value)).length === Object.keys(original).length,
      "词汇进度格式不正确。",
    );
  } else if (key === STUDY_KEY) {
    const original: unknown = JSON.parse(value);
    const parsed = parseStudy(value);
    assertValid(
      isRecord(original) &&
        Array.isArray(original.attempts) &&
        original.attempts.length <= 400 &&
        parsed.attempts.length === original.attempts.length &&
        (original.mistakes === undefined || isRecord(original.mistakes)) &&
        (original.writing === undefined || isRecord(original.writing)) &&
        Object.keys(parsed.mistakes).length ===
          Object.keys(original.mistakes || {}).length &&
        Object.keys(parsed.writing).length ===
          Object.keys(original.writing || {}).length,
      "练习记录格式不正确。",
    );
  } else if (key === "korean-dialogue-lesson-v2") {
    assertValid(isPublishedDialogueLesson(value));
  } else if (key === "korean-dialogue-speed") {
    assertValid(speeds.map(String).includes(value));
  } else if (key === "korean-dialogue-repeat") {
    assertValid([...repetitions.map(String), "∞"].includes(value));
  } else if (key === "korean-dialogue-display-v1") {
    assertValid(["both", "ko", "audio", "zh"].includes(value));
  } else if (key === "korean-vocabulary-new-limit") {
    assertValid(newLimits.map(String).includes(value));
  } else if (key.startsWith("korean-vocabulary-cursor-")) {
    assertValid(/^[가-힣 ]{1,50}$/.test(value));
  } else if (key === DIALOGUE_POSITION_KEY) {
    assertValid(parseDialoguePosition(value) !== null);
  } else if (key === DIALOGUE_SETTINGS_KEY) {
    assertValid(parseDialogueSettings(value) !== null);
  } else if (key === DIALOGUE_MEMORY_KEY) {
    parseDialogueMemoryStrict(value);
  } else if (key === DIALOGUE_PLAN_KEY) {
    assertValid(parseDialoguePlan(value) !== null, "对话学习计划格式不正确。");
  } else if (key.includes("vocabulary-settings")) {
    const s: unknown = JSON.parse(value);
    assertValid(
      isRecord(s) &&
        optional(s, "speed", (x) => speeds.includes(x as number)) &&
        optional(s, "repeat", (x) => repetitions.includes(x as number)) &&
        optional(s, "view", (x) => ["cards", "list"].includes(x as string)) &&
        optional(s, "direction", (x) =>
          ["ko", "zh", "audio"].includes(x as string),
        ),
    );
  } else if (key.endsWith("-versions")) {
    const versions: unknown = JSON.parse(value);
    assertValid(
      Array.isArray(versions) &&
        versions.length <= 5 &&
        versions.every(
          (v) =>
            isRecord(v) &&
            shortText(v.text) &&
            isTimestamp(v.at) &&
            optional(
              v,
              "feedback",
              (items) =>
                Array.isArray(items) &&
                items.every(
                  (f) =>
                    isRecord(f) &&
                    shortText(f.id, 120) &&
                    ["fix", "review"].includes(f.kind as string) &&
                    shortText(f.excerpt) &&
                    shortText(f.suggestion) &&
                    shortText(f.why),
                ),
            ),
        ),
    );
  } else if (key.endsWith("-review")) {
    const r: unknown = JSON.parse(value);
    assertValid(
      isRecord(r) &&
        optional(r, "at", isTimestamp) &&
        optional(r, "notes", (x) => shortText(x, 5000)) &&
        optional(r, "checks", stringList) &&
        optional(
          r,
          "review",
          (x) =>
            isRecord(x) &&
            ["content", "structure", "language"].every((field) =>
              shortText(x[field], 100),
            ) &&
            typeof x.teacher === "boolean",
        ),
    );
  } else if (key === "korean-mock-record-v1") {
    const records: unknown = JSON.parse(value);
    assertValid(
      Array.isArray(records) &&
        records.length <= 20 &&
        records.every(
          (r) =>
            isRecord(r) &&
            shortText(r.id, 120) &&
            shortText(r.title, 100) &&
            [r.listening, r.reading, r.writing].every(
              (x) => isCount(x) && x <= 100,
            ) &&
            typeof r.teacher === "boolean" &&
            isTimestamp(r.at),
        ),
    );
  }
}

function validateBackup(value: unknown): asserts value is Backup {
  assertValid(
    isRecord(value) &&
      value.format === "korean-course-backup" &&
      value.version === 1 &&
      isTimestamp(value.createdAt) &&
      isRecord(value.data) &&
      Object.keys(value.data).length <= 12000,
    "不是可识别的课程备份。",
  );
  for (const [key, item] of Object.entries(value.data)) {
    assertValid(
      backupKey(key) &&
        typeof item === "string" &&
        item.length <=
          ([DIALOGUE_MEMORY_KEY, DIALOGUE_PLAN_KEY].includes(key)
            ? MAX_STRUCTURED_STUDY_CHARACTERS
            : 2_000_000),
      "备份包含不支持的数据。",
    );
    validateValue(key, item);
  }
  assertValid(
    new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      MAX_BACKUP_BYTES,
    "备份超过 32 MB，请确认文件来源。",
  );
}

export function parseBackup(raw: string): Backup {
  if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES)
    throw new Error("备份超过 32 MB，请确认文件来源。");
  const value: unknown = JSON.parse(raw);
  validateBackup(value);
  return value;
}

function mergeStudy(current: StudyRecord, incoming: StudyRecord): StudyRecord {
  const attempts = [
    ...new Map(
      [...current.attempts, ...incoming.attempts].map((a) => [
        `${a.id}:${a.at}`,
        a,
      ]),
    ).values(),
  ]
    .sort((a, b) => a.at - b.at)
    .slice(-400);
  const mistakes = { ...current.mistakes };
  for (const [id, m] of Object.entries(incoming.mistakes)) {
    const old = Object.hasOwn(mistakes, id) ? mistakes[id] : undefined;
    const updated = (x: typeof m) =>
      x.updatedAt ?? x.due - (x.corrected > 1 ? 7 : 1) * 86400000;
    if (!old || updated(m) > updated(old)) mistakes[id] = m;
  }
  const writing = { ...current.writing };
  for (const [id, w] of Object.entries(incoming.writing)) {
    if (!Object.hasOwn(writing, id) || w.at > writing[id].at) writing[id] = w;
  }
  return { attempts, mistakes, writing };
}

export function importStudy(storage: StorageLike, backup: Backup) {
  // Validate again at the write boundary, even when called without parseBackup.
  validateBackup(backup);
  const writes: Record<string, string> = {};
  let preserved = 0;
  for (const [key, value] of Object.entries(backup.data)) {
    const old = storage.getItem(key);
    if (key === MEMORY_KEY) {
      const merged = parseMemory(old);
      for (const [ko, m] of Object.entries(parseMemory(value))) {
        if (!merged[ko] || m.reviewed > merged[ko].reviewed) merged[ko] = m;
      }
      writes[key] = JSON.stringify(merged);
    } else if (key === DIALOGUE_MEMORY_KEY) {
      writes[key] = serializeDialogueMemory(
        mergeDialogueMemory(
          parseDialogueMemoryStrict(old),
          parseDialogueMemoryStrict(value),
        ),
      );
    } else if (key === DIALOGUE_PLAN_KEY) {
      const incoming = parseDialoguePlan(value);
      const current = parseDialoguePlan(old);
      assertValid(
        incoming !== null && (old === null || current !== null),
        "现有对话学习计划损坏，无法安全合并。",
      );
      writes[key] = JSON.stringify(
        current ? mergeDialoguePlan(current, incoming!) : incoming,
      );
    } else if (key === STUDY_KEY) {
      writes[key] = JSON.stringify(
        mergeStudy(parseStudy(old), parseStudy(value)),
      );
    } else if (old === null || old === "") {
      writes[key] = value;
    } else {
      preserved++;
    }
  }
  const previous = Object.fromEntries(
    Object.keys(writes).map((key) => [key, storage.getItem(key)]),
  );
  try {
    for (const [key, value] of Object.entries(writes))
      storage.setItem(key, value);
  } catch (error) {
    for (const [key, value] of Object.entries(previous)) {
      try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch {
        /* Report storage failure to caller. */
      }
    }
    throw error;
  }
  return { restored: Object.keys(writes).length, preserved };
}

/** Browser backups include IndexedDB sentence evidence as well as the legacy course keys. */
export async function exportBrowserStudy(
  storage: StorageLike = localStorage,
  now = Date.now(),
  repository: DialogueMemoryRepository = getDialogueMemoryRepository(),
): Promise<Backup> {
  const memory = await repository.load();
  const backup = exportStudy(storage, now);
  backup.data[DIALOGUE_MEMORY_KEY] = serializeDialogueMemory(memory);
  // Validate the final combined file, not just its localStorage part.
  parseBackup(JSON.stringify(backup));
  return backup;
}

export async function importBrowserStudy(
  storage: StorageLike,
  backup: Backup,
  repository: DialogueMemoryRepository = getDialogueMemoryRepository(),
) {
  validateBackup(backup);
  const incomingRaw = backup.data[DIALOGUE_MEMORY_KEY];
  const incoming =
    incomingRaw === undefined
      ? undefined
      : parseDialogueMemoryStrict(incomingRaw);
  // Finish/read-check migration before changing either storage system.
  if (incoming) await repository.load();
  const localData = { ...backup.data };
  delete localData[DIALOGUE_MEMORY_KEY];
  const previous = Object.fromEntries(
    Object.keys(localData).map((key) => [key, storage.getItem(key)]),
  );
  const result = importStudy(storage, { ...backup, data: localData });
  let applied: Record<string, string | null> | undefined;
  try {
    applied = Object.fromEntries(
      Object.keys(localData).map((key) => [key, storage.getItem(key)]),
    );
    if (incoming) await repository.merge(incoming);
  } catch (error) {
    let rollbackFailed = false;
    for (const [key, value] of Object.entries(previous)) {
      try {
        // Another tab may save during the database transaction. Keep its later write.
        if (applied && storage.getItem(key) !== applied[key]) continue;
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed)
      throw new Error(
        "句子导入失败，部分浏览器设置无法复原，请保留备份后重试。",
      );
    throw error;
  }
  return {
    restored: result.restored + (incoming ? 1 : 0),
    preserved: result.preserved,
  };
}
