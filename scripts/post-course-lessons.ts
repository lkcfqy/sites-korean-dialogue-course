import type { Line } from "../data/course";
import type { ImmersionLesson, ImmersionSection } from "../lib/immersion-types";
import { isPostCourseLessonId } from "../lib/dialogue-catalog";
import { dialogueSectionKey } from "../lib/dialogue-section-key";

type PostCoursePool = Pick<
  ImmersionSection,
  "scene" | "kind" | "lines" | "contextNote"
> & { label: string };

/** Only authored extension days are emitted; empty days are never fabricated. */
export function createPostCourseLesson(
  id: string,
  pools: readonly PostCoursePool[],
): ImmersionLesson {
  if (
    !isPostCourseLessonId(id) ||
    !pools.length ||
    pools.some((pool) => !pool.lines.length)
  )
    throw new Error(`Invalid authored post-course day: ${id}`);
  const week = Number(id.slice(1, 3));
  const day = Number(id.at(-1));
  const title = "结课后间隔复现";
  const sections: ImmersionSection[] = pools.map((pool) => ({
    ...pool,
    key: dialogueSectionKey(id, id, pool.lines[0].id, "结课后"),
    review: false,
    source: { id, week, day, title },
  }));
  const lines = sections.flatMap((section) => section.lines);
  if (
    new Set(lines.map((line) => line.id)).size !== lines.length ||
    lines.some(
      (line) =>
        !line.id.startsWith(`${id}-`) ||
        line.words.map((word) => word.text).join(" ") !== line.ko,
    )
  )
    throw new Error(
      `Invalid post-course original line identity or tokens: ${id}`,
    );
  if (new Set(sections.map((section) => section.key)).size !== sections.length)
    throw new Error(`Duplicate post-course scene: ${id}`);
  const linked = (line: Line) =>
    line.words.flatMap((word) =>
      word.annotation?.status === "linked" ? (word.lemmas ?? []) : [],
    );
  const vocabulary = [
    ...new Set(sections.flatMap((section) => section.lines.flatMap(linked))),
  ];
  return {
    id,
    week,
    day,
    title,
    scene:
      "在新的场景和交流目的中使用已排程词汇；这些是结课后的新材料，主课仍为 26 周。",
    kind: "new",
    vocabulary,
    sceneVocabulary: vocabulary,
    reviewVocabulary: [],
    newLines: sections.reduce((sum, section) => sum + section.lines.length, 0),
    reviewLines: 0,
    sections,
  };
}
