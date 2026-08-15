/**
 * str_replace_editor adapter — mirrors DSH `tool-str-replace-editor`
 * (packages/fs/tool-str-replace-editor/src/index.ts) exactly:
 * view / create / str_replace / insert commands, absolute-path requirement,
 * cat -n style views, 2-level directory listings, unique-match replacement,
 * DSH error strings, 16000-char clipping with `<response clipped>`.
 */
import { isAbsolute } from "node:path";
import { readFile, stat, writeFile, readdir } from "node:fs/promises";
import { DSH_EDITOR_TRUNCATED_MESSAGE, DSH_MAX_OUTPUT_CHARS } from "../dsh/constants.generated.ts";

export interface EditorParams {
  command: "view" | "create" | "str_replace" | "insert";
  path: string;
  file_text?: string;
  insert_line?: number;
  new_str?: string;
  old_str?: string;
  view_range?: number[];
}

export class StrReplaceEditor {
  private readonly cwd: string;
  private readonly maxOutputChars: number;

  constructor(cwd: string, maxOutputChars: number = DSH_MAX_OUTPUT_CHARS) {
    this.cwd = cwd;
    this.maxOutputChars = maxOutputChars;
  }

  private maybeTruncate(content: string): string {
    return content.length <= this.maxOutputChars
      ? content
      : content.slice(0, this.maxOutputChars) + DSH_EDITOR_TRUNCATED_MESSAGE;
  }

  private resolveTarget(path: string): string {
    if (path.trim().length === 0) throw new Error("path must be a non-empty string");
    if (!isAbsolute(path)) {
      throw new Error(
        `The path ${path} is not an absolute path, it should start with \`/\`. Maybe you meant /${path}?`,
      );
    }
    return path;
  }

