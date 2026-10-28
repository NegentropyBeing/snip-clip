import { describe, expect, it } from "vitest";
import { testEncodeArgs } from "./encoderProbe";
import {
  buildReplayProfile, defaultMemoryMb, defaultReplayOptions, disableWebsocket, enableWebsocket, parseIni, pickRecordingEncoder,
  readReplayProfile, recordingEncoderCandidates, type RecordingEncoder, type RecordingEnv, type ReplayProfileOptions,
} from "./replayProfile";

const WINDOWS: RecordingEnv = { platform: "windows", wayland: false, appAudio: true };
const WAYLAND: RecordingEnv = { platform: "linux", wayland: true, appAudio: true };
const X11_NO_PLUGIN: RecordingEnv = { platform: "linux", wayland: false, appAudio: false };

const options = (o: Partial<ReplayProfileOptions> = {}): ReplayProfileOptions =>
  ({ ...defaultReplayOptions("D:/OBS Replays", 2560, 1440, "en"), ...o });

const build = (o: Partial<ReplayProfileOptions>, env: RecordingEnv) => {
  let n = 0;
  const files = buildReplayProfile(options(o), env, () => `uuid-${++n}`);
  return { ...files, ini: parseIni(files.basicIni), collection: JSON.parse(files.collection), encoder: JSON.parse(files.recordEncoder) };
};

interface Source { name: string; id: string; mixers: number; settings: Record<string, unknown> }
const sources = (collection: { sources: Source[] }) => collection.sources.slice(1);

describe("recording encoder choice", () => {
  it("prefers AV1, then HEVC, then H.264, NVENC before the other GPUs", () => {
    expect(pickRecordingEncoder(new Set(["av1_nvenc", "hevc_nvenc", "av1_amf"]), "windows")).toBe("nvenc-av1");
    expect(pickRecordingEncoder(new Set(["h264_nvenc", "hevc_amf"]), "windows")).toBe("nvenc-h264");
    expect(pickRecordingEncoder(new Set(["hevc_amf", "h264_amf"]), "windows")).toBe("amf-hevc");
    expect(pickRecordingEncoder(new Set(["h264_qsv"]), "windows")).toBe("qsv-h264");
  });

  it("only offers encoders OBS has on the platform", () => {
    expect(pickRecordingEncoder(new Set(["h264_amf", "hevc_vaapi"]), "linux")).toBe("vaapi-hevc");
    expect(pickRecordingEncoder(new Set(["hevc_vaapi"]), "windows")).toBe("x264");
    expect(recordingEncoderCandidates("linux")).toEqual(["av1_nvenc", "hevc_nvenc", "h264_nvenc", "av1_vaapi", "hevc_vaapi", "h264_vaapi"]);
    expect(recordingEncoderCandidates("windows")).not.toContain("h264_vaapi");
  });

  it("falls back to x264", () => {
    expect(pickRecordingEncoder(new Set(), "linux")).toBe("x264");
  });

  it("test-encodes VAAPI on a render node with uploaded frames", () => {
    const args = testEncodeArgs("hevc_vaapi", "/dev/dri/renderD128");
    expect(args.slice(3, 5)).toEqual(["-vaapi_device", "/dev/dri/renderD128"]);
    expect(args).toContain("format=nv12,hwupload");
    expect(testEncodeArgs("h264_nvenc", "/dev/dri/renderD128")).not.toContain("-vaapi_device");
  });
});

