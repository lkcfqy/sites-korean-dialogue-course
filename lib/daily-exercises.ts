import type { Lesson,Line } from "@/data/course";
import type { Exercise } from "@/data/exercise-types";
export function dailyExercises(lesson: Lesson): Exercise[] {
  // Use two different turns and require productive recall of their spelling.
  // Review lessons reuse the source IDs, so their mistakes are not duplicated.
  const lines = lesson.sections[0].lines;
  const chosen = [lines[2] || lines[0], lines.at(-2) || lines.at(-1)].filter((line, i, all):line is Line => !!line && all.findIndex((x) => x?.id === line.id) === i);
  return chosen.map((line) => ({ id: `dictation-${line.id}`, week: lesson.week, skill: "listening", prompt: "听音频，不看对话，写出完整韩语句子。标点不影响核对，词形与词间空格需要准确。", audio: line.ko, accepted: [line.ko], explanation: `原句：${line.ko} 中文：${line.zh}。先核对漏词、助词与词尾；重看本课后，隔天再听写。`, sourceTitle: lesson.title, lessonId: lesson.id }));
}
