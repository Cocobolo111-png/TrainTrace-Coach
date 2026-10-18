// Explicit live verification only: never runs in tests or on server startup.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateAnalysis, AnalysisError, type CallMetrics } from "./analysis";
import { ANALYSIS_VERSION, validateState } from "../src/model";
import { FEEDBACK_VERSION, sameMovement } from "../src/feedback";
import { evaluateTraining } from "../src/feedback";
import { analysisInput } from "../src/analysis";
import { matchExplainers } from "./explainer";
import { createHash } from "node:crypto";
const path = process.argv[2];
const explainerMode = process.argv.includes("--explainer");
if (!process.env.DEEPSEEK_API_KEY?.trim()) {
  console.error("尚未配置 DEEPSEEK_API_KEY；未发送任何 API 请求。");
  process.exitCode = 1;
} else if (!path) {
  console.error("用法：pnpm verify:deepseek /绝对路径/traintrace-backup.json");
  process.exitCode = 1;
} else {
  try {
    const sourceBytes = await readFile(resolve(path));
    const state = validateState(JSON.parse(sourceBytes.toString("utf8")));
    const sessions = state.sessions
      .filter((s) => s.status === "finished")
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    if (!sessions.length) throw Error("备份中没有已结束的训练记录");
    const withHistory = [...sessions]
      .reverse()
      .find((s) =>
        sessions.some(
          (old) =>
            old.endedAt &&
            Date.parse(old.endedAt) < Date.parse(s.startedAt) &&
            s.exercises.some((e) =>
              old.exercises.some((x) => sameMovement(e, x)),
            ),
        ),
      );
    const standard = [
      { case: "first-record", session: sessions[0] },
      ...(withHistory
        ? [{ case: "comparable-history", session: withHistory }]
        : []),
    ];
    const scenarios = sessions.map((session) => {
      const input = analysisInput(session, sessions, state.profile);
      const feedback = evaluateTraining(session, input.history, state.profile);
      return {
        session,
        input,
        feedback,
        matches: matchExplainers(session, input.history, feedback),
      };
    });
    const cases = [
      { case: "A-shared-load-completion", id: "01" },
      { case: "B-single-drop", id: "09" },
      { case: "C-returning", id: "12" },
      { case: "D-recorded-longer-rest", id: "06" },
      { case: "E-no-matching-explanation", id: null },
    ];
    const selected = explainerMode
      ? cases.flatMap((c) => {
          const item = scenarios.find((s) =>
            c.id === null
              ? s.matches.length === 0
              : s.matches.some((m) => m.id === c.id),
          );
          return item ? [{ case: c.case, session: item.session }] : [];
        })
      : standard;
    const results = [];
    for (const item of selected) {
      const scenario = scenarios.find((s) => s.session.id === item.session.id)!;
      const metrics: CallMetrics[] = [];
      const result = await generateAnalysis(
        explainerMode
          ? scenario.input
          : {
              version: FEEDBACK_VERSION,
              analysisVersion: ANALYSIS_VERSION,
              current: item.session,
              history: sessions
                .filter(
                  (s) =>
                    s.endedAt &&
                    Date.parse(s.endedAt) < Date.parse(item.session.startedAt),
                )
                .slice(-101),
              profile: state.profile,
            },
        {
          key: process.env.DEEPSEEK_API_KEY,
          model: process.env.DEEPSEEK_MODEL,
        },
        fetch,
        (event) => {
          metrics.push(event);
          console.log(JSON.stringify({ case: item.case, ...event }));
        },
      );
      results.push({
        case: item.case,
        sessionId: item.session.id,
        result,
        metrics,
        ...(explainerMode
          ? {
              date: item.session.startedAt.slice(0, 10),
              matched: scenario.matches,
              ruleFeedback: scenario.feedback.primary,
            }
          : {}),
      });
    }
    const sourceUnchanged =
      createHash("sha256").update(sourceBytes).digest("hex") ===
      createHash("sha256")
        .update(await readFile(resolve(path)))
        .digest("hex");
    if (!sourceUnchanged) throw Error("源备份发生变化");
    const folder = resolve(
      explainerMode ? ".impeccable/review/explainer" : ".impeccable/review/v13",
    );
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(folder, "deepseek-live.json"),
      JSON.stringify(
        {
          source: explainerMode
            ? "existing-real-training-history"
            : "existing-browser-export",
          verifiedAt: new Date().toISOString(),
          sourceUnchanged,
          comparableHistoryAvailable: !!withHistory,
          ...(explainerMode
            ? {
                uncoveredCases: cases
                  .filter((c) => !selected.some((s) => s.case === c.case))
                  .map((c) => c.case),
              }
            : {}),
          results,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      explainerMode
        ? `真实日志完成 ${results.length} 次官方 API 分析；未匹配场景保留为未覆盖，不补造记录。`
        : withHistory
          ? "真实 API 首次记录与历史场景调用完成；请人工核对分析措辞。"
          : "真实 API 首次记录调用完成；备份没有同动作可比历史，历史场景仍待补充。",
    );
  } catch (error) {
    // Never print raw provider errors, environment, headers or the backup contents.
    console.error(
      "真实调用验证未完成：",
      error instanceof AnalysisError
        ? error.message
        : "请检查本地备份与配置；未输出文件或响应正文",
    );
    process.exitCode = 1;
  }
}
