import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import legacy from "../lib/dialogue-practice-legacy.data.json";
import { dialogueSectionKey } from "../lib/dialogue-section-key";
import { createPostCourseLesson } from "./post-course-lessons";
import type { ImmersionLesson, ImmersionSection } from "../lib/immersion-types";
import { postCourseLessons } from "../lib/dialogue-catalog";

const readWeek = (week: number) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../public/immersion/week-${String(week).padStart(2, "0")}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as ImmersionLesson[];
const lessons = [
  ...new Set([
    ...Array.from({ length: 26 }, (_, index) => index + 1),
    ...postCourseLessons.map((lesson) => lesson.week),
  ]),
].flatMap(readWeek);
const tagFor = (lesson: ImmersionLesson, section: ImmersionSection) =>
  lesson.week > 26
    ? "结课后"
    : section.review
      ? section.label.split(" · ")[0]
      : "新内容";
const keyFor = (lesson: ImmersionLesson, section: ImmersionSection) =>
  dialogueSectionKey(
    lesson.id,
    section.source.id,
    section.lines[0].id,
    tagFor(lesson, section),
  );

test("section key generation preserves all 3564 frozen v12 display aliases", () => {
  let checked = 0;
  for (const [identity, aliases] of legacy.scenes as [string, string[]][]) {
    const [sourceId, lineId] = identity.split(":");
    for (const alias of aliases) {
      const [lessonId, key] = alias.split(":");
      const tag = key.slice(0, key.indexOf(`-${sourceId}-`));
      assert.equal(dialogueSectionKey(lessonId, sourceId, lineId, tag), key);
      const section = lessons
        .find((lesson) => lesson.id === lessonId)
        ?.sections.find((section) => section.key === key);
      assert(section, alias);
      assert.equal(section.source.id, sourceId, alias);
      assert.equal(section.lines[0].id, lineId, alias);
      checked++;
    }
  }
  assert.equal(checked, 3564);
});

test("all published C/D/E original and review keys use stable line identity", () => {
  let originals = 0;
  let reviews = 0;
  for (const lesson of lessons)
    for (const section of lesson.sections)
      if (/gap-expansion-[cde]-/.test(section.lines[0].id)) {
        assert.equal(section.key, keyFor(lesson, section));
        assert.equal(
          section.key,
          `${tagFor(lesson, section)}-${section.source.id}-${section.lines[0].id}`,
        );
        if (section.review) reviews++;
        else originals++;
      }
  assert.equal(originals, 60);
  assert(reviews > 0);
});

test("prepending future F/G pools and earlier review groups does not move C/D/E keys", () => {
  for (const lesson of lessons) {
    const current = lesson.sections.filter((section) =>
      /gap-expansion-[cde]-/.test(section.lines[0].id),
    );
    if (!current.length) continue;
    const expected = new Map(
      current.map((section) => [section.lines[0].id, keyFor(lesson, section)]),
    );
    const future = ["f", "g"].map((batch) => ({
      ...current[0],
      lines: [
        {
          ...current[0].lines[0],
          id: `${current[0].source.id}-gap-expansion-${batch}-1-1`,
        },
      ],
    }));
    for (const reordered of [
      [...future, ...lesson.sections],
      [...lesson.sections.toReversed(), ...future],
    ]) {
      const actual = new Map(
        reordered.map((section) => [
          section.lines[0].id,
          keyFor(lesson, section),
        ]),
      );
      for (const [lineId, key] of expected)
        assert.equal(actual.get(lineId), key, `${lesson.id}:${lineId}`);
    }
  }
});

test("authored w27d6 C/D/E keys survive insertion of additional post-course pools", () => {
  const lesson = lessons.find((lesson) => lesson.id === "w27d6");
  assert(lesson, "The actual published extension day must be tested.");
  const original = createPostCourseLesson(lesson.id, lesson.sections);
  const future = ["f", "g"].map((batch) => ({
    ...lesson.sections[0],
    lines: [
      {
        ...lesson.sections[0].lines[0],
        id: `w27d6-gap-expansion-${batch}-1-1`,
      },
    ],
  }));
  const reordered = createPostCourseLesson(lesson.id, [
    ...future,
    ...lesson.sections.toReversed(),
  ]);
  for (const section of original.sections) {
    const matching = reordered.sections.find(
      (item) => item.lines[0].id === section.lines[0].id,
    );
    assert(matching);
    assert.equal(matching.key, section.key);
    assert.equal(section.key, `结课后-w27d6-${section.lines[0].id}`);
  }
});
