import badgeSvg from "../../assets/brand/badge.svg?raw";

/** The app badge (tile + wordmark) in the --brand-from/--brand-to gradient; the scissors use --badge-inner. */
export function Badge({ className = "" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="clip-snip"
      className={`inline-block text-brand-500 [--badge-inner:#fff] [&>svg]:h-full [&>svg]:w-auto ${className}`}
      dangerouslySetInnerHTML={{ __html: badgeSvg }}
    />
  );
}
