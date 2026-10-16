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
  weight: num.min(0).max(1000),
  reps: num.int().min(1).max(200),
  completedAt: stamp,
  feeling: z.enum(["挺轻松", "刚刚好", "很吃力"]).optional(),
  rpe: num.min(1).max(10).optional(),
});
export const SetSchema = z.object({
  id,
  weight: num.min(0).max(1000).nullable(),
  reps: num.int().min(1).max(200),
  actual: ActualSchema.nullable(),
});
export const ExerciseSchema = z.object({
  id,
  catalogId: z.string().max(120),
  name: z.string().min(1).max(120),
  basis: z.enum(["总重量", "单只哑铃", "器械标重", "自重"]),
  equipment: z.enum(gears),
  rest: num.int().min(15).max(600),
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
  note: z.string().max(1000),
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
  e.sets.flatMap((s) => (s.actual ? [s.actual] : []));
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
  minutes: Math.max(
    0,
    Math.round(
      ((s.endedAt ? Date.parse(s.endedAt) : Date.now()) -
        Date.parse(s.startedAt)) /
        60000,
    ),
  ),
});
export function validateState(data: unknown): State {
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
    if (s.status === "finished" && !stats(s).sets)
      throw Error("已结束训练没有实际工作组");
    for (const e of s.exercises) {
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
  return { ...s, status: "finished", endedAt: now, restUntil: null };
}
export function completeSet(
  s: Session,
  exerciseId: string,
  setId: string,
  now = Date.now(),
): Session {
  if (s.status !== "active") return s;
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
  const exercises = s.exercises.map((x) =>
    x.id !== e.id
      ? x
      : {
          ...x,
          sets: x.sets.map((y) =>
            y.id !== t.id
              ? y
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
