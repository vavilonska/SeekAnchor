import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { StrReplaceEditor } from "../../.pi/extensions/deepseek-rl-anchor/tools/str-replace-editor.ts";
import { PersistentBash } from "../../.pi/extensions/deepseek-rl-anchor/tools/persistent-bash.ts";

test("editor create, replace and insert work without developer instrumentation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seek-anchor-"));
  try {
    const file = join(dir, "sample.txt");
    const editor = new StrReplaceEditor(dir);
    await editor.execute({ command: "create", path: file, file_text: "alpha\nbeta" });
    await editor.execute({
      command: "str_replace",
      path: file,
      old_str: "beta",
      new_str: "gamma",
    });
    await editor.execute({ command: "insert", path: file, insert_line: 1, new_str: "middle" });
    assert.equal(await readFile(file, "utf8"), "alpha\nmiddle\ngamma");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("persistent bash retains cwd and environment", async (context) => {
  if (spawnSync("bash", ["--version"]).error) context.skip("bash is unavailable");
  const dir = await mkdtemp(join(tmpdir(), "seek-anchor-bash-"));
  const shell = new PersistentBash({ cwd: dir, timeoutMs: 5000 });
  try {
    await shell.exec("export SEEK_ANCHOR_VALUE=stable");
    assert.equal(await shell.exec("printf '%s' \"$SEEK_ANCHOR_VALUE\""), "stable");
  } finally {
    await shell.dispose();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
