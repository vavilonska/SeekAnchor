# SeekAnchor

[Pi setup](#pi-installation-and-usage) · [Oh My Pi setup](#oh-my-pi-installation-and-usage) · [OpenCode setup](#opencode-v2-installation-and-usage) · [中文](README.zh-CN.md)

![SeekAnchor — Anchor mode workflow / Anchor 模式流程](docs/assets/overview.svg)

> Anchor-mode diagram; experimental, with no guaranteed quality gain. / 图示为 Anchor 模式，不保证能力提升。

[English](README.md) | [简体中文](README.zh-CN.md)

SeekAnchor steers DeepSeek V4 Pro toward the DSH Minimal agent trajectory. It
aims to make reasoning patterns such as “We need” and “Let's” emerge more
reliably without explicitly asking the model to produce those phrases.

The project currently provides three runtime adapters:

- Pi
- Oh My Pi (OMP)
- OpenCode V2 beta

Codex and Claude Code are outside the current scope.

## Manually verified environments

The target model-visible reasoning trajectory, including recurring “We need”
and “Let's” patterns, has been observed in manual tests under:

| Agent | Environment |
| --- | --- |
| Pi | Termux |
| Pi | Windows 11 |
| Oh My Pi (OMP) | Windows 11 |
| OpenCode CLI | Windows 11 |

These observations confirm that steering can occur in those environments; they
are not an automated benchmark or a guarantee that every request will follow
the trajectory or produce a better result.

## Repository layout

```text
.pi/extensions/deepseek-rl-anchor/   Pi runtime; auto-loaded from the project root
.omp/extensions/deepseek-rl-anchor/  Oh My Pi runtime; auto-loaded from the project root
.opencode/plugins/seek-anchor/       OpenCode V2 runtime; auto-discovered per project
developer/                            Tests and original research implementation; not loaded at runtime
```

Runtime and developer functionality are intentionally separated. Normal use
loads only mode control and the two DSH tools. Tests, benchmarks, experiment
matrices, JSONL logging, fingerprints, and composition dumps remain under
`developer/`.

## Pi installation and usage

### Use directly in this project

This repository already uses Pi's project extension layout, so no installation
command is required:

```powershell
cd path\to\SeekAnchor
pi
```

If Pi was already running before the extension was added, run:

```text
/reload
```

Check the status or select a mode:

```text
/ds-status
/ds-mode native
/ds-mode minimal
/ds-mode anchor
/ds-anchor-variant A
/ds-anchor-variant B
```

After `/ds-mode ` or `/ds-anchor-variant `, press Tab to select a valid
second-level argument such as `minimal` or `A`.

The default is `native`. Project settings are stored in
`.pi/deepseek-rl-anchor/settings.json`; global Pi configuration is not changed.

### Install into another Pi project

Copy only the runtime directory, not `developer/`:

```powershell
$seekAnchorSource = Resolve-Path ".pi\extensions\deepseek-rl-anchor"
$targetRuntime = "D:\path\to\target-project\.pi\extensions\deepseek-rl-anchor"
New-Item -ItemType Directory -Force -Path $targetRuntime | Out-Null
Copy-Item -Path (Join-Path $seekAnchorSource "*") -Destination $targetRuntime -Recurse -Force
```

Start Pi from the target project. Run `/reload` if Pi is already open.

### Install globally for Pi

A global installation makes the extension discoverable in every Pi project.
These commands still copy runtime files only:

```powershell
$seekAnchorSource = Resolve-Path ".pi\extensions\deepseek-rl-anchor"
$globalRuntime = Join-Path $env:USERPROFILE ".pi\agent\extensions\deepseek-rl-anchor"
New-Item -ItemType Directory -Force -Path $globalRuntime | Out-Null
Copy-Item -Path (Join-Path $seekAnchorSource "*") -Destination $globalRuntime -Recurse -Force
```

Restart Pi, or run `/reload` in an existing Pi session.

> Pi extensions run with the current user's permissions. Install only trusted
> code. This repository is not currently packaged as a Pi Package, so do not
> run `pi install` against the repository URL; use the runtime-copy method above.

### Ask Pi to install it globally

Start Pi from this repository root, then send the following prompt:

```text
Install the SeekAnchor Pi runtime globally for the current user.

Requirements:
1. Confirm that the current working directory is the SeekAnchor repository root, then read README.md and .pi/extensions/deepseek-rl-anchor/README.md.
2. The source must be .pi/extensions/deepseek-rl-anchor/ and the destination must be the current user's ~/.pi/agent/extensions/deepseek-rl-anchor/ directory.
3. Copy only the runtime extension directory. Do not copy developer/, .opencode/, tests, logs, or benchmark material.
4. Do not modify the source files, project settings, ~/.pi/agent/settings.json, authentication files, or any unrelated global configuration.
5. Resolve and display the absolute source and destination paths before writing. If the destination already exists, stop, report it, and ask me before overwriting anything.
6. After copying, verify that the destination contains index.ts, state.ts, dsh/, and tools/. Do not run model API tests.
7. Report every file operation and tell me to run /reload or restart Pi when finished.
```

The currently running Pi process will not automatically activate the newly
copied global extension. Run `/reload` or restart Pi after installation.

## Oh My Pi installation and usage

Oh My Pi uses a dedicated `.omp` copy so its settings do not collide with Pi.
From this repository root, project-local use requires no installation:

```powershell
omp
```

OMP auto-discovers `.omp/extensions/deepseek-rl-anchor/`. Use the same native
commands as Pi:

```text
/ds-mode native|minimal|anchor
/ds-anchor-variant A|B
/ds-status
```

OMP also provides Tab completion for the arguments after `/ds-mode ` and
`/ds-anchor-variant `.

Settings are stored in `.omp/deepseek-rl-anchor/settings.json`. Minimal uses
the DSH prompt and the DSH-compatible `bash` and `str_replace_editor`; Native
and the promoted Anchor phase restore OMP's original prompt/tools; the wrapper
delegates `bash` execution to OMP's native tool lifecycle.

Install the runtime globally for the default OMP profile with:

```powershell
powershell -ExecutionPolicy Bypass -File .omp\install-global.ps1
```

The installer honors `PI_CODING_AGENT_DIR` for custom/profile agent roots,
copies runtime files only, and stops if the target already exists unless
`-Force` is explicitly supplied. Run `/reload` or restart OMP afterward. To
let OMP install itself, open this repository in OMP and ask it to read this
section and run the same installer without `-Force`; it must stop and report
any existing target rather than overwriting it.

For an OMP named profile, either set `PI_CODING_AGENT_DIR` first or pass its
agent directory explicitly, for example
`-AgentRoot "$HOME\.omp\profiles\work\agent"`.

## OpenCode V2 installation and usage

### Compatibility

This adapter depends on the OpenCode V2 beta plugin API and pins the
type-checked `@opencode-ai/plugin` version. Regular OpenCode V1 cannot load this
plugin directly.

Install the V2 CLI:

```powershell
npm install -g @opencode-ai/cli@next
```

V1 and V2 can coexist. The V2 command is `opencode2`.

### Install project dependencies manually

Run this from the repository root:

```powershell
npm install --prefix .opencode
```

Then start V2:

```powershell
opencode2
```

OpenCode automatically discovers `.opencode/plugins/seek-anchor/index.ts`. If
you use an OpenCode Desktop build that supports the V2 plugin API, fully quit
the desktop app and reopen the cloned SeekAnchor repository as the project
directory.

Verify plugin loading through the V2 API:

```powershell
opencode2 api --standalone get /api/plugin
```

The output should contain:

```text
seekanchor.runtime
```

### Install globally for OpenCode

Global installation makes SeekAnchor available in every OpenCode project for
the current user:

```powershell
powershell -ExecutionPolicy Bypass -File .opencode\install-global.ps1
```

The installer copies only the runtime plugin to
`%USERPROFILE%\.config\opencode`, installs the pinned plugin API dependency
there, and preserves an existing global `seek-anchor.json`. The installer
refuses existing SeekAnchor targets by default; inspect them before explicitly
rerunning with `-Force`. Do not keep both project-local and global copies active
in the same project. Fully restart OpenCode after installation.

### Ask OpenCode to install it

Open this repository root in OpenCode and send the following prompt:

```text
Install the OpenCode runtime dependencies for the current SeekAnchor project.

Requirements:
1. Confirm that the current working directory is the repository root, then read README.md and .opencode/package.json.
2. Do not modify plugin source files, .opencode/seek-anchor.json, developer/, or any global configuration.
3. Perform only the project-level installation: npm install --prefix .opencode.
4. Confirm that .opencode/node_modules/@opencode-ai/plugin exists after installation and report its installed version.
5. Check whether the current OpenCode supports the V2 beta plugin API. If it is V1, stop and clearly report the incompatibility; do not rewrite the plugin for V1.
6. Do not make extra model API calls and do not run tests under developer/.
7. Finally, tell me whether OpenCode Desktop needs to be fully restarted.
```

After installation, fully restart the desktop app and reopen the project.

### Configure the OpenCode mode

Edit `.opencode/seek-anchor.json`:

```json
{
  "mode": "minimal",
  "anchorVariant": "A",
  "bashBackend": "opencode"
}
```

OpenCode supports:

- `minimal`: always use the Minimal system prompt. The default native backend
  exposes OpenCode's `shell` plus `str_replace_editor`; the DSH backend exposes
  `bash` plus `str_replace_editor`.
- `anchor`: start with the Minimal composition, then restore the full tool list
  on the request after the first successful Minimal tool execution.
- variant A: retain the Minimal system prompt after anchoring.
- variant B: restore the OpenCode system prompt after anchoring.
- `bashBackend: "opencode"` (default): keep OpenCode's native `shell` executor,
  permissions, cancellation, and background-task lifecycle while presenting a
  narrowed, command-only schema during Minimal. The model-visible name remains
  `shell` because OpenCode V2 does not call this native tool `bash`.
- `bashBackend: "dsh"`: add SeekAnchor's persistent `bash` for closer DSH tool
  identity and behavior reproduction.

The OpenCode adapter registers no `ds-*` commands. OpenCode's public custom
commands are model-driven prompt templates rather than local callbacks, so mode
control is deliberately configuration-only and does not trigger an extra model
request. For a project-local installation, edit `.opencode/seek-anchor.json`;
for a global installation, edit `~/.config/opencode/seek-anchor.json`.

Mode and variant changes are re-read on subsequent requests. Changing the bash
backend requires a full restart because executor registration occurs when the
plugin mounts.

The adapter intentionally has no simulated `native` mode. Disable the plugin ID
`seekanchor.runtime` for a genuinely native OpenCode control group. With the
default `opencode` backend, Anchor restores the full native `shell` definition.
With the optional `dsh` backend, Anchor restores the host catalog while the
plugin-provided `bash` remains available alongside OpenCode's native `shell`.

## Mode semantics

- `native`: Pi and Oh My Pi; use the host prompt and host tools.
- `minimal`: use the DSH Minimal prompt with either native `shell` or DSH
  `bash`, plus `str_replace_editor`, according to the configured backend.
- `anchor`: begin in Minimal, then restore host tools after the first successful
  Minimal tool call.

## Adapting another agent

An adapter for another agent should reproduce the model-visible composition,
not merely append an instruction asking the model to say “We need” or “Let's”.
The host needs an extension or middleware point immediately before model
dispatch that can inspect and modify the system prompt, messages, and tool
catalog for the current request.

A practical implementation should follow these principles:

1. Mount the complete Minimal system prompt and expose only the intended
   execution tool plus `str_replace_editor` during bootstrap.
2. Separate the model-visible schema from the execution backend. Preserve tool
   identity and schema first; when host permissions and lifecycle matter, keep
   the native executor and narrow only the request-visible definition. If the
   host's native tool name differs (OpenCode V2 uses `shell`), exact DSH tool
   identity and the native executor cannot both be preserved: document the
   tradeoff and offer a custom `bash` backend for closer reproduction.
3. Keep anchor state per session. Do not use a process-wide boolean that can
   leak one session's phase into another.
4. Define an explicit promotion signal. SeekAnchor currently promotes after a
   successful Minimal tool result; another host may instead expose durable tool
   call or assistant-message events. Specify retry, resume, and reload behavior
   explicitly, and reconstruct state from durable events when the host permits.
5. On promotion, restore the host prompt and/or full tool catalog according to
   variant A or B. Document which plugin tools remain registered alongside the
   restored native catalog.
6. Keep benchmarks, request snapshots, logging, and linguistic measurements out
   of the runtime discovery path. They are developer instrumentation, not agent
   capabilities.
7. Verify the first model request's actual system prompt and tool schemas, then
   verify the post-anchor request separately. Judge usefulness through task
   success and repeatable evaluations rather than wording frequency alone.

If the host cannot mutate the final request composition or cannot replace tools
structurally, prompt-only imitation is possible but is not equivalent to this
project's anchoring approach.

## Developer material

The original research implementation is preserved under
`developer/reference-implementation/deepseek-rl-anchor/`, outside Pi and
OpenCode's automatic discovery paths.

Local verification commands:

```powershell
npm install
npm test
npm run typecheck:opencode
npm run test:global-install
npm run test:omp-global-install
```

These commands are for developers only. They are not required for normal Pi,
Oh My Pi, or OpenCode runtime installation.

Some audits, vendor sources, and benchmark artifacts mentioned in the original
README were absent from the initially supplied archive. Treat those claims as
unverified until the missing material is restored and rerun.

## Scope

> **SeekAnchor is only an experimental reasoning-trajectory steering aid. It
> does not guarantee the quality, correctness, safety, task success, or any
> downstream effect of the steered output.**

SeekAnchor reproduces a model-visible prompt/tool composition. It does not
claim to unlock hidden chains of thought, and linguistic patterns alone do not
prove a capability improvement. Independently review outputs and evaluate the
result through repeatable task-success measurements.

## License

SeekAnchor is licensed under the [MIT License](LICENSE), copyright © 2026
vavilonska7. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream
attribution.

## Acknowledgements

Special thanks to
[xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)
for the core idea. Its two-phase direction—establishing the initial trajectory
with a Minimal prompt and the real Minimal tool schemas, then restoring the full
tool set—was an important inspiration for SeekAnchor's Anchor mode.

## Upstream documentation

- [Pi Extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [Oh My Pi Extensions](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md)
- [Oh My Pi Extension Loading](https://github.com/can1357/oh-my-pi/blob/main/docs/extension-loading.md)
- [OpenCode V2 Plugins](https://opencode.ai/v2/docs/build/plugins)
- [Migrating OpenCode V1 to V2](https://opencode.ai/v2/docs/migrate-v1)

## Related projects / 相关项目

[OMPmail](https://github.com/vavilonska/OMPmail) · [OMP Pet](https://github.com/vavilonska/omp-pet) · [All projects / 全部项目](https://github.com/vavilonska#projects--项目)
