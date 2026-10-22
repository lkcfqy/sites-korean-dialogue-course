import {
  DIALOGUE_MEMORY_EVENT,
  DIALOGUE_MEMORY_KEY,
  dialogueLineKey,
  isDialogueSentenceMemory,
  mergeDialogueMemory,
  parseDialogueMemoryStrict,
  type DialogueMemory,
  type DialogueSentenceMemory,
  type DialogueSource,
} from "./dialogue-memory";
import { isRecord, isTimestamp } from "./study-validation";

export const DIALOGUE_DATABASE_NAME = "korean-dialogue-memory-v1";
const STORE = "sentences";
type LegacyStorage = Pick<Storage, "getItem" | "removeItem">;
type StoredSentence = { key: string; value: DialogueSentenceMemory };
export type DialogueMemoryRepository = {
  load(): Promise<DialogueMemory>;
  loadSentence(
    source: DialogueSource,
  ): Promise<DialogueSentenceMemory | undefined>;
  update(
    source: DialogueSource,
    now: number,
    change: (
      previous: DialogueSentenceMemory | undefined,
    ) => DialogueSentenceMemory,
  ): Promise<DialogueSentenceMemory>;
  merge(incoming: DialogueMemory): Promise<void>;
  close(): Promise<void>;
};

let channel: BroadcastChannel | undefined;
function announceUpdate() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(DIALOGUE_MEMORY_EVENT));
  } catch {
    /* Persistence already succeeded. */
  }
  try {
    channel?.postMessage({ kind: DIALOGUE_MEMORY_EVENT });
  } catch {
    /* The local update remains saved. */
  }
}
function listenForUpdates() {
  if (
    channel ||
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined"
  )
    return;
  try {
    channel = new BroadcastChannel(DIALOGUE_MEMORY_EVENT);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (isRecord(event.data) && event.data.kind === DIALOGUE_MEMORY_EVENT)
        window.dispatchEvent(new Event(DIALOGUE_MEMORY_EVENT));
    };
  } catch {
    /* The calling tab still receives its normal update event. */
  }
}

function storedRecord(value: unknown, key?: string): StoredSentence {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    !isDialogueSentenceMemory(value.value) ||
    dialogueLineKey(value.value) !== value.key ||
    (key !== undefined && value.key !== key)
  )
    throw new Error("已有句子数据库记录损坏，无法安全读取或覆盖。");
  return value as StoredSentence;
}

