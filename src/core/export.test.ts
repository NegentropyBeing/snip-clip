import { describe, expect, it } from "vitest";
import { planOutput } from "./bitrate";
import { MAX_ATTEMPTS, runExport, type FfmpegRunner } from "./export";
import type { ExportRequest } from "./ffmpeg";
import { PRESETS } from "./presets";
import type { MediaInfo } from "./types";

const media: MediaInfo = {
  path: "in.mp4", durationSec: 60, width: 1920, height: 1080, fps: 60, videoCodec: "h264", hdr: false,
  audioTracks: [{ index: 0, title: null, channels: 2, codec: "aac" }],
};

function request(presetId: "discord-20" | "unlimited"): ExportRequest {
  const preset = PRESETS[presetId];
  return {
    media, preset, backend: "nvenc",
    mix: [{ enabled: true, volume: 1 }],
    cuts: [{ id: "a", name: "", startSec: 0, endSec: 30 }],
    plan: planOutput(preset, media, 30),
    outPath: "out.mp4", passLogPrefix: "pass",
  };
}

/** Fake runner whose output size follows the requested bitrate times an encoder overshoot factor. */
function fakeRunner(overshoot: number) {
  const bitrates: number[] = [];
  const runner: FfmpegRunner = {
    async run(args) {
      const b = args[args.indexOf("-b:v") + 1];
      bitrates.push(b === "0" ? 0 : parseInt(b, 10));
    },
    async fileSize() {
      const kbps = bitrates.at(-1)!;
      return kbps === 0 ? 123 : Math.round(((kbps + 128) * 1000 * 30 * overshoot) / 8);
    },
  };
  return { runner, bitrates };
}

describe("runExport", () => {
  it("accepts the first attempt when it fits", async () => {
    const { runner } = fakeRunner(1.0);
    const r = await runExport(request("discord-20"), runner);
    expect(r.attempts).toBe(1);
    expect(r.bytes).toBeLessThanOrEqual(20_000_000);
  });

  it("re-encodes with a lower bitrate after an overshoot", async () => {
    const { runner, bitrates } = fakeRunner(1.08);
    const r = await runExport(request("discord-20"), runner);
    expect(r.attempts).toBe(2);
    expect(bitrates[1]).toBeLessThan(bitrates[0]);
    expect(r.bytes).toBeLessThanOrEqual(20_000_000);
  });

  it("gives up after MAX_ATTEMPTS instead of looping forever", async () => {
    const runner: FfmpegRunner = { run: async () => {}, fileSize: async () => 99_000_000 };
    await expect(runExport(request("discord-20"), runner)).rejects.toThrow(String(MAX_ATTEMPTS));
  });

  it("never retries presets without a limit", async () => {
    const { runner } = fakeRunner(5);
    const r = await runExport(request("unlimited"), runner);
    expect(r.attempts).toBe(1);
  });
});
