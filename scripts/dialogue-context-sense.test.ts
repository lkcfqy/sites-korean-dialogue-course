import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Line } from "../data/course";
import type { ImmersionLesson } from "../lib/immersion-types";
import {
  applyReviewedContextSense,
  type ContextSenseDecision,
} from "../lib/dialogue-context-sense";

const review = JSON.parse(
  readFileSync(
    new URL("../data/curriculum/context-sense-review.json", import.meta.url),
    "utf8",
  ),
) as { decisions: ContextSenseDecision[] };
const nextReview = JSON.parse(
  readFileSync(
    new URL(
      "../data/curriculum/round5-context-sense-review.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { decisions: ContextSenseDecision[] };
const newMaterialReview = JSON.parse(
  readFileSync(
    new URL(
      "../data/curriculum/round5-new-material-context-senses.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { decisions: ContextSenseDecision[] };
const allDecisions = [
  ...review.decisions,
  ...nextReview.decisions,
  ...newMaterialReview.decisions,
];
const originals = new Map<string, Line>();
const postCourse = JSON.parse(
  readFileSync(
    new URL("../data/immersion-post-course-index.json", import.meta.url),
    "utf8",
  ),
) as { week: number }[];
const publishedWeeks = new Set([
  ...Array.from({ length: 26 }, (_, index) => index + 1),
  ...postCourse.map((lesson) => lesson.week),
]);
for (const week of publishedWeeks) {
  const lessons = JSON.parse(
    readFileSync(
      new URL(
        `../public/immersion/week-${String(week).padStart(2, "0")}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as ImmersionLesson[];
  for (const lesson of lessons)
    for (const section of lesson.sections.filter((s) => !s.review))
      for (const line of section.lines) originals.set(line.id, line);
}

test("new scenes distinguish quantity, close distance, dryness and a measured deadline without transferring senses", () => {
  assert.equal(newMaterialReview.decisions.length, 8);
  for (const d of newMaterialReview.decisions) {
    const source = originals.get(d.lineId)!;
    assert.ok(source, d.lineId);
    assert.equal(
      source.words[d.wordIndex].contextSense?.meaning,
      d.contextMeaning,
    );
    for (const changed of [
      { ...source, id: `${source.id}-different` },
      { ...source, ko: `${source.ko} 다른 상황이에요.` },
    ])
      assert.equal(applyReviewedContextSense(changed, d), changed);
  }
  const meanings = (headword: string) =>
    newMaterialReview.decisions
      .filter((d) => d.headword === headword)
      .map((d) => d.contextMeaning);
  assert.match(meanings("상당하다")[0], /努力很多/);
  assert.match(meanings("상당하다")[1], /时间很多/);
  assert.match(meanings("바싹")[0], /紧贴/);
  assert.match(meanings("바싹")[1], /干透/);
  assert.ok(meanings("이내").every((meaning) => meaning.startsWith("以内")));
});

test("new contextual readings distinguish looking, trying and judgement and honorific location from ongoing action", () => {
  const meaning = (id: string) =>
    originals.get(id)!.words.find((w) => w.contextSense?.reviewedLineId === id)!
      .contextSense!.meaning;
  assert.match(meaning("w01d3-2"), /视线.*书/);
  assert.match(meaning("w07d5-6"), /试着/);
  assert.match(meaning("w20d4-deep-w19-22-19-7"), /认为/);
  assert.match(meaning("w02d2-immersion-6-4"), /照片/);
  assert.match(meaning("w18d5-recurrence-advanced-2-12"), /正在阅读/);
  assert.match(meaning("w11d1-immersion-53-8"), /不要靠近/);
  assert.equal(
    originals
      .get("w11d1-immersion-53-7")!
      .words.find((w) => w.text === "떨어져서")!.contextSense,
    undefined,
  );
});

test("all 38 added senses refuse another line, changed full sentence or another token of the same headword", () => {
  assert.equal(nextReview.decisions.length, 38);
  assert.equal(new Set(nextReview.decisions.map((d) => d.lineId)).size, 38);
  for (const d of nextReview.decisions) {
    const source = originals.get(d.lineId)!;
    for (const changed of [
      { ...source, id: `${source.id}-different` },
      { ...source, ko: `${source.ko} 다른 이야기예요.` },
    ]) {
      assert.equal(applyReviewedContextSense(changed, d), changed);
    }
    for (const changed of [
      { ...d, wordIndex: -1 },
      { ...d, surface: "다른말" },
      { ...d, headword: "다른말" },
    ]) {
      assert.equal(applyReviewedContextSense(source, changed), source);
    }
  }
});

test("all reviewed contexts match real source words while preserving text, components and dictionary meanings", () => {
  assert.ok(new Set(review.decisions.map((d) => d.lineId)).size >= 30);
  for (const decision of allDecisions) {
    const line = originals.get(decision.lineId)!;
    assert.ok(line, decision.lineId);
    const before = structuredClone(line);
    const result = applyReviewedContextSense(line, decision);
    assert.notEqual(result, line);
    assert.equal(result.ko, line.ko);
    assert.deepEqual(
      result.words.map((w) => w.text),
      line.words.map((w) => w.text),
    );
    const word = result.words[decision.wordIndex];
    assert.equal(word.meaning, decision.dictionaryMeaning);
    assert.deepEqual(word.lemmas, line.words[decision.wordIndex].lemmas);
    assert.equal(word.contextSense?.meaning, decision.contextMeaning);
    assert.deepEqual(line, before, "source object must not be mutated");
  }
});

test("changed line identity, full Korean context, surface, index or headword cannot inherit a reviewed sense", () => {
  const decision = review.decisions.find((d) => d.surface === "쓰세요.")!;
  const line = originals.get(decision.lineId)!;
  for (const changed of [
    { ...line, id: "w02d2-unreviewed-context" },
    { ...line, ko: line.ko.replace("안경", "글") },
    {
      ...line,
      words: line.words.map((w, i) =>
        i === decision.wordIndex ? { ...w, text: "쓰세요?" } : w,
      ),
    },
    {
      ...line,
      words: line.words.map((w, i) =>
        i === decision.wordIndex ? { ...w, lemmas: ["이다"] } : w,
      ),
    },
  ])
    assert.equal(applyReviewedContextSense(changed, decision), changed);
  assert.equal(
    applyReviewedContextSense(line, { ...decision, wordIndex: -1 }),
    line,
  );
  assert.equal(
    applyReviewedContextSense(line, {
      ...decision,
      wordIndex: decision.wordIndex + 1,
    }),
    line,
  );
  assert.equal(
    applyReviewedContextSense(line, { ...decision, lessonId: "w02d3" }),
    line,
  );
});

test("two occurrences of the same headword in one sentence retain different meanings and component boundaries", () => {
  const decision = review.decisions.find(
    (d) => d.lineId === "w09d3-immersion-43-16",
  )!;
  const line = originals.get(decision.lineId)!;
  const result = applyReviewedContextSense(line, decision);
  assert.equal(result.words[1].text, "쓰지");
  assert.deepEqual(result.words[1], line.words[1]);
  assert.equal(
    result.words[decision.wordIndex].contextSense?.meaning,
    "花钱；支出金钱",
  );
  assert.equal(
    applyReviewedContextSense(line, { ...decision, wordIndex: 1 }),
    line,
  );
});

test("real same-form examples do not inherit a different scene's reviewed meaning", () => {
  for (const [decisionId, counterpartId, surface] of [
    ["w02d2-immersion-6-7", "w01d4-8", "쓰세요."],
    ["w05d6-7", "w14d3-expression-scenes-68-1", "들어요."],
  ]) {
    const decision = review.decisions.find((d) => d.lineId === decisionId)!;
    const counterpart = originals.get(counterpartId)!;
    assert.ok(
      counterpart.words.some(
        (w) => w.text === surface && w.lemmas?.includes(decision.headword),
      ),
    );
    assert.equal(applyReviewedContextSense(counterpart, decision), counterpart);
  }
});

test("ambiguous or unlinked morphology stays unresolved rather than receiving an unrelated confirmed sense", () => {
  const decision = review.decisions[0];
  const original = originals.get(decision.lineId)!;
  for (const status of ["ambiguous", "unlinked"] as const) {
    const line = {
      ...original,
      words: original.words.map((w, i) =>
        i === decision.wordIndex
          ? {
              ...w,
              lemmas: [],
              annotation: {
                status,
                method: "morphology" as const,
                confidence: "uncertain" as const,
              },
            }
          : w,
      ),
    };
    assert.equal(applyReviewedContextSense(line, decision), line);
  }
});
