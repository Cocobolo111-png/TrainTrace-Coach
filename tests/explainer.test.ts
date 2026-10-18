import { describe, expect, it, vi } from "vitest";
import { catalog, makeExercise } from "../src/coach";
import { ANALYSIS_VERSION, type Session } from "../src/model";
import { evaluateTraining, FEEDBACK_VERSION } from "../src/feedback";
import { explainerEntries, matchExplainers } from "../server/explainer";
import { generateAnalysis } from "../server/analysis";

// Synthetic boundary fixtures; real API evidence is kept outside versioned tests.
function session(day: number, reps = 8): Session {
  const startedAt = `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`;
  const e = makeExercise(catalog[0], [], 3);
  e.restRecorded = true;
  for (const t of e.sets)
    t.actual = {
      weight: 60,
      reps,
      completedAt: startedAt,
      rpe: 7,
      quality: "stable",
    };
  return {
    id: `fixture-${day}`,
    theme: "胸部",
    status: "finished",
    startedAt,
    endedAt: startedAt,
    exercises: [e],
    restUntil: null,
    recovery: false,
    note: "",
    source: "app",
  };
}
const select = (s: Session, history: Session[] = []) =>
  matchExplainers(s, history, evaluateTraining(s, history, null));
const ids = (s: Session, history: Session[] = []) =>
  select(s, history).map((x) => x.id);

