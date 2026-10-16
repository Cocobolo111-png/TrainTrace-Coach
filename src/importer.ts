import { catalog } from "./coach";
import {
  emptyState,
  type Exercise,
  type Session,
  type State,
  validateState,
} from "./model";
export type ImportPreview = { state: State; warnings: string[]; label: string };
function hash(s: string) {
  let n = 2166136261;
  for (const c of s) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return (n >>> 0).toString(16);
}
function parseWork(text: string): { weight: number; reps: number }[] {
  if (/lb|磅/i.test(text)) throw Error("lb 记录请先确认单位并转换为 kg");
  const normalized = text.replace(/[×✕*]/g, "x");
  // Only explicit kg values or explicit bodyweight. Never infer a missing load.
  const repeat = normalized.match(
    /^\s*(\d+(?:\.\d+)?)\s*kg\s*x\s*(\d+)\s*x\s*(\d+)\s*组?\s*$/i,
  );
  if (repeat) {
    if (+repeat[3] > 20) throw Error("组数超过 20，请确认");
    return Array.from({ length: +repeat[3] }, () => ({
      weight: +repeat[1],
      reps: +repeat[2],
    }));
  }
  const uniform = normalized.match(
    /^\s*(\d+(?:\.\d+)?)\s*kg\s*x\s*(\d+(?:\s*[/、]\s*\d+)*)\s*$/i,
  );
  if (uniform)
    return uniform[2]
      .split(/[/、]/)
      .map((r) => ({ weight: +uniform[1], reps: +r }));
  const body = normalized.match(/^\s*自重\s*x\s*(\d+(?:\s*[/、]\s*\d+)*)\s*$/);
  if (body) return body[1].split(/[/、]/).map((r) => ({ weight: 0, reps: +r }));
  const parts = normalized.split(/[，,；;]/);
  if (parts.length > 1) return parts.flatMap(parseWork);
  throw Error(
    "无法确认工作组。支持「60 kg × 8 / 8 / 7」或「60 kg × 8 × 3 组」",
  );
}
export function parseMarkdown(
  text: string,
  label = "training_log.md",
): ImportPreview {
  const clean = text.replace(/<!--[\s\S]*?-->/g, "");
  const sections = [
    ...clean.matchAll(
      /^## (\d{4}-\d{2}-\d{2})[｜|\s]+([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm,
    ),
  ];
  if (!sections.length)
    throw Error(
      "未找到「## YYYY-MM-DD｜训练主题」条目；模板里的注释不会被导入",
    );
  const warnings: string[] = [],
    sessions: Session[] = [];
  for (const section of sections) {
    const [, date, title, body] = section;
    const start = new Date(`${date}T12:00:00`).toISOString();
    if (
      new Date(start).getFullYear() !== +date.slice(0, 4) ||
      new Date(start).getMonth() + 1 !== +date.slice(5, 7) ||
      new Date(start).getDate() !== +date.slice(8, 10) ||
      Date.parse(start) > Date.now() + 86400000
    )
      throw Error(`${date} 日期异常，请确认`);
    const actual = body.match(
      /^### 实际完成\s*\n([\s\S]*?)(?=^### |$(?![\s\S]))/m,
    )?.[1];
    if (!actual) {
      warnings.push(`${date}：没有“实际完成”章节，未导入`);
      continue;
    }
    const rows = actual.split("\n"),
      exercises: Exercise[] = [];
    let pendingName = "",
      pendingBasis = "",
      pendingWork = "",
      pendingRest = 120;
    const add = (name: string, work: string, basis = "") => {
      const m = catalog.find((m) => m.name === name.trim());
      if (!m) {
        warnings.push(`${date}「${name}」：动作版本不明确或暂未支持，未导入`);
        return;
      }
      if (m.basis === "单只哑铃" && !/单只|单边|每侧|单手/.test(basis + work)) {
        warnings.push(`${date}「${name}」：需明确单只哑铃重量，未导入`);
        return;
      }
      try {
        const sets = parseWork(work.replace(/（.*?）|\(.*?\)/g, ""));
        if (!sets.length || sets.length > 20) throw Error("组数异常");
        if (exercises.some((e) => e.catalogId === m.id))
          throw Error("同日动作重复，请合并后导入");
        const eid = `md-${hash(date + title)}-${m.id}`;
        exercises.push({
          id: eid,
          catalogId: m.id,
          name: m.name,
          equipment: m.equipment,
          basis: m.basis,
          rest: pendingRest,
          main: !m.pattern.includes("孤立"),
          skipped: false,
          sets: sets.map((s, i) => ({
            id: `${eid}-${i}`,
            weight: s.weight,
            reps: s.reps,
            actual: { ...s, completedAt: start },
          })),
        });
      } catch (e) {
        warnings.push(
          `${date}「${name}」：${e instanceof Error ? e.message : "无法解析"}，未导入`,
        );
      }
    };
    const flush = () => {
      if (pendingName) {
        if (pendingWork) add(pendingName, pendingWork, pendingBasis);
        else warnings.push(`${date}「${pendingName}」：缺少工作组，未导入`);
      }
      pendingName = "";
      pendingWork = "";
      pendingBasis = "";
      pendingRest = 120;
    };
    for (const row of rows) {
      const line = row.trim().replace(/^[-*]\s*/, "");
      if (!line) continue;
      let match = line.match(/^名称[：:]\s*(.+)/);
      if (match) {
        flush();
        pendingName = match[1];
        continue;
      }
      match = line.match(/^工作组[：:]\s*(.+)/);
      if (match) {
        pendingWork = match[1];
        continue;
      }
      if (/^单边\/双边[：:]/.test(line)) {
        pendingBasis = line;
        continue;
      }
      if (/^组间休息[：:]/.test(line)) {
        const r = line.match(/(\d+)\s*(秒|s)/);
        if (r) pendingRest = +r[1];
        continue;
      }
      if (/^(热身组|动作感受|末组或各组 RPE|RPE|末组 RPE)[：:]/.test(line)) {
        warnings.push(`${date}：附加感受或热身未自动结构化，请在原日志保留`);
        continue;
      }
      match = line.match(/^([^：:]+)[：:]\s*(.+)/);
      if (match) {
        flush();
        add(match[1], match[2]);
        continue;
      }
      warnings.push(`${date}：无法识别「${line.slice(0, 70)}」，未导入`);
    }
    flush();
    if (exercises.length)
      sessions.push({
        id: `md-${hash(date + title + JSON.stringify(exercises))}`,
        theme: title.includes("胸")
          ? "胸部"
          : title.includes("背")
            ? "背部"
            : title.includes("腿")
              ? "腿部"
              : title.includes("肩")
                ? "肩部"
                : "全身",
        startedAt: start,
        endedAt: start,
        status: "finished",
        restUntil: null,
        note: "从 Markdown 导入；原记录未提供精确训练时间，时长不计入统计。",
        recovery: false,
        source: "markdown",
        exercises,
      });
  }
  if (!sessions.length)
    throw Error(`没有可确认的实际工作组。${warnings.join("；")}`);
  return {
    state: validateState({ ...emptyState(), sessions }),
    warnings,
    label,
  };
}
export function parseImport(text: string, label: string): ImportPreview {
  if (text.trim().startsWith("{")) {
    const state = validateState(JSON.parse(text));
    for (const session of state.sessions)
      for (const e of session.exercises) {
        const m = catalog.find((m) => m.id === e.catalogId);
        if (
          !m ||
          m.name !== e.name ||
          m.basis !== e.basis ||
          m.equipment !== e.equipment
        )
          throw Error("动作版本或计重方式与 V1 不匹配，请核对备份");
      }
    return { state, warnings: [], label };
  }
  return parseMarkdown(text, label);
}
