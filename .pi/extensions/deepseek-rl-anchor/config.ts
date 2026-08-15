export type RLAnchorMode = "native" | "minimal" | "anchor";
export type AnchorVariant = "A" | "B";
export type AnchorState = "UNANCHORED" | "ANCHORED";

export const MINIMAL_TOOL_NAMES = ["bash", "str_replace_editor"] as const;

export interface ExtensionSettings {
  mode: RLAnchorMode;
  anchorVariant: AnchorVariant;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  mode: "native",
  anchorVariant: "A",
};

export interface Composition {
  system: "minimal" | "native";
  tools: "minimal" | "native";
}

export function compositionFor(
  mode: RLAnchorMode,
  variant: AnchorVariant,
  anchorState: AnchorState,
): Composition {
  if (mode === "native") return { system: "native", tools: "native" };
  if (mode === "minimal") return { system: "minimal", tools: "minimal" };
  if (anchorState === "UNANCHORED") return { system: "minimal", tools: "minimal" };
  return variant === "A"
    ? { system: "minimal", tools: "native" }
    : { system: "native", tools: "native" };
}
