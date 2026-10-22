"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  BookOpen,
  Brain,
  Check,
  Ear,
  GalleryHorizontalEnd,
  List,
  Pause,
  Play,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WordPronunciationNote } from "@/components/word-pronunciation-note";
import { VocabularyUsage } from "@/components/vocabulary-usage";
import { useKoreanPlayer } from "@/hooks/use-korean-player";
import { SiteHeader } from "@/components/site-header";
import { VocabularyPlayer } from "@/lib/vocabulary-player";
import {
  dailyQueue,
  loadMemory,
  MEMORY_KEY,
  saveRecall,
  type Memory,
  type RecallGrade,
} from "@/lib/learning-memory";
import { STUDY_EVENT } from "@/lib/study-records";
import { parseReviewWeek } from "@/lib/vocabulary-review";
import allWords from "@/data/vocabulary-client.json";
import mainLessons from "@/data/immersion-client-index.json";
import { courseDay, postCourseLessons } from "@/lib/dialogue-catalog";

const speeds = [0.7, 0.85, 1, 1.15, 1.3];
const repetitions = [1, 2, 3, 5, 10];
const pageSize = 20;
type VocabularyEntry = (typeof allWords)[number];
type Example = {
  ko: string;
  zh: string;
  lessonId: string;
  title: string;
  source: string;
  lineId: string;
};
const contextCache = new Map<string, Example[]>();
const wordIndex = new Map(allWords.map((word) => [word.ko, word]));
const validWords = new Set(wordIndex.keys());
const lessons = [...mainLessons, ...postCourseLessons];
const mainWords = new Set(mainLessons.flatMap((l) => l.vocabulary));
const settingsKey = "korean-vocabulary-settings-v2";
const reviewCache = new Map<string, string[]>();
type ReviewLoad = { lessonId: string; retry: number; error: string };

