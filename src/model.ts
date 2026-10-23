import { z } from "zod";
export const themes = ["胸部", "背部", "腿部", "肩部", "全身"] as const;
export const gears = ["杠铃", "哑铃", "固定器械", "自重"] as const;
export type Theme = (typeof themes)[number];
export type Gear = (typeof gears)[number];
const num = z.number().finite();
const stamp = z.string().datetime({ offset: true });
const id = z.string().min(1).max(160);
export const ProfileSchema = z.object({
  goal: z.enum(["增肌", "力量提升", "减脂期维持", "建立习惯"]),
  experience: z.enum(["刚开始", "有一定经验", "规律训练"]),
  frequency: num.int().min(1).max(7),
  equipment: z.array(z.enum(gears)).min(1).max(4),
  preference: z.enum(["均衡", "精简", "保守"]),
  limits: z.string().max(1000),
});
const ActualSchema = z.object({
  unit: z.literal("kg").optional(),
  weight: num.min(0).max(1000),
  reps: num.int().min(1).max(200),
  completedAt: stamp,
  feeling: z.enum(["挺轻松", "刚刚好", "很吃力"]).optional(),
  rpe: num.min(1).max(10).optional(),
  quality: z.enum(["stable", "changed"]).optional(),
});
export const SetSchema = z.object({
  id,
  kind: z.enum(["work", "warmup", "test", "failed"]).optional(),
  weight: num.min(0).max(1000).nullable(),
  reps: num.int().min(1).max(200),
  actual: ActualSchema.nullable(),
  // Draft intent only: keep a user's pending-set edits when prefilling the next set.
  draftEdited: z.boolean().optional(),
});
export const ExerciseSchema = z.object({
  id,
  catalogId: z.string().max(120),
  name: z.string().min(1).max(120),
  basis: z.enum(["总重量", "单只哑铃", "器械标重", "自重"]),
  equipment: z.enum(gears),
  // V1.1 app records are explicitly kg and work sets. Never reinterpret lb as kg.
  unit: z.literal("kg").optional(),
  variant: z.string().min(1).max(120).optional(),
  equipmentId: z.string().min(1).max(120).optional(),
  loadType: z.enum(["external", "bodyweight"]).optional(),
  targetRepRange: z
    .tuple([num.int().min(1).max(200), num.int().min(1).max(200)])
    .refine(([lo, hi]) => lo <= hi)
    .optional(),
  targetRpe: num.min(1).max(10).optional(),
  rest: num.int().min(1).max(3600),
  restRecorded: z.boolean().optional(),
  reportedRpe: z
    .object({
      value: num.min(1).max(10),
      scope: z.enum(["exercise", "top-set"]),
    })
    .optional(),
  main: z.boolean(),
  skipped: z.boolean(),
  sets: z.array(SetSchema).max(20),
});
export const SessionSchema = z.object({
  id,
  theme: z.enum(themes),
  startedAt: stamp,
  endedAt: stamp.nullable(),
  status: z.enum(["active", "finished", "discarded"]),
  exercises: z.array(ExerciseSchema).max(20),
  restUntil: num.min(0).nullable(),
  timing: z
    .object({ pausedAt: stamp.nullable(), pausedMs: num.min(0) })
    .optional(),
  note: z.string().max(1000),
  coachReference: z.string().max(6000).optional(),
  recovery: z.boolean(),
  source: z.enum(["app", "markdown"]).default("app"),
});
export const StateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: num.int().min(0),
  profile: ProfileSchema.nullable(),
  sessions: z.array(SessionSchema).max(10000),
});
export type Profile = z.infer<typeof ProfileSchema>;
export type TrainingSet = z.infer<typeof SetSchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type State = z.infer<typeof StateSchema>;
export const emptyState = (): State => ({
  schemaVersion: 1,
  revision: 0,
  profile: null,
  sessions: [],
});
export const uid = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID is HTTPS-only; getRandomValues also works for LAN HTTP previews.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const completed = (e: Exercise) =>
  e.sets.flatMap((s) =>
    s.actual && (!s.kind || s.kind === "work") ? [s.actual] : [],
  );
// Load is always the displayed load: dumbbells are per hand; no invented body mass.
export const volume = (e: Exercise) =>
  completed(e).reduce((n, s) => n + s.weight * s.reps, 0);
