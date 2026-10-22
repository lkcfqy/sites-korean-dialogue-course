import { SPEAKER_VOICES, type Speaker } from "./korean-voices";
import {
  fetchKoreanAudio,
  SPEECH_REQUEST_TIMEOUT_MS,
  withSpeechRequestTimeout,
} from "./speech-request";

export type PlaybackItem = {
  id: string;
  text: string;
  speaker: Speaker;
  responseSeconds?: number;
};
export type DialoguePlayback = {
  activeId: string | null;
  status: string;
  playing: boolean;
  phase: "idle" | "loading" | "playing" | "gap" | "stopped" | "ended" | "error";
};
type AudioHandle = Pick<
  HTMLAudioElement,
  "play" | "pause" | "src" | "playbackRate" | "onended" | "onerror"
>;
export type DialoguePlayerDependencies = {
  createAudio: () => AudioHandle;
  fetchAudio: (
    text: string,
    speaker: Speaker,
    signal: AbortSignal,
  ) => Promise<Blob>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  requestTimeoutMs: number;
};
type AudioCacheEntry = { url: string; bytes: number };
type AudioResource = { url: string; cacheKey: string | null };
type PlaybackRun = {
  controller: AbortController;
  audio: AudioHandle | null;
  resource: AudioResource | null;
  finishAudio: (() => void) | null;
  gapTimer: ReturnType<typeof setTimeout> | null;
  finishGap: (() => void) | null;
};
const MAX_CACHE_ENTRIES = 150;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const initialState: DialoguePlayback = {
  activeId: null,
  status: "双人语音 · 就绪",
  playing: false,
  phase: "idle",
};
const defaults: DialoguePlayerDependencies = {
  createAudio: () => new Audio(),
  fetchAudio: fetchKoreanAudio,
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  requestTimeoutMs: SPEECH_REQUEST_TIMEOUT_MS,
};

export class DialoguePlayer {
  private state = initialState;
  private listeners = new Set<() => void>();
  private current: PlaybackRun | null = null;
  private cache = new Map<string, AudioCacheEntry>();
  private cachedBytes = 0;
  private deps: DialoguePlayerDependencies;

