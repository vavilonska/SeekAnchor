import assert from "node:assert/strict";
import test from "node:test";
import {
  compositionFor,
} from "../../.pi/extensions/deepseek-rl-anchor/config.ts";
import { SessionState } from "../../.pi/extensions/deepseek-rl-anchor/state.ts";

test("composition modes stay independent", () => {
  assert.deepEqual(compositionFor("native", "A", "UNANCHORED"), {
    system: "native",
    tools: "native",
  });
  assert.deepEqual(compositionFor("minimal", "A", "ANCHORED"), {
    system: "minimal",
    tools: "minimal",
  });
  assert.deepEqual(compositionFor("anchor", "A", "ANCHORED"), {
    system: "minimal",
    tools: "native",
  });
  assert.deepEqual(compositionFor("anchor", "B", "ANCHORED"), {
    system: "native",
    tools: "native",
  });
});

test("anchor requires a successful Minimal tool result", () => {
  const state = new SessionState();
  state.setMode("anchor");
  assert.equal(state.recordToolResult("bash", true), false);
  assert.equal(state.anchorState, "UNANCHORED");
  assert.equal(state.recordToolResult("unrelated", false), false);
  assert.equal(state.anchorState, "UNANCHORED");
  assert.equal(state.recordToolResult("str_replace_editor", false), true);
  assert.equal(state.anchorState, "ANCHORED");
});

test("new sessions and mode changes reset anchor state", () => {
  const state = new SessionState();
  state.setMode("anchor");
  state.recordToolResult("bash", false);
  state.resetForSession("next", "C:/workspace");
  assert.equal(state.anchorState, "UNANCHORED");
  assert.equal(state.firstToolCallDetected, false);

  state.recordToolResult("bash", false);
  state.setMode("minimal");
  assert.equal(state.anchorState, "UNANCHORED");
});
