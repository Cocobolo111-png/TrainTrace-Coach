import { catalog } from "./coach";
import {
  ExerciseSchema,
  type Exercise,
  type Profile,
  type Session,
} from "./model";

export const FEEDBACK_VERSION = "1.2.0-r2";
export type FeedbackStatus =
  | "baseline"
  | "progress"
  | "stable"
  | "fluctuation"
  | "declining"
  | "returning"
  | "insufficient"
  | "caution";
export const statusLabels: Record<FeedbackStatus, string> = {
  baseline: "基准建立",
  progress: "表现进步",
  stable: "稳定维持",
  fluctuation: "单次波动",
  declining: "连续下降待观察",
  returning: "停训后恢复",
  insufficient: "数据不足",
  caution: "谨慎推进",
};
// Short, reviewed excerpts only. These are rule explanations, never a parallel knowledge system.
// Source: user-supplied traintrace-feedback-knowledge.md §3 (2026-10-16).
export const ruleKnowledge: Record<string, string> = {
  "TT-PO-01": "首次记录建立基准，不推断趋势。[产品/经验]",
  "TT-PO-02":
    "目标区间上限稳定完成且强度未超目标后，才考虑器械最小一档；未知档位不给公斤数。[经验]",
  "TT-PO-03":
    "目标区间内、动作稳定且强度合适时，保持重量先尝试增加次数。[经验]",
  "TT-PO-04": "已完成但很吃力或动作改变时，先重复，不推进。[经验]",
  "TT-PO-06":
    "连续两次可比表现下降只提示排查；不等同平台期或疲劳诊断。[经验，阈值待验证]",
  "TT-TR-01":
    "同重量更多次数、同次数更大重量或同表现更低RPE，且努力程度不升，构成进步信号。[经验]",
  "TT-TR-02": "单次表现下降不代表长期退步；下次重复观察。[经验]",
  "TT-TR-05":
    "不同器械、变式、计重口径、休息或组次结构不能直接归因为能力变化。[经验]",
  "TT-VL-01":
    "计重工作量为逐组重量乘次数之和；哑铃沿用单只口径，不估算自重。[计算口径]",
  "TT-VL-02": "工作量变化不能直接换算肌肉增长。[一般原则]",
  "TT-RC-01":
    "全部训练记录中断至少7天或主动复训时，先重建基准，不补课、不测试极限；不推断中断原因。[保守经验]",
  "TT-RC-05":
    "记录出现明确危险症状时，先停止相关动作并寻求专业评估；文字筛查不是诊断，也无法排除风险。[安全边界]",
  "TT-RC-06":
    "没有强度或动作质量信息，只描述数字，不推断努力程度或自动建议加重。[保守约束]",
  "TT-X-01": "样本不足或可比性受损，明确缺口，只给最小下一步。[产品约束]",
};
type Actual = NonNullable<Exercise["sets"][number]["actual"]>;
export type Observation = {
  sessionId: string;
  date: string;
  sets: number;
  reps: number;
  volume: number | null;
  loads: number[];
  repetitions: number[];
  rpes: (number | null)[];
  feelings: (string | null)[];
  qualities: (string | null)[];
  reportedRpe?: Exercise["reportedRpe"];
  restSeconds?: number | null;
  recovery?: boolean;
};
export type ExerciseFeedback = {
  exerciseId: string;
  name: string;
  status: FeedbackStatus;
  conclusion: string;
  evidence: string;
  action: string;
  confidence: "低" | "中" | "高";
  rules: string[];
  limits: string[];
  current: Observation;
  history: Observation[];
  comparison: null | {
    reps: number;
    sets: number;
    volume: number | null;
    weights: (number | null)[];
    sharedLoads: {
      weight: number;
      previousSets: number;
      currentSets: number;
      previousReps: number;
      currentReps: number;
      previousVolume: number | null;
      currentVolume: number | null;
    }[];
    peakLoad: { previous: number; current: number } | null;
  };
};
export type TrainingFeedback = {
  version: string;
  sessionId: string;
  primary: ExerciseFeedback;
  exercises: ExerciseFeedback[];
  completion: { recorded: number; planned: number; excluded: number };
  gapDays: number | null;
  goal: Profile["goal"] | null;
  goalObservation: string;
};
const work = (e: Exercise) =>
  e.sets.filter((s) => !s.kind || s.kind === "work");
