import { makeExercise, catalog } from "../src/coach";
import { type Session, type Profile } from "../src/model";
export const syntheticProfile: Profile = {
  goal: "增肌",
  experience: "有一定经验",
  frequency: 3,
  equipment: ["杠铃"],
  preference: "均衡",
  limits: "",
};
export function syntheticWorkout(
  day: number,
  reps = [8, 8, 8],
  weight = 60,
): Session {
  const start = Date.UTC(2026, 9, day, 2),
    e = makeExercise(catalog[0], [], reps.length);
  e.sets.forEach((t, i) => {
    t.weight = weight;
    t.reps = reps[i];
    t.actual = {
      weight,
      reps: reps[i],
      completedAt: new Date(start + (i + 1) * 60000).toISOString(),
    };
  });
  return {
    id: `synthetic-${day}`,
    theme: "胸部",
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + 1800000).toISOString(),
    status: "finished",
    restUntil: null,
    recovery: false,
    source: "app",
    note: "V1.4 合成验收数据，非个人记录",
    exercises: [e],
  };
}
