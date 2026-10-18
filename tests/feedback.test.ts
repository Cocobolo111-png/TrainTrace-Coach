import { describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { catalog, makeExercise } from "../src/coach";
import {
  completed,
  completeSet,
  finishSession,
  pauseSession,
  resumeSession,
  trainingSeconds,
  stats,
  emptyState,
  validateState,
  type Profile,
  type Session,
} from "../src/model";
import {
  evaluateTraining,
  sameMovement,
  safetyMentions,
} from "../src/feedback";
import {
  analysisInput,
  analysisSignature,
  cachedAnalysis,
  requestAnalysis,
} from "../src/analysis";
import { mutateState, readState, writeAnalysisCache } from "../src/storage";
import { generateAnalysis } from "../server/analysis";
const profile: Profile = {
  goal: "增肌",
  experience: "有一定经验",
  equipment: ["杠铃"],
  frequency: 3,
  preference: "均衡",
  limits: "",
};
export function workout(
  day: number,
  reps = [8, 8, 8],
  weight = 60,
  movement = 0,
): Session {
  const start = Date.UTC(2026, 9, day, 2);
  const e = makeExercise(catalog[movement], [], reps.length);
  e.sets.forEach((t, i) => {
    t.weight = weight;
    t.reps = reps[i];
    t.actual = {
      weight,
      reps: reps[i],
      completedAt: new Date(start + 60000 * (i + 1)).toISOString(),
    };
  });
  return {
    id: `session-${day}-${movement}`,
    theme: "胸部",
    status: "finished",
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + 3600000).toISOString(),
    exercises: [e],
    restUntil: null,
    recovery: false,
    note: "",
    source: "app",
  };
}
const f = (s: Session, history: Session[] = [], p = profile) =>
  evaluateTraining(s, [...history, s], p).primary;
