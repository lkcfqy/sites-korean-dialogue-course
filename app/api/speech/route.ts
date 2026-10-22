import { SpeechTimeoutError, synthesizeKoreanSpeech } from "@/lib/korean-edge";
import { SPEAKER_VOICES } from "@/lib/korean-voices";

export const runtime = "edge";

const MAX_BODY_BYTES = 4 * 1024;
const BODY_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_SYNTHESIS = 4;
const MAX_CACHE_ENTRIES = 96;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type AudioCacheEntry = { audio: Blob; expiresAt: number };

// These bounds protect one Worker isolate. Global rate limiting belongs at the
// hosting gateway; isolate-local counters cannot enforce per-user/global quotas.
const audioCache = new Map<string, AudioCacheEntry>();
let cachedBytes = 0;
let activeSynthesis = 0;

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function errorResponse(message: string, status: number, retryAfter?: string) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        ...(retryAfter ? { "Retry-After": retryAfter } : {}),
      },
    },
  );
}

async function readJsonBody(request: Request): Promise<unknown> {
  request.signal.throwIfAborted();
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_BODY_BYTES
  ) {
    void request.body?.cancel().catch(() => {});
    throw new RequestError(413, "语音请求过大，请缩短文本后重试。");
  }
  if (!request.body) throw new RequestError(400, "语音请求格式有误。");

  const reader = request.body.getReader();
  let rejectRead!: (error: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectRead = reject;
  });
  const onAbort = () => {
    rejectRead(
      request.signal.reason ??
        new DOMException("Request aborted", "AbortError"),
    );
  };
  const timer = setTimeout(
    () => rejectRead(new RequestError(408, "语音请求读取超时，请重试。")),
    BODY_TIMEOUT_MS,
  );
  request.signal.addEventListener("abort", onAbort, { once: true });
  let completed = false;
  try {
    if (request.signal.aborted) onAbort();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) {
        completed = true;
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        throw new RequestError(413, "语音请求过大，请缩短文本后重试。");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onAbort);
    if (!completed) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function removeCachedAudio(key: string) {
  const entry = audioCache.get(key);
  if (!entry) return;
  cachedBytes -= entry.audio.size;
  audioCache.delete(key);
}

function getCachedAudio(key: string) {
  const entry = audioCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    removeCachedAudio(key);
    return null;
  }
  audioCache.delete(key);
  audioCache.set(key, entry);
  return entry.audio;
}

function cacheAudio(key: string, audio: Blob) {
  if (!audio.size || audio.size > MAX_CACHE_BYTES) return;
  const now = Date.now();
  for (const [cachedKey, entry] of audioCache) {
    if (entry.expiresAt <= now) removeCachedAudio(cachedKey);
  }
  removeCachedAudio(key);
  while (
    audioCache.size >= MAX_CACHE_ENTRIES ||
    cachedBytes + audio.size > MAX_CACHE_BYTES
  ) {
    const oldest = audioCache.keys().next().value;
    if (oldest === undefined) break;
    removeCachedAudio(oldest);
  }
  audioCache.set(key, { audio, expiresAt: now + CACHE_TTL_MS });
  cachedBytes += audio.size;
}

function audioResponse(audio: Blob, speaker: "A" | "B") {
  return new Response(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=86400",
      "X-Voice": SPEAKER_VOICES[speaker].id,
    },
  });
}

export async function POST(request: Request) {
  let text: unknown;
  let speaker: unknown;
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return errorResponse("语音请求必须使用 JSON 格式。", 415);
  }
  try {
    const body = await readJsonBody(request);
    text =
      body && typeof body === "object" && "text" in body
        ? body.text
        : undefined;
    speaker =
      body && typeof body === "object" && "speaker" in body
        ? body.speaker
        : "A";
  } catch (error) {
    if (request.signal.aborted) return errorResponse("语音请求已取消。", 499);
    if (error instanceof RequestError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("语音请求格式有误。", 400);
  }

  if (
    typeof text !== "string" ||
    text.length < 1 ||
    text.length > 240 ||
    !/[가-힣]/u.test(text)
  ) {
    return errorResponse("请选择一段韩语句子或词语。", 400);
  }
  if (speaker !== "A" && speaker !== "B") {
    return errorResponse("对话角色必须是 A 或 B。", 400);
  }

  if (request.signal.aborted) return errorResponse("语音请求已取消。", 499);
  const cacheKey = `${speaker}\0${text}`;
  const cached = getCachedAudio(cacheKey);
  if (cached) return audioResponse(cached, speaker);
  if (activeSynthesis >= MAX_CONCURRENT_SYNTHESIS) {
    return errorResponse("语音请求较多，请稍后重试。", 503, "2");
  }
  activeSynthesis += 1;
  try {
    const audio = await synthesizeKoreanSpeech(text, speaker, {
      signal: request.signal,
    });
    if (request.signal.aborted) return errorResponse("语音请求已取消。", 499);
    cacheAudio(cacheKey, audio);
    return audioResponse(audio, speaker);
  } catch (error) {
    if (request.signal.aborted) return errorResponse("语音请求已取消。", 499);
    if (error instanceof SpeechTimeoutError) {
      return errorResponse("韩语语音响应超时，请稍后重试。", 504);
    }
    // Log the message explicitly: Worker logs can otherwise omit Error.message.
    // Do not log the upstream URL, query credentials, or the learner's text.
    console.error("Korean speech synthesis failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown speech error",
    });
    return errorResponse("韩语语音暂时不可用，请稍后再试。", 502);
  } finally {
    activeSynthesis -= 1;
  }
}
