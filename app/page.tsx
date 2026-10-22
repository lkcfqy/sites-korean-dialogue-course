import { redirect } from "next/navigation";
import { ReaderNavigation } from "@/components/reader-navigation";
import { ReaderDialogues } from "@/components/reader-dialogues";
import catalog from "@/public/reader/index.json";
import { loadReaderLesson } from "@/data/reader-loaders";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ lesson?: string | string[] }>;
}) {
  const params = await searchParams;
  const requested = Array.isArray(params.lesson)
    ? params.lesson[0]
    : params.lesson;
  const aliases: Record<string, string> = catalog.aliases;
  if (requested && aliases[requested]) {
    redirect(`/?lesson=${encodeURIComponent(aliases[requested])}`);
  }
  const index = requested
    ? catalog.lessons.findIndex((lesson) => lesson.id === requested)
    : 0;
  if (index < 0) redirect(`/?lesson=${catalog.lessons[0].id}`);
  const summary = catalog.lessons[index];
  const lesson = await loadReaderLesson(summary.id);
  const previous = catalog.lessons[index - 1];
  const next = catalog.lessons[index + 1];

  return (
    <div className="reader-shell">
      <a className="reader-skip" href="#dialogues">
        跳到对话正文
      </a>
      <header className="reader-header">
        <a className="reader-brand" href="/" aria-label="韩语对话课首页">
          <span className="brand-mark" aria-hidden="true">
            말
          </span>
          <span className="brand-copy">
            <strong>韩语对话课</strong>
            <span>韩语 · 中文对照</span>
          </span>
        </a>
        <span className="reader-count">26 周对话</span>
      </header>
      <main className="reader-main">
        <ReaderNavigation lessons={catalog.lessons} currentId={lesson.id} />
        <div className="lesson-heading">
          <p className="lesson-kicker">
            {lesson.week > 26
              ? "补充对话"
              : `第 ${lesson.week} 周 · 第 ${lesson.day} 课`}
          </p>
          <h1>{lesson.title}</h1>
          <p className="lesson-scene">{lesson.scene}</p>
        </div>
        <ReaderDialogues key={lesson.id} lesson={lesson} />
        <footer className="reader-footer" aria-label="切换课程">
          {previous ? (
            <a className="previous" href={`/?lesson=${previous.id}`} rel="prev">
              <span>← 上一课</span>
              <strong>{previous.title}</strong>
            </a>
          ) : (
            <span />
          )}
          {next ? (
            <a className="next" href={`/?lesson=${next.id}`} rel="next">
              <span>下一课 →</span>
              <strong>{next.title}</strong>
            </a>
          ) : (
            <span />
          )}
        </footer>
      </main>
    </div>
  );
}
