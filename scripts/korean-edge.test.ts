import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { SpeechTimeoutError, synthesizeKoreanSpeech } from "../lib/korean-edge";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function audioFrame(payload: number[] | Uint8Array) {
  const header = new TextEncoder().encode(
    "Path:audio\r\nContent-Type:audio/mpeg\r\n",
  );
  const frame = new Uint8Array(2 + header.length + payload.length);
  frame[0] = header.length >>> 8;
  frame[1] = header.length & 255;
  frame.set(header, 2);
  frame.set(payload, 2 + header.length);
  return frame.buffer;
}

class FakeSocket extends EventTarget {
  binaryType = "";
  accepted = false;
  closeCount = 0;
  sent: string[] = [];
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  failSend = false;

  constructor(private onReady: (socket: FakeSocket) => void = () => {}) {
    super();
  }

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ) {
    super.addEventListener(type, callback, options);
    if (!callback) return;
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ) {
    super.removeEventListener(type, callback, options);
    if (callback) this.listeners.get(type)?.delete(callback);
  }

  accept() {
    this.accepted = true;
  }

  send(message: string) {
    if (this.failSend) throw new Error("Mock send failed");
    this.sent.push(message);
    if (this.sent.length === 2) queueMicrotask(() => this.onReady(this));
  }

  close() {
    this.closeCount += 1;
    this.dispatchEvent(new Event("close"));
  }

  message(data: string | ArrayBuffer) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  assertCleanedUp() {
    assert.equal(this.closeCount, 1);
    for (const listeners of this.listeners.values())
      assert.equal(listeners.size, 0);
  }
}

function upgraded(socket: FakeSocket) {
  return { status: 101, webSocket: socket } as unknown as Response;
}

test("collects complete audio, escapes SSML, and releases socket and abort listeners", async (t) => {
  const controller = new AbortController();
  const socket = new FakeSocket((ready) => {
    ready.message("Path:audio.metadata\r\n\r\n{}");
    ready.message(audioFrame([1, 2]));
    ready.message(audioFrame([3, 4]));
    ready.message("Path:turn.end\r\n\r\n");
  });
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.ok(init?.signal);
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.msedgeservices.com");
      assert.equal(url.pathname, "/tts/cognitiveservices/websocket/v1");
      assert.equal(url.searchParams.has("TrustedClientToken"), false);
      assert.equal(
        url.searchParams.get("Ocp-Apim-Subscription-Key"),
        "6A5AA1D4EAFF4E9FB37E23D68491D6F4",
      );
      assert.match(url.searchParams.get("Sec-MS-GEC") ?? "", /^[0-9A-F]{64}$/);
      assert.equal(
        url.searchParams.get("Sec-MS-GEC-Version"),
        "1-143.0.3650.75",
      );
      assert.equal(
        new Headers(init?.headers).get("Origin"),
        "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      );
      return upgraded(socket);
    },
  );
  const audio = await synthesizeKoreanSpeech('한국어 <&"\u0001', "B", {
    signal: controller.signal,
  });
  assert.equal(audio.type, "audio/mpeg");
  assert.deepEqual(
    [...new Uint8Array(await audio.arrayBuffer())],
    [1, 2, 3, 4],
  );
  assert.match(socket.sent[1], /InJoonNeural/);
  assert.match(
    socket.sent[0],
    /X-Timestamp:\w{3} \w{3} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT\+0000 \(Coordinated Universal Time\)\r\n/,
  );
  assert.match(
    socket.sent[1],
    /X-Timestamp:\w{3} \w{3} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT\+0000 \(Coordinated Universal Time\)Z\r\n/,
  );
  assert.match(socket.sent[1], /한국어 &lt;&amp;&quot; /);
  assert.doesNotMatch(socket.sent[1], /\u0001/);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  socket.assertCleanedUp();
});

test("rejects partial audio when the upstream closes before turn.end", async (t) => {
  const socket = new FakeSocket((ready) => {
    ready.message(audioFrame([0xff, 0xfb, 0]));
    ready.dispatchEvent(new Event("close"));
  });
  t.mock.method(globalThis, "fetch", async () => upgraded(socket));
  await assert.rejects(
    synthesizeKoreanSpeech("부분 음성", "A"),
    /closed before turn\.end/,
  );
  socket.assertCleanedUp();
});

test("rejects turn.end without any audio", async (t) => {
  const socket = new FakeSocket((ready) => ready.message("Path:turn.end\r\n"));
  t.mock.method(globalThis, "fetch", async () => upgraded(socket));
  await assert.rejects(synthesizeKoreanSpeech("빈 음성", "A"), /no audio/);
  socket.assertCleanedUp();
});

