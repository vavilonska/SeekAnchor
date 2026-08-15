/**
 * JSONL turn logger. Logs only observable metadata — never message content,
 * tool arguments, API keys, or environment secrets.
 * Output: logs/session-<sessionId>.jsonl (project root `logs/`).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SessionState } from "../state.ts";

export interface TurnLogEntry {
  turn: number;
  mode: string;
  experiment: string;
  anchorVariant: string;
  anchorState: string;
  profile: string;
  systemPromptHash: string | null;
  toolSchemaHash: string | null;
  toolNames: string[];
  messageCount: number;
  usage: {
    input?: number;
    output?: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
  } | null;
  toolCalls: Array<{
    name: string;
    callId: string;
    isError: boolean;
    durationMs: number | null;
  }>;
  firstToolCallDetected: boolean;
  fingerprint: { weNeed: number; lets: number; letMe: number };
  reasoningChars: number;
  compositionClean: boolean;
  timestamp: string;
}

export class TurnLogger {
  private file: string | null = null;

  constructor(
    private readonly logsDir: string,
    private readonly enabled: () => boolean,
  ) {}

  setSession(sessionId: string | null): void {
    if (!sessionId) {
      this.file = null;
      return;
    }
    mkdirSync(this.logsDir, { recursive: true });
    this.file = join(this.logsDir, `session-${sanitize(sessionId)}.jsonl`);
  }

  log(entry: TurnLogEntry): void {
    if (!this.enabled() || !this.file) return;
    try {
      appendFileSync(this.file, JSON.stringify(entry) + "\n", "utf8");
    } catch {
      // Logging must never break the agent loop.
    }
  }

  /** Build the per-turn entry from session state + last-request hashes. */
  buildEntry(
    state: SessionState,
    hashes: { system: string | null; tools: string | null },
    toolNames: string[] = [],
  ): TurnLogEntry {
    return {
      turn: state.turn,
      mode: state.settings.mode,
      experiment: state.experiment,
      anchorVariant: state.settings.anchorVariant,
      anchorState: state.anchorState,
      profile: state.settings.profile,
      systemPromptHash: hashes.system,
      toolSchemaHash: hashes.tools,
      toolNames,
      messageCount: 0,
      usage: null,
      toolCalls: state.toolCalls.map((c) => ({
        name: c.name,
        callId: c.callId,
        isError: c.isError,
        durationMs: c.durationMs,
      })),
      firstToolCallDetected: state.firstToolCallDetected,
      fingerprint: { ...state.fingerprint },
      reasoningChars: state.reasoningChars,
      compositionClean: true,
      timestamp: new Date().toISOString(),
    };
  }
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}
