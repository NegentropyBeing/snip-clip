import { describe, expect, it } from "vitest";
import { outputDuration } from "./effects";
import { clampZoom, cropRect, previewZoom, setEffectZoom, zoomAt, zoomRegion } from "./zoom";
import type { Cut, Effect } from "./types";

const fx = (id: string, startSec: number, endSec: number, extra: Partial<Effect> = {}): Effect => ({ id, startSec, endSec, speed: 1, ...extra });
const cut = (id: string, startSec: number, endSec: number, effects?: Effect[]): Cut =>
  ({ id, name: "", startSec, endSec, ...(effects ? { effects } : {}) });

describe("clampZoom (FR-72)", () => {
  it("keeps the level between 1× and 4×", () => {
    expect(clampZoom({ x: 0.5, y: 0.5, level: 9 }).level).toBe(4);
    expect(clampZoom({ x: 0.5, y: 0.5, level: 0.3 }).level).toBe(1);
  });

  it("moves the centre so the region stays inside the frame", () => {
    expect(clampZoom({ x: 0, y: 1, level: 2 })).toEqual({ x: 0.25, y: 0.75, level: 2 });
    expect(clampZoom({ x: 0.9, y: 0.1, level: 4 })).toEqual({ x: 0.875, y: 0.125, level: 4 });
    expect(clampZoom({ x: 0.2, y: 0.8, level: 1 })).toEqual({ x: 0.5, y: 0.5, level: 1 });
  });
});

describe("zoomRegion", () => {
  it("is the part of the frame shown, with the video's aspect ratio", () => {
    expect(zoomRegion({ x: 0.25, y: 0.25, level: 2 })).toEqual({ left: 0, top: 0, width: 0.5, height: 0.5 });
    expect(zoomRegion({ x: 0.5, y: 0.5, level: 4 })).toEqual({ left: 0.375, top: 0.375, width: 0.25, height: 0.25 });
  });
});

describe("cropRect", () => {
  it("is the region in pixels, with even sizes and offsets inside the frame", () => {
    expect(cropRect({ x: 0.25, y: 0.25, level: 2 }, 2560, 1440)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(cropRect({ x: 0.75, y: 0.75, level: 2 }, 2560, 1440)).toEqual({ x: 1280, y: 720, w: 1280, h: 720 });
    const r = cropRect({ x: 0.61, y: 0.37, level: 3 }, 1920, 1080);
    for (const v of [r.x, r.y, r.w, r.h]) expect(v % 2).toBe(0);
    expect(r.w).toBe(640);
    expect(r.h).toBe(360);
    expect(r.x + r.w).toBeLessThanOrEqual(1920);
    expect(r.y + r.h).toBeLessThanOrEqual(1080);
  });

  it("stays inside the frame even for an unclamped centre or an odd size", () => {
    const r = cropRect({ x: 1, y: 0, level: 3 }, 1366, 767);
    expect(r.x + r.w).toBeLessThanOrEqual(1366);
    expect(r.y).toBe(0);
    expect(r.w % 2).toBe(0);
    expect(r.h % 2).toBe(0);
  });
});

describe("setEffectZoom", () => {
  const c = cut("c", 0, 10, [fx("a", 2, 4, { speed: 0.5 })]);

  it("turns zoom on clamped, changes it, and turns it off", () => {
    const on = setEffectZoom(c, "a", { x: 0, y: 0, level: 2 });
    expect(on.effects![0].zoom).toEqual({ x: 0.25, y: 0.25, level: 2 });
    expect(on.effects![0].speed).toBe(0.5);
    const off = setEffectZoom(on, "a", null);
    expect(off.effects![0]).toEqual(fx("a", 2, 4, { speed: 0.5 }));
  });

  it("does not change the output duration for a zoom-only effect (FR-73)", () => {
    const zoomOnly = cut("c", 0, 10, [fx("a", 2, 4, { zoom: { x: 0.5, y: 0.5, level: 2 } })]);
    expect(outputDuration(zoomOnly)).toBe(10);
  });
});

describe("previewZoom (FR-76)", () => {
  const z = { x: 0.3, y: 0.4, level: 2 };
  const a = cut("a", 0, 10, [fx("x", 2, 4, { zoom: z }), fx("y", 6, 8, { zoom: { ...z, level: 3 } })]);
  const at = (time: number, playing: boolean, selectedId: string | null, selectedEffectId: string | null) =>
    previewZoom({ cuts: [a], time, playing, selectedId, selectedEffectId });

  it("zooms inside the effect, playing or paused", () => {
    expect(at(3, true, null, null)).toEqual({ zoom: z, editing: null });
    expect(at(3, false, "a", null)).toEqual({ zoom: z, editing: null });
    expect(at(3, false, "a", "y")).toEqual({ zoom: z, editing: null });
    expect(at(5, false, "a", "x")).toEqual({ zoom: null, editing: null });
  });

  it("shows the whole frame and the rectangle when paused inside the selected effect", () => {
    expect(at(3, false, "a", "x")).toEqual({ zoom: null, editing: { cutId: "a", effect: a.effects![0] } });
    expect(at(3, true, "a", "x")).toEqual({ zoom: z, editing: null });
  });
});

describe("zoomAt (FR-76)", () => {
  const z = { x: 0.3, y: 0.4, level: 2 };
  const a = cut("a", 0, 10, [fx("x", 2, 4, { zoom: z }), fx("y", 5, 6, { speed: 0.5 })]);
  const b = cut("b", 3, 8);

  it("is the zoom of the effect under the playhead in the playing cut (FR-52)", () => {
    expect(zoomAt([a, b], 3, null)).toEqual(z);
    expect(zoomAt([a, b], 3, "b")).toBeNull();
    expect(zoomAt([a, b], 5.5, null)).toBeNull();
    expect(zoomAt([a, b], 1, null)).toBeNull();
  });
});