export const stats = (s: Session) => ({
  exercises: s.exercises.filter((e) => completed(e).length).length,
  sets: s.exercises.reduce((n, e) => n + completed(e).length, 0),
  reps: s.exercises.reduce(
    (n, e) => n + completed(e).reduce((a, b) => a + b.reps, 0),
    0,
  ),
  minutes: Math.round(trainingSeconds(s) / 60),
});
export function validateState(data: unknown): State {
  // Reject unsupported units/load conventions before Zod can strip unknown fields.
  const raw = data as {
    sessions?: {
      exercises?: {
        unit?: unknown;
        loadType?: unknown;
        sets?: { actual?: { unit?: unknown }; unit?: unknown }[];
      }[];
    }[];
  };
  if (Array.isArray(raw?.sessions))
    for (const session of raw.sessions) {
      if (!Array.isArray(session?.exercises)) continue;
      for (const e of session.exercises) {
        if (
          (e.unit !== undefined && e.unit !== "kg") ||
          e.sets?.some(
            (t) =>
              (t.unit !== undefined && t.unit !== "kg") ||
              (t.actual?.unit !== undefined && t.actual.unit !== "kg"),
          )
        )
          throw Error(
            "当前版本只接受明确的 kg 记录；lb 或其他单位请先核实并转换，不能直接比较",
          );
        if (
          e.loadType !== undefined &&
          e.loadType !== "external" &&
          e.loadType !== "bodyweight"
        )
          throw Error(
            "当前版本暂不支持负重或辅助自重记录，请保留原始日志；不会估算体重",
          );
      }
    }
  const state = StateSchema.parse(data);
  const unique = (xs: string[]) => new Set(xs).size === xs.length;
  if (
    !unique(state.sessions.map((s) => s.id)) ||
    state.sessions.filter((s) => s.status === "active").length > 1
  )
    throw Error("训练 ID 重复或存在多节进行中训练");
  for (const s of state.sessions) {
    if (
      !unique(s.exercises.map((e) => e.id)) ||
      !unique(s.exercises.flatMap((e) => e.sets.map((t) => t.id)))
    )
      throw Error("动作或组 ID 重复");
    if (
      (s.status === "active") !== (s.endedAt === null) ||
      (s.endedAt && Date.parse(s.endedAt) < Date.parse(s.startedAt))
    )
      throw Error("训练开始、结束时间不一致");
    if (Date.parse(s.startedAt) > Date.now() + 86400000)
      throw Error("训练日期在未来，请先确认");
    if (
      s.timing &&
      ((s.timing.pausedAt &&
        (s.status !== "active" ||
          Date.parse(s.timing.pausedAt) < Date.parse(s.startedAt))) ||
        s.timing.pausedMs >
          Math.max(
            0,
            (s.endedAt ? Date.parse(s.endedAt) : Date.now()) -
              Date.parse(s.startedAt),
          ))
    )
      throw Error("训练暂停时间不一致");
    if (s.status === "finished" && !stats(s).sets)
      throw Error("已结束训练没有实际工作组");
    for (const e of s.exercises) {
      if (e.loadType && (e.loadType === "bodyweight") !== (e.basis === "自重"))
        throw Error("负重方式与计重口径不一致；暂不支持负重或辅助自重记录");
      if (
        e.basis === "自重" &&
        e.sets.some(
          (t) =>
            (t.weight !== null && t.weight !== 0) ||
            (t.actual && t.actual.weight !== 0),
        )
      )
        throw Error("自重动作不应估算为外加负荷");
      for (const t of e.sets)
        if (
          t.actual &&
          (Date.parse(t.actual.completedAt) < Date.parse(s.startedAt) ||
            (s.endedAt &&
              Date.parse(t.actual.completedAt) > Date.parse(s.endedAt)))
        )
          throw Error("完成组时间超出训练时间");
    }
  }
  return state;
}
export function finishSession(
  s: Session,
  now = new Date().toISOString(),
): Session {
  if (s.status !== "active") return s;
  if (!stats(s).sets) throw Error("请先记录至少一组，或选择放弃训练");
  return {
    ...resumeSession(s, Date.parse(now)),
    status: "finished",
    endedAt: now,
    restUntil: null,
  };
}
export function completeSet(
  s: Session,
  exerciseId: string,
  setId: string,
  now = Date.now(),
): Session {
  if (s.status !== "active" || s.timing?.pausedAt) return s;
  const e = s.exercises.find((x) => x.id === exerciseId),
    t = e?.sets.find((x) => x.id === setId);
  if (!e || !t || t.actual || e.skipped) return s;
  if (
    t.weight === null ||
    !Number.isFinite(t.weight) ||
    t.weight < 0 ||
    t.weight > 1000 ||
    !Number.isInteger(t.reps) ||
    t.reps < 1 ||
    t.reps > 200
  )
    throw Error("请确认本组重量和次数");
  const next = e.sets.slice(e.sets.indexOf(t) + 1).find((y) => !y.actual);
  const exercises = s.exercises.map((x) =>
    x.id !== e.id
      ? x
      : {
          ...x,
          sets: x.sets.map((y) =>
            y.id !== t.id
              ? y.id === next?.id &&
                !y.draftEdited &&
                (y.kind ?? "work") === (t.kind ?? "work")
                ? { ...y, weight: t.weight, reps: t.reps }
                : y
              : {
                  ...y,
                  actual: {
                    weight: t.weight!,
                    reps: t.reps,
                    completedAt: new Date(now).toISOString(),
                  },
                },
          ),
        },
  );
  const hasNextSet = exercises.some(
    (exercise) => !exercise.skipped && exercise.sets.some((set) => !set.actual),
  );
  return {
    ...s,
    exercises,
    restUntil: hasNextSet ? now + e.rest * 1000 : null,
  };
}

