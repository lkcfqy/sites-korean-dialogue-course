import assert from "node:assert/strict";
import test from "node:test";
import {
  DialoguePlayer,
  type DialoguePlayerDependencies,
  type PlaybackItem,
} from "../lib/dialogue-player";
import {
  fetchKoreanAudio,
  SPEECH_REQUEST_TIMEOUT_MS,
} from "../lib/speech-request";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const items: PlaybackItem[] = [
  { id: "a", text: "첫 문장", speaker: "A" },
  { id: "b", text: "두 번째 문장", speaker: "B" },
];

test("network failure provides a retry instruction and a later request can succeed", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) throw new TypeError("Failed to fetch");
    return new Response(new Blob(["audio"]), { status: 200 });
  };
  try {
    const signal = new AbortController().signal;
    await assert.rejects(
      fetchKoreanAudio("안녕하세요", "A", signal),
      /检查网络.*播放重试/,
    );
    assert.equal((await fetchKoreanAudio("안녕하세요", "A", signal)).size, 5);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}
class FakeAudio {
  src = "";
  playbackRate = 1;
  onended: HTMLAudioElement["onended"] = null;
  onerror: HTMLAudioElement["onerror"] = null;
  playing = false;
  played: string[] = [];
  playFailure: Error | null = null;
  pendingPlay: ReturnType<typeof deferred<void>> | null = null;
  constructor(private autoEnd = false) {}
  play() {
    this.played.push(this.src);
    if (this.playFailure) return Promise.reject(this.playFailure);
    this.playing = true;
    if (this.autoEnd) queueMicrotask(() => this.end());
    return this.pendingPlay?.promise ?? Promise.resolve();
  }
  pause() {
    this.playing = false;
  }
  end() {
    this.playing = false;
    this.onended?.call(this as unknown as HTMLAudioElement, new Event("ended"));
  }
  error() {
    this.onerror?.call(this as unknown as HTMLAudioElement, new Event("error"));
  }
  assertReleased() {
    assert.equal(this.onended, null);
    assert.equal(this.onerror, null);
    assert.equal(this.playing, false);
    assert.equal(this.src, "");
  }
}
function setup(
  dependencies: Partial<DialoguePlayerDependencies> = {},
  autoEnd = false,
) {
  const audio: FakeAudio[] = [];
  const fetched: { text: string; speaker: string; signal: AbortSignal }[] = [];
  const liveUrls = new Map<string, number>();
  const revoked: string[] = [];
  let created = 0;
  const player = new DialoguePlayer({
    createAudio: () => {
      const element = new FakeAudio(autoEnd);
      audio.push(element);
      return element;
    },
    createObjectURL: (blob) => {
      const url = `blob:mock-${++created}`;
      liveUrls.set(url, blob.size);
      return url;
    },
    revokeObjectURL: (url) => {
      liveUrls.delete(url);
      revoked.push(url);
    },
    ...dependencies,
    fetchAudio: async (text, speaker, signal) => {
      fetched.push({ text, speaker, signal });
      return dependencies.fetchAudio
        ? dependencies.fetchAudio(text, speaker, signal)
        : new Blob(["audio"]);
    },
  });
  return { player, audio, fetched, liveUrls, revoked };
}

