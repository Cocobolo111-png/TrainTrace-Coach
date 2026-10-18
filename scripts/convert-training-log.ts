// One-time adapter for the supplied legacy chapter format; all facts use the existing JSON importer.
import { catalog } from "../src/coach";
import {
  emptyState,
  validateState,
  type Exercise,
  type Session,
} from "../src/model";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const hash = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 20);
export function convertTrainingLog(text: string) {
  const warnings: string[] = [],
    sessions: Session[] = [];
  const days = [
    ...text
      .replace(/<!--[\s\S]*?-->/g, "")
      .matchAll(
        /^## (\d{4}-\d{2}-\d{2})｜([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm,
      ),
  ];
  if (!days.length) throw Error("没有找到实际日期章节");
  let restDays = 0;
  for (const [, date, title, body] of days) {
    if (/休息/.test(title) && /无力量训练/.test(body)) {
      restDays++;
      continue;
    }
    const startedAt = `${date}T12:00:00+08:00`;
    if (new Date(startedAt).toISOString().slice(0, 10) !== date)
      throw Error("日期无效");
    const coachReference = body
      .match(/^### 教练观察\s*\n([\s\S]*)/m)?.[1]
      ?.replace(/\n---\s*$/, "")
      .trim();
    const facts = body.split(/^### 教练观察/m)[0];
    const chapters = [
      ...facts.matchAll(/^### ([^\n]+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm),
    ];
    const exercises: Exercise[] = [],
      notes: string[] = [];
    const add = (name: string, content: string) => {
      const movement = catalog.find((m) => m.name === name);
      if (!movement) {
        notes.push(`${name}：${content.trim()}`);
        warnings.push(
          `${date} ${name}：器械或负重口径尚不明确，保留原文，不计入精确统计。`,
        );
        return;
      }
      if (
        /[\d][ \t]*[–—~～-][ \t]*\d/.test(content) ||
        /待确认|各组实际次数未/.test(content)
      ) {
        notes.push(`${name}：${content.trim()}`);
        warnings.push(`${date} ${name}：区间或待确认记录，未转成精确组。`);
        return;
      }
      const sets: Exercise["sets"] = [];
      const lines = content
        .split("\n")
        .map((x) => x.trim().replace(/^[-*]\s*/, ""));
      for (const line of lines) {
        const match = line.match(
          /^(?:单边\s*)?(?:(\d+(?:\.\d+)?)\s*kg\s*[×x]\s*|自重\s*)?(\d+)\s*[×x]\s*(\d+)\s*组?$/i,
        );
        if (!match) continue;
        const weight = match[1]
          ? +match[1]
          : movement.basis === "自重"
            ? 0
            : null;
        if (
          weight === null ||
          (movement.basis === "单只哑铃" && !/单边|单只|每侧|单手/.test(line))
        ) {
          notes.push(`${name}：${line}`);
          warnings.push(`${date} ${name}：未明确计重口径，未结构化。`);
          continue;
        }
        const reps = +match[2],
          count = +match[3];
        if (count < 1 || count > 20 || reps < 1 || reps > 200)
          throw Error(`${date} 组次无效`);
        for (let i = 0; i < count; i++)
          sets.push({
            id: "",
            weight,
            reps,
            actual: { weight, reps, completedAt: startedAt },
          });
      }
      if (!sets.length) {
        notes.push(`${name}：${content.trim()}`);
        return;
      }
      const eid = `legacy-${hash(date + name)}`;
      sets.forEach((s, i) => (s.id = `${eid}-${i}`));
      const rest = content.match(
        /组间休息[：:]\s*(\d+(?:\.\d+)?)\s*(min|分钟|s|秒)/i,
      );
      const rpe = content.match(
        /(?:顶组\s*)?RPE[：:]\s*(\d+(?:\.\d+)?)(?![\d.])/,
      );
      exercises.push({
        id: eid,
        catalogId: movement.id,
        name: movement.name,
        equipment: movement.equipment,
        basis: movement.basis,
        rest: rest ? +rest[1] * (/min|分钟/i.test(rest[2]) ? 60 : 1) : 120,
        restRecorded: !!rest,
        ...(rpe
          ? {
              reportedRpe: {
                value: +rpe[1],
                scope: /顶组\s*RPE/.test(content)
                  ? ("top-set" as const)
                  : ("exercise" as const),
              },
            }
          : {}),
        main: !movement.pattern.includes("孤立"),
        skipped: false,
        sets,
      });
      if (!rest)
        warnings.push(
          `${date} ${name}：休息未记载，标记未知；显示的默认值不作为历史事实。`,
        );
    };
    for (const [, heading, content] of chapters) {
      if (
        ["背景", "热身", "训练后感受", "强度与反馈", "当日调整"].includes(
          heading,
        )
      ) {
        notes.push(`${heading}：${content.trim()}`);
        continue;
      }
      if (heading === "训练内容") {
        for (const line of content
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)) {
          const row = line.match(/^- ([^：]+)：(.+)$/);
          if (row) add(row[1], row[2]);
          else notes.push(line);
        }
      } else add(heading, content);
    }
    const note = ["历史日志；仅记录日期，未提供精确时长。", ...notes].join(
      "\n",
    );
    if (note.length > 1000)
      throw Error(`${date} 原文超出备注长度，请人工拆分，未截断`);
    if (exercises.length || notes.length)
      sessions.push({
        id: `legacy-${hash(date + title)}`,
        theme: title.includes("胸")
          ? "胸部"
          : title.includes("背")
            ? "背部"
            : title.includes("腿")
              ? "腿部"
              : title.includes("肩")
                ? "肩部"
                : "全身",
        startedAt,
        endedAt: startedAt,
        status: "finished",
        restUntil: null,
        note,
        recovery: /停练接近 1 个月/.test(facts),
        source: "markdown",
        exercises,
        ...(coachReference ? { coachReference } : {}),
      });
  }
  return {
    state: validateState({ ...emptyState(), sessions }),
    warnings,
    restDays,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const input = process.argv[2],
    output = process.argv[3];
  if (!input || !output)
    throw Error(
      "用法：node dist-server/convert.js /路径/training_log.md /私有路径/history.json",
    );
  const result = convertTrainingLog(await readFile(resolve(input), "utf8"));
  await mkdir(dirname(resolve(output)), { recursive: true, mode: 0o700 });
  await writeFile(resolve(output), JSON.stringify(result.state, null, 2), {
    mode: 0o600,
  });
  await writeFile(
    resolve(output) + ".review.json",
    JSON.stringify(
      { restDays: result.restDays, warnings: result.warnings },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      sessions: result.state.sessions.length,
      workSets: result.state.sessions
        .flatMap((s) => s.exercises)
        .flatMap((e) => e.sets).length,
      restDaysSkipped: result.restDays,
      warnings: result.warnings.length,
    }),
  );
}
