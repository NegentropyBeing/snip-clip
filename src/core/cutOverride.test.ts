import { describe, expect, it } from "vitest";
import { clearOverride, cutAt, cutMix, hasOverride, mixRegions, overrideTrack } from "./cutOverride";
import { ENVELOPE_RATE, mixEnvelope } from "./preview";
import type { Cut, TrackMix } from "./types";

// Jogo, Discord, Microfone.
const mix: TrackMix[] = [{ enabled: true, volume: 1 }, { enabled: true, volume: 1 }, { enabled: false, volume: 1 }];
const cut = (id: string, startSec: number, endSec: number, override?: Cut["override"]): Cut =>
  ({ id, name: "", startSec, endSec, ...(override ? { override } : {}) });

describe("cutMix", () => {
  it("follows the video's mix where the cut has no override", () => {
    expect(cutMix(mix, cut("a", 0, 5))).toEqual(mix);
    expect(cutMix(mix, null)).toEqual(mix);
  });

  it("keeps following later changes to the mix, except for overridden tracks", () => {
    const noDiscord = overrideTrack(cut("a", 0, 5), mix, 1, { enabled: false });
    const quieterGame = [{ enabled: true, volume: 0.6 }, ...mix.slice(1)];
    expect(cutMix(quieterGame, noDiscord)).toEqual([
      { enabled: true, volume: 0.6 },
      { enabled: false, volume: 1 },
      { enabled: false, volume: 1 },
    ]);
  });

  it("can turn on a track the video has off", () => {
    const withMic = overrideTrack(cut("a", 0, 5), mix, 2, { enabled: true });
    expect(cutMix(mix, withMic)[2]).toEqual({ enabled: true, volume: 1 });
  });
});

describe("overrideTrack and clearOverride", () => {
  it("starts from what the cut plays and merges later changes", () => {
    let c = overrideTrack(cut("a", 0, 5), mix, 0, { volume: 0.5 });
    c = overrideTrack(c, mix, 0, { enabled: false });
    expect(c.override).toEqual({ 0: { enabled: false, volume: 0.5 } });
    expect(hasOverride(c)).toBe(true);
  });

  it("puts one track or the whole cut back on the video's mix", () => {
    let c = overrideTrack(overrideTrack(cut("a", 0, 5), mix, 0, { volume: 0.5 }), mix, 1, { enabled: false });
    c = clearOverride(c, 0);
    expect(c.override).toEqual({ 1: { enabled: false, volume: 1 } });
    c = clearOverride(c, 1);
    expect(c).toEqual(cut("a", 0, 5));
    expect(hasOverride(c)).toBe(false);
    expect(clearOverride(overrideTrack(cut("a", 0, 5), mix, 0, { volume: 0 }))).toEqual(cut("a", 0, 5));
  });
});

describe("cutAt", () => {
  const cuts = [cut("late", 4, 10), cut("early", 2, 6), cut("other", 20, 30)];

  it("picks the selected cut where cuts overlap, else the one that starts first", () => {
    expect(cutAt(cuts, 5, null)?.id).toBe("early");
    expect(cutAt(cuts, 5, "late")?.id).toBe("late");
    expect(cutAt(cuts, 5, "other")?.id).toBe("early");
  });

  it("is null outside every cut, and a cut ends before its end time", () => {
    expect(cutAt(cuts, 15, null)).toBeNull();
    expect(cutAt(cuts, 10, null)).toBeNull();
    expect(cutAt(cuts, 4, null)?.id).toBe("early");
  });
});

describe("mixRegions", () => {
  it("covers the timeline and switches mix at the cuts", () => {
    const off = { 1: { enabled: false, volume: 1 } };
    const regions = mixRegions(mix, [cut("a", 2, 4, off), cut("b", 6, 8)], null, 10);
    expect(regions.map((r) => [r.startSec, r.endSec])).toEqual([[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]]);
    expect(regions[1].mix[1].enabled).toBe(false);
    expect(regions[3].mix).toEqual(mix);
  });

  it("joins pieces where the same cut plays", () => {
    const regions = mixRegions(mix, [cut("a", 0, 6), cut("b", 2, 4)], "a", 6);
    expect(regions).toHaveLength(1);
  });

  it("drives the waveform envelope", () => {
    const loud = new Float32Array(10 * ENVELOPE_RATE).fill(0.25);
    const regions = mixRegions(mix, [cut("a", 2, 4, { 0: { enabled: false, volume: 1 } })], null, 10);
    const env = mixEnvelope([loud, loud], mix, regions);
    expect(env[1 * ENVELOPE_RATE]).toBeCloseTo(0.5);
    expect(env[3 * ENVELOPE_RATE]).toBeCloseTo(0.25);
  });
});