describe("reviewed situational explanations", () => {
  it("preserves 18 source entries while leaving reserved/disabled material out of automatic selection", () => {
    expect(explainerEntries.map((e) => e.id)).toEqual(
      Array.from({ length: 18 }, (_, i) => String(i + 1).padStart(2, "0")),
    );
    expect(
      explainerEntries.every(
        (e) => e.explanation && e.sourceType && e.boundary,
      ),
    ).toBe(true);
    expect(explainerEntries.find((e) => e.id === "01")?.sourceType).toContain(
      "AI 原创",
    );
    for (const reps of [6, 8, 10])
      for (const gap of [2, 8]) {
        expect(
          ids(session(1 + gap, reps), [session(1)]).every((id) =>
            ["01", "06", "09", "12", "17"].includes(id),
          ),
        ).toBe(true);
      }
  });
  it("A: matches more reps at the same load, without requiring or inventing quality/effort", () => {
    const s = session(3, 9),
      old = session(1);
    expect(ids(s, [old])).toEqual(["01"]);
    for (const t of s.exercises[0].sets) {
      delete t.actual!.quality;
      delete t.actual!.rpe;
    }
    const rule = evaluateTraining(s, [old], null);
    expect(rule.primary.status).toBe("insufficient");
    expect(select(s, [old])[0].constraint).toContain("只肯定已记录的完成量");
    expect(select(s, [old])[0].evidence).toContain("insufficient");
    expect(evaluateTraining(s, [old], null)).toEqual(rule);
  });
  it("A: distinguishes extra sets from improved per-set ability", () => {
    const s = session(3),
      old = session(1);
    old.exercises[0].sets.pop();
    expect(ids(s, [old])).toEqual(["01"]);
    expect(select(s, [old])[0].constraint).toContain(
      "组数增加不能说每组能力提升",
    );
  });
  it("B: explains a single drop without turning repeated decline into a harmless fluctuation", () => {
    expect(ids(session(3, 7), [session(1)])).toEqual(["09"]);
    expect(ids(session(5, 6), [session(1), session(3, 7)])).not.toContain("09");
  });
  it("C: respects explicit recovery and distinguishes a record gap from actual detraining", () => {
    const s = session(3);
    s.recovery = true;
    expect(ids(s)).toEqual(["12"]);
    const gap = select(session(15), [session(1)]);
    expect(gap.map((x) => x.id)).toEqual(["12"]);
    expect(gap[0].constraint).toContain("不能断言实际停训");
  });
  it("D: only explains increased explicitly recorded rest for the same equipment, without changing rules", () => {
    const s = session(3),
      old = session(1);
    old.exercises[0].rest = 90;
    s.exercises[0].rest = 180;
    const rule = evaluateTraining(s, [old], null);
    expect(rule.primary.comparison).toBeNull();
    expect(ids(s, [old])).toEqual(["06"]);
    expect(select(s, [old])[0].constraint).toContain("不是逐组实测休息");
    expect(evaluateTraining(s, [old], null)).toEqual(rule);
    for (const value of [false, undefined]) {
      s.exercises[0].restRecorded = value;
      expect(ids(s, [old])).toEqual([]);
    }
    s.exercises[0].restRecorded = true;
    old.exercises[0].restRecorded = false;
    expect(ids(s, [old])).toEqual([]);
    old.exercises[0].restRecorded = true;
    old.exercises[0].equipmentId = "another-machine";
    expect(ids(s, [old])).toEqual([]);
  });
  it("D: does not skip the latest partial/changed record to manufacture a rest comparison", () => {
    const s = session(5),
      old = session(1),
      partial = session(3);
    old.exercises[0].rest = 90;
    s.exercises[0].rest = 180;
    partial.exercises[0].sets[0].actual = null;
    expect(ids(s, [old, partial])).toEqual([]);
  });
  it("E: leaves first/stable/incomplete/no-matching histories and safety feedback alone", () => {
    const s = session(3);
    expect(ids(s)).toEqual([]);
    expect(ids(s, [session(1)])).toEqual([]);
    s.exercises[0].sets[0].actual = null;
    expect(ids(s, [session(1)])).toEqual([]);
    const caution = session(3, 9);
    caution.note = "卧推出现锐痛";
    expect(ids(caution, [session(1)])).toEqual([]);
  });
  it("17: requires the existing rule to authorize the minimum increment, caps selection at two", () => {
    const old = session(1),
      mid = session(3, 9),
      s = session(5, 10);
    s.exercises[0].targetRepRange = [8, 10];
    s.exercises[0].targetRpe = 8;
    expect(ids(s, [old, mid])).toContain("17");
    s.note = "训练后很疲惫";
    expect(ids(s, [old, mid])).not.toContain("17");
    s.note = "";
    delete s.exercises[0].targetRepRange;
    expect(ids(s, [old, mid])).not.toContain("17");
    s.exercises[0].targetRepRange = [8, 10];
    const more = session(5, 11);
    more.exercises[0].targetRepRange = [8, 10];
    more.exercises[0].targetRpe = 8;
    expect(ids(more, [old, mid])).toEqual(["01", "17"]);
    const stable = structuredClone(s);
    stable.exercises[0].sets.forEach((t) => { t.actual!.reps = 9; });
    stable.exercises[0].targetRepRange = [8, 9];
    // Follow the final action even when an earlier rule ID is still present.
    expect(ids(stable, [old, mid])).not.toContain("17");
  });
  it("sends selected excerpts only in one call, ignores injected matches and locks the rule action", async () => {
    const s = session(3, 9),
      history = [session(1)];
    const model = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "deepseek-flash",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  summary: "合成测试",
                  progress: "",
                  insight: "",
                  nextAction: "加20kg",
                }),
              },
            },
          ],
        }),
      ),
    );
    const result = await generateAnalysis(
      {
        version: FEEDBACK_VERSION,
        analysisVersion: ANALYSIS_VERSION,
        current: s,
        history,
        profile: null,
        explainers: [{ id: "15" }],
      },
      { key: "test-key" },
      model,
    );
    expect(model).toHaveBeenCalledTimes(1);
    const request = JSON.parse(model.mock.calls[0][1].body);
    const context = JSON.parse(request.messages[1].content);
    expect(context.explainers.map((x: { id: string }) => x.id)).toEqual(["01"]);
    expect(context.explainers[0]).not.toHaveProperty("背后的专业原理");
    expect(request.messages[1].content).not.toContain("自由重量是");
    expect(result.nextAction).toBe(
      evaluateTraining(s, history, null).primary.action,
    );
  });
});