/** Requests and mutations stay in a single native transaction, including cross-tab writes. */
export function createDialogueMemoryRepository(options: {
  indexedDB: IDBFactory;
  storage: LegacyStorage;
  name?: string;
  onUpdated?: () => void;
}): DialogueMemoryRepository {
  let opened: Promise<IDBDatabase> | undefined;
  let preparing: Promise<IDBDatabase> | undefined;
  const notify = () => {
    try {
      (options.onUpdated ?? announceUpdate)();
    } catch {
      /* Never falsify a committed save. */
    }
  };
  function open() {
    if (opened) return opened;
    opened = new Promise<IDBDatabase>((resolve, reject) => {
      const request = options.indexedDB.open(
        options.name ?? DIALOGUE_DATABASE_NAME,
        1,
      );
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE, { keyPath: "key" });
      };
      request.onerror = () => {
        opened = undefined;
        reject(request.error ?? new Error("无法打开句子数据库。"));
      };
      request.onblocked = () => {
        opened = undefined;
        reject(
          new Error("其他标签页阻止了句子数据库更新，请关闭旧页面后重试。"),
        );
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          opened = undefined;
        };
        resolve(database);
      };
    });
    return opened;
  }

  function mergeInto(
    database: IDBDatabase,
    incoming: DialogueMemory,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      let failure: unknown;
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(
          failure ?? transaction.error ?? new Error("句子数据库事务失败。"),
        );
      for (const [key, record] of Object.entries(incoming)) {
        if (
          !isDialogueSentenceMemory(record) ||
          dialogueLineKey(record) !== key
        ) {
          failure = new Error("导入的句子记录损坏。");
          transaction.abort();
          break;
        }
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            const previous =
              request.result === undefined
                ? undefined
                : storedRecord(request.result, key).value;
            const merged = previous
              ? mergeDialogueMemory({ [key]: previous }, { [key]: record })[key]
              : record;
            if (!isDialogueSentenceMemory(merged))
              throw new Error("合并后的句子记录无效。");
            store.put({ key, value: merged });
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
      }
    });
  }

  async function ready() {
    if (preparing) return preparing;
    preparing = (async () => {
      const database = await open();
      const legacy = options.storage.getItem(DIALOGUE_MEMORY_KEY);
      if (legacy !== null) {
        const memory = parseDialogueMemoryStrict(legacy);
        await mergeInto(database, memory);
        // Another tab may still be using the previous app version. Never delete its newer write.
        try {
          if (options.storage.getItem(DIALOGUE_MEMORY_KEY) === legacy)
            options.storage.removeItem(DIALOGUE_MEMORY_KEY);
        } catch {
          /* A retained duplicate can be safely re-merged on the next access. */
        }
      }
      return database;
    })();
    try {
      return await preparing;
    } finally {
      preparing = undefined;
    }
  }

  async function load(): Promise<DialogueMemory> {
    const database = await ready();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).getAll();
      let memory: DialogueMemory = {},
        failure: unknown;
      request.onsuccess = () => {
        try {
          memory = Object.fromEntries(
            request.result.map((value: unknown) => {
              const record = storedRecord(value);
              return [record.key, record.value];
            }),
          );
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(memory);
      transaction.onabort = () =>
        reject(
          failure ?? transaction.error ?? new Error("无法读取句子数据库。"),
        );
    });
  }

  async function loadSentence(source: DialogueSource) {
    const key = dialogueLineKey(source),
      database = await ready();
    return new Promise<DialogueSentenceMemory | undefined>(
      (resolve, reject) => {
        const transaction = database.transaction(STORE, "readonly");
        const request = transaction.objectStore(STORE).get(key);
        let record: DialogueSentenceMemory | undefined, failure: unknown;
        request.onsuccess = () => {
          try {
            record =
              request.result === undefined
                ? undefined
                : storedRecord(request.result, key).value;
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
        transaction.oncomplete = () => resolve(record);
        transaction.onabort = () =>
          reject(
            failure ?? transaction.error ?? new Error("无法读取原句记录。"),
          );
      },
    );
  }

  async function update(
    source: DialogueSource,
    now: number,
    change: (
      previous: DialogueSentenceMemory | undefined,
    ) => DialogueSentenceMemory,
  ) {
    const key = dialogueLineKey(source);
    if (!isTimestamp(now)) throw new Error("句子记录时间无效。");
    const database = await ready();
    const next = await new Promise<DialogueSentenceMemory>(
      (resolve, reject) => {
        const transaction = database.transaction(STORE, "readwrite");
        const store = transaction.objectStore(STORE),
          request = store.get(key);
        let next: DialogueSentenceMemory, failure: unknown;
        request.onsuccess = () => {
          try {
            const previous =
              request.result === undefined
                ? undefined
                : storedRecord(request.result, key).value;
            if (previous && now < previous.updatedAt)
              throw new Error("记录时间早于已有进度。");
            next = change(previous);
            if (
              !isDialogueSentenceMemory(next) ||
              dialogueLineKey(next) !== key
            )
              throw new Error("句子记录无效，未覆盖原数据。");
            store.put({ key, value: next });
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
        transaction.oncomplete = () => resolve(next);
        transaction.onabort = () =>
          reject(
            failure ?? transaction.error ?? new Error("句子数据库写入失败。"),
          );
      },
    );
    notify();
    return next;
  }

  return {
    load,
    loadSentence,
    update,
    async merge(incoming) {
      const database = await ready();
      await mergeInto(database, incoming);
      notify();
    },
    async close() {
      if (preparing) await preparing.catch(() => undefined);
      if (opened) (await opened).close();
      opened = undefined;
    },
  };
}

let browserRepository: DialogueMemoryRepository | undefined;
export function getDialogueMemoryRepository(): DialogueMemoryRepository {
  if (!browserRepository) {
    if (typeof indexedDB === "undefined")
      throw new Error("当前浏览器无法使用句子数据库。");
    listenForUpdates();
    browserRepository = createDialogueMemoryRepository({
      indexedDB,
      storage: localStorage,
    });
  }
  return browserRepository;
}
export async function loadPersistentDialogueMemory() {
  return getDialogueMemoryRepository().load();
}
export async function loadDialogueSentence(source: DialogueSource) {
  return getDialogueMemoryRepository().loadSentence(source);
}
export async function updatePersistentDialogueSentence(
  source: DialogueSource,
  now: number,
  change: (
    previous: DialogueSentenceMemory | undefined,
  ) => DialogueSentenceMemory,
) {
  return getDialogueMemoryRepository().update(source, now, change);
}
