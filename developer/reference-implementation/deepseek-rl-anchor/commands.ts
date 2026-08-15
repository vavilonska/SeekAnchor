/**
 * Slash commands for the RL-Anchor extension.
 */
import type { ExtensionCommandContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXPERIMENT_IDS,
  MINIMAL_TOOL_NAMES,
  type ExperimentId,
  type ProfileId,
} from "./config.ts";
import { DSH_MINIMAL_SYSTEM_PROMPT, DSH_MINIMAL_TOOLS_SHA256 } from "./dsh/constants.generated.ts";
import { schemaMismatches } from "./dsh/schemas.ts";
import { sha256, sha256Json, writeDump } from "./instrumentation/composition.ts";
import type { SessionState } from "./state.ts";

export interface CommandServices {
  state: SessionState;
  persistSettings: () => void;
  applyProfile: (profile: ProfileId, previousThinkingLevel: string | null) => Promise<void>;
  reRegisterBashTool: () => void;
  getArtifactsDir: () => string;
  getLogsDir: () => string;
}

function show(notify: (msg: string, kind?: "info" | "warning" | "error") => void, lines: string[], ctx?: { hasUI?: boolean }): void {
  if (ctx && ctx.hasUI === false) {
    // print/json mode: ui.notify is a no-op; fall back to stdout so
    // /ds-* commands stay observable in non-interactive runs.
    for (const line of lines) console.log(line);
    return;
  }
  for (const line of lines) notify(line, "info");
}

/** Unified notify: stdout fallback when the UI is not interactive. */
function notify(ctx: { hasUI?: boolean; ui: { notify: (msg: string, kind?: "info" | "warning" | "error") => void } }, msg: string, kind?: "info" | "warning" | "error"): void {
  if (ctx.hasUI === false) {
    console.log(msg);
    return;
  }
  ctx.ui.notify(msg, kind);
}