const round = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => String(round(n));
function facts(e: Exercise, s: Session): Observation {
  const a = work(e).flatMap((t) => (t.actual ? [t.actual] : []));
  return {
    sessionId: s.id,
    date: s.startedAt,
    sets: a.length,
    reps: a.reduce((n, t) => n + t.reps, 0),
    volume:
      e.basis === "自重"
        ? null
        : round(a.reduce((n, t) => n + t.weight * t.reps, 0)),
    loads: a.map((t) => t.weight),
    repetitions: a.map((t) => t.reps),
    rpes: a.map((t) => t.rpe ?? null),
    feelings: a.map((t) => t.feeling ?? null),
    qualities: a.map((t) => t.quality ?? null),
    reportedRpe: e.reportedRpe,
    restSeconds: e.restRecorded === false ? null : e.rest,
    recovery: s.recovery,
  };
}
function valid(e: Exercise, s: Session): boolean {
  if (
    !ExerciseSchema.safeParse(e).success ||
    !Number.isFinite(Date.parse(s.startedAt)) ||
    !s.endedAt ||
    Date.parse(s.endedAt) < Date.parse(s.startedAt) ||
    e.skipped ||
    !work(e).length ||
    work(e).some((t) => !t.actual) ||
    new Set(e.sets.map((t) => t.id)).size !== e.sets.length
  )
    return false;
  return work(e).every((t) => {
    const a = t.actual!;
    return (
      Date.parse(a.completedAt) >= Date.parse(s.startedAt) &&
      Date.parse(a.completedAt) <= Date.parse(s.endedAt!) &&
      (e.basis !== "自重" || a.weight === 0)
    );
  });
}
export const movementIdentity = (e: Exercise) =>
  JSON.stringify([
    e.catalogId,
    e.name,
    e.equipment,
    e.basis,
    e.unit ?? "kg",
    e.variant ?? null,
    e.equipmentId ?? null,
    e.loadType ?? (e.basis === "自重" ? "bodyweight" : "external"),
  ]);
export function sameMovement(a: Exercise, b: Exercise): boolean {
  // Catalog identity encodes the app's standard variation. No fuzzy name matching.
  return !!a.catalogId && movementIdentity(a) === movementIdentity(b);
}
function effortSafe(a: Observation, b: Observation) {
  return (
    a.sets === b.sets &&
    a.rpes.every(
      (r, i) => r !== null && b.rpes[i] !== null && r <= b.rpes[i]!,
    ) &&
    a.qualities.every((q) => q !== "changed") &&
    a.feelings.every((f) => f !== "很吃力")
  );
}
function direction(a: Observation, b: Observation): -1 | 0 | 1 | null {
  if (a.sets !== b.sets) return null;
  const sameLoad = a.loads.every((w, i) => w === b.loads[i]);
  const sameReps = a.repetitions.every((r, i) => r === b.repetitions[i]);
  if (sameLoad) {
    if (a.reps !== b.reps) return a.reps > b.reps ? 1 : -1;
    if (a.rpes.every((r, i) => r !== null && b.rpes[i] !== null)) {
      if (a.rpes.every((r, i) => r! >= b.rpes[i]! + 1)) return -1;
      if (
        a.rpes.every((r, i) => r! <= b.rpes[i]!) &&
        a.rpes.some((r, i) => r! < b.rpes[i]!)
      )
        return 1;
    }
    return 0;
  }
  if (
    sameReps &&
    a.loads.every((w, i) => w >= b.loads[i]) &&
    a.loads.some((w, i) => w > b.loads[i])
  )
    return 1;
  return null;
}
// Explicit symptom mentions only. Neither profile limits nor keyword absence establish health.
export function safetyMentions(note: string): string[] {
  const signal = "(?:锐痛|刺痛|麻木|放射痛|晕厥|异常气短|疼痛持续加重)";
  const negated = new RegExp(
    `(?:没有出现|没有|无|未出现|未见|不再|并无|否认)(?:明显|任何)?${signal}(?:[、和或及与]${signal})*`,
    "g",
  );
  return note
    .split(/[，。；;\n]/)
    .filter((part) => new RegExp(signal).test(part.replace(negated, "")));
}