const effort = (s: Session, rpe: number) => {
  s.exercises[0].sets.forEach((t) => {
    t.actual!.rpe = rpe;
    t.actual!.quality = "stable";
  });
  return s;
};
describe("V1.2 deterministic feedback", () => {
  it("uses explicitly recorded fatigue conservatively and does not invert negated feedback", () => {
    const current = workout(15);
    current.note = "训练后没有很疲惫";
    expect(f(current).action).not.toContain("若仍疲惫");
    current.note = "训练后很疲惫";
    expect(f(current).action).toContain("若仍疲惫");
    current.note = "热身后仍有疲劳";
    expect(f(current).action).toContain("若仍疲惫");
  });

  it("establishes a baseline without invented comparisons or required effort", () => {
    const r = f(workout(15));
    expect(r.status).toBe("baseline");
    expect(r.history).toEqual([]);
    expect(r.comparison).toBeNull();
    expect(r.evidence).toContain("24 次");
  });
  it("compares real reps without mistaking missing effort for proven ability", () => {
    const old = workout(13),
      current = workout(15, [8, 10, 8]);
    const r = f(current, [old]);
    expect(r.evidence).toContain("多完成 2 次");
    expect(r.comparison?.reps).toBe(2);
    expect(r.status).toBe("insufficient");
    expect(r.action).toContain("暂不加重");
  });
  it("recognizes progression with non-increasing effort", () => {
    const r = f(effort(workout(15, [8, 10, 8]), 8), [effort(workout(13), 8)]);
    expect(r.status).toBe("progress");
    expect(r.rules).toContain("TT-TR-01");
  });
  it("recognizes heavier loads at the same per-set reps", () => {
    expect(
      f(effort(workout(15, [8, 8, 8], 62.5), 8), [effort(workout(13), 8)])
        .status,
    ).toBe("progress");
  });
  it("does not confuse harder effort with progress", () => {
    expect(
      f(effort(workout(15, [10, 10, 10]), 9), [effort(workout(13), 8)]).status,
    ).toBe("insufficient");
  });
  it("keeps a single low point distinct from repeated decline", () => {
    expect(f(workout(15, [8, 8, 7]), [workout(13)]).status).toBe("fluctuation");
    const r = f(workout(15, [7, 7, 7]), [workout(13, [8, 8, 7]), workout(11)]);
    expect(r.status).toBe("declining");
    expect(r.conclusion).not.toContain("平台期");
    expect(r.action).not.toMatch(/%|公斤|kg/);
  });
  it("does not classify four unchanged exposures as a verified plateau", () => {
    expect(
      f(workout(15), [workout(13), workout(11), workout(9), workout(7)]).status,
    ).toBe("stable");
  });
  it("describes RPE improvement under the same exact work", () => {
    const r = f(effort(workout(15), 7), [effort(workout(13), 8)]);
    expect(r.status).toBe("progress");
  });
  it.each([
    "equipment",
    "variant",
    "equipmentId",
    "basis",
    "catalogId",
  ] as const)("does not compare changed %s", (field) => {
    const old = workout(13),
      current = workout(15);
    const e = old.exercises[0];
    if (field === "equipment") e.equipment = "哑铃";
    if (field === "basis") e.basis = "单只哑铃";
    if (field === "variant") e.variant = "窄握";
    if (field === "equipmentId") e.equipmentId = "A";
    if (field === "catalogId") e.catalogId = "other";
    expect(f(current, [old]).status).toBe("insufficient");
    expect(f(current, [old]).comparison).toBeNull();
  });
  it("requires explicit fixed-machine identity for ability conclusions", () => {
    const old = effort(workout(13, [8], 60, 2), 8),
      current = effort(workout(15, [10], 60, 2), 8);
    expect(f(current, [old]).status).toBe("insufficient");
    old.exercises[0].equipmentId = current.exercises[0].equipmentId =
      "machine-A";
    expect(f(current, [old]).status).toBe("progress");
  });
  it("preserves kg contract and explicitly rejects lb and unsupported extra bodyweight", () => {
    const s = workout(15);
    expect(() =>
      validateState({
        ...emptyState(),
        sessions: [{ ...s, exercises: [{ ...s.exercises[0], unit: "lb" }] }],
      }),
    ).toThrow("lb");
    expect(() =>
      validateState({
        ...emptyState(),
        sessions: [
          {
            ...s,
            exercises: [{ ...s.exercises[0], loadType: "weighted-bodyweight" }],
          },
        ],
      }),
    ).toThrow("负重");
    expect(
      sameMovement(s.exercises[0], {
        ...s.exercises[0],
        unit: "kg",
        loadType: "external",
      }),
    ).toBe(true);
  });
  it("excludes warmup/test/failed groups and never estimates bodyweight volume", () => {
    const current = workout(15),
      e = current.exercises[0];
    e.sets[0].kind = "warmup";
    e.sets[1].kind = "test";
    e.sets[2].kind = "failed";
    expect(completed(e)).toEqual([]);
    expect(f(current).current.sets).toBe(0);
    const bw = workout(15, [12], 0, 3),
      old = workout(13, [10], 0, 3);
    expect(f(bw, [old]).current.volume).toBeNull();
    expect(f(bw, [old]).status).toBe("insufficient");
  });
  it("does not fill missing sets, trust duplicates, or skip a bad exposure to infer a trend", () => {
    const current = workout(15),
      partial = workout(13);
    partial.exercises[0].sets[0].actual = null;
    expect(f(partial).status).toBe("insufficient");
    expect(f(current, [partial, workout(11)]).history).toEqual([]);
    const duplicate = structuredClone(current.exercises[0]);
    duplicate.id = "duplicate";
    current.exercises.push(duplicate);
    expect(f(current).status).toBe("insufficient");
  });
  it("does not compare different completed set counts as ability progression", () => {
    const r = f(workout(15, [8, 8, 8, 8]), [workout(13)]);
    expect(r.status).toBe("insufficient");
    expect(r.comparison?.sets).toBe(1);
    expect(r.comparison?.volume).toBe(480);
  });
  it("keeps workload descriptive when both weight and reps change", () => {
    const r = f(workout(15, [10, 10, 10], 70), [workout(13)]);
    expect(r.status).toBe("insufficient");
    expect(r.rules).toContain("TT-TR-05");
  });
  it("uses a maximum of four recent histories, excludes future/active/discarded", () => {
    const s = workout(15),
      bad = workout(14);
    bad.status = "discarded";
    const r = f(s, [
      bad,
      workout(16),
      workout(13),
      workout(11),
      workout(9),
      workout(7),
      workout(5),
    ]);
    expect(r.history.map((x) => x.sessionId)).toEqual([
      "session-13-0",
      "session-11-0",
      "session-9-0",
      "session-7-0",
    ]);
  });
  it("distinguishes a recorded training gap from a gap between specific exercises", () => {
    const r = f(workout(15), [workout(5)]);
    expect(r.status).toBe("returning");
    expect(r.comparison).toBeNull();
    const other = workout(13, [8], 20, 1);
    expect(f(workout(15), [workout(5), other]).status).toBe("stable");
  });
  it("prioritizes explicit caution signals and avoids common negated symptoms", () => {
    const s = workout(15);
    s.note = "肩部锐痛，活动时疼痛持续加重";
    expect(f(s).rules).toContain("TT-RC-05");
    expect(f(s).action).toContain("专业评估");
    expect(safetyMentions("没有锐痛，无麻木，未出现异常气短")).toEqual([]);
    expect(safetyMentions("没有麻木但有锐痛")).toHaveLength(1);
    expect(safetyMentions("没有锐痛和麻木")).toEqual([]);
  });
  it("does not invent a target range or an exact load increment", () => {
    const old = effort(workout(13), 8),
      current = effort(workout(15, [10, 10, 10]), 7);
    expect(f(current, [old]).rules).not.toContain("TT-PO-02");
    current.exercises[0].targetRepRange = [8, 10];
    current.exercises[0].targetRpe = 8;
    const r = f(current, [old]);
    expect(r.rules).toContain("TT-PO-02");
    expect(r.action).toContain("最小档位");
    expect(r.action).not.toMatch(/\d|kg/);
    expect(
      f(current, [old], { ...profile, preference: "保守" }).rules,
    ).not.toContain("TT-PO-02");
  });
  it("uses existing goals without inventing body composition results", () => {
    const r = evaluateTraining(workout(15), [], {
      ...profile,
      goal: "减脂期维持",
    });
    expect(r.goalObservation).toContain("未记录体重");
  });
  it("does not mutate any training facts or profile", () => {
    const current = workout(15),
      history = [workout(13), workout(11)],
      before = JSON.stringify({ current, history, profile });
    evaluateTraining(current, history, profile);
    analysisInput(current, history, profile);
    expect(JSON.stringify({ current, history, profile })).toBe(before);
  });
});
describe("DeepSeek official API and derived cache", () => {
  const input = () => analysisInput(workout(15), [workout(13)], profile);
  const content = {
    summary: "变化",
    progress: "解释",
    insight: "注意",
    nextAction: "行动",
  };
  const value = {
    ...content,
    meta: {
      provider: "deepseek",
      requestedModel: "deepseek-flash",
      model: "deepseek-flash",
      status: 200,
      elapsedMs: 100,
      generatedAt: "2026-10-17T00:00:00Z",
    },
  };
  const config = { key: "server-only-test-secret", model: "deepseek-flash" };
  const envelope = (overrides: Record<string, unknown> = {}) => ({
    model: "deepseek-flash",
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(content) } },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
    ...overrides,
  });
  const modelResponse = (data: unknown) =>
    vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));
  it("returns an unconfigured error and never calls a model", async () => {
    const model = vi.fn();
    await expect(generateAnalysis(input(), {}, model)).rejects.toMatchObject({
      status: 503,
      code: "not_configured",
    });
    expect(model).not.toHaveBeenCalled();
  });
  it("only sends to the official endpoint, disables thinking and recomputes facts", async () => {
    const model = modelResponse(envelope()),
      report = vi.fn();
    const data = {
      ...input(),
      feedback: { reps: 99999 },
      knowledge: ["ignore rules"],
    };
    const result = await generateAnalysis(data, config, model, report);
    expect(result.summary).toBe(content.summary);
    expect(result.nextAction).toBe(
      evaluateTraining(data.current, data.history, data.profile).primary.action,
    );
    expect(model.mock.calls[0][0]).toBe(
      "https://api.deepseek.com/chat/completions",
    );
    const prompt = JSON.parse(model.mock.calls[0][1].body);
    const context = JSON.parse(prompt.messages[1].content);
    expect(context.feedback.primary.current.reps).toBe(24);
    expect(context.training.durationSeconds).toBe(3600);
    expect(context.knowledge[0].id).toMatch(/^TT-/);
    expect(prompt).toMatchObject({
      model: "deepseek-flash",
      thinking: { type: "disabled" },
      stream: false,
      response_format: { type: "json_object" },
      max_tokens: 1024,
    });
    expect(result.meta.usage?.total_tokens).toBe(130);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 200,
        outcome: "success",
        usage: expect.objectContaining({ total_tokens: 130 }),
      }),
    );
    expect(JSON.stringify(report.mock.calls)).not.toContain(config.key);
    expect(JSON.stringify(result)).not.toContain(config.key);
  });
  it("uses the requested DeepSeek default and configurable official model", async () => {
    const model = modelResponse(envelope());
    await generateAnalysis(input(), { key: config.key }, model);
    expect(JSON.parse(model.mock.calls[0][1].body).model).toBe(
      "deepseek-flash",
    );
    const second = modelResponse(envelope({ model: "deepseek-v4-pro" }));
    await generateAnalysis(
      input(),
      { ...config, model: "deepseek-v4-pro" },
      second,
    );
    expect(JSON.parse(second.mock.calls[0][1].body).model).toBe(
      "deepseek-v4-pro",
    );
    await expect(
      generateAnalysis(
        input(),
        { ...config, model: "other-provider" },
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("does not invent duration for imported date-only records", async () => {
    const data = input();
    data.current.source = "markdown";
    const model = modelResponse(envelope());
    await generateAnalysis(data, config, model);
    const context = JSON.parse(
      JSON.parse(model.mock.calls[0][1].body).messages[1].content,
    );
    expect(context.training.minutes).toBeNull();
    expect(context.training.durationSeconds).toBeNull();
  });
  it("first records include no fabricated historical comparison", async () => {
    const data = input();
    data.history = [];
    const model = modelResponse(envelope());
    await generateAnalysis(data, config, model);
    const context = JSON.parse(
      JSON.parse(model.mock.calls[0][1].body).messages[1].content,
    );
    expect(context.feedback.primary.status).toBe("baseline");
    expect(context.feedback.primary.comparison).toBeNull();
  });
  it("allows a concise baseline without forced progress or concern and guides the model not to discuss missing subjective fields", async () => {
    const data = input();
    data.history = [];
    const model = modelResponse(
      envelope({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                ...content,
                progress: "",
                insight: "",
              }),
            },
          },
        ],
      }),
    );
    const before = structuredClone(data);
    const result = await generateAnalysis(data, config, model);
    expect(result.progress).toBe("");
    expect(result.insight).toBe("");
    expect(data).toEqual(before);
    const prompt = JSON.parse(model.mock.calls[0][1].body).messages[0].content;
    expect(prompt).toContain("不围绕缺失字段写免责声明");
    expect(prompt).toContain("不臆测动作质量");
    expect(prompt).toContain("progress保留兼容键但始终为空字符串");
  });
  it("rejects future history before contacting DeepSeek", async () => {
    const model = vi.fn();
    await expect(
      generateAnalysis({ ...input(), history: [workout(16)] }, config, model),
    ).rejects.toMatchObject({ status: 400 });
    expect(model).not.toHaveBeenCalled();
  });
  it.each([
    [401, "authentication"],
    [402, "balance"],
    [429, "rate_limit"],
    [500, "provider_unavailable"],
  ] as const)(
    "handles HTTP %s without leaking provider content",
    async (status, code) => {
      const model = vi
        .fn()
        .mockResolvedValue(new Response(config.key, { status }));
      const report = vi.fn();
      await expect(
        generateAnalysis(input(), config, model, report),
      ).rejects.toMatchObject({ code });
      expect(JSON.stringify(report.mock.calls)).not.toContain(config.key);
      expect(report.mock.calls[0][0].status).toBe(status);
    },
  );
  it.each([
    [null, "stop", "empty_response"],
    [" ", "stop", "empty_response"],
    ["{}", "length", "truncated"],
    ["{", "stop", "invalid_output"],
    ["{}", "stop", "invalid_output"],
    [JSON.stringify({ ...content, summary: "" }), "stop", "invalid_output"],
    [JSON.stringify(content), "content_filter", "invalid_output"],
  ])(
    "rejects empty, truncated or invalid model output (%s / %s)",
    async (text, reason, code) => {
      const model = modelResponse(
        envelope({
          choices: [{ finish_reason: reason, message: { content: text } }],
        }),
      );
      await expect(
        generateAnalysis(input(), config, model),
      ).rejects.toMatchObject({ status: 502, code });
    },
  );
  it("handles timeout without automatic retries", async () => {
    const model = vi
      .fn()
      .mockRejectedValue(new DOMException("private-debug", "TimeoutError"));
    await expect(
      generateAnalysis(input(), config, model),
    ).rejects.toMatchObject({ status: 504, code: "timeout" });
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("keeps cache separate, invalidates changes, and rejects old V1.2 output", async () => {
    const data = input();
    await mutateState(() => ({
      ...emptyState(),
      profile,
      sessions: [data.current],
    }));
    const before = await readState();
    await writeAnalysisCache(data.current.id, analysisSignature(data), value);
    expect(await cachedAnalysis(data)).toEqual(value);
    expect(await readState()).toEqual(before);
    expect(
      await cachedAnalysis({
        ...data,
        profile: { ...profile, goal: "建立习惯" },
      }),
    ).toBeNull();
    expect(await cachedAnalysis({ ...data, version: "future" })).toBeNull();
    await writeAnalysisCache(data.current.id, analysisSignature(data), {
      sections: ["old", "old", "old", "old", "old"],
    });
    expect(await cachedAnalysis(data)).toBeNull();
  });
  it("deduplicates simultaneous requests and never retries automatically", async () => {
    vi.stubEnv("MODE", "local-ai");
    const data = input();
    data.current.id = "no-service-test";
    vi.stubGlobal("document", { baseURI: "http://localhost/" });
    const network = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", network);
    const a = requestAnalysis(data),
      b = requestAnalysis(data);
    expect(a).toBe(b);
    await expect(a).rejects.toThrow("暂未开通");
    expect(network).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("public production rejects analysis before reading cache or calling any service", async () => {
    vi.stubEnv("MODE", "production");
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    await expect(requestAnalysis(input())).rejects.toThrow("仅供本地使用");
    expect(network).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe("durable workout timer", () => {
  const active = () => ({
    ...workout(15),
    status: "active" as const,
    endedAt: null,
  });
  it("preserves legacy elapsed duration and uses timestamps, not ticks", () => {
    const s = active(),
      start = Date.parse(s.startedAt);
    expect(trainingSeconds(s, start + 65000)).toBe(65);
    expect(stats(workout(15)).minutes).toBe(60);
  });
  it("pauses, resumes and accumulates multiple pauses without duplicates", () => {
    const s = active(),
      start = Date.parse(s.startedAt);
    const paused = pauseSession(s, new Date(start + 10000).toISOString());
    expect(trainingSeconds(paused, start + 30000)).toBe(10);
    expect(pauseSession(paused)).toBe(paused);
    const resumed = resumeSession(paused, start + 40000);
    expect(trainingSeconds(resumed, start + 50000)).toBe(20);
    expect(resumeSession(resumed)).toBe(resumed);
    const second = resumeSession(
      pauseSession(resumed, new Date(start + 50000).toISOString()),
      start + 70000,
    );
    expect(trainingSeconds(second, start + 80000)).toBe(30);
  });
  it("can finish paused, freezes elapsed, preserves actual sets and prevents new recording while paused", () => {
    const s = active(),
      start = Date.parse(s.startedAt);
    const paused = pauseSession(s, new Date(start + 120000).toISOString());
    const next = completeSet(
      paused,
      paused.exercises[0].id,
      "anything",
      start + 150000,
    );
    expect(next).toBe(paused);
    const done = finishSession(paused, new Date(start + 600000).toISOString());
    expect(trainingSeconds(done, start + 999999)).toBe(120);
    expect(stats(done).minutes).toBe(2);
    expect(done.timing?.pausedAt).toBeNull();
    expect(done.exercises).toEqual(s.exercises);
    expect(
      validateState({ ...emptyState(), sessions: [done] }).sessions[0],
    ).toEqual(done);
  });
});
