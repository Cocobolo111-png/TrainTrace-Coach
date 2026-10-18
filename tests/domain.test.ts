import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import {
  catalog,
  lastExercise,
  makeExercise,
  makePlan,
  reviewExercise,
} from "../src/coach";
import {
  completeSet,
  changeRestDuration,
  completed,
  emptyState,
  finishSession,
  stats,
  validateState,
  volume,
  type Session,
  type Profile,
} from "../src/model";
import {
  backup,
  mergeState,
  mutateState,
  readState,
  readGuidance,
  saveGuidance,
} from "../src/storage";
import { parseImport, parseMarkdown } from "../src/importer";
const profile: Profile = {
  goal: "增肌",
  experience: "有一定经验",
  frequency: 3,
  equipment: ["杠铃", "哑铃", "固定器械", "自重"],
  preference: "均衡",
  limits: "",
};
const now = Date.now() - 3600000;
function session(): Session {
  return {
    id: crypto.randomUUID(),
    theme: "胸部",
    startedAt: new Date(now).toISOString(),
    endedAt: null,
    status: "active",
    restUntil: null,
    recovery: false,
    note: "",
    source: "app",
    exercises: [makeExercise(catalog[0], [], 3)],
  };
}
function historical(): Session {
  let s = session();
  s.exercises[0].sets.forEach((t) => {
    t.weight = 60;
  });
  for (let i = 0; i < 3; i++)
    s = completeSet(
      s,
      s.exercises[0].id,
      s.exercises[0].sets[i].id,
      now + 1000 * (i + 1),
    );
  return finishSession(s, new Date(now + 600000).toISOString());
}
describe("actual training facts", () => {
  it("never counts prefilled plans as work and makes completion idempotent", () => {
    let s = session();
    const e = s.exercises[0],
      t = e.sets[0];
    t.weight = 60;
    expect(stats(s).sets).toBe(0);
    s = completeSet(s, e.id, t.id, now + 1000);
    s = completeSet(s, e.id, t.id, now + 2000);
    expect(stats(s).sets).toBe(1);
    expect(volume(s.exercises[0])).toBe(480);
    expect(s.restUntil).toBe(now + 121000);
  });
  it.each([true, false])(
    "starts rest only while a non-skipped work set remains (skipped=%s)",
    (skipped) => {
      let s = session();
      const extra = makeExercise(catalog[1], [], 1);
      extra.skipped = skipped;
      extra.sets[0].weight = 20;
      s.exercises.push(extra);
      s.exercises[0].sets.forEach((t) => {
        t.weight = 60;
      });
      for (const set of s.exercises[0].sets)
        s = completeSet(s, s.exercises[0].id, set.id, now + 1000);
      expect(s.restUntil).toBe(skipped ? null : now + 121000);
      if (!skipped) {
        s = completeSet(s, extra.id, extra.sets[0].id, now + 2000);
        expect(s.restUntil).toBeNull();
      }
      expect(stats(s).sets).toBe(skipped ? 3 : 4);
    },
  );
  it("inherits the latest completed pair without modifying completed sets or other exercises", () => {
    const initial = session(),
      e = initial.exercises[0];
    e.sets[0].weight = 60;
    e.sets[0].reps = 8;
    const other = makeExercise(catalog[1], [], 2);
    initial.exercises.push(other);
    const before = structuredClone(initial);
    let next = completeSet(initial, e.id, e.sets[0].id, now + 1000);
    expect(next.exercises[0].sets[1]).toMatchObject({
      weight: 60,
      reps: 8,
      actual: null,
    });
    expect(next.exercises[0].sets[2].weight).toBeNull();
    expect(next.exercises[1]).toEqual(other);
    expect(initial).toEqual(before);
    const first = structuredClone(next.exercises[0].sets[0]);
    next.exercises[0].sets[1] = {
      ...next.exercises[0].sets[1],
      weight: 62.5,
      reps: 7,
      draftEdited: true,
    };
    next = completeSet(next, e.id, e.sets[1].id, now + 2000);
    expect(next.exercises[0].sets[2]).toMatchObject({
      weight: 62.5,
      reps: 7,
      actual: null,
    });
    expect(next.exercises[0].sets[0]).toEqual(first);
    expect(stats(next).sets).toBe(2);
  });
  it.each([0, null, 70])(
    "preserves deliberately edited next-set weight %s including explicit zero and empty",
    (weight) => {
      const s = session(),
        e = s.exercises[0];
      e.sets[0].weight = 60;
      e.sets[1] = { ...e.sets[1], weight, reps: 10, draftEdited: true };
      const next = completeSet(s, e.id, e.sets[0].id, now + 1000);
      expect(next.exercises[0].sets[1]).toMatchObject({
        weight,
        reps: 10,
        actual: null,
      });
    },
  );
  it("inherits valid zero bodyweight but never copies a warmup into a work set", () => {
    const s = session(),
      e = s.exercises[0];
    e.basis = "自重";
    e.equipment = "自重";
    e.sets[0].weight = 0;
    e.sets[0].reps = 12;
    expect(
      completeSet(s, e.id, e.sets[0].id, now + 1000).exercises[0].sets[1],
    ).toMatchObject({ weight: 0, reps: 12, actual: null });
    e.sets[0].kind = "warmup";
    expect(
      completeSet(s, e.id, e.sets[0].id, now + 1000).exercises[0].sets[1]
        .weight,
    ).toBeNull();
  });
  it("rejects unknown weight and invalid reps", () => {
    const s = session(),
      e = s.exercises[0];
    expect(() => completeSet(s, e.id, e.sets[0].id)).toThrow();
    e.sets[0].weight = 60;
    e.sets[0].reps = 0;
    expect(() => completeSet(s, e.id, e.sets[0].id)).toThrow();
  });
  it("cannot finish an empty workout; finalized workouts cannot be recorded again", () => {
    const s = session();
    expect(() => finishSession(s)).toThrow();
    const h = historical();
    expect(completeSet(h, h.exercises[0].id, h.exercises[0].sets[0].id)).toBe(
      h,
    );
  });
  it("prefills per-set actuals from latest finalized exact movement, never plans", () => {
    const old = historical();
    old.exercises[0].sets[2].actual!.reps = 7;
    const active = session();
    active.exercises[0].sets[0].weight = 200;
    const discarded = {
      ...historical(),
      status: "discarded" as const,
      startedAt: new Date(now + 10000).toISOString(),
    };
    const e = makeExercise(catalog[0], [old, active, discarded]);
    expect(e.sets.map((t) => t.reps)).toEqual([8, 8, 7]);
    expect(e.sets.every((t) => !t.actual && t.weight === 60)).toBe(true);
    expect(lastExercise([old], catalog[1].id)).toBeUndefined();
  });
  it("recovery never copies historical high loads and reduces volume", () => {
    const e = makePlan(profile, [historical()], "胸部", 45, true)[0];
    expect(e.sets.length).toBe(2);
    expect(e.sets.every((t) => t.weight === null)).toBe(true);
  });
  it("uses only explicitly completed sets for volume and grounded summary", () => {
    const old = historical(),
      s = historical();
    s.startedAt = new Date(now + 610000).toISOString();
    s.endedAt = new Date(now + 1210000).toISOString();
    s.exercises[0].sets.forEach((t) => {
      t.actual!.completedAt = new Date(now + 620000).toISOString();
    });
    s.exercises[0].sets[1].actual!.reps = 10;
    expect(volume(s.exercises[0])).toBe(1560);
    expect(reviewExercise(s.exercises[0], [old, s], s)).toContain(
      "多完成 2 次",
    );
    expect(reviewExercise(old.exercises[0], [old], old)).toContain(
      "建立训练基线",
    );
  });
  it("keeps qualitative effort separate from numeric RPE", () => {
    const s = historical();
    s.exercises[0].sets[2].actual!.feeling = "很吃力";
    expect(s.exercises[0].sets[2].actual!.rpe).toBeUndefined();
    expect(completed(s.exercises[0]).at(-1)?.feeling).toBe("很吃力");
  });
  it("rejects invented bodyweight load in an imported backup", () => {
    const s = session();
    s.exercises = [
      makeExercise(
        catalog.find((m) => m.id === "pushup")!,
        [],
      ),
    ];
    s.exercises[0].sets[0].weight = 70;
    expect(() => validateState({ ...emptyState(), sessions: [s] })).toThrow(
      "自重动作",
    );
  });
  it("filters candidate plans by available equipment", () => {
    const p = { ...profile, equipment: ["自重"] as Profile["equipment"] };
    for (const theme of ["胸部", "背部", "腿部", "肩部", "全身"] as const) {
      expect(
        makePlan(p, [], theme, 30, false).every((e) => e.equipment === "自重"),
      ).toBe(true);
    }
  });
});
describe("validated import and deduplication", () => {
  it("roundtrips complete JSON including active state", () => {
    const s = { ...emptyState(), profile, sessions: [session(), historical()] };
    expect(parseImport(backup(s), "backup.json").state).toEqual(s);
  });
  it("merges identical backups once and rejects a conflicting ID", () => {
    const s = { ...emptyState(), profile, sessions: [historical()] };
    expect(mergeState(s, s).sessions).toHaveLength(1);
    const changed = structuredClone(s);
    changed.sessions[0].exercises[0].sets[0].actual!.reps++;
    expect(() => mergeState(s, changed)).toThrow("不同内容");
  });
  it("rejects duplicate set IDs, two active sessions, and missing facts", () => {
    const s = session();
    s.exercises[0].sets[1].id = s.exercises[0].sets[0].id;
    expect(() => validateState({ ...emptyState(), sessions: [s] })).toThrow(
      "ID",
    );
    expect(() =>
      validateState({ ...emptyState(), sessions: [session(), session()] }),
    ).toThrow("进行中");
    expect(() =>
      validateState({
        ...emptyState(),
        sessions: [
          {
            ...session(),
            status: "finished",
            endedAt: new Date().toISOString(),
          },
        ],
      }),
    ).toThrow("实际工作组");
  });
  it("imports only actual section; excludes plan, coach notes, pending, and comments", () => {
    const text =
      "<!--\n## 2025-01-01｜胸部\n### 实际完成\n- 杠铃卧推：200 kg × 10\n-->\n## 2026-10-01｜胸部\n### 计划\n- 杠铃卧推：100 kg × 10\n### 实际完成\n- 杠铃卧推：60 kg × 8 / 8 / 7\n### 教练观察\n- 杠铃卧推：80 kg × 10\n### 待确认\n- 杠铃卧推：90 kg × 8\n";
    const result = parseMarkdown(text);
    expect(result.state.sessions).toHaveLength(1);
    expect(volume(result.state.sessions[0].exercises[0])).toBe(1380);
    expect(
      mergeState(result.state, parseMarkdown(text).state).sessions,
    ).toHaveLength(1);
  });
  it("reports ambiguous units, dumbbell basis, unsupported movements without guessing", () => {
    const result = parseMarkdown(
      "## 2026-10-01｜胸部\n### 实际完成\n- 杠铃卧推：60 kg × 8 × 3 组\n- 上斜哑铃卧推：20 kg × 10\n- 哑铃卧推：40 lb × 10（单只）\n- 卧推：60 × 8\n",
    );
    expect(result.state.sessions[0].exercises).toHaveLength(1);
    expect(result.warnings).toHaveLength(3);
  });
  it("parses original nested actual template with explicit dumbbell basis", () => {
    const r = parseMarkdown(
      "## 2026-10-01｜胸部\n### 实际完成\n- 名称：上斜哑铃卧推\n- 热身组：10 kg × 8\n- 工作组：20 kg × 10 / 9\n- 单边/双边：单边\n- 组间休息：90 秒\n",
    );
    expect(r.state.sessions[0].exercises[0].rest).toBe(90);
    expect(volume(r.state.sessions[0].exercises[0])).toBe(380);
  });
});
describe("IndexedDB transaction durability", () => {
  beforeEach(async () => {
    await mutateState(() => emptyState());
  });
  it("commits then reloads and serializes simultaneous writes", async () => {
    const s = historical();
    await Promise.all([
      mutateState((v) => ({ ...v, sessions: [...v.sessions, s] })),
      mutateState((v) => ({ ...v, profile })),
    ]);
    const result = await readState();
    expect(result.sessions).toHaveLength(1);
    expect(result.profile).toEqual(profile);
  });
  it("simultaneous completion transactions cannot duplicate the same set", async () => {
    const initial = session(),
      eid = initial.exercises[0].id,
      sid = initial.exercises[0].sets[0].id;
    initial.exercises[0].sets[0].weight = 60;
    await mutateState((s) => ({ ...s, sessions: [initial] }));
    const record = () =>
      mutateState((s) => ({
        ...s,
        sessions: s.sessions.map((x) => completeSet(x, eid, sid, now + 1000)),
      }));
    await Promise.all([record(), record()]);
    expect(stats((await readState()).sessions[0]).sets).toBe(1);
  });
  it("aborted writes preserve prior state", async () => {
    await mutateState((s) => ({ ...s, profile }));
    await expect(
      mutateState((s) => ({ ...s, sessions: [session(), session()] })),
    ).rejects.toThrow();
    expect((await readState()).profile).toEqual(profile);
    expect((await readState()).sessions).toHaveLength(0);
  });
});

