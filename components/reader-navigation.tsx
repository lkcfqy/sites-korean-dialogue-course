"use client";

import { useRouter } from "next/navigation";
import type { ReaderLessonSummary } from "@/lib/reader-types";

export function ReaderNavigation({
  lessons,
  currentId,
}: {
  lessons: ReaderLessonSummary[];
  currentId: string;
}) {
  const router = useRouter();
  const current = lessons.find((lesson) => lesson.id === currentId)!;
  const weeks = [...new Set(lessons.map((lesson) => lesson.week))];
  const weekLessons = lessons.filter((lesson) => lesson.week === current.week);

  function openLesson(id: string) {
    router.push(`/?lesson=${encodeURIComponent(id)}`);
  }

  return (
    <nav className="reader-nav" aria-label="课程目录">
      <label>
        <span>选择周次</span>
        <select
          value={current.week}
          onChange={(event) => {
            const first = lessons.find(
              (lesson) => lesson.week === Number(event.target.value),
            );
            if (first) openLesson(first.id);
          }}
        >
          {weeks.map((week) => (
            <option key={week} value={week}>
              {week > 26 ? "补充对话" : `第 ${week} 周`}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>选择课程</span>
        <select
          value={currentId}
          onChange={(event) => openLesson(event.target.value)}
        >
          {weekLessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {lesson.week > 26
                ? lesson.title
                : `第 ${lesson.day} 课 · ${lesson.title}`}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
