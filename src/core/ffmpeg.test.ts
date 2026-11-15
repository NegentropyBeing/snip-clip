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

  describe("effects", () => {
    // 10..40 with 0.5× over 14..16 and 0.25× over 20..21: four pieces.
    const slow = [{
      id: "a", name: "", startSec: 10, endSec: 40,
      effects: [{ id: "x", startSec: 14, endSec: 16, speed: 0.5 }, { id: "y", startSec: 20, endSec: 21, speed: 0.25 }],
    }];
    const graphOf = (args: string[]) => argAfter(args, "-filter_complex");

    it("slows the video down by repeating frames inside each effect (FR-68)", () => {
      const graph = graphOf(buildJob(request("discord-20", { cuts: slow, backend: "nvenc" })).passes[0]);
      expect(graph).toContain("[0:v:0]split=5");
      expect(graph).toContain("trim=end=4.000,setpts=PTS-STARTPTS[");
      expect(graph).toContain("trim=start=4.000:end=6.000,setpts=(PTS-STARTPTS)/0.5[");
      expect(graph).toContain("trim=start=10.000:end=11.000,setpts=(PTS-STARTPTS)/0.25[");
      expect(graph).toContain("trim=start=11.000,setpts=PTS-STARTPTS[");
      // Constant frame rate after the join: the slowed frames are repeated, not interpolated.
      expect(graph).toMatch(/concat=n=5:v=1:a=1\[c0\]\[ca0_0\];\[c0\][^;]*fps=\d+/);
      expect(graph).not.toContain("minterpolate");
      // Even when the plan keeps the source frame rate.
      expect(graphOf(buildJob(request("unlimited", { cuts: slow, backend: "nvenc" })).passes[0])).toMatch(/\[c0\][^;]*fps=60/);
      expect(graphOf(buildJob(request("unlimited", { backend: "nvenc" })).passes[0])).not.toContain("fps=");
    });

    it("slows the mixed audio with the pitch kept, chaining atempo below 0.5× (FR-68)", () => {
      const graph = graphOf(buildJob(request("discord-20", { cuts: slow, backend: "nvenc" })).passes[0]);
      expect(graph).toContain("amix=inputs=2");
      expect(graph).toContain("[a0]asplit=5");
      expect(graph).toContain("atrim=start=4.000:end=6.000,asetpts=PTS-STARTPTS,atempo=0.5[");
      expect(graph).toContain("atrim=start=10.000:end=11.000,asetpts=PTS-STARTPTS,atempo=0.5,atempo=0.5[");
      expect(graph).not.toContain("asetrate");
    });

    it("slows every separate track (FR-70)", () => {
      const args = buildJob(request("unlimited", { cuts: slow, keepSeparateTracks: true, backend: "nvenc" })).passes[0];
      const graph = graphOf(args);
      expect(graph).toContain("[a0_1]asplit=5");
      expect(graph).toContain("[a0_4]asplit=5");
      expect(graph).toContain("concat=n=5:v=1:a=2");
      expect(args.filter((a) => a === "-map")).toHaveLength(3);
    });

    it("leaves audio out of the analysis pass of two-pass x264", () => {
      const { passes } = buildJob(request("discord-20", { cuts: slow }));
      expect(graphOf(passes[0])).toContain("concat=n=5:v=1:a=0");
      expect(graphOf(passes[0])).not.toContain("atrim");
      expect(graphOf(passes[1])).toContain("concat=n=5:v=1:a=1");
    });

    it("slows only the cut that has the effect in a montage", () => {
      const cuts = [{ id: "p", name: "", startSec: 50, endSec: 60 }, slow[0]];
      const graph = graphOf(buildJob(request("discord-20", { cuts, backend: "nvenc" })).passes[0]);
      expect(graph).not.toContain("[0:v:0]split");
      expect(graph).toContain("[1:v:0]split=5");
      expect(graph).toContain("concat=n=2:v=1:a=1[vout][aout0]");
    });

    it("applies the cut override inside the effect", () => {
      const cuts = [{ ...slow[0], override: { 4: { enabled: false, volume: 1 } } }];
      const graph = graphOf(buildJob(request("discord-20", { cuts, backend: "nvenc" })).passes[0]);
      expect(graph).not.toContain("0:a:4");
      expect(graph).toContain("[a0_1]asplit=5");
    });

    it("keeps one piece when the effect covers the whole cut", () => {
      const cuts = [{ id: "a", name: "", startSec: 10, endSec: 12, effects: [{ id: "x", startSec: 10, endSec: 12, speed: 0.5 }] }];
      const graph = graphOf(buildJob(request("discord-20", { cuts, backend: "nvenc" })).passes[0]);
      expect(graph).toContain("[0:v:0]setpts=(PTS-STARTPTS)/0.5,");
      expect(graph).not.toContain("split");
      expect(graph).toContain("asetpts=PTS-STARTPTS,atempo=0.5[");
    });

    it("is ignored by the original preset (FR-71)", () => {
      const args = buildJob(request("original", { cuts: slow })).passes[0];
      expect(args).not.toContain("-filter_complex");
      expect(argAfter(args, "-t")).toBe("30.000");
    });
  });

  describe("zoom", () => {
    // 10..40, top-left quarter of the 2560×1440 frame over 14..16 at normal speed.
    const corner = { x: 0.25, y: 0.25, level: 2 };
    const zoomed = [{ id: "a", name: "", startSec: 10, endSec: 40, effects: [{ id: "x", startSec: 14, endSec: 16, speed: 1, zoom: corner }] }];
    const graphOf = (args: string[]) => argAfter(args, "-filter_complex");

    it("crops the region and scales it back to the frame size, only inside the effect (FR-77)", () => {
      const graph = graphOf(buildJob(request("discord-20", { cuts: zoomed, backend: "nvenc" })).passes[0]);
      expect(graph).toContain("[0:v:0]split=3");
      expect(graph).toContain("trim=start=4.000:end=6.000,setpts=PTS-STARTPTS,crop=1280:720:0:0,scale=2560:1440:flags=lanczos,setsar=1[");
      expect(graph).toContain("trim=end=4.000,setpts=PTS-STARTPTS,setsar=1[");
      expect(graph.match(/crop=/g)).toHaveLength(1);
      // A zoom-only effect keeps the audio at normal speed.
      expect(graph).not.toContain("atempo");
      expect(graph).toContain("concat=n=3:v=1:a=1");
    });

    it("leaves the resolution ladder to the filters after the join", () => {
      const cuts = [{ ...zoomed[0], startSec: 0, endSec: 150 }];
      const graph = graphOf(buildJob(request("discord-20", { cuts, backend: "nvenc" })).passes[0]);
      expect(graph).toMatch(/\[c0\][^;]*scale=-2:(1080|720)/);
    });

    it("works together with slow motion and tone mapping", () => {
      const hdrMedia = { ...media, hdr: true };
      const cuts = [{ ...zoomed[0], effects: [{ id: "x", startSec: 14, endSec: 16, speed: 0.5, zoom: { x: 0.5, y: 0.5, level: 3 } }] }];
      const graph = graphOf(buildJob(request("discord-20", { cuts, media: hdrMedia, plan: planOutput(PRESETS["discord-20"], hdrMedia, 32), backend: "nvenc" })).passes[0]);
      expect(graph).toContain("setpts=(PTS-STARTPTS)/0.5,crop=852:480:854:480,scale=2560:1440:flags=lanczos,setsar=1[");
      expect(graph).toContain("atempo=0.5");
      expect(graph).toMatch(/\[c0\]zscale[^;]*tonemap=tonemap=hable/);
    });

    it("zooms in both passes of two-pass x264", () => {
      const { passes } = buildJob(request("discord-20", { cuts: zoomed }));
      expect(graphOf(passes[0])).toContain("crop=1280:720:0:0");
      expect(graphOf(passes[1])).toContain("crop=1280:720:0:0");
    });

    it("gives every cut of a montage the same pixel shape so they can be joined", () => {
      const cuts = [{ id: "p", name: "", startSec: 50, endSec: 60 }, zoomed[0]];
      const graph = graphOf(buildJob(request("discord-20", { cuts, backend: "nvenc" })).passes[0]);
      expect(graph).toMatch(/\[0:v:0\][^;]*setsar=1\[v0\]/);
      expect(graph).toMatch(/\[c1\][^;]*setsar=1\[v1\]/);
      expect(graph).toContain("concat=n=2:v=1:a=1[vout][aout0]");
    });

    it("keeps the arguments of exports without zoom unchanged", () => {
      expect(graphOf(buildJob(request("discord-20", { backend: "nvenc" })).passes[0])).not.toContain("setsar");
    });

    it("is ignored by the original preset (FR-77)", () => {
      expect(buildJob(request("original", { cuts: zoomed })).passes[0]).not.toContain("-filter_complex");
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
