import {
  byokEnabled,
  canonicalDimensions,
  defaultDimensions,
  type AIOptions,
} from "./aiConfig";
import { connectionRequest, connectionSnapshot } from "./aiConnection";
import {
  AnalysisSchema,
  ANALYSIS_VERSION,
  analysisRecord,
  type Analysis,
  type Profile,
  type Session,
} from "./model";
import { FEEDBACK_VERSION } from "./feedback";
import { readAnalysisCache, writeAnalysisCache } from "./storage";
export { AnalysisSchema, type Analysis } from "./model";
// Public production builds have no AI entry or service request. Local mode is
// selected at build time, never from a shared URL or a browser preference.
export const localAnalysisEnabled = () =>
  import.meta.env.MODE === "development" || import.meta.env.MODE === "local-ai";
export function analysisInput(
  session: Session,
  sessions: Session[],
  profile: Profile | null,
  ai?: AIOptions,
) {
  const earlier = sessions
    .filter(
      (s) =>
        s.status === "finished" &&
        s.id !== session.id &&
        s.endedAt &&
        Date.parse(s.endedAt) < Date.parse(session.startedAt),
    )
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const ids = new Set(earlier.slice(0, 1).map((s) => s.id));
  for (const e of session.exercises) {
    for (const s of earlier
      .filter((s) =>
        s.exercises.some(
          (x) => x.catalogId === e.catalogId || x.name === e.name,
        ),
      )
      .slice(0, 5))
      ids.add(s.id);
  }
  return {
    version: FEEDBACK_VERSION,
    analysisVersion: ANALYSIS_VERSION,
    current: analysisRecord(session),
    history: earlier.filter((s) => ids.has(s.id)).map(analysisRecord),
    profile,
    ai: ai
      ? { ...ai, dimensions: canonicalDimensions(ai.dimensions) }
      : {
          provider: "deepseek" as const,
          model: "deepseek-flash" as const,
          dimensions: defaultDimensions,
        },
  };
}
export const analysisSignature = (input: ReturnType<typeof analysisInput>) =>
  JSON.stringify(input);
const inflight = new Map<string, Promise<Analysis>>();
export async function cachedAnalysis(
  input: ReturnType<typeof analysisInput>,
): Promise<Analysis | null> {
  try {
    const data = await readAnalysisCache(
      input.current.id,
      analysisSignature(input),
    );
    const parsed = AnalysisSchema.safeParse(data);
    return parsed.success &&
      parsed.data.meta.provider === input.ai.provider &&
      parsed.data.meta.requestedModel === input.ai.model &&
      parsed.data.meta.model === input.ai.model
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}
export function requestAnalysis(
  input: ReturnType<typeof analysisInput>,
): Promise<Analysis> {
  if (!localAnalysisEnabled() && !(byokEnabled() && connectionSnapshot()))
    return Promise.reject(
      Error("网页版使用本地规则反馈；详细 AI 分析仅供本地使用。"),
    );
  const credentials = byokEnabled() ? connectionRequest() : null;
  const signature = analysisSignature(input);
  const requestKey = signature + (credentials?.generation ?? "local");
  const pending = inflight.get(requestKey);
  if (pending) return pending;
  const request = (async () => {
    const cached = await cachedAnalysis(input);
    if (credentials?.signal.aborted) throw Error("AI 连接已断开。");
    if (cached) return cached;
    let response: Response;
    try {
      response = await fetch(
        new URL("api/training-analysis", document.baseURI),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(credentials
              ? { Authorization: `Bearer ${credentials.key}` }
              : {}),
          },
          body: JSON.stringify(input),
          signal: credentials
            ? AbortSignal.any([credentials.signal, AbortSignal.timeout(45000)])
            : AbortSignal.timeout(45000),
          cache: "no-store",
        },
      );
    } catch {
      throw Error("无法连接 AI 服务，请确认网络或稍后重试。本地反馈已可用。");
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const messages: Record<string, string> = {
        not_configured: "详细分析暂未开通，训练反馈和记录可正常使用。",
        authentication:
          "API Key 验证失败，请在设置中重新连接。训练记录已保存。",
        balance: "分析服务暂不可用，请稍后重试。",
        rate_limit: "分析请求较多，请稍后手动重试。",
        timeout: "分析等待超时，请稍后重试。训练记录已保存。",
        empty_response: "分析未返回内容，请重试。",
        truncated: "分析未完整返回，请重试。",
        invalid_output: "分析内容不完整，请重试。",
        invalid_input: "训练数据未通过校验，请先确认记录。",
      };
      if (payload?.code && Object.hasOwn(messages, payload.code))
        throw Error(messages[payload.code]);
      if ([404, 405, 503].includes(response.status))
        throw Error("详细分析暂未开通，训练反馈和记录可正常使用。");
      if (response.status === 429)
        throw Error("AI 服务正在处理请求，请稍后重试。");
      throw Error("AI 分析未能完成，请稍后重试。本地反馈和训练记录已保留。");
    }
    const parsed = AnalysisSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) throw Error("AI 返回内容不完整，请稍后重试。");
    if (
      credentials?.signal.aborted ||
      (credentials &&
        connectionSnapshot()?.generation !== credentials.generation)
    )
      throw Error("AI 连接已断开。");
    if (
      parsed.data.meta.provider !== input.ai.provider ||
      (byokEnabled() && parsed.data.meta.requestedModel !== input.ai.model)
    )
      throw Error("AI 模型信息不匹配。");
    // Cache is derived content in the existing DB, never a mutation of training facts.
    await writeAnalysisCache(input.current.id, signature, parsed.data).catch(
      () => {},
    );
    return parsed.data;
  })().finally(() => inflight.delete(requestKey));
  inflight.set(requestKey, request);
  return request;
}
