import { emptyState, type State, validateState } from "./model";
const DB = "traintrace-v1";
const GUIDANCE_KEY = "traintrace-guidance";
type Guidance = {
  introStep: number;
  workoutHintSeen: boolean;
  sound: boolean;
  vibration: boolean;
  defaultRest: number | null;
};
// These are presentation-only preferences, never a source of training facts.
export function readGuidance(): Guidance {
  try {
    const value = JSON.parse(localStorage.getItem(GUIDANCE_KEY) ?? "null");
    return {
      introStep:
        Number.isInteger(value?.introStep) &&
        value.introStep >= 0 &&
        value.introStep <= 3
          ? value.introStep
          : 0,
      workoutHintSeen: value?.workoutHintSeen === true,
      sound: value?.sound !== false,
      vibration: value?.vibration !== false,
      defaultRest:
        Number.isInteger(value?.defaultRest) &&
        value.defaultRest >= 1 &&
        value.defaultRest <= 3600
          ? value.defaultRest
          : null,
    };
  } catch {
    return {
      introStep: 0,
      workoutHintSeen: false,
      sound: true,
      vibration: true,
      defaultRest: null,
    };
  }
}
export function saveGuidance(patch: Partial<Guidance>) {
  try {
    localStorage.setItem(
      GUIDANCE_KEY,
      JSON.stringify({ ...readGuidance(), ...patch }),
    );
  } catch {
    /* Browser storage restrictions must not block training. */
  }
}
let connection: Promise<IDBDatabase> | undefined;
function db() {
  if (!connection)
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          connection = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        connection = undefined;
        reject(request.error);
      };
      request.onblocked = () => {
        connection = undefined;
        reject(Error("请关闭其他 TrainTrace 标签页后重试"));
      };
    });
  return connection;
}
export async function readState(): Promise<State> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const r = database.transaction("state").objectStore("state").get("main");
    r.onsuccess = () => {
      try {
        resolve(r.result ? validateState(r.result) : emptyState());
      } catch (e) {
        reject(e);
      }
    };
    r.onerror = () => reject(r.error);
  });
}
// One read/write transaction serializes even separate tabs. Resolve only after durable commit.
export async function mutateState(change: (s: State) => State): Promise<State> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("state", "readwrite"),
      store = tx.objectStore("state"),
      request = store.get("main");
    let next: State, cause: unknown;
    request.onsuccess = () => {
      try {
        const previous: State = request.result
          ? validateState(request.result)
          : emptyState();
        next = validateState({
          ...change(structuredClone(previous)),
          revision: previous.revision + 1,
        });
        store.put(next, "main");
      } catch (e) {
        cause = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(next);
    tx.onabort = () => reject(cause ?? tx.error ?? Error("保存被中断，请重试"));
    tx.onerror = () => {
      cause ??= tx.error;
    };
  });
}
export const backup = (s: State) =>
  JSON.stringify({ ...s, exportedAt: new Date().toISOString() }, null, 2);
export function mergeState(current: State, incoming: State): State {
  let sessions = [...current.sessions];
  for (const session of incoming.sessions) {
    const existing = sessions.find((s) => s.id === session.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(session))
        throw Error("相同训练 ID 存在不同内容。请先导出当前数据，避免覆盖。");
      continue;
    }
    if (
      session.status === "active" &&
      sessions.some((s) => s.status === "active")
    )
      throw Error("请先结束或放弃当前训练，再导入另一节未完成训练");
    sessions.push(session);
  }
  sessions = sessions.sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
  return validateState({
    ...current,
    profile: current.profile ?? incoming.profile,
    sessions,
  });
}

// Reuse the existing store: one replaceable derived cache entry per workout.
// Not exported or merged with source records; signature includes rules, facts and preferences.
export async function readAnalysisCache(
  sessionId: string,
  signature: string,
): Promise<unknown> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const r = database
      .transaction("state")
      .objectStore("state")
      .get(`analysis:${sessionId}`);
    r.onsuccess = () =>
      resolve(r.result?.signature === signature ? r.result.value : null);
    r.onerror = () => reject(r.error);
  });
}
export async function writeAnalysisCache(
  sessionId: string,
  signature: string,
  value: unknown,
): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("state", "readwrite");
    tx.objectStore("state").put({ signature, value }, `analysis:${sessionId}`);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
