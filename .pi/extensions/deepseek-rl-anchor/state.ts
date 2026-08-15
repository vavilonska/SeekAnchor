import {
  DEFAULT_SETTINGS,
  type AnchorState,
  type AnchorVariant,
  type ExtensionSettings,
  type RLAnchorMode,
} from "./config.ts";

export class SessionState {
  settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
  anchorState: AnchorState = "UNANCHORED";
  sessionId: string | null = null;
  cwd: string | null = null;
  nativeToolNames: string[] = [];
  nativeSystemPrompt: string | null = null;
  minimalEngaged = false;
  firstToolCallDetected = false;

  resetForSession(sessionId: string | null, cwd: string): void {
    this.anchorState = "UNANCHORED";
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.nativeToolNames = [];
    this.nativeSystemPrompt = null;
    this.minimalEngaged = false;
    this.firstToolCallDetected = false;
  }

  recordToolResult(name: string, isError: boolean): boolean {
    if (isError || (name !== "bash" && name !== "str_replace_editor")) return false;
    this.firstToolCallDetected = true;
    if (this.settings.mode !== "anchor" || this.anchorState !== "UNANCHORED") return false;
    this.anchorState = "ANCHORED";
    return true;
  }

  setMode(mode: RLAnchorMode): void {
    this.settings.mode = mode;
    this.anchorState = "UNANCHORED";
    this.firstToolCallDetected = false;
  }

  setAnchorVariant(variant: AnchorVariant): void {
    this.settings.anchorVariant = variant;
  }
}
