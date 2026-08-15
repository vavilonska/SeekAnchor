import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compositionFor, DEFAULT_SETTINGS, MINIMAL_TOOL_NAMES } from "./config.ts";
import {
  DSH_BASH_DESCRIPTION,
  DSH_EDITOR_DESCRIPTION,
  DSH_MINIMAL_SYSTEM_PROMPT,
} from "./dsh/constants.generated.ts";
import { dshBashParameters, dshEditorParameters } from "./dsh/schemas.ts";
import { PersistentBash } from "./tools/persistent-bash.ts";
import { StrReplaceEditor } from "./tools/str-replace-editor.ts";
import { SessionState } from "./state.ts";
import { registerCommands } from "./commands.ts";

/**
 * SeekAnchor runtime extension.
 *
 * This build intentionally contains only the user-facing runtime capability:
 * native/minimal/anchor composition and the two DSH-compatible tools.
 * Instrumentation, fingerprints, dumps and benchmark commands live under
 * developer/ and are not loaded by Pi.
 */
export default function seekAnchor(pi: ExtensionAPI): void {
  const state = new SessionState();
  let shell: PersistentBash | null = null;
  let shellCwd: string | null = null;
  let editor: StrReplaceEditor | null = null;

  const settingsFile = (): string =>
    join(state.cwd ?? process.cwd(), ".pi", "deepseek-rl-anchor", "settings.json");

  const loadSettings = (): void => {
    try {
      if (!existsSync(settingsFile())) return;
      const stored = JSON.parse(readFileSync(settingsFile(), "utf8")) as Partial<typeof DEFAULT_SETTINGS>;
      state.settings = { ...DEFAULT_SETTINGS, ...stored };
    } catch {
      state.settings = { ...DEFAULT_SETTINGS };
    }
  };

  const persistSettings = (): void => {
    try {
      const file = settingsFile();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(state.settings, null, 2)}\n`, "utf8");
    } catch {
      // Settings persistence must not interrupt the agent loop.
    }
  };

  const getShell = (): PersistentBash => {
    const cwd = state.cwd ?? process.cwd();
    if (!shell || shellCwd !== cwd) {
      if (shell) void shell.dispose();
      shell = new PersistentBash({ cwd });
      shellCwd = cwd;
    }
    return shell;
  };

  const getEditor = (): StrReplaceEditor => {
    if (!editor) editor = new StrReplaceEditor(state.cwd ?? process.cwd());
    return editor;
  };

  const registerNativeBash = (): void => {
    const builtin = createBashTool(state.cwd ?? process.cwd());
    pi.registerTool({
      name: "bash",
      label: "bash",
      description: builtin.description,
      parameters: builtin.parameters,
      execute: (toolCallId, params, signal, onUpdate) =>
        builtin.execute(toolCallId, params, signal, onUpdate),
    } as ToolDefinition);
  };

  const registerMinimalBash = (): void => {
    pi.registerTool({
      name: "bash",
      label: "bash",
      description: DSH_BASH_DESCRIPTION,
      parameters: dshBashParameters,
      execute: async (_toolCallId, params, signal) => ({
        content: [{ type: "text", text: await getShell().exec(params.command, signal ?? undefined) }],
        details: {},
      }),
    } as ToolDefinition);
  };

  const registerEditor = (): void => {
    pi.registerTool({
      name: "str_replace_editor",
      label: "str_replace_editor",
      description: DSH_EDITOR_DESCRIPTION,
      parameters: dshEditorParameters,
      execute: async (_toolCallId, params) => ({
        content: [{ type: "text", text: await getEditor().execute(params) }],
        details: {},
      }),
    } as ToolDefinition);
  };

  const currentComposition = () =>
    compositionFor(state.settings.mode, state.settings.anchorVariant, state.anchorState);

  const refreshToolDefinition = (): void => {
    if (currentComposition().tools === "minimal") registerMinimalBash();
    else registerNativeBash();
  };

  const restoreNativeTools = (): void => {
    registerNativeBash();
    if (state.nativeToolNames.length > 0) pi.setActiveTools([...state.nativeToolNames]);
    state.minimalEngaged = false;
  };

  pi.on("session_start", async (_event, ctx) => {
    state.resetForSession(ctx.sessionManager.getSessionId(), ctx.cwd);
    loadSettings();
    state.nativeToolNames = [...pi.getActiveTools()];
    registerEditor();
    refreshToolDefinition();
    if (state.nativeToolNames.length > 0) pi.setActiveTools([...state.nativeToolNames]);
  });

  pi.on("before_agent_start", async (event) => {
    if (state.nativeSystemPrompt === null) state.nativeSystemPrompt = event.systemPrompt;
    const composition = currentComposition();
    if (composition.tools === "minimal") {
      state.minimalEngaged = true;
      registerMinimalBash();
      pi.setActiveTools([...MINIMAL_TOOL_NAMES]);
    } else if (state.minimalEngaged) {
      restoreNativeTools();
    }
    return composition.system === "minimal"
      ? { systemPrompt: DSH_MINIMAL_SYSTEM_PROMPT }
      : undefined;
  });

  pi.on("tool_result", async (event) => {
    if (state.recordToolResult(event.toolName, event.isError)) restoreNativeTools();
  });

  pi.on("before_provider_request", (event) => {
    const payload = event.payload as Record<string, unknown>;
    const composition = currentComposition();

    if (
      composition.system === "native" &&
      state.anchorState === "ANCHORED" &&
      state.nativeSystemPrompt !== null &&
      Array.isArray(payload.messages)
    ) {
      const first = payload.messages[0] as { role?: string; content?: string } | undefined;
      if (first?.role === "system") first.content = state.nativeSystemPrompt;
    }

    if (composition.tools === "minimal" && Array.isArray(payload.tools)) {
      for (const tool of payload.tools) {
        const definition = (tool as { function?: Record<string, unknown> }).function;
        if (definition) delete definition.strict;
      }
    }
    return payload;
  });

  pi.on("session_shutdown", async () => {
    if (shell) await shell.dispose();
    shell = null;
    shellCwd = null;
    editor = null;
  });

  registerCommands(pi, { state, persistSettings, refreshToolDefinition });
}
