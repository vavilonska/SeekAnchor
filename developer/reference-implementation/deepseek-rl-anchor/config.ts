/**
 * Configuration types and defaults for the DeepSeek RL-Anchor extension.
 * Dependency-free (no pi imports) so unit tests can import it directly.
 */

export type RLAnchorMode = "native" | "minimal" | "anchor";
export type AnchorVariant = "A" | "B";
export type ExperimentId =
  | "NATIVE"
  | "PROMPT_ONLY"
  | "TOOLS_ONLY"
  | "MINIMAL"
  | "ANCHOR_A"
  | "ANCHOR_B";
export type ProfileId = "normal" | "benchmark";
export type CompactionMode = "native" | "off";
export type AnchorState = "UNANCHORED" | "ANCHORED";

/** The two DSH Minimal model-visible tool names (exact order). */
export const MINIMAL_TOOL_NAMES = ["bash", "str_replace_editor"] as const;

export interface ExtensionSettings {
  mode: RLAnchorMode;
  anchorVariant: AnchorVariant;
  /** Explicit experiment override; null = resolve from mode. */
  experiment: ExperimentId | null;
  profile: ProfileId;
  compaction: CompactionMode;
  debugLogging: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  mode: "native",
  anchorVariant: "A",
  experiment: null,
  profile: "normal",
  compaction: "native",
  debugLogging: true,
};

export const EXPERIMENT_IDS: ExperimentId[] = [
  "NATIVE",
  "PROMPT_ONLY",
  "TOOLS_ONLY",
  "MINIMAL",
  "ANCHOR_A",
  "ANCHOR_B",
];

/** Map a mode to its default experiment. */
export function experimentForMode(mode: RLAnchorMode, variant: AnchorVariant): ExperimentId {
  switch (mode) {
    case "native":
      return "NATIVE";
    case "minimal":
      return "MINIMAL";
    case "anchor":
      return variant === "B" ? "ANCHOR_B" : "ANCHOR_A";
  }
}

/** Which system prompt and tool set the model sees for a given experiment + anchor state. */
export interface Composition {
  system: "minimal" | "native";
  tools: "minimal" | "native";
}

export function compositionFor(
  experiment: ExperimentId,
  anchorState: AnchorState,
): Composition {
  switch (experiment) {
    case "NATIVE":
      return { system: "native", tools: "native" };
    case "PROMPT_ONLY":
      return { system: "minimal", tools: "native" };
    case "TOOLS_ONLY":
      return { system: "native", tools: "minimal" };
    case "MINIMAL":
      return { system: "minimal", tools: "minimal" };
    case "ANCHOR_A":
      return anchorState === "ANCHORED"
        ? { system: "minimal", tools: "native" }
        : { system: "minimal", tools: "minimal" };
    case "ANCHOR_B":
      return anchorState === "ANCHORED"
        ? { system: "native", tools: "native" }
        : { system: "minimal", tools: "minimal" };
  }
}

/** Whether an experiment uses the DSH minimal composition while UNANCHORED. */
export function isMinimalFirstTurn(experiment: ExperimentId): boolean {
  return experiment !== "NATIVE";
}

/** Whether the anchor trigger applies to this experiment. */
export function usesAnchor(experiment: ExperimentId): boolean {
  return experiment === "ANCHOR_A" || experiment === "ANCHOR_B";
}
