import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DSH_MINIMAL_TOOLS_SHA256 } from "./dsh/constants.generated.ts";
import type { RLAnchorMode } from "./config.ts";
import type { SessionState } from "./state.ts";

interface CommandServices {
  state: SessionState;
  persistSettings: () => void;
  refreshToolDefinition: () => void;
}

export function registerCommands(pi: ExtensionAPI, services: CommandServices): void {
  const { state } = services;

  pi.registerCommand("ds-mode", {
    description: "Switch SeekAnchor mode: native | minimal | anchor",
    getArgumentCompletions: (prefix: string) =>
      ["native", "minimal", "anchor"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const mode = args?.trim() as RLAnchorMode | undefined;
      if (!mode || !["native", "minimal", "anchor"].includes(mode)) {
        ctx.ui.notify(`Usage: /ds-mode <native|minimal|anchor> (current: ${state.settings.mode})`, "warning");
        return;
      }
      state.setMode(mode);
      services.persistSettings();
      services.refreshToolDefinition();
      ctx.ui.notify(`SeekAnchor mode: ${mode}`, "info");
    },
  });

  pi.registerCommand("ds-anchor-variant", {
    description: "Set anchor restore variant: A (Minimal prompt) | B (Pi prompt)",
    getArgumentCompletions: (prefix: string) =>
      ["A", "B"]
        .filter((value) => value.startsWith(prefix.toUpperCase()))
        .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const variant = args?.trim().toUpperCase();
      if (variant !== "A" && variant !== "B") {
        ctx.ui.notify("Usage: /ds-anchor-variant <A|B>", "warning");
        return;
      }
      state.setAnchorVariant(variant);
      services.persistSettings();
      ctx.ui.notify(`SeekAnchor variant: ${variant}`, "info");
    },
  });

  pi.registerCommand("ds-status", {
    description: "Show SeekAnchor runtime status",
    handler: async (_args, ctx) => {
      const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
      ctx.ui.notify(
        [
          `mode: ${state.settings.mode}`,
          `anchor variant: ${state.settings.anchorVariant}`,
          `anchor state: ${state.anchorState}`,
          `active model: ${model}`,
          `active tools: ${pi.getActiveTools().join(", ") || "(none)"}`,
          `minimal schema hash: ${DSH_MINIMAL_TOOLS_SHA256}`,
          `first successful Minimal tool: ${state.firstToolCallDetected}`,
        ].join("\n"),
        "info",
      );
    },
  });
}
