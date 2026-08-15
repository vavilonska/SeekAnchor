/**
 * Composition helpers: SHA-256 hashing of system prompt and tool schemas,
 * plus the safe /ds-dump writer. Never writes message content or secrets.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(value));
}

export interface PayloadSnapshot {
  systemPromptHash: string | null;
  systemPromptLength: number | null;
  toolSchemaHash: string | null;
  toolNames: string[];
  messageCount: number;
  model: string | null;
  reasoningEffort: unknown;
  thinking: unknown;
  temperature: unknown;
  maxTokens: unknown;
  hasToolsField: boolean;
}

/**
 * Snapshot metadata from a provider payload. Only hashes + names + scalar
 * sampling fields are captured; message content and tool arguments are never
 * read into the snapshot.
 */
export function snapshotPayload(payload: Record<string, unknown>): PayloadSnapshot {
  const messages = Array.isArray(payload.messages) ? (payload.messages as unknown[]) : [];
  let systemPromptHash: string | null = null;
  let systemPromptLength: number | null = null;
  const first = messages[0] as { role?: string; content?: unknown } | undefined;
  if (first?.role === "system" && typeof first.content === "string") {
    systemPromptHash = sha256(first.content);
    systemPromptLength = first.content.length;
  }
  const tools = Array.isArray(payload.tools) ? (payload.tools as unknown[]) : [];
  const toolNames = tools
    .map((t) => {
      const tool = t as { function?: { name?: string } };
      return tool?.function?.name ?? null;
    })
    .filter((n): n is string => n !== null);
  return {
    systemPromptHash,
    systemPromptLength,
    toolSchemaHash: tools.length > 0 ? sha256Json(tools) : null,
    toolNames,
    messageCount: messages.length,
    model: typeof payload.model === "string" ? payload.model : null,
    reasoningEffort: payload.reasoning_effort ?? null,
    thinking: payload.thinking ?? null,
    temperature: payload.temperature ?? null,
    maxTokens: payload.max_tokens ?? null,
    hasToolsField: Array.isArray(payload.tools),
  };
}

/**
 * Write /ds-dump artifacts. `extra` must be pre-sanitized by the caller.
 * This function additionally refuses to write anything that looks like a
 * credential line.
 */
export function writeDump(dir: string, files: Record<string, string>): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    if (looksLikeSecret(content)) {
      throw new Error(`refusing to dump ${name}: content looks like a secret`);
    }
    const path = join(dir, name);
    writeFileSync(path, content, "utf8");
    written.push(path);
  }
  return written;
}

/** Cheap secret sniffing guard for dump files. */
export function looksLikeSecret(text: string): boolean {
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      /^(api[_-]?key|authorization|bearer|x-api-key|sk-[a-z0-9])/i.test(trimmed) ||
      /sk-[a-zA-Z0-9_-]{16,}/.test(trimmed) ||
      /(authorization|api[_-]?key)\s*[:=]/i.test(trimmed)
    ) {
      return true;
    }
  }
  return false;
}
