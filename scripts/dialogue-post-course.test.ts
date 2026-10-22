import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import legacy from "../lib/dialogue-practice-legacy.data.json";
import main from "../data/immersion-client-index.json";
import contexts from "../data/immersion-post-course-context.json";
import {
  courseDay,
  isPublishedDialogueLesson,
  mergeDialogueContexts,
  parsePublishedDialogueWeek,
  postCourseLessons,
} from "../lib/dialogue-catalog";
import { legacyDialogueSectionKey } from "../lib/dialogue-practice-keys";
import { createPostCourseLesson } from "./post-course-lessons";
import { dialoguePracticeTasks } from "../data/dialogue-practice";
import type { ImmersionLesson, ImmersionSection } from "../lib/immersion-types";
import type { Line } from "../data/course";
import {
  DIALOGUE_POSITION_KEY,
  parseDialoguePosition,
  saveDialoguePosition,
} from "../lib/dialogue-study";
import {
  dialogueLineKey,
  loadDialogueMemory,
  saveDialogueDraft,
  saveDialogueExposure,
  saveDialogueFeedback,
} from "../lib/dialogue-memory";
import { exportStudy, importStudy } from "../lib/study-backup";

const week = (n: number) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../public/immersion/week-${String(n).padStart(2, "0")}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as ImmersionLesson[];
const fixtureLine: Line = {
  id: "w27d6-fixture-1",
  speaker: "A",
  ko: "이 물건을 여기에 둬요.",
  zh: "把这个物品放在这里。",
  words: [
    {
      text: "이",
      meaning: "",
      lemmas: [],
      annotation: {
        status: "unlinked",
        method: "machine-rule",
        confidence: "uncertain",
      },
    },
    {
      text: "물건을",
      base: "물건",
      meaning: "物品",
      lemmas: ["물건"],
      annotation: {
        status: "linked",
        method: "machine-rule",
        confidence: "machine-supported",
      },
    },
    {
      text: "여기에",
      meaning: "",
      lemmas: [],
      annotation: {
        status: "unlinked",
        method: "machine-rule",
        confidence: "uncertain",
      },
    },
    {
      text: "둬요.",
      meaning: "",
      lemmas: [],
      annotation: {
        status: "unlinked",
        method: "machine-rule",
        confidence: "uncertain",
      },
    },
  ],
};

