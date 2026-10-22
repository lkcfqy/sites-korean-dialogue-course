"use client";
import { useEffect, useState } from "react";
import { BookOpen, Ear } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FoundationCourse } from "@/components/foundation-course";
import { ExerciseRunner } from "@/components/exercise-runner";
import { WritingCoach } from "@/components/writing-coach";
import { PronunciationRecorder } from "@/components/pronunciation-recorder";
import { StageTests } from "@/components/stage-tests";
import { ReviewQueue } from "@/components/review-queue";
import { intensiveWeek } from "@/data/intensive-course";
import { grammarWeeks, grammarExercises } from "@/data/grammar-course";
import { baseGrammarExercises } from "@/data/base-grammar-exercises";
import { comprehensionExercises } from "@/data/comprehension-course";
import {
  completionExercises,
  completionTasks,
  dataTaskForWeek,
  essayRevision,
} from "@/data/writing-course";
import type { PlaybackItem } from "@/hooks/use-korean-player";
export function IntensivePractice({
  week,
  playItems,
  stopAudio,
}: {
  week: number;
  playItems: (items: PlaybackItem[]) => void;
  stopAudio: () => void;
}) {
  const guide = intensiveWeek(week),
    data = dataTaskForWeek(week);
  const [tab, setTab] = useState("grammar"),
    [translation, setTranslation] = useState(false);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      const requested = new URLSearchParams(window.location.search).get(
        "practice",
      );
      if (
        requested &&
        ["grammar", "reading", "writing", "tests"].includes(requested)
      )
        setTab(requested);
    });
    return () => {
      live = false;
    };
  }, [week]);
  const points = [...guide.grammar, ...grammarWeeks[week - 1]];
  const speak = (text: string, id: string) =>
    playItems(
      text
        .split(/(?<=[.!?])\s+/)
        .flatMap((sentence, i) =>
          (sentence.match(/.{1,200}(?:\s|$)|.{1,200}/g) || []).map(
            (chunk, n) => ({
              id: `depth-${week}-${id}-${i}-${n}`,
              text: chunk.trim(),
              speaker: "A" as const,
            }),
          ),
        ),
    );
  return (
    <section
      id="weekly-practice"
      className="intensive-practice"
      aria-label="本周深入练习"
    >
      <div className="depth-heading">
        <div>
          <p className="eyebrow">
            WEEK {String(week).padStart(2, "0")} · 深入练习
          </p>
          <h2>从句子到完整表达</h2>
        </div>
        <BookOpen size={25} />
      </div>
      <p className="depth-goal">{guide.goal}</p>
      {week === 1 && (
        <details className="foundation-wrapper" open>
          <summary>零基础先学：12 步拼读与听写</summary>
          <FoundationCourse playItems={playItems} stopAudio={stopAudio} />
        </details>
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => {
          stopAudio();
          setTab(value);
        }}
      >
        <TabsList className="depth-tabs" aria-label="本周深入练习">
          <TabsTrigger value="grammar">句型讲解</TabsTrigger>
          <TabsTrigger value="reading">听读答题</TabsTrigger>
          <TabsTrigger value="writing">写作修改</TabsTrigger>
          <TabsTrigger value="tests">测验与回补</TabsTrigger>
        </TabsList>
        <TabsContent value="grammar">
          <div className="grammar-grid">
            {points.map((point, i) => (
              <article className="grammar-point" key={`${point.form}-${i}`}>
                <h3 lang="ko">{point.form}</h3>
                <p>{point.explanation}</p>
                <button
                  className="grammar-example"
                  onClick={() => speak(point.ko, `${i}`)}
                >
                  <Ear size={17} />
                  <span lang="ko">{point.ko}</span>
                </button>
                <p>{point.zh}</p>
                <p className="grammar-caution">注意：{point.caution}</p>
              </article>
            ))}
          </div>
          <p className="practice-tip">
            相近句型会在后续语境中复现，重点是区分形式、意义和使用条件。
          </p>
          <ExerciseRunner
            id={`grammar-set-w${week}`}
            week={week}
            skill="grammar"
            title="句型选择与辨误"
            questions={[
              ...baseGrammarExercises(week),
              ...grammarExercises(week),
            ]}
            minutes={8}
            playItems={playItems}
            stopAudio={stopAudio}
          />
          <div className="speaking-task">
            <strong>脱稿表达</strong>
            <p>{guide.speaking}</p>
            <p>
              先说一遍，再换一个条件重说；回看本周句型修正，最后不看稿复述。
            </p>
            <PronunciationRecorder focus={guide.speaking} />
          </div>
        </TabsContent>
        <TabsContent value="reading">
          <p className="practice-tip">
            先用独立材料作答，解析只在核对后出现。听力题不显示原文；完成后可用“查看答案”逐句核对。这里是课程原创练习。
          </p>
          <ExerciseRunner
            id={`listening-set-w${week}`}
            week={week}
            skill="listening"
            title="独立听力理解"
            questions={comprehensionExercises(week, "listening")}
            minutes={10}
            playItems={playItems}
            stopAudio={stopAudio}
          />
          <ExerciseRunner
            id={`reading-set-w${week}`}
            week={week}
            skill="reading"
            title="独立阅读理解"
            questions={comprehensionExercises(week, "reading")}
            minutes={8}
            playItems={playItems}
            stopAudio={stopAudio}
          />
          <details className="close-reading">
            <summary>继续精读：{guide.reading.title}</summary>
            <div className="reading-title">
              <h3>{guide.reading.title}</h3>
              <Button
                variant="outline"
                onClick={() => speak(guide.reading.ko, "reading")}
              >
                <Ear size={17} />
                听短文
              </Button>
            </div>
            <div className="reading-text" lang="ko">
              {guide.reading.ko.split("\n").map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            <Button
              variant="outline"
              onClick={() => setTranslation(!translation)}
            >
              {translation ? "收起中文" : "查看整篇中文"}
            </Button>
            {translation && (
              <p className="reading-translation">{guide.reading.zh}</p>
            )}
            <div className="reading-questions">
              {guide.reading.questions.map((q, i) => (
                <details key={q.question}>
                  <summary>
                    {i + 1}. {q.question}（先口头回答）
                  </summary>
                  <p>{q.answer}</p>
                </details>
              ))}
            </div>
          </details>
        </TabsContent>
        <TabsContent value="writing">
          <h3>先独立写，再根据具体提示改稿</h3>
          <p className="writing-prompt">{guide.writing.prompt}</p>
          <p className="practice-tip">
            {week >= 19
              ? "先用 5 分钟列提纲，再用 40 分钟完成论述。统一书面 다 体；按任务、结构、语言三个维度修订。"
              : "先表达完整意思，再检查词尾、助词和连接关系。基础任务逐步过渡到书面表达。"}
          </p>
          <WritingCoach
            key={`w${week}`}
            id={`w${week}`}
            label={week >= 19 ? "54 型 · 韩语论述草稿" : "本周表达草稿"}
            min={guide.writing.min}
            max={guide.writing.max}
            formal={week >= 19}
            rubric={week >= 19 ? "54" : undefined}
          />
          <details className="writing-outline">
            <summary>查看提纲与修改重点</summary>
            <ol>
              {guide.writing.outline.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
            <p>
              内容是否回应全部要求？理由和例子是否支持结论？表达和文体是否准确？提纲帮助组织，不是可直接套用的固定答案。
            </p>
          </details>
          <details className="completion-practice">
            <summary>
              51 / 52 型 · 句子补全（本周 {completionTasks[week - 1].kind} 型）
            </summary>
            <p>
              每个空补一句话，联系前后文与文体。网站只核对列出的参考表达；正确的其他表达请人工核对。练习正确率不是正式
              10 分题的得分。
            </p>
            <ExerciseRunner
              id={`completion-set-w${week}`}
              week={week}
              skill="writing"
              title="句子补全练习"
              questions={completionExercises(week)}
              minutes={8}
              playItems={playItems}
              stopAudio={stopAudio}
            />
          </details>
          <details className="data-writing">
            <summary>53 型 · 数据说明（200–300 字）</summary>
            <h4>{data.title}</h4>
            <p>
              教学虚构数据：{data.subject}
              。用韩语说明主要变化和比较，不自行补出资料没有给出的原因。
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>项目 · 单位 {data.unit}</th>
                    {data.years.map((y) => (
                      <th key={y}>{y}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(([name, a, b]) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      <td>{a}</td>
                      <td>{b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="practice-tip">
              12 组数据分布于课程；相邻周复现同组时，尝试重新组织并避免看旧稿。
            </p>
            <WritingCoach
              key={`w${week}-data`}
              id={`w${week}-data`}
              label="53 型 · 数据草稿"
              min={200}
              max={300}
              formal
              requiredNumbers={data.rows.flatMap((row) => [
                String(row[1]),
                String(row[2]),
              ])}
              rubric="53"
            />
            <details className="model-answer">
              <summary>写完后看数据核对与参考文本</summary>
              <p>{data.explanation}</p>
              <p lang="ko">{data.model}</p>
              <p>观察比较、范围与衔接，不把参考文本背作自己的答案。</p>
            </details>
          </details>
          <details className="essay-revision">
            <summary>看一个论述段落如何具体修改</summary>
            <h4>修改前</h4>
            <p lang="ko">{essayRevision.original}</p>
            <h4>修改后</h4>
            <p lang="ko">{essayRevision.revised}</p>
            <ol>
              {essayRevision.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ol>
            <p>
              <a
                href="https://exam.topik.go.kr/nasdata/webnas/raonkeditordata/uploadId/2024/02/20240227_175504804_07236.pdf"
                target="_blank"
                rel="noreferrer"
              >
                官方写作题型与评分标准
              </a>
              ：51/52 各 10 分，53 为 30 分，54 为 50
              分。这里的完成、规则检查和自查不自动生成考试分数。
            </p>
          </details>
        </TabsContent>
        <TabsContent value="tests">
          <ReviewQueue
            week={week}
            playItems={playItems}
            stopAudio={stopAudio}
          />
          <StageTests week={week} playItems={playItems} stopAudio={stopAudio} />
        </TabsContent>
      </Tabs>
      <p className="checkpoint">
        <strong>本周表达检验</strong>
        {guide.checkpoint}
      </p>
    </section>
  );
}
