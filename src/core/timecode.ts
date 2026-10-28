/** 72.5 -> "01:12.500"; 3725.25 -> "1:02:05.250" */
export function formatTimecode(sec: number): string {
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

/** Accepts "ss[.mmm]", "mm:ss[.mmm]" and "h:mm:ss[.mmm]"; returns null when invalid. */
export function parseTimecode(text: string): number | null {
  const parts = text.trim().replace(",", ".").split(":");
  if (parts.length > 3 || parts.some((p) => p === "")) return null;
  const sec = Number(parts.pop());
  const units = parts.map(Number);
  if (!Number.isFinite(sec) || sec < 0) return null;
  if (units.some((u) => !Number.isInteger(u) || u < 0)) return null;
  if (units.length > 0 && sec >= 60) return null;
  if (units.length === 2 && units[1] >= 60) return null;
  return units.reduce((acc, u) => (acc + u) * 60, 0) + sec;
}
