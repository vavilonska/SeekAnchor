/**
 * Language fingerprint — diagnostic only. Counts surface phrases in the
 * *visible* assistant text and records reasoning *lengths* (never content).
 * The extension never instructs the model to use these phrases.
 */

export interface TextFingerprint {
  weNeed: number;
  lets: number;
  letMe: number;
}

export function countFingerprint(text: string): TextFingerprint {
  let weNeed = 0;
  let lets = 0;
  let letMe = 0;
  // Case-insensitive, whole-word-ish counting (diagnostic only).
  const lower = text.toLowerCase();
  let idx = 0;
  while (true) {
    idx = lower.indexOf("we need", idx);
    if (idx < 0) break;
    weNeed += 1;
    idx += 7;
  }
  idx = 0;
  while (true) {
    idx = lower.indexOf("let's", idx);
    if (idx < 0) break;
    lets += 1;
    idx += 5;
  }
  idx = 0;
  while (true) {
    idx = lower.indexOf("let me", idx);
    if (idx < 0) break;
    letMe += 1;
    idx += 6;
  }
  return { weNeed, lets, letMe };
}

export function mergeFingerprint(target: TextFingerprint, delta: TextFingerprint): void {
  target.weNeed += delta.weNeed;
  target.lets += delta.lets;
  target.letMe += delta.letMe;
}

/** Sum of reasoning text lengths (content is discarded). */
export function reasoningLength(blocks: unknown[]): number {
  let total = 0;
  for (const block of blocks) {
    const b = block as { type?: string; text?: string; thinking?: string };
    if (b?.type === "thinking" && typeof b.thinking === "string") total += b.thinking.length;
    else if (b?.type === "reasoning" && typeof b.text === "string") total += b.text.length;
  }
  return total;
}

/** Visible assistant text from content blocks (excludes reasoning/thinking/tool calls). */
export function visibleAssistantText(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const b = block as { type?: string; text?: string };
    if (b?.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("");
}
