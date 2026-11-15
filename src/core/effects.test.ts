import { describe, expect, it } from "vitest";
import {
  addEffect, clearEffects, cutPieces, effectAt, effectSlot, hasEffects, MIN_EFFECT_SEC, outputDuration, removeEffect,
  moveEffect, setEffectEdge, setEffectSpeed, speedAt, totalOutputDuration, trimEffects,
} from "./effects";
import type { Cut, Effect } from "./types";

const fx = (id: string, startSec: number, endSec: number, speed = 0.5): Effect => ({ id, startSec, endSec, speed });
const cut = (startSec: number, endSec: number, effects?: Effect[], id = "c"): Cut =>
  ({ id, name: "", startSec, endSec, ...(effects ? { effects } : {}) });

describe("effectSlot and addEffect (FR-62)", () => {
  it("creates a 2 s effect at 0.5× from the playhead", () => {
    const c = addEffect(cut(10, 20), 12, "e")!;
    expect(c.effects).toEqual([fx("e", 12, 14)]);
    expect(hasEffects(c)).toBe(true);
  });

  it("shortens it to the free space before the end of the cut or the next effect", () => {
    expect(effectSlot(cut(10, 20), 19)).toEqual({ startSec: 19, endSec: 20 });
    expect(effectSlot(cut(10, 20, [fx("a", 13, 15)]), 12)).toEqual({ startSec: 12, endSec: 13 });
  });

  it("keeps effects in time order", () => {
    const c = addEffect(cut(10, 20, [fx("a", 15, 16)]), 11, "b")!;
    expect(c.effects!.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("creates nothing outside the cut, inside another effect or without the minimum", () => {
    expect(addEffect(cut(10, 20), 9, "e")).toBeNull();
    expect(addEffect(cut(10, 20), 20, "e")).toBeNull();
    expect(addEffect(cut(10, 20, [fx("a", 13, 15)]), 14, "e")).toBeNull();
    expect(addEffect(cut(10, 20, [fx("a", 13, 15)]), 13 - MIN_EFFECT_SEC / 2, "e")).toBeNull();
    expect(addEffect(cut(10, 20), 20 - MIN_EFFECT_SEC / 2, "e")).toBeNull();
  });
});

describe("moveEffect", () => {
  const c = cut(10, 20, [fx("a", 12, 14), fx("b", 16, 18)]);

  it("moves the whole effect, keeping its length", () => {
    expect(moveEffect(c, "a", 11).effects![0]).toMatchObject({ startSec: 11, endSec: 13 });
  });

  it("stops at the cut edges and at the neighbouring effects", () => {
    expect(moveEffect(c, "a", 5).effects![0]).toMatchObject({ startSec: 10, endSec: 12 });
    expect(moveEffect(c, "a", 17).effects![0]).toMatchObject({ startSec: 14, endSec: 16 });
    expect(moveEffect(c, "b", 11).effects![1]).toMatchObject({ startSec: 14, endSec: 16 });
    expect(moveEffect(c, "b", 30).effects![1]).toMatchObject({ startSec: 18, endSec: 20 });
  });
});

describe("setEffectEdge (FR-63)", () => {
  const c = cut(10, 20, [fx("a", 12, 14), fx("b", 16, 18)]);

  it("moves one edge", () => {
    expect(setEffectEdge(c, "a", "end", 15).effects![0]).toMatchObject({ startSec: 12, endSec: 15 });
    expect(setEffectEdge(c, "b", "start", 15).effects![1]).toMatchObject({ startSec: 15, endSec: 18 });
  });

  it("stops at the cut edges and at the neighbouring effects", () => {
    expect(setEffectEdge(c, "a", "start", 5).effects![0].startSec).toBe(10);
    expect(setEffectEdge(c, "a", "end", 17).effects![0].endSec).toBe(16);
    expect(setEffectEdge(c, "b", "start", 13).effects![1].startSec).toBe(14);
    expect(setEffectEdge(c, "b", "end", 25).effects![1].endSec).toBe(20);
  });

  it("never gets shorter than the minimum", () => {
    expect(setEffectEdge(c, "a", "start", 19).effects![0].startSec).toBeCloseTo(14 - MIN_EFFECT_SEC);
    expect(setEffectEdge(c, "a", "end", 0).effects![0].endSec).toBeCloseTo(12 + MIN_EFFECT_SEC);
  });

  it("changes the speed and removes effects", () => {
    expect(setEffectSpeed(c, "b", 0.25).effects![1].speed).toBe(0.25);
    expect(removeEffect(c, "a").effects!.map((e) => e.id)).toEqual(["b"]);
    expect(removeEffect(removeEffect(c, "a"), "b")).toEqual(cut(10, 20));
    expect(clearEffects(c)).toEqual(cut(10, 20));
  });
});

describe("trimEffects (FR-60)", () => {
  const c = cut(10, 20, [fx("a", 11, 13), fx("b", 16, 19)]);

  it("trims an effect the cut now ends inside of", () => {
    expect(trimEffects({ ...c, endSec: 17 }).effects).toEqual([fx("a", 11, 13), fx("b", 16, 17)]);
    expect(trimEffects({ ...c, startSec: 12 }).effects![0]).toEqual(fx("a", 12, 13));
  });

  it("removes effects left outside the cut or under the minimum", () => {
    expect(trimEffects({ ...c, endSec: 15 }).effects).toEqual([fx("a", 11, 13)]);
    expect(trimEffects({ ...c, endSec: 16 + MIN_EFFECT_SEC / 2 }).effects).toEqual([fx("a", 11, 13)]);
    expect(trimEffects({ ...c, startSec: 19.5 })).not.toHaveProperty("effects");
  });

  it("stays at the same moment of the video when the cut moves", () => {
    expect(trimEffects({ ...c, startSec: 12, endSec: 22 }).effects).toEqual([fx("a", 12, 13), fx("b", 16, 19)]);
    expect(trimEffects({ ...c, startSec: 13, endSec: 23 }).effects).toEqual([fx("b", 16, 19)]);
  });

  it("sorts and drops overlaps from saved data", () => {
    const messy = cut(0, 10, [fx("b", 5, 8), fx("a", 1, 6), fx("c", 7.9, 9)]);
    expect(trimEffects(messy).effects).toEqual([fx("a", 1, 6), fx("b", 6, 8), fx("c", 8, 9)]);
  });

  it("leaves a cut without effects alone", () => {
    const plain = cut(0, 10);
    expect(trimEffects(plain)).toBe(plain);
  });
});

describe("output duration (FR-69)", () => {
  it("counts each effect at its speed", () => {
    expect(outputDuration(cut(10, 20))).toBe(10);
    expect(outputDuration(cut(10, 20, [fx("a", 14, 16)]))).toBeCloseTo(12);
    expect(outputDuration(cut(0, 4, [fx("a", 0, 4, 0.25)]))).toBeCloseTo(16);
    expect(totalOutputDuration([cut(0, 4, [fx("a", 0, 4, 0.25)]), cut(5, 7)])).toBeCloseTo(18);
  });
});

describe("cutPieces", () => {
  it("splits the cut where the speed changes", () => {
    expect(cutPieces(cut(10, 20, [fx("a", 12, 14), fx("b", 14, 15, 0.25)]))).toEqual([
      { startSec: 10, endSec: 12, speed: 1 },
      { startSec: 12, endSec: 14, speed: 0.5 },
      { startSec: 14, endSec: 15, speed: 0.25 },
      { startSec: 15, endSec: 20, speed: 1 },
    ]);
    expect(cutPieces(cut(10, 20, [fx("a", 10, 20)]))).toEqual([{ startSec: 10, endSec: 20, speed: 0.5 }]);
    expect(cutPieces(cut(10, 20))).toEqual([{ startSec: 10, endSec: 20, speed: 1 }]);
  });
});

describe("cutPieces with zoom", () => {
  it("carries each effect's zoom, also at normal speed (FR-73)", () => {
    const zoom = { x: 0.25, y: 0.25, level: 2 };
    expect(cutPieces(cut(10, 20, [{ id: "a", startSec: 12, endSec: 14, speed: 1, zoom }]))).toEqual([
      { startSec: 10, endSec: 12, speed: 1 },
      { startSec: 12, endSec: 14, speed: 1, zoom },
      { startSec: 14, endSec: 20, speed: 1 },
    ]);
  });
});

describe("speedAt (FR-67)", () => {
  it("is the speed of the effect under the playhead in the playing cut", () => {
    const a = cut(0, 10, [fx("x", 2, 4)], "a");
    const b = cut(3, 8, [], "b");
    expect(effectAt(a, 3)?.id).toBe("x");
    expect(effectAt(a, 4)).toBeNull();
    expect(speedAt([a, b], 3.5, null)).toBe(0.5);
    // Where cuts overlap the selected one plays (FR-52).
    expect(speedAt([a, b], 3.5, "b")).toBe(1);
    expect(speedAt([a, b], 9, null)).toBe(1);
    expect(speedAt([a, b], 20, null)).toBe(1);
  });
});
