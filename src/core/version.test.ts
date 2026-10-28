import { describe, expect, it } from "vitest";
import { compareVersions, newerRelease, parseVersion, type ReleaseInfo } from "./version";

const cmp = (a: string, b: string) => Math.sign(compareVersions(parseVersion(a)!, parseVersion(b)!));
const rel = (tagName: string, prerelease = tagName.includes("-")): ReleaseInfo => ({ tagName, htmlUrl: `https://x/${tagName}`, prerelease });

describe("compareVersions", () => {
  it("orders by semver precedence", () => {
    const sorted = ["0.1.0-alpha", "0.1.0-beta.1", "0.1.0-beta.2", "0.1.0-beta.10", "0.1.0-rc.1", "0.1.0", "0.1.1", "0.2.0", "1.0.0"];
    for (let i = 1; i < sorted.length; i++) expect(cmp(sorted[i - 1], sorted[i]), `${sorted[i - 1]} < ${sorted[i]}`).toBe(-1);
    expect(cmp("v0.1.0", "0.1.0")).toBe(0);
    expect(cmp("1.0.0-beta", "1.0.0-beta.1")).toBe(-1);
  });

  it("rejects non-versions", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
  });
});

describe("newerRelease", () => {
  const releases = [rel("v0.1.0-beta.1"), rel("v0.1.0-beta.3"), rel("v0.1.0"), rel("v0.2.0-beta.1"), rel("ffmpeg-mirror")];

  it("offers pre-releases to pre-release users", () => {
    expect(newerRelease("0.1.0-beta.2", releases)?.version).toBe("0.2.0-beta.1");
  });

  it("offers only stable releases to stable users", () => {
    expect(newerRelease("0.0.9", releases)?.version).toBe("0.1.0");
    expect(newerRelease("0.1.0", releases)).toBeNull();
  });

  it("returns null when up to date", () => {
    expect(newerRelease("0.2.0-beta.1", releases)).toBeNull();
    expect(newerRelease("0.1.0-beta.2", [])).toBeNull();
  });

  it("keeps the release page link", () => {
    expect(newerRelease("0.1.0-beta.2", [rel("v0.1.0-beta.3")])?.htmlUrl).toBe("https://x/v0.1.0-beta.3");
  });
});
