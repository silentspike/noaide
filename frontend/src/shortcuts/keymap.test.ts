import { describe, it, expect } from "vitest";

// Test pure functions from keymap (matchesBinding is not exported, so test via types)
import { defaultBindings } from "./keymap";
import type { KeyBinding } from "./keymap";

describe("keymap", () => {
  it("exports defaultBindings with expected keys", () => {
    expect(defaultBindings.commandPalette.key).toBe("k");
    expect(defaultBindings.commandPalette.meta).toBe(true);
    expect(defaultBindings.toggleSidebar.key).toBe("/");
    expect(defaultBindings.closeOverlay.key).toBe("Escape");
  });

  it("defaultBindings have descriptions", () => {
    for (const [, binding] of Object.entries(defaultBindings)) {
      expect(binding.description).toBeTruthy();
    }
  });

  it("KeyBinding type accepts valid shape", () => {
    const binding: KeyBinding = {
      key: "s",
      ctrl: true,
      action: () => {},
      description: "Save",
    };
    expect(binding.key).toBe("s");
    expect(binding.ctrl).toBe(true);
  });
});
