/**
 * Independent, reproducible audit of the published dialogue learning corpus.
 * Run: npx tsx scripts/audit-dialogue-learning.ts --write
 *      npx tsx scripts/audit-dialogue-learning.ts --check
 * Structural checks are assertions. Lexical/content gaps are reported, not
 * hidden behind a passing exit code. Surface candidates are never coverage.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Line } from "../data/course";
import { intensiveWeeks } from "../data/intensive-course";
import type {
  ImmersionClientMetadata,
  ImmersionLesson,
  ImmersionSection,
} from "../lib/immersion-types";
import type { ContextSenseDecision } from "../lib/dialogue-context-sense";
import {
  isPostCourseLessonId,
  parsePublishedDialogueWeek,
} from "../lib/dialogue-catalog";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = <T>(path: string): T =>
  JSON.parse(readFileSync(resolve(root, path), "utf8")) as T;
const weekFiles = Array.from(
  { length: 26 },
  (_, index) =>
    `public/immersion/week-${String(index + 1).padStart(2, "0")}.json`,
);
const lessons = weekFiles.flatMap((file) => read<ImmersionLesson[]>(file));
const postMetadata = read<ImmersionClientMetadata[]>(
  "data/immersion-post-course-index.json",
);
assert.equal(
  new Set(postMetadata.map((lesson) => lesson.id)).size,
  postMetadata.length,
);
assert(
  postMetadata.every((lesson) => isPostCourseLessonId(lesson.id)),
  "Extension catalog must contain only actual post-course days",
);
const postWeekFiles = [
  ...new Set(postMetadata.map((lesson) => lesson.week)),
].map((week) => `public/immersion/week-${String(week).padStart(2, "0")}.json`);
const postLessons = postWeekFiles.flatMap((file) => {
  const week = Number(file.match(/week-(\d+)/)![1]);
  return parsePublishedDialogueWeek(
    read<unknown>(file),
    postMetadata.filter((lesson) => lesson.week === week),
  );
});
const legacySourceFiles = ["stage-1.json", "stage-2.json", "stage-3.json"];
const immersionSourceFiles = [
  ...legacySourceFiles,
  ...readdirSync(resolve(root, "data/immersion"))
    .filter(
      (file) => file.endsWith(".json") && !legacySourceFiles.includes(file),
    )
    .sort(),
];
type SourceAsset = {
  lessonId: string;
  scene: string;
  lines: Pick<Line, "speaker" | "ko" | "zh">[];
};
const metadata = read<Omit<ImmersionLesson, "sections">[]>(
  "data/immersion-index.json",
);
const vocabulary = read<{ ko: string; zh: string; level: number }[]>(
  "data/vocabulary.json",
);
const contexts = read<
  Record<string, { lessonId: string; lineId: string; ko: string }[]>
>("data/immersion-context.json");
const postContexts = read<typeof contexts>(
  "data/immersion-post-course-context.json",
);
for (const [word, examples] of Object.entries(postContexts)) {
  assert(
    examples.length <= 2 &&
      examples.every((example) => isPostCourseLessonId(example.lessonId)),
  );
  contexts[word] = [...(contexts[word] ?? []), ...examples];
}
const usage = read<
  Record<string, { sentences: string[]; conversation: string[] }[]>
>("data/vocabulary-usage.json");
const phraseReview = read<{
  candidates: {
    headword: string;
    lineId: string;
    ko: string;
    surfaceTokens: string[];
    verdict: "valid" | "false";
  }[];
}>("data/curriculum/index-link-review.json");
const indexRepair = read<{
  phrases: typeof phraseReview.candidates;
  aliases: {
    lineId: string;
    ko: string;
    wordIndex: number;
    surface: string;
    headword: string;
    action: string;
    originalLemmas: string[];
    note: string;
  }[];
}>("data/curriculum/round4-index-decisions.json");
const nextIndexRepair = read<{
  aliases: typeof indexRepair.aliases;
  unlisted: {
    lineId: string;
    ko: string;
    wordIndex: number;
    surface: string;
    note: string;
  }[];
}>("data/curriculum/round5-index-decisions.json");
const phraseDecisions = [...phraseReview.candidates, ...indexRepair.phrases];
const phases = [
  [1, 6],
  [7, 12],
  [13, 18],
  [19, 26],
] as const;
const ordinal = (lesson: Pick<ImmersionLesson, "week" | "day">) =>
  (lesson.week - 1) * 7 + lesson.day;
const mean = (values: number[]) =>
  values.length
    ? Number(
        (values.reduce((n, value) => n + value, 0) / values.length).toFixed(2),
      )
    : 0;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.floor(sorted.length / 2)]) /
        2
    : null;
};
const linked = (line: Line) => [
  ...new Set(
    line.words.flatMap((word) =>
      word.annotation?.status === "linked" ? (word.lemmas ?? []) : [],
    ),
  ),
];
type Scene = { lesson: ImmersionLesson; section: ImmersionSection };
const scenes: Scene[] = [];
const originals = new Map<
  string,
  { lesson: ImmersionLesson; section: ImmersionSection; line: Line }
>();
const mainSchedule = new Map<string, ImmersionLesson>();
const reviewExposure = new Map<string, Set<number>>();
const seenTexts = new Map<string, string[]>();
let reviewLineExposures = 0;
let tokensLinked = 0;
let tokensUnlinked = 0;
let tokensAmbiguous = 0;
assert.equal(lessons.length, 182, "Every one of the 26 weeks needs seven days");
for (const [index, lesson] of [...lessons, ...postLessons].entries()) {
  const postCourse = index >= lessons.length;
  if (!postCourse) {
    assert.equal(lesson.week, Math.floor(index / 7) + 1);
    assert.equal(lesson.day, (index % 7) + 1);
  } else {
    assert(lesson.week > 26 && lesson.day <= 6);
    assert(
      lesson.sections.every(
        (section) => !section.review && section.source.id === lesson.id,
      ),
      "Post-course material must be original scenes, not copied reviews",
    );
    assert.equal(lesson.reviewLines, 0);
    assert.deepEqual(lesson.reviewVocabulary, []);
  }
  assert.equal(
    lesson.id,
    `w${String(lesson.week).padStart(2, "0")}d${lesson.day}`,
  );
  const { sections, ...rest } = lesson;
  if (postCourse) {
    const { reviewVocabulary, ...client } = rest;
    assert.deepEqual(
      { ...client, reviewVocabularyCount: reviewVocabulary.length },
      postMetadata.find((item) => item.id === lesson.id),
      `Post-course metadata mismatch ${lesson.id}`,
    );
  } else
    assert.deepEqual(
      rest,
      metadata[index],
      `Published metadata mismatch ${lesson.id}`,
    );
  assert.equal(
    lesson.newLines,
    sections.filter((s) => !s.review).reduce((n, s) => n + s.lines.length, 0),
  );
  assert.equal(
    lesson.reviewLines,
    sections.filter((s) => s.review).reduce((n, s) => n + s.lines.length, 0),
  );
  if (lesson.day === 7) assert(sections.every((s) => s.review));
  for (const word of postCourse ? [] : lesson.vocabulary) {
    assert(
      !mainSchedule.has(word),
      `Main word has multiple introduction dates: ${word}`,
    );
    mainSchedule.set(word, lesson);
  }
  for (const section of sections.filter((s) => !s.review)) {
    scenes.push({ lesson, section });
    for (const line of section.lines) {
      assert(!originals.has(line.id), `Repeated new-material ID: ${line.id}`);
      originals.set(line.id, { lesson, section, line });
      assert(
        /[가-힣]/.test(line.ko) && /[\u3400-\u9fff]/.test(line.zh),
        `Bilingual text missing: ${line.id}`,
      );
      assert.equal(
        line.words.map((word) => word.text).join(" "),
        line.ko,
        `Token boundaries: ${line.id}`,
      );
      assert(
        line.ko.length <= 240,
        `Speech request exceeds current limit: ${line.id}`,
      );
      const ids = seenTexts.get(line.ko) ?? [];
      ids.push(line.id);
      seenTexts.set(line.ko, ids);
      for (const word of line.words) {
        const status = word.annotation?.status;
        if (status === "linked") tokensLinked++;
        else if (status === "ambiguous") tokensAmbiguous++;
        else tokensUnlinked++;
      }
    }
  }
}
for (const lesson of lessons) {
  for (const section of lesson.sections.filter((s) => s.review)) {
    assert(
      ordinal(section.source) < ordinal(lesson),
      `Review points forward: ${lesson.id}`,
    );
    for (const line of section.lines) {
      const source = originals.get(line.id);
      assert(source, `Unresolvable review line ${line.id}`);
      assert.equal(
        source.lesson.id,
        section.source.id,
        `Review source lesson ${line.id}`,
      );
      assert.equal(
        source.lesson.week,
        section.source.week,
        `Review source week ${line.id}`,
      );
      assert.equal(
        source.lesson.day,
        section.source.day,
        `Review source day ${line.id}`,
      );
      assert.equal(
        source.line.speaker,
        line.speaker,
        `Review speaker drift ${line.id}`,
      );
      assert.equal(
        source.line.register,
        line.register,
        `Review register drift ${line.id}`,
      );
      assert.equal(
        source.section.contextNote,
        section.contextNote,
        `Review context drift ${line.id}`,
      );
      assert.equal(
        source.section.kind,
        section.kind,
        `Review genre drift ${line.id}`,
      );
      assert.deepEqual(
        source.line.words,
        line.words,
        `Review annotation drift ${line.id}`,
      );
      assert.equal(
        source.line.ko,
        line.ko,
        `Review source text drift ${line.id}`,
      );
      assert.equal(
        source.line.zh,
        line.zh,
        `Review translation drift ${line.id}`,
      );
      reviewLineExposures++;
      for (const word of linked(line)) {
        const days = reviewExposure.get(word) ?? new Set<number>();
        days.add(ordinal(lesson));
        reviewExposure.set(word, days);
      }
    }
  }
}

// The review manifest explains genre/relationship without changing any source
// sentence. Verify its application to publication, not just its existence.
const contextReview = read<{
  schemaVersion: number;
  independentNativeSpeakerReview: boolean;
  decisions: {
    firstLineId: string;
    note: string;
    kind?: "passage";
    writtenLineRange?: [number, number];
  }[];
}>("data/curriculum/dialogue-context-review.json");
assert.equal(contextReview.schemaVersion, 1);
assert.equal(contextReview.independentNativeSpeakerReview, false);
assert.equal(contextReview.decisions.length, 44);
assert.equal(
  new Set(contextReview.decisions.map((d) => d.firstLineId)).size,
  44,
);
const reviewedSceneContexts = contextReview.decisions.map((decision) => {
  const original = originals.get(decision.firstLineId);
  assert(original, `Reviewed scene missing: ${decision.firstLineId}`);
  const section = original.section;
  assert.equal(section.lines[0].id, decision.firstLineId);
  assert(decision.note.trim());
  assert.equal(section.contextNote, decision.note);
  if (decision.kind) assert.equal(section.kind, decision.kind);
  if (decision.writtenLineRange) {
    const [start, end] = decision.writtenLineRange;
    assert(Number.isInteger(start) && Number.isInteger(end));
    assert(start >= 0 && end <= section.lines.length && start < end);
    for (const [index, line] of section.lines.entries()) {
      assert.equal(
        line.register,
        index >= start && index < end ? "written" : undefined,
        `Written/spoken boundary changed: ${line.id}`,
      );
      if (line.register === "written") assert.equal(line.speaker, "B");
    }
  }
  return {
    firstLineId: decision.firstLineId,
    kind: section.kind,
    writtenLines: section.lines.filter((line) => line.register === "written")
      .length,
    contextNote: section.contextNote,
  };
});
assert.equal(
  reviewedSceneContexts.filter(
    (d) => d.writtenLines === 22 && d.kind === "dialogue",
  ).length,
  35,
);
assert.equal(
  reviewedSceneContexts.filter(
    (d) => d.writtenLines === 22 && d.kind === "passage",
  ).length,
  7,
);
assert.equal(
  reviewedSceneContexts.filter((d) => d.writtenLines === 0).length,
  2,
);

const senseReview = read<{
  independentNativeSpeakerReview: boolean;
  decisions: ContextSenseDecision[];
}>("data/curriculum/context-sense-review.json");
const nextSenseReview = read<typeof senseReview>(
  "data/curriculum/round5-context-sense-review.json",
);
const newMaterialSenseReview = read<typeof senseReview>(
  "data/curriculum/round5-new-material-context-senses.json",
);
assert.equal(newMaterialSenseReview.independentNativeSpeakerReview, false);
assert.equal(senseReview.independentNativeSpeakerReview, false);
assert.equal(nextSenseReview.independentNativeSpeakerReview, false);
assert.equal(new Set(nextSenseReview.decisions.map((d) => d.lineId)).size, 38);
assert.equal(
  nextSenseReview.decisions.filter((d) =>
    senseReview.decisions.some((old) => old.lineId === d.lineId),
  ).length,
  0,
);
assert(new Set(senseReview.decisions.map((d) => d.lineId)).size >= 30);
assert(new Set(senseReview.decisions.map((d) => d.headword)).size >= 10);
const senseKeys = new Set<string>();
const verifyContextSense = (decision: ContextSenseDecision) => {
  const key = `${decision.lineId}:${decision.wordIndex}`;
  assert(!senseKeys.has(key), `Duplicate exact context sense: ${key}`);
  senseKeys.add(key);
  const original = originals.get(decision.lineId);
  assert(original, `Reviewed sense lost its original: ${decision.lineId}`);
  assert.equal(original.lesson.id, decision.lessonId);
  assert.equal(original.line.ko, decision.ko);
  const word = original.line.words[decision.wordIndex];
  assert.equal(word.text, decision.surface);
  assert.equal(word.annotation?.status, "linked");
  assert(word.lemmas?.includes(decision.headword));
  assert.equal(word.meaning, decision.dictionaryMeaning);
  assert.deepEqual(word.contextSense, {
    reviewedLineId: decision.lineId,
    headword: decision.headword,
    meaning: decision.contextMeaning,
    morphologyNote: decision.morphologyNote,
    otherSenses: decision.otherSenses,
    confidence: decision.confidence,
  });
  return {
    lineId: decision.lineId,
    wordIndex: decision.wordIndex,
    surface: word.text,
    headword: decision.headword,
    contextMeaning: decision.contextMeaning,
  };
};
const reviewedContextSenses = [
  ...senseReview.decisions,
  ...nextSenseReview.decisions,
].map(verifyContextSense);
const reviewedNewMaterialContextSenses =
  newMaterialSenseReview.decisions.map(verifyContextSense);
const courseListening = originals
  .get("w19d3-immersion-135-1")!
  .line.words.find((w) => w.text === "들었는데")!;
assert.deepEqual(courseListening.lemmas, ["듣다"]);
for (const surface of ["배선이나", "등기구를"]) {
  const compound = originals
    .get("w16d5-reading-bridges-2-3")!
    .line.words.find((w) => w.text === surface)!;
  assert.equal(compound.annotation?.status, "unlinked");
  assert.deepEqual(compound.lemmas, []);
  assert(compound.note?.includes("完整复合词未收入本词表"));
}

// A linked phrase must preserve its complete, reviewed word span. Attaching a
// phrase headword to one word does not make that word alone the phrase meaning.
const reviewedPhraseLinks: {
  headword: string;
  lineId: string;
  surface: string;
}[] = [];
for (const { line } of originals.values()) {
  for (const [index, word] of line.words.entries()) {
    for (const phrase of word.annotation?.linkedSpans ?? []) {
      const decision = phraseDecisions.find(
        (item) =>
          item.verdict === "valid" &&
          item.headword === phrase.headword &&
          item.lineId === phrase.reviewedLineId,
      );
      assert(decision, `Unreviewed phrase link: ${line.id} ${phrase.headword}`);
      assert.equal(line.ko, decision.ko, `Phrase context changed: ${line.id}`);
      assert.equal(word.annotation?.status, "linked");
      assert(word.lemmas?.includes(phrase.headword));
      assert.equal(
        phrase.wordStart,
        index,
        "Phrase is anchored only at its first word",
      );
      assert(
        Number.isInteger(phrase.wordEnd) &&
          phrase.wordEnd > index + 1 &&
          phrase.wordEnd <= line.words.length,
      );
      const surfaces = line.words
        .slice(index, phrase.wordEnd)
        .map((w) => w.text);
      assert.deepEqual(surfaces, phrase.surfaceTokens);
      assert.deepEqual(surfaces, decision.surfaceTokens);
      assert.equal(phrase.surface, surfaces.join(" "));
      assert.equal(phrase.lexicalComponents.join(""), phrase.headword);
      assert(
        phrase.meaning?.trim(),
        "Reviewed phrase needs an explicit whole-phrase meaning",
      );
      reviewedPhraseLinks.push({
        headword: phrase.headword,
        lineId: line.id,
        surface: phrase.surface,
      });
    }
  }
}
for (const decision of phraseReview.candidates) {
  const original = originals.get(decision.lineId)?.line;
  assert(original && original.ko === decision.ko);
  if (decision.verdict === "valid") {
    assert(
      reviewedPhraseLinks.some(
        (link) =>
          link.lineId === decision.lineId &&
          link.headword === decision.headword,
      ),
      `Reviewed phrase is still missing: ${decision.headword}`,
    );
  } else {
    assert(
      !linked(original).includes(decision.headword),
      `Rejected homograph created false coverage: ${decision.headword}`,
    );
  }
}

// Validate actual authored content against publication, independently of the
// metadata index. Changed sources must not remain silently unpublished.
const authoredLines = new Map<
  string,
  { lessonId: string; scene: string; line: Pick<Line, "speaker" | "ko" | "zh"> }
>();
for (const dialogue of read<{ id: string; scene: string; lines: Line[] }[]>(
  "data/curriculum/dialogues.json",
)) {
  for (const line of dialogue.lines) {
    assert(!authoredLines.has(line.id), `Duplicate authored ID: ${line.id}`);
    authoredLines.set(line.id, {
      lessonId: dialogue.id,
      scene: dialogue.scene,
      line,
    });
  }
}
let legacyAssetOffset = 0;
for (const file of immersionSourceFiles) {
  const assets = read<SourceAsset[]>(`data/immersion/${file}`);
  const legacy = legacySourceFiles.includes(file);
  for (const [index, asset] of assets.entries()) {
    const assetId = legacy
      ? `immersion-${legacyAssetOffset + index + 1}`
      : `${file.replace(/\.json$/, "")}-${index + 1}`;
    for (const [lineIndex, line] of asset.lines.entries()) {
      const id = `${asset.lessonId}-${assetId}-${lineIndex + 1}`;
      assert(!authoredLines.has(id), `Duplicate authored ID: ${id}`);
      authoredLines.set(id, {
        lessonId: asset.lessonId,
        scene: asset.scene,
        line,
      });
    }
  }
  if (legacy) legacyAssetOffset += assets.length;
}
assert.equal(
  authoredLines.size,
  originals.size,
  "Authored and published original line counts differ; rebuild publication",
);
for (const [id, authored] of authoredLines) {
  const published = originals.get(id);
  assert(published, `Unpublished source line: ${id}`);
  assert.equal(published.lesson.id, authored.lessonId, `Source lesson: ${id}`);
  assert.equal(published.section.scene, authored.scene, `Source scene: ${id}`);
  for (const field of ["speaker", "ko", "zh"] as const) {
    assert.equal(
      published.line[field],
      authored.line[field],
      `Source/publication ${field} drift: ${id}`,
    );
  }
}

const wordOccurrences = new Map<
  string,
  typeof originals extends Map<string, infer T> ? T[] : never
>();
for (const source of originals.values()) {
  for (const word of linked(source.line)) {
    const occurrences = wordOccurrences.get(word) ?? [];
    occurrences.push(source);
    wordOccurrences.set(word, occurrences);
  }
}
const brokenContextLinks: { ko: string; lineId: string }[] = [];
for (const [ko, examples] of Object.entries(contexts)) {
  for (const example of examples) {
    const source = originals.get(example.lineId);
    if (
      !source ||
      source.lesson.id !== example.lessonId ||
      source.line.ko !== example.ko ||
      !linked(source.line).includes(ko)
    ) {
      brokenContextLinks.push({ ko, lineId: example.lineId });
    }
  }
}
assert.equal(
  brokenContextLinks.length,
  0,
  "Course example links must resolve to the original linked line",
);

// This deliberately conservative spelling scan can expose index/segmentation
// candidates. It cannot recognise Korean conjugation or disambiguate senses.
// Only full noun-like tokens, a small explicit particle list, or adjacent
// tokens spelling the complete headword are candidates. No verb-stem prefixes.
const suffixes = new Set([
  "",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "에",
  "에서",
  "에게",
  "께",
  "께서",
  "와",
  "과",
  "도",
  "만",
  "부터",
  "까지",
  "로",
  "으로",
  "보다",
  "처럼",
  "마다",
  "에는",
  "에도",
  "에서는",
  "으로는",
  "이고",
  "이며",
  "입니다",
  "이에요",
  "예요",
  "이라고",
  "라고",
  "이라는",
  "라는",
  "이란",
]);
const spellingCandidates = new Map<
  string,
  { lineId: string; lessonId: string; ko: string; method: string }[]
>();
const missingWords = [...mainSchedule.keys()].filter(
  (ko) => !wordOccurrences.has(ko),
);
const missingSet = new Set(missingWords);
for (const { lesson, line } of originals.values()) {
  const tokens = line.ko
    .split(/\s+/)
    .map((token) => token.replace(/^[^가-힣]+|[^가-힣]+$/g, ""));
  for (let start = 0; start < tokens.length; start++) {
    let spelling = "";
    for (let end = start; end < Math.min(start + 3, tokens.length); end++) {
      spelling += tokens[end];
      for (const suffix of suffixes) {
        if (suffix && !spelling.endsWith(suffix)) continue;
        const base = suffix ? spelling.slice(0, -suffix.length) : spelling;
        if (!missingSet.has(base) || (base.endsWith("다") && suffix)) continue;
        const candidates = spellingCandidates.get(base) ?? [];
        if (
          !candidates.some((candidate) => candidate.lineId === line.id) &&
          candidates.length < 6
        ) {
          candidates.push({
            lineId: line.id,
            lessonId: lesson.id,
            ko: line.ko,
            method:
              end > start
                ? "spaced-headword-candidate"
                : "surface-headword-candidate",
          });
        }
        spellingCandidates.set(base, candidates);
      }
    }
  }
}
const glossary = new Map(vocabulary.map((word) => [word.ko, word]));
const words = [...mainSchedule].map(([ko, scheduled]) => {
  const occurrences = wordOccurrences.get(ko) ?? [];
  const distinctScenes = [
    ...new Set(occurrences.map(({ section }) => section.key)),
  ];
  const distinctSceneTexts = [
    ...new Set(
      occurrences.map(({ section }) =>
        section.lines.map((line) => line.ko).join("\n"),
      ),
    ),
  ];
  const days = [
    ...new Set(occurrences.map(({ lesson }) => ordinal(lesson))),
  ].sort((a, b) => a - b);
  const gaps = days.slice(1).map((day, index) => day - days[index]);
  const dictionaryTexts = new Set(
    (usage[ko] ?? []).flatMap((sense) => [
      ...sense.sentences,
      ...sense.conversation,
    ]),
  );
  const candidates = spellingCandidates.get(ko) ?? [];
  return {
    ko,
    zh: glossary.get(ko)?.zh ?? "",
    level: glossary.get(ko)?.level,
    scheduledLessonId: scheduled.id,
    coverageStatus: occurrences.length
      ? "linked-course-occurrence"
      : candidates.length
        ? "unlinked-spelling-candidate-needs-review"
        : "no-linked-or-spelling-evidence-needs-corpus-or-morphology-review",
    originalLines: occurrences.length,
    distinctKoreanTexts: new Set(occurrences.map(({ line }) => line.ko)).size,
    originalSceneIds: distinctScenes,
    distinctSceneTexts: distinctSceneTexts.length,
    originalStudyDays: days,
    nextNewSceneGapDays: gaps[0] ?? null,
    longestNewSceneGapDays: gaps.length ? Math.max(...gaps) : null,
    hasNewSceneAtLeast7DaysAfterFirst: days.some((day) => day - days[0] >= 7),
    scheduledDayLinked: occurrences.some(
      ({ lesson }) => lesson.id === scheduled.id,
    ),
    courseContextIndexLinked: !!contexts[ko]?.length,
    originalExamples: occurrences
      .slice(0, 3)
      .map(({ lesson, section, line }) => ({
        lessonId: lesson.id,
        sceneId: section.key,
        lineId: line.id,
        ko: line.ko,
        zh: line.zh,
      })),
    scheduledReviewExposureDays: [...(reviewExposure.get(ko) ?? [])].sort(
      (a, b) => a - b,
    ),
    dictionaryExampleTexts: dictionaryTexts.size,
    spellingCandidates: candidates,
  };
});
const totals = {
  weeks: 26,
  days: lessons.length,
  reviewOnlyDays: lessons.filter((lesson) => lesson.day === 7).length,
  originalSections: scenes.length,
  originalSceneSections: scenes.filter(
    ({ section }) => section.kind !== "sentence",
  ).length,
  originalLines: originals.size,
  authoredOriginalLinesMatched: authoredLines.size,
  distinctKoreanTexts: seenTexts.size,
  scheduledReviewLineExposures: reviewLineExposures,
  mainScheduledWords: mainSchedule.size,
  allDictionaryHeadwords: vocabulary.length,
  linkedCourseHeadwords: wordOccurrences.size,
  linkedMainWords: words.filter((word) => word.originalLines > 0).length,
  missingMainCourseLinks: missingWords.length,
  missingMainWordsWithSpellingCandidates: words.filter(
    (word) => !word.originalLines && word.spellingCandidates.length,
  ).length,
  missingMainWordsWithoutSpellingCandidates: words.filter(
    (word) => !word.originalLines && !word.spellingCandidates.length,
  ).length,
  linkedWordsMissingContextIndex: words.filter(
    (word) => word.originalLines && !word.courseContextIndexLinked,
  ).length,
  sameScheduledDayMainWords: words.filter((word) => word.scheduledDayLinked)
    .length,
  mainWordsWithTwoDifferentNewSceneTexts: words.filter(
    (word) => word.distinctSceneTexts >= 2,
  ).length,
  mainWordsWithThreeDifferentNewSceneTexts: words.filter(
    (word) => word.distinctSceneTexts >= 3,
  ).length,
  mainWordsWithNewSceneAtLeast7DaysAfterFirst: words.filter(
    (word) => word.hasNewSceneAtLeast7DaysAfterFirst,
  ).length,
  medianNextNewSceneGapDaysForRecurringMainWords: median(
    words.flatMap((word) =>
      word.nextNewSceneGapDays === null ? [] : [word.nextNewSceneGapDays],
    ),
  ),
  annotations: {
    linked: tokensLinked,
    ambiguous: tokensAmbiguous,
    unlinked: tokensUnlinked,
  },
};
const postCourse = {
  scope:
    "Actual authored scenes after the fixed 26-week main course; no empty extension days or copied reviews count as new material.",
  lessonCount: postLessons.length,
  publishedLessonCountIncludingMain: lessons.length + postLessons.length,
  lessonIds: postLessons.map((lesson) => lesson.id),
  originalStudyDays: postLessons.map(ordinal),
  originalSections: scenes.filter(({ lesson }) => lesson.week > 26).length,
  originalLines: [...originals.values()].filter(
    ({ lesson }) => lesson.week > 26,
  ).length,
  mainCourseOriginalSections: scenes.filter(({ lesson }) => lesson.week <= 26)
    .length,
  mainCourseOriginalLines: [...originals.values()].filter(
    ({ lesson }) => lesson.week <= 26,
  ).length,
};
// Freeze explicit authored targets separately from the remaining whole-course
// gaps. This checks real linked new scenes, never copied reviews/dictionary use.
const targetReview = read<{
  schemaVersion: number;
  independentNativeSpeakerReview: boolean;
  batches: {
    id: string;
    sourceFile: string;
    minimumSourceScenes: number;
    words: string[];
  }[];
}>("data/curriculum/dialogue-target-review.json");
assert.equal(targetReview.schemaVersion, 1);
assert.equal(targetReview.independentNativeSpeakerReview, false);
const currentSelection = read<{
  selected: {
    headword: string;
    firstScheduledLessonId: string;
    firstScheduledCourseDay: number;
    dictionarySense: unknown;
  }[];
}>("data/curriculum/round5-gap-target-selection.json");
const lateSelection = read<{
  targets: {
    headword: string;
    firstScheduledLessonId: string;
    firstScheduledCourseDay: number;
    dictionarySenses: unknown[];
    sceneEvidence: {
      lessonId: string;
      examples: {
        lineId: string;
        wordIndex: number;
        surface: string;
        ko: string;
        zh: string;
      }[];
    }[];
  }[];
}>("data/curriculum/round5-late-target-review.json");
const cGroups = [
  ["환자", "피부", "재채기"],
  ["세수", "코", "손수건"],
  ["아들", "딸", "조카"],
  ["아기", "장난감", "인형"],
  ["가위", "필통"],
  ["무릎", "손목", "손바닥"],
  ["머리카락", "양복", "반지"],
  ["대사관", "친척"],
  ["교수", "꿈", "옛날"],
  ["여러분", "문제점", "가리키다"],
  ["던지다", "흔들다"],
];
const dGroups = [
  ["자장면", "콜라", "인분", "얼음"],
  ["농구", "하늘", "구름"],
  ["극장", "미디어", "대중"],
  ["차리다", "당근", "마늘", "고구마"],
  ["된장", "참기름", "껍질"],
  ["숲", "파도", "땅", "섬"],
  ["국내", "해외", "각종"],
  ["과학", "혹은", "게다가"],
  ["금연", "밤중", "이외"],
];
assert.deepEqual(
  new Set([...cGroups.flat(), ...dGroups.flat()]),
  new Set(currentSelection.selected.map((target) => target.headword)),
  "C/D authorship must match the explicit 60 selected targets",
);
assert.equal(
  new Set([
    ...cGroups.flat(),
    ...dGroups.flat(),
    ...lateSelection.targets.map((target) => target.headword),
  ]).size,
  100,
);
const requiredPairs = new Map<string, number[]>();
cGroups.forEach((group, index) =>
  group.forEach((word) =>
    requiredPairs.set(`gap-expansion-c.json:${word}`, [index + 1, index + 12]),
  ),
);
dGroups.forEach((group, index) =>
  group.forEach((word) =>
    requiredPairs.set(`gap-expansion-d.json:${word}`, [
      index * 2 + 1,
      index * 2 + 2,
    ]),
  ),
);
const addedBatches = [
  {
    id: "round5-gap-c",
    sourceFile: "gap-expansion-c.json",
    minimumSourceScenes: 2,
    words: cGroups.flat(),
  },
  {
    id: "round5-gap-d",
    sourceFile: "gap-expansion-d.json",
    minimumSourceScenes: 2,
    words: dGroups.flat(),
  },
  {
    id: "round5-gap-e-post-course",
    sourceFile: "gap-expansion-e.json",
    minimumSourceScenes: 2,
    words: lateSelection.targets.map((target) => target.headword),
  },
];
const reviewedTargetBatches = [
  ...targetReview.batches,
  ...addedBatches.filter(
    (batch) =>
      !targetReview.batches.some((old) => old.sourceFile === batch.sourceFile),
  ),
].map((batch) => {
  assert(immersionSourceFiles.includes(batch.sourceFile));
  assert.equal(new Set(batch.words).size, batch.words.length);
  const targets = batch.words.map((ko) => {
    const evidence = words.find((word) => word.ko === ko);
    assert(evidence, `Unknown authored target: ${ko}`);
    const sourceOccurrences = (wordOccurrences.get(ko) ?? []).filter(
      ({ line }) =>
        line.id.includes(`-${batch.sourceFile.replace(/\.json$/, "")}-`),
    );
    const sourceSceneIds = [
      ...new Set(sourceOccurrences.map(({ section }) => section.key)),
    ];
    const pair = requiredPairs.get(`${batch.sourceFile}:${ko}`);
    let requiredNewScenePair:
      | {
          lessonId: string;
          sceneId: string;
          firstLineId: string;
          courseDay: number;
          scene: string;
        }[]
      | undefined;
    if (pair) {
      const assets = read<SourceAsset[]>(`data/immersion/${batch.sourceFile}`);
      requiredNewScenePair = pair.map((assetIndex) => {
        const asset = assets[assetIndex - 1];
        const firstLineId = `${asset.lessonId}-${batch.sourceFile.replace(/\.json$/, "")}-${assetIndex}-1`;
        const original = originals.get(firstLineId);
        assert(
          original,
          `Explicit target pair source disappeared: ${firstLineId}`,
        );
        assert(
          sourceOccurrences.some(({ section }) => section === original.section),
          `Assigned scene lost target ${ko}: ${firstLineId}`,
        );
        return {
          lessonId: original.lesson.id,
          sceneId: original.section.key,
          firstLineId,
          courseDay: ordinal(original.lesson),
          scene: original.section.scene,
        };
      });
      assert(
        requiredNewScenePair[1].courseDay - requiredNewScenePair[0].courseDay >=
          7,
        `Assigned pair lacks seven-day gap: ${ko}`,
      );
      assert.notEqual(
        requiredNewScenePair[0].scene,
        requiredNewScenePair[1].scene,
        `Assigned pair repeats its situation: ${ko}`,
      );
      const selected = currentSelection.selected.find(
        (target) => target.headword === ko,
      )!;
      assert.equal(mainSchedule.get(ko)!.id, selected.firstScheduledLessonId);
      assert.equal(
        ordinal(mainSchedule.get(ko)!),
        selected.firstScheduledCourseDay,
      );
    }
    if (batch.sourceFile === "gap-expansion-e.json") {
      const selected = lateSelection.targets.find(
        (target) => target.headword === ko,
      )!;
      assert.equal(mainSchedule.get(ko)!.id, selected.firstScheduledLessonId);
      assert.equal(
        ordinal(mainSchedule.get(ko)!),
        selected.firstScheduledCourseDay,
      );
      assert.equal(selected.sceneEvidence.length, 2);
      assert(
        selected.sceneEvidence.some((scene) =>
          postMetadata.some((lesson) => lesson.id === scene.lessonId),
        ),
        `Late target second scene must be in the published post-course catalog: ${ko}`,
      );
      for (const scene of selected.sceneEvidence)
        for (const example of scene.examples) {
          const original = originals.get(example.lineId);
          assert(original && original.lesson.id === scene.lessonId);
          assert(example.lineId.includes("-gap-expansion-e-"));
          assert.equal(original.line.ko, example.ko);
          assert.equal(original.line.zh, example.zh);
          const word = original.line.words[example.wordIndex];
          assert.equal(word.text, example.surface);
          assert(
            word.annotation?.status === "linked" && word.lemmas?.includes(ko),
            `Late target exact lemma evidence changed: ${example.lineId}`,
          );
        }
    }
    assert(
      sourceSceneIds.length >= batch.minimumSourceScenes,
      `Authored source lost target ${ko}: ${batch.sourceFile}`,
    );
    if (
      batch.sourceFile.startsWith("daily-life-expansion-") ||
      batch.sourceFile.startsWith("gap-expansion-")
    ) {
      const scheduled = mainSchedule.get(ko)!;
      assert(
        sourceOccurrences.every(({ lesson }) => lesson.day !== 7),
        `Authored target must not be placed on a review-only day: ${ko}`,
      );
      assert(
        sourceOccurrences.every(
          ({ lesson }) => ordinal(lesson) >= ordinal(scheduled),
        ),
        `New basic scene introduced ${ko} before its planned vocabulary date`,
      );
      const days = [
        ...new Set(sourceOccurrences.map(({ lesson }) => ordinal(lesson))),
      ].sort((a, b) => a - b);
      assert(
        days.some((day) => day - days[0] >= 7),
        `New basic target lacks its own spaced scene: ${ko}`,
      );
      assert(
        new Set(
          sourceOccurrences.map(({ section }) =>
            section.lines.map((line) => line.ko).join("\n"),
          ),
        ).size >= 2,
      );
    }
    assert(
      evidence.distinctSceneTexts >= 2 &&
        evidence.hasNewSceneAtLeast7DaysAfterFirst,
      `Authored target needs two distinct new scenes at least seven days apart: ${ko}`,
    );
    return {
      ko,
      sourceSceneIds,
      sourceLineIds: sourceOccurrences.map(({ line }) => line.id),
      sourceOriginalStudyDays: [
        ...new Set(sourceOccurrences.map(({ lesson }) => ordinal(lesson))),
      ].sort((a, b) => a - b),
      ...(requiredNewScenePair ? { requiredNewScenePair } : {}),
      ...(batch.sourceFile === "gap-expansion-e.json"
        ? {
            selectionManifest: "data/curriculum/round5-late-target-review.json",
          }
        : pair
          ? {
              selectionManifest:
                "data/curriculum/round5-gap-target-selection.json",
            }
          : {}),
      differentNewSceneTexts: evidence.distinctSceneTexts,
      originalStudyDays: evidence.originalStudyDays,
      hasNewSceneAtLeast7DaysAfterFirst:
        evidence.hasNewSceneAtLeast7DaysAfterFirst,
    };
  });
  return { ...batch, targets };
});
const reviewedFormAliases = [
  ...indexRepair.aliases,
  ...nextIndexRepair.aliases,
].map((decision) => {
  const original = originals.get(decision.lineId)!.line;
  assert.equal(original.ko, decision.ko);
  const word = original.words[decision.wordIndex];
  assert.equal(word.text, decision.surface);
  assert.equal(word.annotation?.status, "linked");
  assert(word.lemmas?.includes(decision.headword));
  assert.equal(word.note, decision.note);
  assert.deepEqual(
    word.lemmas,
    decision.action === "replace"
      ? [decision.headword]
      : [...decision.originalLemmas, decision.headword],
  );
  return {
    lineId: decision.lineId,
    wordIndex: decision.wordIndex,
    headword: decision.headword,
    surface: word.text,
    lemmas: word.lemmas,
  };
});
for (const decision of nextIndexRepair.unlisted) {
  const original = originals.get(decision.lineId)!.line;
  assert.equal(original.ko, decision.ko);
  const word = original.words[decision.wordIndex];
  assert.equal(word.text, decision.surface);
  assert.deepEqual(word.lemmas, []);
  assert.equal(word.annotation?.status, "unlinked");
  assert.equal(word.note, decision.note);
}
const stageMetrics = phases.map(([from, to]) => {
  const stageScenes = scenes.filter(
    ({ lesson }) => lesson.week >= from && lesson.week <= to,
  );
  const stageLines = stageScenes.flatMap(({ section }) => section.lines);
  const stageWords = words.filter((word) => {
    const week = Number(word.scheduledLessonId.slice(1, 3));
    return week >= from && week <= to;
  });
  return {
    weeks: `${from}-${to}`,
    originalLines: stageLines.length,
    distinctKoreanTexts: new Set(stageLines.map((line) => line.ko)).size,
    meanKoreanCharactersPerLine: mean(
      stageLines.map((line) => [...line.ko].length),
    ),
    medianKoreanCharactersPerLine: median(
      stageLines.map((line) => [...line.ko].length),
    ),
    meanKoreanEojeolPerLine: mean(
      stageLines.map((line) => line.ko.split(/\s+/).length),
    ),
    meanOriginalSceneCharacters: mean(
      stageScenes
        .filter(({ section }) => section.kind !== "sentence")
        .map(
          ({ section }) =>
            [...section.lines.map((line) => line.ko).join(" ")].length,
        ),
    ),
    passages: stageScenes.filter(({ section }) => section.kind === "passage")
      .length,
    mainScheduledWords: stageWords.length,
    linkedMainWordsAnywhereInCourse: stageWords.filter(
      (word) => word.originalLines,
    ).length,
    missingMainCourseLinks: stageWords.filter((word) => !word.originalLines)
      .length,
    sameScheduledDayMainWords: stageWords.filter(
      (word) => word.scheduledDayLinked,
    ).length,
    wordsWithTwoDifferentNewSceneTexts: stageWords.filter(
      (word) => word.distinctSceneTexts >= 2,
    ).length,
    wordsWithNewSceneAtLeast7DaysAfterFirst: stageWords.filter(
      (word) => word.hasNewSceneAtLeast7DaysAfterFirst,
    ).length,
  };
});
const report = {
  schemaVersion: 1,
  scope:
    "All 26 main-course weeks plus explicitly published post-course scenes. Main-course weeks/days remain 26/182. New lines deduplicated by stable IDs; copied review exposure counted separately. Linked lemmas are machine evidence of headword use, not proof of sense correctness or learning mastery.",
  independentNativeSpeakerReview: false,
  lexicalCoverageComplete: totals.missingMainCourseLinks === 0,
  sourceHashes: Object.fromEntries(
    [
      ...weekFiles,
      ...postWeekFiles,
      "data/immersion-post-course-index.json",
      "data/immersion-post-course-context.json",
      "scripts/post-course-lessons.ts",
      "lib/dialogue-section-key.ts",
      "lib/dialogue-practice-keys.ts",
      "data/curriculum/dialogues.json",
      "data/curriculum/index-link-review.json",
      "data/curriculum/dialogue-context-review.json",
      "data/curriculum/context-sense-review.json",
      "data/curriculum/round5-context-sense-review.json",
      "data/curriculum/round5-new-material-context-senses.json",
      "data/curriculum/gap-target-selection.json",
      "data/curriculum/round5-gap-target-selection.json",
      "data/curriculum/round5-late-target-review.json",
      "lib/dialogue-context-sense.ts",
      "data/curriculum/round4-index-decisions.json",
      "data/curriculum/round5-index-decisions.json",
      "data/curriculum/missing-candidate-review.json",
      ...immersionSourceFiles.map((file) => `data/immersion/${file}`),
      "data/vocabulary.json",
      "data/immersion-context.json",
      "data/vocabulary-usage.json",
      "data/depth-vocabulary-examples.json",
      "data/course-depth-statistics.json",
      "data/intensive-course.ts",
      "scripts/annotate-immersion.py",
      "scripts/build-immersion.ts",
      "scripts/build-depth-statistics.mjs",
      "data/curriculum/annotation-regression-samples.json",
      "data/curriculum/dialogue-target-review.json",
    ].map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(resolve(root, file)))
        .digest("hex"),
    ]),
  ),
  totals,
  postCourse,
  stageMetrics,
  reviewedTargetBatches,
  reviewedPhraseLinks,
  reviewedSceneContexts,
  reviewedContextSenses,
  reviewedNewMaterialContextSenses,
  reviewedFormAliases,
  repeatedNewKoreanTexts: [...seenTexts]
    .filter(([, ids]) => ids.length > 1)
    .map(([ko, lineIds]) => ({ ko, lineIds })),
  missingMainCourseWords: missingWords,
  indexLinkFailures: brokenContextLinks,
  intensiveTraining: intensiveWeeks.map((week) => ({
    week: week.week,
    readingCharacters: [...week.reading.ko].length,
    readingQuestions: week.reading.questions.length,
    writingMin: week.writing.min,
    writingMax: week.writing.max,
    writingPrompt: week.writing.prompt,
  })),
  words,
  limitations: [
    "Surface candidates require manual contextual/morphological verification; missing candidates do not prove textual absence because Korean inflection, spacing and compounds are not exhaustively recognised.",
    "Course context index links can expose index omissions; dictionary examples never count as original course lines or new scenes.",
    "A scene is one published original section; adjacent sections may share a topic, so distinct scenes do not guarantee semantic diversity.",
    "Length and coverage metrics do not establish grammatical progression, translation accuracy, naturalness, actual retention or TOPIK readiness.",
    "No independent native Korean teacher has reviewed the entire corpus. The companion Markdown report documents a limited agent-assisted sample review.",
    "Scheduled review exposure is a curriculum opportunity, not evidence that a learner listened, recalled or mastered the material.",
  ],
};
const output = `${JSON.stringify(report, null, 2)}\n`;
const target = resolve(root, "data/dialogue-learning-audit.json");
if (process.argv.includes("--write")) writeFileSync(target, output);
if (process.argv.includes("--check"))
  assert.equal(
    readFileSync(target, "utf8"),
    output,
    "Audit evidence is stale: rerun with --write after changing course sources",
  );
console.log(
  JSON.stringify(
    {
      structuralChecks: "passed",
      lexicalCoverageComplete: report.lexicalCoverageComplete,
      totals,
      stageMetrics,
    },
    null,
    2,
  ),
);