describe("presentation guidance preferences", () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("persists the current intro screen and preserves the workout hint acknowledgement", () => {
    expect(readGuidance()).toEqual({
      introStep: 0,
      workoutHintSeen: false,
      sound: true,
      vibration: true,
      defaultRest: null,
    });
    saveGuidance({ workoutHintSeen: true });
    for (const introStep of [1, 2, 3]) {
      saveGuidance({ introStep });
      expect(readGuidance()).toEqual({
        introStep,
        workoutHintSeen: true,
        sound: true,
        vibration: true,
        defaultRest: null,
      });
    }
  });
  it("persists independent cue preferences without resetting onboarding", () => {
    saveGuidance({ introStep: 3, sound: false });
    saveGuidance({ vibration: false });
    expect(readGuidance()).toEqual({
      introStep: 3,
      workoutHintSeen: false,
      sound: false,
      vibration: false,
      defaultRest: null,
    });
    saveGuidance({ sound: true });
    expect(readGuidance().vibration).toBe(false);
  });
  it("ignores invalid presentation values rather than treating them as a profile", () => {
    values.set("traintrace-guidance", "broken");
    expect(readGuidance().introStep).toBe(0);
    values.set(
      "traintrace-guidance",
      JSON.stringify({
        introStep: 9,
        workoutHintSeen: "yes",
        profile: { goal: "增肌" },
      }),
    );
    expect(readGuidance()).toEqual({
      introStep: 0,
      workoutHintSeen: false,
      sound: true,
      vibration: true,
      defaultRest: null,
    });
  });
  it("cannot mutate training state and does not block when localStorage is unavailable", async () => {
    const before = await readState();
    saveGuidance({ introStep: 3, workoutHintSeen: true });
    expect(await readState()).toEqual(before);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("blocked");
      },
      setItem: () => {
        throw Error("blocked");
      },
    });
    expect(readGuidance()).toEqual({
      introStep: 0,
      workoutHintSeen: false,
      sound: true,
      vibration: true,
      defaultRest: null,
    });
    expect(() => saveGuidance({ introStep: 1 })).not.toThrow();
    expect(await readState()).toEqual(before);
  });
});

