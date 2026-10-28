// Control icons as inline SVG so they follow the text color (emoji glyphs ignore it).
import type { SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const PlayIcon = () => <Icon><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></Icon>;
export const PauseIcon = () => <Icon><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></Icon>;
export const FrameBackIcon = () => <Icon><rect x="4" y="5" width="2.5" height="14" rx="1" /><path d="M19 6.2v11.6a1 1 0 0 1-1.55.83L9.2 12.83a1 1 0 0 1 0-1.66l8.25-5.8A1 1 0 0 1 19 6.2Z" /></Icon>;
export const FrameForwardIcon = () => <Icon><rect x="17.5" y="5" width="2.5" height="14" rx="1" /><path d="M5 6.2v11.6a1 1 0 0 0 1.55.83l8.25-5.8a1 1 0 0 0 0-1.66L6.55 5.37A1 1 0 0 0 5 6.2Z" /></Icon>;
export const UpIcon = () => <Icon {...stroke}><path d="M12 19V5M6 11l6-6 6 6" /></Icon>;
export const DownIcon = () => <Icon {...stroke}><path d="M12 5v14M6 13l6 6 6-6" /></Icon>;
export const CloseIcon = () => <Icon {...stroke}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
export const ToStartIcon = () => <Icon {...stroke}><path d="M5 5v14M20 12H9M13 7l-5 5 5 5" /></Icon>;
export const ToEndIcon = () => <Icon {...stroke}><path d="M19 5v14M4 12h11M11 7l5 5-5 5" /></Icon>;
export const MinusIcon = () => <Icon {...stroke}><path d="M5 12h14" /></Icon>;
export const PlusIcon = () => <Icon {...stroke}><path d="M12 5v14M5 12h14" /></Icon>;
