import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import contextReview from "../data/curriculum/dialogue-context-review.json";
import type { ImmersionLesson, ImmersionSection } from "../lib/immersion-types";
import {
  dialogueUrl,
  needsDialogueResponse,
  parseDialoguePosition,
  parseDialogueSettings,
  resolveDialoguePosition,
  resolveDialogueSection,
  saveDialoguePosition,
  type DialoguePosition,
} from "../lib/dialogue-study";

const ids = ["w01d1", "w01d2", "w19d1"];
const saved: DialoguePosition = {
  version: 1,
  lessonId: "w19d1",
  sectionKey: "新内容-w19d1-4",
  lineId: "w19d1-deep-1-8",
};

test("refresh restores the stable scene and line identifiers", () => {
  const restored = resolveDialoguePosition(
    new URLSearchParams("lesson=w19d1"),
    parseDialoguePosition(JSON.stringify(saved)),
    "w01d1",
    ids,
  );
  assert.deepEqual(restored, saved);
});

test("role responses leave normal dialogue open while reading and pronunciation stay audible", () => {
  const spoken = { speaker: "B" } as const;
  for (const role of ["both", "A", "B"] as const) {
    assert.equal(needsDialogueResponse({}, spoken, role), role === "B");
    assert.equal(
      needsDialogueResponse({ kind: "dialogue" }, spoken, role),
      role === "B",
    );
    assert.equal(
      needsDialogueResponse({ kind: "sentence" }, spoken, role),
      role === "B",
    );
    assert.equal(
      needsDialogueResponse({ kind: "passage" }, spoken, role),
      false,
    );
    assert.equal(
      needsDialogueResponse({ kind: "pronunciation" }, spoken, role),
      false,
    );
    assert.equal(
      needsDialogueResponse({}, { ...spoken, register: "written" }, role),
      false,
    );
  }
  assert(needsDialogueResponse({ kind: "dialogue" }, { speaker: "A" }, "A"));
});

