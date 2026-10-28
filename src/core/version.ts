// Comparing the running version with GitHub release tags (update check).

export interface ReleaseInfo {
  tagName: string;
  htmlUrl: string;
  prerelease: boolean;
}

interface Version {
  core: [number, number, number];
  /** Dot-separated pre-release identifiers ("beta.2" -> ["beta", "2"]); empty for a release. */
  pre: string[];
}

/** Parses "1.2.3", "v1.2.3" and "v1.2.3-beta.4"; build metadata after "+" is ignored. */
export function parseVersion(text: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(text.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

/** Semver precedence: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  if (!a.pre.length || !b.pre.length) return (a.pre.length ? -1 : 0) - (b.pre.length ? -1 : 0);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * The newest release above `current`, or null. Someone on a pre-release is offered newer
 * pre-releases too; someone on a stable version only stable ones.
 */
export function newerRelease(current: string, releases: readonly ReleaseInfo[]): (ReleaseInfo & { version: string }) | null {
  const cur = parseVersion(current);
  if (!cur) return null;
  const allowPre = cur.pre.length > 0;
  let best: { release: ReleaseInfo; v: Version } | null = null;
  for (const release of releases) {
    const v = parseVersion(release.tagName);
    if (!v || ((release.prerelease || v.pre.length > 0) && !allowPre)) continue;
    if (compareVersions(v, cur) > 0 && (!best || compareVersions(v, best.v) > 0)) best = { release, v };
  }
  return best && { ...best.release, version: best.release.tagName.replace(/^v/, "") };
}
