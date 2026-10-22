import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import regressionSamples from "../data/curriculum/annotation-regression-samples.json";
import type { ImmersionLesson } from "../lib/immersion-types";
const lessons: ImmersionLesson[] = Array.from({ length: 26 }, (_, index) =>
  JSON.parse(
    fs.readFileSync(
      `public/immersion/week-${String(index + 1).padStart(2, "0")}.json`,
      "utf8",
    ),
  ),
).flat();
const originalLines = lessons.flatMap((lesson) =>
  lesson.sections
    .filter((section) => !section.review)
    .flatMap((section) => section.lines),
);
// Expected roots are agent-assisted regression samples independent from the
// generator's morphology and occurrence-count implementation. They deliberately
// include contrasting readings of 사는 and legacy-format foundation tokens.
for (const sample of regressionSamples.cases) {
  test(`context/root regression: ${sample.lineId} ${sample.token}`, () => {
    const line = originalLines.find((item) => item.id === sample.lineId);
    assert(line, `Regression source disappeared: ${sample.lineId}`);
    const tokens = line.words.filter((word) => word.text === sample.token);
    assert(tokens.length > 0, `Regression token disappeared: ${sample.lineId}`);
    for (const token of tokens) {
      assert.deepEqual(token.lemmas, sample.expectedLemmas);
      assert.equal(token.annotation?.status, "linked");
      for (const forbidden of sample.forbiddenLemmas ?? [])
        assert(!token.lemmas?.includes(forbidden));
      if (sample.expectedMeaningIncludes)
        assert(token.meaning.includes(sample.expectedMeaningIncludes));
    }
  });
}
for (const sample of regressionSamples.lessonCases) {
  test(`independent lesson word coverage regression: ${sample.lessonId}`, () => {
    const lesson = lessons.find((item) => item.id === sample.lessonId);
    assert(lesson);
    for (const word of sample.expectedSceneVocabulary)
      assert(lesson.sceneVocabulary.includes(word), `Missing ${word}`);
  });
}
for (const sample of regressionSamples.speakerCases) {
  test(`scene role continuity: ${sample.lineId}`, () => {
    const line = originalLines.find((item) => item.id === sample.lineId);
    assert(line, `Regression source disappeared: ${sample.lineId}`);
    assert.equal(line.speaker, sample.expectedSpeaker, sample.reason);
  });
}
test("machine corrections never claim independent native-speaker review", () => {
  assert.equal(
    regressionSamples.provenance.independentNativeSpeakerReview,
    false,
  );
  const statistics = JSON.parse(
    fs.readFileSync("data/course-annotation-statistics.json", "utf8"),
  );
  assert.equal(statistics.independentNativeSpeakerReview, false);
});
