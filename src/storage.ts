import { emptyState, type State, validateState } from "./model";
const DB = "traintrace-v1";
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
