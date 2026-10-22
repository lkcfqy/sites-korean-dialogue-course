import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ImmersionLesson } from "../lib/immersion-types";
import { dialoguePracticeTasks } from "../data/dialogue-practice";
import { createPracticeDraftGuard } from "../lib/dialogue-practice-guard";
import {
  dialoguePracticeKey,
  hasPracticeHistory,
  legacyPracticeDrafts,
} from "../lib/dialogue-practice-keys";
import {
  DIALOGUE_PLAN_KEY,
  MAX_PRACTICE_DRAFTS,
  defaultDialoguePlan,
  loadDialoguePlan,
  mergeDialoguePlan,
  parseDialoguePlan,
  readDialoguePlan,
  saveDialoguePracticeDraft,
} from "../lib/dialogue-plan";

test("strict practice reads distinguish unavailable/corrupt storage from an empty first visit without erasing visible evidence", () => {
  const key = "current:w01d1:w01d1-1:current-reply";
  const plan = {
    ...defaultDialoguePlan(),
    drafts: {
      [key]: {
        text: "지금 답이에요.",
        updatedAt: 5,
        referenceSeenAt: 4,
        firstAttempt: { text: "처음 답이에요.", submittedAt: 3 },
      },
    },
  };
  const stored = JSON.stringify(plan);
  let readFails = false;
  let raw: string | null = stored;
  const controlled = {
    getItem() {
      if (readFails) throw new Error("blocked");
      return raw;
    },
  };
  let visible = readDialoguePlan(controlled);
  assert(visible.loaded);
  const original = visible;
  readFails = true;
  const failed = readDialoguePlan(controlled);
  assert.deepEqual(failed, { loaded: false });
  if (failed.loaded) visible = failed;
  assert.deepEqual(visible, original);
  readFails = false;
  raw = "{bad JSON";
  const corrupt = readDialoguePlan(controlled);
  assert.deepEqual(corrupt, { loaded: false });
  if (corrupt.loaded) visible = corrupt;
  assert.deepEqual(visible, original);
  raw = stored;
  assert.deepEqual(readDialoguePlan(controlled), original);
  raw = null;
  const firstVisit = readDialoguePlan(controlled);
  assert(firstVisit.loaded);
  assert.deepEqual(firstVisit.plan.drafts, {});
});

