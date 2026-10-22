import assert from "node:assert/strict";
import fs from "node:fs";
import metadata from "../data/immersion-index.json";
import statistics from "../data/immersion-statistics.json";
import words from "../data/vocabulary.json";
import contexts from "../data/immersion-context.json";
import type { ImmersionLesson } from "../lib/immersion-types";
const all: ImmersionLesson[] = Array.from({ length: 26 }, (_, i) =>
  JSON.parse(
    fs.readFileSync(
      `public/immersion/week-${String(i + 1).padStart(2, "0")}.json`,
      "utf8",
    ),
  ),
).flat();
assert.deepEqual(
  JSON.parse(fs.readFileSync("data/immersion-client-index.json", "utf8")),
  metadata.map(({ reviewVocabulary, ...lesson }) => ({
    ...lesson,
    reviewVocabularyCount: reviewVocabulary.length,
  })),
  "Lightweight lesson index must preserve metadata and review counts",
);
for (let week = 1; week <= 26; week++)
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        `public/immersion/review-week-${String(week).padStart(2, "0")}.json`,
        "utf8",
      ),
    ),
    all
      .filter((lesson) => lesson.week === week)
      .map(({ id, reviewVocabulary }) => ({ id, reviewVocabulary })),
    "Review-only week assets must match the full course",
  );
assert.equal(all.length, 182);
const valid = new Set(words.map((w) => w.ko)),
  main = all.flatMap((l) => l.vocabulary);
assert.equal(main.length, 4980);
assert.equal(new Set(main).size, 4980);
assert(main.every((w) => valid.has(w)));
const originals = all.flatMap((l) => l.sections.filter((s) => !s.review));
const lines = originals.flatMap((s) => s.lines),
  byId = new Map(lines.map((l) => [l.id, l]));
