import assert from "node:assert/strict";
import test from "node:test";
import { registerCommands as registerPiCommands } from "../../.pi/extensions/deepseek-rl-anchor/commands.ts";
import { SessionState as PiSessionState } from "../../.pi/extensions/deepseek-rl-anchor/state.ts";
import { registerCommands as registerOmpCommands } from "../../.omp/extensions/deepseek-rl-anchor/commands.ts";
import { SessionState as OmpSessionState } from "../../.omp/extensions/deepseek-rl-anchor/state.ts";

function collectCommands(registerCommands, SessionState) {
  const commands = new Map();
  const pi = {
    registerCommand: (name, definition) => commands.set(name, definition),
    getActiveTools: () => [],
  };
  registerCommands(pi, {
    state: new SessionState(),
    persistSettings: () => {},
    refreshToolDefinition: () => {},
  });
  return commands;
}

for (const [host, registerCommands, SessionState] of [
  ["Pi", registerPiCommands, PiSessionState],
  ["Oh My Pi", registerOmpCommands, OmpSessionState],
]) {
  test(`${host} provides second-level ds command completions`, () => {
    const commands = collectCommands(registerCommands, SessionState);
    const mode = commands.get("ds-mode");
    const variant = commands.get("ds-anchor-variant");

    assert.deepEqual(
      mode.getArgumentCompletions("").map((entry) => entry.value),
      ["native", "minimal", "anchor"],
    );
    assert.deepEqual(mode.getArgumentCompletions("m"), [{ value: "minimal", label: "minimal" }]);
    assert.deepEqual(
      variant.getArgumentCompletions("").map((entry) => entry.value),
      ["A", "B"],
    );
  });
}
