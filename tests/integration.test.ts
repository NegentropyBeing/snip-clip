/// <reference types="node" />
// Runs the commands produced by src/core against a real FFmpeg. Skipped when FFmpeg is not on PATH.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decodeEnvelope, detectEncoders, ENVELOPE_RATE, exportDuration, parseProbe, planOutput, PRESETS, previewAudioArgs, previewFiles,
  PROBE_ARGS, proxyArgs, runExport, testEncodeArgs,
  type Cut, type EncoderBackend, type Exec, type FfmpegRunner, type MediaInfo, type PresetId,
} from "../src/core";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const dir = mkdtempSync(join(tmpdir(), "snip-clip-it-"));

function makeSource(name: string, hdr: boolean): string {
  const out = join(dir, name);
  const video = hdr
    ? "testsrc2=size=2560x1440:rate=60,format=yuv420p10le,setparams=color_trc=smpte2084:color_primaries=bt2020:colorspace=bt2020nc"
    : "testsrc2=size=2560x1440:rate=60";
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", video,
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000",
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
    "-t", "20", "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:a",
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-ac", "2",
    ...(hdr ? ["-color_trc", "smpte2084", "-color_primaries", "bt2020", "-colorspace", "bt2020nc"] : []),
    "-metadata:s:a:0", "title=Jogo", "-metadata:s:a:1", "title=Discord", "-metadata:s:a:2", "title=Microfone",
    out,
  ]);
  return out;
}

/** Red, green / blue, white quarters, so a zoomed export can be checked by colour. */
function makeQuadrants(name: string): string {
  const out = join(dir, name);
  const q = (c: string) => ["-f", "lavfi", "-i", `color=c=${c}:s=1280x720:r=60`];
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    ...q("red"), ...q("lime"), ...q("blue"), ...q("white"),
    ...["440", "660", "880"].flatMap((f) => ["-f", "lavfi", "-i", `sine=frequency=${f}:sample_rate=48000`]),
    "-filter_complex", "[0:v][1:v]hstack[top];[2:v][3:v]hstack[bottom];[top][bottom]vstack[v]",
    "-t", "10", "-map", "[v]", "-map", "4:a", "-map", "5:a", "-map", "6:a",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2",
    out,
  ]);
  return out;
}

/** Average colour of each quarter of the frame at `sec`, as [r, g, b] for top-left, top-right, bottom-left, bottom-right. */
function quarters(path: string, sec: number): number[][] {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(sec), "-i", path, "-frames:v", "1", "-vf", "format=rgb24,scale=2:2:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [0, 1, 2, 3].map((i) => [...raw.subarray(i * 3, i * 3 + 3)]);
}

const isColour = ([r, g, b]: number[], [er, eg, eb]: number[]) => Math.abs(r - er) < 60 && Math.abs(g - eg) < 60 && Math.abs(b - eb) < 60;
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const WHITE = [255, 255, 255];

function mediaOf(path: string, hdr: boolean): MediaInfo {
  return {
    path, durationSec: 20, width: 2560, height: 1440, fps: 60, videoCodec: "h264", hdr,
    audioTracks: ["Jogo", "Discord", "Microfone"].map((title, index) => ({ index, title, channels: 2, codec: "aac" })),
  };
}

function probe(path: string) {
  const json = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,color_transfer,duration,avg_frame_rate", "-of", "json", path]);
  const data = JSON.parse(json.toString());
  const audio = data.streams.filter((s: { codec_type: string }) => s.codec_type === "audio");
  return {
    duration: Number(data.format.duration),
    video: data.streams.find((s: { codec_type: string }) => s.codec_type === "video"),
    audioCount: audio.length,
    audioDurations: audio.map((s: { duration: string }) => Number(s.duration)) as number[],
    bytes: statSync(path).size,
  };
}

let sdr = "";
let hdr = "";
// GPU encoders are listed by most builds even without the hardware (CI runners), so test-encode like the app does.
const canEncode = (encoder: string) => hasFfmpeg && spawnSync("ffmpeg", testEncodeArgs(encoder)).status === 0;

