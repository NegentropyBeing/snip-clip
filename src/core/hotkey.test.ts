import { describe, expect, it } from "vitest";
import { formatHotkey, gnomeAccelerator, hotkeyFromKeyPress, type KeyPress } from "./hotkey";

const press = (code: string, mods: Partial<KeyPress> = {}): KeyPress =>
  ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });

describe("hotkeyFromKeyPress", () => {
  it("names keys as OBS does", () => {
    expect(hotkeyFromKeyPress(press("F10", { altKey: true }))).toEqual({ key: "OBS_KEY_F10", alt: true });
    expect(hotkeyFromKeyPress(press("KeyS", { ctrlKey: true, shiftKey: true }))).toEqual({ key: "OBS_KEY_S", control: true, shift: true });
    expect(hotkeyFromKeyPress(press("Numpad5", { metaKey: true }))).toEqual({ key: "OBS_KEY_NUM5", command: true });
    expect(hotkeyFromKeyPress(press("PageDown", { altKey: true }))?.key).toBe("OBS_KEY_PAGEDOWN");
  });

  it("takes function keys and the like on their own", () => {
    expect(hotkeyFromKeyPress(press("F9"))).toEqual({ key: "OBS_KEY_F9" });
    expect(hotkeyFromKeyPress(press("Pause"))).toEqual({ key: "OBS_KEY_PAUSE" });
  });

  it("needs a modifier for keys used in typing", () => {
    expect(hotkeyFromKeyPress(press("KeyS"))).toBeNull();
    expect(hotkeyFromKeyPress(press("KeyS", { shiftKey: true }))).toBeNull();
    expect(hotkeyFromKeyPress(press("Space"))).toBeNull();
  });

  it("waits while only modifiers are down and skips unsupported keys", () => {
    expect(hotkeyFromKeyPress(press("AltLeft", { altKey: true }))).toBeNull();
    expect(hotkeyFromKeyPress(press("Backquote", { ctrlKey: true }))).toBeNull();
  });
});

describe("formatHotkey and gnomeAccelerator", () => {
  it("formats for people and for GNOME", () => {
    const h = { key: "OBS_KEY_F10", alt: true };
    expect(formatHotkey(h)).toBe("Alt+F10");
    expect(gnomeAccelerator(h)).toBe("<Alt>F10");
    const s = { key: "OBS_KEY_S", control: true, shift: true, command: true };
    expect(formatHotkey(s)).toBe("Ctrl+Shift+Super+S");
    expect(gnomeAccelerator(s)).toBe("<Control><Shift><Super>s");
    expect(gnomeAccelerator({ key: "OBS_KEY_PAGEUP", alt: true })).toBe("<Alt>Page_Up");
    expect(gnomeAccelerator({ key: "OBS_KEY_NUM3", control: true })).toBe("<Control>KP_3");
  });

  it("round-trips every key it accepts", () => {
    for (const code of ["KeyA", "Digit7", "Numpad0", "F1", "F24", "Home", "ArrowLeft", "PrintScreen", "Space"]) {
      const h = hotkeyFromKeyPress(press(code, { altKey: true }))!;
      expect(gnomeAccelerator(h), code).not.toBeNull();
      expect(formatHotkey(h), code).not.toContain("OBS_KEY");
    }
  });

  it("leaves keys it does not know to OBS", () => {
    expect(gnomeAccelerator({ key: "OBS_KEY_MENU", alt: true })).toBeNull();
    expect(formatHotkey({ key: "OBS_KEY_MENU", alt: true })).toBe("Alt+MENU");
  });
});
