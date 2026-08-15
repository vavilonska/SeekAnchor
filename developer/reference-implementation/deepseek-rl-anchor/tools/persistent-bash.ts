/**
 * Persistent bash adapter — mirrors DSH `tool-bash-persistent` semantics
 * (packages/shell/tool-bash-persistent/src/index.ts) using one long-lived
 * `bash` child process per session instead of a PTY.
 *
 * Verified DSH semantics reproduced:
 * - one persistent shell per session; `cd` and exported env vars persist
 * - commands serialized (one at a time)
 * - marker-based output capture; `[exit code: N]` appended on non-zero exit
 * - 300000 ms timeout -> partial output + reset message, shell reset
 * - 16000 char output truncation with the exact DSH `<response clipped>` NOTE
 * - empty command rejected
 *
 * Deviation (documented): no PTY, so no `stty -echo`/PS1 setup (non-interactive
 * bash prints no prompt) and no terminal scrollback limit; we emulate the
 * scrollback-loss prefix for truncated partial output.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  DSH_BASH_TIMEOUT_MS,
  DSH_LOST_PREFIX_MESSAGE,
  DSH_MAX_OUTPUT_CHARS,
  DSH_SHELL_RESET_MESSAGE,
  DSH_TRUNCATED_MESSAGE,
} from "../dsh/constants.generated.ts";

export interface PersistentBashOptions {
  cwd: string;
  timeoutMs?: number;
  maxOutputChars?: number;
}

/** DSH quoteForBash: $'...' single-line quoting. */
function quoteForBash(value: string): string {
  return `$'${value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")}'`;
}

function markers(): { start: string; end: string } {
  const nonce = randomUUID();
  return {
    start: `__DSH_PERSISTENT_BASH_START_${nonce}__`,
    end: `__DSH_PERSISTENT_BASH_END_${nonce}:`,
  };
}

function wrapCommand(command: string, marker: { start: string; end: string }): string {
  // `eval -- ... 2>&1` merges stderr into stdout (no PTY here), matching the
  // DSH PTY behavior where both streams share the terminal.
  return `printf '%s\\n' ${quoteForBash(marker.start)}; eval -- ${quoteForBash(command)} 2>&1; __dsh_persistent_bash_status=$?; printf '%s%s\\n' ${quoteForBash(marker.end)} "$__dsh_persistent_bash_status"`;
}

function maybeTruncate(content: string, maxOutputChars: number, incomplete = false): string {
  if (content.length <= maxOutputChars && !incomplete) return content;
  return content.length <= maxOutputChars
    ? content + DSH_TRUNCATED_MESSAGE
    : content.slice(0, maxOutputChars) + DSH_TRUNCATED_MESSAGE;
}

interface CapturedOutput {
  text: string;
  incomplete: boolean;
  exitCode?: number;
}

/** DSH partialOutput: text after the start marker; fallback when the marker is lost. */
function partialOutput(snapshot: string, marker: { start: string; end: string }, fallbackTruncated = false): CapturedOutput {
  const startMarker = snapshot.lastIndexOf(marker.start);
  if (startMarker >= 0) {
    return {
      text: snapshot.slice(startMarker + marker.start.length).replace(/^\r?\n/, ""),
      incomplete: false,
    };
  }
  return {
    text: snapshot.replaceAll("\r\n", "\n"),
    incomplete: true,
  };
}

/** Parse accumulated output for the end marker, then the start marker. */
function commandOutput(snapshot: string, marker: { start: string; end: string }): CapturedOutput | undefined {
  const end = snapshot.lastIndexOf(marker.end);
  if (end < 0) return undefined;
  const statusMatch = /^(\d+)\r?\n/.exec(snapshot.slice(end + marker.end.length));
  if (!statusMatch) return undefined;
  const startMarker = snapshot.lastIndexOf(marker.start, end);
  const start = startMarker < 0 ? 0 : startMarker + marker.start.length;
  let text = snapshot.slice(start, end).replace(/^\r?\n/, "");
  // Strip a trailing newline, mirroring DSH stripPrompt's final newline removal.
  if (text.endsWith("\n")) text = text.slice(0, -1);
  return {
    text,
    incomplete: startMarker < 0,
    exitCode: Number(statusMatch[1]),
  };
}

function renderCaptured(output: CapturedOutput, maxOutputChars: number): string {
  const rendered = maybeTruncate(output.text, maxOutputChars, output.incomplete);
  const withPrefix =
    output.incomplete && output.text.length > 0 ? DSH_LOST_PREFIX_MESSAGE + rendered : rendered;
  const marker =
    output.exitCode !== undefined && output.exitCode !== 0
      ? `[exit code: ${output.exitCode}]`
      : undefined;
  if (marker === undefined) return withPrefix;
  return withPrefix.length === 0 ? marker : `${withPrefix}\n${marker}`;
}