const known = (e: Exercise) =>
  catalog.some(
    (m) =>
      m.id === e.catalogId &&
      m.name === e.name &&
      m.equipment === e.equipment &&
      m.basis === e.basis,
  );
export function evaluateTraining(
  session: Session,
  sessions: Session[],
  profile: Profile | null,
): TrainingFeedback {
  const before = sessions.filter(
    (s) =>
      s.status === "finished" &&
      s.id !== session.id &&
      s.endedAt &&
      Date.parse(s.endedAt) < Date.parse(session.startedAt),
  );
  const uniqueSessions = before
    .filter((s) => before.filter((x) => x.id === s.id).length === 1)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const gapDays = uniqueSessions.length
    ? Math.floor(
        (Date.parse(session.startedAt) -
          Date.parse(uniqueSessions[0].endedAt!)) /
          86400000,
      )
    : null;
  const returning = session.recovery || (gapDays !== null && gapDays >= 7);
  const danger = safetyMentions(session.note);
  const fatigue = session.note.replace(
    /(?:没有|不再|并不|未感到|无)(?:明显|任何)?(?:很疲惫|仍(?:感|有)疲劳)/g,
    "",
  );
  const exercises = session.exercises
    .filter((e) => work(e).some((t) => t.actual))
    .map((e): ExerciseFeedback => {
      const current = facts(e, session);
      const r: ExerciseFeedback = {
        exerciseId: e.id,
        name: e.name,
        status: "baseline",
        conclusion: `${e.name}已建立训练基线。`,
        evidence: `本次记录 ${current.sets} 组，共 ${current.reps} 次。`,
        action: "下次先用相同重量，尝试完成这次的组数和次数。",
        confidence: "低",
        rules: ["TT-PO-01", "TT-VL-01", "TT-X-01"],
        limits: [],
        current,
        history: [],
        comparison: null,
      };
      const decide = (
        status: FeedbackStatus,
        conclusion: string,
        action: string,
        ...rules: string[]
      ) => {
        r.status = status;
        r.conclusion = conclusion;
        r.action = action;
        r.rules.push(...rules);
      };
      if (e.basis === "自重")
        r.limits.push(
          "未记录当天体重，自重次数仅作描述，不估算负荷或判断力量进步。",
        );
      if (e.equipment === "固定器械" && !e.equipmentId)
        r.limits.push("未记录器械型号，无法确认是否为同一台器械。");
      if (current.rpes.some((x) => x === null)) {
        r.rules.push("TT-RC-06");
        r.limits.push("强度感受不完整，只描述数字变化，不能排除努力程度变化。");
      }
      if (current.qualities.some((x) => x === null))
        r.limits.push("动作质量未核实，比较以相同动作标准为前提。");
      const duplicates =
        session.exercises.filter(
          (x) => x.catalogId === e.catalogId && x.name === e.name,
        ).length > 1;
      if (
        !valid(e, session) ||
        duplicates ||
        sessions.filter((s) => s.id === session.id).length > 1 ||
        session.status !== "finished" ||
        !known(e)
      ) {
        decide(
          "insufficient",
          `${e.name}暂不能可靠比较。`,
          "下次先完整记录同一动作的正式组，建立可比较的基准。",
          "TT-X-01",
        );
        r.limits.push(
          "本次存在未完成组、重复标识、无效字段或未知动作版本，不填补缺失值。",
        );
      } else {
        // Contiguous recent comparable exposures; never skip a partial or changed-condition exposure to manufacture a trend.
        const related = uniqueSessions.filter((s) =>
          s.exercises.some(
            (x) => x.catalogId === e.catalogId || x.name === e.name,
          ),
        );
        for (const s of related) {
          const matches = s.exercises.filter(
            (x) => x.catalogId === e.catalogId || x.name === e.name,
          );
          const x = matches[0];
          if (
            matches.length !== 1 ||
            !sameMovement(e, x) ||
            !valid(x, s) ||
            (x.restRecorded !== false &&
              e.restRecorded !== false &&
              x.rest !== e.rest)
          )
            break;
          if (
            (Date.parse(session.startedAt) - Date.parse(s.startedAt)) /
              86400000 >
            90
          )
            break;
          r.history.push(facts(x, s));
          if (s.recovery || r.history.length === 4) break;
        }
        const prev = r.history[0];
        if (!prev && related.length) {
          decide(
            "insufficient",
            `${e.name}缺少近期可比较的记录。`,
            "先固定器械、动作变式、休息和组次，建立新的比较基准。",
            "TT-TR-05",
            "TT-X-01",
          );
        } else if (prev) {
          r.rules = r.rules.filter((x) => x !== "TT-PO-01");
          r.confidence = "中";
          r.comparison = {
            sharedLoads: [...new Set(current.loads)]
              .filter((w) => prev.loads.includes(w))
              .map((weight) => {
                const currentReps = current.loads.reduce(
                  (n, w, i) => n + (w === weight ? current.repetitions[i] : 0),
                  0,
                );
                const previousReps = prev.loads.reduce(
                  (n, w, i) => n + (w === weight ? prev.repetitions[i] : 0),
                  0,
                );
                return {
                  weight,
                  previousSets: prev.loads.filter((w) => w === weight).length,
                  currentSets: current.loads.filter((w) => w === weight).length,
                  previousReps,
                  currentReps,
                  previousVolume:
                    e.basis === "自重" ? null : round(weight * previousReps),
                  currentVolume:
                    e.basis === "自重" ? null : round(weight * currentReps),
                };
              }),
            peakLoad:
              e.basis === "自重"
                ? null
                : {
                    previous: Math.max(...prev.loads),
                    current: Math.max(...current.loads),
                  },
            reps: current.reps - prev.reps,
            sets: current.sets - prev.sets,
            volume:
              current.volume === null || prev.volume === null
                ? null
                : round(current.volume - prev.volume),
            weights: current.loads.map((w, i) =>
              prev.loads[i] === undefined ? null : round(w - prev.loads[i]),
            ),
          };
          const dir = direction(current, prev),
            sameLoads =
              current.sets === prev.sets &&
              current.loads.every((w, i) => w === prev.loads[i]);
          const delta = current.reps - prev.reps;
          r.evidence = sameLoads
            ? `相同组数与重量，${delta === 0 ? "总次数与上次相同" : `${delta > 0 ? "多" : "少"}完成 ${Math.abs(delta)} 次`}（${prev.reps} → ${current.reps} 次）。`
            : `正式组 ${prev.sets} → ${current.sets} 组；总次数 ${prev.reps} → ${current.reps} 次${r.comparison.volume === null ? "" : `；计重工作量 ${fmt(prev.volume!)} → ${fmt(current.volume!)} kg·次`}。`;
          if (
            sameLoads &&
            delta === 0 &&
            current.rpes.every((x) => x !== null) &&
            prev.rpes.every((x) => x !== null) &&
            current.rpes.some((x, i) => x !== prev.rpes[i])
          )
            r.evidence += ` 各组 RPE ${prev.rpes.join(" / ")} → ${current.rpes.join(" / ")}。`;
          if (!sameLoads && dir === 1) {
            const loads = (xs: number[]) =>
              [...new Set(xs)].map(fmt).join(" / ");
            r.evidence = `相同组数与逐组次数，重量由 ${loads(prev.loads)} → ${loads(current.loads)} kg（${e.basis}）。`;
          }
          if (
            dir === null ||
            e.basis === "自重" ||
            (e.equipment === "固定器械" && !e.equipmentId) ||
            current.restSeconds === null ||
            prev.restSeconds === null ||
            prev.recovery
          ) {
            decide(
              "insufficient",
              `${e.name}本次只作数据观察。`,
              "暂时重复当前表现，保持可比较的训练条件。",
              "TT-TR-05",
              "TT-X-01",
            );
            if (dir === null)
              r.limits.push(
                "重量与次数同时改变或组数不同，不能只凭工作量判断进退。",
              );
          } else if (dir < 0) {
            const consecutive =
              r.history[1] && direction(prev, r.history[1]) === -1;
            decide(
              consecutive ? "declining" : "fluctuation",
              consecutive
                ? `${e.name}连续两次可比表现下降，先观察原因。`
                : `${e.name}出现单次波动，暂不判断长期退步。`,
              consecutive
                ? "下次暂不推进，先用可控重量重复观察。"
                : "下次先重复当前重量与组数，观察能否稳定完成。",
              consecutive ? "TT-PO-06" : "TT-TR-02",
            );
            if (consecutive)
              r.limits.push(
                "这只是连续下降提示；恢复、动作标准和训练量证据不足，不判断平台期或疲劳原因。",
              );
          } else if (dir > 0 && effortSafe(current, prev)) {
            decide(
              "progress",
              `${e.name}出现可比较的进步信号。`,
              "下次先维持重量和组数，稳定重复本次表现。",
              "TT-TR-01",
            );
          } else if (dir === 0) {
            decide(
              "stable",
              `${e.name}保持了上次的训练表现。`,
              "下次先保持当前重量与组数，争取稳定完成。",
              "TT-TR-01",
            );
          } else {
            decide(
              "insufficient",
              `${e.name}的数字提高了，能力变化仍需观察。`,
              "暂不加重，先稳定重复本次表现。",
              "TT-RC-06",
            );
          }
          const capacity = r.comparison.sharedLoads.find(
            (x) =>
              x.currentSets > x.previousSets && x.currentReps > x.previousReps,
          );
          if (capacity && e.basis !== "自重" && r.status === "insufficient") {
            r.conclusion = `${e.name}在 ${fmt(capacity.weight)} kg 下完成了更多训练。`;
            r.evidence = `${fmt(capacity.weight)} kg：${capacity.previousSets} → ${capacity.currentSets} 组，${capacity.previousReps} → ${capacity.currentReps} 次；这是该重量下的训练容量变化。`;
          }
          if (e.basis === "自重")
            r.evidence = `自重动作 ${prev.sets} → ${current.sets} 组、${prev.reps} → ${current.reps} 次；不估算体重或总负荷。`;
          if (current.restSeconds === null || prev.restSeconds === null)
            r.limits.push(
              "历史休息未完整记录，仅描述工作组数据，不归因为力量变化。",
            );
          // Targets are explicit optional metadata; planned single reps are never invented as a rep range.
          const a: Actual[] = work(e).map((t) => t.actual!);
          const controlled =
            a.every((t) => t.quality === "stable") &&
            current.rpes.every(
              (x) => x !== null && e.targetRpe !== undefined && x < e.targetRpe,
            );
          if (
            ["progress", "stable"].includes(r.status) &&
            !returning &&
            e.basis !== "自重" &&
            controlled &&
            e.targetRepRange &&
            profile?.preference !== "保守" &&
            profile?.goal !== "减脂期维持"
          ) {
            if (a.every((t) => t.reps >= e.targetRepRange![1])) {
              r.action =
                "动作继续稳定、余力充足时，下次只按器械允许的最小档位小幅加重。";
              r.rules.push("TT-PO-02");
            } else if (a.every((t) => t.reps >= e.targetRepRange![0])) {
              r.action =
                "下次保持重量与组数，在目标区间内尝试总次数增加 1 次。";
              r.rules.push("TT-PO-03");
            }
          }
        }
      }
      if (returning && valid(e, session) && !duplicates && known(e)) {
        decide(
          "returning",
          `${e.name}先作为恢复训练的基准。`,
          "下次先以可控重量重建稳定表现，不补做中断期间的训练量。",
          "TT-RC-01",
        );
        r.evidence = `${gapDays === null ? "本次启用了轻量恢复训练" : `记录显示距上次训练 ${gapDays} 天`}；本次完成 ${current.sets} 组、${current.reps} 次。`;
        r.limits.push(
          "记录间隔不代表实际停训原因，接回记录不用于证明长期退步。",
        );
        r.comparison = null;
      }
      const hard = work(e).some(
        (t) =>
          t.actual?.feeling === "很吃力" ||
          t.actual?.quality === "changed" ||
          (e.targetRpe !== undefined &&
            t.actual?.rpe !== undefined &&
            t.actual.rpe >= e.targetRpe),
      );
      if (
        hard &&
        !returning &&
        r.status !== "declining" &&
        r.status !== "insufficient"
      ) {
        decide(
          "caution",
          `${e.name}已记录吃力或动作改变，暂缓推进。`,
          "下次先不加重，以动作可控为前提重复观察。",
          "TT-PO-04",
        );
        r.evidence += " 本次有很吃力、达到已设强度上限或动作改变的记录。";
      }
      if (
        ["insufficient", "stable"].includes(r.status) &&
        valid(e, session) &&
        new Set(current.loads).size === 1 &&
        new Set(current.repetitions).size === 1
      ) {
        const load =
          e.basis === "自重" ? "自重" : `${fmt(current.loads[0])} kg`;
        r.action = `下次先重复${e.name} ${load} × ${current.repetitions[0]} 次 × ${current.sets} 组，暂不增加负荷。`;
      }
      if (/很疲惫|仍(?:感|有)疲劳/.test(fatigue) && !returning)
        r.action = "下次先不加重；热身后若仍疲惫，减少相关动作的组数。";
      if (danger.length) {
        decide(
          "caution",
          "本次备注出现需要谨慎处理的信号。",
          "先停止相关动作的高强度训练，并寻求专业评估。",
          "TT-RC-05",
        );
        r.evidence = `你的备注提到：${danger.join("；")}`;
        r.limits.push("仅对明确文字信号保守提醒，不诊断、不推断病因。");
      }
      if (r.limits.length) r.confidence = "低";
      r.rules = [...new Set(r.rules)];
      return r;
    });
  const fallback: ExerciseFeedback = {
    exerciseId: "",
    name: "本次训练",
    status: "insufficient",
    conclusion: "没有可分析的正式组。",
    evidence: "未将热身、测试或未完成组计入表现。",
    action: "下次先记录一组完整的正式组，建立训练基准。",
    confidence: "低",
    rules: ["TT-X-01"],
    limits: [],
    current: {
      sessionId: session.id,
      date: session.startedAt,
      sets: 0,
      reps: 0,
      volume: null,
      loads: [],
      repetitions: [],
      rpes: [],
      feelings: [],
      qualities: [],
    },
    history: [],
    comparison: null,
  };
  const priority: Record<FeedbackStatus, number> = {
    caution: 8,
    returning: 7,
    declining: 6,
    fluctuation: 5,
    progress: 4,
    stable: 3,
    insufficient: 2,
    baseline: 1,
  };
  const primary =
    [...exercises].sort(
      (a, b) =>
        priority[b.status] - priority[a.status] ||
        Number(!!session.exercises.find((e) => e.id === b.exerciseId)?.main) -
          Number(!!session.exercises.find((e) => e.id === a.exerciseId)?.main),
    )[0] ?? fallback;
  return {
    version: FEEDBACK_VERSION,
    sessionId: session.id,
    primary,
    exercises,
    completion: {
      recorded: exercises.reduce((n, e) => n + e.current.sets, 0),
      planned: session.exercises
        .filter((e) => !e.skipped)
        .reduce((n, e) => n + work(e).length, 0),
      excluded: session.exercises.reduce(
        (n, e) =>
          n +
          e.sets.filter((t) => t.kind && t.kind !== "work" && t.actual).length,
        0,
      ),
    },
    gapDays,
    goal: profile?.goal ?? null,
    goalObservation:
      profile?.goal === "建立习惯"
        ? "本次已留下训练记录，持续记录是习惯目标的可观察进展。"
        : profile?.goal === "减脂期维持"
          ? "目标是减脂期维持，稳定表现本身值得关注；未记录体重变化，不推断减脂效果。"
          : profile?.goal === "力量提升"
            ? "力量目标优先观察同组次负荷与同负荷次数，不估算最大力量。"
            : "增肌目标可观察同条件下的训练表现；计重工作量增加不等于肌肉增长。",
  };
}
