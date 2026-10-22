import fs from "node:fs";
import { pathToFileURL } from "node:url";
// Generation is explicit and separate from validation: audit-depth must compare
// committed facts with independently recomputed facts, never rewrite them.
export function buildDepthStatistics() {
  const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const words = read("data/vocabulary.json");
  const usage = read("data/vocabulary-usage.json");
  const contexts = read("data/immersion-context.json");
  const main = new Set(
    read("data/immersion-index.json").flatMap((lesson) => lesson.vocabulary),
  );
  const originalSections = Array.from({ length: 26 }, (_, index) =>
    read(`public/immersion/week-${String(index + 1).padStart(2, "0")}.json`),
  )
    .flat()
    .flatMap((lesson) => lesson.sections.filter((section) => !section.review));
  const allPassages = originalSections.filter(
    (section) => section.kind === "passage",
  );
  const passages = allPassages.filter((section) =>
    section.lines[0].id.includes("-deep-"),
  );
  const bridges = originalSections.filter(
    (section) =>
      section.kind === "passage" &&
      section.lines[0].id.includes("-reading-bridges-"),
  );
  const legacyIds = new Set(
    read("data/curriculum/dialogue-context-review.json")
      .decisions.filter((decision) => decision.kind === "passage")
      .map((decision) => decision.firstLineId),
  );
  const legacyPassages = allPassages.filter((section) =>
    legacyIds.has(section.lines[0].id),
  );
  const bridgeSizes = bridges.map(
    (section) =>
      (
        section.lines
          .map((line) => line.ko)
          .join("")
          .match(/[가-힣]/g) ?? []
      ).length,
  );
  const sizes = passages.map(
    (section) =>
      (
        section.lines
          .map((line) => line.ko)
          .join("")
          .match(/[가-힣]/g) ?? []
      ).length,
  );
  const examples = (ko) =>
    new Set([
      ...usage[ko].flatMap((sense) => [
        ...sense.sentences,
        ...sense.conversation,
      ]),
      ...(contexts[ko] ?? []).map((context) => context.ko),
    ]);
  const stats = {
    headwords: words.length,
    mainWords: main.size,
    mainWordsWithThreeContexts: [...main].filter(
      (word) => examples(word).size >= 3,
    ).length,
    wordSentenceAndDialogueContexts: words.reduce(
      (sum, word) =>
        sum +
        new Set(
          usage[word.ko].flatMap((sense) => [
            ...sense.sentences,
            ...sense.conversation,
          ]),
        ).size,
      0,
    ),
    globalDistinctWordExamples: new Set(
      words.flatMap((word) =>
        usage[word.ko].flatMap((sense) => [
          ...sense.sentences,
          ...sense.conversation,
        ]),
      ),
    ).size,
    authoredBilingualExamples: Object.values(
      read("data/depth-vocabulary-examples.json"),
    ).reduce((sum, list) => sum + list.length, 0),
    expressionExamples: originalSections.filter(
      (section) => section.kind === "sentence",
    ).length,
    deepPassages: passages.length,
    legacyReadingPassages: legacyPassages.length,
    totalReadingPassages: allPassages.length,
    minPassageHangul: Math.min(...sizes),
    maxPassageHangul: Math.max(...sizes),
    readingBridgePassages: bridges.length,
    minBridgeHangul: Math.min(...bridgeSizes),
    maxBridgeHangul: Math.max(...bridgeSizes),
  };
  fs.writeFileSync(
    "data/course-depth-statistics.json",
    JSON.stringify(stats, null, 2) + "\n",
  );
  return stats;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(JSON.stringify(buildDepthStatistics(), null, 2));
}
