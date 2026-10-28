import { describe, expect, it } from "vitest";
import { planOutput } from "./bitrate";
import { buildJob, type ExportRequest } from "./ffmpeg";
import { PRESETS } from "./presets";
import type { MediaInfo, PresetId } from "./types";

const media: MediaInfo = {
  path: "/clips/replay.mp4",
  durationSec: 180,
  width: 2560,
  height: 1440,
  fps: 60,
  videoCodec: "av1",
  hdr: false,
  audioTracks: ["Mix", "Jogo", "Discord", "Navegador", "Microfone", "Sistema"].map((title, index) => ({
    index, title, channels: 2, codec: "aac",
  })),
};

// Jogo at 150%, Microfone at 100%; everything else off.
const mix = media.audioTracks.map((t) => ({ enabled: t.index === 1 || t.index === 4, volume: t.index === 1 ? 1.5 : 1 }));

function request(presetId: PresetId, overrides: Partial<ExportRequest> = {}): ExportRequest {
  const preset = PRESETS[presetId];
  const cuts = overrides.cuts ?? [{ id: "a", name: "", startSec: 10, endSec: 40 }];
  const duration = cuts.reduce((s, c) => s + c.endSec - c.startSec, 0);
  return {
    media, mix, cuts, preset,
    backend: "cpu",
    plan: planOutput(preset, media, duration),
    outPath: "/out/clip.mp4",
    passLogPrefix: "/tmp/pass",
    ...overrides,
  };
}

const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("buildJob", () => {
  it("uses x264 two-pass for the default Discord preset on CPU", () => {
    const { passes } = buildJob(request("discord-20"));
    expect(passes).toHaveLength(2);
    expect(passes[0]).toContain("-an");
    expect(argAfter(passes[0], "-pass")).toBe("1");
    expect(argAfter(passes[1], "-pass")).toBe("2");
    expect(argAfter(passes[1], "-c:v")).toBe("libx264");
    expect(passes[1].at(-1)).toBe("/out/clip.mp4");
  });

  it("seeks the input and limits the duration per cut", () => {
    const { passes } = buildJob(request("discord-20"));
    expect(argAfter(passes[1], "-ss")).toBe("10.000");
    expect(argAfter(passes[1], "-t")).toBe("30.000");
  });

  it("mixes only the enabled tracks with their volumes into one stream", () => {
    const args = buildJob(request("discord-20")).passes[1];
    const graph = argAfter(args, "-filter_complex");
    expect(graph).toContain("[0:a:1]volume=1.50");
    expect(graph).toContain("[0:a:4]volume=1.00");
    expect(graph).not.toContain("0:a:2");
    expect(graph).toContain("amix=inputs=2");
    expect(args.filter((a) => a === "-map")).toHaveLength(2);
  });

  it("drops audio entirely when no track is enabled", () => {
    const silent = media.audioTracks.map(() => ({ enabled: false, volume: 1 }));
    const args = buildJob(request("discord-20", { mix: silent })).passes[1];
    expect(args).toContain("-an");
    expect(argAfter(args, "-filter_complex")).not.toContain("amix");
  });

  it("uses a single pass on GPU", () => {
    const { passes } = buildJob(request("discord-20", { backend: "nvenc" }));
    expect(passes).toHaveLength(1);
    expect(argAfter(passes[0], "-c:v")).toBe("h264_nvenc");
    expect(argAfter(passes[0], "-rc")).toBe("vbr");
  });

  it("concatenates cuts into one file for a montage", () => {
    const cuts = [
      { id: "a", name: "", startSec: 10, endSec: 20 },
      { id: "b", name: "", startSec: 50, endSec: 65 },
    ];
    const args = buildJob(request("discord-20", { cuts, backend: "nvenc" })).passes[0];
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(argAfter(args, "-filter_complex")).toContain("concat=n=2:v=1:a=1[vout][aout0]");
  });

  it("tonemaps HDR sources for Discord and tags BT.709", () => {
    const hdrMedia = { ...media, hdr: true };
    const args = buildJob(request("discord-20", { media: hdrMedia, plan: planOutput(PRESETS["discord-20"], hdrMedia, 30) })).passes[1];
    expect(argAfter(args, "-filter_complex")).toContain("tonemap=tonemap=hable");
    expect(argAfter(args, "-colorspace")).toBe("bt709");
  });

  it("downscales when the plan asks for a lower resolution", () => {
    const cuts = [{ id: "a", name: "", startSec: 0, endSec: 150 }];
    const args = buildJob(request("discord-20", { cuts })).passes[1];
    expect(argAfter(args, "-filter_complex")).toMatch(/scale=-2:(1080|720)/);
  });

  it("keeps separate tracks on the unlimited preset when asked", () => {
    const args = buildJob(request("unlimited", { keepSeparateTracks: true, backend: "nvenc" })).passes[0];
    expect(argAfter(args, "-filter_complex")).not.toContain("amix");
    expect(args.filter((a) => a === "-map")).toHaveLength(3);
    expect(argAfter(args, "-cq")).toBe("28");
  });

  it("stream-copies the original preset and maps tracks directly", () => {
    const args = buildJob(request("original")).passes[0];
    expect(argAfter(args, "-c")).toBe("copy");
    expect(args).not.toContain("-filter_complex");
    expect(args).toContain("0:a:1");
    expect(args).toContain("0:a:4");
  });

  describe("cut overrides", () => {
    // Cut b turns Discord on (the video has it off) and the Jogo down; cut a follows the video.
    const cuts = [
      { id: "a", name: "", startSec: 10, endSec: 20 },
      { id: "b", name: "", startSec: 50, endSec: 65, override: { 1: { enabled: true, volume: 0.5 }, 2: { enabled: true, volume: 1 } } },
    ];

    it("mixes each cut with its own override (FR-54)", () => {
      const graph = argAfter(buildJob(request("discord-20", { cuts, backend: "nvenc" })).passes[0], "-filter_complex");
      expect(graph).toContain("[0:a:1]volume=1.50");
      expect(graph).toContain("[1:a:1]volume=0.50");
      expect(graph).toContain("[0:a:2]volume=0.00");
      expect(graph).toContain("[1:a:2]volume=1.00");
      expect(graph).toContain("concat=n=2:v=1:a=1");
    });

    it("keeps a track that is on in one cut, silent in the others (FR-55)", () => {
      const args = buildJob(request("unlimited", { cuts, keepSeparateTracks: true, backend: "nvenc" })).passes[0];
      expect(argAfter(args, "-filter_complex")).toContain("concat=n=2:v=1:a=3");
      expect(args.filter((a) => a === "-map")).toHaveLength(4);
    });

    it("exports a cut on its own with only its tracks", () => {
      const off = [{ id: "c", name: "", startSec: 10, endSec: 20, override: { 4: { enabled: false, volume: 1 } } }];
      const graph = argAfter(buildJob(request("discord-20", { cuts: off, backend: "nvenc" })).passes[0], "-filter_complex");
      expect(graph).not.toContain("0:a:4");
      expect(graph).not.toContain("amix");
    });

    it("chooses the copied tracks per cut and ignores volumes (FR-56)", () => {
      const args = buildJob(request("original", { cuts: [cuts[1]] })).passes[0];
      expect(args).toContain("0:a:2");
      expect(args).not.toContain("-filter_complex");
    });
  });

  it("refuses a montage with stream copy", () => {
    const cuts = [
      { id: "a", name: "", startSec: 0, endSec: 5 },
      { id: "b", name: "", startSec: 9, endSec: 12 },
    ];
    expect(() => buildJob(request("original", { cuts }))).toThrow();
  });
});
