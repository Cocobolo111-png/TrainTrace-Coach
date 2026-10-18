import { describe, it, expect, vi } from "vitest";
import { convertTrainingLog } from "../scripts/convert-training-log";
import { analysisInput } from "../src/analysis";
import { evaluateTraining, FEEDBACK_VERSION } from "../src/feedback";
import { ANALYSIS_VERSION } from "../src/model";
import { mergeState } from "../src/storage";
import { generateAnalysis } from "../server/analysis";
// Synthetic fixtures only; the user's private log stays outside versioned tests.
const legacy = `# 训练日志
## 2025-01-02｜胸
### 热身
- 4 min
### 杠铃卧推
组间休息：3 min
- 30 kg × 5 × 2
- 40 kg × 4 × 1
顶组 RPE：8
### 教练观察
PRIVATE_COACH_SENTINEL
## 2025-01-04｜胸
### 杠铃卧推
- 30 kg × 5 × 4
RPE：未记录
### 训练内容
- 哑铃侧平举：单边 4 kg × 10–12 × 2（各组实际次数未单独记录）
### 强度与反馈
- 用户原始输入：PRE 7，待确认
### 训练后感受
- 全身舒畅
## 2025-01-05｜休息
- 无力量训练。
## 2025-01-06｜背
### 引体向上
- 自重 6 × 3
RPE：9
`;
describe("legacy chapter conversion and grounded history", () => {
  it("preserves dates, explicit rest, scoped RPE and notes; excludes ranges, warmup minutes and rest days from work sets", () => {
    const converted = convertTrainingLog(legacy);
    expect(converted.restDays).toBe(1);
    expect(converted.state.sessions).toHaveLength(3);
    const [first, second, pull] = converted.state.sessions;
    expect(first.startedAt.slice(0, 10)).toBe("2025-01-02");
    expect(first.exercises[0]).toMatchObject({
      rest: 180,
      restRecorded: true,
      reportedRpe: { value: 8, scope: "top-set" },
    });
    expect(first.exercises[0].sets).toHaveLength(3);
    expect(
      first.exercises[0].sets.every((t) => t.actual?.rpe === undefined),
    ).toBe(true);
    expect(first.coachReference).toContain("PRIVATE_COACH_SENTINEL");
    expect(second.exercises).toHaveLength(1);
    expect(second.exercises[0].restRecorded).toBe(false);
    expect(second.note).toContain("10–12");
    expect(second.note).toContain("待确认");
    expect(second.note).toContain("全身舒畅");
    expect(second.exercises[0].reportedRpe).toBeUndefined();
    expect(pull.exercises[0].sets.map((t) => t.actual?.weight)).toEqual([
      0, 0, 0,
    ]);
    expect(pull.exercises[0].reportedRpe).toEqual({
      value: 9,
      scope: "exercise",
    });
    const merged = mergeState(
      converted.state,
      convertTrainingLog(legacy).state,
    );
    expect(merged.sessions).toEqual(converted.state.sessions);
  });
  it("distinguishes more work at a shared load from a lower peak load, with unknown rest remaining unknown", () => {
    const { state } = convertTrainingLog(legacy);
    const feedback = evaluateTraining(
      state.sessions[1],
      state.sessions,
      null,
    ).primary;
    expect(feedback.history).toHaveLength(1);
    expect(feedback.current.restSeconds).toBeNull();
    expect(feedback.comparison?.sharedLoads).toContainEqual({
      weight: 30,
      previousSets: 2,
      currentSets: 4,
      previousReps: 10,
      currentReps: 20,
      previousVolume: 300,
      currentVolume: 600,
    });
    expect(feedback.comparison?.peakLoad).toEqual({
      previous: 40,
      current: 30,
    });
    expect(feedback.conclusion).toContain("完成了更多训练");
    expect(feedback.status).toBe("insufficient");
  });
  it("keeps coach references out of network input and independently removes them on the server", async () => {
    const { state } = convertTrainingLog(legacy);
    expect(
      JSON.stringify(analysisInput(state.sessions[1], state.sessions, null)),
    ).not.toContain("PRIVATE_COACH_SENTINEL");
    const model = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "deepseek-flash",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  summary: "合成测试反馈",
                  progress: "",
                  insight: "完成量变化不等于力量变化",
                  nextAction: "保持",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await generateAnalysis(
      {
        version: FEEDBACK_VERSION,
        analysisVersion: ANALYSIS_VERSION,
        current: state.sessions[1],
        history: [state.sessions[0]],
        profile: null,
      },
      { key: "test-key" },
      model,
    );
    const request = JSON.parse(model.mock.calls[0][1].body);
    expect(request.messages[1].content).not.toContain("PRIVATE_COACH_SENTINEL");
    const context = JSON.parse(request.messages[1].content);
    expect(context.feedback.completion.planned).toBeNull();
    expect(context.feedback.completion.planAvailable).toBe(false);
    expect(context.analysisFocus.selfReportedOutcome).toBe("全身舒畅");
    expect(context.feedback.primary.comparison.sharedLoads[0].currentReps).toBe(
      20,
    );
  });
});