assert.equal(byId.size, lines.length, "New material has globally unique IDs");
const distinct = new Set(lines.map((l) => l.ko)).size;
assert(distinct >= 5000, "At least 5,000 distinct authored lines are required");
assert.equal(distinct, statistics.distinctLines);
assert(
  distinct / lines.length > 0.98,
  "Review repetitions cannot inflate new content",
);
for (const [i, l] of all.entries()) {
  assert.equal(l.id, metadata[i].id);
  assert.equal(l.day, (i % 7) + 1);
  assert.equal(l.week, Math.floor(i / 7) + 1);
  const publishedMetadata = Object.fromEntries(
    Object.entries(l).filter(([key]) => key !== "sections"),
  );
  assert.deepEqual(
    metadata[i],
    publishedMetadata,
    `Published week/index mismatch: ${l.id}`,
  );
  assert(l.sections.length > 0);
  assert.equal(
    l.newLines,
    l.sections.filter((s) => !s.review).reduce((n, s) => n + s.lines.length, 0),
  );
  assert.equal(
    l.reviewLines,
    l.sections.filter((s) => s.review).reduce((n, s) => n + s.lines.length, 0),
  );
  assert.equal(
    l.vocabulary.length,
    l.day === 7
      ? 0
      : l.week <= 2
        ? 10
        : l.week <= 6
          ? 25
          : l.week <= 12
            ? 30
            : l.week <= 18
              ? 35
              : 40,
  );
  const actualWords = new Set(
    l.sections
      .filter((s) => !s.review)
      .flatMap((s) =>
        s.lines.flatMap((x) =>
          x.words.flatMap((w) =>
            w.annotation?.status === "linked" ? (w.lemmas ?? []) : [],
          ),
        ),
      ),
  );
  assert.deepEqual(
    l.sceneVocabulary,
    l.vocabulary.filter((w) => actualWords.has(w)),
    "Course word labels must reflect actual new sentences",
  );
  if (l.day === 7) assert(l.sections.every((s) => s.review));
  if (l.week >= 7 && l.day <= 5) assert(l.newLines >= 30);
  if (l.week >= 13 && l.day <= 5) assert(l.newLines >= 40);
  if (l.week >= 20 && l.day <= 5) assert(l.newLines >= 45);
  for (const s of l.sections) {
    if (s.review)
      assert(
        s.source.week < l.week ||
          (s.source.week === l.week && s.source.day < l.day),
      );
    assert(
      s.lines.every((x) => byId.has(x.id)),
      "Every review comes from an actual complete source",
    );
    for (const line of s.lines) {
      assert(/[가-힣]/.test(line.ko) && /[\u4e00-\u9fff]/.test(line.zh));
      assert(line.ko.length <= 240, `Speech limit: ${line.id}`);
      assert(!/TODO|待补|MISSING|\{\{/.test(line.ko + line.zh));
      assert.equal(line.words.map((w) => w.text).join(" "), line.ko);
      for (const word of line.words) {
        assert(
          word.lemmas && word.annotation,
          `Missing canonical annotation: ${line.id}`,
        );
        assert.equal(
          word.base,
          word.lemmas.join(" · "),
          `Legacy base mismatch: ${line.id}`,
        );
        assert(
          word.lemmas.every((base) => valid.has(base)),
          `Unknown lemma: ${line.id}`,
        );
        assert.equal(new Set(word.lemmas).size, word.lemmas.length);
        if (word.annotation.status !== "linked")
          assert.equal(
            word.lemmas.length,
            0,
            `Uncertain word was counted: ${line.id}`,
          );
        if (word.annotation.status === "ambiguous")
          assert.equal(
            word.meaning,
            "",
            `Guessed ambiguous meaning: ${line.id}`,
          );
      }
    }
  }
  if (l.week >= 20 && l.day <= 6) {
    const runs = l.sections
      .filter((s) => !s.review)
      .map((s) => {
        let max = 0,
          run = 0,
          last = "";
        for (const x of s.lines) {
          run = x.speaker === last ? run + 1 : 1;
          last = x.speaker;
          max = Math.max(max, run);
        }
        return max;
      });
    assert(
      Math.max(...runs) >= 15,
      "Advanced lesson needs a sustained speaker passage",
    );
  }
}
for (const [ko, examples] of Object.entries(contexts)) {
  assert(valid.has(ko));
  assert(new Set(examples.map((e) => e.ko)).size === examples.length);
  for (const e of examples) {
    const source = all.find((l) => l.id === e.lessonId);
    assert(
      source?.sections.some(
        (s) =>
          !s.review &&
          s.lines.some(
            (l) =>
              l.id === e.lineId &&
              l.ko === e.ko &&
              l.zh === e.zh &&
              l.words.some(
                (word) =>
                  word.annotation?.status === "linked" &&
                  word.lemmas?.includes(ko),
              ),
          ),
      ),
      `Context link ${ko}`,
    );
  }
}
const mainSet = new Set(main),
  linkedMain = [...mainSet].filter(
    (word) => (contexts as Record<string, unknown>)[word],
  ).length;
const sameDaySceneWords = all.reduce(
  (sum, l) => sum + l.sceneVocabulary.length,
  0,
);
const scheduleStats = JSON.parse(
  fs.readFileSync("data/immersion-word-schedule.stats.json", "utf8"),
) as {
  sameDaySceneWords: number;
  wordsWithAnyScene: number;
  weeks: {
    week: number;
    sameDaySceneWords: number;
  }[];
};
assert.equal(statistics.sameDaySceneWords, sameDaySceneWords);
assert.equal(statistics.wordsWithCourseContexts, Object.keys(contexts).length);
assert.equal(statistics.mainWordsWithCourseContexts, linkedMain);
assert.equal(
  statistics.mainWordsWithoutCourseContextLinks,
  mainSet.size - linkedMain,
);
assert.equal(scheduleStats.sameDaySceneWords, sameDaySceneWords);
assert.equal(scheduleStats.wordsWithAnyScene, linkedMain);
for (const week of scheduleStats.weeks)
  assert.equal(
    week.sameDaySceneWords,
    all
      .filter((l) => l.week === week.week)
      .reduce((sum, l) => sum + l.sceneVocabulary.length, 0),
  );
assert.equal(statistics.independentNativeSpeakerReview, false);
// Compare full scene text, excluding labelled reviews. High similarity catches
// swapped-name/date templates that exact sentence deduplication misses.
const grams = (s: string) => {
  s = s.replace(/[\s.,!?\d]/g, "");
  return new Set(
    Array.from({ length: Math.max(0, s.length - 2) }, (_, i) =>
      s.slice(i, i + 3),
    ),
  );
};
const bags = originals.map((s) => grams(s.lines.map((l) => l.ko).join(" ")));
let closest = 0,
  pair = "";
for (let i = 0; i < bags.length; i++)
  for (let j = i + 1; j < bags.length; j++) {
    const a = bags[i],
      b = bags[j],
      intersection = [...a].filter((g) => b.has(g)).length,
      score = intersection / (a.size + b.size - intersection);
    if (score > closest) {
      closest = score;
      pair = `${originals[i].source.id}/${originals[j].source.id}`;
    }
    assert(score < 0.55, `Scene template similarity ${i}/${j}: ${score}`);
  }
console.log(
  JSON.stringify(
    {
      days: all.length,
      mainWords: main.length,
      expansionWords: words.length - main.length,
      newLines: lines.length,
      distinctLines: distinct,
      scenes: originals.length,
      wordsWithContexts: Object.keys(contexts).length,
      closestScenePair: { pair, similarity: closest },
    },
    null,
    2,
  ),
);
