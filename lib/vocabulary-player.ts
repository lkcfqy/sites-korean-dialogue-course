import {
  fetchKoreanAudio,
  SPEECH_REQUEST_TIMEOUT_MS,
  withSpeechRequestTimeout,
} from "./speech-request";

export type VocabularyWord = { ko: string; zh: string };
export type PlayerPhase =
  "idle" | "loading" | "playing" | "paused" | "ended" | "error";
export type VocabularyPlayback = {
  index: number;
  repetition: number;
  phase: PlayerPhase;
  single: boolean;
  error: string;
};

type AudioHandle = Pick<
  HTMLAudioElement,
  | "play"
  | "pause"
  | "src"
  | "currentTime"
  | "playbackRate"
  | "onended"
  | "onerror"
>;
type PlayerDependencies = {
  createAudio: () => AudioHandle;
  fetchAudio: (text: string, signal: AbortSignal) => Promise<Blob>;
  gap: number;
  requestTimeoutMs: number;
};

const defaults: PlayerDependencies = {
  createAudio: () => new Audio(),
  fetchAudio: (text, signal) => fetchKoreanAudio(text, "A", signal),
  gap: 450,
  requestTimeoutMs: SPEECH_REQUEST_TIMEOUT_MS,
};

export class VocabularyPlayer {
  private state: VocabularyPlayback = {
    index: 0,
    repetition: 0,
    phase: "idle",
    single: false,
    error: "",
  };
  private listeners = new Set<() => void>();
  private audio: AudioHandle | null = null;
  private cache = new Map<string, string>();
  private run = 0;
  private abort: AbortController | null = null;
  private paused = false;
  private releasePause: (() => void) | null = null;
  private finishAudio: (() => void) | null = null;
  private rejectAudio: ((error: Error) => void) | null = null;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseGap: (() => void) | null = null;
  private speed = 1;
  private repeats = 2;
  private deps: PlayerDependencies;

  constructor(
    private words: readonly VocabularyWord[],
    dependencies: Partial<PlayerDependencies> = {},
  ) {
    this.deps = { ...defaults, ...dependencies };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<VocabularyPlayback>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  setSpeed(speed: number) {
    if (![0.7, 0.85, 1, 1.15, 1.3].includes(speed)) return;
    this.speed = speed;
    if (this.audio) this.audio.playbackRate = speed;
  }

  setRepeats(repeats: number) {
    if ([1, 2, 3, 5, 10].includes(repeats)) this.repeats = repeats;
  }

  private cancel() {
    this.run++;
    this.abort?.abort();
    this.abort = null;
    this.paused = false;
    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;
    }
    this.finishAudio?.();
    this.finishAudio = null;
    this.rejectAudio = null;
    this.releasePause?.();
    this.releasePause = null;
    if (this.gapTimer) clearTimeout(this.gapTimer);
    this.releaseGap?.();
    this.releaseGap = null;
    this.gapTimer = null;
  }

  select(index: number) {
    if (index < 0 || index >= this.words.length) return;
    this.cancel();
    this.update({
      index,
      repetition: 0,
      phase: "idle",
      single: false,
      error: "",
    });
  }

  pause() {
    if (!["loading", "playing"].includes(this.state.phase)) return;
    this.paused = true;
    this.audio?.pause();
    this.update({ phase: "paused" });
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.update({ phase: this.finishAudio ? "playing" : "loading" });
    this.releasePause?.();
    this.releasePause = null;
    if (this.finishAudio && this.audio) {
      const run = this.run;
      void this.audio.play().catch(() => {
        if (run === this.run)
          this.rejectAudio?.(new Error("播放未能继续，请点击播放重试。"));
      });
    }
  }

  private async waitWhilePaused(run: number) {
    if (run === this.run && this.paused)
      await new Promise<void>((resolve) => {
        this.releasePause = resolve;
      });
  }

  private async getAudio(text: string, signal: AbortSignal) {
    const existing = this.cache.get(text);
    if (existing) return existing;
    const blob = await withSpeechRequestTimeout(
      (requestSignal) => this.deps.fetchAudio(text, requestSignal),
      signal,
      this.deps.requestTimeoutMs,
    );
    if (signal.aborted) return null;
    const url = URL.createObjectURL(blob);
    this.cache.set(text, url);
    // Bound audio memory; only the current word is fetched, with no full-library preloading.
    if (this.cache.size > 40) {
      const oldest = this.cache.keys().next().value!;
      URL.revokeObjectURL(this.cache.get(oldest)!);
      this.cache.delete(oldest);
    }
    return url;
  }

  async play(index = this.state.index, single = false) {
    if (index < 0 || index >= this.words.length) return;
    this.cancel();
    const run = this.run;
    const controller = new AbortController();
    this.abort = controller;
    this.audio ??= this.deps.createAudio();
    this.update({ index, repetition: 1, phase: "loading", single, error: "" });
    try {
      const end = single ? index + 1 : this.words.length;
      for (let current = index; current < end; current++) {
        for (let repetition = 1; repetition <= this.repeats; repetition++) {
          await this.waitWhilePaused(run);
          if (run !== this.run) return;
          this.update({ index: current, repetition, phase: "loading" });
          const url = await this.getAudio(
            this.words[current].ko,
            controller.signal,
          );
          await this.waitWhilePaused(run);
          if (run !== this.run || !url) return;
          const audio = this.audio;
          audio.src = url;
          audio.currentTime = 0;
          audio.playbackRate = this.speed;
          this.update({ phase: "playing" });
          await new Promise<void>((resolve, reject) => {
            this.finishAudio = resolve;
            this.rejectAudio = reject;
            audio.onended = () => resolve();
            audio.onerror = () =>
              reject(new Error("音频播放失败，请点击播放重试。"));
            void audio.play().catch(() => {
              // A play interrupted by pause is recoverable with the same audio element.
              if (run === this.run && !this.paused)
                reject(new Error("播放未能开始，请再次点击播放。"));
            });
          });
          if (run !== this.run) return;
          this.finishAudio = null;
          this.rejectAudio = null;
          audio.onended = null;
          audio.onerror = null;
          if (current < end - 1 || repetition < this.repeats) {
            await new Promise<void>((resolve) => {
              this.releaseGap = resolve;
              this.gapTimer = setTimeout(resolve, this.deps.gap);
            });
            this.releaseGap = null;
            this.gapTimer = null;
          }
        }
      }
      if (run === this.run) this.update({ phase: "ended" });
    } catch (error) {
      if (run !== this.run) return;
      this.cancel();
      this.update({
        phase: "error",
        error:
          error instanceof Error ? error.message : "语音暂时不可用，请重试。",
      });
    }
  }

  dispose() {
    this.cancel();
    this.cache.forEach((url) => URL.revokeObjectURL(url));
    this.cache.clear();
    if (this.audio) this.audio.src = "";
    this.audio = null;
  }
}
