import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import seekAnchorPlugin, { createSeekAnchorPlugin } from "../../.opencode/plugins/seek-anchor/index.ts";
import { compositionFor } from "../../.opencode/plugins/seek-anchor/config.ts";
import { SessionStore } from "../../.opencode/plugins/seek-anchor/state.ts";
import {
  DSH_MINIMAL_SYSTEM_PROMPT,
  DSH_MINIMAL_TOOLS as OPENCODE_TOOLS,
} from "../../.opencode/plugins/seek-anchor/dsh/constants.generated.ts";
import { DSH_MINIMAL_TOOLS as PI_TOOLS } from "../../.pi/extensions/deepseek-rl-anchor/dsh/constants.generated.ts";
import { DSH_MINIMAL_TOOLS as OMP_TOOLS } from "../../.omp/extensions/deepseek-rl-anchor/dsh/constants.generated.ts";
import { StrReplaceEditor } from "../../.opencode/plugins/seek-anchor/tools/str-replace-editor.ts";

test("OpenCode, Pi, and Oh My Pi expose the same canonical Minimal definitions", () => {
  assert.deepEqual(OPENCODE_TOOLS, PI_TOOLS);
  assert.deepEqual(OPENCODE_TOOLS, OMP_TOOLS);
  assert.deepEqual(OPENCODE_TOOLS.map((tool) => tool.name), ["bash", "str_replace_editor"]);
});

test("OpenCode Anchor A and B restore the intended composition", () => {
  const settingsA = { mode: "anchor", anchorVariant: "A", bashBackend: "opencode" };
  const settingsB = { mode: "anchor", anchorVariant: "B", bashBackend: "opencode" };
  assert.deepEqual(compositionFor(settingsA, "UNANCHORED"), {
    system: "minimal",
    tools: "minimal",
  });
  assert.deepEqual(compositionFor(settingsA, "ANCHORED"), {
    system: "minimal",
    tools: "full",
  });
  assert.deepEqual(compositionFor(settingsB, "ANCHORED"), {
    system: "native",
    tools: "full",
  });
});

test("OpenCode Anchor changes only after a successful Minimal tool", () => {
  const settings = { mode: "anchor", anchorVariant: "A", bashBackend: "opencode" };
  const store = new SessionStore();
  assert.equal(store.get("s1").anchorState, "UNANCHORED");
  assert.equal(store.recordSuccessfulTool("s1", "read", settings), false);
  assert.equal(store.get("s1").anchorState, "UNANCHORED");
  assert.equal(store.recordSuccessfulTool("s1", "shell", settings), true);
  assert.equal(store.get("s1").anchorState, "ANCHORED");
});

test("OpenCode editor maps the DSH /repo mount to the session workspace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seek-anchor-opencode-"));
  try {
    const editor = new StrReplaceEditor(dir);
    await editor.execute({ command: "create", path: "/repo/opencode.txt", file_text: "minimal" });
    assert.equal(await readFile(join(dir, "opencode.txt"), "utf8"), "minimal");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OpenCode-native backend preserves the executor and filters a Minimal request", async () => {
  const registeredTools = [];
  let contextHook;
  let afterHook;
  const disposable = { dispose: async () => {} };
  const ctx = {
    command: {
      transform: async () => {
        throw new Error("SeekAnchor must not register OpenCode commands");
      },
    },
    session: {
      get: async () => ({ location: { directory: process.cwd() } }),
      hook: async (name, callback) => {
        assert.equal(name, "context");
        contextHook = callback;
        return disposable;
      },
    },
    tool: {
      transform: async (callback) => {
        callback({ add: (tool) => registeredTools.push(tool) });
        return disposable;
      },
      hook: async (name, callback) => {
        assert.equal(name, "execute.after");
        afterHook = callback;
        return disposable;
      },
    },
  };

  const cleanup = await seekAnchorPlugin.setup(ctx);
  try {
    assert.deepEqual(registeredTools.map((tool) => tool.name), ["str_replace_editor"]);
    assert.equal(typeof contextHook, "function");
    assert.equal(typeof afterHook, "function");

    const event = {
      sessionID: "mock-session",
      agent: "build",
      model: {},
      system: [{ type: "text", text: "native" }],
      messages: [],
      tools: {
        shell: { description: "OpenCode shell", input: { type: "object" } },
        str_replace_editor: { description: "editor", input: { type: "object" } },
        read: { description: "read", input: { type: "object" } },
        write: { description: "write", input: { type: "object" } },
      },
    };
    await contextHook(event);

    assert.deepEqual(event.system, [{ type: "text", text: DSH_MINIMAL_SYSTEM_PROMPT }]);
    assert.deepEqual(Object.keys(event.tools), ["shell", "str_replace_editor"]);
    assert.equal(event.tools.shell.description, OPENCODE_TOOLS[0].description);
    assert.deepEqual(event.tools.shell.input, OPENCODE_TOOLS[0].parameters);
  } finally {
    await cleanup();
  }
});

test("DSH backend registers the persistent same-name bash only when selected at mount", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seek-anchor-opencode-settings-"));
  const settingsFile = join(dir, "seek-anchor.json");
  await writeFile(settingsFile, JSON.stringify({ mode: "minimal", anchorVariant: "A", bashBackend: "dsh" }));
  const registeredTools = [];
  const disposable = { dispose: async () => {} };
  const plugin = createSeekAnchorPlugin(settingsFile);
  const cleanup = await plugin.setup({
    command: {
      transform: async () => disposable,
    },
    session: {
      get: async () => ({ location: { directory: process.cwd() } }),
      hook: async () => disposable,
    },
    tool: {
      transform: async (callback) => {
        callback({ add: (tool) => registeredTools.push(tool) });
        return disposable;
      },
      hook: async () => disposable,
    },
  });
  try {
    assert.deepEqual(registeredTools.map((tool) => tool.name), ["bash", "str_replace_editor"]);
  } finally {
    await cleanup();
    await rm(dir, { recursive: true, force: true });
  }
});

test("changing mode resets an anchored OpenCode session", () => {
  const store = new SessionStore();
  const anchor = { mode: "anchor", anchorVariant: "A", bashBackend: "opencode" };
  store.syncSettings("s1", anchor);
  store.recordSuccessfulTool("s1", "shell", anchor);
  assert.equal(store.get("s1").anchorState, "ANCHORED");
  store.syncSettings("s1", { ...anchor, mode: "minimal" });
  assert.equal(store.get("s1").anchorState, "UNANCHORED");
});
