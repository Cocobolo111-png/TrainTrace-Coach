import {
  type Exercise,
  type Gear,
  type Profile,
  type Session,
  type Theme,
  completed,
  uid,
  volume,
} from "./model";
export type Movement = {
  id: string;
  name: string;
  theme: Theme;
  equipment: Gear;
  basis: Exercise["basis"];
  pattern: string;
  tip: string;
};
export const catalog: Movement[] = [
  {
    id: "bench",
    name: "杠铃卧推",
    theme: "胸部",
    equipment: "杠铃",
    basis: "总重量",
    pattern: "水平推",
    tip: "肩胛稳定，保留约 2–3 次余力。重量包含杆重。",
  },
  {
    id: "db-bench",
    name: "哑铃卧推",
    theme: "胸部",
    equipment: "哑铃",
    basis: "单只哑铃",
    pattern: "水平推",
    tip: "记录单只哑铃重量，两侧保持可控。",
  },
  {
    id: "chest-press",
    name: "坐姿推胸",
    theme: "胸部",
    equipment: "固定器械",
    basis: "器械标重",
    pattern: "水平推",
    tip: "使用同一台器械比较，调好座椅高度。",
  },
  {
    id: "pushup",
    name: "俯卧撑",
    theme: "胸部",
    equipment: "自重",
    basis: "自重",
    pattern: "水平推",
    tip: "必要时采用上斜俯卧撑，保持躯干稳定。",
  },
  {
    id: "incline",
    name: "上斜哑铃卧推",
    theme: "胸部",
    equipment: "哑铃",
    basis: "单只哑铃",
    pattern: "上斜推",
    tip: "控制下放，不为凑次数牺牲动作。",
  },
  {
    id: "fly",
    name: "蝴蝶机夹胸",
    theme: "胸部",
    equipment: "固定器械",
    basis: "器械标重",
    pattern: "胸部孤立",
    tip: "采用舒适活动范围，不追求过度拉伸。",
  },
  {
    id: "db-fly",
    name: "哑铃地板卧推",
    theme: "胸部",
    equipment: "哑铃",
    basis: "单只哑铃",
    pattern: "胸部孤立",
    tip: "上臂轻触地面，控制推起。",
  },
  {
    id: "pulldown",
    name: "高位下拉",
    theme: "背部",
    equipment: "固定器械",
    basis: "器械标重",
    pattern: "垂直拉",
    tip: "躯干稳定，拉至舒适位置。",
  },
  {
    id: "row",
    name: "坐姿划船",
    theme: "背部",
    equipment: "固定器械",
    basis: "器械标重",
    pattern: "水平拉",
    tip: "避免借力后仰，控制回放。",
  },
  {
    id: "db-row",
    name: "单臂哑铃划船",
    theme: "背部",
    equipment: "哑铃",
    basis: "单只哑铃",
    pattern: "水平拉",
    tip: "次数按每侧记录，两侧均完成后确认一组。",
  },
  {
    id: "bb-row",
    name: "杠铃划船",
    theme: "背部",
    equipment: "杠铃",
    basis: "总重量",
    pattern: "水平拉",
    tip: "保持躯干稳定，选择能控制的重量。",
  },
  {
    id: "prone",
    name: "俯卧 Y 举",
    theme: "背部",
    equipment: "自重",
    basis: "自重",
    pattern: "肩胛控制",
    tip: "轻缓抬臂，不耸肩。",
  },
  {
    id: "squat",
    name: "杠铃深蹲",
    theme: "腿部",
    equipment: "杠铃",
    basis: "总重量",
    pattern: "膝主导",
    tip: "先热身，在可控深度内完成。",
  },
  {
    id: "goblet",
    name: "高脚杯深蹲",
    theme: "腿部",
    equipment: "哑铃",
    basis: "单只哑铃",
    pattern: "膝主导",
    tip: "双手持一只哑铃，控制下蹲。",
  },
  {
    id: "legpress",
    name: "腿举",
    theme: "腿部",
    equipment: "固定器械",
    basis: "器械标重",
    pattern: "膝主导",
    tip: "同一器械、同一范围才适合比较。",
  },
  {
    id: "bw-squat",
    name: "徒手深蹲",
    theme: "腿部",
    equipment: "自重",
    basis: "自重",
    pattern: "膝主导",
    tip: "选择舒适范围，保持脚掌稳定。",
  },
  {
    id: "rdl",
    name: "杠铃罗马尼亚硬拉",
    theme: "腿部",
    equipment: "杠铃",
    basis: "总重量",
    pattern: "髋主导",
    tip: "髋向后移，重量贴近身体。",
  },
  {
    id: "db-rdl",
    name: "哑铃罗马尼亚硬拉",
    theme: "腿部",
    equipment: "哑铃",
    basis: "单只哑铃",
    pattern: "髋主导",
    tip: "双手各持哑铃，记录单只重量。",
  },
  {
    id: "bridge",
    name: "臀桥",
    theme: "腿部",
    equipment: "自重",
    basis: "自重",
    pattern: "髋主导",
    tip: "平稳抬髋，避免过度挺腰。",
  },
  {
    id: "curl",
    name: "坐姿腿弯举",
    theme: "腿部",
    equipment: "固定器械",
    basis: "器械标重",
    pattern: "腿部孤立",
    tip: "控制还原，不甩动配重。",
  },
  {
    id: "db-press",
    name: "坐姿哑铃推举",
    theme: "肩部",
    equipment: "哑铃",
    basis: "单只哑铃",
    pattern: "垂直推",
    tip: "不强求锁定，选择舒适幅度。",
  },
  {
    id: "press",
    name: "器械肩推",
    theme: "肩部",
    equipment: "固定器械",
    basis: "器械标重",
    pattern: "垂直推",
    tip: "调好座椅，保持背部稳定。",
  },
  {
    id: "bb-press",
    name: "杠铃推举",
    theme: "肩部",
    equipment: "杠铃",
    basis: "总重量",
    pattern: "垂直推",
    tip: "采用可控重量，不借力顶起。",
  },
  {
    id: "pike",
    name: "上斜俯卧撑",
    theme: "肩部",
    equipment: "自重",
    basis: "自重",
    pattern: "垂直推",
    tip: "双手支撑稳固台面，保持身体成一直线。",
  },
  {
    id: "lateral",
    name: "哑铃侧平举",
    theme: "肩部",
    equipment: "哑铃",
    basis: "单只哑铃",
    pattern: "肩部孤立",
    tip: "轻重量控制，不甩动。",
  },
];
export const finished = (sessions: Session[]) =>
  sessions
    .filter((s) => s.status === "finished")
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
export function lastExercise(
  sessions: Session[],
  catalogId: string,
): { exercise: Exercise; session: Session } | undefined {
  for (const session of finished(sessions).reverse()) {
    const exercise = session.exercises.find(
      (e) => e.catalogId === catalogId && completed(e).length,
    );
    if (exercise) return { exercise, session };
  }
}
export function recommend(
  sessions: Session[],
  now = Date.now(),
): { theme: Theme; reason: string; gap: number | null } {
  const history = finished(sessions).filter((s) =>
    s.exercises.some((e) => completed(e).length),
  );
  const last = history.at(-1),
    gap = last
      ? Math.floor((now - Date.parse(last.startedAt)) / 86400000)
      : null;
  if (!last)
    return {
      theme: "胸部",
      reason: "从一节精简训练开始，建立你的真实训练基线。",
      gap,
    };
  const recent = history.filter(
    (s) => now - Date.parse(s.startedAt) < 7 * 86400000,
  );
  const options: Theme[] = ["胸部", "背部", "腿部", "肩部"];
  const theme = options.sort((a, b) => {
    const score = (t: Theme) =>
      recent.reduce(
        (n, s) =>
          n +
          (s.theme === t
            ? 2
            : s.theme === "全身"
              ? 1
              : (t === "肩部" && s.theme === "胸部") ||
                  (t === "胸部" && s.theme === "肩部")
                ? 1
                : 0),
        0,
      );
    return score(a) - score(b);
  })[0];
  return {
    theme,
    reason:
      gap !== null && gap >= 14
        ? "距上次训练已有一段时间，建议先启用保守复训，并现场重新选重。"
        : `参考最近 7 天训练及推举重叠，今天可优先考虑${theme}；也可按意愿调整。`,
    gap,
  };
}
export function makeExercise(
  m: Movement,
  sessions: Session[],
  count = 3,
  recovery = false,
): Exercise {
  const last = lastExercise(sessions, m.id),
    actuals = last ? completed(last.exercise) : [];
  return {
    id: uid(),
    catalogId: m.id,
    name: m.name,
    basis: m.basis,
    equipment: m.equipment,
    rest: m.pattern.includes("孤立") ? 60 : 120,
    main: !m.pattern.includes("孤立"),
    skipped: false,
    sets: Array.from(
      { length: recovery ? Math.min(count, 2) : count },
      (_, i) => ({
        id: uid(),
        weight:
          m.basis === "自重"
            ? 0
            : recovery
              ? null
              : (actuals[i]?.weight ?? actuals.at(-1)?.weight ?? null),
        reps: actuals[i]?.reps ?? actuals.at(-1)?.reps ?? 8,
        actual: null,
      }),
    ),
  };
}
export function makePlan(
  profile: Profile,
  sessions: Session[],
  theme: Theme,
  minutes: number,
  recovery: boolean,
): Exercise[] {
  const available = catalog.filter((m) =>
    profile.equipment.includes(m.equipment),
  );
  const choices =
    theme === "全身"
      ? ["胸部", "背部", "腿部"]
          .map((t) => available.find((m) => m.theme === t))
          .filter((m): m is Movement => !!m)
      : available.filter((m) => m.theme === theme);
  const diverse = choices.filter(
    (m, i) => choices.findIndex((n) => n.pattern === m.pattern) === i,
  );
  return diverse
    .slice(0, minutes <= 20 ? 2 : 3)
    .map((m) =>
      makeExercise(
        m,
        sessions,
        minutes <= 30 ||
          profile.preference === "精简" ||
          profile.experience === "刚开始"
          ? 2
          : 3,
        recovery,
      ),
    )
    .map((e) => ({
      ...e,
      sets: e.sets.map((t) => ({
        ...t,
        reps: lastExercise(sessions, e.catalogId)
          ? t.reps
          : profile.goal === "力量提升" &&
              e.main &&
              profile.experience !== "刚开始"
            ? 5
            : 8,
      })),
    }));
}
export function reviewExercise(
  e: Exercise,
  sessions: Session[],
  current: Session,
): string {
  const history = sessions.filter(
    (s) =>
      s.id !== current.id &&
      Date.parse(s.startedAt) < Date.parse(current.startedAt),
  );
  const previous = lastExercise(history, e.catalogId),
    a = completed(e);
  if (!a.length) return "";
  if (!previous)
    return `${e.name}：建立训练基线。下次先尝试稳定重复本次实际表现。`;
  const old = completed(previous.exercise);
  if (
    e.basis !== previous.exercise.basis ||
    e.equipment !== previous.exercise.equipment
  )
    return `${e.name}：器械或计重方式不同，本次另建基线。`;
  const sameLoads =
    a.length === old.length && a.every((s, i) => s.weight === old[i].weight);
  const reps =
    a.reduce((n, s) => n + s.reps, 0) - old.reduce((n, s) => n + s.reps, 0);
  const delta = Math.round((volume(e) - volume(previous.exercise)) * 10) / 10;
  const restEqual = e.rest === previous.exercise.rest;
  let result = sameLoads
    ? reps > 0
      ? `相同组数与重量，多完成 ${reps} 次。`
      : reps < 0
        ? `相同组数与重量，少完成 ${-reps} 次。`
        : "重量、组数和总次数与上次相同。"
    : `计重工作量比上次${delta >= 0 ? "增加" : "减少"} ${Math.abs(delta)} kg·次；组数或重量有变化。`;
  const currentRpe = a.at(-1)?.rpe,
    oldRpe = old.at(-1)?.rpe;
  if (
    sameLoads &&
    reps === 0 &&
    currentRpe !== undefined &&
    oldRpe !== undefined &&
    currentRpe < oldRpe
  )
    result += " 末组 RPE 降低，主观余力有所增加。";
  if (!restEqual) result += " 计划休息有变化，仅作描述性比较。";
  return `${e.name}：${result} ${a.at(-1)?.feeling === "很吃力" || (currentRpe ?? 0) >= 9 ? "下次可先保持或减少次数，以动作稳定为先。" : "下次可先保持重量，争取稳定完成；暂不自动加重。"}`;
}