test("unavailable course speech stops with its error instead of using an installed device voice, then allows retry", async () => {
  const browserGlobals = ["window", "SpeechSynthesisUtterance"] as const;
  const descriptors = browserGlobals.map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  let deviceSpeechCalls = 0;
  class DeviceUtterance {
    lang = "";
    voice: unknown;
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      speechSynthesis: {
        getVoices: () => [{ lang: "ko-KR" }],
        speak: (utterance: DeviceUtterance) => {
          deviceSpeechCalls++;
          queueMicrotask(() => utterance.onend?.());
        },
        cancel: () => {},
      },
    },
  });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    value: DeviceUtterance,
  });
  let unavailable = true;
  const started: string[] = [];
  const completed: string[] = [];
  const { player, audio, fetched } = setup(
    {
      fetchAudio: async () => {
        if (unavailable) throw new Error("韩语语音暂时不可用，请稍后再试。");
        return new Blob(["audio"]);
      },
    },
    true,
  );
  try {
    const play = () =>
      player.play(
        items,
        1,
        1,
        0,
        (item) => started.push(item.id),
        (item) => completed.push(item.id),
      );
    await play();
    assert.equal(deviceSpeechCalls, 0);
    assert.deepEqual(started, []);
    assert.deepEqual(completed, []);
    assert.equal(audio.length, 0);
    assert.equal(fetched.length, 1);
    assert.deepEqual(player.getSnapshot(), {
      activeId: null,
      status: "韩语语音暂时不可用，请稍后再试。",
      playing: false,
      phase: "error",
    });
    unavailable = false;
    await play();
    assert.equal(deviceSpeechCalls, 0);
    assert.deepEqual(started, ["a", "b"]);
    assert.deepEqual(completed, ["a", "b"]);
    assert.equal(player.getSnapshot().phase, "ended");
  } finally {
    player.dispose();
    browserGlobals.forEach((key, index) => {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

test("completed audio is reported only after an actual end, never rejection or cancellation", async () => {
  const completed: string[] = [];
  const success = setup({}, true);
  await success.player.play(items, 1, 1, 0, undefined, (item) =>
    completed.push(item.id),
  );
  assert.deepEqual(completed, ["a", "b"]);
  success.player.dispose();
  const stopped = setup();
  const run = stopped.player.play(items, 1, 1, 0, undefined, (item) =>
    completed.push(item.id),
  );
  await tick();
  stopped.player.stop();
  await run;
  assert.deepEqual(completed, ["a", "b"]);
  const denied = new FakeAudio();
  denied.playFailure = new Error("autoplay denied");
  const failing = setup({ createAudio: () => denied });
  await failing.player.play(items, 1, 1, 0, undefined, (item) =>
    completed.push(item.id),
  );
  assert.deepEqual(completed, ["a", "b"]);
  failing.player.dispose();
});

test("role response slots do not fetch or play the hidden answer and cancellation stops the queue", async () => {
  const { player, fetched, audio } = setup({}, true);
  const callbacks: string[] = [];
  const done = player.play(
    [{ ...items[0], responseSeconds: 30 }, items[1]],
    1,
    1,
    0,
    (item) => callbacks.push(item.id),
  );
  await tick();
  assert.equal(player.getSnapshot().phase, "gap");
  assert.equal(player.getSnapshot().activeId, "a");
  assert.equal(fetched.length, 0);
  assert.equal(audio.length, 0);
  assert.deepEqual(callbacks, ["a"]);
  player.stop();
  await done;
  await tick();
  assert.equal(fetched.length, 0);
  assert.equal(player.getSnapshot().phase, "stopped");
  player.dispose();
});

test("a response slot hands back to the next speaker without synthesizing the learner's line", async () => {
  const { player, fetched } = setup({}, true);
  await player.play([{ ...items[0], responseSeconds: 0.001 }, items[1]], 1, 1);
  assert.deepEqual(
    fetched.map((x) => x.text),
    [items[1].text],
  );
  assert.equal(player.getSnapshot().phase, "ended");
  player.dispose();
});

test("invalid response waits are rejected before opening an audio request", async () => {
  for (const seconds of [-1, 0, Infinity, 61]) {
    const { player, fetched } = setup();
    await player.play([{ ...items[0], responseSeconds: seconds }], 1, 1);
    assert.equal(player.getSnapshot().phase, "error");
    assert.equal(fetched.length, 0);
    player.dispose();
  }
});

test("plays queues in order, repeats whole passes, calls onItem, and fetches only the next uncached item", async () => {
  const { player, audio, fetched } = setup();
  const callbacks: string[] = [];
  const done = player.play(items, 0.85, 2, 0, (item) =>
    callbacks.push(item.id),
  );
  try {
    await tick();
    assert.equal(fetched.length, 1);
    for (const id of ["a", "b", "a", "b"]) {
      await tick();
      assert.equal(player.getSnapshot().activeId, id);
      assert.equal(player.getSnapshot().playing, true);
      assert.equal(audio.at(-1)?.playbackRate, 0.85);
      audio.at(-1)?.end();
    }
    await done;
    assert.deepEqual(callbacks, ["a", "b", "a", "b"]);
    assert.deepEqual(
      fetched.map(({ text }) => text),
      items.map(({ text }) => text),
    );
    assert.equal(audio[0].played[0], audio[2].played[0]);
    assert.equal(player.getSnapshot().phase, "ended");
    assert.equal(player.getSnapshot().activeId, null);
    for (const element of audio) element.assertReleased();
  } finally {
    player.dispose();
  }
});

test("stop during preparation settles immediately, aborts the request, and ignores late audio", async () => {
  const pending = deferred<Blob>();
  const { player, audio, fetched, liveUrls } = setup({
    fetchAudio: () => pending.promise,
  });
  const done = player.play(items, 1, 1);
  await tick();
  assert.equal(player.getSnapshot().phase, "loading");
  player.stop();
  await done;
  assert.equal(fetched[0].signal.aborted, true);
  pending.resolve(new Blob(["late audio"]));
  await tick();
  assert.equal(audio.length, 0);
  assert.equal(liveUrls.size, 0);
  assert.equal(player.getSnapshot().phase, "stopped");
  player.dispose();
});

test("stop during playback clears all audio handlers and stale ended callbacks cannot resume", async () => {
  const { player, audio, fetched } = setup();
  const done = player.play(items, 1, 1);
  await tick();
  const oldEnded = audio[0].onended;
  player.stop();
  await done;
  audio[0].assertReleased();
  oldEnded?.call(audio[0] as unknown as HTMLAudioElement, new Event("ended"));
  await tick();
  assert.equal(fetched.length, 1);
  assert.equal(player.getSnapshot().playing, false);
  player.dispose();
});

test("stop during a gap clears the long timer without fetching the following line", async () => {
  const { player, audio, fetched } = setup();
  const done = player.play(items, 1, 1, 30);
  await tick();
  audio[0].end();
  await tick();
  assert.equal(player.getSnapshot().phase, "gap");
  audio[0].assertReleased();
  player.stop();
  await done;
  assert.equal(fetched.length, 1);
  assert.equal(player.getSnapshot().phase, "stopped");
  player.dispose();
});

test("a new run wins over a delayed request from the previous run", async () => {
  const oldRequest = deferred<Blob>();
  const { player, audio, liveUrls } = setup({
    fetchAudio: (text) =>
      text === items[0].text
        ? oldRequest.promise
        : Promise.resolve(new Blob([text])),
  });
  const oldRun = player.play([items[0]], 1, 1);
  await tick();
  const newRun = player.play([items[1]], 1.3, 1);
  await oldRun;
  await tick();
  oldRequest.resolve(new Blob(["stale"]));
  await tick();
  assert.equal(audio.length, 1);
  assert.equal(liveUrls.size, 1);
  assert.equal(player.getSnapshot().activeId, "b");
  assert.equal(audio[0].playbackRate, 1.3);
  audio[0].end();
  await newRun;
  player.dispose();
});

test("late play rejection from an old audio element cannot fail the new run", async () => {
  const pendingPlay = deferred<void>();
  const created: FakeAudio[] = [];
  const { player } = setup({
    createAudio: () => {
      const audio = new FakeAudio();
      if (!created.length) audio.pendingPlay = pendingPlay;
      created.push(audio);
      return audio;
    },
  });
  const oldRun = player.play([items[0]], 1, 1);
  await tick();
  const newRun = player.play([items[1]], 1, 1);
  await oldRun;
  await tick();
  pendingPlay.reject(new Error("Late browser rejection"));
  await tick();
  created[0].assertReleased();
  assert.equal(player.getSnapshot().activeId, "b");
  assert.equal(player.getSnapshot().phase, "playing");
  created[1].end();
  await newRun;
  player.dispose();
});

test("empty/infinite queues return, while a nonempty loop can be stopped by onItem", async () => {
  const { player, fetched, audio } = setup({}, true);
  await player.play([], 1, "∞");
  assert.equal(fetched.length, 0);
  assert.equal(player.getSnapshot().playing, false);
  let callbacks = 0;
  await player.play(items, 1, "∞", 0, () => {
    if (++callbacks === 5) player.stop();
  });
  assert.equal(callbacks, 5);
  assert.equal(fetched.length, 2);
  assert.equal(player.getSnapshot().phase, "stopped");
  audio.forEach((element) => element.assertReleased());
  player.dispose();
});

test("request failures, empty audio, and browser play failures release resources and allow retry", async () => {
  for (const failure of ["request", "empty", "play", "audio-event"] as const) {
    let fail = true;
    const created: FakeAudio[] = [];
    const { player, liveUrls, fetched } = setup({
      fetchAudio: async () => {
        if (fail && failure === "request") throw new Error("请求失败");
        return new Blob(fail && failure === "empty" ? [] : ["audio"]);
      },
      createAudio: () => {
        const audio = new FakeAudio(!(fail && failure === "audio-event"));
        if (fail && failure === "play")
          audio.playFailure = new Error("Browser denied play");
        created.push(audio);
        return audio;
      },
    });
    const done = player.play([items[0]], 1, 1);
    if (failure === "audio-event") {
      await tick();
      created[0].error();
    }
    await done;
    assert.equal(player.getSnapshot().phase, "error");
    assert.equal(player.getSnapshot().playing, false);
    assert.equal(liveUrls.size, 0);
    created.forEach((element) => element.assertReleased());
    fail = false;
    await player.play([items[0]], 1, 1);
    assert.equal(fetched.length, 2);
    assert.equal(player.getSnapshot().phase, "ended");
    player.dispose();
    assert.equal(liveUrls.size, 0);
  }
});

test("onItem errors and audio creation errors also release cached resources", async () => {
  for (const creationError of [false, true]) {
    const { player, liveUrls } = setup(
      creationError
        ? {
            createAudio: () => {
              throw new Error("Audio constructor failed");
            },
          }
        : {},
      true,
    );
    await player.play([items[0]], 1, 1, 0, () => {
      throw new Error("Position callback failed");
    });
    assert.equal(player.getSnapshot().phase, "error");
    assert.equal(liveUrls.size, 0);
    player.dispose();
  }
});

test("the default HTTP request has a 40-second deadline, including stalled audio body reads", async (t) => {
  assert.equal(SPEECH_REQUEST_TIMEOUT_MS, 40_000);
  const originalTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((
    callback: () => void,
    delay?: number,
  ) =>
    originalTimeout(
      callback,
      delay === 40_000 ? 10 : delay,
    )) as typeof setTimeout);
  for (const stalledBody of [false, true]) {
    let upstreamSignal: AbortSignal | null | undefined;
    t.mock.method(
      globalThis,
      "fetch",
      (_url: RequestInfo | URL, init?: RequestInit) => {
        upstreamSignal = init?.signal;
        return stalledBody
          ? Promise.resolve(new Response(new ReadableStream()))
          : new Promise<Response>(() => {});
      },
    );
    const { player, liveUrls } = setup({ fetchAudio: fetchKoreanAudio });
    await player.play([items[0]], 1, 1);
    assert.equal(player.getSnapshot().phase, "error");
    assert.match(player.getSnapshot().status, /超时/);
    assert.equal(upstreamSignal?.aborted, true);
    assert.equal(liveUrls.size, 0);
    player.dispose();
  }
});

test("LRU cache is bounded by 150 entries and hits keep recently used audio", async () => {
  const { player, fetched, liveUrls, revoked } = setup({}, true);
  const item = (index: number): PlaybackItem => ({
    id: `${index}`,
    text: `문장 ${index}`,
    speaker: "A",
  });
  await player.play(
    Array.from({ length: 150 }, (_value, index) => item(index)),
    1,
    1,
  );
  assert.equal(liveUrls.size, 150);
  await player.play([item(0)], 1, 1);
  assert.equal(fetched.length, 150);
  await player.play([item(150)], 1, 1);
  assert.ok(revoked.includes("blob:mock-2"));
  await player.play([item(0)], 1, 1);
  assert.equal(fetched.length, 151);
  await player.play([item(1)], 1, 1);
  assert.equal(fetched.length, 152);
  assert.equal(liveUrls.size, 150);
  player.dispose();
  assert.equal(liveUrls.size, 0);
});

test("cache also obeys the 8 MiB byte budget and releases uncached oversized audio", async () => {
  const blob = new Blob([new Uint8Array(2 * 1024 * 1024)]);
  const { player, liveUrls } = setup({ fetchAudio: async () => blob }, true);
  await player.play(
    Array.from({ length: 5 }, (_value, index) => ({
      ...items[0],
      text: `바이트 ${index}`,
    })),
    1,
    1,
  );
  assert.equal(liveUrls.size, 4);
  assert.equal(
    [...liveUrls.values()].reduce((total, bytes) => total + bytes, 0),
    8 * 1024 * 1024,
  );
  player.dispose();
  const large = new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]);
  const oversized = setup({ fetchAudio: async () => large }, true);
  await oversized.player.play([items[0]], 1, 2);
  assert.equal(oversized.fetched.length, 2);
  assert.equal(oversized.liveUrls.size, 0);
  oversized.player.dispose();
});

test("the same text in different voices has different cache entries", async () => {
  const { player, fetched, audio } = setup({}, true);
  await player.play(
    [
      { ...items[0], speaker: "A" },
      { ...items[0], speaker: "B" },
    ],
    1,
    2,
  );
  assert.equal(fetched.length, 2);
  assert.notEqual(audio[0].played[0], audio[1].played[0]);
  assert.equal(audio[0].played[0], audio[2].played[0]);
  player.dispose();
});

test("dispose releases audio and URLs while allowing a React Strict Mode remount", async () => {
  const { player, audio, liveUrls } = setup();
  const first = player.play([items[0]], 1, 1);
  await tick();
  player.dispose();
  await first;
  assert.equal(liveUrls.size, 0);
  audio[0].assertReleased();
  const second = player.play([items[1]], 1, 1);
  await tick();
  audio[1].end();
  await second;
  assert.equal(player.getSnapshot().phase, "ended");
  player.dispose();
});
