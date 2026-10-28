/// <reference types="node" />
// Runs the commands produced by src/core against a real FFmpeg. Skipped when FFmpeg is not on PATH.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decodeEnvelope, detectEncoders, ENVELOPE_RATE, parseProbe, planOutput, PRESETS, previewAudioArgs, previewFiles,
  PROBE_ARGS, proxyArgs, runExport,
  type Cut, type EncoderBackend, type Exec, type FfmpegRunner, type MediaInfo, type PresetId,
} from "../src/core";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const dir = mkdtempSync(join(tmpdir(), "clip-snip-it-"));

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

function mediaOf(path: string, hdr: boolean): MediaInfo {
  return {
    path, durationSec: 20, width: 2560, height: 1440, fps: 60, videoCodec: "h264", hdr,
    audioTracks: ["Jogo", "Discord", "Microfone"].map((title, index) => ({ index, title, channels: 2, codec: "aac" })),
  };
}

function probe(path: string) {
  const json = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,height,color_transfer", "-of", "json", path]);
  const data = JSON.parse(json.toString());
  return {
    duration: Number(data.format.duration),
    video: data.streams.find((s: { codec_type: string }) => s.codec_type === "video"),
    audioCount: data.streams.filter((s: { codec_type: string }) => s.codec_type === "audio").length,
    bytes: statSync(path).size,
  };
}

let sdr = "";
let hdr = "";
const encoders = hasFfmpeg ? execFileSync("ffmpeg", ["-hide_banner", "-encoders"]).toString() : "";

const nodeRunner: FfmpegRunner = {
  async run(args) {
    execFileSync("ffmpeg", ["-v", "error", ...args], { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
  },
  async fileSize(path) {
    return statSync(path).size;
  },
};

async function run(presetId: PresetId, source: string, isHdr: boolean, cuts: Cut[], opts: { backend?: EncoderBackend; keepSeparateTracks?: boolean } = {}) {
  const media = mediaOf(source, isHdr);
  const preset = PRESETS[presetId];
  const duration = cuts.reduce((s, c) => s + c.endSec - c.startSec, 0);
  const outPath = join(dir, `${presetId}-${cuts.length}-${opts.backend ?? "cpu"}-${opts.keepSeparateTracks ? "sep" : "mix"}.mp4`);
  const result = await runExport({
    media, cuts, preset,
    mix: [{ enabled: true, volume: 1.2 }, { enabled: false, volume: 1 }, { enabled: true, volume: 1 }],
    keepSeparateTracks: opts.keepSeparateTracks,
    backend: opts.backend ?? "cpu",
    plan: planOutput(preset, media, duration),
    outPath,
    passLogPrefix: join(dir, "pass"),
  }, nodeRunner);
  return { ...probe(outPath), attempts: result.attempts };
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

  it("original stream-copies the chosen tracks", async () => {
    const r = await run("original", sdr, false, one);
    expect(r.video.codec_name).toBe("h264");
    expect(r.audioCount).toBe(2);
  }, 60_000);

  it.skipIf(!encoders.includes("h264_nvenc"))("NVENC single pass under the limit", async () => {
    const r = await run("discord-20", sdr, false, one, { backend: "nvenc" });
    expect(r.bytes).toBeLessThanOrEqual(20_000_000);
  }, 60_000);

  it.skipIf(!encoders.includes("av1_nvenc"))("AV1 NVENC preset", async () => {
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
