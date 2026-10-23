import cards from "./actionCards.json";
import { catalog } from "./coach";
import type { Exercise } from "./model";
import { ChevronDown } from "lucide-react";

const mappings: Record<
  string,
  { card: string; variants: string[]; requireVariant?: boolean }
> = {
  "chest-press": { card: "ACT-005", variants: ["平推"] },
  pulldown: { card: "ACT-BACK-003", variants: ["对握", "绳索对握"] },
  row: {
    card: "ACT-BACK-004",
    variants: ["绳索", "坐姿绳索"],
    requireVariant: true,
  },
  rdl: { card: "ACT-011", variants: ["罗马尼亚", "RDL"] },
  "db-rdl": { card: "ACT-011", variants: ["罗马尼亚", "RDL"] },
  "db-press": { card: "ACT-016", variants: ["坐姿"] },
  lateral: { card: "ACT-017", variants: [] },
  dip: { card: "ACT-004", variants: ["胸部侧重"] },
  "reverse-fly": { card: "ACT-015", variants: ["坐姿器械"] },
  "hanging-leg": { card: "ACT-001", variants: ["悬垂"] },
};
export function actionGuidance(exercise: Exercise) {
  const movement = catalog.find((m) => m.id === exercise.catalogId);
  const mapping = mappings[exercise.catalogId];
  if (
    !movement ||
    !mapping ||
    exercise.name !== movement.name ||
    exercise.equipment !== movement.equipment ||
    exercise.basis !== movement.basis ||
    (exercise.loadType &&
      exercise.loadType !==
        (exercise.basis === "自重" ? "bodyweight" : "external")) ||
    (exercise.variant
      ? !mapping.variants.includes(exercise.variant)
      : mapping.requireVariant)
  )
    return null;
  return (
    cards.find(
      (c) => c.id === mapping.card && c.status === "reviewed" && c.guidance,
    ) ?? null
  );
}
export function ActionGuidance({ exercise }: { exercise: Exercise }) {
  const card = actionGuidance(exercise);
  return (
    <details className="action-guidance">
      <summary>
        动作指导
        <ChevronDown size={16} />
      </summary>
      {card?.guidance ? (
        <div>
          <h3>{card.guidance.title}</h3>
          <h4>动作目标</h4>
          <p>{card.guidance.goal}</p>
          <h4>动作要领</h4>
          <ul>
            {card.guidance.cues.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h4>常见错误</h4>
          <ul>
            {card.guidance.errors.slice(0, 3).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h4>训练提示</h4>
          {card.guidance.tips.map((s) => (
            <p key={s}>{s}</p>
          ))}
          <p className="helper">
            来源：{card.id} ·{" "}
            {card.sources
              .map((s) => `${s.video} ${s.start}–${s.end}`)
              .join("；")}{" "}
            · 审核素材摘编
          </p>
        </div>
      ) : (
        <p className="helper">
          此动作或变式暂未匹配审核知识卡，仍可直接开始并正常记录。
        </p>
      )}
    </details>
  );
}
