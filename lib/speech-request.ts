import type { Speaker } from "./korean-voices";

export const SPEECH_REQUEST_TIMEOUT_MS = 40_000;

export class SpeechRequestTimeoutError extends Error {
  constructor() {
    super("语音请求超时，请点击播放重试。");
    this.name = "SpeechRequestTimeoutError";
  }
}

// Include HTTP/body reads in the deadline and settle even when fetch ignores abort.
export function withSpeechRequestTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs = SPEECH_REQUEST_TIMEOUT_MS,
): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      controller.abort(error);
      reject(error);
    };
    const onAbort = () => fail(signal.reason);
    const timer = setTimeout(
      () => fail(new SpeechRequestTimeoutError()),
      timeoutMs,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    try {
      operation(controller.signal).then((value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      }, fail);
    } catch (error) {
      fail(error);
    }
  });
}

export async function fetchKoreanAudio(
  text: string,
  speaker: Speaker,
  signal: AbortSignal,
): Promise<Blob> {
  try {
    const response = await fetch("/api/speech", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speaker }),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message =
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : "语音请求失败，请点击播放重试。";
      throw new Error(message);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error("没有收到音频，请点击播放重试。");
    return blob;
  } catch (error) {
    if (!signal.aborted && error instanceof TypeError)
      throw new Error("无法连接语音服务，请检查网络后点击播放重试。");
    throw error;
  }
}
