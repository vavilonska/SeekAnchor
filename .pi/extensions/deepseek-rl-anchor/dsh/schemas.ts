/**
 * DSH-exact model-visible tool definitions built with TypeBox.
 * The canonical JSON (artifacts/minimal-tools.json) was extracted from the
 * official deepseek-ai/deepseek-harness source; see docs/dsh-minimal-audit.md.
 */
import { Type, type TSchema } from "typebox";
import {
  DSH_BASH_DESCRIPTION,
  DSH_EDITOR_DESCRIPTION,
  DSH_MINIMAL_TOOLS,
} from "./constants.generated.ts";

/** TypeBox schema that compiles to the exact DSH bash parameters JSON Schema. */
export const dshBashParameters = Type.Object({
  command: Type.String({
    description: "The bash command to run. Relative path is preferred in the command.",
  }),
});

/** TypeBox schema that compiles to the exact DSH str_replace_editor parameters JSON Schema. */
export const dshEditorParameters = Type.Object({
  command: Type.String({
    enum: ["view", "create", "str_replace", "insert"],
    description: "The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`.",
  }),
  path: Type.String({
    description: "Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`.",
  }),
  file_text: Type.Optional(
    Type.String({
      description: "Required parameter of `create` command, with the content of the file to be created.",
    }),
  ),
  insert_line: Type.Optional(
    Type.Integer({
      description: "Required parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`.",
    }),
  ),
  new_str: Type.Optional(
    Type.String({
      description: "Optional parameter of `str_replace` command containing the new string (if not given, no string will be added). Required parameter of `insert` command containing the string to insert.",
    }),
  ),
  old_str: Type.Optional(
    Type.String({
      description: "Required parameter of `str_replace` command containing the string in `path` to replace.",
    }),
  ),
  view_range: Type.Optional(
    Type.Array(Type.Integer(), {
      description: "Optional parameter of `view` command when `path` points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.",
    }),
  ),
});

export interface DshToolDefinition {
  name: string;
  description: string;
  parameters: TSchema;
}

/** Model-visible tool definitions in DSH registration order (bash, str_replace_editor). */
export const dshMinimalToolDefinitions: DshToolDefinition[] = [
  { name: "bash", description: DSH_BASH_DESCRIPTION, parameters: dshBashParameters },
  { name: "str_replace_editor", description: DSH_EDITOR_DESCRIPTION, parameters: dshEditorParameters },
];

/**
 * Verify the TypeBox schemas compile to the canonical extracted JSON.
 * Returns a list of mismatches (empty = exact).
 */
export function schemaMismatches(): string[] {
  const canonical = DSH_MINIMAL_TOOLS;
  const problems: string[] = [];
  for (let i = 0; i < canonical.length; i++) {
    const expected = canonical[i];
    const actual = dshMinimalToolDefinitions[i];
    if (actual.name !== expected.name) problems.push(`tool ${i} name mismatch`);
    if (actual.description !== expected.description) problems.push(`tool ${i} description mismatch`);
    const actualParams = JSON.parse(JSON.stringify(actual.parameters));
    if (stableStringify(actualParams) !== stableStringify(expected.parameters)) {
      problems.push(`tool ${i} parameters mismatch`);
    }
  }
  return problems;
}

/** Order-insensitive canonical JSON for schema comparison. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