export function registerCommands(pi: ExtensionAPI, services: CommandServices): void {
  const { state } = services;

  pi.registerCommand("ds-mode", {
    description: "Switch RL-Anchor mode: native | minimal | anchor",
    getArgumentCompletions: (prefix: string) =>
      ["native", "minimal", "anchor"]
        .filter((v) => v.startsWith(prefix))
        .map((v) => ({ value: v, label: v })),
    handler: async (args, ctx) => {
      const mode = args?.trim() as "native" | "minimal" | "anchor" | undefined;
      if (!mode || !["native", "minimal", "anchor"].includes(mode)) {
        notify(ctx, `Usage: /ds-mode <native|minimal|anchor> (current: ${state.settings.mode})`, "warning");
        return;
      }
      state.setMode(mode);
      services.persistSettings();
      services.reRegisterBashTool();
      notify(ctx, `RL-Anchor mode: ${mode} (experiment: ${state.experiment}, anchor: ${state.anchorState})`, "info");
    },
  });

  pi.registerCommand("ds-anchor-variant", {
    description: "Set anchor restore variant: A (minimal system + Pi tools) | B (Pi system + Pi tools)",
    getArgumentCompletions: (prefix: string) =>
      ["A", "B"].filter((v) => v.startsWith(prefix.toUpperCase())).map((v) => ({ value: v, label: v })),
    handler: async (args, ctx) => {
      const variant = args?.trim().toUpperCase() as "A" | "B" | undefined;
      if (variant !== "A" && variant !== "B") {
        notify(ctx, "Usage: /ds-anchor-variant <A|B>", "warning");
        return;
      }
      state.setAnchorVariant(variant);
      services.persistSettings();
      notify(ctx, `Anchor variant: ${variant}`, "info");
    },
  });

  pi.registerCommand("ds-experiment", {
    description: "Switch experiment: NATIVE | PROMPT_ONLY | TOOLS_ONLY | MINIMAL | ANCHOR_A | ANCHOR_B",
    getArgumentCompletions: (prefix: string) =>
      EXPERIMENT_IDS.filter((v) => v.startsWith(prefix.toUpperCase())).map((v) => ({ value: v, label: v })),
    handler: async (args, ctx) => {
      const name = args?.trim().toUpperCase() as ExperimentId | undefined;
      if (!name || !EXPERIMENT_IDS.includes(name)) {
        notify(ctx, `Usage: /ds-experiment <${EXPERIMENT_IDS.join("|")}>`, "warning");
        return;
      }
      state.setExperiment(name);
      services.persistSettings();
      services.reRegisterBashTool();
      notify(ctx, `Experiment: ${name} (anchor state reset on next session)`, "info");
    },
  });

  pi.registerCommand("ds-profile", {
    description: "Set inference profile: normal (respect user config) | benchmark (DSH defaults: reasoning high, max_tokens 256000)",
    getArgumentCompletions: (prefix: string) =>
      ["normal", "benchmark"].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v })),
    handler: async (args, ctx) => {
      const profile = args?.trim() as ProfileId | undefined;
      if (profile !== "normal" && profile !== "benchmark") {
        notify(ctx, "Usage: /ds-profile <normal|benchmark>", "warning");
        return;
      }
      const previous = state.settings.profile;
      state.setProfile(profile);
      await services.applyProfile(profile, state.previousThinkingLevel);
      if (previous === "normal" && profile === "benchmark" && state.previousThinkingLevel === null) {
        // first switch: remember the user's level for restore
        try {
          state.previousThinkingLevel = pi.getThinkingLevel();
        } catch {
          state.previousThinkingLevel = null;
        }
      }
      services.persistSettings();
      notify(ctx, `Profile: ${profile} (thinking: ${profile === "benchmark" ? "high (DSH default)" : "restored/user"} ; max_tokens: ${profile === "benchmark" ? "256000" : "user"})`, "info");
    },
  });

  pi.registerCommand("ds-compaction", {
    description: "Compaction during experiments: native (Pi behavior) | off (cancel all compactions)",
    getArgumentCompletions: (prefix: string) =>
      ["native", "off"].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v })),
    handler: async (args, ctx) => {
      const mode = args?.trim() as "native" | "off" | undefined;
      if (mode !== "native" && mode !== "off") {
        notify(ctx, "Usage: /ds-compaction <native|off>", "warning");
        return;
      }
      state.setCompaction(mode);
      services.persistSettings();
      notify(ctx, `Compaction: ${mode === "off" ? "OFF during experiments" : "native (Pi behavior)"}`, "info");
    },
  });

  pi.registerCommand("ds-status", {
    description: "Show RL-Anchor status: mode, anchor state, model, tools, composition hash",
    handler: async (_args, ctx) => {
      const lines = [
        `mode: ${state.settings.mode}`,
        `experiment: ${state.experiment}`,
        `anchor variant: ${state.settings.anchorVariant}`,
        `anchor state: ${state.anchorState}`,
        `profile: ${state.settings.profile}`,
        `compaction: ${state.settings.compaction}`,
        `debug logging: ${state.settings.debugLogging}`,
        `session: ${state.sessionId ?? "(none)"} (${state.sessionReason ?? "?"})`,
        `active model: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "?"}`,
        `thinking level: ${pi.getThinkingLevel()}`,
        `active tools: ${pi.getActiveTools().join(", ") || "(none)"}`,
        `minimal composition hash: ${DSH_MINIMAL_TOOLS_SHA256}`,
        `first tool call detected: ${state.firstToolCallDetected}`,
        `tool calls: ${state.toolCalls.length} (failed: ${state.failedToolCalls})`,
        `schema mismatches: ${schemaMismatches().length === 0 ? "none" : schemaMismatches().join("; ")}`,
      ];
      show(ctx.ui.notify.bind(ctx.ui), lines, ctx);
    },
  });

  pi.registerCommand("ds-inspect", {
    description: "Show the composition that will be sent to the model",
    handler: async (_args, ctx) => {
      const effective = ctx.getSystemPrompt();
      const options = ctx.getSystemPromptOptions();
      const active = pi.getActiveTools();
      const all = pi.getAllTools();
      const activeDefs = all.filter((t) => active.includes(t.name));
      const lines = [
        `MODE: ${state.settings.mode} (experiment ${state.experiment}, anchor ${state.anchorState})`,
        `SYSTEM PROMPT SHA256: ${sha256(effective)}`,
        `SYSTEM PROMPT LENGTH: ${effective.length}`,
        `system is DSH minimal: ${effective === DSH_MINIMAL_SYSTEM_PROMPT}`,
        `CONTEXT:`,
        `- message count: ${ctx.sessionManager.getEntries().length}`,
        `- AGENTS/context files loaded by Pi: ${(options.contextFiles ?? []).length > 0 ? "YES (replaced in minimal mode)" : "no"}`,
        `- skills loaded by Pi: ${(options.skills ?? []).length > 0 ? `YES (${(options.skills ?? []).length}) (replaced in minimal mode)` : "no"}`,
        `- Pi identity present in effective prompt: ${effective.includes("operating inside pi")}`,
        `TOOLS (active ${active.length}):`,
      ];
      for (const t of activeDefs) {
        lines.push(`- ${t.name}: schema ${sha256Json(t.parameters)}`);
      }
      for (const name of MINIMAL_TOOL_NAMES) {
        if (!active.includes(name)) lines.push(`- (inactive) ${name}`);
      }
      show(ctx.ui.notify.bind(ctx.ui), lines, ctx);
    },
  });

  pi.registerCommand("ds-dump", {
    description: "Write sanitized composition dump to artifacts/composition/",
    handler: async (_args, ctx) => {
      const dir = join(services.getArtifactsDir(), "composition");
      const effective = ctx.getSystemPrompt();
      const all = pi.getAllTools();
      const active = pi.getActiveTools();
      const tools = all
        .filter((t) => active.includes(t.name))
        .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
      const metadata = {
        mode: state.settings.mode,
        experiment: state.experiment,
        anchorVariant: state.settings.anchorVariant,
        anchorState: state.anchorState,
        profile: state.settings.profile,
        model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
        thinkingLevel: pi.getThinkingLevel(),
        activeTools: active,
        systemPromptSha256: sha256(effective),
        toolSchemaHash: sha256Json(tools),
        messageCount: ctx.sessionManager.getEntries().length,
        sessionId: state.sessionId,
        minimalToolsSha256: DSH_MINIMAL_TOOLS_SHA256,
        timestamp: new Date().toISOString(),
      };
      const files = {
        "system.txt": effective,
        "tools.json": JSON.stringify(tools, null, 2) + "\n",
        "metadata.json": JSON.stringify(metadata, null, 2) + "\n",
      };
      try {
        const written = writeDump(dir, files);
        notify(ctx, `Dumped ${written.length} files to ${dir}`, "info");
      } catch (err) {
        notify(ctx, `Dump refused: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });

  pi.registerCommand("ds-debug", {
    description: "Toggle debug JSONL logging",
    handler: async (_args, ctx) => {
      state.setDebugLogging(!state.settings.debugLogging);
      services.persistSettings();
      notify(ctx, `Debug logging: ${state.settings.debugLogging}`, "info");
    },
  });
}
