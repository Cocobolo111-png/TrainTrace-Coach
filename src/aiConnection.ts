import { useSyncExternalStore } from "react";
import { byokEnabled, type AIOptions } from "./aiConfig";
type Connection = {
  provider: "deepseek";
  model: AIOptions["model"];
  generation: number;
};
let key = "",
  connection: Connection | null = null,
  generation = 0;
let controller = new AbortController();
const listeners = new Set<() => void>();
export const connectionSnapshot = () => connection;
export function useAIConnection() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, connectionSnapshot);
}
export function disconnectAI() {
  key = "";
  connection = null;
  generation++;
  controller.abort();
  controller = new AbortController();
  listeners.forEach((listener) => listener());
}
export function connectionRequest() {
  if (!connection || !key || !byokEnabled())
    throw Error("请先在设置中验证 AI 连接。");
  return { key, signal: controller.signal, generation: connection.generation };
}
export async function connectAI(candidate: string, model: AIOptions["model"]) {
  disconnectAI();
  if (!byokEnabled() || location.protocol !== "https:")
    throw Error("AI 连接需要 HTTPS 完整版服务。");
  if (!/^[\x21-\x7e]{8,512}$/.test(candidate))
    throw Error("请输入有效的 API Key，不要填写网址。");
  const token = generation;
  const response = await fetch(new URL("api/ai/connect", document.baseURI), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${candidate}`,
    },
    body: JSON.stringify({ provider: "deepseek", model }),
    cache: "no-store",
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
  }).catch(() => {
    throw Error("连接未完成，请检查网络后手动重试。");
  });
  if (!response.ok) {
    const code = (await response.json().catch(() => null))?.code;
    throw Error(
      code === "authentication"
        ? "API Key 验证失败，请检查后重试。"
        : code === "rate_limit"
          ? "请求较多，请稍后重试。"
          : "连接失败，请确认密钥、模型及服务可用。",
    );
  }
  if (token !== generation) throw Error("连接已取消。");
  const result = await response.json();
  if (result?.provider !== "deepseek" || result?.model !== model)
    throw Error("服务返回的连接信息无效。");
  key = candidate;
  connection = { provider: "deepseek", model, generation };
  listeners.forEach((listener) => listener());
}
