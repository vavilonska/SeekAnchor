# SeekAnchor for OpenCode V2

This runtime adapter uses the OpenCode V2 plugin API to replace the request
system prompt with the DSH Minimal prompt, expose only the configured execution
tool and `str_replace_editor` during bootstrap, anchor after the first
successful Minimal tool result, and optionally restore the full OpenCode
composition.

Configuration is read from `.opencode/seek-anchor.json` for a project-local
installation or `~/.config/opencode/seek-anchor.json` for a global installation:

```json
{
  "mode": "minimal",
  "anchorVariant": "A",
  "bashBackend": "opencode"
}
```

- `minimal` keeps the Minimal composition.
- `anchor` restores the full tool catalog after a successful Minimal tool.
- variant A retains the Minimal system prompt after anchoring.
- variant B restores OpenCode's system prompt after anchoring.
- backend `opencode` keeps the native `shell` executor, permissions,
  cancellation, and background lifecycle while narrowing its model-visible
  schema during Minimal. Its visible name remains `shell`.
- backend `dsh` registers SeekAnchor's persistent `bash` for closer DSH tool
  identity and behavior reproduction. Changing backends requires a full
  OpenCode restart.

The OpenCode adapter intentionally registers no `ds-*` commands. OpenCode's
public custom-command API sends prompt templates to the model rather than
running local callbacks. Change `mode`, `anchorVariant`, or `bashBackend`
directly in the settings JSON instead.

Run `.opencode/install-global.ps1` from the repository root to install the
runtime and settings under the current user's OpenCode config directory. Do not
activate both project-local and global copies in the same project.

The plugin intentionally has no simulated native mode. Disable plugin ID
`seekanchor.runtime` for a genuinely native control group. Backend `opencode`
restores the full native `shell` definition after Anchor. With backend `dsh`,
the plugin's `bash` remains available alongside native `shell` after Anchor.

The OpenCode V2 plugin API is beta. This adapter pins the package version it was
checked against in `.opencode/package.json`.

SeekAnchor is only a reasoning-trajectory steering experiment. It does not
guarantee output quality, correctness, safety, task success, or downstream
effects.