describe("buildReplayProfile", () => {
  it("records six named tracks with the replay buffer on", () => {
    const { ini } = build({ lang: "pt" }, WINDOWS);
    expect(ini.AdvOut).toMatchObject({
      RecRB: "true", RecRBTime: "180", RecRBSize: String(defaultMemoryMb(180)), RecTracks: "63", RecFormat2: "mkv",
      RecFilePath: "D:/OBS Replays", Track2Name: "Jogo", Track6Name: "Sistema (tudo)",
    });
    expect(ini.Video).toMatchObject({ OutputCX: "2560", OutputCY: "1440", FPSCommon: "60" });
  });

  it("writes forward slashes in the replays folder", () => {
    expect(build({ replaysFolder: "D:\\Replays\\OBS" }, WINDOWS).ini.AdvOut.RecFilePath).toBe("D:/Replays/OBS");
  });

  it("uses an explicit memory limit over the default", () => {
    expect(build({ bufferSec: 300 }, WINDOWS).ini.AdvOut.RecRBSize).toBe(String(defaultMemoryMb(300)));
    expect(build({ bufferSec: 300, memoryMb: 4096 }, WINDOWS).ini.AdvOut.RecRBSize).toBe("4096");
  });

  it("records 10-bit only with NVENC AV1 and HEVC", () => {
    expect(build({ encoder: "nvenc-av1" }, WINDOWS).ini.Video.ColorFormat).toBe("P010");
    expect(build({ encoder: "amf-av1" }, WINDOWS).ini.Video.ColorFormat).toBe("NV12");
  });

  it("writes the save hotkey as OBS does", () => {
    const { ini } = build({ saveHotkey: { key: "OBS_KEY_F9", control: true, shift: true } }, WINDOWS);
    expect(ini.Hotkeys.ReplayBuffer).toBe('{"ReplayBuffer.Save":[{"control":true,"shift":true,"key":"OBS_KEY_F9"}]}');
  });

  it("sets each encoder's constant quality on its own scale", () => {
    const settings = (encoder: RecordingEncoder) => build({ encoder, quality: 28 }, WINDOWS).encoder;
    expect(settings("nvenc-hevc")).toMatchObject({ rate_control: "CQVBR", target_quality: 28 });
    expect(settings("x264")).toMatchObject({ rate_control: "CRF", crf: 23 });
    expect(settings("vaapi-av1")).toMatchObject({ rate_control: "CQP", qp: 23 });
    expect(settings("amf-h264")).toMatchObject({ rate_control: "CQP", cqp: 23 });
    expect(settings("qsv-av1")).toMatchObject({ rate_control: "CQP", cqp: 28 });
  });

  it("captures the game, Discord and each browser by executable on Windows", () => {
    const { collection } = build({ browsers: ["firefox", "zen"] }, WINDOWS);
    expect(sources(collection).map((s: Source) => [s.name, s.id, s.mixers])).toEqual([
      ["Screen", "monitor_capture", 0],
      ["Game", "game_capture", 0b11],
      ["Discord", "wasapi_process_output_capture", 0b101],
      ["Browser - Firefox", "wasapi_process_output_capture", 0b1001],
      ["Browser - Zen", "wasapi_process_output_capture", 0b1001],
    ]);
    expect(collection.DesktopAudioDevice1).toMatchObject({ id: "wasapi_output_capture", mixers: 0b100000 });
    expect(collection.AuxAudioDevice1).toMatchObject({ id: "wasapi_input_capture", mixers: 0b10001 });
  });

  it("lists scene items bottom to top with the screen behind", () => {
    const items = build({}, WINDOWS).collection.sources[0].settings.items;
    expect(items.map((i: { name: string; id: number }) => [i.id, i.name])).toEqual([[1, "Screen"], [2, "Game"], [3, "Discord"], [4, "Browser - Chrome"], [5, "Browser - Firefox"]]);
    expect(items[0].bounds).toEqual({ x: 2560, y: 1440 });
  });

  it("captures the screen through PipeWire on Wayland, and apps through the plugin", () => {
    const { collection } = build({ browsers: ["firefox"] }, WAYLAND);
    const [screen, game, discord, browser] = sources(collection);
    expect(screen.id).toBe("pipewire-screen-capture-source");
    expect(game.settings).toMatchObject({ ExceptApp: true });
    expect((game.settings.apps as { value: string }[]).map((a) => a.value)).toEqual(
      expect.arrayContaining(["Discord", "firefox", "obs"]));
    expect([game.mixers, discord.mixers, browser.mixers]).toEqual([0b11, 0b101, 0b1001]);
    expect(collection.DesktopAudioDevice1).toMatchObject({ id: "pulse_output_capture", mixers: 0b100000 });
  });

  it("records Mix, Mic and System from system audio on Linux without the plugin", () => {
    const { collection, ini } = build({}, X11_NO_PLUGIN);
    expect(sources(collection).map((s: Source) => s.id)).toEqual(["xshm_input_v2"]);
    expect(collection.DesktopAudioDevice1.mixers).toBe(0b100001);
    expect(ini.AdvOut.RecTracks).toBe("49");
  });
});

