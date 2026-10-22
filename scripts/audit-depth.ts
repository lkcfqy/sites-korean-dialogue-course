import fs from "node:fs";
import assert from "node:assert/strict";
import metadata from "../data/immersion-index.json";
import words from "../data/vocabulary.json";
import usage from "../data/vocabulary-usage.json";
import contexts from "../data/immersion-context.json";
import paths from "../data/word-usage-paths.json";
import contextReview from "../data/curriculum/dialogue-context-review.json";
import type { UsageSense } from "../lib/vocabulary-usage-types";
import type { ImmersionLesson } from "../lib/immersion-types";
const byWord = usage as Record<string, UsageSense[]>;
const course = contexts as Record<
  string,
  {
    ko: string;
  }[]
>;
const main = new Set(metadata.flatMap((m) => m.vocabulary));
const examples = (ko: string) =>
  new Set([
    ...byWord[ko].flatMap((s) => [...s.sentences, ...s.conversation]),
    ...(course[ko] ?? []).map((c) => c.ko),
  ]);
assert.equal(Object.keys(byWord).length, words.length);
assert.deepEqual(
  JSON.parse(fs.readFileSync("data/vocabulary-client.json", "utf8")),
  words.map(({ ko, zh }) => ({ ko, zh })),
  "Lightweight client vocabulary must match the full source in original order",
);
for (const w of words) {
  assert(byWord[w.ko]?.length, "Every word needs useful usage");
  assert(examples(w.ko).size > 0, `Missing usage ${w.ko}`);
  if (main.has(w.ko))
    assert(
      examples(w.ko).size >= 3,
      `Fewer than three main-word contexts: ${w.ko}`,
    );
  for (const s of byWord[w.ko]) {
    assert(
      !s.sentenceZh || s.sentenceZh.length === s.sentences.length,
      `Translation alignment ${w.ko}`,
    );
    assert(
      [...s.phrases, ...s.sentences, ...s.conversation].every((ko) =>
        /[가-힣]/.test(ko),
      ),
      `Meaningful Korean usage ${w.ko}`,
    );
  }
  const file = (paths as Record<string, string>)[w.ko];
  assert(file?.startsWith("/word-usage/"));
  assert.deepEqual(
    JSON.parse(fs.readFileSync(`public${file}`, "utf8")).senses,
    byWord[w.ko],
    "The generated word asset must match its source",
  );
}
const lessons: ImmersionLesson[] = Array.from({ length: 26 }, (_, i) =>
  JSON.parse(
    fs.readFileSync(
      `public/immersion/week-${String(i + 1).padStart(2, "0")}.json`,
      "utf8",
    ),
  ),
).flat();
const originals = lessons.flatMap((l) => l.sections.filter((s) => !s.review));
const expressions = originals.filter((s) => s.kind === "sentence");
assert.equal(expressions.length, 130);
assert(
  expressions.every((s) => s.lines.length === 1 && s.lines[0].pattern?.form),
);
const passages = originals.filter((s) => s.kind === "passage");
const deepPassages = passages.filter((s) => s.lines[0].id.includes("-deep-"));
const bridges = passages.filter((s) =>
  s.lines[0].id.includes("-reading-bridges-"),
);
const legacyDecisions = contextReview.decisions.filter(
  (decision) => decision.kind === "passage",
);
const legacyIds = new Set(
  legacyDecisions.map((decision) => decision.firstLineId),
);
const legacyPassages = passages.filter((s) => legacyIds.has(s.lines[0].id));
assert.equal(
  deepPassages.length,
  48,
  "Retain all substantial advanced passages",
);
assert.equal(bridges.length, 5, "Five authored transitions before week 19");
assert.equal(legacyDecisions.length, 7, "Seven reviewed legacy solo readings");
assert.equal(legacyPassages.length, 7, "Reclassify all seven legacy readings");
assert.equal(
  passages.length,
  60,
  "48 deep, five bridges and seven legacy readings",
);
assert.equal(
  passages.length,
  deepPassages.length + bridges.length + legacyPassages.length,
);
for (const passage of legacyPassages) {
  const decision = legacyDecisions.find(
    (entry) => entry.firstLineId === passage.lines[0].id,
  )!;
  assert.equal(passage.contextNote, decision.note);
  assert.equal(passage.source.day, 6);
  assert(passage.source.week >= 20 && passage.source.week <= 26);
  assert.equal(passage.lines.length, 22);
  assert(
    passage.lines.every(
      (line) => line.speaker === "B" && line.register === "written",
    ),
    "Solo reports retain their reading voice and written register",
  );
}
const bridgeLessons = ["w16d2", "w16d5", "w17d1", "w18d3", "w18d5"];
const bridgeLineCounts = [6, 8, 10, 11, 12];
const bridgeSizes: number[] = [];
for (const [index, bridge] of bridges.entries()) {
  assert.equal(bridge.source.id, bridgeLessons[index]);
  assert.equal(bridge.lines.length, bridgeLineCounts[index]);
  assert(bridge.source.week >= 16 && bridge.source.week <= 18);
  assert(bridge.lines.every((line) => line.speaker === "B"));
  const syllables = (
    bridge.lines
      .map((line) => line.ko)
      .join("")
      .match(/[가-힣]/g) ?? []
  ).length;
  assert(
    syllables >= 200 && syllables < 900,
    "Bridge precedes full-length text",
  );
  assert(index === 0 || syllables > bridgeSizes[index - 1]);
  bridgeSizes.push(syllables);
  const paragraphs = bridge.lines.map((line) => line.paragraph);
  assert(paragraphs.every((n) => Number.isInteger(n) && n! >= 1));
  assert(new Set(paragraphs).size >= 2 && new Set(paragraphs).size <= 4);
  assert(paragraphs.every((n, i) => i === 0 || n! >= paragraphs[i - 1]!));
  assert(bridge.lines.every((line) => line.ko.length <= 240));
}
const sizes: number[] = [];
for (const lesson of lessons.filter((l) => l.week >= 19 && l.day <= 6)) {
  const p = lesson.sections.filter(
    (s) =>
      !s.review && s.kind === "passage" && s.lines[0].id.includes("-deep-"),
  );
  assert.equal(p.length, 1, `One deep passage per lesson: ${lesson.id}`);
  const dialogue = lesson.sections.filter(
    (s) =>
      !s.review && s.kind === "dialogue" && s.lines[0].id.includes("-deep-"),
  );
  assert.equal(dialogue.length, 1);
  assert(dialogue[0].lines.length >= 12 && dialogue[0].lines.length <= 16);
  const lines = p[0].lines,
    syllables = (
      lines
        .map((l) => l.ko)
        .join("")
        .match(/[가-힣]/g) ?? []
    ).length;
  sizes.push(syllables);
  assert(
    syllables >= 900 && syllables <= 1400,
    `Substantial passage ${lesson.id}: ${syllables}`,
  );
  const paragraphs = lines.map((l) => l.paragraph);
  assert(paragraphs.every((n) => Number.isInteger(n) && n! >= 1));
  assert(new Set(paragraphs).size >= 5 && new Set(paragraphs).size <= 6);
  assert(
    paragraphs.every((n, i) => i === 0 || n! >= paragraphs[i - 1]!),
    `Paragraph order ${lesson.id}`,
  );
  assert(lines.every((l) => l.ko.length <= 240));
}
// Keep all previously published stage line IDs and source text resolvable.
let position = 0;
for (const file of ["stage-1.json", "stage-2.json", "stage-3.json"])
  for (const asset of JSON.parse(
    fs.readFileSync(`data/immersion/${file}`, "utf8"),
  )) {
    position++;
    for (const [i, line] of asset.lines.entries())
      assert(
        originals.some((s) =>
          s.lines.some(
            (l) =>
              l.id === `${asset.lessonId}-immersion-${position}-${i + 1}` &&
              l.ko === line.ko,
          ),
        ),
        "Published stage links must stay stable",
      );
  }
