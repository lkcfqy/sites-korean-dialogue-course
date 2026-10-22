import test from "node:test";
import assert from "node:assert/strict";
import { VocabularyPlayer } from "../lib/vocabulary-player";
import vocabulary from "../data/vocabulary.json";

const words = [
  { ko: "배우다", zh: "学习" },
  { ko: "한국어", zh: "韩语" },
];
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

class FakeAudio {
  src = "";
  currentTime = 0;
  playbackRate = 1;
  onended: HTMLAudioElement["onended"] = null;
  onerror: HTMLAudioElement["onerror"] = null;
  playing = false;
  played: string[] = [];
  async play() {
    this.playing = true;
    this.played.push(this.src);
  }
  pause() {
    this.playing = false;
  }
  end() {
    this.playing = false;
    this.onended?.call(this as unknown as HTMLAudioElement, new Event("ended"));
  }
}

function setup(
  fetchAudio?: (text: string, signal: AbortSignal) => Promise<Blob>,
) {
  const audio = new FakeAudio();
  const fetched: string[] = [];
  const player = new VocabularyPlayer(words, {
    createAudio: () => audio,
    gap: 0,
    fetchAudio:
      fetchAudio ||
      (async (text) => {
        fetched.push(text);
        return new Blob([text]);
      }),
  });
  return { audio, fetched, player };
}

test("repeats each word before advancing, reuses audio, and ends at the last word", async () => {
  const { audio, fetched, player } = setup();
  const done = player.play();
  try {
    for (const [index, repetition] of [
      [0, 1],
      [0, 2],
      [1, 1],
      [1, 2],
    ]) {
      await tick();
      assert.equal(player.getSnapshot().index, index);
      assert.equal(player.getSnapshot().repetition, repetition);
      audio.end();
    }
    await done;
    assert.equal(player.getSnapshot().phase, "ended");
    assert.deepEqual(fetched, ["배우다", "한국어"]);
    assert.equal(audio.played.length, 4);
    assert.equal(audio.played[0], audio.played[1]);
    assert.equal(audio.played[2], audio.played[3]);
  } finally {
    player.dispose();
  }
});

test("pausing during a speech request prevents playback until resumed", async () => {
  let resolveAudio!: (blob: Blob) => void;
  const { audio, player } = setup(
    () =>
      new Promise((resolve) => {
        resolveAudio = resolve;
      }),
  );
  const done = player.play();
  await tick();
  player.pause();
  resolveAudio(new Blob(["audio"]));
  await tick();
  assert.equal(player.getSnapshot().phase, "paused");
  assert.equal(audio.played.length, 0);
  player.resume();
  await tick();
  assert.equal(audio.played.length, 1);
  player.dispose();
  await done;
});

test("pause and resume preserve the audio position and live speed changes", async () => {
  const { audio, player } = setup();
  const done = player.play();
  await tick();
  audio.currentTime = 0.45;
  player.pause();
  assert.equal(audio.playing, false);
  player.setSpeed(0.7);
  player.resume();
  assert.equal(audio.currentTime, 0.45);
  assert.equal(audio.playbackRate, 0.7);
  assert.equal(player.getSnapshot().index, 0);
  player.dispose();
  await done;
});

test("selecting another word cancels stale speech requests without starting audio", async () => {
  let resolveAudio!: (blob: Blob) => void;
  let signal!: AbortSignal;
  const { audio, player } = setup((_text, incoming) => {
    signal = incoming;
    return new Promise((resolve) => {
      resolveAudio = resolve;
    });
  });
  const done = player.play();
  await tick();
  player.select(1);
  assert.equal(signal.aborted, true);
  resolveAudio(new Blob(["stale"]));
  await done;
  assert.equal(audio.played.length, 0);
  assert.equal(player.getSnapshot().index, 1);
  assert.equal(player.getSnapshot().phase, "idle");
  player.dispose();
});

test("single-word play honors repetition count and never continues into the next word", async () => {
  const { audio, player } = setup();
  player.setRepeats(3);
  const done = player.play(0, true);
  for (let i = 0; i < 3; i++) {
    await tick();
    audio.end();
  }
  await done;
  assert.equal(audio.played.length, 3);
  assert.equal(player.getSnapshot().index, 0);
  assert.equal(player.getSnapshot().phase, "ended");
  player.dispose();
});

test("failed speech requests show an error and can be retried", async () => {
  let failed = false;
  const { audio, player } = setup(async () => {
    if (!failed) {
      failed = true;
      throw new Error("语音暂时不可用");
    }
    return new Blob(["audio"]);
  });
  await player.play(0, true);
  assert.equal(player.getSnapshot().phase, "error");
  player.setRepeats(1);
  const retry = player.play(0, true);
  await tick();
  audio.end();
  await retry;
  assert.equal(player.getSnapshot().phase, "ended");
  assert.equal(player.getSnapshot().error, "");
  player.dispose();
});

test("course vocabulary has unique headwords and normalized everyday meanings", () => {
  assert.equal(
    new Set(vocabulary.map((word) => word.ko)).size,
    vocabulary.length,
  );
  assert(
    vocabulary.every(
      (word) => /^[가-힣 ]+$/.test(word.ko) && /[\u4e00-\u9fff]/.test(word.zh),
    ),
  );
  const dict = new Map(vocabulary.map((word) => [word.ko, word.zh]));
  assert.equal(dict.get("배우다"), "学习");
  assert.equal(dict.get("있다"), "有；在");
  assert.equal(dict.get("전문가"), "专家");
  for (const nonHeadword of [
    "민지",
    "왕리",
    "배우고",
    "것이",
    "제가",
    "새로운",
    "같은",
    "다른",
  ])
    assert(!dict.has(nonHeadword));
});

test("default HTTP speech fetch times out after 40 seconds and can be retried", async (t) => {
  const originalTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((
    callback: () => void,
    delay?: number,
  ) =>
    originalTimeout(
      callback,
      delay === 40_000 ? 10 : delay,
    )) as typeof setTimeout);
  let signal: AbortSignal | null | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    },
  );
  const audio = new FakeAudio();
  const player = new VocabularyPlayer(words, {
    createAudio: () => audio,
    gap: 0,
  });
  player.setRepeats(1);
  try {
    await player.play(0, true);
    assert.equal(player.getSnapshot().phase, "error");
    assert.match(player.getSnapshot().error, /超时/);
    assert.equal(signal?.aborted, true);
    assert.equal(audio.played.length, 0);
    t.mock.method(
      globalThis,
      "fetch",
      async () => new Response(new Blob(["audio"])),
    );
    const retry = player.play(0, true);
    await tick();
    audio.end();
    await retry;
    assert.equal(player.getSnapshot().phase, "ended");
    assert.equal(audio.onended, null);
    assert.equal(audio.onerror, null);
  } finally {
    player.dispose();
  }
});

test("default HTTP speech fetch can be cancelled even when fetch ignores the signal", async (t) => {
  let signal: AbortSignal | null | undefined;
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    },
  );
  const audio = new FakeAudio();
  const player = new VocabularyPlayer(words, {
    createAudio: () => audio,
    gap: 0,
  });
  const done = player.play(0, true);
  await tick();
  player.select(1);
  await done;
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(signal?.aborted, true);
  assert.equal(player.getSnapshot().index, 1);
  assert.equal(player.getSnapshot().phase, "idle");
  assert.equal(audio.played.length, 0);
  player.dispose();
});