const nodeRunner: FfmpegRunner = {
  async run(args) {
    execFileSync("ffmpeg", ["-v", "error", ...args], { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
  },
  async fileSize(path) {
    return statSync(path).size;
  },
};

async function run(presetId: PresetId, source: string, isHdr: boolean, cuts: Cut[], opts: { backend?: EncoderBackend; keepSeparateTracks?: boolean; tag?: string } = {}) {
  const media = mediaOf(source, isHdr);
  const preset = PRESETS[presetId];
  const duration = exportDuration(cuts, preset);
  const slow = `${cuts.some((c) => c.effects) ? "-fx" : ""}${opts.tag ? `-${opts.tag}` : ""}`;
  const outPath = join(dir, `${presetId}-${cuts.length}-${opts.backend ?? "cpu"}-${opts.keepSeparateTracks ? "sep" : "mix"}${slow}.mp4`);
  const result = await runExport({
    media, cuts, preset,
    mix: [{ enabled: true, volume: 1.2 }, { enabled: false, volume: 1 }, { enabled: true, volume: 1 }],
    keepSeparateTracks: opts.keepSeparateTracks,
    backend: opts.backend ?? "cpu",
    plan: planOutput(preset, media, duration),
    outPath,
    passLogPrefix: join(dir, "pass"),
  }, nodeRunner);
  return { ...probe(outPath), attempts: result.attempts, outPath };
}

const one: Cut[] = [{ id: "a", name: "", startSec: 2, endSec: 12 }];
const two: Cut[] = [{ id: "a", name: "", startSec: 1, endSec: 5 }, { id: "b", name: "", startSec: 10, endSec: 16 }];

describe.skipIf(!hasFfmpeg)("FFmpeg integration", () => {
  beforeAll(() => {
    sdr = makeSource("sdr.mp4", false);
    hdr = makeSource("hdr.mp4", true);
  }, 120_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("Discord 20 MB: x264 two-pass, one mixed track, under the limit", async () => {
    const r = await run("discord-20", sdr, false, one);
    expect(r.video.codec_name).toBe("h264");
    expect(r.audioCount).toBe(1);
    expect(r.bytes).toBeLessThanOrEqual(20_000_000);
    expect(r.duration).toBeCloseTo(10, 0);
  }, 120_000);

  it("montage joins cuts into one file", async () => {
    const r = await run("discord-20", sdr, false, two);
    expect(r.duration).toBeCloseTo(10, 0);
    expect(r.audioCount).toBe(1);
  }, 120_000);

  it("HDR is tonemapped to SDR for Discord", async () => {
    const r = await run("discord-20", hdr, true, one);
    expect(r.video.color_transfer).toBe("bt709");
  }, 120_000);

  it("unlimited keeps enabled tracks separate when asked", async () => {
    const r = await run("unlimited", sdr, false, one, { keepSeparateTracks: true });
    expect(r.video.codec_name).toBe("av1");
    expect(r.audioCount).toBe(2);
  }, 180_000);

  it("a montage keeps a track that only one cut turns on, silent in the other (FR-55)", async () => {
    const cuts: Cut[] = [two[0], { ...two[1], override: { 1: { enabled: true, volume: 1 } } }];
    const r = await run("unlimited", sdr, false, cuts, { keepSeparateTracks: true });
    expect(r.audioCount).toBe(3);
    expect(r.duration).toBeCloseTo(10, 0);
  }, 180_000);

  it("original stream-copies the chosen tracks", async () => {
    const r = await run("original", sdr, false, one);
    expect(r.video.codec_name).toBe("h264");
    expect(r.audioCount).toBe(2);
  }, 60_000);

  describe("effects", () => {
    // 10 s cut with 2 s at 0.5× in the middle: 12 s in the file (§18.6, 1).
    const slow: Cut[] = [{ ...one[0], effects: [{ id: "x", startSec: 6, endSec: 8, speed: 0.5 }] }];
    // 10 s, all but 1 s at 0.25×: 37 s in the file.
    const long: Cut[] = [{ ...one[0], effects: [{ id: "x", startSec: 2.5, endSec: 6, speed: 0.25 }, { id: "y", startSec: 6, endSec: 11.5, speed: 0.25 }] }];

    it("Discord 20 MB two-pass: the slowed cut lasts its output duration, audio included", async () => {
      const r = await run("discord-20", sdr, false, slow);
      expect(r.duration).toBeCloseTo(12, 0);
      expect(r.audioDurations[0]).toBeCloseTo(12, 0);
      expect(r.bytes).toBeLessThanOrEqual(20_000_000);
      // Slowed frames are repeated to a constant rate; a variable-rate file would average 50 fps here.
      const [n, d] = String(r.video.avg_frame_rate).split("/").map(Number);
      expect([30, 60].some((fps) => Math.abs(n / d - fps) < 0.5)).toBe(true);
    }, 120_000);

    it("Discord 20 MB stays under the limit when the output is much longer than the cut (§18.6, 3)", async () => {
      const r = await run("discord-20", sdr, false, long);
      expect(r.duration).toBeCloseTo(37, 0);
      expect(r.bytes).toBeLessThanOrEqual(20_000_000);
      expect(r.attempts).toBe(1);
    }, 240_000);

    it("a montage slows only the cut with the effect (§18.6, 6)", async () => {
      const cuts: Cut[] = [{ ...two[0], effects: [{ id: "x", startSec: 2, endSec: 3, speed: 0.25 }] }, two[1]];
      const r = await run("discord-20", sdr, false, cuts);
      expect(r.duration).toBeCloseTo(13, 0);
      expect(r.audioDurations[0]).toBeCloseTo(13, 0);
    }, 120_000);

    it("unlimited with separate tracks slows every track", async () => {
      const cuts: Cut[] = [{ ...two[0], effects: [{ id: "x", startSec: 2, endSec: 4, speed: 0.5 }] }];
      const r = await run("unlimited", sdr, false, cuts, { keepSeparateTracks: true });
      expect(r.audioCount).toBe(2);
      expect(r.duration).toBeCloseTo(6, 0);
      for (const d of r.audioDurations) expect(d).toBeCloseTo(6, 0);
    }, 180_000);

    it("original ignores effects (§18.6, 7)", async () => {
      // Stream copy snaps to keyframes, so the length is only roughly the cut's, far from the slowed 37 s.
      const r = await run("original", sdr, false, long);
      expect(r.duration).toBeGreaterThan(9.5);
      expect(r.duration).toBeLessThan(16);
    }, 60_000);
  });

  describe("zoom", () => {
    let quad = "";
    beforeAll(() => {
      quad = makeQuadrants("quadrants.mp4");
    }, 120_000);

    it("Discord 20 MB: the top-left quarter fills the frame only during the effect (§19.4, 1 and 4)", async () => {
      const cuts: Cut[] = [{ id: "a", name: "", startSec: 1, endSec: 7, effects: [{ id: "x", startSec: 3, endSec: 5, speed: 1, zoom: { x: 0.25, y: 0.25, level: 2 } }] }];
      const r = await run("discord-20", quad, false, cuts, { tag: "zoom" });
      // Zoom only: the output duration and the resolution stay those of the cut and the ladder.
      expect(r.duration).toBeCloseTo(6, 0);
      expect(r.video).toMatchObject({ width: 2560, height: 1440 });
      expect(r.bytes).toBeLessThanOrEqual(20_000_000);
      const before = quarters(r.outPath, 1);
      [RED, GREEN, BLUE, WHITE].forEach((c, i) => expect(isColour(before[i], c)).toBe(true));
      for (const q of quarters(r.outPath, 3)) expect(isColour(q, RED)).toBe(true);
      const after = quarters(r.outPath, 5);
      [RED, GREEN, BLUE, WHITE].forEach((c, i) => expect(isColour(after[i], c)).toBe(true));
    }, 120_000);

    it("single pass: the bottom-right quarter, at normal speed", async () => {
      const cuts: Cut[] = [{ id: "a", name: "", startSec: 1, endSec: 3, effects: [{ id: "x", startSec: 1, endSec: 3, speed: 1, zoom: { x: 1, y: 1, level: 2 } }] }];
      const r = await run("unlimited", quad, false, cuts, { tag: "zoom" });
      expect(r.duration).toBeCloseTo(2, 0);
      for (const q of quarters(r.outPath, 1)) expect(isColour(q, WHITE)).toBe(true);
    }, 180_000);

    it("montage of an HDR source: slow and zoomed in one cut, tone mapped (§19.4, 3)", async () => {
      const cuts: Cut[] = [{ ...two[0], effects: [{ id: "x", startSec: 2, endSec: 3, speed: 0.5, zoom: { x: 0.5, y: 0.5, level: 3 } }] }, two[1]];
      const r = await run("discord-20", hdr, true, cuts, { tag: "zoom" });
      expect(r.duration).toBeCloseTo(11, 0);
      expect(r.audioDurations[0]).toBeCloseTo(11, 0);
      expect(r.video.color_transfer).toBe("bt709");
      expect(r.bytes).toBeLessThanOrEqual(20_000_000);
    }, 180_000);
  });

  it.skipIf(!canEncode("h264_nvenc"))("NVENC single pass under the limit", async () => {
    const r = await run("discord-20", sdr, false, one, { backend: "nvenc" });
    expect(r.bytes).toBeLessThanOrEqual(20_000_000);
  }, 60_000);

  it.skipIf(!canEncode("av1_nvenc"))("AV1 NVENC preset", async () => {
    const r = await run("discord-20-av1", sdr, false, two, { backend: "nvenc" });
    expect(r.video.codec_name).toBe("av1");
  }, 60_000);

  it("extracts per-track preview audio and envelopes", async () => {
    const files = previewFiles(dir, 3);
    await nodeRunner.run(previewAudioArgs(mediaOf(sdr, false), files));
    for (const f of files.audio) expect(probe(f).duration).toBeCloseTo(20, 0);
    const env = decodeEnvelope(readFileSync(files.envelope[1]).buffer as ArrayBuffer);
    expect(env.length / ENVELOPE_RATE).toBeCloseTo(20, 0);
    // A full-scale-ish sine: mean |x| after low-pass is well above silence.
    expect(env[ENVELOPE_RATE * 5]).toBeGreaterThan(0.05);
  }, 60_000);

  it("builds a 540p SDR preview proxy", async () => {
    const out = join(dir, "proxy.mp4");
    await nodeRunner.run(proxyArgs(mediaOf(hdr, true), out));
    const r = probe(out);
    expect(r.video).toMatchObject({ codec_name: "h264", height: 540 });
    expect(r.audioCount).toBe(0);
  }, 120_000);

  it("parses real ffprobe output", () => {
    const m = parseProbe(execFileSync("ffprobe", [...PROBE_ARGS, hdr]).toString(), hdr);
    expect(m).toMatchObject({ width: 2560, height: 1440, fps: 60, hdr: true });
    expect(m.audioTracks).toHaveLength(3);
  });

  it("detects usable encoders, always including the CPU ones", async () => {
    const exec: Exec = async (args) => {
      const r = spawnSync("ffmpeg", args);
      return { code: r.status, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
    };
    const found = await detectEncoders(exec);
    expect(found.has("libx264")).toBe(true);
    expect(found.has("libsvtav1")).toBe(true);
    // A listed-but-unusable GPU encoder must be filtered out by its test encode.
    for (const name of ["h264_amf", "h264_qsv"]) {
      if (found.has(name)) expect(spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=s=320x240:d=0.2", "-c:v", name, "-f", "null", "-"]).status).toBe(0);
    }
  }, 60_000);
});
