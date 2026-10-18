import source from "./traintrace-explainer.md?raw";
import { sameMovement, type TrainingFeedback } from "../src/feedback";
import { type Session } from "../src/model";

// Keep the reviewed document intact on the server; send selected fields only.
const entries = [
  ...source.matchAll(
    /^### (\d{2})｜([^\n]+)\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/gm,
  ),
];
const field = (body: string, name: string) =>
  body.match(new RegExp(`^- \\*\\*${name}\\*\\*：([^\\n]+)`, "m"))?.[1] ?? "";
export const explainerEntries = entries.map(([, id, title, body]) => ({
  id,
  title,
  concept: field(body, "专业概念"),
  explanation: field(body, "一句话通俗解释"),
  analogy: field(body, "生活化类比"),
  sourceType: field(body, "来源类型"),
  boundary: field(body, "适用边界"),
}));
export type ExplainerMatch = (typeof explainerEntries)[number] & {
  evidence: string;
  constraint: string;
};

export function matchExplainers(
  current: Session,
  history: Session[],
  feedback: TrainingFeedback,
): ExplainerMatch[] {
  const f = feedback.primary;
  if (
    f.status === "caution" ||
    !f.current.sets ||
    f.limits.some((limit) => limit.includes("本次存在"))
  )
    return [];
  const matches: ExplainerMatch[] = [];
  const add = (id: string, evidence: string, constraint: string) => {
    const entry = explainerEntries.find((e) => e.id === id);
    if (entry && matches.length < 2)
      matches.push({ ...entry, evidence, constraint });
  };
  if (f.status === "returning") {
    add(
      "12",
      f.evidence,
      current.recovery
        ? "用户启用了复训。只肯定重建基准，不断言力量流失、神经变化或给出降重百分比。没有停训前负重基准，不能说本次已经减重、已经轻量起步或没有照搬旧重量；保守起步是下一步建议，不是已证实的本次行为；行动沿用规则。"
        : "仅确认训练记录有间隔，不能断言实际停训、停训原因或能力下降；用条件语气解释保守重建基准，不给降重百分比。",
    );
  }
  if (f.status !== "returning" && f.comparison) {
    const increase = f.comparison.sharedLoads.find(
      (x) =>
        x.weight > 0 &&
        x.currentReps > x.previousReps &&
        x.currentSets >= x.previousSets,
    );
    if (increase && !["declining", "fluctuation"].includes(f.status))
      add(
        "01",
        `${f.name}在 ${increase.weight} kg 下：${increase.previousSets}组${increase.previousReps}次 → ${increase.currentSets}组${increase.currentReps}次。规则状态：${f.status}。`,
        "只肯定已记录的完成量增加。组数增加不能说每组能力提升；仅当规则为progress时可称进步信号。动作标准、疲劳、最大力量与肌肉增长均不能从组次推断。训练后疲惫只表示结束后感受，不能倒推用户是在疲劳下控制强度、主动减量或安排更合理；不以更像、可能是等语气猜测训练动机。不得照搬素材示例的动作稳定或加次数建议。",
      );
    const previous = f.history[0];
    if (
      previous &&
      f.status !== "declining" &&
      f.current.sets === previous.sets &&
      f.current.loads.every((w, i) => w === previous.loads[i]) &&
      f.current.reps < previous.reps
    ) {
      add(
        "09",
        f.evidence,
        "单次完成次数下调不等于退步或平台期；不推测睡眠、压力、饮食、疲劳或主动减量动机，自重次数不证明力量变化；行动沿用规则。",
      );
    }
  }
  // Rules stop trend comparison at rest changes. Inspect only the latest
  // related exposure for this fact, never bridge unknown/mismatched records.
  const exercise = current.exercises.find((e) => e.id === f.exerciseId);
  if (exercise && !["returning", "declining"].includes(f.status)) {
    const latest = history
      .filter(
        (s) =>
          s.status === "finished" &&
          s.id !== current.id &&
          s.endedAt &&
          Date.parse(s.endedAt) < Date.parse(current.startedAt) &&
          s.exercises.some(
            (e) =>
              e.catalogId === exercise.catalogId || e.name === exercise.name,
          ),
      )
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
    const related =
      latest?.exercises.filter(
        (e) => e.catalogId === exercise.catalogId || e.name === exercise.name,
      ) ?? [];
    const old = related[0];
    const complete = (e: typeof exercise) =>
      !e.skipped &&
      e.sets.some((t) => (!t.kind || t.kind === "work") && t.actual) &&
      e.sets.filter((t) => !t.kind || t.kind === "work").every((t) => t.actual);
    if (
      old &&
      related.length === 1 &&
      sameMovement(exercise, old) &&
      (exercise.equipment !== "固定器械" || !!exercise.equipmentId) &&
      complete(exercise) &&
      complete(old) &&
      !latest.recovery &&
      Date.parse(current.startedAt) - Date.parse(latest.startedAt) <=
        90 * 86400000 &&
      exercise.restRecorded === true &&
      old.restRecorded === true &&
      exercise.rest > old.rest
    ) {
      add(
        "06",
        `${f.name}明确记录的组间休息设置：${old.rest}秒 → ${exercise.rest}秒。`,
        "这是动作记录中的休息设置，不是逐组实测休息。可解释休息服务于下一组目标，不称已证实恢复到位、动作质量提高，也不把表现变化归因于休息。延长是否合适需结合下组完成情况，不能一概表扬或另开时长处方。",
      );
    }
  }
  if (
    f.rules.includes("TT-PO-02") &&
    ["progress", "stable"].includes(f.status) &&
    f.action.includes("最小档位")
  ) {
    add(
      "17",
      f.action,
      "仅解释规则已允许的最小一档推进，不编造器械增量、公斤数或百分比，不额外增加组次。",
    );
  }
  return matches;
}
