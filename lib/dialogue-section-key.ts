import { legacyDialogueSectionKey } from "./dialogue-practice-keys";

/** Preserve v12 saves; later scenes use their original identity, never position. */
export function dialogueSectionKey(
  lessonId: string,
  sourceId: string,
  firstLineId: string,
  tag: string,
) {
  return (
    legacyDialogueSectionKey(lessonId, sourceId, firstLineId, tag) ??
    `${tag}-${sourceId}-${firstLineId}`
  );
}
