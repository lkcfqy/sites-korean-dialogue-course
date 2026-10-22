import { isRecord } from "./study-validation";

/** Extract the word lists without retaining the week's dialogue payload in memory. */
export function parseReviewWeek(
  value: unknown,
  lessonIds: readonly string[],
  validWords: ReadonlySet<string>,
): Record<string, string[]> {
  if (!Array.isArray(value) || value.length !== lessonIds.length) {
    throw new Error("本周复习词表不完整，请重试。");
  }
  return Object.fromEntries(
    value.map((item, index) => {
      if (
        !isRecord(item) ||
        item.id !== lessonIds[index] ||
        !Array.isArray(item.reviewVocabulary) ||
        item.reviewVocabulary.some(
          (word) => typeof word !== "string" || !validWords.has(word),
        )
      ) {
        throw new Error("本周复习词表不完整，请重试。");
      }
      return [item.id, item.reviewVocabulary];
    }),
  );
}
