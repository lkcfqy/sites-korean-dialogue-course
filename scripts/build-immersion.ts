import fs from "node:fs";
import path from "node:path";
import raw from "../data/curriculum/dialogues.json";
import words from "../data/vocabulary.json";
import type { Dialogue, Line, Word } from "../data/course";
import type {
  ImmersionLesson,
  ImmersionLessonMetadata,
  ImmersionSection,
} from "../lib/immersion-types";
import { buildDepthStatistics } from "./build-depth-statistics.mjs";
import { createPostCourseLesson } from "./post-course-lessons";
import { isPostCourseLessonId } from "../lib/dialogue-catalog";
import { dialogueSectionKey } from "../lib/dialogue-section-key";
import {
  applyReviewedContextSense,
  type ContextSenseDecision,
} from "../lib/dialogue-context-sense";
type Asset = {
  lessonId: string;
  title: string;
  scene: string;
  kind?: ImmersionSection["kind"];
  lines: Omit<Line, "id" | "words">[];
  assetId?: string;
};
type Pool = {
  label: string;
  scene: string;
  contextNote?: string;
  kind?: Asset["kind"];
  lines: Line[];
};
type Context = {
  lessonId: string;
  title: string;
  ko: string;
  zh: string;
  source: string;
  lineId: string;
};
const source = raw as Dialogue[];
// Preserve stage positions and filename-local depth IDs; never reorder the
// existing IDs when normalizing annotations or adding a new content asset.
const legacyFiles = ["stage-1.json", "stage-2.json", "stage-3.json"];
// Append new assets here to preserve display order. Section keys are derived
// from frozen v12 aliases or original line identities, never pool positions.
const extraFiles = [
  "deep-w19-22.json",
  "deep-w23-26.json",
  "expression-scenes.json",
  "coverage-expansion.json",
  "reading-bridges.json",
  "foundation-expansion.json",
  "recurrence-foundation.json",
  "recurrence-advanced.json",
  "daily-life-expansion-a.json",
  "daily-life-expansion-b.json",
  "gap-expansion-a.json",
  "gap-expansion-b.json",
  "gap-expansion-c.json",
  "gap-expansion-d.json",
  "gap-expansion-e.json",
];
const declaredFiles = [...legacyFiles, ...extraFiles];
const undeclaredFiles = fs
  .readdirSync("data/immersion")
  .filter((file) => file.endsWith(".json") && !declaredFiles.includes(file));
if (undeclaredFiles.length)
  throw new Error(
    `Append new course assets to extraFiles: ${undeclaredFiles.join(", ")}`,
  );
const files = [
  ...legacyFiles,
  ...extraFiles.filter((file) =>
    fs.existsSync(path.join("data/immersion", file)),
  ),
];
const assets = files.flatMap((file) =>
  (
    JSON.parse(
      fs.readFileSync(path.join("data/immersion", file), "utf8"),
    ) as Asset[]
  ).map((asset, index) => ({
    ...asset,
    ...(!legacyFiles.includes(file)
      ? { assetId: `${file.replace(/\.json$/, "")}-${index + 1}` }
      : {}),
  })),
);
const dictionary = new Map(words.map((word) => [word.ko, word]));
// A client search/card index does not need lexical provenance or source dates.
// Keep the complete source vocabulary separately for attribution and audits.
fs.writeFileSync(
  "data/vocabulary-client.json",
  JSON.stringify(words.map(({ ko, zh }) => ({ ko, zh }))) + "\n",
);
const annotations = JSON.parse(
  fs.readFileSync("data/immersion-annotations.json", "utf8"),
) as Record<string, Word[]>;
const annotate = (ko: string) => {
  const annotated = annotations[ko];
  if (!annotated) throw new Error(`Missing annotation: ${ko}`);
  for (const token of annotated) {
    if (!token.lemmas || !token.annotation)
      throw new Error(`Noncanonical annotation: ${ko}`);
    if (token.lemmas.some((base) => !dictionary.has(base)))
      throw new Error(`Unknown lexical root: ${ko}`);
    if (token.annotation.status !== "linked" && token.lemmas.length)
      throw new Error(`Uncertain root was linked: ${ko}`);
  }
  return annotated;
};
const linkedWords = (line: Line) =>
  line.words.flatMap((word) =>
    word.annotation?.status === "linked" ? (word.lemmas ?? []) : [],
  );
