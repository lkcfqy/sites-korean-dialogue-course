#!/usr/bin/env node

// Usage: node scripts/build-reader-data.mjs [absolute-source absolute-output]
// Output: index.json and lessons/<original-lesson-id>.json.
// Only lesson titles for the supplementary material are renamed; all dialogue
// text, translations, speaker labels, full word annotations, and persistent
// source identifiers survive.
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nonemptyString(value, location) {
  assert(
    typeof value === "string" && value.trim().length > 0,
    `${location} must be a nonempty string`,
  );
  return value;
}

function stringArray(value) {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function validateWord(word, location) {
  assert(
    word && typeof word === "object" && !Array.isArray(word),
    `${location} is invalid`,
  );
  nonemptyString(word.text, `${location}.text`);
  assert(
    typeof word.meaning === "string",
    `${location}.meaning must be a string`,
  );
  for (const field of ["base", "note"]) {
    assert(
      word[field] === undefined || typeof word[field] === "string",
      `${location}.${field} must be a string`,
    );
  }
  assert(
    word.lemmas === undefined || stringArray(word.lemmas),
    `${location}.lemmas must be a string array`,
  );
  if (word.annotation !== undefined) {
    const annotation = word.annotation;
    assert(
      annotation &&
        typeof annotation === "object" &&
        ["linked", "ambiguous", "unlinked"].includes(annotation.status) &&
        ["morphology", "machine-rule", "legacy-normalization"].includes(
          annotation.method,
        ) &&
        ["machine-supported", "uncertain"].includes(annotation.confidence),
      `${location}.annotation has invalid literal fields`,
    );
    for (const field of ["rule", "reason"]) {
      assert(
        annotation[field] === undefined ||
          typeof annotation[field] === "string",
        `${location}.annotation.${field} must be a string`,
      );
    }
    assert(
      annotation.candidates === undefined || stringArray(annotation.candidates),
      `${location}.annotation.candidates must be a string array`,
    );
    assert(
      annotation.linkedSpans === undefined ||
        Array.isArray(annotation.linkedSpans),
      `${location}.annotation.linkedSpans must be an array`,
    );
  }
  if (word.contextSense !== undefined) {
    const sense = word.contextSense;
    assert(
      sense &&
        typeof sense === "object" &&
        ["reviewedLineId", "headword", "meaning", "morphologyNote"].every(
          (field) => typeof sense[field] === "string",
        ) &&
        stringArray(sense.otherSenses) &&
        sense.confidence === "reviewed-project-inference",
      `${location}.contextSense is invalid`,
    );
  }
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const [sourceArgument, outputArgument, ...extra] = arguments_.length
    ? arguments_
    : [
        path.join(projectRoot, "public/immersion"),
        path.join(projectRoot, "public/reader"),
      ];
  assert(
    sourceArgument && outputArgument && extra.length === 0,
    "Usage: node make-reader-data.mjs /absolute/public/immersion /absolute/output",
  );
  assert(
    path.isAbsolute(sourceArgument) && path.isAbsolute(outputArgument),
    "Both input and output paths must be absolute",
  );

  const sourceDirectory = await realpath(sourceArgument);
  const outputDirectory = path.resolve(outputArgument);
  const existingOutput = await realpath(outputDirectory).catch((error) => {
    if (error.code === "ENOENT") return outputDirectory;
    throw error;
  });
  assert(
    sourceDirectory !== existingOutput,
    "The output directory must differ from the source directory",
  );

  const files = (await readdir(sourceDirectory))
    .filter((name) => /^week-\d+\.json$/.test(name))
    .sort(
      (left, right) =>
        Number(left.match(/\d+/)[0]) - Number(right.match(/\d+/)[0]),
    );
  assert(files.length > 0, "No week-*.json source files found");

  const lessons = [];
  const sourceLessons = [];
  const lessonIds = new Set();
  let sourceBytes = 0;
  let excludedSections = 0;

  // Validate and assemble everything before writing any output files.
  for (const filename of files) {
    const sourceBuffer = await readFile(path.join(sourceDirectory, filename));
    sourceBytes += sourceBuffer.byteLength;
    const week = JSON.parse(sourceBuffer.toString("utf8"));
    assert(Array.isArray(week), `${filename} must contain a lesson array`);

    for (const sourceLesson of week) {
      const location = `${filename}:${sourceLesson?.id ?? "unknown lesson"}`;
      assert(
        sourceLesson && typeof sourceLesson === "object",
        `${location} is invalid`,
      );
      const id = nonemptyString(sourceLesson.id, `${location}.id`);
      assert(
        /^w\d{2}d[1-7]$/.test(id),
        `${location} has an unsafe or invalid id`,
      );
      assert(!lessonIds.has(id), `${location} has a duplicate lesson id`);
      lessonIds.add(id);
      assert(
        Number.isInteger(sourceLesson.week) && sourceLesson.week >= 1,
        `${location}.week is invalid`,
      );
      assert(
        Number.isInteger(sourceLesson.day) &&
          sourceLesson.day >= 1 &&
          sourceLesson.day <= 7,
        `${location}.day is invalid`,
      );
      assert(
        id ===
          `w${String(sourceLesson.week).padStart(2, "0")}d${sourceLesson.day}`,
        `${location} does not match its week/day metadata`,
      );
      assert(
        Array.isArray(sourceLesson.sections),
        `${location}.sections must be an array`,
      );
      sourceLessons.push(sourceLesson);

      const sectionKeys = new Set();
      const sections = sourceLesson.sections
        .filter((section) => {
          const keep = section.kind === "dialogue" && !section.review;
          if (!keep) excludedSections++;
          return keep;
        })
        .map((section) => {
          const sectionLocation = `${location}:${section.key ?? "unknown section"}`;
          const key = nonemptyString(section.key, `${sectionLocation}.key`);
          assert(
            !sectionKeys.has(key),
            `${sectionLocation} has a duplicate section key`,
          );
          sectionKeys.add(key);
          assert(
            Array.isArray(section.lines) && section.lines.length > 0,
            `${sectionLocation}.lines must be a nonempty array`,
          );
          const lineIds = new Set();
          return {
            key,
            label: nonemptyString(section.label, `${sectionLocation}.label`),
            scene: nonemptyString(section.scene, `${sectionLocation}.scene`),
            lines: section.lines.map((line) => {
              const lineLocation = `${sectionLocation}:${line.id ?? "unknown line"}`;
              const id = nonemptyString(line.id, `${lineLocation}.id`);
              assert(
                !lineIds.has(id),
                `${lineLocation} has a duplicate line id`,
              );
              lineIds.add(id);
              assert(
                Array.isArray(line.words),
                `${lineLocation}.words must be an array`,
              );
              line.words.forEach((word, index) =>
                validateWord(word, `${lineLocation}.words[${index}]`),
              );
              assert(
                line.speaker === "A" || line.speaker === "B",
                `${lineLocation}.speaker must be A or B`,
              );
              assert(
                line.chunks === undefined ||
                  (Array.isArray(line.chunks) &&
                    line.chunks.every((chunk) => typeof chunk === "string")),
                `${lineLocation}.chunks must be a string array when present`,
              );
              return {
                id,
                speaker: nonemptyString(
                  line.speaker,
                  `${lineLocation}.speaker`,
                ),
                ko: nonemptyString(line.ko, `${lineLocation}.ko`),
                zh: nonemptyString(line.zh, `${lineLocation}.zh`),
                words: line.words,
                ...(line.chunks === undefined ? {} : { chunks: line.chunks }),
              };
            }),
          };
        });

      if (sections.length === 0) continue;
      lessons.push({
        id,
        week: sourceLesson.week,
        day: sourceLesson.day,
        title:
          sourceLesson.week > 26
            ? "补充对话"
            : nonemptyString(sourceLesson.title, `${location}.title`),
        scene: nonemptyString(sourceLesson.scene, `${location}.scene`),
        sections,
      });
    }
  }

  lessons.sort((left, right) => left.week - right.week || left.day - right.day);
  assert(
    lessons.length === 157,
    `Expected 157 readable lessons, found ${lessons.length}; check the source version`,
  );
  const retainedIds = new Set(lessons.map((lesson) => lesson.id));
  const aliases = {};
  for (let week = 1; week <= 26; week++) {
    const prefix = `w${String(week).padStart(2, "0")}`;
    assert(
      lessonIds.has(`${prefix}d7`) && !retainedIds.has(`${prefix}d7`),
      `Expected ${prefix}d7 to be an empty review day`,
    );
    assert(retainedIds.has(`${prefix}d1`), `Missing alias target ${prefix}d1`);
    aliases[`${prefix}d7`] = `${prefix}d1`;
  }

  const index = {
    version: 1,
    lessons: lessons.map(({ sections, ...metadata }) => ({
      ...metadata,
      sectionCount: sections.length,
    })),
    aliases,
  };
  const generatedFiles = lessons.map((lesson) => ({
    relativePath: path.join("lessons", `${lesson.id}.json`),
    content: `${JSON.stringify(lesson)}\n`,
  }));
  const indexContent = `${JSON.stringify(index, null, 2)}\n`;

  await mkdir(path.join(outputDirectory, "lessons"), { recursive: true });
  for (const file of generatedFiles) {
    await writeFile(
      path.join(outputDirectory, file.relativePath),
      file.content,
      "utf8",
    );
  }
  // Write the index last so it only advertises already-written lessons.
  await writeFile(
    path.join(outputDirectory, "index.json"),
    indexContent,
    "utf8",
  );

  if (outputDirectory === path.join(projectRoot, "public/reader")) {
    const loaders = lessons.map(
      ({ id }) =>
        `  ${JSON.stringify(id)}: () => import("../public/reader/lessons/${id}.json"),`,
    );
    await writeFile(
      path.join(projectRoot, "data/reader-loaders.ts"),
      `// Generated by scripts/build-reader-data.mjs; keep lesson IDs stable.\n` +
        `import type { ReaderLesson } from "@/lib/reader-types";\n\n` +
        `const loaders: Record<string, () => Promise<{ default: unknown }>> = {\n` +
        loaders.join("\n") +
        `\n};\n\n` +
        `export async function loadReaderLesson(id: string): Promise<ReaderLesson> {\n` +
        `  const load = loaders[id];\n` +
        `  if (!load) throw new Error("课程不存在。");\n` +
        `  return (await load()).default as ReaderLesson;\n}\n`,
      "utf8",
    );
  }

  console.log(
    JSON.stringify(
      {
        sourceDirectory,
        outputDirectory,
        sourceFiles: files.length,
        sourceLessons: sourceLessons.length,
        lessons: lessons.length,
        mainLessons: lessons.filter((lesson) => lesson.week <= 26).length,
        supplementaryLessons: lessons.filter((lesson) => lesson.week > 26)
          .length,
        sections: lessons.reduce(
          (count, lesson) => count + lesson.sections.length,
          0,
        ),
        lines: lessons.reduce(
          (count, lesson) =>
            count +
            lesson.sections.reduce(
              (subtotal, section) => subtotal + section.lines.length,
              0,
            ),
          0,
        ),
        words: lessons.reduce(
          (count, lesson) =>
            count +
            lesson.sections.reduce(
              (subtotal, section) =>
                subtotal +
                section.lines.reduce(
                  (total, line) => total + line.words.length,
                  0,
                ),
              0,
            ),
          0,
        ),
        excludedSections,
        skippedLessons: sourceLessons.length - lessons.length,
        aliases: Object.keys(aliases).length,
        sourceBytes,
        outputBytes:
          Buffer.byteLength(indexContent) +
          generatedFiles.reduce(
            (count, file) => count + Buffer.byteLength(file.content),
            0,
          ),
        outputFiles: generatedFiles.length + 1,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
