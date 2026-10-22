import outline from './curriculum/outline.json';
import { buildCourse } from './course-builder';
// The vocabulary page only needs the schedule, not the full dialogue/gloss corpus.
export const lessons = buildCourse(outline.map((lesson) => ({ ...lesson, lines: [] })));
