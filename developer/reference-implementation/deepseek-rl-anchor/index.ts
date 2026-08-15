/**
 * DeepSeek RL-Anchor Extension (DSH Minimal composition for Pi).
 *
 * Modes: native | minimal | anchor  (+ experiments, profiles, variants).
 * See README.md and docs/ for methodology. This extension reproduces the
 * model-visible DSH Minimal composition; it does not claim to unlock any
 * hidden model capability.
 */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compositionFor,
  DEFAULT_SETTINGS,
  MINIMAL_TOOL_NAMES,
  type ProfileId,
  usesAnchor,
} from "./config.ts";
import { DSH_BASH_DESCRIPTION, DSH_EDITOR_DESCRIPTION, DSH_MINIMAL_SYSTEM_PROMPT } from "./dsh/constants.generated.ts";
import { dshBashParameters, dshEditorParameters } from "./dsh/schemas.ts";
import { PersistentBash } from "./tools/persistent-bash.ts";
import { StrReplaceEditor } from "./tools/str-replace-editor.ts";
import { TurnLogger } from "./instrumentation/logger.ts";
import {
  countFingerprint,
  mergeFingerprint,
  reasoningLength,
  visibleAssistantText,
} from "./instrumentation/fingerprint.ts";
import { sha256, snapshotPayload } from "./instrumentation/composition.ts";
import { SessionState } from "./state.ts";
import { registerCommands } from "./commands.ts";

