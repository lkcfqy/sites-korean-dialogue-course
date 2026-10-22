import { SPEAKER_VOICES, type Speaker } from "./korean-voices";

// The Edge Read Aloud protocol is unofficial and may change without notice.
// This implementation uses Cloudflare's outbound WebSocket upgrade support.
const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const VERSION = "143.0.3650.75";
// The legacy Bing readaloud endpoint now rejects synthesis upgrades with 403.
// The current Microsoft endpoint accepts the same voices and GEC v1 token.
const ENDPOINT =
  "https://api.msedgeservices.com/tts/cognitiveservices/websocket/v1";
const HANDSHAKE_TIMEOUT_MS = 8_000;
const TOTAL_TIMEOUT_MS = 25_000;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

type WebSocketResponse = Response & { webSocket?: WebSocket };

export type SpeechOptions = {
  signal?: AbortSignal;
  handshakeTimeoutMs?: number;
  timeoutMs?: number;
  maxAudioBytes?: number;
};

export class SpeechTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeechTimeoutError";
  }
}

function hex(bytes: Uint8Array) {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

async function edgeToken() {
  const seconds = Math.floor(Date.now() / 1000) + 11644473600;
  const rounded = seconds - (seconds % 300);
  const ticks = (rounded * 10000000).toFixed(0);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(ticks + TOKEN),
  );
  return hex(new Uint8Array(digest));
}

function escapeXml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] || character,
  );
}

function stamp() {
  return new Date()
    .toUTCString()
    .replace(
      /^(\w+), (\d+) (\w+) (\d+) (\S+) GMT$/,
      "$1 $3 $2 $4 $5 GMT+0000 (Coordinated Universal Time)",
    );
}

function randomHex() {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

function speechMessages(text: string, requestId: string, speaker: Speaker) {
  const config =
    `X-Timestamp:${stamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled: "false",
              wordBoundaryEnabled: "true",
            },
            outputFormat: "audio-24khz-48kbitrate-mono-mp3",
          },
        },
      },
    }) +
    "\r\n";
  const cleanText = text.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
    " ",
  );
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ko-KR'><voice name='${SPEAKER_VOICES[speaker].edgeName}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(cleanText)}</prosody></voice></speak>`;
  const request = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`;
  return { config, request };
}

function closeSocket(socket: WebSocket) {
  try {
    socket.close();
  } catch {
    // An abandoned upgrade may still need acceptance before it can be closed.
    try {
      socket.accept();
      socket.close();
    } catch {
      // Already closed or rejected by the runtime.
    }
  }
}

function discardResponse(response: WebSocketResponse) {
  if (response.webSocket) closeSocket(response.webSocket);
  else void response.body?.cancel().catch(() => {});
}

function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  discard?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(
        signal.reason ??
          new DOMException("Speech request aborted", "AbortError"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        if (settled) {
          discard?.(value);
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

function receiveAudio(
  socket: WebSocket,
  config: string,
  request: string,
  signal: AbortSignal,
  maxAudioBytes: number,
): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const parts: Uint8Array[] = [];
    let byteLength = 0;
    let settled = false;

    function done(error?: unknown) {
      if (settled) return;
      settled = true;
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else if (!parts.length)
        reject(new Error("Korean speech returned no audio"));
      else resolve(parts);
    }

    function onMessage(event: MessageEvent) {
      if (settled) return;
      if (typeof event.data === "string") {
        if (/^Path:turn\.end\r?$/m.test(event.data)) done();
        return;
      }
      if (!(event.data instanceof ArrayBuffer)) return;
      const frame = new Uint8Array(event.data);
      if (frame.length < 2) {
        done(new Error("Korean speech returned an invalid audio frame"));
        return;
      }
      const headerLength = frame[0] * 256 + frame[1];
      if (frame.length < headerLength + 2) {
        done(new Error("Korean speech returned an invalid audio frame"));
        return;
      }
      const header = new TextDecoder().decode(
        frame.subarray(2, headerLength + 2),
      );
      if (
        /^Path:audio\r?$/m.test(header) &&
        /Content-Type:audio\/mpeg/.test(header)
      ) {
        const payload = frame.subarray(headerLength + 2);
        byteLength += payload.length;
        if (byteLength > maxAudioBytes) {
          done(new Error("Korean speech audio exceeded the size limit"));
          return;
        }
        if (payload.length) parts.push(payload.slice());
      }
    }

    function onClose() {
      done(new Error("Korean speech connection closed before turn.end"));
    }

    function onError() {
      done(new Error("Korean speech connection error"));
    }

    function onAbort() {
      done(
        signal.reason ??
          new DOMException("Speech request aborted", "AbortError"),
      );
    }

    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    try {
      socket.binaryType = "arraybuffer";
      socket.accept();
      socket.send(config);
      socket.send(request);
    } catch (error) {
      done(error);
    }
  });
}

export async function synthesizeKoreanSpeech(
  text: string,
  speaker: Speaker,
  options: SpeechOptions = {},
): Promise<Blob> {
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abortFromRequest, { once: true });
  if (options.signal?.aborted) abortFromRequest();
  const totalTimer = setTimeout(
    () => controller.abort(new SpeechTimeoutError("Korean speech timed out")),
    options.timeoutMs ?? TOTAL_TIMEOUT_MS,
  );
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocket | undefined;

  try {
    controller.signal.throwIfAborted();
    const url = new URL(ENDPOINT);
    url.searchParams.set("Ocp-Apim-Subscription-Key", TOKEN);
    url.searchParams.set(
      "Sec-MS-GEC",
      await abortable(edgeToken(), controller.signal),
    );
    url.searchParams.set("Sec-MS-GEC-Version", `1-${VERSION}`);
    url.searchParams.set("ConnectionId", crypto.randomUUID().replace(/-/g, ""));
    controller.signal.throwIfAborted();
    handshakeTimer = setTimeout(
      () =>
        controller.abort(
          new SpeechTimeoutError("Korean speech handshake timed out"),
        ),
      options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
    );
    const response = await abortable(
      fetch(url, {
        signal: controller.signal,
        headers: {
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0`,
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
          Cookie: `muid=${randomHex()};`,
        },
      }) as Promise<WebSocketResponse>,
      controller.signal,
      discardResponse,
    );
    clearTimeout(handshakeTimer);
    if (response.status !== 101 || !response.webSocket) {
      discardResponse(response);
      throw new Error(`Korean speech connection failed: ${response.status}`);
    }

    socket = response.webSocket;
    controller.signal.throwIfAborted();
    const { config, request } = speechMessages(
      text,
      crypto.randomUUID().replace(/-/g, ""),
      speaker,
    );
    const audioParts = await receiveAudio(
      socket,
      config,
      request,
      controller.signal,
      options.maxAudioBytes ?? MAX_AUDIO_BYTES,
    );
    controller.signal.throwIfAborted();
    const byteLength = audioParts.reduce(
      (total, part) => total + part.length,
      0,
    );
    const audio = new Uint8Array(byteLength);
    let offset = 0;
    for (const part of audioParts) {
      audio.set(part, offset);
      offset += part.length;
    }
    return new Blob([audio.buffer], { type: "audio/mpeg" });
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(handshakeTimer);
    options.signal?.removeEventListener("abort", abortFromRequest);
    if (socket) closeSocket(socket);
  }
}
