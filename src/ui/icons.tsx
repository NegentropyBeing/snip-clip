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
export const ResetIcon = () => <Icon {...stroke}><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5" /></Icon>;
export const MixerIcon = () => <Icon {...stroke}><path d="M6 4v16M12 4v16M18 4v16" /><rect x="4" y="13" width="4" height="3" rx="1" fill="currentColor" /><rect x="10" y="7" width="4" height="3" rx="1" fill="currentColor" /><rect x="16" y="11" width="4" height="3" rx="1" fill="currentColor" /></Icon>;
export const MinusIcon = () => <Icon {...stroke}><path d="M5 12h14" /></Icon>;
export const PlusIcon = () => <Icon {...stroke}><path d="M12 5v14M5 12h14" /></Icon>;
export const GearIcon = () => (
  <Icon {...stroke} strokeWidth={1.9}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </Icon>
);
