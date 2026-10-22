import type { Line } from "../data/course";
import type { ImmersionSection } from "./immersion-types";

export const DIALOGUE_POSITION_KEY = "korean-dialogue-position-v1";
export const DIALOGUE_SETTINGS_KEY = "korean-dialogue-settings-v1";

export type DialoguePosition = {
  version: 1;
  lessonId: string;
  sectionKey: string | null;
  lineId: string | null;
};
export type DialogueSettings = {
  version: 1;
  gap: 0 | 2 | 4;
  reading: "auto" | "line" | "paragraph";
  range: "section" | "lesson" | "week";
  role: "both" | "A" | "B";
};

export const defaultDialogueSettings: DialogueSettings = {
  version: 1,
  gap: 0,
  reading: "auto",
  range: "section",
  role: "both",
};

/** A reading voice is never a conversational reply slot. */
export function needsDialogueResponse(
  section: Pick<ImmersionSection, "kind">,
  line: Pick<Line, "speaker" | "register">,
  role: DialogueSettings["role"],
): boolean {
  return (
    role !== "both" &&
    role === line.speaker &&
    section.kind !== "passage" &&
    section.kind !== "pronunciation" &&
    line.register !== "written"
  );
}
import { isPublishedDialogueLesson } from "./dialogue-catalog";
const validIdentifier = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    !/[\u0000-\u001f]/.test(value));

export function parseDialoguePosition(
  raw: string | null,
): DialoguePosition | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return null;
    const position = value as Partial<DialoguePosition>;
    if (
      position.version !== 1 ||
      typeof position.lessonId !== "string" ||
      !isPublishedDialogueLesson(position.lessonId) ||
      !validIdentifier(position.sectionKey) ||
      !validIdentifier(position.lineId)
    )
      return null;
    return position as DialoguePosition;
  } catch {
    return null;
  }
}

export function parseDialogueSettings(
  raw: string | null,
): DialogueSettings | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return null;
    const settings = value as Partial<DialogueSettings>;
    if (
      settings.version !== 1 ||
      ![0, 2, 4].includes(settings.gap as number) ||
      !["auto", "line", "paragraph"].includes(settings.reading ?? "") ||
      !["section", "lesson", "week"].includes(settings.range ?? "") ||
      (settings.role !== undefined &&
        !["both", "A", "B"].includes(settings.role))
    )
      return null;
    return { ...settings, role: settings.role ?? "both" } as DialogueSettings;
  } catch {
    return null;
  }
}

/** Explicit links take priority; saved section/line only belong to their own lesson. */
export function resolveDialoguePosition(
  params: URLSearchParams,
  saved: DialoguePosition | null,
  legacyLesson: string | null,
  lessonIds: readonly string[],
): DialoguePosition {
  const lessonId =
    [params.get("lesson"), saved?.lessonId, legacyLesson].find(
      (id): id is string => !!id && lessonIds.includes(id),
    ) ?? lessonIds[0];
  const matchingSaved = saved?.lessonId === lessonId ? saved : null;
  const section = params.get("section");
  const line = params.get("line");
  const explicitSection = section && validIdentifier(section) ? section : null;
  const explicitLine = line && validIdentifier(line) ? line : null;
  return {
    version: 1,
    lessonId,
    sectionKey:
      explicitSection ??
      (explicitLine ? null : (matchingSaved?.sectionKey ?? null)),
    lineId:
      explicitLine ??
      (explicitSection ? null : (matchingSaved?.lineId ?? null)),
  };
}

export function dialogueUrl(position: DialoguePosition): string {
  const params = new URLSearchParams({ lesson: position.lessonId });
  if (position.sectionKey) params.set("section", position.sectionKey);
  if (position.lineId) params.set("line", position.lineId);
  return `/?${params}`;
}

/** Recover a useful scene even when a saved line no longer exists. */
export function resolveDialogueSection(
  sections: readonly { key: string; lines: readonly { id: string }[] }[],
  position: Pick<DialoguePosition, "sectionKey" | "lineId">,
): number {
  if (position.lineId) {
    const exact = sections.findIndex(
      (section) =>
        (!position.sectionKey || section.key === position.sectionKey) &&
        section.lines.some((line) => line.id === position.lineId),
    );
    if (exact >= 0) return exact;
  }
  const bySection = sections.findIndex(
    (section) => section.key === position.sectionKey,
  );
  if (bySection >= 0) return bySection;
  const byLine = position.lineId
    ? sections.findIndex((section) =>
        section.lines.some((line) => line.id === position.lineId),
      )
    : -1;
  return Math.max(0, byLine);
}

export function saveDialoguePosition(
  storage: Pick<Storage, "setItem">,
  position: DialoguePosition,
): boolean {
  try {
    if (!parseDialoguePosition(JSON.stringify(position))) return false;
    storage.setItem(DIALOGUE_POSITION_KEY, JSON.stringify(position));
    storage.setItem("korean-dialogue-lesson-v2", position.lessonId);
    return true;
  } catch {
    return false;
  }
}
