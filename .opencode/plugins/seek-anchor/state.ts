import type { AnchorState, RuntimeSettings } from "./config.ts";

export interface OpenCodeSessionState {
  anchorState: AnchorState;
  requests: number;
  firstSuccessfulMinimalTool: boolean;
  mode: RuntimeSettings["mode"];
}

export class SessionStore {
  private readonly sessions = new Map<string, OpenCodeSessionState>();

  get(sessionID: string): OpenCodeSessionState {
    let state = this.sessions.get(sessionID);
    if (!state) {
      state = {
        anchorState: "UNANCHORED",
        requests: 0,
        firstSuccessfulMinimalTool: false,
        mode: "minimal",
      };
      this.sessions.set(sessionID, state);
    }
    return state;
  }

  syncSettings(sessionID: string, settings: RuntimeSettings): OpenCodeSessionState {
    const state = this.get(sessionID);
    if (state.mode !== settings.mode) {
      state.mode = settings.mode;
      state.anchorState = "UNANCHORED";
      state.firstSuccessfulMinimalTool = false;
    }
    return state;
  }

  recordSuccessfulTool(sessionID: string, tool: string, settings: RuntimeSettings): boolean {
    if (tool !== "bash" && tool !== "shell" && tool !== "str_replace_editor") return false;
    const state = this.get(sessionID);
    state.firstSuccessfulMinimalTool = true;
    if (settings.mode !== "anchor" || state.anchorState === "ANCHORED") return false;
    state.anchorState = "ANCHORED";
    return true;
  }

  clear(): void {
    this.sessions.clear();
  }
}