test("rejects socket errors and malformed binary headers", async (t) => {
  for (const failure of ["error", "malformed"] as const) {
    const socket = new FakeSocket((ready) => {
      if (failure === "error") ready.dispatchEvent(new Event("error"));
      else ready.message(new Uint8Array([0, 100, 1]).buffer);
    });
    t.mock.method(globalThis, "fetch", async () => upgraded(socket));
    await assert.rejects(
      synthesizeKoreanSpeech("오류 검사", "A"),
      failure === "error" ? /connection error/ : /invalid audio frame/,
    );
    socket.assertCleanedUp();
  }
});

test("cleans up when sending the initial protocol message throws", async (t) => {
  const socket = new FakeSocket();
  socket.failSend = true;
  t.mock.method(globalThis, "fetch", async () => upgraded(socket));
  await assert.rejects(
    synthesizeKoreanSpeech("전송 검사", "A"),
    /Mock send failed/,
  );
  socket.assertCleanedUp();
});

test("rejects audio above its byte budget and closes the connection", async (t) => {
  const socket = new FakeSocket((ready) =>
    ready.message(audioFrame([1, 2, 3])),
  );
  t.mock.method(globalThis, "fetch", async () => upgraded(socket));
  await assert.rejects(
    synthesizeKoreanSpeech("크기 검사", "A", { maxAudioBytes: 2 }),
    /size limit/,
  );
  socket.assertCleanedUp();
});

test("times out a stalled handshake even if fetch ignores cancellation, then discards a late socket", async (t) => {
  let resolveFetch!: (response: Response) => void;
  let upstreamSignal: AbortSignal | null | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    (_url: RequestInfo | URL, init?: RequestInit) => {
      upstreamSignal = init?.signal;
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    },
  );
  await assert.rejects(
    synthesizeKoreanSpeech("연결 시간 제한", "A", {
      handshakeTimeoutMs: 15,
      timeoutMs: 500,
    }),
    (error: unknown) => error instanceof SpeechTimeoutError,
  );
  assert.equal(upstreamSignal?.aborted, true);
  const socket = new FakeSocket();
  resolveFetch(upgraded(socket));
  await tick();
  assert.equal(socket.closeCount, 1);
});

test("the total deadline also covers an open socket that never sends turn.end", async (t) => {
  const socket = new FakeSocket((ready) => ready.message(audioFrame([1, 2])));
  t.mock.method(globalThis, "fetch", async () => upgraded(socket));
  await assert.rejects(
    synthesizeKoreanSpeech("전체 시간 제한", "A", {
      timeoutMs: 25,
      handshakeTimeoutMs: 500,
    }),
    (error: unknown) => error instanceof SpeechTimeoutError,
  );
  socket.assertCleanedUp();
});

test("request cancellation interrupts a handshake and removes its source listener", async (t) => {
  const controller = new AbortController();
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let upstreamSignal: AbortSignal | null | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    (_url: RequestInfo | URL, init?: RequestInit) => {
      upstreamSignal = init?.signal;
      markStarted();
      return new Promise<Response>(() => {});
    },
  );
  const synthesis = synthesizeKoreanSpeech("연결 취소", "A", {
    signal: controller.signal,
  });
  const rejected = assert.rejects(synthesis, { name: "AbortError" });
  await started;
  controller.abort();
  await rejected;
  assert.equal(upstreamSignal?.aborted, true);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("request cancellation closes an accepted socket without caching partial audio", async (t) => {
  const controller = new AbortController();
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const socket = new FakeSocket((connected) => {
    connected.message(audioFrame([1, 2]));
    markReady();
  });
  t.mock.method(globalThis, "fetch", async () => upgraded(socket));
  const synthesis = synthesizeKoreanSpeech("음성 취소", "A", {
    signal: controller.signal,
  });
  const rejected = assert.rejects(synthesis, { name: "AbortError" });
  await ready;
  controller.abort();
  await rejected;
  socket.assertCleanedUp();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("a request already aborted never opens an upstream connection", async (t) => {
  const controller = new AbortController();
  controller.abort();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Must not open the connection");
  });
  await assert.rejects(
    synthesizeKoreanSpeech("이미 취소", "A", { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("a refused upgrade cancels the unused HTTP response body", async (t) => {
  let cancelled = false;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 403 },
      ),
  );
  await assert.rejects(
    synthesizeKoreanSpeech("거절된 연결", "A"),
    /failed: 403/,
  );
  assert.equal(cancelled, true);
});
