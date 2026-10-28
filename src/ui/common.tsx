import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { formatTimecode, parseTimecode } from "../core";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-px font-mono text-[11px] text-neutral-600 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
      {children}
    </kbd>
  );
}

type Variant = "primary" | "ghost" | "subtle";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-gradient text-white shadow-sm hover:brightness-110 disabled:hover:brightness-100",
  subtle: "bg-neutral-200 text-neutral-800 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700",
  ghost: "text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800",
};

export function Button({ variant = "subtle", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({ label, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Button
      variant="ghost"
      title={label}
      aria-label={label}
      className={`h-7 w-7 !px-0 !py-0 !text-brand-600 hover:!bg-brand-500/10 dark:!text-brand-400 ${className}`}
      {...props}
    />
  );
}

/** Time field: shows mm:ss.mmm, accepts any format parseTimecode understands, commits on Enter/blur. */
export function TimeInput({ value, onCommit, label }: { value: number; onCommit: (sec: number) => void; label: string }) {
  const [text, setText] = useState(formatTimecode(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(formatTimecode(value));
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const sec = parseTimecode(text);
    if (sec !== null) onCommit(sec);
    else setText(formatTimecode(value));
  };
  return (
    <input
      aria-label={label}
      title={label}
      className="w-[5.5rem] rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs tabular-nums hover:border-neutral-300 focus:border-brand-500 focus:outline-none dark:hover:border-neutral-600"
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setText(formatTimecode(value));
          setEditing(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
      <div className="h-full rounded-full bg-brand-gradient transition-[width]" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

/** Short duration for summaries: "42.5 s", "3 min 12 s". */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m} min ${s} s`;
}

/** Settings row: label on the left, control and hint on the right. */
export function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-3 py-2.5">
      <div className="pt-1.5 text-sm font-medium">{label}</div>
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
      </div>
    </div>
  );
}

export const selectClass = "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";

export function Select<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={selectClass}>
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}