const stats = {
  headwords: words.length,
  mainWords: main.size,
  mainWordsWithThreeContexts: [...main].filter((k) => examples(k).size >= 3)
    .length,
  wordSentenceAndDialogueContexts: words.reduce(
    (n, w) =>
      n +
      new Set(byWord[w.ko].flatMap((s) => [...s.sentences, ...s.conversation]))
        .size,
    0,
  ),
  globalDistinctWordExamples: new Set(
    words.flatMap((w) =>
      byWord[w.ko].flatMap((s) => [...s.sentences, ...s.conversation]),
    ),
  ).size,
  authoredBilingualExamples: Object.values(
    JSON.parse(
      fs.readFileSync("data/depth-vocabulary-examples.json", "utf8"),
    ) as Record<string, unknown[]>,
  ).reduce((n, v) => n + v.length, 0),
  expressionExamples: expressions.length,
  deepPassages: deepPassages.length,
  legacyReadingPassages: legacyPassages.length,
  totalReadingPassages: passages.length,
  minPassageHangul: Math.min(...sizes),
  maxPassageHangul: Math.max(...sizes),
  readingBridgePassages: bridges.length,
  minBridgeHangul: Math.min(...bridgeSizes),
  maxBridgeHangul: Math.max(...bridgeSizes),
};
assert.deepEqual(
  JSON.parse(fs.readFileSync("data/course-depth-statistics.json", "utf8")),
  stats,
  "Committed depth statistics must match generated content; rebuild rather than changing statistics during audit",
);
console.log(JSON.stringify(stats, null, 2));