function originalScenes(): ImmersionSection[] {
  return Array.from(
    { length: 26 },
    (_, index) =>
      JSON.parse(
        readFileSync(
          new URL(
            `../public/immersion/week-${String(index + 1).padStart(2, "0")}.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ) as ImmersionLesson[],
  )
    .flat()
    .flatMap((lesson) => lesson.sections.filter((section) => !section.review));
}

test("all 44 reviewed scene decisions protect exact reading spans without muting surrounding dialogue", () => {
  const scenes = originalScenes();
  assert.equal(contextReview.decisions.length, 44);
  let mixed = 0,
    solo = 0,
    relationships = 0;
  for (const decision of contextReview.decisions) {
    const scene = scenes.find(
      (section) => section.lines[0].id === decision.firstLineId,
    );
    assert(scene, `Existing source scene ${decision.firstLineId}`);
    const range = decision.writtenLineRange;
    if (!range) {
      relationships++;
      continue;
    }
    const [start, end] = range;
    const shape: Pick<ImmersionSection, "kind"> = {
      kind: decision.kind === "passage" ? "passage" : scene.kind,
    };
    if (decision.kind === "passage") {
      solo++;
      assert.deepEqual(range, [0, 22]);
      assert.equal(scene.lines.length, 22);
      assert(scene.lines.every((line) => line.speaker === "B"));
    } else {
      mixed++;
      assert.deepEqual(range, [8, 30]);
      assert.equal(scene.lines.length, 38);
      assert(
        scene.lines.slice(start, end).every((line) => line.speaker === "B"),
      );
    }
    scene.lines.forEach((sourceLine, index) => {
      const written = index >= start && index < end;
      const line = {
        ...sourceLine,
        ...(written ? { register: "written" as const } : {}),
      };
      for (const role of ["both", "A", "B"] as const)
        assert.equal(
          needsDialogueResponse(shape, line, role),
          !written && role !== "both" && role === line.speaker,
          `${sourceLine.id}, role ${role}`,
        );
    });
  }
  assert.deepEqual(
    { mixed, solo, relationships },
    { mixed: 35, solo: 7, relationships: 2 },
  );
});

test("published scene notes and written labels match all reviewed decisions", () => {
  const scenes = originalScenes();
  for (const decision of contextReview.decisions) {
    const scene = scenes.find(
      (section) => section.lines[0].id === decision.firstLineId,
    );
    assert(scene, decision.firstLineId);
    assert.equal(scene.contextNote, decision.note, decision.firstLineId);
    if (decision.kind) assert.equal(scene.kind, decision.kind);
    if (decision.writtenLineRange) {
      const [start, end] = decision.writtenLineRange;
      scene.lines.forEach((line, index) => {
        assert.equal(
          line.register === "written",
          index >= start && index < end,
          line.id,
        );
        assert.equal(
          needsDialogueResponse(scene, line, "B"),
          (index < start || index >= end) && line.speaker === "B",
          line.id,
        );
      });
    }
  }
});
test("explicit lesson links cannot inherit another lesson's position", () => {
  assert.deepEqual(
    resolveDialoguePosition(
      new URLSearchParams("lesson=w01d1"),
      saved,
      null,
      ids,
    ),
    { version: 1, lessonId: "w01d1", sectionKey: null, lineId: null },
  );
});
test("explicit line links override the saved line; invalid lessons fall back safely", () => {
  const linked = resolveDialoguePosition(
    new URLSearchParams("lesson=w19d1&line=another-line"),
    saved,
    null,
    ids,
  );
  assert.equal(linked.lineId, "another-line");
  assert.equal(linked.sectionKey, null);
  assert.equal(
    resolveDialoguePosition(new URLSearchParams("lesson=bad"), saved, null, ids)
      .lessonId,
    "w19d1",
  );
});
test("an explicit section link cannot retain the saved line from another section", () => {
  const linked = resolveDialoguePosition(
    new URLSearchParams("lesson=w19d1&section=new-section"),
    saved,
    null,
    ids,
  );
  assert.equal(linked.sectionKey, "new-section");
  assert.equal(linked.lineId, null);
});
test("cross-day playback URL and local storage restore the same day", () => {
  const position: DialoguePosition = {
    version: 1,
    lessonId: "w01d2",
    sectionKey: "新内容-w01d2-0",
    lineId: "w01d2-2",
  };
  const values = new Map<string, string>();
  assert(
    saveDialoguePosition(
      {
        setItem: (key, value) => {
          values.set(key, value);
        },
      },
      position,
    ),
  );
  const refreshed = resolveDialoguePosition(
    new URL(dialogueUrl(position), "https://example.test").searchParams,
    position,
    values.get("korean-dialogue-lesson-v2")!,
    ids,
  );
  assert.deepEqual(refreshed, position);
});
test("corrupt position and unsupported preferences are rejected", () => {
  for (const value of [
    null,
    {},
    { ...saved, lessonId: "w99d8" },
    { ...saved, lineId: "x".repeat(161) },
    { ...saved, sectionKey: 1 },
  ])
    assert.equal(parseDialoguePosition(JSON.stringify(value)), null);
  assert.equal(
    parseDialogueSettings(
      '{"version":1,"gap":999,"reading":"auto","range":"week"}',
    ),
    null,
  );
  assert.deepEqual(
    parseDialogueSettings(
      '{"version":1,"gap":4,"reading":"paragraph","range":"week"}',
    ),
    { version: 1, gap: 4, reading: "paragraph", range: "week", role: "both" },
  );
  assert.equal(
    parseDialogueSettings(
      '{"version":1,"gap":4,"reading":"line","range":"section","role":"C"}',
    ),
    null,
  );
  assert.equal(
    parseDialogueSettings(
      '{"version":1,"gap":4,"reading":"line","range":"section","role":"B"}',
    )?.role,
    "B",
  );
});
test("storage failure is visible to callers", () => {
  assert.equal(
    saveDialoguePosition(
      {
        setItem: () => {
          throw new Error("quota");
        },
      },
      saved,
    ),
    false,
  );
});

test("stale lines retain the valid saved scene, and moved lines remain discoverable", () => {
  const sections = [
    { key: "first", lines: [{ id: "a" }] },
    { key: "long-passage", lines: [{ id: "b" }, { id: "c" }] },
  ];
  assert.equal(
    resolveDialogueSection(sections, {
      sectionKey: "long-passage",
      lineId: "stale",
    }),
    1,
  );
  assert.equal(
    resolveDialogueSection(sections, { sectionKey: "missing", lineId: "c" }),
    1,
  );
  assert.equal(
    resolveDialogueSection(sections, { sectionKey: null, lineId: "c" }),
    1,
  );
  assert.equal(
    resolveDialogueSection(sections, {
      sectionKey: "missing",
      lineId: "stale",
    }),
    0,
  );
});