export class PersistentBash {
  private child: ChildProcessWithoutNullStreams | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly timeoutMs: number;
  private readonly maxOutputChars: number;
  private readonly options: PersistentBashOptions;

  constructor(options: PersistentBashOptions) {
    this.options = options;
    this.timeoutMs = options.timeoutMs ?? DSH_BASH_TIMEOUT_MS;
    this.maxOutputChars = options.maxOutputChars ?? DSH_MAX_OUTPUT_CHARS;
  }

  private ensureShell(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null && !this.child.killed) return this.child;
    const child = spawn("bash", [], {
      cwd: this.options.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    this.child = child;
    return child;
  }

  private async reset(reason: string): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child) {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await new Promise<void>((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once("exit", () => resolve());
          setTimeout(resolve, 2000).unref();
        });
      }
      // Destroy stdio so pipes held open by orphaned background jobs do not
      // keep the node event loop alive (ChildProcess 'close' never fires).
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
    }
    void reason;
  }

  /** Run one command in the persistent shell. Returns the DSH-formatted result text. */
  async exec(command: string, signal?: AbortSignal): Promise<string> {
    if (command.trim().length === 0) throw new Error("command must be a non-empty string");
    const run = this.queue.then(() => this.executeCommand(command, signal));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async executeCommand(command: string, upstream?: AbortSignal): Promise<string> {
    if (upstream?.aborted) upstream.throwIfAborted();
    const shell = this.ensureShell();
    const marker = markers();
    const wrapped = wrapCommand(command, marker);

    const output = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      let settled = false;
      const onData = (chunk: string): void => {
        buffer += chunk;
        if (!settled && buffer.includes(marker.end)) {
          const parsed = commandOutput(buffer, marker);
          if (parsed !== undefined) {
            settled = true;
            cleanup();
            resolve(renderCaptured(parsed, this.maxOutputChars));
          }
        }
      };
      const onExit = (code: number | null, sig: string | null): void => {
        if (settled) return;
        settled = true;
        cleanup();
        const parsed = commandOutput(buffer, marker);
        const partial = parsed ?? partialOutput(buffer, marker);
        const rendered = renderCaptured(partial, this.maxOutputChars);
        const exitNote =
          sig !== null
            ? `[shell killed by signal: ${sig}]`
            : code !== null
              ? `[shell exited: code ${code}]`
              : "[shell exited]";
        const combined = [rendered, exitNote, DSH_SHELL_RESET_MESSAGE]
          .filter((part) => part.length > 0)
          .join("\n");
        resolve(combined);
      };
      const onError = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        upstream?.removeEventListener("abort", onAbort);
        shell.stdout.removeListener("data", onData);
        shell.stderr.removeListener("data", onData);
        shell.removeListener("exit", onExit);
        shell.removeListener("error", onError);
        // Pause so pipes held open by orphaned background jobs do not keep the
        // node event loop alive between commands.
        shell.stdout.pause();
        shell.stderr.pause();
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        void this.reset("persistent bash command aborted");
        const parsed = commandOutput(buffer, marker);
        const partial = parsed ?? partialOutput(buffer, marker);
        const rendered = renderCaptured(partial, this.maxOutputChars);
        const aborted = new Error("aborted");
        aborted.name = "AbortError";
        reject(aborted);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        void this.reset("persistent bash command timed out").then(() => {
          const parsed = commandOutput(buffer, marker);
          const partial = parsed ?? partialOutput(buffer, marker);
          const rendered = renderCaptured(partial, this.maxOutputChars);
          const message = [
            `Your command timed out after ${Math.round(this.timeoutMs / 1000)} seconds or experienced an OOM error. Below is partial output:`,
            rendered,
            DSH_SHELL_RESET_MESSAGE,
          ].join("\n");
          resolve(message);
        });
      }, this.timeoutMs);
      timer.unref?.();

      shell.stdout.on("data", onData);
      shell.stderr.on("data", onData);
      shell.once("exit", onExit);
      shell.once("error", onError);
      if (upstream) upstream.addEventListener("abort", onAbort, { once: true });
      shell.stdout.resume();
      shell.stderr.resume();

      shell.stdin.write(wrapped + "\n", (err) => {
        if (err) onError(err);
      });
    });

    if (this.child && this.child.exitCode !== null) {
      // Shell died during the command; the next call spawns a fresh one.
      this.child = null;
    }
    return output;
  }

  /** Kill the persistent shell (session shutdown). */
  async dispose(): Promise<void> {
    await this.queue;
    await this.reset("persistent bash disposed");
  }
}