export function changeRestDuration(
  s: Session,
  seconds: number,
  exerciseId?: string,
): Session {
  if (s.status !== "active") return s;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600)
    throw Error("休息时间需为 1 秒至 60 分钟");
  const latest = s.exercises
    .flatMap((e) =>
      e.sets.flatMap((t) =>
        t.actual
          ? [{ exerciseId: e.id, at: Date.parse(t.actual.completedAt) }]
          : [],
      ),
    )
    .sort((a, b) => b.at - a.at)[0];
  const target = exerciseId ?? latest?.exerciseId;
  return {
    ...s,
    exercises: s.exercises.map((e) =>
      e.id === target ? { ...e, rest: seconds } : e,
    ),
    restUntil:
      s.restUntil !== null && latest && latest.exerciseId === target
        ? latest.at + seconds * 1000
        : s.restUntil,
  };
}

// Derived AI output shares one contract; it is never part of State or a training fact.
export const ANALYSIS_VERSION = "deepseek-json-v4-dimensions-explainer-v1";
const analysisText = z.string().trim().min(1).max(600);
export const AnalysisContentSchema = z
  .object({
    summary: analysisText,
    progress: z.string().trim().max(300),
    insight: z.string().trim().max(300),
    nextAction: analysisText,
  })
  .strict();
// Keep historical coach commentary out of both client and server AI contexts.
export function analysisRecord(session: Session): Session {
  const { coachReference: _reference, ...facts } = session;
  return facts;
}
export const AnalysisSchema = AnalysisContentSchema.extend({
  meta: z.object({
    provider: z.literal("deepseek"),
    requestedModel: z.string().min(1).max(120),
    model: z.string().min(1).max(120),
    status: z.literal(200),
    elapsedMs: num.int().min(0),
    generatedAt: stamp,
    usage: z
      .object({
        prompt_tokens: num.int().min(0).optional(),
        completion_tokens: num.int().min(0).optional(),
        total_tokens: num.int().min(0).optional(),
        prompt_cache_hit_tokens: num.int().min(0).optional(),
        prompt_cache_miss_tokens: num.int().min(0).optional(),
      })
      .optional(),
  }),
});
export type Analysis = z.infer<typeof AnalysisSchema>;
export function trainingSeconds(s: Session, now = Date.now()): number {
  const until = s.endedAt
    ? Date.parse(s.endedAt)
    : s.timing?.pausedAt
      ? Date.parse(s.timing.pausedAt)
      : now;
  return Math.max(
    0,
    Math.floor(
      (until - Date.parse(s.startedAt) - (s.timing?.pausedMs ?? 0)) / 1000,
    ),
  );
}
export function pauseSession(
  s: Session,
  now = new Date().toISOString(),
): Session {
  if (s.status !== "active" || s.timing?.pausedAt) return s;
  return { ...s, timing: { pausedAt: now, pausedMs: s.timing?.pausedMs ?? 0 } };
}
export function resumeSession(s: Session, now = Date.now()): Session {
  if (s.status !== "active" || !s.timing?.pausedAt) return s;
  return {
    ...s,
    timing: {
      pausedAt: null,
      pausedMs:
        s.timing.pausedMs + Math.max(0, now - Date.parse(s.timing.pausedAt)),
    },
  };
}