  constructor(dependencies: Partial<DialoguePlayerDependencies> = {}) {
    this.deps = { ...defaults, ...dependencies };
  }
  getSnapshot = () => this.state;
  getServerSnapshot = () => initialState;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<DialoguePlayback>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private isCurrent(run: PlaybackRun) {
    return this.current === run && !run.controller.signal.aborted;
  }
  private revoke(url: string) {
    try {
      this.deps.revokeObjectURL(url);
    } catch {
      /* Continue releasing remaining resources. */
    }
  }
  private removeCachedAudio(key: string) {
    const entry = this.cache.get(key);
    if (!entry) return;
    this.cache.delete(key);
    this.cachedBytes -= entry.bytes;
    this.revoke(entry.url);
  }
  private cleanupAudio(run: PlaybackRun) {
    const audio = run.audio;
    run.audio = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch {
        /* The browser may have detached this element. */
      }
      try {
        audio.src = "";
      } catch {
        /* Continue releasing the remaining resources. */
      }
    }
    if (run.resource && run.resource.cacheKey === null)
      this.revoke(run.resource.url);
    run.resource = null;
  }
  private cleanupRun(run: PlaybackRun) {
    run.controller.abort();
    run.finishAudio?.();
    run.finishAudio = null;
    run.finishGap?.();
    run.finishGap = null;
    if (run.gapTimer !== null) clearTimeout(run.gapTimer);
    run.gapTimer = null;
    this.cleanupAudio(run);
  }
  private cancelCurrent() {
    const run = this.current;
    this.current = null;
    if (run) this.cleanupRun(run);
  }
  stop = () => {
    this.cancelCurrent();
    this.update({
      activeId: null,
      status: "双人语音 · 已停止",
      playing: false,
      phase: "stopped",
    });
  };
  private async getAudio(
    item: PlaybackItem,
    run: PlaybackRun,
  ): Promise<AudioResource> {
    const cacheKey = `${item.speaker}\0${item.text}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return { url: cached.url, cacheKey };
    }
    // Fetch only the item about to play; never preload the full course/queue.
    const blob = await withSpeechRequestTimeout(
      (signal) => this.deps.fetchAudio(item.text, item.speaker, signal),
      run.controller.signal,
      this.deps.requestTimeoutMs,
    );
    if (!this.isCurrent(run))
      throw new DOMException("Playback stopped", "AbortError");
    if (!blob.size) throw new Error("没有收到音频，请点击播放重试。");
    const url = this.deps.createObjectURL(blob);
    if (blob.size > MAX_CACHE_BYTES) {
      const resource = { url, cacheKey: null };
      run.resource = resource;
      return resource;
    }
    while (
      this.cache.size >= MAX_CACHE_ENTRIES ||
      this.cachedBytes + blob.size > MAX_CACHE_BYTES
    ) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.removeCachedAudio(oldest);
    }
    this.cache.set(cacheKey, { url, bytes: blob.size });
    this.cachedBytes += blob.size;
    return { url, cacheKey };
  }
  private playAudio(audio: AudioHandle, run: PlaybackRun): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        run.finishAudio = null;
        if (error !== undefined) reject(error);
        else resolve();
      };
      run.finishAudio = () => finish();
      audio.onended = () => finish();
      audio.onerror = () =>
        finish(new Error("音频播放失败，请检查浏览器声音设置。"));
      const fail = (error: unknown) =>
        finish(error ?? new Error("音频播放失败，请点击播放重试。"));
      try {
        void audio.play().catch(fail);
      } catch (error) {
        fail(error);
      }
    });
  }
  private waitForGap(run: PlaybackRun, milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        if (run.gapTimer !== null) clearTimeout(run.gapTimer);
        run.gapTimer = null;
        run.finishGap = null;
        resolve();
      };
      run.finishGap = finish;
      run.gapTimer = setTimeout(finish, milliseconds);
    });
  }
  play = async (
    items: readonly PlaybackItem[],
    speed: number,
    repeat: number | "∞",
    gapSeconds = 0,
    onItem?: (item: PlaybackItem) => void,
    onItemEnded?: (item: PlaybackItem) => void,
  ) => {
    this.stop();
    if (!items.length) return;
    if (
      !Number.isFinite(speed) ||
      speed <= 0 ||
      !Number.isFinite(gapSeconds) ||
      gapSeconds < 0 ||
      (repeat !== "∞" && (!Number.isInteger(repeat) || repeat < 1)) ||
      items.some(
        (item) =>
          item.responseSeconds !== undefined &&
          (!Number.isFinite(item.responseSeconds) ||
            item.responseSeconds <= 0 ||
            item.responseSeconds > 60),
      )
    ) {
      this.update({ status: "播放设置无效，请重新选择。", phase: "error" });
      return;
    }
    const queue = [...items];
    const run: PlaybackRun = {
      controller: new AbortController(),
      audio: null,
      resource: null,
      finishAudio: null,
      gapTimer: null,
      finishGap: null,
    };
    this.current = run;
    this.update({ playing: true, phase: "loading" });
    try {
      for (let pass = 0; repeat === "∞" || pass < repeat; pass++) {
        for (let index = 0; index < queue.length; index++) {
          if (!this.isCurrent(run)) return;
          const item = queue[index];
          if (item.responseSeconds !== undefined) {
            this.update({
              activeId: item.id,
              phase: "gap",
              status: `角色 ${item.speaker} · 轮到你回应（${item.responseSeconds} 秒），这句不播放原音`,
            });
            if (!this.isCurrent(run)) return;
            onItem?.(item);
            if (!this.isCurrent(run)) return;
            await this.waitForGap(run, item.responseSeconds * 1000);
            if (!this.isCurrent(run)) return;
            continue;
          }
          const voiceName = SPEAKER_VOICES[item.speaker].name;
          this.update({
            activeId: null,
            phase: "loading",
            status: `正在准备 ${voiceName} 音频…`,
          });
          const resource = await this.getAudio(item, run);
          if (!this.isCurrent(run)) return;
          run.resource = resource;
          const audio = this.deps.createAudio();
          run.audio = audio;
          audio.src = resource.url;
          audio.playbackRate = speed;
          this.update({
            activeId: item.id,
            phase: "playing",
            status: `${voiceName} · 正在播放${repeat === "∞" ? "（循环）" : `（第 ${pass + 1} 次）`}`,
          });
          if (!this.isCurrent(run)) return;
          onItem?.(item);
          if (!this.isCurrent(run)) return;
          await this.playAudio(audio, run);
          if (!this.isCurrent(run)) return;
          onItemEnded?.(item);
          if (!this.isCurrent(run)) return;
          this.cleanupAudio(run);
          const hasNext =
            index < queue.length - 1 || repeat === "∞" || pass + 1 < repeat;
          if (gapSeconds > 0 && queue.length > 1 && hasNext) {
            this.update({
              phase: "gap",
              status: `留白 ${gapSeconds} 秒 · 轮到你说`,
            });
            if (!this.isCurrent(run)) return;
            await this.waitForGap(run, Math.min(gapSeconds, 60) * 1000);
            if (!this.isCurrent(run)) return;
          }
        }
      }
      if (this.isCurrent(run))
        this.update({
          activeId: null,
          status: "双人语音 · 播放完成",
          playing: false,
          phase: "ended",
        });
    } catch (error) {
      if (!this.isCurrent(run)) return;
      if (run.resource?.cacheKey) this.removeCachedAudio(run.resource.cacheKey);
      this.update({
        activeId: null,
        status: error instanceof Error ? error.message : "韩语语音暂时不可用。",
        playing: false,
        phase: "error",
      });
    } finally {
      this.cleanupRun(run);
      if (this.current === run) this.current = null;
    }
  };
  dispose = () => {
    this.cancelCurrent();
    for (const key of this.cache.keys()) this.removeCachedAudio(key);
    this.update({
      activeId: null,
      status: "双人语音 · 已停止",
      playing: false,
      phase: "stopped",
    });
  };
}
