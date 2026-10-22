import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dialogues, lessons } from "../data/course";
import words from "../data/vocabulary.json";
import statistics from "../data/curriculum/statistics.json";
import { intensiveWeeks } from "../data/intensive-course";
import examples from "../data/vocabulary-context.json";
assert.equal(dialogues.length, 156, "26 weeks × 6 substantive dialogues");
assert.equal(lessons.length, 182, "26 complete seven-day weeks");
assert.equal(new Set(dialogues.map((d) => d.id)).size, 156);
assert.equal(new Set(dialogues.map((d) => d.title)).size, 156);
assert.equal(
  new Set(words.map((w) => w.ko)).size,
  words.length,
  "Homonyms/inflections must not inflate headword count",
);
assert(words.length >= 6000, "Retain the extended vocabulary coverage");
const assigned = dialogues.flatMap((d) => d.vocabulary);
assert.equal(assigned.length, words.length);
assert.equal(
  new Set(assigned).size,
  words.length,
  "Every word gets one introduction date",
);
const dictionary = new Map(words.map((w) => [w.ko, w]));
const coverage = JSON.parse(
  readFileSync(
    new URL("../data/curriculum/lexical-coverage.json", import.meta.url),
    "utf8",
  ),
) as {
  firstUse: Record<string, string>;
};
for (const [ko, firstLesson] of Object.entries(coverage.firstUse)) {
  const entry = dictionary.get(ko);
  assert(entry, `Unknown source lemma: ${ko}`);
  assert(
    dialogues
      .find((d) => d.id === firstLesson)
      ?.lines.some((line) =>
        line.words.some((word) => word.lemmas?.includes(ko)),
      ),
    `Missing canonical first source use: ${ko}`,
  );
}
const allLines = dialogues.flatMap((d) => d.lines);
const byId = new Map(allLines.map((l) => [l.id, l]));
assert.equal(byId.size, allLines.length);
for (const word of words) {
  assert(
    /^[가-힣 ]+$/.test(word.ko) && /[\u4e00-\u9fff]/.test(word.zh),
    `Invalid headword/gloss: ${word.ko}`,
  );
  assert(
    word.sourceIds.length > 0 || word.source === "edited",
    `No lexical provenance: ${word.ko}`,
  );
  if (word.level === 1)
    assert(
      Number(word.lessonId.slice(1, 3)) <= 6,
      `Foundation word scheduled too late: ${word.ko}`,
    );
}
for (const dialogue of dialogues) {
  assert(dialogue.lines.length >= 8 && dialogue.vocabulary.length > 0);
  assert(
    dialogue.vocabulary.every(
      (ko) => dictionary.get(ko)?.lessonId === dialogue.id,
    ),
  );
  for (const line of dialogue.lines) {
    assert(
      line.ko.length <= 240,
      `Speech request would be rejected: ${line.id}`,
    );
    assert(
      !/\{\{|\}\}|MISSING|TODO|待补/.test(line.ko + line.zh),
      `Unfinished content: ${line.id}`,
    );
    assert(
      /[가-힣]/.test(line.ko) && /[\u4e00-\u9fff]/.test(line.zh),
      `Missing translation: ${line.id}`,
    );
    assert.equal(
      line.words.map((w) => w.text).join(" "),
      line.ko,
      `Token alignment: ${line.id}`,
    );
    if (line.chunks)
      assert.equal(line.chunks.join(" "), line.ko, `Clause audio: ${line.id}`);
  }
}
for (const [i, lesson] of lessons.entries()) {
  assert.equal(lesson.week, Math.floor(i / 7) + 1);
  assert.equal(lesson.day, (i % 7) + 1);
  assert(lesson.sections.length > 0);
  assert.equal(
    new Set(lesson.lines.map((l) => l.id)).size,
    lesson.lines.length,
    `Duplicate sections: ${lesson.id}`,
  );
  for (const section of lesson.sections) {
    assert(section.lines.every((line) => byId.get(line.id) === line));
    if (section.review)
      assert(
        section.sources.every(
          (source) => source.week < lesson.week || source.day < lesson.day,
        ),
        "Only earlier material is review",
      );
  }
  if (lesson.day === 7) {
    assert.equal(lesson.vocabulary.length, 0);
    assert(lesson.sections.every((section) => section.review));
  }
  assert(
    lesson.reviewVocabulary.every(
      (ko) => dictionary.has(ko) && !lesson.vocabulary.includes(ko),
    ),
  );
}
// Catch slot-swapped near-duplicates, not merely identical lines. Compare each
// dialogue's Korean character trigrams with every other dialogue.
const normalize = (s: string) =>
  s.replace(/\d+/g, "#").replace(/[\s.,!?]/g, "");
