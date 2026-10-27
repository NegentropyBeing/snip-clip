import { describe, expect, it } from "vitest";
import { pickBackend } from "./encoders";
import { clipFileName, sanitize, timeTag, uniqueName } from "./naming";

describe("pickBackend", () => {
  const all = new Set(["libx264", "libsvtav1", "h264_nvenc", "av1_nvenc"]);

  it("prefers CPU two-pass for size-limited H.264 on auto", () => {
    expect(pickBackend("h264", all, "auto", true)).toBe("cpu");
  });

  it("prefers the GPU otherwise", () => {
    expect(pickBackend("av1", all, "auto", true)).toBe("nvenc");
    expect(pickBackend("h264", all, "auto", false)).toBe("nvenc");
    expect(pickBackend("h264", all, "gpu", true)).toBe("nvenc");
  });

  it("falls back to CPU without a GPU encoder", () => {
    expect(pickBackend("av1", new Set(["libsvtav1"]), "gpu", false)).toBe("cpu");
  });

  it("follows AMF before QuickSync", () => {
    expect(pickBackend("h264", new Set(["h264_qsv", "h264_amf"]), "gpu", false)).toBe("amf");
  });

  it("throws when nothing can encode", () => {
    expect(() => pickBackend("av1", new Set(), "auto", false)).toThrow();
  });
});

describe("naming", () => {
  it("formats time tags", () => {
    expect(timeTag(72.9)).toBe("01m12s");
    expect(timeTag(5)).toBe("00m05s");
  });

  it("uses the cut name or its time range", () => {
    expect(clipFileName("Replay 2026.10.27", { name: "clutch 1v3", startSec: 0, endSec: 1 })).toBe("Replay 2026.10.27 - clutch 1v3.mp4");
    expect(clipFileName("Replay", { name: "", startSec: 12, endSec: 40 })).toBe("Replay - 00m12s-00m40s.mp4");
  });

  it("removes characters invalid on Windows", () => {
    expect(sanitize('a<b>:c"d/e\\f|g?h*')).toBe("a_b__c_d_e_f_g_h_");
    expect(sanitize("trailing dots...")).toBe("trailing dots");
  });

  it("never overwrites existing files", () => {
    const taken = new Set(["clip.mp4", "clip (2).mp4"]);
    expect(uniqueName("clip.mp4", (n) => taken.has(n))).toBe("clip (3).mp4");
    expect(uniqueName("new.mp4", (n) => taken.has(n))).toBe("new.mp4");
  });
});

describe("uniqueNameAsync", () => {
  it("matches uniqueName with an async check", async () => {
    const { uniqueNameAsync } = await import("./naming");
    const taken = new Set(["clip.mp4", "clip (2).mp4"]);
    expect(await uniqueNameAsync("clip.mp4", async (n) => taken.has(n))).toBe("clip (3).mp4");
  });
});
