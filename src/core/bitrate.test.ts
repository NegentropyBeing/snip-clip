import { describe, expect, it } from "vitest";
import { chooseRung, planOutput, retryKbps, splitBudget, targetBytes } from "./bitrate";
import { PRESETS } from "./presets";

const obs1440 = { height: 1440, fps: 60, hdr: false };

describe("splitBudget", () => {
  it("fits video + audio + overhead under the target", () => {
    const { videoKbps, audioKbps } = splitBudget(30, 20_000_000);
    const bytes = ((videoKbps + audioKbps) * 1000 * 30) / 8;
    expect(bytes).toBeLessThanOrEqual(targetBytes(20_000_000));
    expect(audioKbps).toBe(128);
    expect(videoKbps).toBeGreaterThan(4500);
  });

  it("drops audio to 96 kbps on tight budgets", () => {
    expect(splitBudget(120, 20_000_000).audioKbps).toBe(96);
  });

  it("rejects non-positive durations", () => {
    expect(() => splitBudget(0, 20_000_000)).toThrow();
  });
});

describe("chooseRung", () => {
  it("keeps 1440p60 with a generous budget", () => {
    expect(chooseRung(12000, "h264", obs1440)).toEqual({ height: 1440, fps: 60 });
  });

  it("steps down the ladder as the budget shrinks", () => {
    expect(chooseRung(6000, "h264", obs1440)).toEqual({ height: 1080, fps: 60 });
    expect(chooseRung(3500, "h264", obs1440)).toEqual({ height: 1080, fps: 30 });
    expect(chooseRung(800, "h264", obs1440)).toEqual({ height: 720, fps: 30 });
  });

  it("allows higher rungs for AV1 at the same bitrate", () => {
    expect(chooseRung(6000, "av1", obs1440)).toEqual({ height: 1440, fps: 60 });
  });

  it("never upscales or raises fps", () => {
    expect(chooseRung(50000, "h264", { height: 1080, fps: 30 })).toEqual({ height: 1080, fps: 30 });
    expect(chooseRung(50000, "h264", { height: 480, fps: 60 })).toEqual({ height: 480, fps: 30 });
  });

  it("caps 144 fps sources at 60", () => {
    expect(chooseRung(50000, "h264", { height: 1440, fps: 144 }).fps).toBe(60);
  });
});

describe("planOutput", () => {
  it("flags low quality for long clips", () => {
    expect(planOutput(PRESETS["discord-20"], obs1440, 300).lowQuality).toBe(true);
    expect(planOutput(PRESETS["discord-20"], obs1440, 30).lowQuality).toBe(false);
  });

  it("tonemaps HDR only for size-limited presets", () => {
    const hdr = { ...obs1440, hdr: true };
    expect(planOutput(PRESETS["discord-20"], hdr, 30).tonemap).toBe(true);
    expect(planOutput(PRESETS.unlimited, hdr, 30).tonemap).toBe(false);
  });

  it("keeps source resolution and fps without a limit", () => {
    const p = planOutput(PRESETS.unlimited, { height: 1440, fps: 144, hdr: false }, 30);
    expect(p).toMatchObject({ height: 1440, fps: 144, videoKbps: null });
  });
});

describe("retryKbps", () => {
  it("reduces the bitrate proportionally to the overshoot", () => {
    const next = retryKbps(5000, 21_000_000, 20_000_000);
    expect(next).toBeLessThan(5000 * (19.5 / 21));
  });

  it("always reduces, even for a tiny overshoot", () => {
    expect(retryKbps(5000, 20_000_001, 20_000_000)).toBeLessThan(5000);
  });
});
