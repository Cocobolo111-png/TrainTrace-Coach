import { describe, expect, it } from "vitest";
import { actionGuidance } from "../src/actionGuidance";
import { catalog, makeExercise } from "../src/coach";
import cards from "../src/actionCards.json";
describe("reviewed Action guidance", () => {
  const movement = (id: string) => makeExercise(catalog.find((m) => m.id === id)!, [], 3);
  it("parses the actual 30 reviewed Action records with traceable sources", () => {
    expect(cards).toHaveLength(30);
    expect(new Set(cards.map((c) => c.id)).size).toBe(30);
    for (const c of cards) {
      expect(c.type).toBe("action"); expect(c.status).toBe("reviewed");
      expect(c.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(c.sources[0]).toMatchObject({ video: expect.stringMatching(/^TS\d{3}$/), start: expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/) });
      if (c.guidance) expect(c.guidance.errors.length).toBeLessThanOrEqual(3);
    }
  });
  it("maps exact catalog identities and leaves unknown movements alone", () => {
    expect(actionGuidance(movement("lateral"))?.id).toBe("ACT-017");
    expect(actionGuidance(movement("db-press"))?.id).toBe("ACT-016");
    expect(actionGuidance(movement("rdl"))?.id).toBe("ACT-011");
    expect(actionGuidance(movement("db-rdl"))?.id).toBe("ACT-011");
    expect(actionGuidance(movement("bench"))).toBeNull();
    expect(actionGuidance(movement("curl"))).toBeNull(); // Seated is not prone.
    expect(actionGuidance(movement("incline"))).toBeNull();
    expect(actionGuidance(movement("wide-row"))).toBeNull();
  });
  it("rejects changed equipment, ambiguous cable machines and incompatible variants", () => {
    const lateral = movement("lateral");
    expect(actionGuidance({ ...lateral, equipment: "固定器械" })).toBeNull();
    expect(actionGuidance({ ...lateral, variant: "绳索" })).toBeNull();
    expect(actionGuidance({ ...lateral, name: "相似名称" })).toBeNull();
    expect(actionGuidance({ ...movement("pulldown"), variant: "宽握" })).toBeNull();
    expect(actionGuidance(movement("row"))).toBeNull();
    expect(actionGuidance({ ...movement("row"), variant: "绳索" })?.id).toBe("ACT-BACK-004");
  });
  it("has nine default catalog mappings without changing exercises", () => {
    const exercises = catalog.map((m) => makeExercise(m, [], 3));
    const before = JSON.stringify(exercises);
    expect(exercises.filter((e) => actionGuidance(e))).toHaveLength(9);
    expect(JSON.stringify(exercises)).toBe(before);
  });
});
