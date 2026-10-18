import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { type Profile, type Session } from "./model";
import { evaluateTraining, statusLabels } from "./feedback";
import {
  analysisInput,
  localAnalysisEnabled,
  analysisSignature,
  cachedAnalysis,
  requestAnalysis,
  type Analysis,
} from "./analysis";

export function FeedbackCard({
  session,
  sessions,
  profile,
}: {
  session: Session;
  sessions: Session[];
  profile: Profile | null;
}) {
  const localAI = localAnalysisEnabled();
  const result = useMemo(
    () => evaluateTraining(session, sessions, profile),
    [session, sessions, profile],
  );
  const input = useMemo(
    () => analysisInput(session, sessions, profile),
    [session, sessions, profile],
  );
  const signature = analysisSignature(input);
  const [analysis, setAnalysis] = useState<Analysis | null>(null),
    [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    setAnalysis(null);
    setOpen(false);
    setLoading(false);
    setError("");
    if (!localAI) return;
    void cachedAnalysis(input).then((value) => {
      if (generation.current === token) setAnalysis(value);
    });
    return () => {
      generation.current++;
    };
  }, [signature, localAI]); // Facts, preferences, rule version and build mode.
  async function expand() {
    if (open && analysis) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (analysis || loading) return;
    const token = generation.current;
    setLoading(true);
    setError("");
    try {
      const value = await requestAnalysis(input);
      if (generation.current === token) setAnalysis(value);
    } catch (e) {
      if (generation.current === token)
        setError(
          e instanceof Error ? e.message : "AI 服务暂不可用，请稍后重试。",
        );
    } finally {
      if (generation.current === token) setLoading(false);
    }
  }
  const f = result.primary;
  return (
    <section
      className={`training-feedback${f.status === "caution" ? " feedback-caution" : ""}`}
      aria-labelledby="feedback-conclusion"
    >
      <h2 id="feedback-conclusion">{f.conclusion}</h2>
      <p className="feedback-status">
        {f.status === "insufficient" && f.comparison
          ? "表现观察"
          : statusLabels[f.status]}
      </p>
      <p className="feedback-evidence">{f.evidence}</p>
      <div className="feedback-action">
        <h3>下次先做这一件事</h3>
        <p>{f.action}</p>
      </div>
      <details className="feedback-basis">
        <summary>
          查看训练对比
          <ChevronDown size={16} />
        </summary>
        <p>
          已记录 {result.completion.recorded} / {result.completion.planned}{" "}
          个正式组
          {result.completion.excluded > 0
            ? `；另有 ${result.completion.excluded} 个热身或测试等组未计入`
            : ""}
          。
          {f.history.length
            ? `本动作使用最近 ${f.history.length} 次可比历史。`
            : "暂无可比较的历史样本。"}
        </p>
        <p>{result.goalObservation}</p>
      </details>
      {localAI && (
        <>
          <button
            className="feedback-ai-button"
            type="button"
            onClick={() => void expand()}
            disabled={loading}
            aria-expanded={open}
            aria-controls="detailed-training-analysis"
          >
            {loading
              ? "正在生成详细分析…"
              : open && analysis
                ? "收起详细 AI 分析"
                : error
                  ? "重试详细 AI 分析"
                  : "查看详细 AI 分析"}
            <ArrowUpRight size={18} />
          </button>
          <p className="feedback-privacy">
            点击后，将发送本次及相关训练记录进行分析。
          </p>
          {open && (
            <div id="detailed-training-analysis" className="feedback-analysis">
              {loading && (
                <p role="status">
                  正在解释这次训练的变化，本地反馈与已保存记录可继续查看。
                </p>
              )}
              {error && <p role="alert">{error}</p>}
              {analysis && (
                <>
                  <section>
                    <h3>今天做对了什么？</h3>
                    <p>{analysis.summary}</p>
                    {analysis.progress &&
                      analysis.progress !== analysis.summary && (
                        <p>{analysis.progress}</p>
                      )}
                  </section>
                  {analysis.insight && (
                    <section>
                      <h3>教练怎么看？</h3>
                      <p>{analysis.insight}</p>
                    </section>
                  )}
                  <section>
                    <h3>下次怎么练？</h3>
                    <p>{analysis.nextAction}</p>
                  </section>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
