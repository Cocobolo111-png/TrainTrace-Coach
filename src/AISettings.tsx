import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { byokEnabled, models, type AIOptions } from "./aiConfig";
import { connectAI, disconnectAI, useAIConnection } from "./aiConnection";
export function AISettings() {
  const connection = useAIConnection();
  const [open, setOpen] = useState(false),
    [key, setKey] = useState(""),
    [model, setModel] = useState<AIOptions["model"]>(models[0]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <details
      className="settings-copy ai-settings"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        连接你自己的 AI{connection ? ` · ${connection.model} 已连接` : ""}
        <ChevronDown size={16} />
      </summary>
      {!byokEnabled() ? (
        <p className="helper">
          当前版本使用本地规则反馈。连接个人 AI 需要启用 HTTPS
          同源服务的完整版；静态版不会发送模型请求。
        </p>
      ) : (
        <>
          <p className="helper">
            密钥会经本站 TrainTrace 服务器转发至
            DeepSeek。仅保留在当前页面内存中，刷新或断开即清除，不进入备份。只有主动分析才发送必要的训练数据。
          </p>
          {connection ? (
            <>
              <p role="status">
                DeepSeek · {connection.model} · 凭证与模型已验证（不保证余额）
              </p>
              <button
                type="button"
                onClick={() => {
                  disconnectAI();
                  setKey("");
                  setMessage("已断开连接。");
                }}
              >
                断开连接
              </button>
            </>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setMessage("");
                try {
                  await connectAI(key.trim(), model);
                  setKey("");
                  setOpen(false);
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "连接失败，请重试。",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                模型服务商
                <select aria-label="模型服务商" disabled={busy}>
                  <option value="deepseek">DeepSeek</option>
                </select>
              </label>
              <label>
                API Key
                <input
                  aria-label="AI API Key"
                  type="password"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={512}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label>
                模型
                <select
                  aria-label="AI 模型"
                  value={model}
                  onChange={(e) =>
                    setModel(e.target.value as AIOptions["model"])
                  }
                  disabled={busy}
                >
                  {models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={busy || !key.trim()}>
                {busy ? "正在验证…" : "验证连接"}
              </button>
              {busy && (
                <button
                  type="button"
                  onClick={() => {
                    disconnectAI();
                    setKey("");
                  }}
                >
                  取消连接
                </button>
              )}
            </form>
          )}
          {message && <p role="status">{message}</p>}
        </>
      )}
    </details>
  );
}
