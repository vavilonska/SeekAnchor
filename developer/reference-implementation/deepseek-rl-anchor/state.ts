/**
 * Per-session state machine for the RL-Anchor extension.
 * Dependency-free so unit tests can import it directly.
 *
 * Anchor rule (Phase 10): UNANCHORED -> ANCHORED only on the first
 * successfully executed legal Minimal tool call. Failed tool calls never
 * transition. New sessions always reset to UNANCHORED.
 */
import {
  DEFAULT_SETTINGS,
  experimentForMode,
  usesAnchor,
  type AnchorState,
  type AnchorVariant,
  type CompactionMode,
  type ExperimentId,
  type ExtensionSettings,
  type ProfileId,
  type RLAnchorMode,
} from "./config.ts";

export interface ToolCallRecord {
  name: string;
  callId: string;
  isError: boolean;
  /** ms between tool_execution_start and tool_result */
  durationMs: number | null;
  startedAt: number;
}

export class SessionState {
  /** Persistent-ish settings (survive within the pi process). */
  settings: ExtensionSettings = { ...DEFAULT_SETTINGS };

  // ---- per-session runtime state ----
  anchorState: AnchorState = "UNANCHORED";
  sessionId: string | null = null;
  sessionReason: string | null = null;
  cwd: string | null = null;
  /** Snapshot of pi.getActiveTools() taken at session_start (the "native" set). */
  nativeToolNames: string[] = [];
  /** The Pi-native system prompt captured before any override (first before_agent_start). */
  nativeSystemPrompt: string | null = null;
  /** True once this session ever engaged the Minimal composition. */
  minimalEngaged = false;
  /** True once this session has seen a successful Minimal tool call. */
  firstToolCallDetected = false;
  private lastToolCallWasError = false;
  turn = 0;
  /** Reasoning level captured before switching to benchmark profile. */
  previousThinkingLevel: string | null = null;

  // ---- instrumentation accumulators (reset per session) ----
  toolCalls: ToolCallRecord[] = [];
  failedToolCalls = 0;
  recoveryAttempts = 0;
  /** "We need" / "Let's" / "Let me" counts in visible assistant text. */
  fingerprint = { weNeed: 0, lets: 0, letMe: 0 };
  /** Total visible reasoning characters observed (length only, never content). */
  reasoningChars = 0;
  turnStartedAt: number | null = null;

  resetForSession(sessionId: string | null, reason: string, cwd: string): void {
    this.anchorState = "UNANCHORED";
    this.sessionId = sessionId;
    this.sessionReason = reason;
    this.cwd = cwd;
    this.nativeToolNames = [];
    this.nativeSystemPrompt = null;
    this.minimalEngaged = false;
    this.firstToolCallDetected = false;
    this.turn = 0;
    this.toolCalls = [];
    this.failedToolCalls = 0;
    this.recoveryAttempts = 0;
    this.lastToolCallWasError = false;
    this.fingerprint = { weNeed: 0, lets: 0, letMe: 0 };
    this.reasoningChars = 0;
    this.turnStartedAt = null;
  }

  /** Anchor trigger: only successful Minimal tool calls transition. */
  recordToolResult(name: string, callId: string, isError: boolean, startedAt: number): void {
    const record: ToolCallRecord = {
      name,
      callId,
      isError,
      durationMs: startedAt > 0 ? Date.now() - startedAt : null,
      startedAt,
    };
    this.toolCalls.push(record);
    if (isError) {
      this.failedToolCalls += 1;
      this.lastToolCallWasError = true;
      return;
    }
    if (this.lastToolCallWasError) {
      this.recoveryAttempts += 1;
      this.lastToolCallWasError = false;
    }
    if (!this.firstToolCallDetected) {
      this.firstToolCallDetected = true;
    }
    if (this.anchorState === "UNANCHORED" && this.isMinimalTool(name) && usesAnchor(this.experiment)) {
      this.anchorState = "ANCHORED";
    }
  }

  recordRecovery(): void {
    this.recoveryAttempts += 1;
  }

  isMinimalTool(name: string): boolean {
    return name === "bash" || name === "str_replace_editor";
  }

  get experiment(): ExperimentId {
    return this.settings.experiment ?? experimentForMode(this.settings.mode, this.settings.anchorVariant);
  }

  // ---- settings mutations (kept here for testability) ----
  setMode(mode: RLAnchorMode): void {
    this.settings.mode = mode;
    this.settings.experiment = null;
  }

  setExperiment(experiment: ExperimentId): void {
    this.settings.experiment = experiment;
  }

  setAnchorVariant(variant: AnchorVariant): void {
    this.settings.anchorVariant = variant;
  }

  setProfile(profile: ProfileId): void {
    this.settings.profile = profile;
  }

  setCompaction(mode: CompactionMode): void {
    this.settings.compaction = mode;
  }

  setDebugLogging(on: boolean): void {
    this.settings.debugLogging = on;
  }
}