const pools = new Map<string, Pool[]>(
  source.map((dialogue) => [
    dialogue.id,
    [
      {
        label: dialogue.day === 6 ? "综合对话" : "今天的对话",
        scene: dialogue.scene,
        kind: "dialogue",
        lines: dialogue.lines.map((line) => ({
          ...line,
          words: annotate(line.ko),
        })),
      },
    ],
  ]),
);
for (const [index, asset] of assets.entries()) {
  if (!pools.has(asset.lessonId)) {
    if (!isPostCourseLessonId(asset.lessonId))
      throw new Error(`Unknown lesson ${asset.lessonId}`);
    pools.set(asset.lessonId, []);
  }
  const lines: Line[] = asset.lines.map((line, lineIndex) => ({
    ...line,
    id: `${asset.lessonId}-${asset.assetId ?? `immersion-${index + 1}`}-${lineIndex + 1}`,
    words: annotate(line.ko),
  }));
  pools.get(asset.lessonId)!.push({
    label: asset.title,
    scene: asset.scene,
    kind: asset.kind ?? "dialogue",
    lines,
  });
}
const contextReview = JSON.parse(
  fs.readFileSync("data/curriculum/dialogue-context-review.json", "utf8"),
) as {
  decisions: {
    firstLineId: string;
    note: string;
    kind?: "passage";
    writtenLineRange?: [number, number];
  }[];
};
for (const decision of contextReview.decisions) {
  const pool = [...pools.values()]
    .flat()
    .find((item) => item.lines[0]?.id === decision.firstLineId);
  if (!pool)
    throw new Error(`Reviewed scene disappeared: ${decision.firstLineId}`);
  pool.contextNote = decision.note;
  if (decision.kind) pool.kind = decision.kind;
  if (decision.writtenLineRange) {
    const [start, end] = decision.writtenLineRange;
    if (start < 0 || end > pool.lines.length || start >= end)
      throw new Error(`Invalid written range: ${decision.firstLineId}`);
    pool.lines = pool.lines.map((line, index) =>
      index >= start && index < end ? { ...line, register: "written" } : line,
    );
  }
}
const senseReview = JSON.parse(
  fs.readFileSync("data/curriculum/context-sense-review.json", "utf8"),
) as { decisions: ContextSenseDecision[] };
const nextSenseReview = JSON.parse(
  fs.readFileSync("data/curriculum/round5-context-sense-review.json", "utf8"),
) as { decisions: ContextSenseDecision[] };
const newMaterialSenseReview = JSON.parse(
  fs.readFileSync(
    "data/curriculum/round5-new-material-context-senses.json",
    "utf8",
  ),
) as { decisions: ContextSenseDecision[] };
const seenSenses = new Set<string>();
for (const decision of [
  ...senseReview.decisions,
  ...nextSenseReview.decisions,
  ...newMaterialSenseReview.decisions,
]) {
  const key = `${decision.lineId}:${decision.wordIndex}`;
  if (seenSenses.has(key)) throw new Error(`Duplicate context sense: ${key}`);
  seenSenses.add(key);
  const pool = [...pools.values()]
    .flat()
    .find((item) => item.lines.some((line) => line.id === decision.lineId));
  const index =
    pool?.lines.findIndex((line) => line.id === decision.lineId) ?? -1;
  if (!pool || index < 0)
    throw new Error(`Reviewed context disappeared: ${decision.lineId}`);
  const line = pool.lines[index];
  const reviewed = applyReviewedContextSense(line, decision);
  if (
    reviewed === line ||
    line.words[decision.wordIndex].meaning !== decision.dictionaryMeaning
  )
    throw new Error(`Reviewed context changed: ${key}`);
  pool.lines[index] = reviewed;
}
// The published order is fixed; rebuilding annotations never reruns scheduling.
const assigned = JSON.parse(
  fs.readFileSync("data/immersion-word-schedule.json", "utf8"),
) as Record<string, string[]>;
const schedule = new Map(Object.entries(assigned));
if ([...schedule.values()].reduce((sum, list) => sum + list.length, 0) !== 4980)
  throw new Error("Incomplete 4,980-word schedule");
