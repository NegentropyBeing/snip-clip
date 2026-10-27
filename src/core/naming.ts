import type { Cut } from "./types";

/** 72.4 -> "01m12s" */
export function timeTag(sec: number): string {
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
}

const INVALID = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitize(name: string): string {
  return name.replace(INVALID, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
}

/** "<source> - <cut name>.mp4", or "<source> - 00m12s-00m40s.mp4" for unnamed cuts. */
export function clipFileName(sourceBaseName: string, cut: Pick<Cut, "name" | "startSec" | "endSec">): string {
  const label = sanitize(cut.name) || `${timeTag(cut.startSec)}-${timeTag(cut.endSec)}`;
  return `${sanitize(sourceBaseName)} - ${label}.mp4`;
}

export function montageFileName(sourceBaseName: string): string {
  return `${sanitize(sourceBaseName)} - montage.mp4`;
}

/** Appends " (2)", " (3)"… until `exists` reports a free name. Never overwrites. */
export function uniqueName(fileName: string, exists: (name: string) => boolean): string {
  if (!exists(fileName)) return fileName;
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!exists(candidate)) return candidate;
  }
}

/** `uniqueName` for an asynchronous existence check (e.g. the Tauri backend). */
export async function uniqueNameAsync(fileName: string, exists: (name: string) => Promise<boolean>): Promise<string> {
  const taken = new Set<string>();
  for (;;) {
    const candidate = uniqueName(fileName, (n) => taken.has(n));
    if (!(await exists(candidate))) return candidate;
    taken.add(candidate);
  }
}