export default function (pi: ExtensionAPI) {
  const state = new SessionState();
  let shell: PersistentBash | null = null;
  let shellCwd: string | null = null;
  let editor: StrReplaceEditor | null = null;
  let logger: TurnLogger | null = null;
  let lastUsage: { input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number } | null = null;
  let lastPayloadHashes: { system: string | null; tools: string | null } = { system: null, tools: null };
  let lastPayloadToolNames: string[] = [];
  let compositionClean = true;
  const executionStarts = new Map<string, number>();

  // -------------------------------------------------------------------------
  // Settings persistence (project-level .pi/deepseek-rl-anchor/settings.json)
  // -------------------------------------------------------------------------
  function settingsFile(): string {
    return join(state.cwd ?? process.cwd(), ".pi", "deepseek-rl-anchor", "settings.json");
  }

  function loadSettings(): void {
    try {
      const file = settingsFile();
      if (existsSync(file)) {
        const data = JSON.parse(readFileSync(file, "utf8")) as Partial<typeof DEFAULT_SETTINGS>;
        state.settings = { ...DEFAULT_SETTINGS, ...data };
      }
    } catch {
      state.settings = { ...DEFAULT_SETTINGS };
    }
  }

  function persistSettings(): void {
    try {
      const file = settingsFile();
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify(state.settings, null, 2) + "\n", "utf8");
    } catch {
      // non-fatal
    }
  }

  // -------------------------------------------------------------------------
  // Tool registration (re-registerable per mode)
  // -------------------------------------------------------------------------
  function registerNativeBash(cwd: string): void {
    try {
      const builtin = createBashTool(cwd);
      pi.registerTool({
        name: "bash",
        label: "bash",
        description: builtin.description,
        parameters: builtin.parameters,
        execute: (toolCallId, params, signal, onUpdate) =>
          builtin.execute(toolCallId, params, signal, onUpdate),
      } as ToolDefinition);
    } catch (err) {
      console.error("[ds-rl-anchor] failed to register native bash mirror:", err);
    }
  }

  function registerDshBash(): void {
    pi.registerTool({
      name: "bash",
      label: "bash",
      description: DSH_BASH_DESCRIPTION,
      parameters: dshBashParameters,
      execute: async (toolCallId, params, signal) => {
        const shell = getShell();
        const result = await shell.exec(params.command, signal ?? undefined);
        return { content: [{ type: "text", text: result }], details: {} };
      },
    } as ToolDefinition);
  }

  function registerEditorTool(): void {
    pi.registerTool({
      name: "str_replace_editor",
      label: "str_replace_editor",
      description: DSH_EDITOR_DESCRIPTION,
      parameters: dshEditorParameters,
      execute: async (toolCallId, params) => {
        const ed = getEditor();
        const result = await ed.execute(params);
        return { content: [{ type: "text", text: result }], details: {} };
      },
    } as ToolDefinition);
  }

  function getShell(): PersistentBash {
    const cwd = state.cwd ?? process.cwd();
    if (!shell || shellCwd !== cwd) {
      if (shell) void shell.dispose();
      shell = new PersistentBash({ cwd });
      shellCwd = cwd;
    }
    return shell;
  }

  function getEditor(): StrReplaceEditor {
    if (!editor) editor = new StrReplaceEditor(state.cwd ?? process.cwd());
    return editor;
  }

  /** Ensure the registered `bash` definition matches the current composition. */
  function reRegisterBashTool(): void {
    const comp = compositionFor(state.experiment, state.anchorState);
    if (comp.tools === "minimal") {
      registerDshBash();
    } else {
      registerNativeBash(state.cwd ?? process.cwd());
    }
  }

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------
  async function applyProfile(profile: ProfileId): Promise<void> {
    if (profile === "benchmark") {
      if (state.previousThinkingLevel === null) {
        try {
          state.previousThinkingLevel = pi.getThinkingLevel();
        } catch {
          state.previousThinkingLevel = null;
        }
      }
      try {
        pi.setThinkingLevel("high"); // DSH llm-deepseek default
      } catch {
        // model may not support it
      }
    } else {
      if (state.previousThinkingLevel) {
        try {
          pi.setThinkingLevel(state.previousThinkingLevel as Parameters<typeof pi.setThinkingLevel>[0]);
        } catch {
          // ignore
        }
      }
      state.previousThinkingLevel = null;
    }
  }

  function writeFingerprintArtifact(): void {
    try {
      const dir = join(state.cwd ?? process.cwd(), "artifacts");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "fingerprint.json"),
        JSON.stringify(
          {
            sessionId: state.sessionId,
            mode: state.settings.mode,
            experiment: state.experiment,
            anchorVariant: state.settings.anchorVariant,
            anchorState: state.anchorState,
            firstToolCallDetected: state.firstToolCallDetected,
            firstToolCallLatencyMs:
              state.toolCalls.find((call) => !call.isError)?.durationMs ?? null,
            toolCalls: state.toolCalls.length,
            failedToolCalls: state.failedToolCalls,
            recoveryAttempts: state.recoveryAttempts,
            fingerprint: state.fingerprint,
            reasoningChars: state.reasoningChars,
            timestamp: new Date().toISOString(),
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
    } catch {
      // instrumentation must never break the agent loop
    }
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------
  pi.on("session_start", async (event, ctx) => {
    state.resetForSession(ctx.sessionManager.getSessionId(), event.reason, ctx.cwd);
    loadSettings();
    state.nativeToolNames = [...pi.getActiveTools()];
    state.nativeSystemPrompt = null;
    logger = new TurnLogger(join(ctx.cwd, "logs"), () => state.settings.debugLogging);
    logger.setSession(state.sessionId);
    registerEditorTool();
    reRegisterBashTool();
    // Pi auto-activates newly registered tools; restore the native active set
    // so native mode remains a true control group (minimal mode is applied
    // in before_agent_start, right before the first model request).
    if (state.nativeToolNames.length > 0) pi.setActiveTools([...state.nativeToolNames]);
    compositionClean = true;
    // Apply persisted profile (restore benchmark thinking level if set).
    if (state.settings.profile === "benchmark") {
      state.previousThinkingLevel = null;
      await applyProfile("benchmark");
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (state.nativeSystemPrompt === null) {
      state.nativeSystemPrompt = event.systemPrompt;
    }
    const comp = compositionFor(state.experiment, state.anchorState);
    if (comp.tools === "minimal") {
      state.minimalEngaged = true;
      registerDshBash();
      pi.setActiveTools([...MINIMAL_TOOL_NAMES]);
    } else if (state.minimalEngaged) {
      restoreNativeTools();
    }
    if (comp.system === "minimal") {
      return { systemPrompt: DSH_MINIMAL_SYSTEM_PROMPT };
    }
    return undefined;
  });

  pi.on("turn_start", async (event) => {
    state.turn = event.turnIndex;
    state.turnStartedAt = event.timestamp;
    lastUsage = null;
  });

  pi.on("tool_execution_start", async (event) => {
    executionStarts.set(event.toolCallId, Date.now());
  });

  pi.on("tool_result", async (event) => {
    const startedAt = executionStarts.get(event.toolCallId) ?? 0;
    executionStarts.delete(event.toolCallId);
    const wasUnanchored = state.anchorState === "UNANCHORED";
    state.recordToolResult(event.toolName, event.toolCallId, event.isError, startedAt);

    if (
      usesAnchor(state.experiment) &&
      wasUnanchored &&
      state.anchorState === "ANCHORED"
    ) {
      // First successful Minimal tool call: restore Pi full tools.
      restoreNativeTools();
    }
  });

  /** Restore the Pi-native tool set after minimal engagement/anchor. */
  function restoreNativeTools(): void {
    registerNativeBash(state.cwd ?? process.cwd());
    const names = state.nativeToolNames.length > 0 ? state.nativeToolNames : pi.getActiveTools();
    pi.setActiveTools(names);
    state.minimalEngaged = false;
  }

  pi.on("message_end", async (event) => {
    const msg = event.message;
    if (msg.role !== "assistant") return;
    const content = Array.isArray(msg.content) ? msg.content : [];
    mergeFingerprint(state.fingerprint, countFingerprint(visibleAssistantText(content)));
    state.reasoningChars += reasoningLength(content);
    if (msg.usage) {
      lastUsage = {
        input: msg.usage.input,
        output: msg.usage.output,
        reasoning: msg.usage.reasoning,
        cacheRead: msg.usage.cacheRead,
        cacheWrite: msg.usage.cacheWrite,
      };
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    const comp = compositionFor(state.experiment, state.anchorState);
    if (logger) {
      const entry = logger.buildEntry(state, lastPayloadHashes, lastPayloadToolNames);
      entry.messageCount = ctx.sessionManager.getEntries().length;
      entry.usage = lastUsage;
      entry.compositionClean = compositionClean;
      logger.log(entry);
    }
    writeFingerprintArtifact();
    void comp;
  });

  pi.on("before_provider_request", (event) => {
    const payload = event.payload as Record<string, unknown>;
    const comp = compositionFor(state.experiment, state.anchorState);

    // Benchmark profile: cap max_tokens to the DSH default (256000).
    if (
      state.settings.profile === "benchmark" &&
      typeof payload.max_tokens === "number" &&
      payload.max_tokens > 256000
    ) {
      payload.max_tokens = 256000;
    }

    // ANCHOR_B: restore the Pi-native system prompt on requests after anchoring.
    if (
      comp.system === "native" &&
      state.anchorState === "ANCHORED" &&
      state.nativeSystemPrompt !== null &&
      Array.isArray(payload.messages)
    ) {
      const first = payload.messages[0] as { role?: string } | undefined;
      if (first?.role === "system") {
        (first as { content: string }).content = state.nativeSystemPrompt;
      }
    }

    // DSH-exact wire: remove pi's `strict` sampling field in minimal mode.
    if (comp.tools === "minimal" && Array.isArray(payload.tools)) {
      for (const t of payload.tools) {
        const fn = (t as { function?: Record<string, unknown> })?.function;
        if (fn) delete fn.strict;
      }
    }

    // Ground-truth composition snapshot + contamination check.
    const snap = snapshotPayload(payload);
    lastPayloadHashes = { system: snap.systemPromptHash, tools: snap.toolSchemaHash };
    lastPayloadToolNames = snap.toolNames;
    const expectedTools = new Set<string>(MINIMAL_TOOL_NAMES);
    const toolsClean =
      comp.tools !== "minimal" ||
      (snap.toolNames.length === MINIMAL_TOOL_NAMES.length &&
        snap.toolNames.every((n) => expectedTools.has(n)));
    const systemClean =
      comp.system !== "minimal" ||
      snap.systemPromptHash === sha256(DSH_MINIMAL_SYSTEM_PROMPT);
    compositionClean = toolsClean && systemClean;
    if (!compositionClean) {
      console.warn(
        "[ds-rl-anchor] COMPOSITION NOT CLEAN — systemPromptHash:",
        snap.systemPromptHash,
        "expectedSystemPromptHash:",
        sha256(DSH_MINIMAL_SYSTEM_PROMPT),
        "model-visible tools:",
        JSON.stringify(snap.toolNames),
      );
    }
    return payload;
  });

  pi.on("session_before_compact", async () => {
    if (state.settings.compaction === "off" && state.experiment !== "NATIVE") {
      return { cancel: true };
    }
    return undefined;
  });

  pi.on("session_shutdown", async () => {
    writeFingerprintArtifact();
    if (shell) {
      void shell.dispose();
      shell = null;
      shellCwd = null;
    }
    editor = null;
    logger = null;
  });

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------
  registerCommands(pi, {
    state,
    persistSettings,
    applyProfile,
    reRegisterBashTool,
    getArtifactsDir: () => join(state.cwd ?? process.cwd(), "artifacts"),
    getLogsDir: () => join(state.cwd ?? process.cwd(), "logs"),
  });
}
