import { describe, expect, it } from "vitest";
import { detectEncoders, parseEncoderList, type Exec } from "./encoderProbe";
import av1OneTrack from "./fixtures/av1-1track.json";
import named144 from "./fixtures/named-144fps-3tracks.json";
import nvidiaHdr from "./fixtures/nvidia-hdr-av1-2tracks.json";
import { parseProbe, trackTitle } from "./probe";

const parse = (fixture: unknown) => parseProbe(JSON.stringify(fixture), "/v.mp4");

describe("parseProbe", () => {
  it("reads an NVIDIA HDR replay with two unnamed tracks", () => {
    const m = parse(nvidiaHdr);
    expect(m).toMatchObject({ width: 2560, height: 1440, fps: 60, videoCodec: "av1", hdr: true });
    expect(m.durationSec).toBeCloseTo(180.3);
    expect(m.audioTracks.map((t) => t.title)).toEqual([null, null]);
    expect(m.audioTracks.map((t) => t.index)).toEqual([0, 1]);
  });

  it("reads track names and high frame rates", () => {
    const m = parse(named144);
    expect(m.fps).toBe(144);
    expect(m.hdr).toBe(false);
    expect(m.audioTracks.map((t) => t.title)).toEqual(["Mix", "Jogo", "Microfone"]);
  });

  it("reads a single-track replay", () => {
    const m = parse(av1OneTrack);
    expect(m.videoCodec).toBe("av1");
    expect(m.audioTracks).toHaveLength(1);
  });

  it("rejects files without video", () => {
    expect(() => parseProbe(JSON.stringify({ streams: [{ codec_type: "audio" }] }), "/a.m4a")).toThrow();
  });
});

describe("trackTitle", () => {
  it("prefers the title tag", () => {
    expect(trackTitle({ title: "Discord", handler_name: "SoundHandler" })).toBe("Discord");
  });

  it("ignores default muxer handler names", () => {
    for (const h of ["SoundHandler", "SoundHandle", "Core Media Audio", "Sound Media Handler"]) {
      expect(trackTitle({ handler_name: h })).toBeNull();
    }
  });
});

describe("encoder detection", () => {
  const listing = [
    "Encoders:",
    " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC (codec h264)",
    " V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)",
    " V....D h264_amf             AMD AMF H.264 Encoder (codec h264)",
    " A....D aac                  AAC (Advanced Audio Coding)",
  ].join("\n");

  it("parses video encoders only", () => {
    expect([...parseEncoderList(listing)]).toEqual(["libx264", "h264_nvenc", "h264_amf"]);
  });

  it("keeps hardware encoders only when their test encode succeeds", async () => {
    const exec: Exec = async (args) => {
      if (args.includes("-encoders")) return { code: 0, stdout: listing, stderr: "" };
      const encoder = args[args.indexOf("-c:v") + 1];
      return { code: encoder === "h264_nvenc" ? 0 : 1, stdout: "", stderr: "" };
    };
    expect([...(await detectEncoders(exec))].sort()).toEqual(["h264_nvenc", "libx264"]);
  });
});
