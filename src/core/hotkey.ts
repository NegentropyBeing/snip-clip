// The save-replay hotkey (FR-44): from a key press to OBS's hotkey names and GNOME's accelerators.
import type { ObsHotkey } from "./replayProfile";

/** The parts of a KeyboardEvent a hotkey needs. */
export interface KeyPress {
  /** Physical key, e.g. "KeyS", "F10", "Numpad1". */
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

interface KeyName {
  obs: string;
  /** GNOME keysym name. */
  gnome: string;
  label: string;
}

const NAMED: Record<string, KeyName> = {
  Space: { obs: "SPACE", gnome: "space", label: "Space" },
  Insert: { obs: "INSERT", gnome: "Insert", label: "Insert" },
  Delete: { obs: "DELETE", gnome: "Delete", label: "Delete" },
  Home: { obs: "HOME", gnome: "Home", label: "Home" },
  End: { obs: "END", gnome: "End", label: "End" },
  PageUp: { obs: "PAGEUP", gnome: "Page_Up", label: "PgUp" },
  PageDown: { obs: "PAGEDOWN", gnome: "Page_Down", label: "PgDn" },
  ArrowUp: { obs: "UP", gnome: "Up", label: "↑" },
  ArrowDown: { obs: "DOWN", gnome: "Down", label: "↓" },
  ArrowLeft: { obs: "LEFT", gnome: "Left", label: "←" },
  ArrowRight: { obs: "RIGHT", gnome: "Right", label: "→" },
  Pause: { obs: "PAUSE", gnome: "Pause", label: "Pause" },
  PrintScreen: { obs: "PRINT", gnome: "Print", label: "PrtSc" },
  ScrollLock: { obs: "SCROLLLOCK", gnome: "Scroll_Lock", label: "ScrLk" },
};

/** Keys that make a hotkey on their own; anything else needs a modifier so typing still works. */
const STANDALONE = /^(F\d+|Pause|PrintScreen|ScrollLock|Insert)$/;

function keyName(code: string): KeyName | null {
  if (NAMED[code]) return NAMED[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return { obs: m[1], gnome: m[1].toLowerCase(), label: m[1] };
  m = /^Digit(\d)$/.exec(code);
  if (m) return { obs: m[1], gnome: m[1], label: m[1] };
  m = /^Numpad(\d)$/.exec(code);
  if (m) return { obs: `NUM${m[1]}`, gnome: `KP_${m[1]}`, label: `Num ${m[1]}` };
  m = /^F(\d{1,2})$/.exec(code);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 24) return { obs: code, gnome: code, label: code };
  return null;
}

function keyFromObs(obsKey: string): KeyName | null {
  const bare = obsKey.replace(/^OBS_KEY_/, "");
  const named = Object.values(NAMED).find((k) => k.obs === bare);
  if (named) return named;
  if (/^[A-Z]$/.test(bare)) return keyName(`Key${bare}`);
  if (/^\d$/.test(bare)) return keyName(`Digit${bare}`);
  const num = /^NUM(\d)$/.exec(bare);
  if (num) return keyName(`Numpad${num[1]}`);
  return keyName(bare);
}

/**
 * The hotkey for a key press, or null while only modifiers are down or for keys that are not
 * supported. A plain letter or digit needs a modifier, so typing still works.
 */
export function hotkeyFromKeyPress(e: KeyPress): ObsHotkey | null {
  const key = keyName(e.code);
  if (!key) return null;
  const hotkey: ObsHotkey = { key: `OBS_KEY_${key.obs}` };
  if (e.ctrlKey) hotkey.control = true;
  if (e.shiftKey) hotkey.shift = true;
  if (e.altKey) hotkey.alt = true;
  if (e.metaKey) hotkey.command = true;
  const modified = e.ctrlKey || e.altKey || e.metaKey || (e.shiftKey && STANDALONE.test(e.code));
  return modified || STANDALONE.test(e.code) ? hotkey : null;
}

/** "Ctrl+Shift+F9". `command` is the Windows/Super key. */
export function formatHotkey(h: ObsHotkey): string {
  const parts = [h.control && "Ctrl", h.shift && "Shift", h.alt && "Alt", h.command && "Super"].filter(Boolean) as string[];
  return [...parts, keyFromObs(h.key)?.label ?? h.key.replace(/^OBS_KEY_/, "")].join("+");
}

/** GNOME accelerator ("<Alt>F10"); null for keys GNOME's custom shortcuts cannot take from us. */
export function gnomeAccelerator(h: ObsHotkey): string | null {
  const key = keyFromObs(h.key);
  if (!key) return null;
  const mods = [h.control && "<Control>", h.shift && "<Shift>", h.alt && "<Alt>", h.command && "<Super>"].filter(Boolean).join("");
  return mods + key.gnome;
}
