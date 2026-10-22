import publishedPostCourse from "../data/immersion-post-course-index.json";
import type {
  ImmersionClientMetadata,
  ImmersionLesson,
} from "./immersion-types";

/** The 26-week main course stays fixed; extension IDs come from publication. */
export const postCourseLessons =
  publishedPostCourse as ImmersionClientMetadata[];
const mainLessonPattern = /^w(0[1-9]|1\d|2[0-6])d[1-7]$/;
const extensionPattern = /^w(2[7-9]|[3-9]\d)d[1-6]$/;

export function isPostCourseLessonId(id: string) {
  return extensionPattern.test(id);
}

export function isPublishedDialogueLesson(
  id: string,
  postCourse: readonly Pick<
    ImmersionClientMetadata,
    "id"
  >[] = postCourseLessons,
) {
  return (
    mainLessonPattern.test(id) ||
    (isPostCourseLessonId(id) && postCourse.some((lesson) => lesson.id === id))
  );
}

export function courseDay(lesson: { week: number; day: number }) {
  return (lesson.week - 1) * 7 + lesson.day;
}

/** Main-course examples remain available; extension examples get separate slots. */
export function mergeDialogueContexts<T extends { ko: string }>(
  main: readonly T[],
  postCourse: readonly T[],
) {
  const seen = new Set(main.map((example) => example.ko));
  return [
    ...main.slice(0, 6),
    ...postCourse
      .filter((example) => {
        if (seen.has(example.ko)) return false;
        seen.add(example.ko);
        return true;
      })
      .slice(0, 2),
  ];
}

/** Validate against the actual catalog, including sparse extension weeks. */
export function parsePublishedDialogueWeek(
  raw: unknown,
  expected: readonly Pick<ImmersionClientMetadata, "id" | "week" | "day">[],
): ImmersionLesson[] {
  if (
    !Array.isArray(raw) ||
    !expected.length ||
    raw.length !== expected.length ||
    raw.some(
      (lesson, index) =>
        !lesson ||
        lesson.id !== expected[index].id ||
        lesson.week !== expected[index].week ||
        lesson.day !== expected[index].day ||
        !Array.isArray(lesson.sections) ||
        !lesson.sections.length,
    )
  )
    throw new Error("本期内容不完整，请重试。");
  return raw as ImmersionLesson[];
}