  private async statExisting(path: string, command: "view" | "str_replace" | "insert") {
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new Error(`The path ${path} does not exist. Please provide a valid path.`);
    }
    if (info.isDirectory() && command !== "view") {
      throw new Error(
        `The path ${path} is a directory and only the \`view\` command can be used on directories`,
      );
    }
    return info;
  }

  private requiredForCommand(value: string | undefined, parameter: string, command: string, allowEmpty = true): string {
    if (value === undefined) throw new Error(`Parameter \`${parameter}\` is required for command: ${command}`);
    if (!allowEmpty && value.length === 0) {
      throw new Error(`Parameter \`${parameter}\` is empty for command: ${command}`);
    }
    return value;
  }

  private formatFileView(path: string, content: string, viewRange?: number[]): string {
    const allLines = content.split("\n");
    let lines = allLines;
    let initialLine = 1;
    let finalLine: number | undefined;
    let prompt = `Here's the content of ${path} with line numbers (which has a total of ${allLines.length} lines)`;
    if (viewRange !== undefined) {
      const [requestedInitialLine, requestedFinalLine] = viewRange;
      if (
        viewRange.length !== 2 ||
        requestedInitialLine === undefined ||
        requestedFinalLine === undefined ||
        !viewRange.every(Number.isInteger)
      ) {
        throw new Error("Invalid `view_range`. It should be a list of two integers.");
      }
      initialLine = requestedInitialLine;
      finalLine = requestedFinalLine;
      if (initialLine < 1 || initialLine > allLines.length) {
        throw new Error(
          `Invalid \`view_range\`: [${viewRange.join(", ")}]. Its first element \`${initialLine}\` should be within the range of lines of the file: [1, ${allLines.length}]`,
        );
      }
      if (finalLine > allLines.length) {
        throw new Error(
          `Invalid \`view_range\`: [${viewRange.join(", ")}]. Its second element \`${finalLine}\` should be smaller than the number of lines in the file: \`${allLines.length}\``,
        );
      }
      if (finalLine !== -1 && finalLine < initialLine) {
        throw new Error(
          `Invalid \`view_range\`: [${viewRange.join(", ")}]. Its second element \`${finalLine}\` should be larger or equal than its first \`${initialLine}\``,
        );
      }
      lines =
        finalLine === -1 ? allLines.slice(initialLine - 1) : allLines.slice(initialLine - 1, finalLine);
      prompt += ` with view_range=[${initialLine}, ${finalLine}]`;
    }
    const numbered = lines
      .map((line, index) => `${String(initialLine + index).padStart(6, " ")}  ${line}`)
      .join("\n");
    return this.maybeTruncate(`${prompt}:\n${numbered}\n`);
  }

  private async listDirectory(path: string): Promise<string> {
    const visit = async (dir: string, depth: number): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const rows: string[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__") {
          continue;
        }
        const full = `${dir}/${entry.name}`;
        const type = entry.isDirectory() ? "d" : entry.isFile() ? "f" : "?";
        rows.push(`${type}\t${full}`);
        if (entry.isDirectory() && depth < 2) {
          rows.push(...(await visit(full, depth + 1)));
        }
      }
      return rows;
    };
    const rows = [`d\t${path}`, ...(await visit(path, 1))];
    rows.sort((left, right) => {
      const leftPath = left.slice(left.indexOf("\t") + 1);
      const rightPath = right.slice(right.indexOf("\t") + 1);
      return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
    });
    const listing = this.maybeTruncate(rows.join("\n") + "\n");
    return `Here're the files and directories up to 2 levels deep in ${path}, excluding hidden items, node_modules, and Python cache directories:\n${listing}\n`;
  }

  private async viewPath(path: string, viewRange: number[] | undefined): Promise<string> {
    const target = this.resolveTarget(path);
    const info = await this.statExisting(target, "view");
    if (info.isDirectory()) {
      if (viewRange !== undefined) {
        throw new Error("The `view_range` parameter is not allowed when `path` points to a directory.");
      }
      return this.listDirectory(target);
    }
    if (!info.isFile()) {
      throw new Error(`cannot view "${target}": not a regular file or directory`);
    }
    const content = await readFile(target, "utf8");
    return this.formatFileView(target, content, viewRange);
  }

  private async createFile(path: string, fileText: string | undefined): Promise<string> {
    const content = this.requiredForCommand(fileText, "file_text", "create");
    const target = this.resolveTarget(path);
    let exists = false;
    try {
      exists = (await stat(target)).isFile();
    } catch {
      exists = false;
    }
    if (exists) {
      throw new Error(`File already exists at: ${target}. Cannot overwrite files using command \`create\`.`);
    }
    await writeFile(target, content, "utf8");
    return `New file created successfully at: ${target}`;
  }

  private async replaceInFile(
    path: string,
    oldStr: string | undefined,
    newStr: string | undefined,
  ): Promise<string> {
    const target = this.resolveTarget(path);
    const oldValue = this.requiredForCommand(oldStr, "old_str", "str_replace", false);
    const newValue = newStr ?? "";
    await this.statExisting(target, "str_replace");
    const before = await readFile(target, "utf8");
    const offsets: number[] = [];
    let offset = 0;
    while (true) {
      const match = before.indexOf(oldValue, offset);
      if (match < 0) break;
      offsets.push(match);
      offset = match + oldValue.length;
    }
    if (offsets.length === 0) {
      throw new Error(
        `No replacement was performed, old_str \`${oldValue}\` did not appear verbatim in ${target}.`,
      );
    }
    if (offsets.length > 1) {
      let line = 1;
      let cursor = 0;
      const lines = offsets.map((o) => {
        while (cursor < o) {
          if (before[cursor] === "\n") line += 1;
          cursor += 1;
        }
        return line;
      });
      throw new Error(
        `No replacement was performed. Multiple occurrences of old_str \`${oldValue}\` in lines [${lines.join(", ")}]. Please ensure it is unique`,
      );
    }
    const first = offsets[0];
    await writeFile(target, before.slice(0, first) + newValue + before.slice(first + oldValue.length), "utf8");
    return `The file ${target} has been edited successfully.`;
  }

  private async insertInFile(
    path: string,
    insertLine: number | undefined,
    newStr: string | undefined,
  ): Promise<string> {
    if (insertLine === undefined) throw new Error("Parameter `insert_line` is required for command: insert");
    const value = this.requiredForCommand(newStr, "new_str", "insert");
    const target = this.resolveTarget(path);
    await this.statExisting(target, "insert");
    const before = await readFile(target, "utf8");
    const lines = before.split("\n");
    if (!Number.isInteger(insertLine) || insertLine < 0 || insertLine > lines.length) {
      throw new Error(
        `Invalid \`insert_line\` parameter: ${insertLine}. It should be within the range of lines of the file: [0, ${lines.length}]`,
      );
    }
    const after = [
      ...lines.slice(0, insertLine),
      ...value.split("\n"),
      ...lines.slice(insertLine),
    ].join("\n");
    await writeFile(target, after, "utf8");
    return `The file ${target} has been edited successfully.`;
  }

  /** Execute one editor command; returns the DSH-formatted result text. */
  async execute(params: EditorParams): Promise<string> {
    switch (params.command) {
      case "view":
        return this.viewPath(params.path, params.view_range);
      case "create":
        return this.createFile(params.path, params.file_text);
      case "str_replace":
        return this.replaceInFile(params.path, params.old_str, params.new_str);
      case "insert":
        return this.insertInFile(params.path, params.insert_line, params.new_str);
      default:
        throw new Error(`unknown command: ${String(params.command)}`);
    }
  }
}
