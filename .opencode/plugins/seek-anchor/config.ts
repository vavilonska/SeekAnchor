import { readFileSync } from "node:fs";

export type OpenCodeMode = "minimal" | "anchor";
export type AnchorVariant = "A" | "B";
export type AnchorState = "UNANCHORED" | "ANCHORED";
export type BashBackend = "opencode" | "dsh";

export interface RuntimeSettings {
  mode: OpenCodeMode;
  anchorVariant: AnchorVariant;
  bashBackend: BashBackend;
}

export const DEFAULT_SETTINGS: RuntimeSettings = {
  mode: "minimal",
  anchorVariant: "A",
  bashBackend: "opencode",
};

export function loadSettings(path: string): RuntimeSettings {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RuntimeSettings>;
    return {
      mode: parsed.mode === "anchor" ? "anchor" : "minimal",
      anchorVariant: parsed.anchorVariant === "B" ? "B" : "A",
      bashBackend: parsed.bashBackend === "dsh" ? "dsh" : "opencode",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function compositionFor(
  settings: RuntimeSettings,
  anchorState: AnchorState,
): { system: "minimal" | "native"; tools: "minimal" | "full" } {
  if (settings.mode === "minimal" || anchorState === "UNANCHORED") {
    return { system: "minimal", tools: "minimal" };
  }
  return settings.anchorVariant === "A"
    ? { system: "minimal", tools: "full" }
    : { system: "native", tools: "full" };
}