const lookup = (week: number, day: number) =>
  source.find((dialogue) => dialogue.week === week && dialogue.day === day);
const metadata: ImmersionLessonMetadata[] = [];
for (let week = 1; week <= 26; week++) {
  const lessons: ImmersionLesson[] = [];
  for (let day = 1; day <= 7; day++) {
    const id = `w${String(week).padStart(2, "0")}d${day}`;
    const current = lookup(week, day);
    const sections: ImmersionSection[] = [];
    const add = (
      dialogue: Dialogue | undefined,
      review: boolean,
      tag: string,
    ) => {
      if (!dialogue) return;
      for (const pool of pools.get(dialogue.id)!)
        sections.push({
          ...pool,
          key: dialogueSectionKey(id, dialogue.id, pool.lines[0].id, tag),
          review,
          source: {
            id: dialogue.id,
            title: dialogue.title,
            week: dialogue.week,
            day: dialogue.day,
          },
          label: review ? `${tag} · ${pool.label}` : pool.label,
        });
    };
    if (current) {
      add(current, false, "新内容");
      add(day > 1 ? lookup(week, day - 1) : lookup(week - 1, 6), true, "隔日");
      add(lookup(week - 1, day), true, "一周");
      add(lookup(week - 4, day), true, "四周");
    } else {
      for (let priorDay = 1; priorDay <= 6; priorDay++)
        add(lookup(week, priorDay), true, `本周第${priorDay}天`);
      for (const priorDay of [2, 4])
        add(lookup(week - 1, priorDay), true, "一周");
      for (const priorDay of [1, 5])
        add(lookup(week - 4, priorDay), true, "四周");
    }
    const inScene = new Set(
      sections
        .filter((section) => !section.review)
        .flatMap((section) => section.lines.flatMap(linkedWords)),
    );
    if (
      new Set(sections.map((section) => section.key)).size !== sections.length
    )
      throw new Error(`Duplicate display scene key: ${id}`);
    const vocabulary = schedule.get(id) ?? [];
    const meta: ImmersionLessonMetadata = {
      id,
      week,
      day,
      sceneVocabulary: vocabulary.filter((word) => inScene.has(word)),
      title: current?.title ?? "本周复习",
      scene:
        current?.scene ?? "回到完整场景，听懂后脱稿复述；今天不增加新内容。",
      kind: current ? "new" : "review",
      vocabulary,
      reviewVocabulary: [
        ...new Set(
          sections
            .filter((section) => section.review)
            .flatMap((section) => schedule.get(section.source.id) ?? []),
        ),
      ],
      newLines: sections
        .filter((section) => !section.review)
        .reduce((sum, section) => sum + section.lines.length, 0),
      reviewLines: sections
        .filter((section) => section.review)
        .reduce((sum, section) => sum + section.lines.length, 0),
    };
    metadata.push(meta);
    lessons.push({ ...meta, sections });
  }
  fs.writeFileSync(
    `public/immersion/week-${String(week).padStart(2, "0")}.json`,
    JSON.stringify(lessons) + "\n",
  );
  fs.writeFileSync(
    `public/immersion/review-week-${String(week).padStart(2, "0")}.json`,
    JSON.stringify(
      lessons.map(({ id, reviewVocabulary }) => ({ id, reviewVocabulary })),
    ) + "\n",
  );
}
const postCourse = [...pools]
  .filter(([id]) => isPostCourseLessonId(id))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, list]) => createPostCourseLesson(id, list));
