import { readFileSync, writeFileSync } from "node:fs";
import { intensiveWeeks } from "../data/intensive-course";
import type { Dialogue } from "../data/course";

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
const write = (name: string, value: unknown) =>
  writeFileSync(
    new URL(`../data/${name}`, import.meta.url),
    JSON.stringify(
      value,
      null,
      name.endsWith("lexicon-overrides.json") ? 2 : undefined,
    ) + "\n",
  );
type Entry = {
  ko: string;
  zh: string;
  level: number;
  source: string;
  sourceIds: string[];
  lessonId: string;
};
const dialogues = read<Dialogue[]>("curriculum/dialogues.json");
const words = read<Entry[]>("vocabulary.json");
const coverage = read<{
  firstUse: Record<string, string>;
  lemmas: Record<string, string[]>;
}>("curriculum/lexical-coverage.json");
const definitions: Record<string, string> = {
  듣다: "听；听取；听从",
  계시다: "在（있다 的尊敬表达）",
};
const overrides = read<Record<string, string>>(
  "curriculum/lexicon-overrides.json",
);
Object.assign(overrides, definitions, {
  기본소득: "基本收入",
  불균형: "不均衡；失衡",
});
write("curriculum/lexicon-overrides.json", overrides);
for (const word of words)
  if (definitions[word.ko]) {
    word.zh = definitions[word.ko];
    word.source = "edited";
  }
for (const [ko, zh] of Object.entries({
  기본소득: "基本收入",
  불균형: "不均衡；失衡",
})) {
  if (!words.some((word) => word.ko === ko))
    words.push({
      ko,
      zh,
      level: 3,
      source: "edited",
      sourceIds: [],
      lessonId: "w26d6",
    });
}
// The polite verb 계세요 was previously analysed as the unrelated noun 계.
const polite = words.find((word) => word.ko === "계시다")!;
const unrelated = words.find((word) => word.ko === "계")!;
if (polite.lessonId > "w01d6") {
  unrelated.lessonId = polite.lessonId;
  polite.lessonId = "w01d6";
}
const dictionary = new Map(words.map((word) => [word.ko, word]));
const particles = new Set([
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
  "으로",
  "로",
  "와",
  "과",
  "도",
  "만",
  "까지",
  "부터",
  "에게",
  "처럼",
  "에도",
  "에는",
  "에서는",
  "으로는",
  "마다",
  "보다",
  "조차",
  "마저",
  "이나",
  "이며",
  "이고",
  "입니다",
]);
const longestFirst = [...dictionary.keys()]
  .filter((ko) => !ko.endsWith("다"))
  .sort((a, b) => b.length - a.length);
function headword(token: string) {
  const clean = token.replace(/^[^가-힣]+|[^가-힣]+$/g, "");
  return longestFirst.find(
    (ko) => clean.startsWith(ko) && particles.has(clean.slice(ko.length)),
  );
}
type Example = {
  ko: string;
  zh: string;
  lessonId: string;
  title: string;
  source: "dialogue" | "reading";
};
const examples: Record<string, Example[]> = {};
const addExample = (ko: string, example: Example) => {
  if (!dictionary.has(ko)) return;
  const list = (examples[ko] ??= []);
  if (list.length < 2 && !list.some((item) => item.ko === example.ko))
    list.push(example);
};
const firstUse: Record<string, string> = {};
for (const dialogue of dialogues) {
  for (const line of dialogue.lines) {
    const lemmas = new Set(coverage.lemmas[line.id] ?? []);
    if (line.ko.includes("안녕히 계세요")) {
      lemmas.delete("계");
      lemmas.add("계시다");
    }
    for (const token of line.words) {
      if (token.base === "듣다") token.meaning = "듣다：听";
      if (dialogue.week === 1 && token.text === "새") {
        token.meaning = "新的（本句修饰“学生”）";
        token.note = "本句是冠形词；与“鸟”等同形词区分。";
      }
      if (dialogue.week === 1 && token.text === "씨") {
        token.meaning = "称呼人时接在人名后的礼貌称谓";
        token.note = "本句用于称呼，不是“种子”的意思。";
      }
      const exact = headword(token.text);
      if (exact) {
        lemmas.add(exact);
        if (
          !token.meaning ||
          ["불확실성", "재검토", "기본소득", "불균형"].includes(exact)
        ) {
          token.base = exact;
          token.meaning = `${exact}：${dictionary.get(exact)!.zh}`;
        }
      }
    }
    coverage.lemmas[line.id] = [...lemmas];
    for (const ko of lemmas)
      if (dictionary.has(ko)) {
        firstUse[ko] ??= dialogue.id;
        addExample(ko, {
          ko: line.ko,
          zh: line.zh,
          lessonId: dialogue.id,
          title: dialogue.title,
          source: "dialogue",
        });
      }
  }
}
// Earlier missed compounds are now prerequisites instead of arriving after use.
for (const word of words)
  if (firstUse[word.ko] && firstUse[word.ko] < word.lessonId)
    word.lessonId = firstUse[word.ko];
for (const dialogue of dialogues)
  dialogue.vocabulary = words
    .filter((word) => word.lessonId === dialogue.id)
    .map((word) => word.ko);
for (const week of intensiveWeeks) {
  const sentences = week.reading.ko.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    // Reading examples link back to the paragraph translation, rather than
    // presenting that translation as if it translated this single sentence.
    for (const token of sentence.split(/\s+/)) {
      const ko = headword(token);
      if (ko)
        addExample(ko, {
          ko: sentence,
          zh: "",
          lessonId: `w${String(week.week).padStart(2, "0")}d7`,
          title: `第 ${week.week} 周精读 · ${week.reading.title}`,
          source: "reading",
        });
    }
  }
}
words.sort((a, b) => a.lessonId.localeCompare(b.lessonId));
coverage.firstUse = firstUse;
const stats = read<Record<string, unknown>>("curriculum/statistics.json");
Object.assign(stats, {
  vocabulary: words.length,
  levels: Object.fromEntries(
    [1, 2, 3].map((level) => [
      level,
      words.filter((word) => word.level === level).length,
    ]),
  ),
  dailyNewWords: {
    min: Math.min(...dialogues.map((d) => d.vocabulary.length)),
    max: Math.max(...dialogues.map((d) => d.vocabulary.length)),
  },
  intensiveReadings: intensiveWeeks.length,
  explainedGrammar: intensiveWeeks.reduce((n, w) => n + w.grammar.length, 0),
  wordsWithExamples: Object.keys(examples).length,
});
write("curriculum/dialogues.json", dialogues);
write(
  "curriculum/outline.json",
  dialogues.map(({ lines, ...rest }) => {
    void lines;
    return rest;
  }),
);
write("curriculum/lexical-coverage.json", coverage);
write("curriculum/statistics.json", stats);
write("vocabulary.json", words);
write("vocabulary-context.json", examples);
console.log(
  JSON.stringify({
    words: words.length,
    wordsWithExamples: Object.keys(examples).length,
    readings: intensiveWeeks.length,
    grammar: stats.explainedGrammar,
  }),
);