const grams = (s: string) =>
  new Set(
    Array.from({ length: Math.max(0, s.length - 2) }, (_, i) =>
      s.slice(i, i + 3),
    ),
  );
const bags = dialogues.map((d) =>
  grams(normalize(d.lines.map((l) => l.ko).join(" "))),
);
let closest = { score: 0, a: "", b: "" };
for (let i = 0; i < dialogues.length; i++) {
  for (let j = i + 1; j < dialogues.length; j++) {
    const a = bags[i],
      b = bags[j];
    const intersection = [...a].filter((x) => b.has(x)).length;
    const score = intersection / (a.size + b.size - intersection);
    if (score > closest.score)
      closest = { score, a: dialogues[i].id, b: dialogues[j].id };
    assert(
      score < 0.48,
      `Possible template duplication ${dialogues[i].id}/${dialogues[j].id}: ${score}`,
    );
  }
}
const distinct = new Set(allLines.map((l) => l.ko)).size;
assert.equal(distinct, statistics.distinctTurns);
assert(distinct / allLines.length > 0.99);
const averageLength = (from: number, to: number) => {
  const lines = dialogues
    .filter((d) => d.week >= from && d.week <= to && d.day <= 5)
    .flatMap((d) => d.lines);
  return lines.reduce((sum, l) => sum + l.ko.length, 0) / lines.length;
};
assert(
  averageLength(19, 26) > averageLength(1, 6) * 2,
  "Advanced discourse must be substantively longer",
);
for (const [index, week] of intensiveWeeks.entries()) {
  assert.equal(week.week, index + 1);
  assert(
    week.grammar.every(
      (point) => point.explanation && point.ko && point.zh && point.caution,
    ),
  );
  assert(
    week.reading.questions.every(
      (question) => question.question && question.answer,
    ),
  );
  assert(
    week.writing.outline.length >= 3 && week.writing.min < week.writing.max,
  );
  assert(week.speaking && week.checkpoint && week.reading.zh);
  if (week.week >= 19) {
    assert(
      week.reading.ko.length >= 600,
      `Advanced reading too short in week ${week.week}`,
    );
    assert.equal(week.writing.min, 600);
    assert.equal(week.writing.max, 700);
  }
}
assert.equal(new Set(intensiveWeeks.map((week) => week.reading.ko)).size, 26);
assert.equal(statistics.vocabulary, words.length);
assert.equal(
  statistics.explainedGrammar,
  intensiveWeeks.flatMap((week) => week.grammar).length,
);
assert.equal(statistics.wordsWithExamples, Object.keys(examples).length);
for (const [ko, contexts] of Object.entries(examples)) {
  assert(dictionary.has(ko), `Example for unknown word: ${ko}`);
  for (const context of contexts) {
    const lesson = lessons.find((item) => item.id === context.lessonId);
    assert(lesson, `Broken example link: ${ko}`);
    if (context.source === "dialogue")
      assert(
        lesson.lines.some(
          (line) =>
            line.ko === context.ko &&
            line.zh === context.zh &&
            line.words.some(
              (word) =>
                word.annotation?.status === "linked" &&
                word.lemmas?.includes(ko),
            ),
        ),
        `Mismatched example/translation/lemma: ${ko}`,
      );
    else
      assert(
        intensiveWeeks[lesson.week - 1].reading.ko.includes(context.ko),
        `Missing reading example: ${ko}`,
      );
  }
}
assert(
  !dictionary.get("듣다")?.zh.includes("滴"),
  "Do not teach a rare homograph before the listening verb",
);
assert.equal(dictionary.get("계시다")?.lessonId, "w01d6");
console.log(
  JSON.stringify(
    {
      days: lessons.length,
      newDialogues: dialogues.length,
      headwords: words.length,
      introductionTurns: allLines.length,
      distinctTurns: distinct,
      reviewTurns: lessons.flatMap((l) =>
        l.sections.filter((s) => s.review).flatMap((s) => s.lines),
      ).length,
      closestPair: closest,
      meanKoreanTurnLength: {
        weeks1to6: averageLength(1, 6),
        weeks19to26: averageLength(19, 26),
      },
    },
    null,
    2,
  ),
);