class Storage {
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

test("post-course compiler emits one actual day with original identities and no vocabulary rescheduling", () => {
  const lesson = createPostCourseLesson("w27d6", [
    {
      label: "归还物品",
      scene: "两名同学归还借用物品。",
      kind: "dialogue",
      lines: [fixtureLine],
    },
  ]);
  assert.equal(courseDay(lesson), 188);
  assert.equal(courseDay(lesson) - courseDay({ week: 26, day: 6 }), 7);
  assert.deepEqual(lesson.vocabulary, ["물건"]);
  assert.equal(lesson.sections[0].lines[0].id, fixtureLine.id);
  assert.equal(lesson.sections[0].source.id, "w27d6");
  assert.equal(lesson.sections[0].review, false);
  assert.equal(lesson.newLines, 1);
  assert.equal(lesson.reviewLines, 0);
  assert.deepEqual(lesson.reviewVocabulary, []);
  assert.throws(() =>
    createPostCourseLesson("w27d7", [
      { label: "不应发布", scene: "x", lines: [fixtureLine] },
    ]),
  );
  assert.throws(() => createPostCourseLesson("w27d6", []));
  assert.throws(() =>
    createPostCourseLesson("w26d6", [
      { label: "主课", scene: "x", lines: [fixtureLine] },
    ]),
  );
  assert.throws(() =>
    createPostCourseLesson("w27d6", [
      {
        label: "复制旧ID",
        scene: "x",
        lines: [{ ...fixtureLine, id: "w26d6-old-1" }],
      },
    ]),
  );
  assert.equal(main.length, 182);
  assert.equal(main.flatMap((item) => item.vocabulary).length, 4980);
  const tasks = dialoguePracticeTasks(lesson, lesson.sections[0]);
  assert(tasks.length > 0 && tasks.every((task) => task.source === "current"));
});

test("sparse-week loading checks the actual catalog and rejects unregistered extra days", () => {
  const lesson = createPostCourseLesson("w27d6", [
    { label: "复现", scene: "x", lines: [fixtureLine] },
  ]);
  assert.equal(isPublishedDialogueLesson("w26d7", []), true);
  assert.equal(isPublishedDialogueLesson("w27d6", [lesson]), true);
  for (const id of ["w27d1", "w27d7", "w28d6", "w00d1"])
    assert.equal(isPublishedDialogueLesson(id, [lesson]), false);
  assert.deepEqual(parsePublishedDialogueWeek([lesson], [lesson]), [lesson]);
  assert.throws(() => parsePublishedDialogueWeek([], [lesson]));
  assert.throws(() =>
    parsePublishedDialogueWeek(
      [lesson, { ...lesson, id: "w27d1", day: 1 }],
      [lesson],
    ),
  );
  assert.throws(() =>
    parsePublishedDialogueWeek([{ ...lesson, day: 5 }], [lesson]),
  );
  assert.throws(() =>
    parsePublishedDialogueWeek([{ ...lesson, sections: [] }], [lesson]),
  );
});

test("position writes reject unpublished IDs before changing either stored position key", () => {
  const storage = new Storage();
  const original = {
    version: 1 as const,
    lessonId: "w01d1",
    sectionKey: null,
    lineId: null,
  };
  assert.equal(saveDialoguePosition(storage, original), true);
  const before = [...storage.data];
  for (const id of ["w27d1", "w27d7", "w28d1"])
    if (!postCourseLessons.some((item) => item.id === id)) {
      assert.equal(
        saveDialoguePosition(storage, { ...original, lessonId: id }),
        false,
      );
      assert.deepEqual([...storage.data], before);
    }
});

test("extension contexts remain visible when all six main-course example slots are occupied", () => {
  const primary = Array.from({ length: 6 }, (_, i) => ({
    ko: `旧${i}`,
    lessonId: "w01d1",
  }));
  const extras = [
    { ko: "新1", lessonId: "w27d6" },
    { ko: "旧0", lessonId: "w27d6" },
    { ko: "新2", lessonId: "w27d6" },
    { ko: "新3", lessonId: "w27d6" },
  ];
  const merged = mergeDialogueContexts(primary, extras);
  assert.deepEqual(merged.slice(0, 6), primary);
  assert.deepEqual(merged.slice(6), [extras[0], extras[2]]);
});

test("all frozen v12 display keys still resolve to their exact original scene after appending material", () => {
  const published = new Map(
    Array.from({ length: 26 }, (_, i) => week(i + 1))
      .flat()
      .map((lesson) => [lesson.id, lesson]),
  );
  let checked = 0;
  for (const [identity, aliases] of legacy.scenes as [string, string[]][]) {
    const [sourceId, lineId] = identity.split(":");
    for (const alias of aliases) {
      const [displayId, key] = alias.split(":");
      const tag = key.slice(0, key.indexOf(`-${sourceId}-`));
      assert.equal(
        legacyDialogueSectionKey(displayId, sourceId, lineId, tag),
        key,
      );
      const section = published
        .get(displayId)
        ?.sections.find((section) => section.key === key);
      assert(section, `Missing saved display key: ${alias}`);
      assert.equal(section.source.id, sourceId, alias);
      assert.equal(section.lines[0].id, lineId, alias);
      checked++;
    }
  }
  assert.equal(checked, 3564);
});

test("published extension catalog contains only real original days and links", () => {
  const lessons = [
    ...new Set(postCourseLessons.map((lesson) => lesson.week)),
  ].flatMap(week);
  assert.equal(lessons.length, postCourseLessons.length);
  for (const meta of postCourseLessons) {
    const lesson = lessons.find((item) => item.id === meta.id)!;
    assert(lesson && lesson.day !== 7 && lesson.week > 26);
    assert(
      lesson.sections.every(
        (section) => !section.review && section.source.id === lesson.id,
      ),
    );
    assert.equal(
      lesson.newLines,
      lesson.sections.reduce((n, section) => n + section.lines.length, 0),
    );
    assert.equal(lesson.reviewLines, 0);
  }
  for (const [headword, examples] of Object.entries(
    contexts as Record<
      string,
      { lessonId: string; lineId: string; ko: string }[]
    >,
  )) {
    assert(examples.length <= 2);
    for (const example of examples) {
      const line = lessons
        .find((item) => item.id === example.lessonId)
        ?.sections.flatMap((section) => section.lines)
        .find((line) => line.id === example.lineId);
      assert(line && line.ko === example.ko);
      assert(
        line.words.some(
          (word) =>
            word.annotation?.status === "linked" &&
            word.lemmas?.includes(headword),
        ),
      );
    }
  }
  // Unpublished dates always fail even after a sparse extension is available.
  for (const id of ["w27d7", "w28d1"])
    if (!postCourseLessons.some((item) => item.id === id)) {
      assert.equal(isPublishedDialogueLesson(id), false);
      assert.equal(
        parseDialoguePosition(
          JSON.stringify({
            version: 1,
            lessonId: id,
            sectionKey: null,
            lineId: null,
          }),
        ),
        null,
      );
    }
});

test(
  "actual published extension position, exposure, draft, feedback and backup round-trip",
  {
    skip:
      postCourseLessons.length === 0
        ? "Extension content has not been generated yet"
        : false,
  },
  () => {
    const meta = postCourseLessons[0];
    const lesson = week(meta.week).find((item) => item.id === meta.id)!;
    const section: ImmersionSection = lesson.sections[0];
    const line = section.lines[0];
    const source = {
      lessonId: lesson.id,
      sectionKey: section.key,
      lineId: line.id,
    };
    const storage = new Storage();
    const position = { version: 1 as const, ...source };
    assert.equal(saveDialoguePosition(storage, position), true);
    assert.deepEqual(
      parseDialoguePosition(storage.getItem(DIALOGUE_POSITION_KEY)),
      position,
    );
    assert.equal(saveDialogueExposure(source, 1000, storage).saved, true);
    assert.equal(
      saveDialogueDraft(
        source,
        { draft: "제 답을 적어요.", revealed: false },
        1001,
        storage,
      ).saved,
      true,
    );
    assert.equal(
      saveDialogueFeedback(
        source,
        { grade: "produced", draft: "제 답을 적어요.", revealed: false },
        1002,
        storage,
      ).saved,
      true,
    );
    const target = new Storage();
    importStudy(target, exportStudy(storage, 1003));
    assert.deepEqual(
      parseDialoguePosition(target.getItem(DIALOGUE_POSITION_KEY)),
      position,
    );
    assert.deepEqual(
      loadDialogueMemory(target)[dialogueLineKey(source)],
      loadDialogueMemory(storage)[dialogueLineKey(source)],
    );
  },
);