describe("rest cues", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses distinct short cues, respects muted preferences and tolerates browser audio restrictions", async () => {
    const { unlockRestAudio, playRestCue } = await import("../src/restCues");
    let sound = false,
      running = false,
      blocked = false;
    const notes: {
      frequency: { value: number };
      stop: ReturnType<typeof vi.fn>;
    }[] = [];
    const session = { type: "auto" };
    vi.stubGlobal("navigator", { audioSession: session });
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ sound }),
      setItem: vi.fn(),
    });
    const construct = vi.fn();
    vi.stubGlobal(
      "AudioContext",
      class {
        currentTime = 100;
        destination = {};
        constructor() {
          construct();
        }
        get state() {
          return running ? "running" : "suspended";
        }
        resume() {
          if (blocked) return Promise.reject(Error("not allowed"));
          running = true;
          return Promise.resolve();
        }
        createOscillator() {
          const note = {
            frequency: { value: 0 },
            connect: vi.fn(),
            disconnect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            type: "",
            onended: null,
          };
          notes.push(note);
          return note;
        }
        createGain() {
          return {
            gain: {
              setValueAtTime: vi.fn(),
              linearRampToValueAtTime: vi.fn(),
              exponentialRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
            disconnect: vi.fn(),
          };
        }
      },
    );
    unlockRestAudio();
    playRestCue("complete");
    expect(construct).not.toHaveBeenCalled();
    sound = true;
    blocked = true;
    unlockRestAudio();
    await Promise.resolve();
    playRestCue("complete");
    expect(notes).toHaveLength(0);
    blocked = false;
    unlockRestAudio();
    playRestCue("complete");
    expect(session.type).toBe("ambient");
    expect(notes.map((n) => n.frequency.value)).toEqual([523.25, 659.25]);
    expect(notes[1].stop.mock.calls[0][0]).toBeCloseTo(100.59);
    playRestCue("skip");
    expect(notes).toHaveLength(3);
    expect(notes[2].frequency.value).toBe(440);
    expect(notes[2].stop).toHaveBeenCalledWith(100.1);
    sound = false;
    playRestCue("skip");
    expect(notes).toHaveLength(3);
  });
});

describe("free rest duration", () => {
  it("changes an active cycle from its original start, even if the new deadline is already past", () => {
    const initial = session(),
      e = initial.exercises[0];
    e.sets[0].weight = 30;
    const recorded = completeSet(initial, e.id, e.sets[0].id, now + 1000);
    const before = structuredClone(recorded.exercises[0].sets);
    const adjusted = changeRestDuration(recorded, 210);
    expect(adjusted.restUntil).toBe(now + 211000);
    expect(adjusted.exercises[0].rest).toBe(210);
    expect(adjusted.exercises[0].sets).toEqual(before);
    expect(changeRestDuration(adjusted, 60).restUntil).toBe(now + 61000);
    const finished = finishSession(
      recorded,
      new Date(now + 1000000).toISOString(),
    );
    expect(changeRestDuration(finished, 300)).toBe(finished);
    expect(() => changeRestDuration(recorded, 0)).toThrow();
  });
});
