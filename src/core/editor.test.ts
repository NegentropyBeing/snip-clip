import { describe, expect, it } from "vitest";
import { MIN_CUT_SEC, moveItem, normalizeCut, setEdge, shiftCut, totalDuration } from "./cuts";
import { decodeEnvelope, envelopeColumns, laneHeight, mixEnvelope, previewAudioArgs, previewFiles, proxyArgs } from "./preview";
import { mediaKey, parseProject } from "./project";
import { formatTimecode, parseTimecode } from "./timecode";
import type { MediaInfo } from "./types";

const cut = (startSec: number, endSec: number) => ({ id: "c", name: "", startSec, endSec });

describe("timecode", () => {
  it("formats", () => {
    expect(formatTimecode(72.5)).toBe("01:12.500");
    expect(formatTimecode(3725.25)).toBe("1:02:05.250");
    expect(formatTimecode(-1)).toBe("00:00.000");
  });

  it("parses what it formats", () => {
    for (const s of [0, 1.5, 72.5, 3725.25]) expect(parseTimecode(formatTimecode(s))).toBeCloseTo(s, 3);
    expect(parseTimecode("12")).toBe(12);
    expect(parseTimecode("1:02,5")).toBe(62.5);
  });

  it("rejects malformed input", () => {
    for (const s of ["", "a", "1:", "1:60", "1:60:00", "-3", "1:2:3:4"]) expect(parseTimecode(s)).toBeNull();
  });
});

describe("cuts", () => {
  it("orders and clamps", () => {
    expect(normalizeCut(cut(12, 5), 10)).toMatchObject({ startSec: 5, endSec: 10 });
    expect(normalizeCut(cut(-2, 3), 10)).toMatchObject({ startSec: 0, endSec: 3 });
    expect(normalizeCut(cut(4, 4), 10).endSec).toBeCloseTo(4 + MIN_CUT_SEC);
  });

  it("shifts without changing length", () => {
    expect(shiftCut(cut(2, 5), 10, 8)).toMatchObject({ startSec: 5, endSec: 8 });
    expect(shiftCut(cut(2, 5), -10, 8)).toMatchObject({ startSec: 0, endSec: 3 });
  });

  it("never inverts when dragging an edge", () => {
    expect(setEdge(cut(2, 5), "start", 9, 10).startSec).toBeCloseTo(5 - MIN_CUT_SEC);
    expect(setEdge(cut(2, 5), "end", 99, 10).endSec).toBe(10);
  });

  it("reorders", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(totalDuration([cut(0, 2), cut(5, 6)])).toBe(3);
  });
});

const media: MediaInfo = {
  path: "/v/in.mp4", durationSec: 10, width: 2560, height: 1440, fps: 60, videoCodec: "av1", hdr: true,
  audioTracks: [{ index: 0, title: "Mix", channels: 2, codec: "aac" }, { index: 1, title: null, channels: 1, codec: "aac" }],
};

describe("preview", () => {
  it("extracts every track in one run", () => {
    const files = previewFiles("/c", 2);
    const args = previewAudioArgs(media, files);
    expect(args.filter((a) => a === "-map")).toHaveLength(4);
    expect(args).toContain("/c/track1.m4a");
    expect(args).toContain("/c/track1.env");
  });

  it("builds a tonemapped 540p proxy", () => {
    const vf = proxyArgs(media, "/c/proxy.mp4")[proxyArgs(media, "/c/proxy.mp4").indexOf("-vf") + 1];
    expect(vf).toContain("tonemap");
    expect(vf).toContain("scale=-2:540");
    expect(proxyArgs({ ...media, hdr: false, height: 480 }, "/p")).toContain("format=yuv420p");
  });

  it("mixes envelopes by gain and skips disabled tracks", () => {
    const a = new Float32Array([0.2, 0.4]);
    const b = new Float32Array([0.5, 0.9, 0.1]);
    const m = mixEnvelope([a, b], [{ enabled: true, volume: 2 }, { enabled: false, volume: 1 }]);
    expect(Array.from(m)).toEqual([expect.closeTo(0.4), expect.closeTo(0.8), 0]);
    expect(mixEnvelope([a, b], [{ enabled: true, volume: 2 }, { enabled: true, volume: 1 }])[1]).toBe(1);
  });

  it("decodes s16le and takes peaks per column", () => {
    const env = decodeEnvelope(new Int16Array([16384, -32768, 0, 0]).buffer);
    expect(Array.from(env)).toEqual([0.5, 1, 0, 0]);
    expect(Array.from(envelopeColumns(env, 0, 0.004, 2))).toEqual([1, 0]);
  });

  it("splits the waveform area into lanes no thinner than 22 px", () => {
    expect(laneHeight(2, 72)).toBe(36);
    expect(laneHeight(3, 72)).toBe(24);
    expect(laneHeight(6, 72)).toBe(22);
    expect(laneHeight(0, 72)).toBe(72);
  });
});

describe("project", () => {
  it("keys by path, size and mtime", () => {
    const k = mediaKey("/v/a.mp4", 100, 1700000000000);
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    expect(mediaKey("/v/a.mp4", 101, 1700000000000)).not.toBe(k);
    expect(mediaKey("/v/a.mp4", 100, 1700000000000)).toBe(k);
  });

  it("parses saved projects defensively", () => {
    const json = JSON.stringify({
      version: 1, path: "/v/a.mp4", presetId: "nope", mode: "montage",
      cuts: [{ id: "1", name: "x", startSec: 1, endSec: 2 }, { id: "2", name: "bad", startSec: 3, endSec: 1 }],
      mix: [{ enabled: false, volume: 5 }],
    });
    const p = parseProject(json, 2)!;
    expect(p.cuts).toHaveLength(1);
    expect(p.mix).toEqual([{ enabled: false, volume: 2 }, { enabled: true, volume: 1 }]);
    expect(p.presetId).toBe("discord-20");
    expect(p.mode).toBe("montage");
    expect(parseProject("{", 1)).toBeNull();
  });

  it("keeps the valid tracks of cut overrides and drops the rest", () => {
    const json = JSON.stringify({
      version: 1, path: "/v/a.mp4", presetId: "discord-20", mode: "separate", mix: [],
      cuts: [
        { id: "1", name: "", startSec: 1, endSec: 2, override: { 1: { enabled: false, volume: 3 }, 7: { enabled: true, volume: 1 }, x: {} } },
        { id: "2", name: "", startSec: 3, endSec: 4, override: { 0: { enabled: "no" } } },
        { id: "3", name: "", startSec: 5, endSec: 6 },
      ],
    });
    const { cuts } = parseProject(json, 2)!;
    expect(cuts[0].override).toEqual({ 1: { enabled: false, volume: 2 } });
    expect(cuts[1]).not.toHaveProperty("override");
    expect(cuts[2]).toEqual({ id: "3", name: "", startSec: 5, endSec: 6 });
  });
});