describe("readReplayProfile", () => {
  const roundTrip = (o: Partial<ReplayProfileOptions>, env: RecordingEnv) => {
    const files = buildReplayProfile(options(o), env);
    return readReplayProfile(files, env.platform);
  };

  it("reads back what was written", () => {
    const o = options({ bufferSec: 300, memoryMb: 4096, fps: 30, encoder: "nvenc-av1", quality: 24, browsers: ["brave", "zen"],
      saveHotkey: { key: "OBS_KEY_F9", control: true } });
    const { lang: _, ...expected } = o;
    expect(roundTrip(o, WINDOWS)).toEqual(expected);
    expect(roundTrip(o, WAYLAND)).toEqual(expected);
  });

  it("reads each encoder's quality back from its own scale", () => {
    for (const encoder of ["x264", "vaapi-hevc", "amf-av1", "qsv-av1", "qsv-h264", "nvenc-h264"] as RecordingEncoder[]) {
      expect(roundTrip({ encoder, quality: 31 }, WINDOWS).quality).toBe(31);
    }
  });

  it("keeps a default memory limit following the buffer", () => {
    expect(roundTrip({ bufferSec: 240 }, WINDOWS).memoryMb).toBeNull();
  });

  it("says nothing about browsers when the profile has no per-app sources", () => {
    expect(roundTrip({}, X11_NO_PLUGIN).browsers).toBeUndefined();
    expect(roundTrip({ browsers: [] }, WINDOWS).browsers).toEqual([]);
  });

  it("shows changes made in OBS and tolerates missing or broken files", () => {
    const files = buildReplayProfile(options(), WINDOWS);
    const edited = files.basicIni.replace("RecRBTime=180", "RecRBTime=90").replace(/\n/g, "\r\n");
    const read = readReplayProfile({ basicIni: "\uFEFF" + edited, recordEncoder: "{oops", collection: null }, "windows");
    expect(read).toMatchObject({ bufferSec: 90, encoder: "x264" });
    expect(read.quality).toBeUndefined();
    expect(read.browsers).toBeUndefined();
    expect(readReplayProfile({ basicIni: "", recordEncoder: null, collection: null }, "linux")).toEqual({});
  });
});

describe("OBS WebSocket server", () => {
  it("turns the server on with a new password", () => {
    const { config, turnedOn } = enableWebsocket(null, "pw");
    expect(config).toEqual({ server_port: 4455, alerts_enabled: false, auth_required: true, first_load: false, server_enabled: true, server_password: "pw" });
    expect(turnedOn).toBe(true);
  });

  it("keeps the user's port, password and other settings", () => {
    const { config, turnedOn } = enableWebsocket({ server_enabled: true, server_port: 4460, server_password: "mine", auth_required: false }, "pw");
    expect(config).toMatchObject({ server_port: 4460, server_password: "mine", auth_required: false, server_enabled: true });
    expect(turnedOn).toBe(false);
  });

  it("turns the server off", () => {
    expect(disableWebsocket({ server_enabled: true, server_port: 4455 })).toEqual({ server_enabled: false, server_port: 4455 });
  });
});