const lessons = Array.from(
  { length: 26 },
  (_, i) =>
    JSON.parse(
      readFileSync(
        new URL(
          `../public/immersion/week-${String(i + 1).padStart(2, "0")}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    ) as ImmersionLesson[],
).flat();
const first = lessons[0],
  scene = first.sections[0];
const legacy = JSON.parse(
  readFileSync(
    new URL("../lib/dialogue-practice-legacy.data.json", import.meta.url),
    "utf8",
  ),
) as {
  originalLines: number;
  scenes: [string, string[], string[]][];
};
const task = dialoguePracticeTasks(first, scene)[0];
const key = dialoguePracticeKey(scene, task);
const aliases = legacy.scenes
  .find(([id]) => id === `${scene.source.id}:${scene.lines[0].id}`)![1]
  .map((alias) => `${alias}:${task.id}`);

function storage(initial = defaultDialoguePlan()) {
  const data = new Map([[DIALOGUE_PLAN_KEY, JSON.stringify(initial)]]);
  let fail = false;
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (fail)
        throw new DOMException(
          "controlled quota failure",
          "QuotaExceededError",
        );
      data.set(key, value);
    },
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

test("the frozen 4354 historical keys correspond to 852 canonical tasks; future scenes also deduplicate by identity", () => {
  const historical = new Set<string>(),
    canonical = new Set<string>();
  for (const [id, aliases, ids] of legacy.scenes)
    for (const task of ids) {
      canonical.add(`current:${id}:${task}`);
      for (const alias of aliases) historical.add(`${alias}:${task}`);
    }
  for (let week = 1; week <= 26; week++) {
    const transfer = `weekly:transfer-w${String(week).padStart(2, "0")}`;
    historical.add(transfer);
    canonical.add(transfer);
    if (week >= 19) {
      historical.add(`weekly:data-w${week}`);
      canonical.add(`weekly:data-w${week}`);
    }
  }
  assert.equal(legacy.originalLines, 8269);
  assert.equal(historical.size, 4354);
  assert.equal(canonical.size, 852);
  const keys = new Set<string>();
  for (const lesson of lessons)
    for (const section of lesson.sections)
      for (const task of dialoguePracticeTasks(lesson, section)) {
        keys.add(dialoguePracticeKey(section, task));
      }
  assert.ok(keys.size >= 852);
  for (const oldKey of canonical) assert.ok(keys.has(oldKey));
  assert.ok(aliases.length > 2);
});

test("all 4354 historical task keys migrate without a 1000-record ceiling or altered answers", () => {
  const drafts: ReturnType<typeof defaultDialoguePlan>["drafts"] = {};
  for (const [, aliases, ids] of legacy.scenes)
    for (const alias of aliases)
      for (const id of ids)
        drafts[`${alias}:${id}`] = {
          text: "저는 예전 답을 썼어요.",
          updatedAt: 10,
        };
  for (let week = 1; week <= 26; week++) {
    drafts[`weekly:transfer-w${String(week).padStart(2, "0")}`] = {
      text: "예전 답이에요.",
      updatedAt: 10,
    };
    if (week >= 19)
      drafts[`weekly:data-w${week}`] = {
        text: "예전 답이에요.",
        updatedAt: 10,
      };
  }
  const parsed = parseDialoguePlan(
    JSON.stringify({ ...defaultDialoguePlan(), drafts }),
  )!;
  assert.ok(parsed);
  for (const [oldKey, draft] of Object.entries(drafts))
    assert.deepEqual(parsed.drafts[oldKey], draft);
  assert.equal(Object.keys(parsed.drafts).length, 5172);
  const dest = storage(parsed);
  assert.equal(
    saveDialoguePracticeDraft(key, "수정한 답이에요.", undefined, dest, 11)
      .saved,
    true,
  );
  assert.equal(loadDialoguePlan(dest).drafts[key].text, "수정한 답이에요.");
  assert.equal(
    parseDialoguePlan(
      JSON.stringify({
        ...defaultDialoguePlan(),
        drafts: Object.fromEntries(
          Array.from({ length: MAX_PRACTICE_DRAFTS + 1 }, (_, i) => [
            `extra-${i}`,
            { text: "", updatedAt: 1 },
          ]),
        ),
      }),
    ),
    null,
  );
});

test("migration keeps conflicting old texts and first attempts while unioning reference and practice evidence", () => {
  const a = {
    text: "첫 번째 답이에요.",
    updatedAt: 20,
    firstAttempt: { text: "처음 쓴 답이에요.", submittedAt: 18 },
  };
  const b = {
    text: "다른 날의 답이에요.",
    updatedAt: 30,
    referenceSeenAt: 25,
    practiceStartedAt: 21,
    firstAttempt: { text: "다른 초안이에요.", submittedAt: 22 },
  };
  const parsed = parseDialoguePlan(
    JSON.stringify({
      ...defaultDialoguePlan(),
      drafts: { [aliases[0]]: a, [aliases[1]]: b },
    }),
  )!;
  assert.deepEqual(parsed.drafts[aliases[0]], a);
  assert.deepEqual(parsed.drafts[aliases[1]], b);
  assert.equal(parsed.drafts[key].text, b.text);
  assert.equal(parsed.drafts[key].referenceSeenAt, 25);
  assert.equal(parsed.drafts[key].practiceStartedAt, 18);
  assert.equal(legacyPracticeDrafts(parsed, key).length, 2);
  const dest = storage(parsed);
  assert.equal(
    saveDialoguePracticeDraft(key, "", undefined, dest, 40).saved,
    true,
  );
  const cleared = loadDialoguePlan(dest);
  assert.equal(
    cleared.drafts[key].text,
    "",
    "kept old answers must not refill an intentionally cleared editor",
  );
  assert.equal(hasPracticeHistory(cleared.drafts[key]), true);
  assert.equal(
    saveDialoguePracticeDraft(key, "완성했어요.", "independent", dest, 41)
      .saved,
    false,
  );
  assert.equal(
    saveDialoguePracticeDraft(key, a.text, undefined, dest, 42).saved,
    true,
  );
  assert.equal(
    loadDialoguePlan(dest).drafts[key].firstAttempt?.text,
    b.firstAttempt.text,
  );
  assert.deepEqual(loadDialoguePlan(dest).drafts[aliases[0]], a);
});

test("a legacy draft without assessment still preserves practiced status after migration, clearing and backup", () => {
  const parsed = parseDialoguePlan(
    JSON.stringify({
      ...defaultDialoguePlan(),
      drafts: { [aliases[0]]: { text: "제 답이에요.", updatedAt: 10 } },
    }),
  )!;
  const dest = storage(parsed);
  saveDialoguePracticeDraft(key, "", undefined, dest, 11);
  const backup = mergeDialoguePlan(
    defaultDialoguePlan(),
    loadDialoguePlan(dest),
  );
  assert.equal(backup.drafts[key].text, "");
  assert.equal(backup.drafts[key].practiceStartedAt, 10);
  assert.equal(
    saveDialoguePracticeDraft(
      key,
      "새 답이에요.",
      "independent",
      storage(backup),
      12,
    ).saved,
    false,
  );
});

test("same-key backup conflicts preserve local text and a recoverable incoming answer including its first draft", () => {
  const current = parseDialoguePlan(
    JSON.stringify({
      ...defaultDialoguePlan(),
      drafts: {
        [key]: {
          text: "현재 답이에요.",
          updatedAt: 20,
          firstAttempt: { text: "현재 초안이에요.", submittedAt: 10 },
        },
      },
    }),
  )!;
  const incoming = parseDialoguePlan(
    JSON.stringify({
      ...defaultDialoguePlan(),
      drafts: {
        [key]: {
          text: "가져온 답이에요.",
          updatedAt: 30,
          firstAttempt: { text: "가져온 초안이에요.", submittedAt: 15 },
          referenceSeenAt: 25,
        },
      },
    }),
  )!;
  const merged = parseDialoguePlan(
    JSON.stringify(mergeDialoguePlan(current, incoming)),
  )!;
  assert.equal(merged.drafts[key].text, "현재 답이에요.");
  assert.equal(merged.drafts[key].firstAttempt?.text, "현재 초안이에요.");
  assert.equal(merged.drafts[key].referenceSeenAt, 25);
  const copies = legacyPracticeDrafts(merged, key);
  assert.equal(copies.length, 1);
  assert.equal(copies[0].draft.text, "가져온 답이에요.");
  assert.equal(copies[0].draft.firstAttempt?.text, "가져온 초안이에요.");
  assert.equal(
    Object.keys(mergeDialoguePlan(merged, incoming).drafts).length,
    Object.keys(merged.drafts).length,
  );
});

test("controlled Storage failure blocks task, transfer, import, scene and unload changes until actual recovery", () => {
  const dest = storage(),
    guard = createPracticeDraftGuard();
  dest.fail(true);
  const failed = guard.track(
    saveDialoguePracticeDraft(
      key,
      "아직 저장 못 한 답이에요.",
      undefined,
      dest,
      10,
    ),
  );
  assert.equal(failed.saved, false);
  for (const change of ["task", "transfer", "import", "scene", "unload"]) {
    let replaced = false;
    if (guard.canLeave()) replaced = true;
    assert.equal(replaced, false, change);
  }
  assert.equal(loadDialoguePlan(dest).drafts[key], undefined);
  dest.fail(false);
  assert.equal(
    guard.track(
      saveDialoguePracticeDraft(
        key,
        "아직 저장 못 한 답이에요.",
        undefined,
        dest,
        11,
      ),
    ).saved,
    true,
  );
  assert.equal(guard.canLeave(), true);
  assert.equal(
    loadDialoguePlan(dest).drafts[key].text,
    "아직 저장 못 한 답이에요.",
  );
  assert.equal(
    saveDialoguePracticeDraft(key, "처음 완성했어요.", "independent", dest, 12)
      .saved,
    true,
    "a fresh canonical draft is still eligible for its first submission",
  );
});

test("oversized combined backups reject the merge before the existing destination can be overwritten", () => {
  const records = (prefix: string) =>
    Object.fromEntries(
      Array.from({ length: MAX_PRACTICE_DRAFTS / 2 + 1 }, (_, i) => [
        `${prefix}-${i}`,
        { text: "既有草稿", updatedAt: 10 },
      ]),
    );
  const current = { ...defaultDialoguePlan(), drafts: records("local") };
  const incoming = { ...defaultDialoguePlan(), drafts: records("incoming") };
  const destination = storage(current);
  const before = destination.getItem(DIALOGUE_PLAN_KEY);
  assert.throws(() => {
    const merged = mergeDialoguePlan(current, incoming);
    destination.setItem(DIALOGUE_PLAN_KEY, JSON.stringify(merged));
  }, RangeError);
  assert.equal(destination.getItem(DIALOGUE_PLAN_KEY), before);
});