const postMetadata = postCourse.map((lesson) => ({
  ...Object.fromEntries(
    Object.entries(lesson).filter(
      ([key]) => key !== "sections" && key !== "reviewVocabulary",
    ),
  ),
  reviewVocabularyCount: lesson.reviewVocabulary.length,
}));
fs.writeFileSync(
  "data/immersion-post-course-index.json",
  JSON.stringify(postMetadata) + "\n",
);
for (const week of new Set(postCourse.map((lesson) => lesson.week))) {
  const lessons = postCourse.filter((lesson) => lesson.week === week);
  fs.writeFileSync(
    `public/immersion/week-${String(week).padStart(2, "0")}.json`,
    JSON.stringify(lessons) + "\n",
  );
  fs.writeFileSync(
    `public/immersion/review-week-${String(week).padStart(2, "0")}.json`,
    JSON.stringify(
      lessons.map(({ id, reviewVocabulary }) => ({ id, reviewVocabulary })),
    ) + "\n",
  );
}
const originalLines = [...pools.values()].flatMap((list) =>
  list.flatMap((pool) => pool.lines),
);
const mainOriginalLines = source.flatMap((dialogue) =>
  pools.get(dialogue.id)!.flatMap((pool) => pool.lines),
);
const mainAssets = assets.filter(
  (asset) => !isPostCourseLessonId(asset.lessonId),
);
const distinct = new Set(mainOriginalLines.map((line) => line.ko));
const contexts: Record<string, Context[]> = {};
for (const dialogue of source)
  for (const pool of pools.get(dialogue.id)!)
    for (const line of pool.lines) {
      for (const base of new Set(linkedWords(line))) {
        contexts[base] ??= [];
        if (
          contexts[base].length < 6 &&
          !contexts[base].some((context) => context.ko === line.ko)
        ) {
          contexts[base].push({
            lessonId: dialogue.id,
            title: pool.label,
            ko: line.ko,
            zh: line.zh,
            source: pool.kind ?? "dialogue",
            lineId: line.id,
          });
        }
      }
    }
const main = new Set(metadata.flatMap((lesson) => lesson.vocabulary));
// Keep the existing six main-course examples, then expose up to two extension
// examples even for common words whose main-course slots are already full.
const postContexts: Record<string, Context[]> = {};
for (const lesson of postCourse)
  for (const section of lesson.sections)
    for (const line of section.lines)
      for (const base of new Set(linkedWords(line))) {
        postContexts[base] ??= [];
        if (
          postContexts[base].length < 2 &&
          !postContexts[base].some((example) => example.ko === line.ko)
        )
          postContexts[base].push({
            lessonId: lesson.id,
            title: `结课后 · ${section.label}`,
            ko: line.ko,
            zh: line.zh,
            source: section.kind ?? "dialogue",
            lineId: line.id,
          });
      }
const linkedMain = [...main].filter((word) => contexts[word]).length;
const sameDay = metadata.reduce(
  (sum, lesson) => sum + lesson.sceneVocabulary.length,
  0,
);
const annotationScope =
  "Canonical dictionary-backed lemmas on original course lines; unresolved candidates excluded. Machine annotations, not independently reviewed text occurrence coverage.";