export function VocabularyBrowser() {
  const [scope, setScope] = useState("w01d1");
  const [queueMode, setQueueMode] = useState("daily");
  const [memory, setMemory] = useState<Memory>({});
  const [session, setSession] = useState(0);
  const [ready, setReady] = useState(false);
  const [newLimit, setNewLimit] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [updatesPending, setUpdatesPending] = useState(false);
  const [reviewLoad, setReviewLoad] = useState<ReviewLoad | null>(null);
  const [reviewRetry, setReviewRetry] = useState(0);
  const lastMemory = useRef("");
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("lesson");
      let saved: string | null = null;
      try {
        saved = localStorage.getItem("korean-dialogue-lesson-v2");
      } catch {
        /* Use the first lesson. */
      }
      const chosen = requested || saved;
      if (params.get("word")) {
        setScope("all");
        setQuery(params.get("word")!);
      } else if (params.get("scope") === "all") setScope("all");
      else if (chosen && lessons.some((lesson) => lesson.id === chosen))
        setScope(chosen);
      const restored = loadMemory();
      setMemory(restored);
      lastMemory.current = JSON.stringify(restored);
      setReady(true);
      try {
        const limit = Number(
          localStorage.getItem("korean-vocabulary-new-limit"),
        );
        if ([10, 20, 25, 30, 35, 40, 60].includes(limit)) setNewLimit(limit);
      } catch {
        /* Use the standard pace. */
      }
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const update = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.source === "import")
        setUpdatesPending(true);
      lastMemory.current = JSON.stringify(loadMemory());
    };
    const storage = (event: StorageEvent) => {
      if (
        event.key === null ||
        [MEMORY_KEY, settingsKey, "korean-vocabulary-new-limit"].includes(
          event.key,
        )
      ) {
        setUpdatesPending(true);
        lastMemory.current = JSON.stringify(loadMemory());
      }
    };
    const focus = () => {
      const current = JSON.stringify(loadMemory());
      if (current !== lastMemory.current) setUpdatesPending(true);
      lastMemory.current = current;
    };
    window.addEventListener(STUDY_EVENT, update);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener(STUDY_EVENT, update);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", focus);
    };
  }, []);
  const lesson = lessons.find((item) => item.id === scope);
  const limit = newLimit ?? lesson?.vocabulary.length ?? 40;
  const queue = useMemo(() => {
    const lessonPosition = lessons.findIndex((item) => item.id === scope);
    const missed = (lesson && lesson.week > 26 ? [] : mainLessons)
      .slice(0, Math.max(0, lessonPosition))
      .flatMap((item) => item.vocabulary)
      .filter((ko) => !memory[ko]);
    const unstudied =
      lesson?.day === 7
        ? []
        : [...new Set([...missed, ...(lesson?.vocabulary || [])])].filter(
            (ko) => !memory[ko],
          );
    const scheduled = dailyQueue(unstudied.slice(0, limit), memory, validWords);
    return { ...scheduled, backlog: Math.max(0, unstudied.length - limit) };
  }, [lesson, memory, scope, limit]);
  const searched = useMemo(
    () =>
      query.trim()
        ? allWords
            .filter((w) =>
              (w.ko + w.zh).toLowerCase().includes(query.trim().toLowerCase()),
            )
            .sort(
              (a, b) =>
                Number(b.ko === query.trim()) - Number(a.ko === query.trim()),
            )
        : null,
    [query],
  );
  const needsReview = ready && !!lesson && queueMode === "lesson" && !searched;
  const reviewWords = reviewCache.get(scope);
  const reviewError =
    needsReview &&
    reviewLoad?.lessonId === scope &&
    reviewLoad.retry === reviewRetry
      ? reviewLoad.error
      : "";
  const reviewLoading = needsReview && !reviewWords && !reviewError;
  useEffect(() => {
    if (!needsReview || !lesson || reviewCache.has(scope)) return;
    const controller = new AbortController();
    const weekLessonIds = lessons
      .filter((item) => item.week === lesson.week)
      .map((item) => item.id);
    fetch(
      `/immersion/review-week-${String(lesson.week).padStart(2, "0")}.json`,
      {
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("本课复习词表加载失败，请重试。");
        return parseReviewWeek(
          await response.json(),
          weekLessonIds,
          validWords,
        );
      })
      .then((items) => {
        if (controller.signal.aborted) return;
        for (const [id, words] of Object.entries(items))
          reviewCache.set(id, words);
        setReviewLoad({ lessonId: scope, retry: reviewRetry, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setReviewLoad({
            lessonId: scope,
            retry: reviewRetry,
            error:
              error instanceof Error
                ? error.message
                : "本课复习词表加载失败，请重试。",
          });
      });
    return () => controller.abort();
  }, [needsReview, lesson, scope, reviewRetry]);
  const words = useMemo(
    () =>
      searched ??
      (scope === "all"
        ? allWords
        : (queueMode === "daily"
            ? queue.words
            : [...(lesson?.vocabulary || []), ...(reviewWords || [])]
          )
            .map((ko) => wordIndex.get(ko))
            .filter((word): word is VocabularyEntry => !!word)),
    [searched, scope, queueMode, queue.words, lesson, reviewWords],
  );
  function changeScope(value: string) {
    const restored = loadMemory();
    setQuery("");
    setScope(value);
    setMemory(restored);
    setUpdatesPending(false);
    setSession((n) => n + 1);
    lastMemory.current = JSON.stringify(restored);
    if (updatesPending) {
      try {
        const limit = Number(
          localStorage.getItem("korean-vocabulary-new-limit"),
        );
        setNewLimit(
          [10, 20, 25, 30, 35, 40, 60].includes(limit) ? limit : null,
        );
      } catch {
        /* Keep the current pace when storage is unavailable. */
      }
    }
    window.history.replaceState(
      null,
      "",
      value === "all" ? "/vocabulary?scope=all" : `/vocabulary?lesson=${value}`,
    );
    if (value !== "all") {
      try {
        localStorage.setItem("korean-dialogue-lesson-v2", value);
      } catch {
        /* Continue. */
      }
    }
  }
  const reloadQueue = () => {
    const restored = loadMemory();
    setMemory(restored);
    lastMemory.current = JSON.stringify(restored);
    setUpdatesPending(false);
    try {
      if (updatesPending) {
        const limit = Number(
          localStorage.getItem("korean-vocabulary-new-limit"),
        );
        setNewLimit(
          [10, 20, 25, 30, 35, 40, 60].includes(limit) ? limit : null,
        );
      }
    } catch {
      /* Keep the current pace when storage is unavailable. */
    }
    setSession((n) => n + 1);
  };
  return (
    <div className="app-shell">
      <SiteHeader
        active="vocabulary"
        lessonId={lesson?.id}
        week={lesson?.week}
      />
      <main className="vocabulary-main">
        <div className="vocabulary-heading">
          <div>
            <p className="eyebrow">WORDS · 先回忆，再揭晓</p>
            <h1>单词</h1>
            <p>
              {scope === "all"
                ? `全部 ${allWords.length.toLocaleString("zh-CN")} 个词 · 可随时回到当天任务`
                : lesson && lesson.week > 26
                  ? `结课后 · 第 ${courseDay(lesson)} 课程日 · 本场景词汇`
                  : `第 ${lesson?.week} 周 · 第 ${lesson?.day} 天 · ${lesson?.title}`}
            </p>
          </div>
          <div className="vocab-heading-icon" aria-hidden="true">
            <Brain size={30} />
          </div>
        </div>
        <label className="vocabulary-scope">
          <span>跟随课程</span>
          <select
            aria-label="词库学习范围"
            value={scope}
            onChange={(e) => changeScope(e.target.value)}
          >
            {Array.from({ length: 26 }, (_, i) => i + 1).map((week) => (
              <optgroup key={week} label={`第 ${week} 周`}>
                {lessons
                  .filter((item) => item.week === week)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      第 {item.week} 周 · 第 {item.day} 天 · {item.title}
                    </option>
                  ))}
              </optgroup>
            ))}
            {postCourseLessons.length > 0 && (
              <optgroup label="结课后间隔复现">
                {postCourseLessons.map((item) => (
                  <option key={item.id} value={item.id}>
                    第 {courseDay(item)} 课程日 · {item.title}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="all">全部词库 · 自由浏览</option>
          </select>
        </label>
        <label className="study-search">
          <span>搜索全部词库</span>
          <input
            type="search"
            aria-label="搜索韩语或中文单词"
            placeholder="输入韩语或中文，例如 시간 / 时间"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {updatesPending && (
          <div className="vocabulary-context" role="status">
            <p>
              导入或其他标签页更新了学习记录。本轮练习继续保留，更新本轮后应用最新记录与设置。
            </p>
            <Button variant="outline" onClick={reloadQueue}>
              应用更新，重建本轮
            </Button>
          </div>
        )}
        {lesson && !searched && (
          <div className="vocabulary-pace">
            <label>
              新词量
              <select
                aria-label="本轮新词上限"
                value={newLimit ?? "auto"}
                onChange={(e) => {
                  const value = e.target.value;
                  setNewLimit(value === "auto" ? null : Number(value));
                  try {
                    if (value === "auto")
                      localStorage.removeItem("korean-vocabulary-new-limit");
                    else
                      localStorage.setItem(
                        "korean-vocabulary-new-limit",
                        value,
                      );
                  } catch {}
                  reloadQueue();
                }}
              >
                <option value="auto">
                  跟随阶段 · {lesson.vocabulary.length} 个
                </option>
                {[10, 20, 25, 30, 35, 40, 60].map((n) => (
                  <option key={n} value={n}>
                    {n} 个
                  </option>
                ))}
              </select>
            </label>
            <p>
              {lesson.day === 7
                ? "今天只复习，不增加新词。"
                : `先复习到期词，再补之前漏学的主线词。本轮后还有 ${queue.backlog} 个待补。`}
            </p>
          </div>
        )}
        {lesson && !searched && (
          <div className="word-task-bar">
            <Tabs
              value={queueMode}
              onValueChange={(value) => {
                setQueueMode(value);
                reloadQueue();
              }}
            >
              <TabsList aria-label="背词范围">
                <TabsTrigger value="daily">今日单词</TabsTrigger>
                <TabsTrigger value="lesson">本课配套词表</TabsTrigger>
              </TabsList>
            </Tabs>
            <a href={`/?lesson=${lesson.id}`}>听当天对话句子</a>
          </div>
        )}
        <p className="vocabulary-context">
          {searched
            ? `找到 ${searched.length} 个词，搜索范围包含主线与扩展词。`
            : scope === "all"
              ? "主线 4,980 个词，另有 1,149 个扩展词。结合搭配和课程例句学习，翻页不会自动计为记住。"
              : queueMode === "daily"
                ? `本轮先复习到期词，再学 ${queue.fresh} 个未学习词。到期 ${queue.due} 个${queue.remaining ? `，本轮最多取 80 个，还有 ${queue.remaining} 个可继续分组复习` : ""}。`
                : `本课 ${lesson?.vocabulary.length} 个新词、${lesson?.reviewVocabularyCount} 个课程复习词。可查阅全部内容，今日单词按实际记忆反馈安排。`}
        </p>
        {lesson && !searched && lesson.vocabulary.length > 0 && (
          <p className="vocabulary-context">
            本课新词中，{lesson.sceneVocabulary.length} 个在当天新场景出现，
            {lesson.vocabulary.length - lesson.sceneVocabulary.length}{" "}
            个为阶段配套词。配套词通过下面的搭配与用例学习。
          </p>
        )}
        {!ready ? (
          <p role="status">正在恢复你的背词位置…</p>
        ) : reviewLoading ? (
          <p role="status">正在载入本课完整复习词表…</p>
        ) : reviewError ? (
          <div className="study-empty" role="status">
            <p>{reviewError}</p>
            <Button onClick={() => setReviewRetry((value) => value + 1)}>
              重新加载复习词表
            </Button>
          </div>
        ) : words.length ? (
          <VocabularyContent
            key={`${scope}-${queueMode}-${session}-${query}`}
            words={words}
            scope={query ? `search` : `${scope}-${queueMode}`}
          />
        ) : (
          <div className="study-empty">
            <Check size={30} />
            <h2>{searched ? "没有匹配的词" : "当前没有待学词"}</h2>
            <p>
              {searched
                ? "换一个词或中文意思试试。"
                : "记忆反馈已安排下一次复习。复习日也可以打开本课配套词表，检查前六天的内容。"}
            </p>
            <Button onClick={reloadQueue}>刷新到期复习</Button>
            <Button variant="outline" onClick={() => setQueueMode("lesson")}>
              查看本课配套词表
            </Button>
          </div>
        )}
        {ready &&
          words.length > 0 &&
          !searched &&
          scope !== "all" &&
          queueMode === "daily" && (
            <Button
              className="next-study-batch"
              variant="outline"
              onClick={reloadQueue}
            >
              更新本轮，继续剩余复习
            </Button>
          )}
        <p className="content-credits">
          回忆结果与位置保存在此浏览器。再次想起、较难、记住，分别安排短间隔或逐步延长的复习；这是学习辅助，不代表考试等级。词汇及释义参考{" "}
          <a
            href="https://krdict.korean.go.kr/chn/mainAction"
            target="_blank"
            rel="noreferrer"
          >
            国立国语院韩国语基础词典
          </a>
          ，整理与部分释义按{" "}
          <a
            href="https://creativecommons.org/licenses/by-sa/2.0/kr/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY-SA 2.0 KR
          </a>{" "}
          提供；课程例句为原创。
        </p>
      </main>
    </div>
  );
}

const initials = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ",
  vowels = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const finals = [
  "",
  "ㄱ",
  "ㄲ",
  "ㄳ",
  "ㄴ",
  "ㄵ",
  "ㄶ",
  "ㄷ",
  "ㄹ",
  "ㄺ",
  "ㄻ",
  "ㄼ",
  "ㄽ",
  "ㄾ",
  "ㄿ",
  "ㅀ",
  "ㅁ",
  "ㅂ",
  "ㅄ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];
function letterParts(word: string) {
  return [...word]
    .filter((c) => /^[가-힣]$/.test(c))
    .map((c) => {
      const n = c.charCodeAt(0) - 0xac00;
      return `${c} = ${initials[Math.floor(n / 588)]} + ${vowels[Math.floor((n % 588) / 28)]}${n % 28 ? ` + ${finals[n % 28]}` : ""}`;
    })
    .join("　·　");
}

function VocabularyContent({
  words,
  scope,
}: {
  words: VocabularyEntry[];
  scope: string;
}) {
  const usageAudio = useKoreanPlayer();
  const stopUsageAudio = usageAudio.stop;
  const [player] = useState(() => new VocabularyPlayer(words));
  const state = useSyncExternalStore(
    player.subscribe,
    player.getSnapshot,
    player.getSnapshot,
  );
  const [view, setView] = useState("cards");
  const [speed, setSpeed] = useState(1);
  const [repeat, setRepeat] = useState(2);
  const [direction, setDirection] = useState("ko");
  const [revealed, setRevealed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [finished, setFinished] = useState(false);
  const [rated, setRated] = useState<Record<string, RecallGrade>>({});
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const word = words[state.index];
  const [examples, setExamples] = useState<Example[]>([]);
  useEffect(() => {
    const c = new AbortController();
    queueMicrotask(() => {
      if (!c.signal.aborted) setExamples(contextCache.get(word.ko) ?? []);
    });
    if (!contextCache.has(word.ko))
      fetch(`/api/vocabulary-context?word=${encodeURIComponent(word.ko)}`, {
        signal: c.signal,
      })
        .then((r) => r.json())
        .then((raw) => {
          if (!c.signal.aborted && Array.isArray(raw)) {
            contextCache.set(word.ko, raw);
            setExamples(raw);
          }
        })
        .catch(() => {});
    return () => c.abort();
  }, [word.ko]);
  const pageStart = Math.floor(state.index / pageSize) * pageSize;
  const active = state.phase === "playing" || state.phase === "loading";
  const cursorKey = `korean-vocabulary-cursor-v2-${scope}`;
  useEffect(() => () => player.dispose(), [player]);
  useEffect(() => {
    let mounted = true;
    try {
      const raw = localStorage.getItem(settingsKey);
      const settings = JSON.parse(
        raw || localStorage.getItem("korean-vocabulary-settings") || "null",
      );
      const cursor =
        scope === "search" ? null : localStorage.getItem(cursorKey);
      queueMicrotask(() => {
        if (!mounted) return;
        if (settings) {
          if (speeds.includes(settings.speed)) {
            setSpeed(settings.speed);
            player.setSpeed(settings.speed);
          }
          if (repetitions.includes(settings.repeat)) {
            setRepeat(settings.repeat);
            player.setRepeats(settings.repeat);
          }
          if (raw && ["list", "cards"].includes(settings.view))
            setView(settings.view);
          if (["ko", "zh", "audio"].includes(settings.direction))
            setDirection(settings.direction);
        }
        const index = words.findIndex((item) => item.ko === cursor);
        if (index >= 0) player.select(index);
        setHydrated(true);
      });
    } catch {
      queueMicrotask(() => {
        if (mounted) setHydrated(true);
      });
    }
    return () => {
      mounted = false;
    };
  }, [cursorKey, player, words, scope]);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (live) setRevealed(false);
    });
    stopUsageAudio();
    if (hydrated && scope !== "search") {
      try {
        localStorage.setItem(cursorKey, word.ko);
      } catch {
        /* Reading remains available. */
      }
    }
    return () => {
      live = false;
    };
  }, [cursorKey, word.ko, hydrated, stopUsageAudio, scope]);
  useEffect(() => {
    if (view !== "list") return;
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>("[aria-current='true']");
    if (list && selected) {
      const top =
        selected.getBoundingClientRect().top -
        list.getBoundingClientRect().top +
        list.scrollTop;
      if (
        top < list.scrollTop ||
        top + selected.offsetHeight > list.scrollTop + list.clientHeight
      )
        list.scrollTo({
          top: Math.max(
            0,
            top - list.clientHeight / 2 + selected.offsetHeight / 2,
          ),
          behavior: "instant",
        });
    }
  }, [state.index, view]);
  function saveSettings(next: {
    speed?: number;
    repeat?: number;
    view?: string;
    direction?: string;
  }) {
    try {
      localStorage.setItem(
        settingsKey,
        JSON.stringify({ speed, repeat, view, direction, ...next }),
      );
    } catch {
      /* Preferences are optional. */
    }
  }
  function select(index: number) {
    usageAudio.stop();
    setFinished(false);
    setRevealed(false);
    if (active) void player.play(index);
    else player.select(index);
  }
  function rate(grade: RecallGrade) {
    usageAudio.stop();
    const result = saveRecall(word.ko, grade);
    if (!result.saved) {
      player.select(state.index);
      setFeedback(
        "未能保存记忆反馈，当前词没有计入记录。请检查浏览器存储后重试，或手动跳过继续练习。",
      );
      return;
    }
    setRated((old) => ({ ...old, [word.ko]: grade }));
    const date = new Date(result.next.due).toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });
    setFeedback(
      `${word.ko}：${grade === "again" ? "10 分钟后再回忆" : `${date} 再复习`}。`,
    );
    // Use select directly so rating during autoplay always stops the audio.
    player.select(Math.min(state.index + 1, words.length - 1));
    setRevealed(false);
    if (state.index === words.length - 1) setFinished(true);
  }
  function togglePlay() {
    usageAudio.stop();
    if (active) player.pause();
    else if (state.phase === "paused") player.resume();
    else
      void player.play(
        state.phase === "ended" && !state.single ? 0 : state.index,
      );
  }
  function playWord(index: number) {
    usageAudio.stop();
    void player.play(index, true);
  }
  const conceal = direction === "audio" && !revealed && view === "cards";
  const status =
    state.phase === "error"
      ? state.error
      : state.phase === "ended"
        ? state.single
          ? "这个词已读完"
          : "本轮词语已读完；朗读不计为记住"
        : state.phase === "paused"
          ? "已暂停"
          : state.phase === "loading"
            ? "正在准备读音…"
            : state.phase === "playing"
              ? `${conceal ? "当前单词" : word.ko} · 第 ${state.repetition} 次`
              : "先尝试回忆，再揭晓答案。自动朗读可连续听词。";

  return (
    <Tabs
      value={view}
      onValueChange={(value) => {
        usageAudio.stop();
        player.select(state.index);
        setView(value);
        setFinished(false);
        saveSettings({ view: value });
      }}
    >
      {(active || usageAudio.playing) && (
        <button
          className="immersion-floating-stop"
          onClick={() => {
            player.pause();
            usageAudio.stop();
          }}
        >
          <Pause size={16} />
          暂停播放
        </button>
      )}
      <div className="vocabulary-toolbar">
        <TabsList className="vocabulary-view" aria-label="词库显示方式">
          <TabsTrigger value="cards">
            <GalleryHorizontalEnd />
            回忆卡
          </TabsTrigger>
          <TabsTrigger value="list">
            <List />
            词表
          </TabsTrigger>
        </TabsList>
        {view === "cards" && (
          <label className="recall-direction">
            回忆方向
            <Select
              value={direction}
              onValueChange={(value) => {
                usageAudio.stop();
                player.select(state.index);
                setDirection(value);
                setRevealed(false);
                saveSettings({ direction: value });
              }}
            >
              <SelectTrigger aria-label="回忆方向">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ko">韩语想中文</SelectItem>
                <SelectItem value="zh">中文想韩语</SelectItem>
                <SelectItem value="audio">听音想意思</SelectItem>
              </SelectContent>
            </Select>
          </label>
        )}
      </div>
      <details className="audio-tools">
        <summary>朗读与播放设置</summary>
        <section className="vocabulary-player" aria-label="词库播放设置">
          <div className="vocabulary-settings">
            <label>
              <span>每词次数</span>
              <Select
                value={String(repeat)}
                onValueChange={(value) => {
                  const count = Number(value);
                  usageAudio.stop();
                  setRepeat(count);
                  player.setRepeats(count);
                  saveSettings({ repeat: count });
                }}
              >
                <SelectTrigger
                  className="control-select"
                  aria-label="每词读音次数"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {repetitions.map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {count} 次
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label>
              <span>语速</span>
              <Select
                value={String(speed)}
                onValueChange={(value) => {
                  const rate = Number(value);
                  usageAudio.stop();
                  setSpeed(rate);
                  player.setSpeed(rate);
                  saveSettings({ speed: rate });
                }}
              >
                <SelectTrigger className="control-select" aria-label="词库语速">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {speeds.map((rate) => (
                    <SelectItem key={rate} value={String(rate)}>
                      {rate}×
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <Button className="vocabulary-play" onClick={togglePlay}>
            {active ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
            {active
              ? "暂停"
              : state.phase === "paused"
                ? "继续播放"
                : "自动朗读"}
          </Button>
        </section>
      </details>
      <p
        className={
          state.phase === "error"
            ? "vocabulary-status has-error"
            : "vocabulary-status"
        }
        role="status"
      >
        {status}
      </p>
      <TabsContent value="list" className="vocabulary-panel">
        <div className="vocabulary-list-label">
          <span>韩语</span>
          <span>中文</span>
          <span className="sr-only">播放</span>
        </div>
        <ul className="vocabulary-list" ref={listRef} aria-label="韩语词库">
          {words.slice(pageStart, pageStart + pageSize).map((entry, offset) => {
            const index = pageStart + offset;
            const current = state.index === index;
            return (
              <li
                key={entry.ko}
                aria-current={current ? "true" : undefined}
                className={
                  current ? "vocabulary-row is-current" : "vocabulary-row"
                }
              >
                <button
                  type="button"
                  className="vocabulary-select"
                  aria-label={`选择 ${entry.ko}，${entry.zh}`}
                  onClick={() => select(index)}
                >
                  <span lang="ko">
                    {entry.ko}
                    <small className="vocabulary-word-stage" lang="zh-CN">
                      {mainWords.has(entry.ko) ? "主线词" : "扩展词"}
                    </small>
                  </span>
                  <span>{entry.zh}</span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="vocabulary-list-audio"
                  aria-label={`朗读 ${entry.ko}`}
                  onClick={() => playWord(index)}
                >
                  <Volume2 size={21} />
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="vocabulary-pager">
          <Button
            variant="outline"
            disabled={pageStart === 0}
            onClick={() => select(pageStart - pageSize)}
          >
            上一页
          </Button>
          <span>
            {pageStart + 1}–{Math.min(pageStart + pageSize, words.length)} /{" "}
            {words.length}
          </span>
          <Button
            variant="outline"
            disabled={pageStart + pageSize >= words.length}
            onClick={() => select(pageStart + pageSize)}
          >
            下一页
          </Button>
        </div>
      </TabsContent>
      <TabsContent value="cards" className="vocabulary-panel">
        {finished ? (
          <div className="study-empty">
            <Check size={32} />
            <h2>已到本轮末尾</h2>
            <p>
              本次记录 {Object.keys(rated).length} / {words.length}{" "}
              个词的记忆反馈，其中{" "}
              {Object.values(rated).filter((grade) => grade === "again").length}{" "}
              个需要短间隔回顾。跳过的词仍未评定。
            </p>
            <Button variant="outline" onClick={() => select(0)}>
              回看这一组
            </Button>
          </div>
        ) : (
          <>
            <section
              className="vocabulary-card recall-card"
              aria-label="词语回忆卡"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  select(Math.max(0, state.index - 1));
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  select(Math.min(words.length - 1, state.index + 1));
                }
              }}
              onTouchStart={(event) => {
                touchStart.current = {
                  x: event.touches[0].clientX,
                  y: event.touches[0].clientY,
                };
              }}
              onTouchEnd={(event) => {
                const start = touchStart.current;
                touchStart.current = null;
                if (!start) return;
                const dx = event.changedTouches[0].clientX - start.x;
                const dy = event.changedTouches[0].clientY - start.y;
                if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5)
                  select(
                    Math.max(
                      0,
                      Math.min(
                        words.length - 1,
                        state.index + (dx < 0 ? 1 : -1),
                      ),
                    ),
                  );
              }}
            >
              <span className="vocabulary-card-count">
                {state.index + 1} / {words.length} ·{" "}
                {examples.length ? "课程语境" : "词典用法"}
              </span>
              {direction === "audio" && !revealed ? (
                <Button
                  className="listen-cue"
                  variant="outline"
                  onClick={() => playWord(state.index)}
                >
                  <Ear size={30} />
                  听单词，回想意思
                </Button>
              ) : (
                <div
                  className={`vocabulary-card-word ${direction === "zh" && !revealed ? "chinese-cue" : ""}`}
                  key={word.ko}
                >
                  <h2 lang={direction === "zh" && !revealed ? "zh-CN" : "ko"}>
                    {direction === "zh" && !revealed ? word.zh : word.ko}
                  </h2>
                  {revealed && <p>{word.zh}</p>}
                  {revealed && /^w0[12]/.test(scope) && (
                    <p className="word-letter-parts" lang="ko">
                      {letterParts(word.ko)}
                      <small lang="zh-CN">
                        看字母组成，跟着音频逐个读字块；字块开头的 ㅇ 不发音。
                      </small>
                    </p>
                  )}
                </div>
              )}
              {!revealed ? (
                <>
                  <p className="recall-instruction">
                    在心里回答，或先大声说出来
                  </p>
                  <Button
                    className="reveal-answer"
                    onClick={() => setRevealed(true)}
                  >
                    揭晓答案
                  </Button>
                </>
              ) : (
                <div className="recall-grades">
                  <Button variant="outline" onClick={() => rate("again")}>
                    没想起
                  </Button>
                  <Button variant="outline" onClick={() => rate("hard")}>
                    有点难
                  </Button>
                  <Button onClick={() => rate("good")}>记住了</Button>
                </div>
              )}
              <Button
                className="vocabulary-card-audio"
                variant="outline"
                aria-label="朗读当前单词"
                onClick={() => playWord(state.index)}
              >
                <Volume2 size={21} />
                听这个词
              </Button>
            </section>
            {revealed && (
              <div className="word-examples">
                <h3>
                  <BookOpen size={18} />
                  课程中的用法
                </h3>
                {examples.length ? (
                  examples.slice(0, 8).map((example) => (
                    <article key={`${example.lessonId}-${example.ko}`}>
                      <p lang="ko">{example.ko}</p>
                      {example.zh && <p>{example.zh}</p>}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          player.select(state.index);
                          void usageAudio.play(
                            [
                              {
                                id: `example-${word.ko}`,
                                text: example.ko,
                                speaker: "A",
                              },
                            ],
                            speed,
                            1,
                          );
                        }}
                      >
                        <Volume2 size={15} />
                        听例句
                      </Button>
                      <a
                        href={`/?lesson=${example.lessonId}&line=${encodeURIComponent(example.lineId)}`}
                      >
                        {example.title} · 回到场景
                      </a>
                    </article>
                  ))
                ) : (
                  <p>这个词的使用场景见下面的词典搭配与用例。</p>
                )}
              </div>
            )}
            {revealed && (
              <>
                <WordPronunciationNote
                  lessonId={scope.split("-")[0]}
                  onSpeak={(text) => {
                    player.select(state.index);
                    void usageAudio.play(
                      [{ id: `pronunciation-${scope}`, text, speaker: "A" }],
                      speed,
                      1,
                    );
                  }}
                />
                <VocabularyUsage
                  key={word.ko}
                  word={word.ko}
                  onSpeakDialogue={(lines) => {
                    player.select(state.index);
                    void usageAudio.play(
                      lines.flatMap((line, i) =>
                        line.text
                          .split(/(?<=[.!?])\s+/)
                          .flatMap(
                            (part) =>
                              part.match(/.{1,200}(?:\s|$)|.{1,200}/g) || [],
                          )
                          .map((text, j) => ({
                            id: `usage-dialogue-${word.ko}-${i}-${j}`,
                            text: text.trim(),
                            speaker: line.speaker,
                          })),
                      ),
                      speed,
                      1,
                    );
                  }}
                  onSpeak={(text) => {
                    player.select(state.index);
                    void usageAudio.play(
                      text
                        .split(/(?<=[.!?])\s+/)
                        .flatMap(
                          (part) =>
                            part.match(/.{1,200}(?:\s|$)|.{1,200}/g) || [],
                        )
                        .map((text, i) => ({
                          id: `usage-${word.ko}-${i}`,
                          text: text.trim(),
                          speaker: "A",
                        })),
                      speed,
                      1,
                    );
                  }}
                />
                <p role="status">{usageAudio.status}</p>
              </>
            )}
            <div className="vocabulary-pager card-pager">
              <Button
                variant="outline"
                disabled={state.index === 0}
                onClick={() => select(state.index - 1)}
              >
                上一个
              </Button>
              <span>左右滑动 · 跳过不记为掌握</span>
              <Button
                variant="outline"
                disabled={state.index === words.length - 1}
                onClick={() => select(state.index + 1)}
              >
                下一个
              </Button>
            </div>
          </>
        )}
        <p className="recall-feedback" role="status">
          {feedback}
        </p>
      </TabsContent>
    </Tabs>
  );
}
