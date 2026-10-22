import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/speech/route";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeRequest(body: unknown, signal?: AbortSignal) {
  return new Request("https://app.local/api/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

function streamingRequest(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  headers: Record<string, string> = {},
) {
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: stream,
    signal,
    duplex: "half",
  };
  return new Request("https://app.local/api/speech", init);
}

class RouteSocket extends EventTarget {
  binaryType = "";
  closeCount = 0;
  sentCount = 0;

  constructor(private onReady: (socket: RouteSocket) => void = () => {}) {
    super();
  }

  accept() {}

  send() {
    if (++this.sentCount === 2) queueMicrotask(() => this.onReady(this));
  }

  close() {
    this.closeCount += 1;
  }

  complete(bytes: Uint8Array = new Uint8Array([1, 2, 3])) {
    const header = new TextEncoder().encode(
      "Path:audio\r\nContent-Type:audio/mpeg\r\n",
    );
    const frame = new Uint8Array(2 + header.length + bytes.length);
    frame[0] = header.length >>> 8;
    frame[1] = header.length & 255;
    frame.set(header, 2);
    frame.set(bytes, header.length + 2);
    this.dispatchEvent(new MessageEvent("message", { data: frame.buffer }));
    this.dispatchEvent(
      new MessageEvent("message", { data: "Path:turn.end\r\n" }),
    );
  }
}

function successfulUpgrade(bytes?: Uint8Array) {
  const socket = new RouteSocket((ready) => ready.complete(bytes));
  return { status: 101, webSocket: socket } as unknown as Response;
}

test("validates JSON, Korean text, speaker, and content type before opening an upstream", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Validation must not fetch");
  });
  for (const body of [
    null,
    { text: 42 },
    { text: "English only" },
    { text: "가".repeat(241) },
    { text: "한국어", speaker: "C" },
  ]) {
    const response = await POST(makeRequest(body));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  const malformed = new Request("https://app.local/api/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal((await POST(malformed)).status, 400);
  const wrongType = new Request("https://app.local/api/speech", {
    method: "POST",
    body: JSON.stringify({ text: "한국어" }),
  });
  assert.equal((await POST(wrongType)).status, 415);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("enforces the byte limit for declared and chunked bodies and cancels the stream", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Oversized body must not fetch");
  });
  for (const declared of [false, true]) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4097));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await POST(
      streamingRequest(
        stream,
        undefined,
        declared ? { "Content-Length": "4097" } : {},
      ),
    );
    assert.equal(response.status, 413);
    assert.equal(cancelled, true);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("cancellation and a read deadline release a stalled incoming body", async (t) => {
  const originalSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((
    callback: () => void,
    delay?: number,
  ) =>
    originalSetTimeout(
      callback,
      delay === 10_000 ? 10 : delay,
    )) as typeof setTimeout);
  for (const abortRequest of [true, false]) {
    let cancelled = false;
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const response = POST(streamingRequest(stream, controller.signal));
    if (abortRequest) controller.abort();
    assert.equal((await response).status, abortRequest ? 499 : 408);
    assert.equal(cancelled, true);
  }
});

test("caches completed audio by text and voice and expires it after 24 hours", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    successfulUpgrade(),
  );
  const text = "음성 캐시 검사";
  const first = await POST(makeRequest({ text }));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Content-Type"), "audio/mpeg");
  assert.match(first.headers.get("X-Voice") ?? "", /SunHi/);
  assert.equal((await POST(makeRequest({ text, speaker: "A" }))).status, 200);
  assert.equal(fetchMock.mock.callCount(), 1);
  const secondVoice = await POST(makeRequest({ text, speaker: "B" }));
  assert.match(secondVoice.headers.get("X-Voice") ?? "", /InJoon/);
  assert.equal(fetchMock.mock.callCount(), 2);
  now += 24 * 60 * 60 * 1000 + 1;
  assert.equal((await POST(makeRequest({ text }))).status, 200);
  assert.equal(fetchMock.mock.callCount(), 3);
});

test("failed or incomplete synthesis never enters the cache and can be retried", async (t) => {
  t.mock.method(console, "error", () => {});
  let fail = true;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    if (!fail) return successfulUpgrade();
    const socket = new RouteSocket((ready) =>
      ready.dispatchEvent(new Event("close")),
    );
    return { status: 101, webSocket: socket } as unknown as Response;
  });
  const request = () => makeRequest({ text: "실패 후 다시 검사" });
  assert.equal((await POST(request())).status, 502);
  fail = false;
  assert.equal((await POST(request())).status, 200);
  assert.equal((await POST(request())).status, 200);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("limits synthesis concurrency in this isolate, then frees a slot after cancellation", async (t) => {
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const sockets: RouteSocket[] = [];
  let markStarted!: () => void;
  const allStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  t.mock.method(globalThis, "fetch", async () => {
    const socket = new RouteSocket(() => {
      if (sockets.length === 4) markStarted();
    });
    sockets.push(socket);
    return { status: 101, webSocket: socket } as unknown as Response;
  });
  const requests = controllers.map((controller, index) =>
    POST(makeRequest({ text: `동시 요청 ${index}` }, controller.signal)),
  );
  try {
    await allStarted;
    const busy = await POST(makeRequest({ text: "다섯 번째 요청" }));
    assert.equal(busy.status, 503);
    assert.equal(busy.headers.get("Retry-After"), "2");
    controllers[0].abort();
    assert.equal((await requests[0]).status, 499);
    assert.equal(sockets[0].closeCount, 1);
    t.mock.method(globalThis, "fetch", async () => successfulUpgrade());
    assert.equal(
      (await POST(makeRequest({ text: "취소 후 새 요청" }))).status,
      200,
    );
  } finally {
    controllers.forEach((controller) => controller.abort());
    await Promise.all(requests);
  }
  for (const socket of sockets) assert.equal(socket.closeCount, 1);
});

test("returns a gateway timeout when the upstream handshake misses its deadline", async (t) => {
  const originalSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((
    callback: () => void,
    delay?: number,
  ) =>
    originalSetTimeout(
      callback,
      delay === 8_000 ? 10 : delay,
    )) as typeof setTimeout);
  t.mock.method(globalThis, "fetch", () => new Promise<Response>(() => {}));
  const response = await POST(makeRequest({ text: "서버 시간 제한 검사" }));
  assert.equal(response.status, 504);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("evicts the least recently used entries at the cache count limit", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    successfulUpgrade(),
  );
  const request = (index: number) =>
    makeRequest({ text: `캐시 개수 ${index}` });
  for (let index = 0; index < 96; index++) {
    assert.equal((await POST(request(index))).status, 200);
  }
  assert.equal((await POST(request(0))).status, 200);
  assert.equal(fetchMock.mock.callCount(), 96);
  assert.equal((await POST(request(96))).status, 200);
  assert.equal((await POST(request(0))).status, 200);
  assert.equal(fetchMock.mock.callCount(), 97);
  assert.equal((await POST(request(1))).status, 200);
  assert.equal(fetchMock.mock.callCount(), 98);
});

test("also bounds cached audio by total bytes", async (t) => {
  const bytes = new Uint8Array(2 * 1024 * 1024);
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    successfulUpgrade(bytes),
  );
  const request = (index: number) =>
    makeRequest({ text: `캐시 바이트 ${index}` });
  for (let index = 0; index < 5; index++) {
    assert.equal((await POST(request(index))).status, 200);
  }
  assert.equal(fetchMock.mock.callCount(), 5);
  assert.equal((await POST(request(0))).status, 200);
  assert.equal(fetchMock.mock.callCount(), 6);
  await tick();
});