const statistics = {
  mainWords: main.size,
  expansionWords: words.length - main.size,
  newLines: mainOriginalLines.length,
  distinctLines: distinct.size,
  authoredSections: source.length + mainAssets.length,
  sceneSections:
    source.length +
    mainAssets.filter(
      (asset) => asset.kind !== "sentence" && asset.kind !== "pronunciation",
    ).length,
  expressionPoints: mainAssets.filter((asset) => asset.kind === "sentence")
    .length,
  deepPassages: mainAssets.filter((asset) => asset.kind === "passage").length,
  deepDialogues: mainAssets.filter(
    (asset) => asset.assetId?.startsWith("deep-") && asset.kind === "dialogue",
  ).length,
  wordsWithCourseContexts: Object.keys(contexts).length,
  mainWordsWithCourseContexts: linkedMain,
  mainWordsWithoutCourseContextLinks: main.size - linkedMain,
  sameDaySceneWords: sameDay,
  annotationScope,
  annotationRevision: "2026-10-07-machine-context-v1",
  independentNativeSpeakerReview: false,
  postCourse: {
    lessonIds: postCourse.map((lesson) => lesson.id),
    lessons: postCourse.length,
    originalSections: postCourse.reduce(
      (sum, lesson) => sum + lesson.sections.length,
      0,
    ),
    originalLines: postCourse.reduce((sum, lesson) => sum + lesson.newLines, 0),
  },
};
fs.writeFileSync(
  "data/immersion-context.json",
  JSON.stringify(contexts) + "\n",
);
fs.writeFileSync(
  "data/immersion-post-course-context.json",
  JSON.stringify(postContexts) + "\n",
);
fs.writeFileSync("data/immersion-index.json", JSON.stringify(metadata) + "\n");
fs.writeFileSync(
  "data/immersion-client-index.json",
  JSON.stringify(
    metadata.map(({ reviewVocabulary, ...lesson }) => ({
      ...lesson,
      reviewVocabularyCount: reviewVocabulary.length,
    })),
  ) + "\n",
);
fs.writeFileSync(
  "data/immersion-statistics.json",
  JSON.stringify(statistics) + "\n",
);
// Refresh occurrence reports against the *current* canonical annotations while
// retaining the published schedule and identifying past optimization metrics.
const previousStats = JSON.parse(
  fs.readFileSync("data/immersion-word-schedule.stats.json", "utf8"),
) as Record<string, unknown>;
const currentWeeks = Array.from({ length: 26 }, (_, index) => {
  const lessons = metadata.filter((lesson) => lesson.week === index + 1);
  const vocabulary = lessons.flatMap((lesson) => lesson.vocabulary);
  const matches = lessons.reduce(
    (sum, lesson) => sum + lesson.sceneVocabulary.length,
    0,
  );
  const levels: Record<string, number> = {};
  for (const word of vocabulary) {
    const level = String(dictionary.get(word)!.level);
    levels[level] = (levels[level] ?? 0) + 1;
  }
  return {
    week: index + 1,
    newWords: vocabulary.length,
    levels,
    sameDaySceneWords: matches,
    sameDayRate: Number((matches / vocabulary.length).toFixed(3)),
  };
});
const mismatchSamples = [1, 7, 13, 19, 21, 26].map((week) => {
  const lesson = metadata.find((item) => item.week === week && item.day === 1)!;
  return {
    lessonId: lesson.id,
    title: lesson.title,
    sameDayCount: lesson.sceneVocabulary.length,
    offSceneSample: lesson.vocabulary
      .filter((word) => !lesson.sceneVocabulary.includes(word))
      .slice(0, 12),
    lateCoreSample: lesson.vocabulary
      .filter((word) => dictionary.get(word)!.level < 3)
      .slice(0, 8),
  };
});
fs.writeFileSync(
  "data/immersion-word-schedule.stats.json",
  JSON.stringify(
    {
      ...previousStats,
      sameDaySceneWords: sameDay,
      wordsWithAnyScene: linkedMain,
      weeks: currentWeeks,
      mismatchSamples,
      annotationMode:
        "canonical machine annotations; unresolved candidates excluded",
      annotationScope,
      optimizationMetricsScope:
        "Historical scheduling run only; cost and swap counts are not recomputed by annotation rebuilds.",
    },
    null,
    2,
  ) + "\n",
);
const tokenCounts = { linked: 0, ambiguous: 0, unlinked: 0 };
let corrected = 0;
for (const line of originalLines)
  for (const token of line.words) {
    tokenCounts[token.annotation!.status]++;
    if (
      token.annotation!.method === "machine-rule" &&
      token.annotation!.status === "linked"
    )
      corrected++;
  }
fs.writeFileSync(
  "data/course-annotation-statistics.json",
  JSON.stringify(
    {
      revision: statistics.annotationRevision,
      scope: annotationScope,
      independentNativeSpeakerReview: false,
      originalLineTokens: tokenCounts,
      machineContextRuleTokens: corrected,
      mainWordsWithCourseContextLinks: linkedMain,
      sameDaySceneWords: sameDay,
      limitations: [
        "Linked lemmas do not prove contextual sense correctness or student mastery.",
        "Missing links do not prove a headword never appears in the text.",
        "Context rules cover known agent-assisted decisions; unresolved readings are not linked.",
      ],
    },
    null,
    2,
  ) + "\n",
);
// Older source-derived context files remain inspectable without retaining
// removed homograph links. Source dates are historical allocation metadata;
// they are not the fixed published immersion introduction schedule.
const firstUse: Record<string, string> = {};
const lemmas: Record<string, string[]> = {};
for (const dialogue of source)
  for (const line of dialogue.lines) {
    lemmas[line.id] = [...new Set(linkedWords(line))];
    for (const base of lemmas[line.id]) firstUse[base] ??= dialogue.id;
  }
const legacyCoverage = JSON.parse(
  fs.readFileSync("data/curriculum/lexical-coverage.json", "utf8"),
) as Record<string, unknown>;
fs.writeFileSync(
  "data/curriculum/lexical-coverage.json",
  JSON.stringify({
    ...legacyCoverage,
    firstUse,
    lemmas,
    annotationScope,
    independentNativeSpeakerReview: false,
    allocationScope:
      "Vocabulary lessonId is historical source allocation; immersion-word-schedule.json is the fixed published schedule.",
  }) + "\n",
);
type LegacyContext = {
  ko: string;
  zh: string;
  lessonId: string;
  title: string;
  source: "dialogue" | "reading";
};
const legacyExamples = JSON.parse(
  fs.readFileSync("data/vocabulary-context.json", "utf8"),
) as Record<string, LegacyContext[]>;
const sourceExamples: Record<string, LegacyContext[]> = {};
for (const dialogue of source)
  for (const line of dialogue.lines)
    for (const base of new Set(linkedWords(line))) {
      sourceExamples[base] ??= [];
      if (
        sourceExamples[base].length < 2 &&
        !sourceExamples[base].some((example) => example.ko === line.ko)
      ) {
        sourceExamples[base].push({
          ko: line.ko,
          zh: line.zh,
          lessonId: dialogue.id,
          title: dialogue.title,
          source: "dialogue",
        });
      }
    }
for (const [base, examples] of Object.entries(legacyExamples)) {
  for (const example of examples.filter((item) => item.source === "reading")) {
    sourceExamples[base] ??= [];
    if (
      sourceExamples[base].length < 2 &&
      !sourceExamples[base].some((item) => item.ko === example.ko)
    )
      sourceExamples[base].push(example);
  }
}
fs.writeFileSync(
  "data/vocabulary-context.json",
  JSON.stringify(sourceExamples) + "\n",
);
const curriculumStats = JSON.parse(
  fs.readFileSync("data/curriculum/statistics.json", "utf8"),
) as Record<string, unknown>;
fs.writeFileSync(
  "data/curriculum/statistics.json",
  JSON.stringify({
    ...curriculumStats,
    wordsWithExamples: Object.keys(sourceExamples).length,
    annotationScope,
    independentNativeSpeakerReview: false,
  }) + "\n",
);
buildDepthStatistics();
console.log({
  days: metadata.length,
  mainWords: main.size,
  distinctLines: distinct.size,
  addedSections: assets.length,
  sameDaySceneWords: sameDay,
  mainWordsWithCourseContextLinks: linkedMain,
  tokenCounts,
});
